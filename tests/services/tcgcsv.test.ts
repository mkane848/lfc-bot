import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { catalogItems, catalogSets, catalogSyncMeta } from '../../src/db/schema.js';
import {
  IMPORT_VERSION,
  isCatalogSyncStale,
  POKEMON_SYNC_SOURCE,
  syncPokemonCatalog,
} from '../../src/services/tcgcsv.js';
import { PROJECT_VERSION } from '../../src/utils/version.js';
import { setupTestDb } from '../helpers/db.js';
import {
  FakeTcgcsv,
  groupsBody,
  OBF_GROUP,
  pokemonFixture,
  productsBody,
  SV3_GROUP,
  SV3_PRODUCTS,
} from '../helpers/tcgcsv.js';

setupTestDb();

const run = () => syncPokemonCatalog({ requestIntervalMs: 0 });
const OBF_PATH = `/tcgplayer/3/${OBF_GROUP.groupId}/products`;
const SV3_PATH = `/tcgplayer/85/${SV3_GROUP.groupId}/products`;

let tcgcsv: FakeTcgcsv;

beforeEach(() => {
  tcgcsv = pokemonFixture();
  tcgcsv.install();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const items = () => getDb().select().from(catalogItems).all();
const sets = () => getDb().select().from(catalogSets).all();
const meta = () =>
  getDb()
    .select()
    .from(catalogSyncMeta)
    .where(eq(catalogSyncMeta.source, POKEMON_SYNC_SOURCE))
    .get();

describe('syncPokemonCatalog', () => {
  it('imports the English and Japanese sets with their cards and sealed product', async () => {
    const result = await run();

    expect(result).toEqual({
      status: 'synced',
      setsImported: 2,
      setsUnchanged: 0,
      setsRemoved: 0,
      items: 6,
    });
    expect(sets().map((set) => [set.language, set.id, set.name, set.code])).toEqual(
      expect.arrayContaining([
        ['en', '23228', 'Obsidian Flames', 'OBF'],
        ['ja', '23400', 'Ruler of the Black Flame', 'SV3'],
      ]),
    );
    expect(items()).toHaveLength(6);
  });

  it('stores set details: release date, and a code in upper case', async () => {
    await run();
    const [obf] = sets().filter((set) => set.id === '23228');
    expect(obf).toMatchObject({ releaseDate: '2023-08-11', supplemental: 0, game: 'pokemon' });
    expect(sets().find((set) => set.id === '23400')?.code).toBe('SV3');
  });

  it('tells a card from sealed product by its Number, and keeps only the numerator', async () => {
    await run();
    const byId = Object.fromEntries(items().map((item) => [item.id, item]));
    expect(byId['501256']).toMatchObject({
      name: 'Obsidian Flames Booster Pack',
      kind: 'sealed',
      number: null,
      category: 'booster_pack',
    });
    expect(byId['509879']).toMatchObject({
      kind: 'card',
      number: '125',
      language: 'en',
      id: '509879',
      setId: '23228',
    });
  });

  it('cleans names and keys them for search', async () => {
    await run();
    const byId = Object.fromEntries(items().map((item) => [item.id, item]));
    // The redundant "(63)" goes; the printing qualifier stays but is not in the search key.
    expect(byId['509881']).toMatchObject({ name: 'Pikachu', nameNormalized: 'pikachu' });
    expect(byId['509880']).toMatchObject({
      name: 'Charizard ex (Full Art)',
      nameNormalized: 'charizard ex full art',
      baseNormalized: 'charizard ex',
    });
    // A Japanese product's name loses the number written into it.
    expect(byId['520002']).toMatchObject({
      name: 'Charizard ex',
      language: 'ja',
      number: '134',
      setId: '23400',
    });
  });

  it('records the sync stamp, so a run is known to be current', async () => {
    await run();
    expect(meta()?.fingerprint).toBe('2026-10-23T20:06:07+0000');
    expect(isCatalogSyncStale()).toBe(false);
  });

  it('identifies itself and what it is, on every request', async () => {
    await run();
    expect(tcgcsv.calls.length).toBeGreaterThan(0);
    for (const call of tcgcsv.calls) {
      expect(call.headers['user-agent']).toBe(
        `LFCbot/${PROJECT_VERSION} (+https://github.com/mkane848/lfc-bot)`,
      );
    }
  });

  it('asks only for the files the guidelines allow: last-updated, groups, products, never prices', async () => {
    await run();
    expect(tcgcsv.paths).toEqual([
      '/last-updated.txt',
      '/tcgplayer/3/groups',
      '/tcgplayer/85/groups',
      OBF_PATH,
      SV3_PATH,
    ]);
    expect(tcgcsv.paths.some((path) => path.endsWith('/prices'))).toBe(false);
  });

  it('leaves at least the requested time between requests', async () => {
    const times: number[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => {
      times.push(Date.now());
      return real(...args);
    });
    await syncPokemonCatalog({ requestIntervalMs: 40 });
    // The first request (last-updated) has nothing before it to wait for.
    const gaps = times.slice(2).map((time, index) => time - (times[index + 1] ?? 0));
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(35);
    }
  });
});

describe('a run when nothing has been published', () => {
  it('stops after one request and changes nothing', async () => {
    await run();
    const before = items();
    tcgcsv.calls.length = 0;

    const result = await run();

    expect(result.status).toBe('skipped');
    expect(tcgcsv.paths).toEqual(['/last-updated.txt']);
    expect(items()).toEqual(before);
  });

  it('still confirms the catalog current, so a restart does not ask again', async () => {
    await run();
    getDb().update(catalogSyncMeta).set({ syncedAt: 1 }).run();
    expect(isCatalogSyncStale()).toBe(true);

    await run();

    expect(isCatalogSyncStale()).toBe(false);
  });
});

describe('a run after TCGCSV publishes a new build', () => {
  beforeEach(async () => {
    await run();
    tcgcsv.set('/last-updated.txt', { text: '2026-10-24T20:05:00+0000' });
    tcgcsv.calls.length = 0;
  });

  it('sends each set’s stored ETag and skips a set that answers 304', async () => {
    const before = items();

    const result = await run();

    expect(result).toMatchObject({ status: 'synced', setsImported: 0, setsUnchanged: 2 });
    const productCalls = tcgcsv.calls.filter((call) => call.path.endsWith('/products'));
    expect(productCalls.map((call) => call.headers['if-none-match'])).toEqual([
      '"obf-1"',
      '"sv3-1"',
    ]);
    expect(items()).toEqual(before);
    expect(meta()?.fingerprint).toBe('2026-10-24T20:05:00+0000');
  });

  it('replaces a changed set’s products, dropping the ones that vanished', async () => {
    tcgcsv.set(OBF_PATH, {
      body: productsBody([
        { productId: 509879, name: 'Charizard ex', number: '125/197' },
        { productId: 509890, name: 'Gholdengo ex', number: '139/197' },
      ]),
      etag: '"obf-2"',
    });

    const result = await run();

    expect(result).toMatchObject({ setsImported: 1, setsUnchanged: 1, items: 2 });
    expect(
      items()
        .filter((item) => item.setId === '23228')
        .map((item) => item.name)
        .sort(),
    ).toEqual(['Charizard ex', 'Gholdengo ex']);
    expect(sets().find((set) => set.id === '23228')?.etag).toBe('"obf-2"');
  });

  it('removes a set TCGCSV no longer lists, with its products', async () => {
    tcgcsv.set('/tcgplayer/85/groups', {
      body: groupsBody([{ groupId: 99999, name: 'SV9: Other', abbreviation: 'SV9' }]),
    });
    tcgcsv.set('/tcgplayer/85/99999/products', { body: productsBody([]) });

    const result = await run();

    expect(result.setsRemoved).toBe(1);
    expect(sets().find((set) => set.id === '23400')).toBeUndefined();
    expect(items().some((item) => item.setId === '23400')).toBe(false);
    // The English set is untouched.
    expect(items().filter((item) => item.setId === '23228')).toHaveLength(4);
  });

  it('clears a set whose product list is now a 404, which is how TCGCSV says it has none', async () => {
    tcgcsv.remove(OBF_PATH);

    const result = await run();

    expect(result.status).toBe('synced');
    expect(items().filter((item) => item.setId === '23228')).toHaveLength(0);
    expect(sets().some((set) => set.id === '23228')).toBe(true);
  });

  it('updates a set’s name without re-importing its products when they answer 304', async () => {
    tcgcsv.set('/tcgplayer/3/groups', {
      body: groupsBody([{ ...OBF_GROUP, name: 'SV03: Obsidian Flames (Renamed)' }]),
    });
    await run();
    expect(sets().find((set) => set.id === '23228')?.name).toBe('Obsidian Flames (Renamed)');
    expect(items().filter((item) => item.setId === '23228')).toHaveLength(4);
  });
});

describe('failures keep the catalog', () => {
  it('fails, changes nothing and stamps nothing when a category lists no groups', async () => {
    await run();
    const before = items();
    tcgcsv.set('/last-updated.txt', { text: 'next' });
    tcgcsv.set('/tcgplayer/85/groups', { body: groupsBody([]) });

    const result = await run();

    expect(result.status).toBe('failed');
    expect(items()).toEqual(before);
    expect(meta()?.fingerprint).toBe('2026-10-23T20:06:07+0000');
  });

  it('fails rather than treating a body with no results list as an empty set', async () => {
    await run();
    const before = items();
    tcgcsv.set('/last-updated.txt', { text: 'next' });
    tcgcsv.set(OBF_PATH, { body: { unexpected: 'shape' }, etag: '"obf-2"' });

    const result = await run();

    expect(result.status).toBe('failed');
    // The set with the bad body kept its products; the other one still synced.
    expect(items()).toEqual(before);
    expect(meta()?.fingerprint).toBe('2026-10-23T20:06:07+0000');
  });

  it('keeps what a half-finished run imported, and retries the rest next time', async () => {
    tcgcsv.set(SV3_PATH, { fail: true });

    const first = await run();

    expect(first).toMatchObject({ status: 'failed', setsImported: 1 });
    expect(items().filter((item) => item.language === 'en')).toHaveLength(4);
    expect(items().filter((item) => item.language === 'ja')).toHaveLength(0);
    expect(meta()).toBeUndefined();

    tcgcsv.set(SV3_PATH, { body: productsBody(SV3_PRODUCTS), etag: '"sv3-1"' });
    tcgcsv.calls.length = 0;
    const second = await run();

    expect(second).toMatchObject({ status: 'synced', setsImported: 1, setsUnchanged: 1 });
    expect(items()).toHaveLength(6);
    // The English set was a 304 on the retry, not downloaded again.
    expect(tcgcsv.calls.find((call) => call.path === OBF_PATH)?.headers['if-none-match']).toBe(
      '"obf-1"',
    );
  });

  it('does not throw when TCGCSV is unreachable, and leaves everything as it was', async () => {
    await run();
    const before = items();
    tcgcsv.set('/last-updated.txt', { fail: true });

    await expect(run()).resolves.toMatchObject({ status: 'failed' });
    expect(items()).toEqual(before);
  });

  it('fails on an empty last-updated.txt', async () => {
    tcgcsv.set('/last-updated.txt', { text: '   \n' });
    await expect(run()).resolves.toMatchObject({ status: 'failed' });
    expect(items()).toHaveLength(0);
  });

  it('gives up after several sets in a row fail instead of hammering a dead host', async () => {
    const groups = Array.from({ length: 12 }, (_, index) => ({
      groupId: 30000 + index,
      name: `SV0${index}: Set ${index}`,
      abbreviation: `S${index}`,
    }));
    tcgcsv.set('/tcgplayer/3/groups', { body: groupsBody(groups) });
    for (const group of groups) {
      tcgcsv.set(`/tcgplayer/3/${group.groupId}/products`, { fail: true });
    }

    const result = await run();

    expect(result.status).toBe('failed');
    const productCalls = tcgcsv.paths.filter((path) => path.startsWith('/tcgplayer/3/3'));
    // Five failures end the run; each is attempted twice before it counts.
    expect(productCalls.length).toBeLessThanOrEqual(10);
    expect(productCalls.length).toBeLessThan(groups.length);
  }, 30_000);

  it('retries a transient server error once before counting a set as failed', async () => {
    let attempts = 0;
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === 'string' ? args[0] : '';
      if (url.endsWith(OBF_PATH)) {
        attempts += 1;
        if (attempts === 1) {
          return Promise.resolve(new Response('busy', { status: 503 }));
        }
      }
      return real(...args);
    });

    const result = await run();

    expect(result.status).toBe('synced');
    expect(attempts).toBe(2);
  }, 15_000);
});

describe('which kind a product is', () => {
  it('reads the name when a product has no number: sealed with a category, an unnumbered single as a card, a code card not at all', async () => {
    tcgcsv.set(OBF_PATH, {
      body: productsBody([
        { productId: 1, name: 'Obsidian Flames Elite Trainer Box' },
        { productId: 2, name: 'Obsidian Flames Booster Bundle' },
        { productId: 3, name: 'Charizard' },
        { productId: 4, name: 'Fire Energy (2006 Unnumbered)' },
        { productId: 5, name: 'Code Card - Obsidian Flames Booster Pack' },
        { productId: 6, name: 'Charizard ex', number: '125/197' },
      ]),
    });

    await run();

    const inSet = items()
      .filter((item) => item.setId === '23228')
      .map((item) => [item.id, item.kind, item.category, item.number]);
    expect(inSet).toEqual(
      expect.arrayContaining([
        ['1', 'sealed', 'elite_trainer_box', null],
        ['2', 'sealed', 'booster_bundle', null],
        ['3', 'card', null, null],
        ['4', 'card', null, null],
        ['6', 'card', null, '125'],
      ]),
    );
    expect(inSet).toHaveLength(5);
  });

  it('gives a card with no number a null number, which the card flow already handles', async () => {
    tcgcsv.set(OBF_PATH, { body: productsBody([{ productId: 3, name: 'Charizard' }]) });
    await run();
    expect(items().find((item) => item.id === '3')).toMatchObject({
      kind: 'card',
      number: null,
      baseNormalized: 'charizard',
    });
  });
});

describe('sets imported by an older version of the importer', () => {
  const OLD = IMPORT_VERSION - 1;
  const versionOf = (id: string) => sets().find((set) => set.id === id)?.importVersion;

  /** What PR 4's importer left: sets at version 0, and a card filed as sealed. */
  async function seedOldImport(setIds: string[] = ['23228', '23400']): Promise<void> {
    await run();
    getDb()
      .update(catalogSets)
      .set({ importVersion: OLD })
      .where(inArray(catalogSets.id, setIds))
      .run();
    getDb()
      .update(catalogItems)
      .set({ kind: 'sealed', category: null })
      .where(eq(catalogItems.id, '509879'))
      .run();
    tcgcsv.calls.length = 0;
  }

  it('records the current version on every set a run imports', async () => {
    await run();
    expect(versionOf('23228')).toBe(IMPORT_VERSION);
    expect(versionOf('23400')).toBe(IMPORT_VERSION);
  });

  it('is stale at boot even though it was confirmed current an hour ago', async () => {
    await seedOldImport();
    expect(isCatalogSyncStale()).toBe(true);
  });

  it('is imported again, without the "nothing new" stop or any If-None-Match', async () => {
    await seedOldImport();

    const result = await run();

    expect(result).toMatchObject({ status: 'synced', setsImported: 2, setsUnchanged: 0 });
    const productCalls = tcgcsv.calls.filter((call) => call.path.endsWith('/products'));
    expect(productCalls).toHaveLength(2);
    for (const call of productCalls) {
      expect(call.headers['if-none-match']).toBeUndefined();
    }
    expect(items().find((item) => item.id === '509879')).toMatchObject({
      kind: 'card',
      category: null,
    });
    expect(versionOf('23228')).toBe(IMPORT_VERSION);
    expect(isCatalogSyncStale()).toBe(false);
  });

  it('goes back to one request a day once every set is current', async () => {
    await seedOldImport();
    await run();
    tcgcsv.calls.length = 0;

    const result = await run();

    expect(result.status).toBe('skipped');
    expect(tcgcsv.paths).toEqual(['/last-updated.txt']);
  });

  it('imports again only the sets that are outdated, and trusts the ETag of the rest', async () => {
    await seedOldImport(['23228']);

    const result = await run();

    expect(result).toMatchObject({ status: 'synced', setsImported: 1, setsUnchanged: 1 });
    const headers = Object.fromEntries(
      tcgcsv.calls
        .filter((call) => call.path.endsWith('/products'))
        .map((call) => [call.path, call.headers['if-none-match']]),
    );
    expect(headers).toEqual({ [OBF_PATH]: undefined, [SV3_PATH]: '"sv3-1"' });
  });

  it('keeps what a failed re-import already redid, and finishes the rest next time', async () => {
    await seedOldImport();
    tcgcsv.set(SV3_PATH, { fail: true });

    const first = await run();

    expect(first.status).toBe('failed');
    expect(versionOf('23228')).toBe(IMPORT_VERSION);
    expect(versionOf('23400')).toBe(OLD);
    expect(isCatalogSyncStale()).toBe(true);

    tcgcsv.set(SV3_PATH, { body: productsBody(SV3_PRODUCTS), etag: '"sv3-1"' });
    tcgcsv.calls.length = 0;
    const second = await run();

    // The English set was redone by the failed run, so it is a 304 now.
    expect(second).toMatchObject({ status: 'synced', setsImported: 1, setsUnchanged: 1 });
    expect(isCatalogSyncStale()).toBe(false);
  });
});

describe('what a run does with odd data', () => {
  it('skips a product with no id or name, and keeps the rest', async () => {
    tcgcsv.set(OBF_PATH, {
      body: {
        results: [
          { name: 'No id', extendedData: [{ name: 'Number', value: '1/10' }] },
          { productId: 1, name: '   ', extendedData: [{ name: 'Number', value: '2/10' }] },
          { productId: 2, name: 'Fine', extendedData: [{ name: 'Number', value: '3/10' }] },
        ],
      },
    });
    await run();
    expect(
      items()
        .filter((item) => item.setId === '23228')
        .map((item) => item.name),
    ).toEqual(['Fine']);
  });

  it('keeps one row for a product TCGCSV lists in two sets, under the later one', async () => {
    tcgcsv.set('/tcgplayer/3/groups', {
      body: groupsBody([OBF_GROUP, { groupId: 23229, name: 'SV03.5: 151', abbreviation: 'MEW' }]),
    });
    tcgcsv.set(`/tcgplayer/3/23229/products`, {
      body: productsBody([{ productId: 509879, name: 'Charizard ex', number: '006/165' }]),
    });

    const result = await run();

    expect(result.status).toBe('synced');
    const charizard = items().filter((item) => item.id === '509879');
    expect(charizard).toHaveLength(1);
    expect(charizard[0]).toMatchObject({ setId: '23229', number: '006' });
  });

  it('stores no release date for a set TCGplayer only stamped with the build time', async () => {
    tcgcsv.set('/tcgplayer/3/groups', {
      body: groupsBody([
        {
          groupId: 23231,
          name: 'POP Series 9',
          abbreviation: 'POP9',
          publishedOn: '2026-10-23T20:00:07.1827719Z',
        },
        OBF_GROUP,
      ]),
    });
    tcgcsv.set(`/tcgplayer/3/23231/products`, { body: productsBody([]) });
    await run();
    expect(sets().find((set) => set.id === '23231')?.releaseDate).toBeNull();
    expect(sets().find((set) => set.id === '23228')?.releaseDate).toBe('2023-08-11');
  });

  it('stores a set with no abbreviation with an empty code', async () => {
    tcgcsv.set('/tcgplayer/3/groups', {
      body: groupsBody([{ groupId: 23230, name: 'Some Set With No Code' }]),
    });
    tcgcsv.set(`/tcgplayer/3/23230/products`, { body: productsBody([]) });
    await run();
    expect(sets().find((set) => set.id === '23230')?.code).toBe('');
  });

  it('never stores a price, a url or an image', async () => {
    await run();
    const row = items()[0];
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'baseNormalized',
        'category',
        'game',
        'id',
        'kind',
        'language',
        'name',
        'nameNormalized',
        'number',
        'setId',
        'updatedAt',
      ].sort(),
    );
  });
});

describe('running twice at once', () => {
  it('shares one run instead of downloading twice', async () => {
    const [first, second] = await Promise.all([run(), run()]);

    expect(first).toBe(second);
    expect(tcgcsv.paths.filter((path) => path === '/last-updated.txt')).toHaveLength(1);
  });
});

describe('isCatalogSyncStale', () => {
  it('is stale before the first sync, fresh just after, stale again after a day', async () => {
    expect(isCatalogSyncStale()).toBe(true);
    await run();
    expect(isCatalogSyncStale()).toBe(false);
    getDb()
      .update(catalogSyncMeta)
      .set({ syncedAt: Date.now() - 25 * 60 * 60 * 1000 })
      .run();
    expect(isCatalogSyncStale()).toBe(true);
  });
});

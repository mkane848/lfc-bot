import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/index.js';
import { sealedCache, sealedCatalogMeta } from '../../src/db/schema.js';
import type { NewSealedCacheRow } from '../../src/db/schema.js';
import { lookupManapoolSealedProduct } from '../../src/services/manapool.js';
import {
  autocompleteSealedProducts,
  autocompleteSealedSets,
  isSealedCatalogStale,
  resolveSealedProduct,
  syncSealedCatalog,
} from '../../src/services/sealed.js';
import {
  SEALED_CATALOG_META_URL,
  SEALED_CATALOG_STALE_MS,
  SEALED_CATALOG_URL,
  SEALED_PRODUCT_NAME_MAX,
} from '../../src/utils/constants.js';
import { setupTestDb } from '../helpers/db.js';

vi.mock('../../src/services/manapool.js', () => ({
  lookupManapoolSealedProduct: vi.fn(),
}));

setupTestDb();

const manapool = vi.mocked(lookupManapoolSealedProduct);
const fetchMock = vi.fn();

/**
 * A 130-character product name. MTGJSON ships four of these; Discord caps
 * autocomplete name *and* value at 100, so the sync stores the truncation.
 */
const LONG_NAME = `Duskmourn House of Horror ${'Very '.repeat(20)}Long Collector Booster Box`;

interface FixtureProduct {
  uuid: string;
  name: string;
  setCode: string;
  category?: string | null;
  subtype?: string | null;
  releaseDate?: string | null;
}

/** A deliberately tiny stand-in for MTGJSON's 11.6 MB `SetList.json`. */
function setListPayload(sets: Array<{ sealedProduct?: FixtureProduct[] }>): unknown {
  return { meta: { date: '2026-09-13', version: '5.3.0' }, data: sets };
}

const BASE_SETS: Array<{ sealedProduct?: FixtureProduct[] }> = [
  {
    sealedProduct: [
      {
        uuid: 'uuid-blb-bundle',
        name: 'Bloomburrow Bundle',
        setCode: 'BLB',
        category: 'bundle',
        subtype: 'default',
        releaseDate: '2024-08-02',
      },
      {
        uuid: 'uuid-blb-collector',
        name: 'Bloomburrow Collector Booster Box',
        setCode: 'BLB',
        category: 'booster_box',
        subtype: 'collector',
      },
    ],
  },
  {
    sealedProduct: [
      {
        uuid: 'uuid-dsk-play',
        name: 'Duskmourn Play Booster Box',
        setCode: 'DSK',
        category: 'booster_box',
        subtype: 'play',
      },
      // `category` omitted on purpose: the column is NOT NULL, and one drifted
      // product must not abort the whole import.
      { uuid: 'uuid-dsk-long', name: LONG_NAME, setCode: 'DSK' },
    ],
  },
  // A set with no sealed products at all — 524 of MTGJSON's 869 sets look like this.
  {},
];

function jsonResponse(
  body: unknown,
  init?: { status?: number; etag?: string | null },
): Record<string, unknown> {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init?.etag ? { etag: init.etag } : {}),
    json: () => Promise.resolve(body),
  };
}

/** Route the stubbed `fetch` by URL so tests can fail each endpoint separately. */
function routeFetch(handlers: { meta?: () => unknown; catalog?: () => unknown }): void {
  fetchMock.mockImplementation((url: string) => {
    if (url === SEALED_CATALOG_META_URL) {
      const handler = handlers.meta;
      if (!handler) {
        throw new Error('unexpected Meta.json fetch');
      }
      return Promise.resolve(handler());
    }
    if (url === SEALED_CATALOG_URL) {
      const handler = handlers.catalog;
      if (!handler) {
        throw new Error('unexpected SetList.json fetch');
      }
      return Promise.resolve(handler());
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function serveCatalog(options: {
  version: string;
  sets?: Array<{ sealedProduct?: FixtureProduct[] }>;
  etag?: string | null;
}): void {
  routeFetch({
    meta: () => jsonResponse({ meta: {}, data: { date: '2026-09-13', version: options.version } }),
    catalog: () =>
      jsonResponse(setListPayload(options.sets ?? BASE_SETS), { etag: options.etag ?? null }),
  });
}

function catalogUuids(): string[] {
  return getDb()
    .select({ uuid: sealedCache.uuid })
    .from(sealedCache)
    .all()
    .map((row) => row.uuid)
    .sort();
}

function metaRow() {
  return getDb().select().from(sealedCatalogMeta).where(eq(sealedCatalogMeta.id, 1)).get();
}

function seedProducts(rows: Array<Partial<NewSealedCacheRow> & { uuid: string; name: string }>) {
  const db = getDb();
  for (const row of rows) {
    db.insert(sealedCache)
      .values({
        uuid: row.uuid,
        name: row.name,
        nameNormalized: row.nameNormalized ?? row.name.toLowerCase(),
        setCode: row.setCode ?? 'BLB',
        category: row.category ?? 'booster_box',
        subtype: row.subtype ?? null,
        releaseDate: row.releaseDate ?? null,
        updatedAt: row.updatedAt ?? Date.now(),
      })
      .run();
  }
}

/** The URL count that proves the 11.6 MB payload was never requested. */
function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => (call as [string])[0]);
}

beforeEach(() => {
  // Module-level `vi.mock` is not auto-reset in this repo.
  fetchMock.mockReset();
  manapool.mockReset();
  manapool.mockResolvedValue(null);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncSealedCatalog', () => {
  it("imports every set's sealed products and records the build metadata", async () => {
    serveCatalog({ version: '5.3.0+20260913', etag: '"etag-1"' });

    const result = await syncSealedCatalog();

    expect(result.removed).toBe(0);
    expect(result.imported).toBe(4);
    expect(catalogUuids()).toEqual([
      'uuid-blb-bundle',
      'uuid-blb-collector',
      'uuid-dsk-long',
      'uuid-dsk-play',
    ]);

    const meta = metaRow();
    expect(meta?.buildVersion).toBe('5.3.0+20260913');
    expect(meta?.setListEtag).toBe('"etag-1"');
    expect(meta?.syncedAt).toBeGreaterThan(0);

    // A product with no `category` must not abort the transaction.
    const drifted = getDb()
      .select()
      .from(sealedCache)
      .where(eq(sealedCache.uuid, 'uuid-dsk-long'))
      .get();
    expect(drifted?.category).toBe('unknown');
  });

  it('upserts changed rows and removes uuids that vanished upstream', async () => {
    serveCatalog({ version: 'v1' });
    await syncSealedCatalog();

    const nextSets: Array<{ sealedProduct?: FixtureProduct[] }> = [
      {
        sealedProduct: [
          // Same uuid, renamed upstream.
          {
            uuid: 'uuid-blb-bundle',
            name: 'Bloomburrow Gift Bundle',
            setCode: 'BLB',
            category: 'bundle',
          },
          // Brand new product.
          {
            uuid: 'uuid-fdn-starter',
            name: 'Foundations Starter Collection',
            setCode: 'FDN',
            category: 'box_set',
          },
        ],
      },
    ];
    serveCatalog({ version: 'v2', sets: nextSets });

    const result = await syncSealedCatalog();

    expect(result).toEqual({ imported: 2, removed: 3 });
    expect(catalogUuids()).toEqual(['uuid-blb-bundle', 'uuid-fdn-starter']);

    const renamed = getDb()
      .select()
      .from(sealedCache)
      .where(eq(sealedCache.uuid, 'uuid-blb-bundle'))
      .get();
    expect(renamed?.name).toBe('Bloomburrow Gift Bundle');
    expect(renamed?.nameNormalized).toBe('bloomburrow gift bundle');
  });

  it('truncates names over the Discord cap and keeps them resolvable', async () => {
    serveCatalog({ version: 'v1' });
    await syncSealedCatalog();

    const row = getDb()
      .select()
      .from(sealedCache)
      .where(eq(sealedCache.uuid, 'uuid-dsk-long'))
      .get();
    expect(LONG_NAME.length).toBeGreaterThan(SEALED_PRODUCT_NAME_MAX);
    expect(row?.name).toBe(LONG_NAME.slice(0, SEALED_PRODUCT_NAME_MAX));
    expect(row?.name.length).toBe(SEALED_PRODUCT_NAME_MAX);
    // nameNormalized is derived from the *truncated* name, so the value Discord
    // hands back from autocomplete resolves exactly.
    const truncated = row?.name ?? '';
    const choice = autocompleteSealedProducts('House of Horror').find((c) => c.value === truncated);
    expect(choice).toBeDefined();
    await expect(resolveSealedProduct(truncated)).resolves.toMatchObject({
      uuid: 'uuid-dsk-long',
      resolved: true,
    });
  });

  it('skips the SetList.json download entirely when the build version is unchanged', async () => {
    getDb()
      .insert(sealedCatalogMeta)
      .values({ id: 1, buildVersion: '5.3.0+20260913', setListEtag: '"etag-1"', syncedAt: 1000 })
      .run();
    seedProducts([{ uuid: 'kept', name: 'Kept Product' }]);

    // No `catalog` handler: requesting SetList.json would throw.
    routeFetch({
      meta: () =>
        jsonResponse({ meta: {}, data: { date: '2026-09-13', version: '5.3.0+20260913' } }),
    });

    await expect(syncSealedCatalog()).resolves.toEqual({ imported: 0, removed: 0 });

    expect(fetchedUrls()).toEqual([SEALED_CATALOG_META_URL]);
    expect(fetchedUrls()).not.toContain(SEALED_CATALOG_URL);
    expect(catalogUuids()).toEqual(['kept']);

    // `syncedAt` means "we last confirmed the catalog current", so a skip
    // refreshes it and `isSealedCatalogStale` stops re-checking every restart.
    const meta = metaRow();
    expect(meta?.syncedAt).toBeGreaterThan(1000);
    expect(meta?.buildVersion).toBe('5.3.0+20260913');
    // Untouched: this run never asked for SetList.json.
    expect(meta?.setListEtag).toBe('"etag-1"');
    expect(isSealedCatalogStale()).toBe(false);
  });

  it('sends If-None-Match and treats a 304 as no change', async () => {
    getDb()
      .insert(sealedCatalogMeta)
      .values({ id: 1, buildVersion: 'v1', setListEtag: '"etag-1"', syncedAt: 1000 })
      .run();
    seedProducts([{ uuid: 'kept', name: 'Kept Product' }]);

    routeFetch({
      meta: () => jsonResponse({ meta: {}, data: { version: 'v2' } }),
      catalog: () => jsonResponse(null, { status: 304 }),
    });

    await expect(syncSealedCatalog()).resolves.toEqual({ imported: 0, removed: 0 });

    const catalogCall = fetchMock.mock.calls.find(
      (call) => (call as [string])[0] === SEALED_CATALOG_URL,
    ) as [string, RequestInit] | undefined;
    expect((catalogCall?.[1].headers as Record<string, string>)['If-None-Match']).toBe('"etag-1"');
    expect(catalogUuids()).toEqual(['kept']);

    // MTGJSON confirmed our rows are current for v2, so record it: the next run
    // short-circuits at the 113-byte meta check instead of re-asking for 11.6 MB.
    const meta = metaRow();
    expect(meta?.buildVersion).toBe('v2');
    expect(meta?.setListEtag).toBe('"etag-1"');
    expect(meta?.syncedAt).toBeGreaterThan(1000);
    expect(isSealedCatalogStale()).toBe(false);
  });

  it('leaves the catalog intact when SetList.json answers non-2xx', async () => {
    serveCatalog({ version: 'v1' });
    await syncSealedCatalog();
    const before = catalogUuids();

    routeFetch({
      meta: () => jsonResponse({ meta: {}, data: { version: 'v2' } }),
      catalog: () => jsonResponse({}, { status: 503 }),
    });

    await expect(syncSealedCatalog()).resolves.toEqual({ imported: 0, removed: 0 });
    expect(catalogUuids()).toEqual(before);
    expect(metaRow()?.buildVersion).toBe('v1');
  });

  it('leaves the catalog intact when the payload is malformed JSON', async () => {
    serveCatalog({ version: 'v1' });
    await syncSealedCatalog();
    const before = catalogUuids();

    routeFetch({
      meta: () => jsonResponse({ meta: {}, data: { version: 'v2' } }),
      catalog: () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.reject(new Error('Unexpected token < in JSON')),
      }),
    });

    await expect(syncSealedCatalog()).resolves.toEqual({ imported: 0, removed: 0 });
    expect(catalogUuids()).toEqual(before);
  });

  it('leaves the catalog intact when fetch throws', async () => {
    serveCatalog({ version: 'v1' });
    await syncSealedCatalog();
    const before = catalogUuids();

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('network error'));

    await expect(syncSealedCatalog()).resolves.toEqual({ imported: 0, removed: 0 });
    expect(catalogUuids()).toEqual(before);
    expect(metaRow()?.buildVersion).toBe('v1');
  });

  it('refuses to wipe the catalog when the payload carries no sealed products', async () => {
    serveCatalog({ version: 'v1' });
    await syncSealedCatalog();
    const before = catalogUuids();

    serveCatalog({ version: 'v2', sets: [{}, {}] });

    await expect(syncSealedCatalog()).resolves.toEqual({ imported: 0, removed: 0 });
    expect(catalogUuids()).toEqual(before);
    expect(metaRow()?.buildVersion).toBe('v1');
  });
});

describe('autocompleteSealedProducts', () => {
  beforeEach(() => {
    seedProducts([
      { uuid: 'a', name: 'Bloomburrow Bundle', nameNormalized: 'bloomburrow bundle' },
      {
        uuid: 'b',
        name: 'Bloomburrow Collector Booster Box',
        nameNormalized: 'bloomburrow collector booster box',
      },
      {
        uuid: 'c',
        name: 'Duskmourn Play Booster Box',
        nameNormalized: 'duskmourn play booster box',
        setCode: 'DSK',
      },
    ]);
  });

  it('returns an empty array for an empty or whitespace-only query', () => {
    expect(autocompleteSealedProducts('')).toEqual([]);
    expect(autocompleteSealedProducts('   ')).toEqual([]);
  });

  it('substring-matches the normalized name and mirrors name into value', () => {
    expect(autocompleteSealedProducts('booster box')).toEqual([
      { name: 'Bloomburrow Collector Booster Box', value: 'Bloomburrow Collector Booster Box' },
      { name: 'Duskmourn Play Booster Box', value: 'Duskmourn Play Booster Box' },
    ]);
    // Casing, padding and punctuation are normalized away on both sides.
    expect(autocompleteSealedProducts('  BLOOMBURROW   Bundle!  ')).toEqual([
      { name: 'Bloomburrow Bundle', value: 'Bloomburrow Bundle' },
    ]);
  });

  it('scopes results to setCode when given', () => {
    expect(autocompleteSealedProducts('booster box', 'DSK')).toEqual([
      { name: 'Duskmourn Play Booster Box', value: 'Duskmourn Play Booster Box' },
    ]);
    expect(autocompleteSealedProducts('booster box', 'dsk')).toHaveLength(1);
    expect(autocompleteSealedProducts('bloomburrow', 'DSK')).toEqual([]);
  });

  it('caps results at 25 choices', () => {
    seedProducts(
      Array.from({ length: 40 }, (_, i) => ({
        uuid: `bulk-${String(i).padStart(3, '0')}`,
        name: `Bulk Booster Box ${String(i).padStart(3, '0')}`,
        nameNormalized: `bulk booster box ${String(i).padStart(3, '0')}`,
      })),
    );
    expect(autocompleteSealedProducts('booster box')).toHaveLength(25);
  });
});

describe('autocompleteSealedSets', () => {
  beforeEach(() => {
    seedProducts([
      { uuid: 'a', name: 'Bloomburrow Bundle', setCode: 'BLB' },
      { uuid: 'b', name: 'Bloomburrow Collector Booster Box', setCode: 'BLB' },
      { uuid: 'c', name: 'Duskmourn Play Booster Box', setCode: 'DSK' },
      { uuid: 'd', name: 'Bloomburrow Jumpstart Booster', setCode: 'BLC' },
    ]);
  });

  it('returns distinct set codes', () => {
    expect(autocompleteSealedSets('')).toEqual([
      { name: 'BLB', value: 'BLB' },
      { name: 'BLC', value: 'BLC' },
      { name: 'DSK', value: 'DSK' },
    ]);
  });

  it('prefix-filters case-insensitively', () => {
    expect(autocompleteSealedSets('bl')).toEqual([
      { name: 'BLB', value: 'BLB' },
      { name: 'BLC', value: 'BLC' },
    ]);
    expect(autocompleteSealedSets('dsk')).toEqual([{ name: 'DSK', value: 'DSK' }]);
    expect(autocompleteSealedSets('zz')).toEqual([]);
  });

  it('caps results at 25 set codes', () => {
    seedProducts(
      Array.from({ length: 40 }, (_, i) => ({
        uuid: `bulk-${String(i).padStart(3, '0')}`,
        name: `Bulk Product ${i}`,
        setCode: `X${String(i).padStart(2, '0')}`,
      })),
    );
    expect(autocompleteSealedSets('')).toHaveLength(25);
  });
});

describe('resolveSealedProduct', () => {
  beforeEach(() => {
    seedProducts([
      {
        uuid: 'uuid-blb-bundle',
        name: 'Bloomburrow Bundle',
        nameNormalized: 'bloomburrow bundle',
        setCode: 'BLB',
        category: 'bundle',
        subtype: 'default',
      },
    ]);
  });

  it('resolves an exact normalized match and folds in the Mana Pool URL', async () => {
    manapool.mockResolvedValue('https://manapool.com/sealed/blb/bundle');

    const result = await resolveSealedProduct('  bloomburrow   bundle  ');

    expect(result).toEqual({
      productName: 'Bloomburrow Bundle',
      productNameNormalized: 'bloomburrow bundle',
      setCode: 'BLB',
      uuid: 'uuid-blb-bundle',
      category: 'bundle',
      subtype: 'default',
      manapoolUrl: 'https://manapool.com/sealed/blb/bundle',
      resolved: true,
    });
    expect(manapool).toHaveBeenCalledWith('uuid-blb-bundle');
    // Regression guard for the no-price override: nothing price-shaped is carried.
    expect(Object.keys(result)).not.toContain('priceCents');
    expect(Object.keys(result)).not.toContain('lowPrice');
  });

  it('still resolves when Mana Pool returns no link', async () => {
    manapool.mockResolvedValue(null);
    await expect(resolveSealedProduct('Bloomburrow Bundle')).resolves.toMatchObject({
      manapoolUrl: null,
      resolved: true,
    });
  });

  it('scopes the match by setCode', async () => {
    await expect(
      resolveSealedProduct('Bloomburrow Bundle', { setCode: 'blb' }),
    ).resolves.toMatchObject({ resolved: true, uuid: 'uuid-blb-bundle' });
    manapool.mockClear();

    const mismatched = await resolveSealedProduct('Bloomburrow Bundle', { setCode: 'DSK' });
    expect(mismatched.resolved).toBe(false);
    expect(mismatched.uuid).toBeNull();
    expect(mismatched.setCode).toBe('DSK');
    expect(manapool).not.toHaveBeenCalled();
  });

  it('returns a free-text result and makes no Mana Pool call on a miss', async () => {
    const result = await resolveSealedProduct('Some Homemade Bulk Lot');

    expect(result).toEqual({
      productName: 'Some Homemade Bulk Lot',
      productNameNormalized: 'some homemade bulk lot',
      setCode: null,
      uuid: null,
      category: null,
      subtype: null,
      manapoolUrl: null,
      resolved: false,
    });
    expect(manapool).not.toHaveBeenCalled();
  });

  it("keeps the caller's setCode on a miss, upper-cased, with no Mana Pool call", async () => {
    // The case the free-text fallback exists for: a brand-new product the
    // catalog has not seen yet, posted with a set the user typed.
    const result = await resolveSealedProduct('Some Brand New Bundle', { setCode: ' blb ' });

    expect(result.resolved).toBe(false);
    expect(result.setCode).toBe('BLB');
    expect(result.uuid).toBeNull();
    expect(result.category).toBeNull();
    expect(result.manapoolUrl).toBeNull();
    expect(manapool).not.toHaveBeenCalled();
  });

  it('leaves setCode null on a miss when the caller supplied none', async () => {
    await expect(resolveSealedProduct('Some Brand New Bundle')).resolves.toMatchObject({
      resolved: false,
      setCode: null,
    });
    await expect(
      resolveSealedProduct('Some Brand New Bundle', { setCode: '   ' }),
    ).resolves.toMatchObject({ resolved: false, setCode: null });
    expect(manapool).not.toHaveBeenCalled();
  });

  it('does not treat an empty name as a catalog hit', async () => {
    const result = await resolveSealedProduct('   ');
    expect(result.resolved).toBe(false);
    expect(manapool).not.toHaveBeenCalled();
  });
});

describe('isSealedCatalogStale', () => {
  it('is stale when the catalog has never been synced', () => {
    expect(isSealedCatalogStale()).toBe(true);
  });

  it('is fresh inside the stale window', () => {
    getDb()
      .insert(sealedCatalogMeta)
      .values({ id: 1, buildVersion: 'v1', setListEtag: null, syncedAt: Date.now() - 1000 })
      .run();
    expect(isSealedCatalogStale()).toBe(false);
  });

  it('is stale once syncedAt is older than the window', () => {
    getDb()
      .insert(sealedCatalogMeta)
      .values({
        id: 1,
        buildVersion: 'v1',
        setListEtag: null,
        syncedAt: Date.now() - SEALED_CATALOG_STALE_MS - 1000,
      })
      .run();
    expect(isSealedCatalogStale()).toBe(true);
  });
});

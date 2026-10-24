import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { catalogItems, catalogSets } from '../../src/db/schema.js';
import {
  catalogPickId,
  catalogSearchTarget,
  findCatalogEntry,
  resolveCatalogCard,
  searchCatalogItems,
  searchCatalogSets,
} from '../../src/services/catalog.js';
import { setupTestDb } from '../helpers/db.js';
import { itemRow, POKEMON, seedPokemonCatalog, setRow } from '../helpers/catalog.js';

setupTestDb();

beforeEach(() => {
  seedPokemonCatalog();
});

const values = (choices: Array<{ value: string }>) => choices.map((choice) => choice.value);
const names = (choices: Array<{ name: string }>) => choices.map((choice) => choice.name);
const search = (query: string, language?: Parameters<typeof searchCatalogItems>[3]) =>
  searchCatalogItems(POKEMON, 'card', query, language);

describe('catalogPickId', () => {
  it('reads the id out of a picked suggestion, and nothing else', () => {
    expect(catalogPickId('id:501256')).toBe('501256');
    expect(catalogPickId(' id:501256 ')).toBe('501256');
    expect(catalogPickId('Charizard ex')).toBeNull();
    expect(catalogPickId('id:abc')).toBeNull();
    expect(catalogPickId('id:')).toBeNull();
    expect(catalogPickId('xid:12')).toBeNull();
  });
});

describe('searchCatalogItems', () => {
  it('suggests nothing for an empty or punctuation-only query', () => {
    expect(search('')).toEqual([]);
    expect(search('   ')).toEqual([]);
    expect(search('%_')).toEqual([]);
  });

  it('matches every token somewhere in the name, set code, set name or number', () => {
    expect(values(search('pikachu obf 063'))).toEqual(['id:509881']);
    expect(values(search('charizard 125'))).toEqual(['id:509879']);
    expect(values(search('charizard mew'))).toEqual(['id:600001']);
    expect(values(search('flames full art charizard'))).toEqual(['id:509880']);
  });

  it('matches in any order, and by set code alone', () => {
    expect(values(search('063 obf pikachu'))).toEqual(['id:509881']);
    expect(search('obf').length).toBe(4);
    expect(search('obf').every((choice) => choice.name.includes('OBF'))).toBe(true);
  });

  it('suggests nothing when one token matches nothing', () => {
    expect(search('pikachu zzzz')).toEqual([]);
  });

  it('puts the newest set first and supplemental sets last, however new their date', () => {
    // Every plain "Pikachu" (an exact name match), newest ordinary set first.
    const exact = search('pikachu')
      .map((choice) => choice.value)
      .filter((value) =>
        ['id:600002', 'id:509881', 'id:900002', 'id:900001', 'id:700001'].includes(value),
      );
    // MEW (2023-09), OBF (2023-08), XY Promos (2014), League (2010); the
    // supplemental MCAP set is dated 2026 but still comes last of them.
    expect(exact).toEqual(['id:600002', 'id:509881', 'id:900002', 'id:900001', 'id:700001']);
  });

  it('puts the name closest to the query first, ahead of a newer set’s longer name', () => {
    getDb()
      .insert(catalogItems)
      .values(itemRow({ id: '888', name: 'Mega Charizard X ex', setId: '23229', number: '125' }))
      .run();
    const order = values(search('charizard ex 125'));
    // MEW is newer than OBF, but "Charizard ex" is the shorter, closer name.
    expect(order[0]).toBe('id:509879');
    expect(order).toContain('id:888');
  });

  it('puts English before Japanese when no language was chosen, even from an older set', () => {
    getDb()
      .insert(catalogSets)
      .values(
        setRow({
          id: '23999',
          language: 'ja',
          name: 'Newest Japanese Set',
          code: 'NJS',
          releaseDate: '2026-09-01',
        }),
      )
      .run();
    getDb()
      .insert(catalogItems)
      .values(
        itemRow({ id: '999001', name: 'Pikachu', setId: '23999', language: 'ja', number: '1' }),
      )
      .run();
    const order = values(search('pikachu'));
    expect(order.indexOf('id:900001')).toBeLessThan(order.indexOf('id:999001'));
    // Asked for Japanese, the newest Japanese set is first.
    expect(values(search('pikachu', 'ja'))[0]).toBe('id:999001');
  });

  it('puts an exact name before a longer one from a newer set', () => {
    const order = values(search('pikachu'));
    expect(order.indexOf('id:509881')).toBeLessThan(order.indexOf('id:600005'));
  });

  it('labels a choice with its set code and number, and carries the id in the value', () => {
    expect(search('charizard 125')).toEqual([
      { name: 'Charizard ex · OBF 125', value: 'id:509879' },
    ]);
  });

  it('marks a Japanese card, and a set with no code shows its name cut to fit', () => {
    expect(names(search('charizard sv3'))).toEqual(['Charizard ex · SV3 134 · JA']);
    expect(names(search('morpeko'))).toEqual(["Marnie's Morpeko · EX STARTER 001"]);
  });

  it('keeps a long name within Discord’s 100 characters', () => {
    getDb()
      .insert(catalogItems)
      .values(
        itemRow({
          id: '999',
          name: `Pikachu ${'very long '.repeat(15)}`,
          setId: '23228',
          number: '7',
        }),
      )
      .run();
    const choice = search('pikachu very long')[0];
    expect(choice?.name.length).toBeLessThanOrEqual(100);
    expect(choice?.name.endsWith('· OBF 7')).toBe(true);
    expect(choice?.name).toContain('…');
  });

  it('never returns more than the 25 choices Discord accepts', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      itemRow({
        id: String(2000 + index),
        name: `Bulk Card ${index}`,
        setId: '23228',
        number: String(index),
      }),
    );
    getDb().insert(catalogItems).values(many).run();
    expect(search('bulk card')).toHaveLength(25);
  });

  it('keeps the two Nidoran apart: the sign picks which comes first', () => {
    expect(values(search('nidoran')).sort()).toEqual(['id:600003', 'id:600004']);
    // A lone `m` also matches the MEW set code, so the other Nidoran can still
    // be listed, but behind the one whose own name matches.
    expect(values(search('nidoran♀'))[0]).toBe('id:600003');
    expect(values(search('nidoran♂'))[0]).toBe('id:600004');
  });

  it('ranks a card whose name has every token ahead of one that matches only in its set', () => {
    getDb()
      .insert(catalogItems)
      .values(itemRow({ id: '777', name: 'Mew ex', setId: '23229', number: '151' }))
      .run();
    const order = values(search('mew'));
    expect(order[0]).toBe('id:777');
  });

  it('answers only for the kind asked', () => {
    expect(values(searchCatalogItems(POKEMON, 'sealed', 'flames'))).toEqual(['id:501256']);
    expect(values(search('booster'))).toEqual([]);
  });

  it('answers only for the game asked', () => {
    expect(searchCatalogItems('other-game', 'card', 'pikachu')).toEqual([]);
  });

  describe('narrowed by language', () => {
    const english = ['id:509879', 'id:509880', 'id:600001'];

    it('shows both languages when none was chosen', () => {
      expect(values(search('charizard')).sort()).toEqual([...english, 'id:520002'].sort());
    });

    it('shows only Japanese for ja, and only English for en', () => {
      expect(values(search('charizard', 'ja'))).toEqual(['id:520002']);
      expect(values(search('charizard', 'en')).sort()).toEqual(english);
    });

    it('treats any other language as the English product', () => {
      expect(values(search('charizard', 'de')).sort()).toEqual(english);
      expect(values(search('pikachu japan', 'fr'))).toEqual([]);
    });
  });
});

describe('searchCatalogSets', () => {
  const sets = (query: string, kind: 'card' | 'sealed' = 'card') =>
    searchCatalogSets(POKEMON, kind, query);

  it('lists the newest sets for an empty query, supplemental last', () => {
    const list = values(sets(''));
    expect(list[0]).toBe('id:23500');
    expect(list.at(-1)).toBe('id:100');
  });

  it('matches by code or name', () => {
    expect(values(sets('obf'))).toEqual(['id:23228']);
    expect(values(sets('obsidian'))).toEqual(['id:23228']);
    expect(values(sets('black flame'))).toEqual(['id:23400']);
  });

  it('labels a set with its code, marks Japanese, and carries the id', () => {
    expect(sets('obf')).toEqual([{ name: 'Obsidian Flames (OBF)', value: 'id:23228' }]);
    expect(names(sets('sv3'))).toEqual(['Ruler of the Black Flame (SV3 · JA)']);
  });

  it('lists each of two sets that share a code, by id', () => {
    expect(values(sets('pr'))).toEqual(expect.arrayContaining(['id:31', 'id:32']));
    expect(names(sets('league'))).toEqual(['League & Championship Cards (PR)']);
    expect(names(sets('xy promos'))).toEqual(['XY Promos (PR)']);
  });

  it('offers a set with no code under its name cut to fit', () => {
    expect(names(sets('starter'))[0]).toMatch(/\(EX STARTER\)$/);
  });

  it('lists only sets that have a product of the kind asked for', () => {
    expect(values(sets('sealed only'))).toEqual([]);
    expect(values(sets('sealed only', 'sealed'))).toEqual(['id:23600']);
    expect(values(sets('obf', 'sealed'))).toEqual(['id:23228']);
    expect(values(sets('mew', 'sealed'))).toEqual([]);
  });
});

describe('findCatalogEntry', () => {
  it('finds a product by id, with its set’s label', () => {
    expect(findCatalogEntry(POKEMON, 'card', '509879')).toMatchObject({
      id: '509879',
      name: 'Charizard ex',
      number: '125',
      language: 'en',
      setLabel: 'OBF',
    });
  });

  it('does not find a product of the other kind, or an unknown id', () => {
    expect(findCatalogEntry(POKEMON, 'card', '501256')).toBeUndefined();
    expect(findCatalogEntry(POKEMON, 'sealed', '501256')).toBeDefined();
    expect(findCatalogEntry(POKEMON, 'card', '1')).toBeUndefined();
  });
});

describe('resolveCatalogCard with a picked suggestion', () => {
  it('resolves to exactly that product, with its link, image and catalog id', () => {
    expect(resolveCatalogCard(POKEMON, 'id:509879')).toEqual({
      cardName: 'Charizard ex',
      cardNameNormalized: 'charizard ex',
      cardSet: 'OBF',
      cardImageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/509879_200w.jpg',
      collectorNumber: '125',
      marketUrl: 'https://www.tcgplayer.com/product/509879',
      catalogId: '509879',
      language: null,
      resolved: true,
    });
  });

  it('keeps a printing qualifier in the name but searches by the base name', () => {
    expect(resolveCatalogCard(POKEMON, 'id:509880')).toMatchObject({
      cardName: 'Charizard ex (Full Art)',
      cardNameNormalized: 'charizard ex',
    });
  });

  it('fixes the language for a Japanese product, and leaves an English one open', () => {
    expect(resolveCatalogCard(POKEMON, 'id:520002').language).toBe('ja');
    expect(resolveCatalogCard(POKEMON, 'id:509879').language).toBeNull();
  });

  it('ignores the other options, since the pick already names the product', () => {
    expect(
      resolveCatalogCard(POKEMON, 'id:509879', { cardSet: 'MEW', collectorNumber: '999' }),
    ).toMatchObject({ resolved: true, catalogId: '509879' });
  });

  it('is unresolved for an id that is not a card, or not there', () => {
    expect(resolveCatalogCard(POKEMON, 'id:501256').resolved).toBe(false);
    expect(resolveCatalogCard(POKEMON, 'id:424242').resolved).toBe(false);
  });
});

describe('resolveCatalogCard with a typed name', () => {
  const resolve = (name: string, options: Parameters<typeof resolveCatalogCard>[2] = {}) =>
    resolveCatalogCard(POKEMON, name, options);

  it('prefers the newest English printing when nothing narrows it', () => {
    expect(resolve('Charizard ex')).toMatchObject({ catalogId: '600001', cardSet: 'MEW' });
  });

  it('is case- and punctuation-insensitive', () => {
    expect(resolve('  CHARIZARD   ex ').catalogId).toBe('600001');
    expect(resolve('nidoran♀').catalogId).toBe('600003');
    expect(resolve('Nidoran M').catalogId).toBe('600004');
  });

  it('narrows by a typed set code, a set name, a name prefix, or a picked set', () => {
    expect(resolve('Charizard ex', { cardSet: 'OBF' }).catalogId).toBe('509879');
    expect(resolve('Charizard ex', { cardSet: 'obf' }).catalogId).toBe('509879');
    expect(resolve('Charizard ex', { cardSet: 'Obsidian Flames' }).catalogId).toBe('509879');
    expect(resolve('Charizard ex', { cardSet: 'obsidian' }).catalogId).toBe('509879');
    expect(resolve('Charizard ex', { cardSet: 'id:23228' }).catalogId).toBe('509879');
  });

  it('finds a card in a set with no code by the name it shows', () => {
    expect(resolve("Marnie's Morpeko", { cardSet: 'EX STARTER' }).catalogId).toBe('800001');
  });

  it('resolves a card in a set whose code another set shares', () => {
    expect(resolve('Pikachu', { cardSet: 'PR' }).resolved).toBe(true);
    expect(['900001', '900002']).toContain(resolve('Pikachu', { cardSet: 'PR' }).catalogId);
  });

  it('narrows by collector number, ignoring leading zeros', () => {
    expect(resolve('Charizard ex', { collectorNumber: '125' }).catalogId).toBe('509879');
    expect(resolve('Charizard ex', { collectorNumber: '6' }).catalogId).toBe('600001');
    expect(resolve('Charizard ex', { collectorNumber: '006' }).catalogId).toBe('600001');
    expect(resolve('Charizard ex', { cardSet: 'OBF', collectorNumber: '6' }).resolved).toBe(false);
  });

  it('narrows by language, and falls to Japan only for a card that exists only there', () => {
    expect(resolve('Charizard ex', { language: 'ja' })).toMatchObject({
      catalogId: '520002',
      language: 'ja',
    });
    expect(resolve('Charizard ex', { language: 'en' }).language).toBeNull();
    expect(resolve('Charizard ex', { language: 'de' }).catalogId).toBe('600001');
    expect(resolve('Pikachu Only In Japan')).toMatchObject({ catalogId: '520003', language: 'ja' });
    expect(resolve('Pikachu Only In Japan', { language: 'en' }).resolved).toBe(false);
  });

  it('matches a card that only exists with a printing qualifier by its base name', () => {
    expect(resolve('Gholdengo ex')).toMatchObject({
      catalogId: '910001',
      cardName: 'Gholdengo ex (Full Art)',
      cardNameNormalized: 'gholdengo ex',
    });
  });

  it('prefers the exact full name when both a plain and a qualified printing match', () => {
    expect(resolve('Charizard ex (Full Art)').catalogId).toBe('509880');
    expect(resolve('Charizard ex', { cardSet: 'OBF' }).catalogId).toBe('509879');
  });

  it('never resolves to sealed product', () => {
    expect(resolve('Obsidian Flames Booster Pack').resolved).toBe(false);
  });

  it('is unresolved, not an error, for anything it cannot find', () => {
    const missing = resolve('Not A Card', { cardSet: 'OBF' });
    expect(missing).toMatchObject({
      resolved: false,
      cardName: 'Not A Card',
      cardNameNormalized: 'not a card',
      cardSet: 'OBF',
      marketUrl: null,
    });
    expect(resolve('').resolved).toBe(false);
    expect(resolve('   ').resolved).toBe(false);
    expect(resolve('Charizard ex', { cardSet: 'NOPE' }).resolved).toBe(false);
  });

  it('does not echo a picked set id back as the set of an unresolved card', () => {
    expect(resolve('Not A Card', { cardSet: 'id:23228' }).cardSet).toBeNull();
  });

  it('is not fooled by wildcard characters in a typed set', () => {
    expect(resolve('Charizard ex', { cardSet: '%' }).resolved).toBe(false);
    expect(resolve('Charizard ex', { cardSet: '_' }).resolved).toBe(false);
  });
});

describe('catalogSearchTarget', () => {
  it('names a picked card by its base name, so a search finds every printing', () => {
    expect(catalogSearchTarget(POKEMON, 'id:509880')).toEqual({
      displayName: 'Charizard ex',
      searchKey: 'charizard ex',
    });
  });

  it('normalizes a name that was typed', () => {
    expect(catalogSearchTarget(POKEMON, ' Nidoran♀ ')).toEqual({
      displayName: 'Nidoran♀',
      searchKey: 'nidoran f',
    });
  });

  it('is null for a pick that is no longer in the catalog', () => {
    expect(catalogSearchTarget(POKEMON, 'id:424242')).toBeNull();
  });
});

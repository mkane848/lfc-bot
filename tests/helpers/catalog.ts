import { getDb } from '../../src/db/index.js';
import { catalogItems, catalogSets } from '../../src/db/schema.js';
import type { NewCatalogItemRow, NewCatalogSetRow } from '../../src/db/schema.js';
import { baseProductName } from '../../src/utils/catalog-names.js';
import { normalizeCardName } from '../../src/utils/validation.js';

export const POKEMON = 'pokemon';

export function setRow(overrides: Partial<NewCatalogSetRow> & { id: string }): NewCatalogSetRow {
  return {
    game: POKEMON,
    language: 'en',
    name: 'A Set',
    code: '',
    releaseDate: '2023-01-01',
    supplemental: 0,
    etag: null,
    updatedAt: 1,
    ...overrides,
  };
}

export function itemRow(
  overrides: Partial<NewCatalogItemRow> & { id: string; name: string; setId: string },
): NewCatalogItemRow {
  return {
    game: POKEMON,
    kind: 'card',
    language: 'en',
    number: null,
    category: null,
    updatedAt: 1,
    nameNormalized: normalizeCardName(overrides.name),
    baseNormalized: normalizeCardName(baseProductName(overrides.name)),
    ...overrides,
  };
}

/**
 * A small Pokémon catalog with the cases that make this data awkward: a
 * printing qualifier, two printings of one number, English and Japanese rows
 * for one card, a set with no code, a supplemental set with the newest date,
 * two sets that share a code, and the two Nidorans.
 */
export function seedPokemonCatalog(): void {
  const db = getDb();
  db.insert(catalogSets)
    .values([
      setRow({ id: '23228', name: 'Obsidian Flames', code: 'OBF', releaseDate: '2023-08-11' }),
      setRow({ id: '23229', name: '151', code: 'MEW', releaseDate: '2023-09-22' }),
      setRow({
        id: '100',
        name: 'Miscellaneous Cards & Products',
        code: 'MCAP',
        releaseDate: '2026-10-23',
        supplemental: 1,
      }),
      setRow({
        id: '23400',
        language: 'ja',
        name: 'Ruler of the Black Flame',
        code: 'SV3',
        releaseDate: '2023-07-28',
      }),
      setRow({
        id: '23500',
        name: "ex Starter Set Marnie's Morpeko & Grimmsnarl ex",
        code: '',
        releaseDate: '2024-01-01',
      }),
      setRow({
        id: '31',
        name: 'League & Championship Cards',
        code: 'PR',
        releaseDate: '2010-01-01',
      }),
      setRow({ id: '32', name: 'XY Promos', code: 'PR', releaseDate: '2014-01-01' }),
      setRow({ id: '23600', name: 'Sealed Only Set', code: 'SOS', releaseDate: '2024-06-01' }),
    ])
    .run();

  db.insert(catalogItems)
    .values([
      itemRow({ id: '509879', name: 'Charizard ex', setId: '23228', number: '125' }),
      itemRow({ id: '509880', name: 'Charizard ex (Full Art)', setId: '23228', number: '223' }),
      itemRow({ id: '600001', name: 'Charizard ex', setId: '23229', number: '006' }),
      itemRow({ id: '509881', name: 'Pikachu', setId: '23228', number: '063' }),
      itemRow({ id: '600002', name: 'Pikachu', setId: '23229', number: '025' }),
      itemRow({ id: '600005', name: 'Pikachu & Zekrom GX', setId: '23229', number: '033' }),
      itemRow({ id: '700001', name: 'Pikachu', setId: '100', number: '1' }),
      itemRow({ id: '600003', name: 'Nidoran F', setId: '23229', number: '029' }),
      itemRow({ id: '600004', name: 'Nidoran M', setId: '23229', number: '032' }),
      itemRow({
        id: '520002',
        name: 'Charizard ex',
        setId: '23400',
        language: 'ja',
        number: '134',
      }),
      itemRow({
        id: '520003',
        name: 'Pikachu Only In Japan',
        setId: '23400',
        language: 'ja',
        number: '007',
      }),
      itemRow({ id: '800001', name: "Marnie's Morpeko", setId: '23500', number: '001' }),
      itemRow({ id: '900001', name: 'Pikachu', setId: '31', number: 'SM05' }),
      itemRow({ id: '900002', name: 'Pikachu', setId: '32', number: 'XY05' }),
      // Only a qualified printing exists in this set.
      itemRow({ id: '910001', name: 'Gholdengo ex (Full Art)', setId: '23228', number: '224' }),
      // Sealed product shares the table but is never a card.
      itemRow({
        id: '501256',
        name: 'Obsidian Flames Booster Pack',
        setId: '23228',
        kind: 'sealed',
      }),
      itemRow({
        id: '520001',
        name: 'Ruler of the Black Flame Booster Box',
        setId: '23400',
        language: 'ja',
        kind: 'sealed',
      }),
      itemRow({ id: '930001', name: 'Sealed Only Box', setId: '23600', kind: 'sealed' }),
    ])
    .run();
}

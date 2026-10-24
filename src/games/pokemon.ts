import {
  catalogPickId,
  catalogSearchTarget,
  resolveCatalogCard,
  searchCatalogItems,
  searchCatalogSets,
} from '../services/catalog.js';
import { isCatalogSyncStale, POKEMON_GAME_ID, syncPokemonCatalog } from '../services/tcgcsv.js';
import type { GameDefinition } from './types.js';

/**
 * Pokémon. Singles come from the local catalog a daily TCGCSV sync keeps
 * (`src/services/tcgcsv.ts`), so every suggestion and lookup is a local query
 * and posting never waits on a network call. Links go to TCGplayer, from the
 * product id every catalog row has.
 *
 * Sealed product is in the same catalog but isn't offered yet (`kinds`), so
 * the sealed commands tell a member so rather than posting free text.
 */
export const pokemonGame: GameDefinition = {
  id: POKEMON_GAME_ID,
  tag: 'pkm',
  label: 'Pokémon',
  shortLabel: 'Pokémon',
  marketLabel: 'TCGplayer',
  kinds: ['card'],
  // Reverse holo is a Pokémon finish; "holo" is Magic's foil. Etched is Magic's.
  finishes: ['nonfoil', 'foil', 'reverse'],
  supportsVariant: false,
  catalog: {
    sync: () => syncPokemonCatalog(),
    isStale: () => isCatalogSyncStale(),
  },

  autocompleteItems: (kind, query, context) =>
    Promise.resolve(searchCatalogItems(POKEMON_GAME_ID, kind, query, context.language)),

  autocompleteSets: (kind, query) =>
    Promise.resolve(searchCatalogSets(POKEMON_GAME_ID, kind, query)),

  resolveCard: (name, options) =>
    Promise.resolve(resolveCatalogCard(POKEMON_GAME_ID, name, options)),

  resolveSealed: (name) =>
    // Not reachable while `kinds` leaves sealed out; it fails loudly rather than posting nothing.
    Promise.reject(new Error(`Pokémon sealed product is not available (${name}).`)),

  isCatalogPick: (_kind, value) => catalogPickId(value) !== null,

  searchTarget: (value) => catalogSearchTarget(POKEMON_GAME_ID, value),

  // Every catalog entry carries its link; a listing without one has no entry to link to.
  fallbackMarketUrl: () => null,
};

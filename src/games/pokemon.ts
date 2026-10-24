import {
  catalogPickId,
  catalogSearchTarget,
  resolveCatalogCard,
  resolveCatalogSealed,
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
 * Sealed product comes from the same catalog and sync: a product with no
 * collector number is sealed unless its name says it is an older single
 * (`classifyProduct`), and it is filed under a category such as Elite Trainer
 * Box. Digital code cards are not kept.
 */
export const pokemonGame: GameDefinition = {
  id: POKEMON_GAME_ID,
  tag: 'pkm',
  label: 'Pokémon',
  shortLabel: 'Pokémon',
  marketLabel: 'TCGplayer',
  kinds: ['card', 'sealed'],
  // Reverse holo is a Pokémon finish; "holo" is Magic's foil. Etched is Magic's.
  finishes: ['nonfoil', 'foil', 'reverse'],
  supportsVariant: false,
  catalog: {
    sync: () => syncPokemonCatalog(),
    isStale: () => isCatalogSyncStale(),
  },

  autocompleteItems: (kind, query, context) =>
    Promise.resolve(
      searchCatalogItems(
        POKEMON_GAME_ID,
        kind,
        query,
        context.language,
        // A picked set narrows sealed product, as it does Magic's; cards are found by name.
        kind === 'sealed' ? context.setCode : null,
      ),
    ),

  autocompleteSets: (kind, query) =>
    Promise.resolve(searchCatalogSets(POKEMON_GAME_ID, kind, query)),

  resolveCard: (name, options) =>
    Promise.resolve(resolveCatalogCard(POKEMON_GAME_ID, name, options)),

  resolveSealed: (name, options) =>
    Promise.resolve(resolveCatalogSealed(POKEMON_GAME_ID, name, options)),

  isCatalogPick: (_kind, value) => catalogPickId(value) !== null,

  searchTarget: (value) => catalogSearchTarget(POKEMON_GAME_ID, value),

  // Every catalog entry carries its link; a listing without one has no entry to link to.
  fallbackMarketUrl: () => null,
};

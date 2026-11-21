import { describe, expect, it, vi } from 'vitest';
import {
  isCatalogSyncStale,
  POKEMON_GAME_ID,
  syncPokemonCatalog,
} from '../../src/services/tcgcsv.js';
import { pokemonGame } from '../../src/games/pokemon.js';

vi.mock('../../src/services/tcgcsv.js', () => ({
  POKEMON_GAME_ID: 'pkm',
  syncPokemonCatalog: vi.fn(),
  isCatalogSyncStale: vi.fn(() => true),
}));

describe('pokemonGame catalog hooks', () => {
  it('syncs through the TCGCSV catalog sync', async () => {
    await pokemonGame.catalog?.sync();

    expect(vi.mocked(syncPokemonCatalog)).toHaveBeenCalledTimes(1);
  });

  it('reports staleness from the TCGCSV sync stamp', () => {
    expect(pokemonGame.catalog?.isStale()).toBe(true);
    expect(vi.mocked(isCatalogSyncStale)).toHaveBeenCalledTimes(1);
  });

  it('is registered under the Pokémon game id', () => {
    expect(pokemonGame.id).toBe(POKEMON_GAME_ID);
  });
});

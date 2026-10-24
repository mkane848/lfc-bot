import { vi } from 'vitest';
import { listGames, registerGame, unregisterGame } from '../../src/games/index.js';
import type { GameDefinition } from '../../src/games/index.js';
import { getServerConfig, upsertServerConfig } from '../../src/services/digest-state.js';
import { normalizeCardName } from '../../src/utils/validation.js';

export const FAKE_GAME_ID = 'fake';

/**
 * A second game for tests of the multi-game paths. Only Magic ships in the
 * foundation, so anything that merges, tags or filters by game needs another
 * one registered. Every function is a mock so a test can see what was called
 * and override what comes back.
 */
export function createFakeGame(overrides: Partial<GameDefinition> = {}): GameDefinition {
  return {
    id: FAKE_GAME_ID,
    tag: 'fk',
    label: 'Fake Game',
    shortLabel: 'FKG',
    marketLabel: 'FakeMarket',
    kinds: ['card', 'sealed'],
    finishes: ['nonfoil', 'reverse'],
    supportsVariant: false,
    autocompleteItems: vi.fn<GameDefinition['autocompleteItems']>().mockResolvedValue([]),
    autocompleteSets: vi.fn<GameDefinition['autocompleteSets']>().mockResolvedValue([]),
    resolveCard: vi.fn<GameDefinition['resolveCard']>().mockResolvedValue({
      cardName: 'Fake Card',
      cardNameNormalized: 'fake card',
      cardSet: 'FK1',
      cardImageUrl: 'https://fake.example/7.png',
      collectorNumber: '7',
      marketUrl: 'https://fake.example/product/7',
      catalogId: 'fk-7',
      resolved: true,
    }),
    resolveSealed: vi.fn<GameDefinition['resolveSealed']>().mockResolvedValue({
      productName: 'Fake Box',
      productNameNormalized: 'fake box',
      setCode: 'FK1',
      uuid: 'fk-box',
      category: 'booster_box',
      subtype: null,
      marketUrl: 'https://fake.example/product/box',
      resolved: true,
    }),
    isCatalogPick: vi.fn<GameDefinition['isCatalogPick']>((_kind, value) =>
      value.startsWith('id:'),
    ),
    searchTarget: vi.fn<GameDefinition['searchTarget']>((value) => ({
      displayName: value,
      searchKey: normalizeCardName(value),
    })),
    fallbackMarketUrl: vi.fn<GameDefinition['fallbackMarketUrl']>(() => null),
    ...overrides,
  };
}

/** Register a fake game; pair with `unregisterFakeGame()` in `afterEach`. */
export function registerFakeGame(overrides: Partial<GameDefinition> = {}): GameDefinition {
  const game = createFakeGame(overrides);
  registerGame(game);
  return game;
}

export function unregisterFakeGame(): void {
  unregisterGame(FAKE_GAME_ID);
}

/**
 * Leave only `ids` registered, for a test of what happens with one game (or a
 * known pair), whatever else ships. Returns a function that puts every game
 * back in its original order; call it in `afterEach`.
 */
export function restrictGamesTo(ids: string[]): () => void {
  const saved = listGames();
  for (const game of saved) {
    if (!ids.includes(game.id)) {
      unregisterGame(game.id);
    }
  }
  return () => {
    for (const game of saved) {
      unregisterGame(game.id);
    }
    for (const game of saved) {
      registerGame(game);
    }
  };
}

/** Set which games a server has enabled, creating its config row if needed. */
export function enableGames(serverId: string, ids: string[]): void {
  upsertServerConfig({ serverId, enabledGames: ids });
}

/** The game ids stored for a server, for assertions on `/admin games`. */
export function storedGames(serverId: string): string[] {
  return JSON.parse(getServerConfig(serverId)?.enabledGames ?? '[]') as string[];
}

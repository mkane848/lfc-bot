import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { servers } from '../../src/db/schema.js';
import type { GameCatalog, GameDefinition } from '../../src/games/index.js';
import {
  refreshCatalogIfStale,
  syncEnabledGameCatalogs,
  warmUpGameCatalogs,
} from '../../src/services/game-catalogs.js';
import { setupTestDb } from '../helpers/db.js';
import {
  enableGames,
  FAKE_GAME_ID,
  registerFakeGame,
  unregisterFakeGame,
} from '../helpers/games.js';

setupTestDb();

let catalog: { sync: ReturnType<typeof vi.fn>; isStale: ReturnType<typeof vi.fn> };
let fake: GameDefinition;

beforeEach(() => {
  catalog = {
    sync: vi.fn().mockResolvedValue(undefined),
    isStale: vi.fn().mockReturnValue(true),
  };
  fake = registerFakeGame({ catalog: catalog as unknown as GameCatalog });
});

afterEach(() => {
  unregisterFakeGame();
});

describe('syncEnabledGameCatalogs', () => {
  it('syncs the catalog of a game some server has enabled', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);

    await syncEnabledGameCatalogs();

    expect(catalog.sync).toHaveBeenCalledTimes(1);
  });

  it('does not download a catalog nobody has enabled the game for', async () => {
    enableGames('guild-1', ['mtg']);

    await syncEnabledGameCatalogs();

    expect(catalog.sync).not.toHaveBeenCalled();
  });

  it('ignores a server that has been removed', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    getDb().update(servers).set({ removedAt: Date.now() }).where(eq(servers.id, 'guild-1')).run();

    await syncEnabledGameCatalogs();

    expect(catalog.sync).not.toHaveBeenCalled();
  });

  it('syncs once however many servers have the game', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    enableGames('guild-2', [FAKE_GAME_ID]);

    await syncEnabledGameCatalogs();

    expect(catalog.sync).toHaveBeenCalledTimes(1);
  });

  it('leaves alone a game with no catalog, such as Magic', async () => {
    enableGames('guild-1', ['mtg']);
    await expect(syncEnabledGameCatalogs()).resolves.toBeUndefined();
  });
});

describe('warmUpGameCatalogs', () => {
  it('starts a sync for a stale catalog in use, without waiting for it', () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    catalog.sync.mockReturnValue(new Promise(() => undefined));

    expect(() => warmUpGameCatalogs()).not.toThrow();

    expect(catalog.sync).toHaveBeenCalledTimes(1);
  });

  it('does not re-check a catalog that is fresh', () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    catalog.isStale.mockReturnValue(false);

    warmUpGameCatalogs();

    expect(catalog.sync).not.toHaveBeenCalled();
  });

  it('does not start one for a game nobody has enabled', () => {
    enableGames('guild-1', ['mtg']);

    warmUpGameCatalogs();

    expect(catalog.isStale).not.toHaveBeenCalled();
    expect(catalog.sync).not.toHaveBeenCalled();
  });

  it('survives a rejected sync without an unhandled rejection', async () => {
    enableGames('guild-1', ['mtg', FAKE_GAME_ID]);
    catalog.sync.mockRejectedValue(new Error('tcgcsv unreachable'));
    const unhandled = vi.fn();
    process.once('unhandledRejection', unhandled);

    expect(() => warmUpGameCatalogs()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });
});

describe('refreshCatalogIfStale', () => {
  it('starts a sync and says so when the catalog is stale', () => {
    expect(refreshCatalogIfStale(fake)).toBe(true);
    expect(catalog.sync).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the catalog is fresh', () => {
    catalog.isStale.mockReturnValue(false);

    expect(refreshCatalogIfStale(fake)).toBe(false);
    expect(catalog.sync).not.toHaveBeenCalled();
  });

  it('does nothing for a game that has no catalog', () => {
    unregisterFakeGame();
    const plain = registerFakeGame();
    expect(refreshCatalogIfStale(plain)).toBe(false);
  });

  it('swallows a failed sync instead of raising an unhandled rejection', async () => {
    catalog.sync.mockRejectedValue(new Error('boom'));
    const unhandled = vi.fn();
    process.once('unhandledRejection', unhandled);

    refreshCatalogIfStale(fake);
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });
});

import { isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { servers } from '../db/schema.js';
import { listGames, parseEnabledGames } from '../games/index.js';
import type { GameDefinition } from '../games/index.js';
import { getLogger } from '../utils/logger.js';

/**
 * Keeps the catalogs of games that have one (`GameDefinition.catalog`) fresh.
 * A catalog is only synced while some server has its game enabled: Pokémon's is
 * a 74 MB first download, and an instance nobody plays Pokémon on has no use
 * for it.
 */

/** Ids of the games at least one live server has enabled. */
function gamesEnabledSomewhere(): Set<string> {
  const rows = getDb()
    .select({ enabledGames: servers.enabledGames })
    .from(servers)
    .where(isNull(servers.removedAt))
    .all();
  return new Set(rows.flatMap((row) => parseEnabledGames(row.enabledGames)));
}

/** Registered games with a catalog that some server has enabled. */
function catalogGamesInUse(): GameDefinition[] {
  const enabled = gamesEnabledSomewhere();
  return listGames().filter((game) => game.catalog && enabled.has(game.id));
}

/** Sync every catalog in use, one after another. Called by the daily job. */
export async function syncEnabledGameCatalogs(): Promise<void> {
  for (const game of catalogGamesInUse()) {
    await game.catalog?.sync();
  }
}

/**
 * Boot warm-up: start a sync, without waiting for it, for each catalog in use
 * that was never synced or hasn't been confirmed current for a day, so a
 * restart doesn't re-check a catalog that is fresh. Boot must not block on it,
 * and a failure here must never become an unhandled rejection.
 */
export function warmUpGameCatalogs(): void {
  const logger = getLogger();
  for (const game of catalogGamesInUse()) {
    if (game.catalog?.isStale()) {
      void game.catalog.sync().catch((err: unknown) => {
        logger.error({ err, game: game.id }, 'Game catalog warm-up sync failed');
      });
    }
  }
}

/**
 * Called when a server enables a game: if its catalog is missing or stale,
 * start a sync in the background so suggestions fill in without waiting for
 * the next daily run. Returns whether one was started.
 */
export function refreshCatalogIfStale(game: GameDefinition): boolean {
  if (!game.catalog?.isStale()) {
    return false;
  }
  const logger = getLogger();
  void game.catalog.sync().catch((err: unknown) => {
    logger.error({ err, game: game.id }, 'Game catalog sync after enabling failed');
  });
  return true;
}

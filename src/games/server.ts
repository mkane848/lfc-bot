import { getServerConfig } from '../services/digest-state.js';
import { DEFAULT_GAME_ID, getGame } from './registry.js';
import type { GameDefinition } from './types.js';

/** Read a `servers.enabled_games` JSON array, ignoring anything that isn't a list of strings. */
export function parseEnabledGames(json: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(json || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * The enabled games in a `servers.enabled_games` value, in the order they were
 * enabled, so the first is the one a command uses when the member names none.
 * Games no longer registered are dropped, and a server with none left (or no
 * row yet) has the default game, so the bot never ends up with nothing to post.
 */
export function enabledGameIdsFromConfig(json: string | null | undefined): string[] {
  const ids = parseEnabledGames(json).filter((id) => getGame(id) !== undefined);
  return ids.length > 0 ? ids : [DEFAULT_GAME_ID];
}

export function enabledGameIds(serverId: string): string[] {
  return enabledGameIdsFromConfig(getServerConfig(serverId)?.enabledGames);
}

export function enabledGames(serverId: string): GameDefinition[] {
  return enabledGameIds(serverId).flatMap((id) => {
    const game = getGame(id);
    return game ? [game] : [];
  });
}

/** Whether a server has more than one game, which is when listings carry a game tag. */
export function hasMultipleGames(serverId: string): boolean {
  return enabledGameIds(serverId).length > 1;
}

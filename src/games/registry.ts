import type { GameDefinition } from './types.js';

/** The game a server has when nobody has configured one: Magic, as before multi-game support. */
export const DEFAULT_GAME_ID = 'mtg';

const registry = new Map<string, GameDefinition>();

/** Add (or replace) a game. Registration order is the order games are listed in. */
export function registerGame(game: GameDefinition): void {
  registry.set(game.id, game);
}

/** Remove a game. Only tests need this, to put the registry back after adding a fake. */
export function unregisterGame(id: string): void {
  registry.delete(id);
}

export function getGame(id: string): GameDefinition | undefined {
  return registry.get(id);
}

export function listGames(): GameDefinition[] {
  return [...registry.values()];
}

export function isGameId(value: string): boolean {
  return registry.has(value);
}

import { getGame, listGames } from './registry.js';
import { enabledGames } from './server.js';
import type { AutocompleteChoice, GameDefinition } from './types.js';

/** Discord caps an autocomplete choice's name and value at 100 characters. */
const CHOICE_MAX_LENGTH = 100;

/**
 * Tag an autocomplete choice with its game so a pick says which game it came
 * from. A server with several games shows one merged list; the value is the
 * only thing that reaches the command, so the game has to ride in it
 * (`mtg:Black Lotus`). The label gets the game's short name to tell
 * same-named cards apart. Returns null for a choice that won't fit Discord's cap.
 */
export function tagChoice(
  game: GameDefinition,
  choice: AutocompleteChoice,
): AutocompleteChoice | null {
  const value = `${game.tag}:${choice.value}`;
  if (value.length > CHOICE_MAX_LENGTH) {
    return null;
  }
  const suffix = ` · ${game.shortLabel}`;
  const room = CHOICE_MAX_LENGTH - suffix.length;
  const shown = choice.name.length > room ? `${choice.name.slice(0, room - 1)}…` : choice.name;
  return { name: `${shown}${suffix}`, value };
}

/** The game and payload inside a tagged autocomplete value, or null for an untagged value. */
export function splitGameTag(value: string): { game: GameDefinition; payload: string } | null {
  for (const game of listGames()) {
    const prefix = `${game.tag}:`;
    if (value.startsWith(prefix)) {
      return { game, payload: value.slice(prefix.length) };
    }
  }
  return null;
}

export type GameResolution =
  { ok: true; game: GameDefinition; value: string } | { ok: false; message: string };

/**
 * Decide which game a command is for. In order: a picked suggestion's tag, then
 * the `game` option, then the server's first enabled game. The game must be
 * enabled on the server. `value` comes back without its tag.
 */
export function resolveGameForValue(input: {
  serverId: string;
  value: string;
  gameOption?: string | null;
}): GameResolution {
  const enabled = enabledGames(input.serverId);
  const tagged = splitGameTag(input.value);
  let game: GameDefinition | undefined;
  let value = input.value;
  if (tagged) {
    game = tagged.game;
    value = tagged.payload;
  } else if (input.gameOption) {
    game = getGame(input.gameOption);
    if (!game) {
      return { ok: false, message: 'Unknown game.' };
    }
  } else {
    game = enabled[0];
  }
  if (!game || !enabled.some((candidate) => candidate.id === game.id)) {
    const names = enabled.map((candidate) => candidate.label).join(', ');
    return {
      ok: false,
      message: `${game?.label ?? 'That game'} is not enabled on this server. Enabled: ${names}. A server admin can change this with /admin games.`,
    };
  }
  return { ok: true, game, value };
}

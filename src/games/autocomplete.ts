import type { AutocompleteInteraction } from 'discord.js';
import type { ListingKind } from '../types/index.js';
import { DEFAULT_GAME_ID, getGame } from './registry.js';
import { resolveGameForValue, tagChoice } from './resolve.js';
import { enabledGames } from './server.js';
import type { AutocompleteChoice, GameDefinition } from './types.js';

/** Discord allows at most 25 autocomplete choices. */
const MAX_CHOICES = 25;

/**
 * Discord rejects an autocomplete response sent more than 3 seconds after the
 * interaction was created. This leaves margin for the response's own trip.
 */
const AUTOCOMPLETE_BUDGET_MS = 2500;

/** When an autocomplete response must be sent by, in epoch ms. */
export function autocompleteDeadline(interaction: AutocompleteInteraction): number {
  // The earlier of Discord's creation time and our own clock, so a local clock
  // running behind Discord's can't stretch the budget.
  return Math.min(interaction.createdTimestamp, Date.now()) + AUTOCOMPLETE_BUDGET_MS;
}

/** Resolve to the lookup's result, or `null` if `deadline` passes first. */
export async function beforeDeadline<T>(lookup: Promise<T>, deadline: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([lookup, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** The games an autocomplete should draw from: the server's, narrowed by a chosen `game`. */
function gamesFor(interaction: AutocompleteInteraction): {
  games: GameDefinition[];
  merged: boolean;
} {
  const enabled = interaction.guildId ? enabledGames(interaction.guildId) : [];
  const available = enabled.length > 0 ? enabled : defaultGames();
  const chosen = interaction.options.getString('game');
  return {
    games: chosen ? available.filter((game) => game.id === chosen) : available,
    merged: available.length > 1,
  };
}

function defaultGames(): GameDefinition[] {
  const game = getGame(DEFAULT_GAME_ID);
  return game ? [game] : [];
}

/** Interleave each game's choices so no game's suggestions crowd out another's. */
function interleave(lists: AutocompleteChoice[][]): AutocompleteChoice[] {
  const merged: AutocompleteChoice[] = [];
  for (let index = 0; merged.length < MAX_CHOICES; index++) {
    let added = false;
    for (const list of lists) {
      const choice = list[index];
      if (choice && merged.length < MAX_CHOICES) {
        merged.push(choice);
        added = true;
      }
    }
    if (!added) {
      break;
    }
  }
  return merged;
}

/**
 * Suggestions for a card or sealed-product name, drawn from every game the
 * server has enabled (or just the one picked in `game`).
 *
 * With one game enabled the choices are exactly that game's, as before. With
 * several they are merged and every value is tagged (`tagChoice`), so the pick
 * carries its game. A game too slow for Discord's window is left out of the
 * merge rather than awaited; if nothing is ready, returns `null` and the caller
 * sends no response, as Discord would reject a late one anyway.
 */
export async function autocompleteChoices(
  interaction: AutocompleteInteraction,
  kind: ListingKind,
): Promise<AutocompleteChoice[] | null> {
  const { games, merged } = gamesFor(interaction);
  const query = interaction.options.getFocused();
  const setCode = interaction.options.getString('set');
  const deadline = autocompleteDeadline(interaction);

  if (!merged) {
    const [game] = games;
    if (!game) {
      return [];
    }
    const choices = await beforeDeadline(
      game.autocompleteItems(kind, query, { deadline, setCode }),
      deadline,
    );
    return choices ? choices.slice(0, MAX_CHOICES) : null;
  }

  const results = await Promise.all(
    games.map((game) =>
      beforeDeadline(game.autocompleteItems(kind, query, { deadline, setCode }), deadline).catch(
        () => null,
      ),
    ),
  );
  if (results.every((result) => result === null)) {
    return null;
  }
  return interleave(
    results.map((result, index) => {
      const game = games[index];
      if (!game || !result) {
        return [];
      }
      return result.flatMap((choice) => {
        const tagged = tagChoice(game, choice);
        return tagged ? [tagged] : [];
      });
    }),
  );
}

/**
 * Suggestions for the `set` option. The set list belongs to one game, which is
 * the one named by `game`, else by the tag on the name already picked, else the
 * server's first. Set values are not tagged: the command resolves the same game
 * again when it runs. A set loaded too late for Discord's window still finishes
 * loading and is cached for the next keystroke.
 */
export async function autocompleteSetChoices(
  interaction: AutocompleteInteraction,
  kind: ListingKind,
): Promise<AutocompleteChoice[] | null> {
  const picked =
    interaction.options.getString('card_name') ?? interaction.options.getString('product_name');
  let game: GameDefinition | undefined;
  if (interaction.guildId) {
    const resolution = resolveGameForValue({
      serverId: interaction.guildId,
      value: picked ?? '',
      gameOption: interaction.options.getString('game'),
    });
    game = resolution.ok ? resolution.game : undefined;
  } else {
    game = getGame(DEFAULT_GAME_ID);
  }
  if (!game) {
    return [];
  }
  const choices = await beforeDeadline(
    game.autocompleteSets(kind, interaction.options.getFocused()),
    autocompleteDeadline(interaction),
  );
  return choices ? choices.slice(0, MAX_CHOICES) : null;
}

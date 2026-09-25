import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { autocompleteCards, autocompleteSets, resolveCard } from '../services/scryfall.js';
import type { ResolveCardOptions } from '../services/scryfall.js';
import type { ResolvedCard } from '../types/index.js';
import { replyError } from './replies.js';
import { normalizeCardName } from './validation.js';

/**
 * Discord rejects an autocomplete response sent more than 3 seconds after the
 * interaction was created. This leaves margin for the response's own trip.
 */
const AUTOCOMPLETE_BUDGET_MS = 2500;

/** When an autocomplete response must be sent by, in epoch ms. */
function autocompleteDeadline(interaction: AutocompleteInteraction): number {
  // The earlier of Discord's creation time and our own clock, so a local clock
  // running behind Discord's can't stretch the budget.
  return Math.min(interaction.createdTimestamp, Date.now()) + AUTOCOMPLETE_BUDGET_MS;
}

/** Resolve to the lookup's result, or `null` if `deadline` passes first. */
async function beforeDeadline<T>(lookup: Promise<T>, deadline: number): Promise<T | null> {
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

/**
 * Shared autocomplete handler for card name inputs. When Scryfall is too slow
 * for Discord's window, no response is sent: Discord would reject it anyway,
 * and the member sees "Loading options failed" and can keep typing.
 */
export async function handleCardAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused();
  const deadline = autocompleteDeadline(interaction);
  const choices = await beforeDeadline(autocompleteCards(query, deadline), deadline);
  if (!choices) {
    return;
  }
  await interaction.respond(
    choices.slice(0, 25).map((choice) => ({ name: choice, value: choice })),
  );
}

/**
 * Shared autocomplete handler for set-code inputs. The set list is cached for
 * a day, but loading it can miss Discord's window; the load still finishes
 * and caches for the next keystroke.
 */
export async function handleSetAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused();
  const choices = await beforeDeadline(autocompleteSets(query), autocompleteDeadline(interaction));
  if (!choices) {
    return;
  }
  await interaction.respond(choices);
}

/** Resolve a card for a command, returning an ephemeral error when ambiguous. */
export async function resolveCardForCommand(
  interaction: ChatInputCommandInteraction,
  cardName: string,
  options: ResolveCardOptions = {},
): Promise<ResolvedCard | null> {
  const resolved = await resolveCard(cardName, options);
  if (!resolved.resolved) {
    await replyError(
      interaction,
      'I could not resolve that card name. Try selecting a suggestion from the autocomplete, or use a more specific name.',
    );
    return null;
  }
  return resolved;
}

/** Normalize a card name for search matching. */
export function searchKey(cardName: string): string {
  return normalizeCardName(cardName);
}

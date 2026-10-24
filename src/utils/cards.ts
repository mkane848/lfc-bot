import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { autocompleteChoices, autocompleteSetChoices } from '../games/autocomplete.js';
import type { CardResolveOptions, GameDefinition } from '../games/types.js';
import type { ListingKind, ResolvedCard } from '../types/index.js';
import { replyError } from './replies.js';
import { normalizeCardName } from './validation.js';

/**
 * Respond to an autocomplete with `choices`, or send nothing when they weren't
 * ready in time: Discord would reject a late response, and the member sees
 * "Loading options failed" and can keep typing.
 */
async function respondWith(
  interaction: AutocompleteInteraction,
  choices: Array<{ name: string; value: string }> | null,
): Promise<void> {
  if (!choices) {
    return;
  }
  await interaction.respond(choices);
}

/**
 * Shared autocomplete handler for card name inputs, across the games the
 * server has enabled.
 */
export async function handleCardAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await respondWith(interaction, await autocompleteChoices(interaction, 'card'));
}

/** Shared autocomplete handler for sealed-product name inputs. */
export async function handleSealedAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  await respondWith(interaction, await autocompleteChoices(interaction, 'sealed'));
}

/**
 * Shared autocomplete handler for set inputs. `kind` picks between a game's
 * card sets and its sealed-product sets.
 */
export async function handleSetAutocomplete(
  interaction: AutocompleteInteraction,
  kind: ListingKind = 'card',
): Promise<void> {
  await respondWith(interaction, await autocompleteSetChoices(interaction, kind));
}

/** Resolve a card for a command, returning an ephemeral error when ambiguous. */
export async function resolveCardForCommand(
  interaction: ChatInputCommandInteraction,
  game: GameDefinition,
  cardName: string,
  options: CardResolveOptions = {},
): Promise<ResolvedCard | null> {
  const resolved = await game.resolveCard(cardName, options);
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

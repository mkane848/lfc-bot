import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { autocompleteCards, autocompleteSets, resolveCard } from '../services/scryfall.js';
import type { ResolveCardOptions } from '../services/scryfall.js';
import type { ResolvedCard } from '../types/index.js';
import { replyError } from './replies.js';
import { normalizeCardName } from './validation.js';

/** Shared autocomplete handler for card name inputs. */
export async function handleCardAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused();
  const choices = await autocompleteCards(query);
  await interaction.respond(
    choices.slice(0, 25).map((choice) => ({ name: choice, value: choice })),
  );
}

/** Shared autocomplete handler for set-code inputs. */
export async function handleSetAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused();
  const choices = await autocompleteSets(query);
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

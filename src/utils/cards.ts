import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { autocompleteCards, resolveCard } from '../services/scryfall.js';
import type { ResolvedCard } from '../types/index.js';
import { normalizeCardName } from './validation.js';

/** Shared autocomplete handler for card name inputs. */
export async function handleCardAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused();
  const choices = await autocompleteCards(query);
  await interaction.respond(
    choices.slice(0, 25).map((choice) => ({ name: choice, value: choice })),
  );
}

/** Resolve the card for a command, returning an ephemeral error when ambiguous. */
export async function resolveCardForCommand(
  interaction: ChatInputCommandInteraction,
  cardName: string,
  cardSet?: string | null,
): Promise<ResolvedCard | null> {
  const resolved = await resolveCard(cardName, cardSet);
  if (!resolved.resolved) {
    await interaction.reply({
      content:
        'I could not resolve that card name. Try selecting a suggestion from the autocomplete, or use a more specific name.',
      ephemeral: true,
    });
    return null;
  }
  return resolved;
}

/** Normalise a card name for search matching. */
export function searchKey(cardName: string): string {
  return normalizeCardName(cardName);
}

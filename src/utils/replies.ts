import type { RepliableInteraction } from 'discord.js';
import type { ListingRow } from '../db/schema.js';
import { listingEmbed } from './embeds.js';

/** Reply publicly with a created listing embed, appending any warning. */
export async function replyWithListing(
  interaction: RepliableInteraction,
  listing: ListingRow,
  warning?: string,
): Promise<void> {
  const embed = listingEmbed(listing, { showUser: true });
  await interaction.reply({
    embeds: [embed],
    content: warning ?? undefined,
  });
}

/** Reply ephemerally with a simple user-safe message. */
export async function replyError(
  interaction: RepliableInteraction,
  message: string,
): Promise<void> {
  await interaction.reply({ content: message, ephemeral: true });
}

/** Reply ephemerally with a success message. */
export async function replySuccess(
  interaction: RepliableInteraction,
  message: string,
): Promise<void> {
  await interaction.reply({ content: message, ephemeral: true });
}

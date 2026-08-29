import type { RepliableInteraction } from 'discord.js';
import type { ListingRow } from '../db/schema.js';
import { listingEmbed } from './embeds.js';

/**
 * Reply publicly with a created listing embed, appending any warning. If the
 * interaction was already deferred (ephemerally, to buy time for a slow
 * Scryfall lookup), the deferred placeholder is cleared with a short ack and
 * the public embed is sent as a follow-up instead.
 */
export async function replyWithListing(
  interaction: RepliableInteraction,
  listing: ListingRow,
  warning?: string,
): Promise<void> {
  const embed = listingEmbed(listing, { showUser: true });
  const payload = { embeds: [embed], content: warning ?? undefined };
  if (interaction.deferred) {
    await interaction.editReply({ content: 'Posted below.' });
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

/** Reply ephemerally with a simple user-safe message. */
export async function replyError(
  interaction: RepliableInteraction,
  message: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content: message });
  } else {
    await interaction.reply({ content: message, ephemeral: true });
  }
}

/** Reply ephemerally with a success message. */
export async function replySuccess(
  interaction: RepliableInteraction,
  message: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content: message });
  } else {
    await interaction.reply({ content: message, ephemeral: true });
  }
}

/**
 * Reply publicly with plain text (no embed). Same deferred/not-deferred split
 * as replyWithListing, for the batch commands' final summary message.
 */
export async function replyPublicText(
  interaction: RepliableInteraction,
  message: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content: 'Posted below.' });
    await interaction.followUp({ content: message });
  } else {
    await interaction.reply({ content: message });
  }
}

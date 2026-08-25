import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { fulfillListing, getListingById } from '../../services/listings.js';
import type { GuildCommand } from '../../types/index.js';
import { replyError, replySuccess } from '../../utils/replies.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger('listing_id', true);
  if (!interaction.inGuild()) {
    await replyError(interaction, 'This command can only be used inside a server.');
    return;
  }
  const listing = getListingById(id);
  if (!listing) {
    await replyError(interaction, 'Listing not found.');
    return;
  }
  if (listing.userId !== interaction.user.id) {
    await replyError(interaction, 'Only the listing owner can do that.');
    return;
  }
  fulfillListing(id);
  await replySuccess(interaction, `Listing #${id} marked as fulfilled.`);
}

export const fulfillCommand: GuildCommand = {
  name: 'fulfill',
  data: new SlashCommandBuilder()
    .setName('fulfill')
    .setDescription('Mark one of your listings as fulfilled')
    .addIntegerOption((option) =>
      option.setName('listing_id').setDescription('Listing ID').setRequired(true).setMinValue(1),
    ),
  execute,
};

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { getListingById, softDeleteListing } from '../../services/listings.js';
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
  softDeleteListing(id);
  await replySuccess(interaction, `Listing #${id} deleted.`);
}

export const deleteCommand: GuildCommand = {
  name: 'delete',
  data: new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete one of your listings')
    .addIntegerOption((option) =>
      option.setName('listing_id').setDescription('Listing ID').setRequired(true).setMinValue(1),
    ),
  execute,
};

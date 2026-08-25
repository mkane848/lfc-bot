import type { ChatInputCommandInteraction } from 'discord.js';
import { getListingById, softDeleteListing } from '../../services/listings.js';
import { replyError, replySuccess } from '../../utils/replies.js';
import { requireGuild } from './context.js';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = requireGuild(interaction);
  if (!serverId) {
    return;
  }
  const listingId = interaction.options.getInteger('listing_id', true);
  const listing = getListingById(listingId);
  if (!listing) {
    await replyError(interaction, 'Listing not found.');
    return;
  }
  if (listing.serverId !== serverId) {
    await replyError(interaction, 'Listing is not in this server.');
    return;
  }
  softDeleteListing(listingId);
  await replySuccess(interaction, `Listing #${listingId} removed.`);
}

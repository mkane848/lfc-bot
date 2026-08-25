import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { countSearchResults, searchListings } from '../../services/listings.js';
import type { GuildCommand, ListingType } from '../../types/index.js';
import { LISTING_TYPES } from '../../types/index.js';
import { brandColor, formatPrice } from '../../utils/embeds.js';
import { handleCardAutocomplete, searchKey } from '../../utils/cards.js';
import { replyError } from '../../utils/replies.js';
import { SEARCH_PAGE_SIZE } from '../../utils/constants.js';
import { isListingType, validateCardName } from '../../utils/validation.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
    await replyError(interaction, 'This command can only be used inside a server.');
    return;
  }

  const cardName = validateCardName(interaction.options.getString('card_name', true));
  const typeInput = interaction.options.getString('listing_type');
  if (typeInput && !isListingType(typeInput)) {
    await replyError(interaction, 'Invalid listing type.');
    return;
  }
  const listingType = (typeInput as ListingType | undefined) ?? undefined;
  const page = Math.max(1, interaction.options.getInteger('page') ?? 1);

  const key = searchKey(cardName);
  const results = searchListings(guild.id, key, listingType, page);
  const total = countSearchResults(guild.id, key, listingType);

  if (results.length === 0) {
    await interaction.reply({
      content: 'No active listings found for that card.',
      ephemeral: true,
    });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  const embed = new EmbedBuilder()
    .setColor(brandColor())
    .setTitle(`Search results: ${cardName}`)
    .setDescription(`Page ${page} of ${totalPages} (${total} listing${total === 1 ? '' : 's'})`);

  for (const listing of results) {
    const parts: string[] = [];
    if (listing.condition) parts.push(listing.condition.toUpperCase());
    if (listing.priceCents !== null && listing.priceCents !== undefined) {
      parts.push(formatPrice(listing.priceCents));
    }
    parts.push(`qty ${listing.quantity}`);
    const line = parts.join(' · ');
    embed.addFields({
      name: `#${listing.id} · ${listing.listingType.toUpperCase()} · @${listing.username}`,
      value: line,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

export const searchCommand: GuildCommand = {
  name: 'search',
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search active listings for a card')
    .addStringOption((option) =>
      option
        .setName('card_name')
        .setDescription('Card name')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName('listing_type')
        .setDescription('Filter by listing type')
        .addChoices(...LISTING_TYPES.map((t) => ({ name: t, value: t }))),
    )
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Page number').setMinValue(1),
    ),
  execute,
  autocomplete: handleCardAutocomplete,
};

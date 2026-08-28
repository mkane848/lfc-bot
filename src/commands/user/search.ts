import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { countSearchResults, searchListings } from '../../services/listings.js';
import type { Accepts, GuildCommand, ListingIntent } from '../../types/index.js';
import { ACCEPTS_VALUES, LISTING_INTENTS } from '../../types/index.js';
import { ACCEPTS_LABELS, INTENT_LABELS } from '../../utils/constants.js';
import { brandColor, formatPrice } from '../../utils/embeds.js';
import { handleCardAutocomplete, searchKey } from '../../utils/cards.js';
import { replyError } from '../../utils/replies.js';
import { SEARCH_PAGE_SIZE } from '../../utils/constants.js';
import { isAccepts, isListingIntent, validateCardName } from '../../utils/validation.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
    await replyError(interaction, 'This command can only be used inside a server.');
    return;
  }

  const cardName = validateCardName(interaction.options.getString('card_name', true));
  const intentInput = interaction.options.getString('intent');
  if (intentInput && !isListingIntent(intentInput)) {
    await replyError(interaction, 'Invalid intent.');
    return;
  }
  const intent = (intentInput as ListingIntent | undefined) ?? undefined;
  const acceptsInput = interaction.options.getString('accepts');
  if (acceptsInput && !isAccepts(acceptsInput)) {
    await replyError(interaction, 'Invalid accepts value.');
    return;
  }
  const accepts = (acceptsInput as Accepts | undefined) ?? undefined;
  const page = Math.max(1, interaction.options.getInteger('page') ?? 1);

  const key = searchKey(cardName);
  const results = searchListings(guild.id, key, intent, accepts, page);
  const total = countSearchResults(guild.id, key, intent, accepts);

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
    const intentLabel =
      INTENT_LABELS[listing.intent as keyof typeof INTENT_LABELS] ?? listing.intent;
    const acceptsLabel =
      ACCEPTS_LABELS[listing.accepts as keyof typeof ACCEPTS_LABELS] ?? listing.accepts;
    embed.addFields({
      name: `#${listing.id} · ${intentLabel} · ${acceptsLabel} · @${listing.username}`,
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
        .setName('intent')
        .setDescription('Filter by have/want')
        .addChoices(...LISTING_INTENTS.map((i) => ({ name: INTENT_LABELS[i], value: i }))),
    )
    .addStringOption((option) =>
      option
        .setName('accepts')
        .setDescription('Filter by what they accept')
        .addChoices(...ACCEPTS_VALUES.map((a) => ({ name: ACCEPTS_LABELS[a], value: a }))),
    )
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Page number').setMinValue(1),
    ),
  execute,
  autocomplete: handleCardAutocomplete,
};

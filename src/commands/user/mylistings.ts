import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import {
  fulfillListing,
  getListingById,
  myListings,
  softDeleteListing,
} from '../../services/listings.js';
import type { GuildCommand } from '../../types/index.js';
import { brandColor, formatPrice } from '../../utils/embeds.js';
import { replyError } from '../../utils/replies.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
    await replyError(interaction, 'This command can only be used inside a server.');
    return;
  }
  const page = Math.max(1, interaction.options.getInteger('page') ?? 1);
  const rows = myListings(guild.id, interaction.user.id, page);
  if (rows.length === 0) {
    await interaction.reply({
      content: 'You have no active listings.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(brandColor())
    .setTitle('Your active listings')
    .setDescription(`Page ${page}`);

  for (const listing of rows) {
    const parts: string[] = [];
    if (listing.condition) parts.push(listing.condition.toUpperCase());
    if (listing.priceCents !== null && listing.priceCents !== undefined) {
      parts.push(formatPrice(listing.priceCents));
    }
    embed.addFields({
      name: `#${listing.id} · ${listing.listingType.toUpperCase()} · ${listing.cardName}`,
      value: parts.join(' · ') || '—',
      inline: false,
    });
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...rows.map((listing) =>
      new ButtonBuilder()
        .setCustomId(`lfc:fulfill:${listing.id}`)
        .setLabel(`Fulfill #${listing.id}`)
        .setStyle(ButtonStyle.Success),
    ),
    ...rows.map((listing) =>
      new ButtonBuilder()
        .setCustomId(`lfc:delete:${listing.id}`)
        .setLabel(`Delete #${listing.id}`)
        .setStyle(ButtonStyle.Danger),
    ),
  );

  await interaction.reply({ embeds: [embed], components: [actionRow], ephemeral: true });
}

/** Handle a listing action button (fulfill/delete). */
export async function handleListingButton(interaction: ButtonInteraction): Promise<void> {
  const [prefix, action, idPart] = interaction.customId.split(':');
  if (prefix !== 'lfc') {
    return;
  }
  const id = Number(idPart);
  const listing = getListingById(id);
  if (!listing) {
    await interaction.reply({ content: 'Listing not found.', ephemeral: true });
    return;
  }
  if (listing.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the listing owner can do that.', ephemeral: true });
    return;
  }
  if (action === 'fulfill') {
    fulfillListing(id);
    await interaction.reply({ content: `Listing #${id} marked as fulfilled.`, ephemeral: true });
    return;
  }
  if (action === 'delete') {
    softDeleteListing(id);
    await interaction.reply({ content: `Listing #${id} deleted.`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: 'That action is not supported.', ephemeral: true });
}

export const myListingsCommand: GuildCommand = {
  name: 'mylistings',
  data: new SlashCommandBuilder()
    .setName('mylistings')
    .setDescription('Show your active listings')
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Page number').setMinValue(1),
    ),
  execute,
};

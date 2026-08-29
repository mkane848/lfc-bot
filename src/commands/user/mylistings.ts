import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  activeListingsForUser,
  fulfillListing,
  getListingById,
  myListings,
  softDeleteListing,
} from '../../services/listings.js';
import type { ListingRow } from '../../db/schema.js';
import type { GuildCommand } from '../../types/index.js';
import { ACCEPTS_LABELS, INTENT_LABELS } from '../../utils/constants.js';
import { brandColor, formatPrice } from '../../utils/embeds.js';
import { replyError } from '../../utils/replies.js';
import { buildEditModal } from './edit.js';

const BATCH_SELECT_LIMIT = 25;

/** Build a multi-select row letting the user pick several of their own active
 * listings at once for a batch delete/fulfill/edit action. */
function buildBatchSelectRow(
  customId: string,
  placeholder: string,
  rows: ListingRow[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(rows.length)
    .addOptions(
      rows.map((listing) => {
        const parts: string[] = [];
        if (listing.condition) parts.push(listing.condition.toUpperCase());
        if (listing.priceCents !== null && listing.priceCents !== undefined) {
          parts.push(formatPrice(listing.priceCents));
        }
        return {
          label: `#${listing.id} · ${listing.cardName}`.slice(0, 100),
          value: String(listing.id),
          description: parts.join(' · ').slice(0, 100) || undefined,
        };
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

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
    const intentLabel =
      INTENT_LABELS[listing.intent as keyof typeof INTENT_LABELS] ?? listing.intent;
    const acceptsLabel =
      ACCEPTS_LABELS[listing.accepts as keyof typeof ACCEPTS_LABELS] ?? listing.accepts;
    embed.addFields({
      name: `#${listing.id} · ${intentLabel} · ${acceptsLabel} · ${listing.cardName}`,
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

  // Batch-action selects span the user's most recent active listings (not just
  // this page), so several can be deleted/fulfilled/edited in one go. These are
  // additive — the per-page buttons above still work exactly as before.
  const components: Array<
    ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
  > = [actionRow];
  const batchable = activeListingsForUser(guild.id, interaction.user.id, BATCH_SELECT_LIMIT);
  if (batchable.length > 0) {
    components.push(
      buildBatchSelectRow('lfc:batchdelete', 'Select listings to delete…', batchable),
      buildBatchSelectRow('lfc:batchfulfill', 'Select listings to fulfill…', batchable),
      buildBatchSelectRow('lfc:batchedit', 'Select listings to edit…', batchable),
    );
  }

  await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

/** Handle a batch-action select menu (delete/fulfill/edit several listings at once). */
export async function handleBatchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [prefix, action] = interaction.customId.split(':');
  if (prefix !== 'lfc') {
    return;
  }
  const ids = interaction.values.map(Number);

  if (action === 'batchedit') {
    const [firstId, ...rest] = ids;
    if (firstId === undefined) {
      return;
    }
    const listing = getListingById(firstId);
    if (!listing) {
      await interaction.reply({ content: 'Listing not found.', ephemeral: true });
      return;
    }
    if (listing.userId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the listing owner can edit it.', ephemeral: true });
      return;
    }
    await interaction.showModal(buildEditModal(listing, rest));
    return;
  }

  if (action === 'batchdelete' || action === 'batchfulfill') {
    const succeeded: number[] = [];
    const skipped: number[] = [];
    for (const id of ids) {
      const listing = getListingById(id);
      if (!listing || listing.userId !== interaction.user.id) {
        skipped.push(id);
        continue;
      }
      if (action === 'batchfulfill') {
        fulfillListing(id);
      } else {
        softDeleteListing(id);
      }
      succeeded.push(id);
    }
    const verb = action === 'batchfulfill' ? 'Fulfilled' : 'Deleted';
    const parts: string[] = [];
    if (succeeded.length > 0) {
      parts.push(`${verb} ${succeeded.map((id) => `#${id}`).join(', ')}.`);
    }
    if (skipped.length > 0) {
      parts.push(
        `Skipped ${skipped.map((id) => `#${id}`).join(', ')} (not yours or already gone).`,
      );
    }
    await interaction.reply({ content: parts.join(' ') || 'Nothing to do.', ephemeral: true });
  }
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

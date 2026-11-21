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
  closedListingMessage,
  fulfillListing,
  getListingById,
  myListings,
  softDeleteListing,
} from '../../services/listings.js';
import type { ListingRow } from '../../db/schema.js';
import type { GuildCommand } from '../../types/index.js';
import { ACCEPTS_LABELS, formatSealedType, INTENT_LABELS } from '../../utils/constants.js';
import {
  decodeBatchSelectId,
  decodeListingActionId,
  encodeBatchSelectId,
  encodeListingActionId,
  maxEditBatchSize,
} from '../../utils/customId.js';
import { brandColor, conditionText, formatPrice, languageTag } from '../../utils/embeds.js';
import { replyError } from '../../utils/replies.js';
import { buildEditModal } from './edit.js';

const BATCH_SELECT_LIMIT = 25;

/** Build a multi-select row letting the user pick several of their own active
 * listings at once for a batch delete/fulfill/edit action. */
function buildBatchSelectRow(
  customId: string,
  placeholder: string,
  rows: ListingRow[],
  maxValues = rows.length,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(maxValues)
    .addOptions(
      rows.map((listing) => {
        const parts: string[] = [];
        const condition = conditionText(listing);
        if (condition) parts.push(condition);
        const language = languageTag(listing.language);
        if (language) parts.push(language);
        if (listing.kind === 'sealed') {
          const label = formatSealedType(listing.sealedCategory ?? '');
          if (label) parts.push(label);
        }
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

/**
 * Handle `/mylistings`: show the caller's own active listings (paginated)
 * with per-listing fulfill/delete buttons, plus batch-action select menus
 * covering their most recent active listings.
 */
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
    const condition = conditionText(listing);
    if (condition) parts.push(condition);
    const language = languageTag(listing.language);
    if (language) parts.push(language);
    if (listing.kind === 'sealed') {
      const label = formatSealedType(listing.sealedCategory ?? '');
      if (label) parts.push(label);
    }
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
        .setCustomId(encodeListingActionId('fulfill', listing.id))
        .setLabel(`Fulfill #${listing.id}`)
        .setStyle(ButtonStyle.Success),
    ),
    ...rows.map((listing) =>
      new ButtonBuilder()
        .setCustomId(encodeListingActionId('delete', listing.id))
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
      buildBatchSelectRow(
        encodeBatchSelectId('batchdelete'),
        'Select listings to delete…',
        batchable,
      ),
      buildBatchSelectRow(
        encodeBatchSelectId('batchfulfill'),
        'Select listings to fulfill…',
        batchable,
      ),
      buildEditSelectRow(batchable),
    );
  }

  await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

/**
 * The batch-edit select. Its queue rides in the edit modal's custom id, which
 * Discord caps at 100 characters, so it allows only as many picks as fit.
 */
function buildEditSelectRow(rows: ListingRow[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const max = maxEditBatchSize(rows.map((listing) => listing.id));
  const placeholder =
    max < rows.length ? `Select up to ${max} listings to edit…` : 'Select listings to edit…';
  return buildBatchSelectRow(encodeBatchSelectId('batchedit'), placeholder, rows, max);
}

/** Handle a batch-action select menu (delete/fulfill/edit several listings at once). */
export async function handleBatchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const action = decodeBatchSelectId(interaction.customId);
  if (!action) {
    return;
  }
  const ids = interaction.values.map(Number);

  if (action === 'batchedit') {
    // A select sent before the cap existed can still carry too many.
    const max = maxEditBatchSize(ids);
    if (ids.length > max) {
      await interaction.reply({
        content: `Select at most ${max} listings to edit at once.`,
        ephemeral: true,
      });
      return;
    }
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
    const closed = closedListingMessage(listing);
    if (closed) {
      await interaction.reply({ content: closed, ephemeral: true });
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
      const changed = action === 'batchfulfill' ? fulfillListing(id) : softDeleteListing(id);
      (changed ? succeeded : skipped).push(id);
    }
    const verb = action === 'batchfulfill' ? 'Fulfilled' : 'Deleted';
    const parts: string[] = [];
    if (succeeded.length > 0) {
      parts.push(`${verb} ${succeeded.map((id) => `#${id}`).join(', ')}.`);
    }
    if (skipped.length > 0) {
      parts.push(
        `Skipped ${skipped.map((id) => `#${id}`).join(', ')} (not yours, or already closed).`,
      );
    }
    await interaction.reply({ content: parts.join(' ') || 'Nothing to do.', ephemeral: true });
  }
}

/** Handle a listing action button (fulfill/delete). */
export async function handleListingButton(interaction: ButtonInteraction): Promise<void> {
  const decoded = decodeListingActionId(interaction.customId);
  if (!decoded) {
    return;
  }
  const { action, id } = decoded;
  const listing = getListingById(id);
  if (!listing) {
    await interaction.reply({ content: 'Listing not found.', ephemeral: true });
    return;
  }
  if (listing.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the listing owner can do that.', ephemeral: true });
    return;
  }
  // The buttons stay on the message after the listing is closed.
  const closed = closedListingMessage(listing);
  if (closed) {
    await interaction.reply({ content: closed, ephemeral: true });
    return;
  }
  if (action === 'fulfill') {
    fulfillListing(id);
    await interaction.reply({ content: `Listing #${id} marked as fulfilled.`, ephemeral: true });
  } else {
    softDeleteListing(id);
    await interaction.reply({ content: `Listing #${id} deleted.`, ephemeral: true });
  }
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

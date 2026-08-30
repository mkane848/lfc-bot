import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { getListingById, updateListing } from '../../services/listings.js';
import { resolveCard } from '../../services/scryfall.js';
import type { GuildCommand } from '../../types/index.js';
import {
  decodeEditModalId,
  decodeEditNextId,
  encodeEditModalId,
  encodeEditNextId,
} from '../../utils/customId.js';
import { replyError, replySuccess } from '../../utils/replies.js';
import {
  isCardCondition,
  isCardFinish,
  isCardVariant,
  parsePriceToCents,
  parseQuantity,
  validateNotes,
} from '../../utils/validation.js';

/** Handle `/edit`: look up the listing, verify ownership, and show the edit modal. */
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
    await replyError(interaction, 'Only the listing owner can edit it.');
    return;
  }

  const modal = buildEditModal(listing);
  await interaction.showModal(modal);
}

/**
 * Build the edit modal for a listing. `remainingQueue` carries any additional
 * listing IDs still to be edited in this batch (see `handleEditNextButton` below);
 * it rides along in the modal's customId so no server-side session state is needed.
 */
export function buildEditModal(
  listing: {
    id: number;
    condition: string | null;
    priceCents: number | null;
    quantity: number;
    notes: string | null;
    cardSet: string | null;
  },
  remainingQueue: number[] = [],
): ModalBuilder {
  const conditionInput = new TextInputBuilder()
    .setCustomId('condition')
    .setLabel('Condition (nm, lp, mp, hp, dmg)')
    .setStyle(TextInputStyle.Short)
    .setValue(listing.condition ?? '')
    .setRequired(false)
    .setMaxLength(3);

  const priceInput = new TextInputBuilder()
    .setCustomId('price')
    .setLabel('Price in USD (e.g. 2.50)')
    .setStyle(TextInputStyle.Short)
    .setValue(listing.priceCents !== null ? (listing.priceCents / 100).toFixed(2) : '')
    .setRequired(false);

  const quantityInput = new TextInputBuilder()
    .setCustomId('quantity')
    .setLabel('Quantity (1-99)')
    .setStyle(TextInputStyle.Short)
    .setValue(String(listing.quantity))
    .setRequired(false);

  const setInput = new TextInputBuilder()
    .setCustomId('set')
    .setLabel('Set code (e.g. MH3)')
    .setStyle(TextInputStyle.Short)
    .setValue(listing.cardSet ?? '')
    .setRequired(false)
    .setMaxLength(10);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (max 500 characters)')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(listing.notes ?? '')
    .setRequired(false)
    .setMaxLength(500);

  const row = (component: TextInputBuilder) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(component);

  return new ModalBuilder()
    .setCustomId(encodeEditModalId(listing.id, remainingQueue))
    .setTitle(`Edit listing #${listing.id}`)
    .addComponents(
      row(conditionInput),
      row(priceInput),
      row(quantityInput),
      row(setInput),
      row(notesInput),
    );
}

/** Handle the edit modal submission. */
export async function handleEditModal(interaction: ModalSubmitInteraction): Promise<void> {
  const decoded = decodeEditModalId(interaction.customId);
  if (!decoded) {
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const { id, queue } = decoded;
  const listing = getListingById(id);
  if (!listing) {
    await interaction.editReply({ content: 'Listing not found.' });
    return;
  }
  if (listing.userId !== interaction.user.id) {
    await interaction.editReply({ content: 'Only the listing owner can edit it.' });
    return;
  }

  const conditionRaw = interaction.fields.getTextInputValue('condition');
  const priceRaw = interaction.fields.getTextInputValue('price');
  const quantityRaw = interaction.fields.getTextInputValue('quantity');
  const setRaw = interaction.fields.getTextInputValue('set');
  const notesRaw = interaction.fields.getTextInputValue('notes');

  try {
    const condition = conditionRaw.trim() !== '' ? conditionRaw.trim() : null;
    if (condition && !isCardCondition(condition)) {
      await interaction.editReply({
        content: 'Invalid condition. Use nm, lp, mp, hp, or dmg.',
      });
      return;
    }
    const priceCents = priceRaw.trim() !== '' ? parsePriceToCents(priceRaw) : null;
    const quantity = quantityRaw.trim() !== '' ? parseQuantity(quantityRaw) : undefined;
    const notes = validateNotes(notesRaw);
    const cardSet = setRaw.trim() !== '' ? setRaw.trim().toUpperCase() : null;

    const baseFields = { condition: condition ?? null, priceCents, quantity, notes };

    // Changing the set changes the printing, so re-resolve to keep the
    // collector number, card image, and Manapool link consistent with it
    // instead of leaving them pointing at the old printing.
    if (cardSet === listing.cardSet) {
      updateListing(id, { ...baseFields, cardSet });
    } else {
      const finish = listing.finish && isCardFinish(listing.finish) ? listing.finish : null;
      const variant = listing.variant && isCardVariant(listing.variant) ? listing.variant : null;
      const resolved = await resolveCard(listing.cardName, { cardSet, finish, variant });
      if (!resolved.resolved) {
        await interaction.editReply({
          content: `Could not find "${listing.cardName}" in set ${cardSet ?? '(none)'}. Check the set code and try again.`,
        });
        return;
      }
      // Use the set Scryfall actually resolved to, in case of a
      // normalization difference (e.g. casing) from what the user typed.
      updateListing(id, {
        ...baseFields,
        cardSet: resolved.cardSet ?? cardSet,
        cardName: resolved.cardName,
        cardNameNormalized: resolved.cardNameNormalized,
        cardImageUrl: resolved.cardImageUrl,
        collectorNumber: resolved.collectorNumber ?? null,
        manapoolUrl: resolved.manapoolUrl,
      });
    }

    const [nextId, ...stillRemaining] = queue;
    if (nextId === undefined) {
      await replySuccess(interaction, `Listing #${id} updated.`);
    } else {
      const continueButton = new ButtonBuilder()
        .setCustomId(encodeEditNextId(nextId, stillRemaining))
        .setLabel(`Edit #${nextId} next`)
        .setStyle(ButtonStyle.Primary);
      await interaction.editReply({
        content: `Listing #${id} updated. ${queue.length} more to edit.`,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton)],
      });
    }
  } catch (err) {
    await interaction.editReply({
      content: err instanceof Error ? err.message : 'Could not update listing.',
    });
  }
}

/**
 * Handle the "Edit #N next" button shown after saving one listing in a batch-edit
 * queue (see `buildEditModal`'s `remainingQueue`). Opens the next listing's edit
 * modal directly — a button interaction can show a modal, unlike a modal submit
 * interaction, which cannot show another modal in response.
 */
export async function handleEditNextButton(interaction: ButtonInteraction): Promise<void> {
  const decoded = decodeEditNextId(interaction.customId);
  if (!decoded) {
    return;
  }
  const { id, queue } = decoded;
  const listing = getListingById(id);
  if (!listing) {
    await interaction.reply({ content: 'Listing not found.', ephemeral: true });
    return;
  }
  if (listing.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the listing owner can edit it.', ephemeral: true });
    return;
  }
  await interaction.showModal(buildEditModal(listing, queue));
}

export const editCommand: GuildCommand = {
  name: 'edit',
  data: new SlashCommandBuilder()
    .setName('edit')
    .setDescription('Edit one of your listings')
    .addIntegerOption((option) =>
      option
        .setName('listing_id')
        .setDescription('Listing ID to edit')
        .setRequired(true)
        .setMinValue(1),
    ),
  execute,
};

import {
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { getListingById, updateListing } from '../../services/listings.js';
import type { GuildCommand } from '../../types/index.js';
import { replyError, replySuccess } from '../../utils/replies.js';
import {
  isCardCondition,
  parsePriceToCents,
  parseQuantity,
  validateNotes,
} from '../../utils/validation.js';

const MODAL_PREFIX = 'lfc:editmodal';

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

function buildEditModal(listing: {
  id: number;
  condition: string | null;
  priceCents: number | null;
  quantity: number;
  notes: string | null;
  cardSet: string | null;
}): ModalBuilder {
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
    .setCustomId(`${MODAL_PREFIX}:${listing.id}`)
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
  const [prefix, idPart] = interaction.customId.split(':');
  if (prefix !== 'lfc:editmodal') {
    return;
  }
  const id = Number(idPart);
  const listing = getListingById(id);
  if (!listing) {
    await interaction.reply({ content: 'Listing not found.', ephemeral: true });
    return;
  }
  if (listing.userId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the listing owner can edit it.', ephemeral: true });
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
      await interaction.reply({
        content: 'Invalid condition. Use nm, lp, mp, hp, or dmg.',
        ephemeral: true,
      });
      return;
    }
    const priceCents = priceRaw.trim() !== '' ? parsePriceToCents(priceRaw) : null;
    const quantity = quantityRaw.trim() !== '' ? parseQuantity(quantityRaw) : undefined;
    const notes = validateNotes(notesRaw);
    const cardSet = setRaw.trim() !== '' ? setRaw.trim().toUpperCase() : null;

    updateListing(id, {
      condition: condition ?? null,
      priceCents,
      quantity,
      notes,
      cardSet,
    });
    await replySuccess(interaction, `Listing #${id} updated.`);
  } catch (err) {
    await interaction.reply({
      content: err instanceof Error ? err.message : 'Could not update listing.',
      ephemeral: true,
    });
  }
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

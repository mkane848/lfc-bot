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
import { resolveSealedProduct } from '../../services/sealed.js';
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
    kind: string;
    condition: string | null;
    priceCents: number | null;
    quantity: number;
    notes: string | null;
    cardSet: string | null;
  },
  remainingQueue: number[] = [],
): ModalBuilder {
  const isSealed = listing.kind === 'sealed';

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

  const rows: Array<ActionRowBuilder<TextInputBuilder>> = [];
  // Sealed product is NM by definition and has no `condition` column, so the
  // sealed modal omits the row entirely rather than showing a field whose value
  // would be silently discarded. It also keeps the modal inside Discord's
  // five-row cap, which the card modal is already sitting exactly on.
  if (!isSealed) {
    const conditionInput = new TextInputBuilder()
      .setCustomId('condition')
      .setLabel('Condition (nm, lp, mp, hp, dmg)')
      .setStyle(TextInputStyle.Short)
      .setValue(listing.condition ?? '')
      .setRequired(false)
      .setMaxLength(3);
    rows.push(row(conditionInput));
  }
  rows.push(row(priceInput), row(quantityInput), row(setInput), row(notesInput));

  return new ModalBuilder()
    .setCustomId(encodeEditModalId(listing.id, remainingQueue))
    .setTitle(`Edit listing #${listing.id}`)
    .addComponents(...rows);
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

  const isSealed = listing.kind === 'sealed';

  try {
    // `getTextInputValue` THROWS when the field is absent from the submission,
    // and `buildEditModal` builds no condition row for a sealed listing — so
    // this read has to stay behind the `kind` check, not merely have its result
    // ignored downstream. The reads also sit inside the try so that any future
    // shape mismatch surfaces as an edited reply rather than escaping to
    // `interactionCreate`'s generic "Something went wrong." handler.
    const conditionRaw = isSealed ? '' : interaction.fields.getTextInputValue('condition');
    const priceRaw = interaction.fields.getTextInputValue('price');
    const quantityRaw = interaction.fields.getTextInputValue('quantity');
    const setRaw = interaction.fields.getTextInputValue('set');
    const notesRaw = interaction.fields.getTextInputValue('notes');

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

    // Changing the set changes which printing (card) or which product (sealed)
    // this listing refers to, so re-resolve to keep the derived metadata and
    // the Manapool link consistent with it instead of leaving them pointing at
    // the old set. An unchanged set takes the cheap path with no lookup.
    if (cardSet === listing.cardSet) {
      updateListing(id, { ...baseFields, cardSet });
    } else if (isSealed) {
      const resolved = await resolveSealedProduct(listing.cardName, { setCode: cardSet });
      // Asymmetry with the card branch below, and deliberate: an unresolved
      // product does NOT abort. The sealed catalog is not exhaustive (new
      // releases, store-only drops, custom lots), so creation accepts a
      // free-text product — the raw name with null metadata. An edit must not
      // be stricter than the create path that allowed the row in the first
      // place, so a miss simply writes that same free-text result, clearing the
      // stale uuid/category/subtype/link that belonged to the previous set.
      updateListing(id, {
        ...baseFields,
        cardSet: resolved.setCode ?? cardSet,
        cardName: resolved.productName,
        cardNameNormalized: resolved.productNameNormalized,
        manapoolUrl: resolved.manapoolUrl,
        sealedUuid: resolved.uuid,
        sealedCategory: resolved.category,
        sealedSubtype: resolved.subtype,
      });
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

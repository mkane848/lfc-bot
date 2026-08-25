import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createListing } from '../../services/listings.js';
import type { GuildCommand } from '../../types/index.js';
import { CARD_CONDITIONS } from '../../types/index.js';
import { handleCardAutocomplete, resolveCardForCommand } from '../../utils/cards.js';
import { replyError, replyWithListing } from '../../utils/replies.js';
import {
  isCardCondition,
  parsePriceToCents,
  validateCardName,
  validateNotes,
} from '../../utils/validation.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member || !interaction.inGuild()) {
    await replyError(interaction, 'This command can only be used inside a server.');
    return;
  }

  const rawCard = interaction.options.getString('card_name', true);
  const cardName = validateCardName(rawCard);
  const cardSet = interaction.options.getString('set');
  const conditionInput = interaction.options.getString('condition', true);
  if (!isCardCondition(conditionInput)) {
    await replyError(interaction, 'Invalid condition.');
    return;
  }
  const priceInput = interaction.options.getString('price', true);
  const priceCents = parsePriceToCents(priceInput);
  const quantity = interaction.options.getInteger('quantity') ?? 1;
  const notes = validateNotes(interaction.options.getString('notes'));

  const resolved = await resolveCardForCommand(interaction, cardName, cardSet);
  if (!resolved) {
    return;
  }

  try {
    const { listing, warning } = createListing({
      serverId: guild.id,
      userId: interaction.user.id,
      username: interaction.user.displayName,
      listingType: 'sell',
      cardName: resolved.cardName,
      cardNameNormalized: resolved.cardNameNormalized,
      cardSet: resolved.cardSet,
      cardImageUrl: resolved.cardImageUrl,
      condition: conditionInput,
      priceCents,
      quantity,
      notes,
      game: 'mtg',
    });
    await replyWithListing(interaction, listing, warning);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Could not create listing.');
  }
}

export const sellCommand: GuildCommand = {
  name: 'sell',
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('Post a card you want to sell')
    .addStringOption((option) =>
      option
        .setName('card_name')
        .setDescription('Card name')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName('condition')
        .setDescription('Card condition')
        .setRequired(true)
        .addChoices(...CARD_CONDITIONS.map((c) => ({ name: c.toUpperCase(), value: c }))),
    )
    .addStringOption((option) =>
      option.setName('price').setDescription('Price in USD, e.g. 2.50').setRequired(true),
    )
    .addStringOption((option) => option.setName('set').setDescription('Card set code, e.g. MH3'))
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('Quantity (1-99)').setMinValue(1).setMaxValue(99),
    )
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional notes (max 500 characters)'),
    ),
  execute,
  autocomplete: handleCardAutocomplete,
};

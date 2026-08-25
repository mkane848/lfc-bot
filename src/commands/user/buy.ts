import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createListing } from '../../services/listings.js';
import type { CardCondition, GuildCommand } from '../../types/index.js';
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
  if (!guild || !interaction.inGuild()) {
    await replyError(interaction, 'This command can only be used inside a server.');
    return;
  }

  const rawCard = interaction.options.getString('card_name', true);
  const cardName = validateCardName(rawCard);
  const cardSet = interaction.options.getString('set');
  const conditionInput = interaction.options.getString('condition');
  if (conditionInput && !isCardCondition(conditionInput)) {
    await replyError(interaction, 'Invalid condition.');
    return;
  }
  const condition: CardCondition | null = conditionInput ? (conditionInput as CardCondition) : null;
  const maxPriceInput = interaction.options.getString('max_price');
  const maxPrice = maxPriceInput ? parsePriceToCents(maxPriceInput) : null;
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
      listingType: 'buy',
      cardName: resolved.cardName,
      cardNameNormalized: resolved.cardNameNormalized,
      cardSet: resolved.cardSet,
      cardImageUrl: resolved.cardImageUrl,
      condition,
      priceCents: maxPrice,
      notes,
      game: 'mtg',
    });
    await replyWithListing(interaction, listing, warning);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Could not create listing.');
  }
}

export const buyCommand: GuildCommand = {
  name: 'buy',
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Post a card you want to buy')
    .addStringOption((option) =>
      option
        .setName('card_name')
        .setDescription('Card name')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) => option.setName('set').setDescription('Card set code, e.g. MH3'))
    .addStringOption((option) =>
      option
        .setName('condition')
        .setDescription('Desired condition (default: any)')
        .addChoices(...CARD_CONDITIONS.map((c) => ({ name: c.toUpperCase(), value: c }))),
    )
    .addStringOption((option) =>
      option.setName('max_price').setDescription('Maximum price in USD, e.g. 10.00'),
    )
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional notes (max 500 characters)'),
    ),
  execute,
  autocomplete: handleCardAutocomplete,
};

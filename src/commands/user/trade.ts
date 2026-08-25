import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createListing } from '../../services/listings.js';
import type { GuildCommand } from '../../types/index.js';
import { CARD_CONDITIONS } from '../../types/index.js';
import { handleCardAutocomplete, resolveCardForCommand } from '../../utils/cards.js';
import { replyError, replyWithListing } from '../../utils/replies.js';
import { isCardCondition, validateCardName, validateNotes } from '../../utils/validation.js';

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
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
      listingType: 'trade',
      cardName: resolved.cardName,
      cardNameNormalized: resolved.cardNameNormalized,
      cardSet: resolved.cardSet,
      cardImageUrl: resolved.cardImageUrl,
      condition: conditionInput,
      notes,
      game: 'mtg',
    });
    await replyWithListing(interaction, listing, warning);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Could not create listing.');
  }
}

export const tradeCommand: GuildCommand = {
  name: 'trade',
  data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Post a card you want to trade')
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
    .addStringOption((option) => option.setName('set').setDescription('Card set code, e.g. MH3'))
    .addStringOption((option) =>
      option.setName('notes').setDescription('Optional notes (max 500 characters)'),
    ),
  execute,
  autocomplete: handleCardAutocomplete,
};

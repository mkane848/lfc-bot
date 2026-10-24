import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createListing } from '../../services/listings.js';
import type {
  Accepts,
  CardFinish,
  CardVariant,
  GradingCompany,
  GuildCommand,
} from '../../types/index.js';
import { ACCEPTS_VALUES, CARD_CONDITIONS, CARD_VARIANTS } from '../../types/index.js';
import { resolveGameForValue } from '../../games/index.js';
import { ACCEPTS_LABELS, CONDITION_LABELS, VARIANT_LABELS } from '../../utils/constants.js';
import {
  handleCardAutocomplete,
  handleSetAutocomplete,
  resolveCardForCommand,
} from '../../utils/cards.js';
import {
  addUniversalOptions,
  checkFinishForGame,
  checkVariantForGame,
  finishChoices,
  gradeFields,
  languageFor,
  readUniversalOptions,
} from '../../utils/listing-options.js';
import type { UniversalOptions } from '../../utils/listing-options.js';
import { replyError, replyWithListing } from '../../utils/replies.js';
import {
  isAccepts,
  isCardCondition,
  isCardFinish,
  isCardVariant,
  parsePriceToCents,
  validateCardName,
  validateCollectorNumber,
  validateNotes,
} from '../../utils/validation.js';

/**
 * Handle `/have`: validate the submitted printing/condition/price fields,
 * resolve the card via Scryfall, and post one "have" listing.
 */
async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
    await replyError(interaction, 'This command can only be used inside a server.');
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  let universal: UniversalOptions;
  try {
    universal = readUniversalOptions(interaction);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid options.');
    return;
  }
  const rawCard = interaction.options.getString('card_name', true);
  const gameResolution = resolveGameForValue({
    serverId: guild.id,
    value: rawCard,
    gameOption: universal.gameOption,
  });
  if (!gameResolution.ok) {
    await replyError(interaction, gameResolution.message);
    return;
  }
  const { game } = gameResolution;
  let cardName: string;
  try {
    cardName = validateCardName(gameResolution.value);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid card name.');
    return;
  }
  const cardSet = interaction.options.getString('set');
  const acceptsInput = interaction.options.getString('accepts', true);
  if (!isAccepts(acceptsInput)) {
    await replyError(interaction, 'Invalid accepts value.');
    return;
  }
  const accepts: Accepts = acceptsInput;
  const conditionInput = interaction.options.getString('condition', true);
  if (!isCardCondition(conditionInput)) {
    await replyError(interaction, 'Invalid condition.');
    return;
  }
  const finishInput = interaction.options.getString('finish');
  let finish: CardFinish | null = null;
  if (finishInput) {
    if (!isCardFinish(finishInput)) {
      await replyError(interaction, 'Invalid finish.');
      return;
    }
    finish = finishInput;
  }
  const variantInput = interaction.options.getString('variant');
  let variant: CardVariant | null = null;
  if (variantInput) {
    if (!isCardVariant(variantInput)) {
      await replyError(interaction, 'Invalid variant.');
      return;
    }
    variant = variantInput;
  }
  let gradingCompany: GradingCompany | null;
  let grade: string | null;
  try {
    checkFinishForGame(game, finish);
    checkVariantForGame(game, variant);
    ({ gradingCompany, grade } = gradeFields(conditionInput, universal.grade));
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid options.');
    return;
  }
  const collectorNumberInput = interaction.options.getString('collector_number');
  let collectorNumber: string | null;
  try {
    collectorNumber = collectorNumberInput ? validateCollectorNumber(collectorNumberInput) : null;
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid collector number.');
    return;
  }
  const priceInput = interaction.options.getString('price');
  let priceCents: number | null;
  try {
    priceCents = priceInput ? parsePriceToCents(priceInput) : null;
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid price.');
    return;
  }
  const quantity = interaction.options.getInteger('quantity') ?? 1;
  let notes: string | null;
  try {
    notes = validateNotes(interaction.options.getString('notes'));
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid notes.');
    return;
  }

  const resolved = await resolveCardForCommand(interaction, game, cardName, {
    cardSet,
    finish,
    variant,
    collectorNumber,
  });
  if (!resolved) {
    return;
  }

  try {
    const { listing, warning } = createListing({
      serverId: guild.id,
      userId: interaction.user.id,
      username: interaction.user.displayName,
      intent: 'have',
      accepts,
      cardName: resolved.cardName,
      cardNameNormalized: resolved.cardNameNormalized,
      cardSet: resolved.cardSet,
      cardImageUrl: resolved.cardImageUrl,
      finish,
      variant,
      collectorNumber: resolved.collectorNumber ?? collectorNumber,
      marketUrl: resolved.marketUrl,
      condition: conditionInput,
      gradingCompany,
      grade,
      priceCents,
      quantity,
      notes,
      game: game.id,
      language: languageFor(universal.language, resolved.language),
      catalogId: resolved.catalogId ?? null,
    });
    await replyWithListing(interaction, listing, warning);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Could not create listing.');
  }
}

export const haveCommand: GuildCommand = {
  name: 'have',
  data: addUniversalOptions(
    new SlashCommandBuilder()
      .setName('have')
      .setDescription('Post a card you have to sell or trade away')
      .addStringOption((option) =>
        option
          .setName('card_name')
          .setDescription('Card name')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('accepts')
          .setDescription('What you accept in return')
          .setRequired(true)
          .addChoices(...ACCEPTS_VALUES.map((a) => ({ name: ACCEPTS_LABELS[a], value: a }))),
      )
      .addStringOption((option) =>
        option
          .setName('condition')
          .setDescription('Card condition')
          .setRequired(true)
          .addChoices(...CARD_CONDITIONS.map((c) => ({ name: CONDITION_LABELS[c], value: c }))),
      )
      .addStringOption((option) =>
        option.setName('set').setDescription('Card set code, e.g. MH3').setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('finish')
          .setDescription('Card finish')
          .addChoices(...finishChoices()),
      )
      .addStringOption((option) =>
        option
          .setName('variant')
          .setDescription('Printing variant')
          .addChoices(...CARD_VARIANTS.map((v) => ({ name: VARIANT_LABELS[v], value: v }))),
      )
      .addStringOption((option) =>
        option.setName('collector_number').setDescription('Collector number, e.g. 89'),
      )
      .addStringOption((option) =>
        option.setName('price').setDescription('Price in USD, e.g. 2.50 (optional)'),
      )
      .addIntegerOption((option) =>
        option.setName('quantity').setDescription('Quantity (1-99)').setMinValue(1).setMaxValue(99),
      )
      .addStringOption((option) =>
        option.setName('notes').setDescription('Optional notes (max 500 characters)'),
      ),
    { grade: true },
  ),
  execute,
  autocomplete: async (interaction) => {
    if (interaction.options.getFocused(true).name === 'set') {
      await handleSetAutocomplete(interaction);
      return;
    }
    await handleCardAutocomplete(interaction);
  },
};

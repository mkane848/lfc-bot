import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createListing } from '../../services/listings.js';
import { resolveGameForValue } from '../../games/index.js';
import type { Accepts, GuildCommand } from '../../types/index.js';
import { ACCEPTS_VALUES } from '../../types/index.js';
import { handleSealedAutocomplete, handleSetAutocomplete } from '../../utils/cards.js';
import { ACCEPTS_LABELS } from '../../utils/constants.js';
import {
  addUniversalOptions,
  languageFor,
  readUniversalOptions,
} from '../../utils/listing-options.js';
import type { UniversalOptions } from '../../utils/listing-options.js';
import { replyError, replyWithListing } from '../../utils/replies.js';
import {
  isAccepts,
  parsePriceToCents,
  validateCardName,
  validateNotes,
} from '../../utils/validation.js';

/**
 * Handle `/have-sealed`: validate the submitted product/price fields, resolve
 * the product against the sealed catalog (falling back to a free-text
 * listing on a catalog miss), and post one "have" listing. Sealed product is
 * NM by definition and has no printing variants, so unlike `/have` there is
 * no `condition`/`finish`/`variant`/`collector_number` option.
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
  const rawProduct = interaction.options.getString('product_name', true);
  const gameResolution = resolveGameForValue({
    serverId: guild.id,
    value: rawProduct,
    gameOption: universal.gameOption,
    kind: 'sealed',
  });
  if (!gameResolution.ok) {
    await replyError(interaction, gameResolution.message);
    return;
  }
  const { game } = gameResolution;
  let productName: string;
  try {
    productName = validateCardName(gameResolution.value);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid product name.');
    return;
  }
  const setCode = interaction.options.getString('set');
  const acceptsInput = interaction.options.getString('accepts', true);
  if (!isAccepts(acceptsInput)) {
    await replyError(interaction, 'Invalid accepts value.');
    return;
  }
  const accepts: Accepts = acceptsInput;
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

  const resolved = await game.resolveSealed(productName, { setCode });
  if (!resolved.resolved && game.isCatalogPick('sealed', productName)) {
    // A picked suggestion whose product left the catalog since: there is no
    // name to fall back on, only the uuid.
    await replyError(
      interaction,
      'That product is no longer in the catalog. Pick it again from the suggestions, or type its name.',
    );
    return;
  }

  try {
    const { listing, warning } = createListing({
      serverId: guild.id,
      userId: interaction.user.id,
      username: interaction.user.displayName,
      intent: 'have',
      accepts,
      cardName: resolved.productName,
      cardNameNormalized: resolved.productNameNormalized,
      cardSet: resolved.setCode,
      marketUrl: resolved.marketUrl,
      kind: 'sealed',
      catalogId: resolved.uuid,
      sealedCategory: resolved.category,
      sealedSubtype: resolved.subtype,
      priceCents,
      quantity,
      notes,
      game: game.id,
      language: languageFor(universal.language, resolved.language),
    });
    await replyWithListing(interaction, listing, warning);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Could not create listing.');
  }
}

export const haveSealedCommand: GuildCommand = {
  name: 'have-sealed',
  data: addUniversalOptions(
    new SlashCommandBuilder()
      .setName('have-sealed')
      .setDescription('Post sealed product you have to sell or trade away')
      .addStringOption((option) =>
        option
          .setName('product_name')
          .setDescription('Sealed product name')
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
        option.setName('set').setDescription('Set code, e.g. BLB').setAutocomplete(true),
      )
      .addStringOption((option) =>
        option.setName('price').setDescription('Price in USD, e.g. 89.99 (optional)'),
      )
      .addIntegerOption((option) =>
        option.setName('quantity').setDescription('Quantity (1-99)').setMinValue(1).setMaxValue(99),
      )
      .addStringOption((option) =>
        option.setName('notes').setDescription('Optional notes (max 500 characters)'),
      ),
    { grade: false },
  ),
  execute,
  autocomplete: async (interaction) => {
    if (interaction.options.getFocused(true).name === 'set') {
      await handleSetAutocomplete(interaction, 'sealed');
      return;
    }
    await handleSealedAutocomplete(interaction);
  },
};

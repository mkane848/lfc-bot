import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createListing } from '../../services/listings.js';
import {
  autocompleteSealedProducts,
  autocompleteSealedSets,
  resolveSealedProduct,
} from '../../services/sealed.js';
import type { Accepts, GuildCommand } from '../../types/index.js';
import { ACCEPTS_VALUES } from '../../types/index.js';
import { ACCEPTS_LABELS } from '../../utils/constants.js';
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

  const rawProduct = interaction.options.getString('product_name', true);
  let productName: string;
  try {
    productName = validateCardName(rawProduct);
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

  const resolved = await resolveSealedProduct(productName, { setCode });

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
      manapoolUrl: resolved.manapoolUrl,
      kind: 'sealed',
      sealedUuid: resolved.uuid,
      sealedCategory: resolved.category,
      sealedSubtype: resolved.subtype,
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

export const haveSealedCommand: GuildCommand = {
  name: 'have-sealed',
  data: new SlashCommandBuilder()
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
  execute,
  autocomplete: async (interaction) => {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'set') {
      const choices = autocompleteSealedSets(focused.value);
      await interaction.respond(choices);
      return;
    }
    const setCode = interaction.options.getString('set');
    const choices = autocompleteSealedProducts(focused.value, setCode);
    await interaction.respond(choices);
  },
};

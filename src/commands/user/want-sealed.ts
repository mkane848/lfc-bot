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
 * Handle `/want-sealed`: validate the submitted product/max-price fields,
 * resolve the product against the sealed catalog (falling back to a
 * free-text listing on a catalog miss), and post one "want" listing. Sealed
 * product is NM by definition and has no printing variants, so unlike
 * `/want` there is no `condition`/`finish`/`variant`/`collector_number`
 * option. Unlike `/have-sealed`, there is also no `quantity` option —
 * `insertListingRow` defaults it to 1.
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
  const maxPriceInput = interaction.options.getString('max_price');
  let maxPrice: number | null;
  try {
    maxPrice = maxPriceInput ? parsePriceToCents(maxPriceInput) : null;
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid max price.');
    return;
  }
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
      intent: 'want',
      accepts,
      cardName: resolved.productName,
      cardNameNormalized: resolved.productNameNormalized,
      cardSet: resolved.setCode,
      manapoolUrl: resolved.manapoolUrl,
      kind: 'sealed',
      sealedUuid: resolved.uuid,
      sealedCategory: resolved.category,
      sealedSubtype: resolved.subtype,
      priceCents: maxPrice,
      notes,
      game: 'mtg',
    });
    await replyWithListing(interaction, listing, warning);
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Could not create listing.');
  }
}

export const wantSealedCommand: GuildCommand = {
  name: 'want-sealed',
  data: new SlashCommandBuilder()
    .setName('want-sealed')
    .setDescription('Post sealed product you want to buy or trade for')
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
        .setDescription('What you can offer in return')
        .setRequired(true)
        .addChoices(...ACCEPTS_VALUES.map((a) => ({ name: ACCEPTS_LABELS[a], value: a }))),
    )
    .addStringOption((option) =>
      option.setName('set').setDescription('Set code, e.g. BLB').setAutocomplete(true),
    )
    .addStringOption((option) =>
      option.setName('max_price').setDescription('Maximum price in USD, e.g. 100.00'),
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

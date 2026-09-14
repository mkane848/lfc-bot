import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { createListingsBatch, type CreateListingResult } from '../../services/listings.js';
import { resolveCard } from '../../services/scryfall.js';
import { resolveSealedProduct } from '../../services/sealed.js';
import type { GuildCommand, ListingCreateInput, ListingKind } from '../../types/index.js';
import {
  parseBatchAccepts,
  parseWantBatchLine,
  parseWantSealedBatchLine,
} from '../../utils/batch.js';
import {
  decodeMultiModalKind,
  encodeMultiModalId,
  WANT_MULTI_MODAL_ID,
} from '../../utils/customId.js';
import { replyError, replyPublicText } from '../../utils/replies.js';

const CARD_SLOTS = 3;

/** Handle `/want-multi`: open the batch "want" modal (submission is handled by `handleWantMultiModal`). */
async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      ephemeral: true,
    });
    return;
  }
  const kind: ListingKind = interaction.options.getString('type') === 'sealed' ? 'sealed' : 'card';
  await interaction.showModal(buildWantMultiModal(kind));
}

function buildWantMultiModal(kind: ListingKind): ModalBuilder {
  const sealed = kind === 'sealed';
  const noun = sealed ? 'Product' : 'Card';
  const format = sealed ? 'name | max_price' : 'name | condition | max_price';
  const example = sealed ? 'Bloomburrow Bundle | 100.00' : 'Solitude | nm | 15.00';

  const cardRows = Array.from({ length: CARD_SLOTS }, (_, index) => {
    const slot = index + 1;
    return new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        // The field id stays `card{n}` for both kinds so the submit handler
        // reads one set of names; only the label and format differ.
        .setCustomId(`card${slot}`)
        .setLabel(`${noun} ${slot} (${format})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(example)
        .setRequired(false)
        .setMaxLength(200),
    );
  });
  const acceptsRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId('accepts')
      .setLabel('Accepts (cash, trade, or both)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(12),
  );
  return new ModalBuilder()
    .setCustomId(encodeMultiModalId(WANT_MULTI_MODAL_ID, kind))
    .setTitle(sealed ? 'Post multiple sealed products you want' : 'Post multiple cards you want')
    .addComponents(...cardRows, acceptsRow);
}

interface LineOutcome {
  slot: number;
  message: string;
}

/** Handle the /want-multi modal submission. */
export async function handleWantMultiModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  const kind = decodeMultiModalKind(interaction.customId);
  const noun = kind === 'sealed' ? 'Product' : 'Card';

  let accepts;
  try {
    accepts = parseBatchAccepts(interaction.fields.getTextInputValue('accepts'));
  } catch (err) {
    await replyError(interaction, err instanceof Error ? err.message : 'Invalid accepts value.');
    return;
  }

  const failures: LineOutcome[] = [];
  const readyInputs: ListingCreateInput[] = [];
  const readySlots: number[] = [];

  for (let slot = 1; slot <= CARD_SLOTS; slot++) {
    const raw = interaction.fields.getTextInputValue(`card${slot}`);
    if (raw.trim() === '') {
      continue;
    }
    try {
      if (kind === 'sealed') {
        const parsed = parseWantSealedBatchLine(raw);
        // No resolution guard here, unlike the card branch below: a catalog
        // miss returns a free-text result and still posts, matching
        // `/want-sealed`.
        const resolved = await resolveSealedProduct(parsed.productName);
        readyInputs.push({
          serverId: guild.id,
          userId: interaction.user.id,
          username: interaction.user.displayName,
          intent: 'want',
          accepts,
          kind: 'sealed',
          cardName: resolved.productName,
          cardNameNormalized: resolved.productNameNormalized,
          cardSet: resolved.setCode,
          manapoolUrl: resolved.manapoolUrl,
          sealedUuid: resolved.uuid,
          sealedCategory: resolved.category,
          sealedSubtype: resolved.subtype,
          priceCents: parsed.maxPriceCents,
          game: 'mtg',
        });
        readySlots.push(slot);
        continue;
      }
      const parsed = parseWantBatchLine(raw);
      const resolved = await resolveCard(parsed.cardName, {});
      if (!resolved.resolved) {
        failures.push({
          slot,
          message: `${noun} ${slot}: could not resolve "${parsed.cardName}".`,
        });
        continue;
      }
      readyInputs.push({
        serverId: guild.id,
        userId: interaction.user.id,
        username: interaction.user.displayName,
        intent: 'want',
        accepts,
        cardName: resolved.cardName,
        cardNameNormalized: resolved.cardNameNormalized,
        cardSet: resolved.cardSet,
        cardImageUrl: resolved.cardImageUrl,
        manapoolUrl: resolved.manapoolUrl,
        collectorNumber: resolved.collectorNumber,
        condition: parsed.condition,
        priceCents: parsed.maxPriceCents,
        game: 'mtg',
      });
      readySlots.push(slot);
    } catch (err) {
      failures.push({
        slot,
        message: `${noun} ${slot}: ${err instanceof Error ? err.message : 'invalid input.'}`,
      });
    }
  }

  if (readyInputs.length === 0) {
    await replyError(
      interaction,
      failures.length > 0
        ? failures.map((f) => f.message).join('\n')
        : `No ${kind === 'sealed' ? 'products' : 'cards'} were entered.`,
    );
    return;
  }

  let results: CreateListingResult[];
  try {
    results = createListingsBatch(readyInputs);
  } catch (err) {
    await replyError(
      interaction,
      [
        ...failures.map((f) => f.message),
        err instanceof Error ? err.message : 'Could not post this batch.',
      ].join('\n'),
    );
    return;
  }

  const outcomes: LineOutcome[] = [...failures];
  results.forEach((result, index) => {
    const slot = readySlots[index];
    if (slot === undefined) {
      return;
    }
    let message = `${noun} ${slot}: posted #${result.listing.id} — ${result.listing.cardName}.`;
    if (result.warning) {
      message += ` (${result.warning})`;
    }
    outcomes.push({ slot, message });
  });
  outcomes.sort((a, b) => a.slot - b.slot);

  await replyPublicText(interaction, outcomes.map((o) => o.message).join('\n'));
}

export const wantMultiCommand: GuildCommand = {
  name: 'want-multi',
  data: new SlashCommandBuilder()
    .setName('want-multi')
    .setDescription('Post up to 3 cards or sealed products you want in one go')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('What you are posting (default: cards)')
        .addChoices({ name: 'Cards', value: 'card' }, { name: 'Sealed product', value: 'sealed' }),
    ),
  execute,
};

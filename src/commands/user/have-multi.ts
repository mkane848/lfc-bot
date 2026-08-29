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
import type { GuildCommand, ListingCreateInput } from '../../types/index.js';
import { parseBatchAccepts, parseHaveBatchLine } from '../../utils/batch.js';

const MODAL_CUSTOM_ID = 'lfc:havemultimodal';
const CARD_SLOTS = 3;

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      ephemeral: true,
    });
    return;
  }
  await interaction.showModal(buildHaveMultiModal());
}

function buildHaveMultiModal(): ModalBuilder {
  const cardRows = Array.from({ length: CARD_SLOTS }, (_, index) => {
    const slot = index + 1;
    return new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(`card${slot}`)
        .setLabel(`Card ${slot} (name | condition | price | qty)`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Lightning Bolt | nm | 2.50 | 2')
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
    .setCustomId(MODAL_CUSTOM_ID)
    .setTitle('Post multiple cards you have')
    .addComponents(...cardRows, acceptsRow);
}

interface LineOutcome {
  slot: number;
  message: string;
}

/** Handle the /have-multi modal submission. */
export async function handleHaveMultiModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      ephemeral: true,
    });
    return;
  }

  let accepts;
  try {
    accepts = parseBatchAccepts(interaction.fields.getTextInputValue('accepts'));
  } catch (err) {
    await interaction.reply({
      content: err instanceof Error ? err.message : 'Invalid accepts value.',
      ephemeral: true,
    });
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
      const parsed = parseHaveBatchLine(raw);
      const resolved = await resolveCard(parsed.cardName, {});
      if (!resolved.resolved) {
        failures.push({ slot, message: `Card ${slot}: could not resolve "${parsed.cardName}".` });
        continue;
      }
      readyInputs.push({
        serverId: guild.id,
        userId: interaction.user.id,
        username: interaction.user.displayName,
        intent: 'have',
        accepts,
        cardName: resolved.cardName,
        cardNameNormalized: resolved.cardNameNormalized,
        cardSet: resolved.cardSet,
        cardImageUrl: resolved.cardImageUrl,
        manapoolUrl: resolved.manapoolUrl,
        collectorNumber: resolved.collectorNumber,
        condition: parsed.condition,
        priceCents: parsed.priceCents,
        quantity: parsed.quantity,
        game: 'mtg',
      });
      readySlots.push(slot);
    } catch (err) {
      failures.push({
        slot,
        message: `Card ${slot}: ${err instanceof Error ? err.message : 'invalid input.'}`,
      });
    }
  }

  if (readyInputs.length === 0) {
    await interaction.reply({
      content:
        failures.length > 0 ? failures.map((f) => f.message).join('\n') : 'No cards were entered.',
      ephemeral: true,
    });
    return;
  }

  let results: CreateListingResult[];
  try {
    results = createListingsBatch(readyInputs);
  } catch (err) {
    await interaction.reply({
      content: [
        ...failures.map((f) => f.message),
        err instanceof Error ? err.message : 'Could not post this batch.',
      ].join('\n'),
      ephemeral: true,
    });
    return;
  }

  const outcomes: LineOutcome[] = [...failures];
  results.forEach((result, index) => {
    const slot = readySlots[index];
    if (slot === undefined) {
      return;
    }
    let message = `Card ${slot}: posted #${result.listing.id} — ${result.listing.cardName}.`;
    if (result.warning) {
      message += ` (${result.warning})`;
    }
    outcomes.push({ slot, message });
  });
  outcomes.sort((a, b) => a.slot - b.slot);

  await interaction.reply({
    content: outcomes.map((o) => o.message).join('\n'),
    ephemeral: false,
  });
}

export const haveMultiCommand: GuildCommand = {
  name: 'have-multi',
  data: new SlashCommandBuilder()
    .setName('have-multi')
    .setDescription('Post up to 3 cards you have to sell or trade away in one go'),
  execute,
};

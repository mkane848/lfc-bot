import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { wantCommand } from '../../../src/commands/user/want.js';
import * as scryfall from '../../../src/services/scryfall.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

vi.mock('../../../src/services/scryfall.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/scryfall.js')>();
  return { ...actual, resolveCard: vi.fn() };
});

const resolveCard = vi.mocked(scryfall.resolveCard);

const serverRow: NewServerRow = {
  id: 'guild-1',
  digestMode: 'disabled',
  digestCron: '0 9 * * *',
  digestTimezone: 'UTC',
  enabledGames: '["mtg"]',
  adminChannelId: null,
  digestDmUserId: null,
  lastDigestAt: null,
  removedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  resolveCard.mockReset();
  resolveCard.mockResolvedValue({
    scryfallId: 'lotus-id',
    cardName: 'Black Lotus',
    cardNameNormalized: 'black lotus',
    cardSet: 'LEA',
    cardImageUrl: 'http://img/lotus.png',
    collectorNumber: '232',
    manapoolUrl: null,
    manapoolPriceCents: null,
    resolved: true,
  });
});

function interaction(strings: Record<string, string | null> = {}) {
  return fakeChatInputInteraction({
    options: {
      strings: { card_name: 'Black Lotus', accepts: 'cash', condition: null, ...strings },
    },
  });
}

describe('/want', () => {
  it('posts a listing and replies with the created embed', async () => {
    const i = interaction();
    await wantCommand.execute(i);

    expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
  });

  it('rejects outside a guild before deferring', async () => {
    const i = fakeChatInputInteraction({
      guildId: null,
      options: { strings: { card_name: 'Black Lotus', accepts: 'cash' } },
    });
    await wantCommand.execute(i);

    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
  });

  it('replies with the specific resolution error instead of throwing when the card is unresolved', async () => {
    resolveCard.mockResolvedValue({
      scryfallId: null,
      cardName: 'Not A Card',
      cardNameNormalized: 'not a card',
      cardSet: null,
      cardImageUrl: null,
      collectorNumber: null,
      manapoolUrl: null,
      manapoolPriceCents: null,
      resolved: false,
    });
    const i = interaction({ card_name: 'Not A Card' });

    await expect(wantCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('could not resolve') }),
    );
  });

  it('replies with a validation error for an invalid max_price instead of throwing', async () => {
    const i = interaction({ max_price: 'not-a-number' });

    await expect(wantCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Price must be') }),
    );
    expect(resolveCard).not.toHaveBeenCalled();
  });

  it('replies with a validation error for a too-long card name instead of throwing', async () => {
    const i = interaction({ card_name: 'x'.repeat(101) });

    await expect(wantCommand.execute(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('too long') }),
    );
  });
});

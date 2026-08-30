import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import {
  listings,
  servers,
  type NewListingRow,
  type NewServerRow,
} from '../../../src/db/schema.js';
import {
  editCommand,
  handleEditModal,
  handleEditNextButton,
} from '../../../src/commands/user/edit.js';
import { encodeEditModalId, encodeEditNextId } from '../../../src/utils/customId.js';
import * as scryfall from '../../../src/services/scryfall.js';
import {
  fakeButtonInteraction,
  fakeChatInputInteraction,
  fakeModalSubmitInteraction,
} from '../../helpers/interaction.js';
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

function seedListing(overrides: Partial<NewListingRow> = {}): number {
  const row: NewListingRow = {
    serverId: 'guild-1',
    userId: 'owner-1',
    username: 'alice',
    intent: 'have',
    accepts: 'cash',
    game: 'mtg',
    cardName: 'Black Lotus',
    cardNameNormalized: 'black lotus',
    cardSet: 'LEA',
    cardImageUrl: null,
    finish: null,
    variant: null,
    collectorNumber: null,
    manapoolUrl: null,
    condition: 'nm',
    priceCents: 100,
    quantity: 1,
    notes: null,
    status: 'active',
    expiresAt: Date.now() + 1000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
  const result = getDb().insert(listings).values(row).returning({ id: listings.id }).get();
  return result.id;
}

beforeEach(() => {
  getDb().insert(servers).values(serverRow).run();
  resolveCard.mockReset();
});

describe('/edit', () => {
  it('shows the edit modal to the owner', async () => {
    const id = seedListing();
    const i = fakeChatInputInteraction({
      userId: 'owner-1',
      options: { integers: { listing_id: id } },
    });

    await editCommand.execute(i);

    expect(i.showModal).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-owner without showing the modal', async () => {
    const id = seedListing();
    const i = fakeChatInputInteraction({
      userId: 'someone-else',
      options: { integers: { listing_id: id } },
    });

    await editCommand.execute(i);

    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Only the listing owner') }),
    );
  });
});

describe('handleEditModal', () => {
  it('updates the listing and replies with success', async () => {
    const id = seedListing();
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition: 'lp', price: '5.00', quantity: '2', set: 'LEA', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('updated') }),
    );
  });

  it('replies with the specific error for an invalid condition instead of throwing (regression)', async () => {
    const id = seedListing();
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition: 'bogus', price: '', quantity: '', set: 'LEA', notes: '' },
    });

    await expect(handleEditModal(i)).resolves.toBeUndefined();

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid condition') }),
    );
  });

  it('rejects a non-owner', async () => {
    const id = seedListing();
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'someone-else',
      fields: { condition: '', price: '', quantity: '', set: 'LEA', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Only the listing owner') }),
    );
  });

  it('re-resolves the card when the set changes and reports failure to resolve', async () => {
    const id = seedListing();
    resolveCard.mockResolvedValue({
      scryfallId: null,
      cardName: 'Black Lotus',
      cardNameNormalized: 'black lotus',
      cardSet: null,
      cardImageUrl: null,
      collectorNumber: null,
      manapoolUrl: null,
      manapoolPriceCents: null,
      resolved: false,
    });
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(id),
      userId: 'owner-1',
      fields: { condition: '', price: '', quantity: '', set: 'MH3', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Could not find') }),
    );
  });

  it('shows an "Edit next" button when a batch queue remains', async () => {
    const first = seedListing();
    const second = seedListing({ cardName: 'Lightning Bolt' });
    const i = fakeModalSubmitInteraction({
      customId: encodeEditModalId(first, [second]),
      userId: 'owner-1',
      fields: { condition: '', price: '', quantity: '', set: 'LEA', notes: '' },
    });

    await handleEditModal(i);

    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ components: expect.any(Array) }),
    );
  });
});

describe('handleEditNextButton', () => {
  it('opens the next listing modal for the owner', async () => {
    const first = seedListing();
    const second = seedListing({ cardName: 'Lightning Bolt' });
    const i = fakeButtonInteraction({
      customId: encodeEditNextId(second, []),
      userId: 'owner-1',
    });
    void first;

    await handleEditNextButton(i);

    expect(i.showModal).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-owner', async () => {
    const id = seedListing();
    const i = fakeButtonInteraction({
      customId: encodeEditNextId(id, []),
      userId: 'someone-else',
    });

    await handleEditNextButton(i);

    expect(i.showModal).not.toHaveBeenCalled();
  });
});

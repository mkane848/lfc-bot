import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import {
  listings,
  servers,
  type NewListingRow,
  type NewServerRow,
} from '../../../src/db/schema.js';
import {
  handleBatchSelect,
  handleListingButton,
  myListingsCommand,
} from '../../../src/commands/user/mylistings.js';
import { encodeBatchSelectId, encodeListingActionId } from '../../../src/utils/customId.js';
import { getListingById } from '../../../src/services/listings.js';
import {
  fakeButtonInteraction,
  fakeChatInputInteraction,
  fakeSelectMenuInteraction,
} from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

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
});

describe('/mylistings execute', () => {
  it("shows the caller's listings with fulfill/delete buttons", async () => {
    seedListing();
    const i = fakeChatInputInteraction({ userId: 'owner-1' });

    await myListingsCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) }),
    );
  });

  it('replies with "no active listings" when the caller has none', async () => {
    const i = fakeChatInputInteraction({ userId: 'owner-1' });

    await myListingsCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no active listings') }),
    );
  });
});

describe('handleListingButton', () => {
  it('lets the owner fulfill their listing', async () => {
    const id = seedListing();
    const i = fakeButtonInteraction({
      customId: encodeListingActionId('fulfill', id),
      userId: 'owner-1',
    });

    await handleListingButton(i);

    expect(getListingById(id)?.status).toBe('fulfilled');
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('fulfilled') }),
    );
  });

  it('rejects a non-owner fulfill attempt', async () => {
    const id = seedListing();
    const i = fakeButtonInteraction({
      customId: encodeListingActionId('fulfill', id),
      userId: 'someone-else',
    });

    await handleListingButton(i);

    expect(getListingById(id)?.status).toBe('active');
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Only the listing owner') }),
    );
  });

  it('lets the owner delete their listing', async () => {
    const id = seedListing();
    const i = fakeButtonInteraction({
      customId: encodeListingActionId('delete', id),
      userId: 'owner-1',
    });

    await handleListingButton(i);

    expect(getListingById(id)?.status).toBe('deleted');
  });

  it('rejects a non-owner delete attempt', async () => {
    const id = seedListing();
    const i = fakeButtonInteraction({
      customId: encodeListingActionId('delete', id),
      userId: 'someone-else',
    });

    await handleListingButton(i);

    expect(getListingById(id)?.status).toBe('active');
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Only the listing owner') }),
    );
  });
});

describe('handleBatchSelect', () => {
  it('fulfills owned listings and skips ones not owned by the caller', async () => {
    const mine = seedListing();
    const notMine = seedListing({ userId: 'someone-else' });
    const i = fakeSelectMenuInteraction({
      customId: encodeBatchSelectId('batchfulfill'),
      values: [String(mine), String(notMine)],
      userId: 'owner-1',
    });

    await handleBatchSelect(i);

    expect(getListingById(mine)?.status).toBe('fulfilled');
    expect(getListingById(notMine)?.status).toBe('active');
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(new RegExp(`Fulfilled #${mine}`)),
      }),
    );
    const call = i.reply.mock.calls[0]?.[0] as { content: string };
    expect(call.content).toContain('Skipped');
  });

  it('deletes owned listings and skips ones not owned by the caller', async () => {
    const mine = seedListing();
    const notMine = seedListing({ userId: 'someone-else' });
    const i = fakeSelectMenuInteraction({
      customId: encodeBatchSelectId('batchdelete'),
      values: [String(mine), String(notMine)],
      userId: 'owner-1',
    });

    await handleBatchSelect(i);

    expect(getListingById(mine)?.status).toBe('deleted');
    expect(getListingById(notMine)?.status).toBe('active');
  });

  it('opens an edit modal for the first selected id, queuing the rest', async () => {
    const first = seedListing();
    const second = seedListing();
    const i = fakeSelectMenuInteraction({
      customId: encodeBatchSelectId('batchedit'),
      values: [String(first), String(second)],
      userId: 'owner-1',
    });

    await handleBatchSelect(i);

    expect(i.showModal).toHaveBeenCalledTimes(1);
  });
});

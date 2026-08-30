import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/index.js';
import {
  listings,
  servers,
  type NewListingRow,
  type NewServerRow,
} from '../../../src/db/schema.js';
import { execute as removeExecute } from '../../../src/commands/admin/remove.js';
import { getListingById } from '../../../src/services/listings.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

function seedServer(id: string): void {
  const row: NewServerRow = {
    id,
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
  getDb().insert(servers).values(row).run();
}

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
  seedServer('guild-1');
});

describe('/admin remove', () => {
  it('replies with an error when the listing does not exist', async () => {
    const i = fakeChatInputInteraction({ options: { integers: { listing_id: 999 } } });

    await removeExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Listing not found') }),
    );
  });

  it('rejects a listing that belongs to a different server', async () => {
    seedServer('guild-2');
    const id = seedListing({ serverId: 'guild-2' });
    const i = fakeChatInputInteraction({ options: { integers: { listing_id: id } } });

    await removeExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not in this server') }),
    );
    expect(getListingById(id)?.status).toBe('active');
  });

  it('removes a listing belonging to this server regardless of who owns it', async () => {
    const id = seedListing({ userId: 'someone-else' });
    const i = fakeChatInputInteraction({ options: { integers: { listing_id: id } } });

    await removeExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('removed') }),
    );
    expect(getListingById(id)?.status).toBe('deleted');
  });
});

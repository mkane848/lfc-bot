import { describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { listings, servers, type NewListingRow, type NewServerRow } from '../../src/db/schema.js';
import {
  clearRemovalMarker,
  expireListings,
  markServerForRemoval,
  purgeMarkedServers,
} from '../../src/services/listing-expiry.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

function seedServer(id: string, overrides: Partial<NewServerRow> = {}): void {
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
    ...overrides,
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

describe('expireListings', () => {
  it('marks a past-due active listing as expired', () => {
    seedServer('guild-1');
    const id = seedListing({ expiresAt: Date.now() - 1000 });

    const count = expireListings();

    expect(count).toBe(1);
    const row = getDb()
      .select()
      .from(listings)
      .all()
      .find((l) => l.id === id);
    expect(row?.status).toBe('expired');
  });

  it('leaves listings that are not yet expired alone', () => {
    seedServer('guild-1');
    const id = seedListing({ expiresAt: Date.now() + 100_000 });

    const count = expireListings();

    expect(count).toBe(0);
    const row = getDb()
      .select()
      .from(listings)
      .all()
      .find((l) => l.id === id);
    expect(row?.status).toBe('active');
  });

  it('can be scoped to a single server', () => {
    seedServer('guild-1');
    seedServer('guild-2');
    const idA = seedListing({ serverId: 'guild-1', expiresAt: Date.now() - 1000 });
    const idB = seedListing({ serverId: 'guild-2', expiresAt: Date.now() - 1000 });

    const count = expireListings('guild-1');

    expect(count).toBe(1);
    const rows = getDb().select().from(listings).all();
    expect(rows.find((l) => l.id === idA)?.status).toBe('expired');
    expect(rows.find((l) => l.id === idB)?.status).toBe('active');
  });
});

describe('markServerForRemoval / clearRemovalMarker', () => {
  it('sets removedAt on the server row', () => {
    seedServer('guild-1');

    markServerForRemoval('guild-1');

    const row = getDb()
      .select()
      .from(servers)
      .all()
      .find((s) => s.id === 'guild-1');
    expect(row?.removedAt).not.toBeNull();
  });

  it('clears removedAt on the server row', () => {
    seedServer('guild-1');
    markServerForRemoval('guild-1');

    clearRemovalMarker('guild-1');

    const row = getDb()
      .select()
      .from(servers)
      .all()
      .find((s) => s.id === 'guild-1');
    expect(row?.removedAt).toBeNull();
  });
});

describe('purgeMarkedServers', () => {
  it('deletes servers marked before the cutoff and returns the count', () => {
    seedServer('old-guild', { removedAt: Date.now() - 100_000 });
    seedServer('recent-guild', { removedAt: Date.now() - 1_000 });
    seedServer('unmarked-guild');

    const count = purgeMarkedServers(50_000);

    expect(count).toBe(1);
    const remainingIds = getDb()
      .select()
      .from(servers)
      .all()
      .map((s) => s.id);
    expect(remainingIds).not.toContain('old-guild');
    expect(remainingIds).toContain('recent-guild');
    expect(remainingIds).toContain('unmarked-guild');
  });

  it('returns 0 when nothing is marked past the cutoff', () => {
    seedServer('guild-1');

    expect(purgeMarkedServers(50_000)).toBe(0);
  });
});

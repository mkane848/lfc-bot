import { describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { listings, servers, type NewServerRow } from '../../src/db/schema.js';
import {
  countSearchResults,
  createListing,
  fulfillListing,
  searchListings,
  softDeleteListing,
} from '../../src/services/listings.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

const serverRow: NewServerRow = {
  id: '200',
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

function seedServer(): void {
  getDb().insert(servers).values(serverRow).run();
}

function baseInput() {
  return {
    serverId: '200',
    userId: 'u1',
    username: 'alice',
    cardName: 'Black Lotus',
    cardNameNormalized: 'black lotus',
    cardSet: null,
    cardImageUrl: null,
    condition: 'nm',
    priceCents: 1000,
    quantity: 1,
    notes: null,
    game: 'mtg',
  } as const;
}

describe('createListing', () => {
  it('creates an active listing with a 30-day expiry', () => {
    seedServer();
    const { listing } = createListing({ ...baseInput(), listingType: 'sell' });
    expect(listing.status).toBe('active');
    expect(listing.expiresAt - listing.createdAt).toBe(30 * 24 * 3600 * 1000);
  });

  it('blocks a second listing within the cooldown', () => {
    seedServer();
    createListing({ ...baseInput(), listingType: 'sell' });
    expect(() => createListing({ ...baseInput(), listingType: 'buy' })).toThrow(
      /posting too quickly/,
    );
  });

  it('warns on a duplicate listing posted within 24h', () => {
    seedServer();
    const db = getDb();
    const past = Date.now() - 60_000; // past the 10s cooldown, inside the 24h window
    db.insert(listings)
      .values({
        serverId: '200',
        userId: 'u1',
        username: 'alice',
        listingType: 'sell',
        game: 'mtg',
        cardName: 'Black Lotus',
        cardNameNormalized: 'black lotus',
        cardSet: null,
        cardImageUrl: null,
        condition: 'nm',
        priceCents: 1000,
        quantity: 1,
        notes: null,
        status: 'active',
        expiresAt: past + 30 * 24 * 3600 * 1000,
        createdAt: past,
        updatedAt: past,
      })
      .run();

    const result = createListing({ ...baseInput(), listingType: 'sell' });
    expect(result.warning).toMatch(/already have an active matching listing/);
  });
});

describe('search and status transitions', () => {
  it('searches active listings and excludes non-matching statuses', () => {
    seedServer();
    const { listing } = createListing({ ...baseInput(), listingType: 'sell' });
    expect(searchListings('200', 'black lotus', undefined, 1)).toHaveLength(1);
    expect(countSearchResults('200', 'black lotus', undefined)).toBe(1);

    fulfillListing(listing.id);
    expect(searchListings('200', 'black lotus', undefined, 1)).toHaveLength(0);
    expect(countSearchResults('200', 'black lotus', undefined)).toBe(0);

    softDeleteListing(listing.id);
    expect(searchListings('200', 'black lotus', undefined, 1)).toHaveLength(0);
  });

  it('filters search by listing type', () => {
    seedServer();
    createListing({ ...baseInput(), listingType: 'sell' });
    expect(searchListings('200', 'black lotus', 'buy', 1)).toHaveLength(0);
    expect(searchListings('200', 'black lotus', 'sell', 1)).toHaveLength(1);
  });
});

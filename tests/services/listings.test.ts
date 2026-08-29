import { describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { listings, servers, type NewServerRow } from '../../src/db/schema.js';
import {
  activeListingsForUser,
  countSearchResults,
  createListing,
  createListingsBatch,
  fulfillListing,
  searchListings,
  softDeleteListing,
  updateListing,
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
    finish: null,
    variant: null,
    collectorNumber: null,
    manapoolUrl: null,
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
    const { listing } = createListing({ ...baseInput(), intent: 'have', accepts: 'cash' });
    expect(listing.status).toBe('active');
    expect(listing.expiresAt - listing.createdAt).toBe(30 * 24 * 3600 * 1000);
    expect(listing.intent).toBe('have');
    expect(listing.accepts).toBe('cash');
  });

  it('blocks a second listing within the cooldown', () => {
    seedServer();
    createListing({ ...baseInput(), intent: 'have', accepts: 'cash' });
    expect(() => createListing({ ...baseInput(), intent: 'want', accepts: 'cash' })).toThrow(
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
        intent: 'have',
        accepts: 'cash',
        game: 'mtg',
        cardName: 'Black Lotus',
        cardNameNormalized: 'black lotus',
        cardSet: null,
        cardImageUrl: null,
        finish: null,
        variant: null,
        collectorNumber: null,
        manapoolUrl: null,
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

    const result = createListing({ ...baseInput(), intent: 'have', accepts: 'cash' });
    expect(result.warning).toMatch(/already have an active matching listing/);
  });

  it('does not warn when the printing details differ', () => {
    seedServer();
    const db = getDb();
    const past = Date.now() - 60_000; // past the 10s cooldown, inside the 24h window
    db.insert(listings)
      .values({
        serverId: '200',
        userId: 'u1',
        username: 'alice',
        intent: 'have',
        accepts: 'cash',
        game: 'mtg',
        cardName: 'Black Lotus',
        cardNameNormalized: 'black lotus',
        cardSet: null,
        cardImageUrl: null,
        finish: null,
        variant: null,
        collectorNumber: null,
        manapoolUrl: null,
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

    const result = createListing({
      ...baseInput(),
      intent: 'have',
      accepts: 'cash',
      collectorNumber: '1',
      finish: 'foil',
    });
    expect(result.warning).toBeUndefined();
  });
});

describe('createListingsBatch', () => {
  it("creates every card in one batch without the cards tripping each other's cooldown", () => {
    seedServer();
    const results = createListingsBatch([
      {
        ...baseInput(),
        cardName: 'Card A',
        cardNameNormalized: 'card a',
        intent: 'have',
        accepts: 'cash',
      },
      {
        ...baseInput(),
        cardName: 'Card B',
        cardNameNormalized: 'card b',
        intent: 'have',
        accepts: 'cash',
      },
      {
        ...baseInput(),
        cardName: 'Card C',
        cardNameNormalized: 'card c',
        intent: 'have',
        accepts: 'cash',
      },
    ]);
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.listing.id)).size).toBe(3);
    expect(results.every((r) => r.listing.status === 'active')).toBe(true);
  });

  it('still enforces the cooldown once for the batch as a whole', () => {
    seedServer();
    createListingsBatch([
      {
        ...baseInput(),
        cardName: 'Card A',
        cardNameNormalized: 'card a',
        intent: 'have',
        accepts: 'cash',
      },
    ]);
    expect(() =>
      createListingsBatch([
        {
          ...baseInput(),
          cardName: 'Card B',
          cardNameNormalized: 'card b',
          intent: 'have',
          accepts: 'cash',
        },
      ]),
    ).toThrow(/posting too quickly/);
  });

  it('returns an empty array for an empty batch', () => {
    seedServer();
    expect(createListingsBatch([])).toEqual([]);
  });
});

describe('activeListingsForUser', () => {
  it("returns only the user's active listings, newest first", () => {
    seedServer();
    const { listing: first } = createListing({
      ...baseInput(),
      cardName: 'Card A',
      cardNameNormalized: 'card a',
      intent: 'have',
      accepts: 'cash',
    });
    const db = getDb();
    const later = first.createdAt + 20_000; // past the 10s cooldown
    db.insert(listings)
      .values({
        serverId: '200',
        userId: 'u1',
        username: 'alice',
        intent: 'have',
        accepts: 'cash',
        game: 'mtg',
        cardName: 'Card B',
        cardNameNormalized: 'card b',
        cardSet: null,
        cardImageUrl: null,
        finish: null,
        variant: null,
        collectorNumber: null,
        manapoolUrl: null,
        condition: 'nm',
        priceCents: 1000,
        quantity: 1,
        notes: null,
        status: 'active',
        expiresAt: later + 30 * 24 * 3600 * 1000,
        createdAt: later,
        updatedAt: later,
      })
      .run();
    // A listing from a different user should never show up.
    db.insert(listings)
      .values({
        serverId: '200',
        userId: 'u2',
        username: 'bob',
        intent: 'have',
        accepts: 'cash',
        game: 'mtg',
        cardName: 'Card C',
        cardNameNormalized: 'card c',
        cardSet: null,
        cardImageUrl: null,
        finish: null,
        variant: null,
        collectorNumber: null,
        manapoolUrl: null,
        condition: 'nm',
        priceCents: 1000,
        quantity: 1,
        notes: null,
        status: 'active',
        expiresAt: later + 30 * 24 * 3600 * 1000,
        createdAt: later,
        updatedAt: later,
      })
      .run();

    const rows = activeListingsForUser('200', 'u1');
    expect(rows.map((r) => r.cardName)).toEqual(['Card B', 'Card A']);
  });

  it('respects the limit parameter', () => {
    seedServer();
    createListingsBatch(
      Array.from({ length: 5 }, (_, i) => ({
        ...baseInput(),
        cardName: `Card ${i}`,
        cardNameNormalized: `card ${i}`,
        intent: 'have' as const,
        accepts: 'cash' as const,
      })),
    );
    expect(activeListingsForUser('200', 'u1', 2)).toHaveLength(2);
  });
});

describe('search and status transitions', () => {
  it('searches active listings and excludes non-matching statuses', () => {
    seedServer();
    const { listing } = createListing({ ...baseInput(), intent: 'have', accepts: 'cash' });
    expect(searchListings('200', 'black lotus', undefined, undefined, 1)).toHaveLength(1);
    expect(countSearchResults('200', 'black lotus', undefined, undefined)).toBe(1);

    fulfillListing(listing.id);
    expect(searchListings('200', 'black lotus', undefined, undefined, 1)).toHaveLength(0);
    expect(countSearchResults('200', 'black lotus', undefined, undefined)).toBe(0);

    softDeleteListing(listing.id);
    expect(searchListings('200', 'black lotus', undefined, undefined, 1)).toHaveLength(0);
  });

  it('filters search by intent', () => {
    seedServer();
    createListing({ ...baseInput(), intent: 'have', accepts: 'cash' });
    expect(searchListings('200', 'black lotus', 'want', undefined, 1)).toHaveLength(0);
    expect(searchListings('200', 'black lotus', 'have', undefined, 1)).toHaveLength(1);
  });

  it('matches an accepts:both listing against a cash or trade filter, but not the reverse', () => {
    seedServer();
    createListing({ ...baseInput(), intent: 'have', accepts: 'both' });
    expect(searchListings('200', 'black lotus', undefined, 'cash', 1)).toHaveLength(1);
    expect(searchListings('200', 'black lotus', undefined, 'trade', 1)).toHaveLength(1);
    expect(searchListings('200', 'black lotus', undefined, 'both', 1)).toHaveLength(1);
  });

  it('an exact-only cash listing does not match a both filter', () => {
    seedServer();
    createListing({ ...baseInput(), intent: 'have', accepts: 'cash' });
    expect(searchListings('200', 'black lotus', undefined, 'both', 1)).toHaveLength(0);
    expect(searchListings('200', 'black lotus', undefined, 'cash', 1)).toHaveLength(1);
    expect(searchListings('200', 'black lotus', undefined, 'trade', 1)).toHaveLength(0);
  });
});

describe('updateListing', () => {
  it('leaves printing fields untouched when they are not included in the update', () => {
    seedServer();
    const { listing } = createListing({
      ...baseInput(),
      intent: 'have',
      accepts: 'cash',
      cardSet: 'LEA',
      collectorNumber: '232',
      manapoolUrl: 'https://manapool.com/card/lea/232/black-lotus',
    });
    const updated = updateListing(listing.id, { priceCents: 2000 });
    expect(updated?.cardSet).toBe('LEA');
    expect(updated?.collectorNumber).toBe('232');
    expect(updated?.manapoolUrl).toBe('https://manapool.com/card/lea/232/black-lotus');
    expect(updated?.priceCents).toBe(2000);
  });

  it('updates the printing fields together when a new set is resolved', () => {
    seedServer();
    const { listing } = createListing({
      ...baseInput(),
      intent: 'have',
      accepts: 'cash',
      cardSet: 'LEA',
      collectorNumber: '232',
      cardImageUrl: 'http://img/lea-lotus.png',
      manapoolUrl: 'https://manapool.com/card/lea/232/black-lotus',
    });
    const updated = updateListing(listing.id, {
      cardSet: '2ED',
      collectorNumber: '233',
      cardImageUrl: 'http://img/2ed-lotus.png',
      manapoolUrl: 'https://manapool.com/card/2ed/233/black-lotus',
    });
    expect(updated?.cardSet).toBe('2ED');
    expect(updated?.collectorNumber).toBe('233');
    expect(updated?.cardImageUrl).toBe('http://img/2ed-lotus.png');
    expect(updated?.manapoolUrl).toBe('https://manapool.com/card/2ed/233/black-lotus');
  });

  it('can clear the collector number and Manapool link (e.g. when the set is cleared)', () => {
    seedServer();
    const { listing } = createListing({
      ...baseInput(),
      intent: 'have',
      accepts: 'cash',
      cardSet: 'LEA',
      collectorNumber: '232',
      manapoolUrl: 'https://manapool.com/card/lea/232/black-lotus',
    });
    const updated = updateListing(listing.id, {
      cardSet: null,
      collectorNumber: null,
      manapoolUrl: null,
    });
    expect(updated?.cardSet).toBeNull();
    expect(updated?.collectorNumber).toBeNull();
    expect(updated?.manapoolUrl).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/index.js';
import { servers, listings, type NewServerRow, type NewListingRow } from '../../src/db/schema.js';
import { setupTestDb, sql } from '../helpers/db.js';

setupTestDb();

function serverRow(overrides: Partial<NewServerRow> = {}): NewServerRow {
  return {
    id: '100',
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
}

describe('database schema', () => {
  it('inserts and reads a server row with defaults', () => {
    const db = getDb();
    db.insert(servers).values(serverRow()).run();
    const row = db.select().from(servers).where(eq(servers.id, '100')).get();
    expect(row?.digestMode).toBe('disabled');
    expect(row?.digestCron).toBe('0 9 * * *');
  });

  it('cascades deletion of a server to its listings', () => {
    const db = getDb();
    db.insert(servers)
      .values(serverRow({ id: '101' }))
      .run();
    const listing: NewListingRow = {
      serverId: '101',
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
      expiresAt: 200,
      createdAt: 100,
      updatedAt: 100,
    };
    db.insert(listings).values(listing).run();
    expect(sql().prepare('select count(*) as c from listings').get()).toEqual({ c: 1 });

    db.delete(servers).where(eq(servers.id, '101')).run();
    expect(sql().prepare('select count(*) as c from listings').get()).toEqual({ c: 0 });
  });

  it('rejects listings without intent or accepts', () => {
    const db = getDb();
    db.insert(servers)
      .values(serverRow({ id: '102' }))
      .run();
    expect(() =>
      sql()
        .prepare(
          `insert into listings (server_id, user_id, username, game, card_name, card_name_normalized, quantity, status, expires_at, created_at, updated_at)
           values ('102', 'u1', 'alice', 'mtg', 'Black Lotus', 'black lotus', 1, 'active', 200, 100, 100)`,
        )
        .run(),
    ).toThrow(/NOT NULL constraint failed/);
  });
});

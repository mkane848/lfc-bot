import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/index.js';
import {
  servers,
  listings,
  sealedCache,
  sealedCatalogMeta,
  type NewServerRow,
  type NewListingRow,
  type NewSealedCacheRow,
  type NewSealedCatalogMetaRow,
} from '../../src/db/schema.js';
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

  it('defaults a listing to kind card with the sealed columns null', () => {
    const db = getDb();
    db.insert(servers)
      .values(serverRow({ id: '103' }))
      .run();
    const listing: NewListingRow = {
      serverId: '103',
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

    const row = db.select().from(listings).where(eq(listings.serverId, '103')).get();
    expect(row?.kind).toBe('card');
    expect(row?.sealedUuid).toBeNull();
    expect(row?.sealedCategory).toBeNull();
    expect(row?.sealedSubtype).toBeNull();
  });

  it('stores a sealed listing with its sealed columns', () => {
    const db = getDb();
    db.insert(servers)
      .values(serverRow({ id: '104' }))
      .run();
    const listing: NewListingRow = {
      serverId: '104',
      userId: 'u1',
      username: 'alice',
      intent: 'have',
      accepts: 'cash',
      game: 'mtg',
      cardName: 'Bloomburrow Bundle',
      cardNameNormalized: 'bloomburrow bundle',
      cardSet: 'BLB',
      cardImageUrl: null,
      finish: null,
      variant: null,
      collectorNumber: null,
      manapoolUrl: 'https://manapool.com/sealed/blb/bundle',
      condition: null,
      priceCents: 4000,
      quantity: 1,
      notes: null,
      status: 'active',
      kind: 'sealed',
      sealedUuid: 'ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb',
      sealedCategory: 'bundle',
      sealedSubtype: 'default',
      expiresAt: 200,
      createdAt: 100,
      updatedAt: 100,
    };
    db.insert(listings).values(listing).run();

    const row = db.select().from(listings).where(eq(listings.serverId, '104')).get();
    expect(row?.kind).toBe('sealed');
    expect(row?.sealedUuid).toBe('ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb');
    expect(row?.sealedCategory).toBe('bundle');
    expect(row?.sealedSubtype).toBe('default');
    expect(row?.condition).toBeNull();
  });

  it('round-trips a sealed cache row', () => {
    const db = getDb();
    const product: NewSealedCacheRow = {
      uuid: 'ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb',
      name: 'Bloomburrow Bundle',
      nameNormalized: 'bloomburrow bundle',
      setCode: 'BLB',
      category: 'bundle',
      subtype: null,
      releaseDate: null,
      updatedAt: 100,
    };
    db.insert(sealedCache).values(product).run();

    const row = db
      .select()
      .from(sealedCache)
      .where(eq(sealedCache.uuid, 'ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb'))
      .get();
    expect(row?.name).toBe('Bloomburrow Bundle');
    expect(row?.nameNormalized).toBe('bloomburrow bundle');
    expect(row?.setCode).toBe('BLB');
    expect(row?.category).toBe('bundle');
    expect(row?.subtype).toBeNull();
    expect(row?.releaseDate).toBeNull();
    expect(row?.updatedAt).toBe(100);
  });

  it('round-trips the single sealed catalog meta row', () => {
    const db = getDb();
    const meta: NewSealedCatalogMetaRow = {
      id: 1,
      buildVersion: '5.3.0+20260907',
      setListEtag: '"abc123"',
      syncedAt: 100,
    };
    db.insert(sealedCatalogMeta).values(meta).run();

    const row = db.select().from(sealedCatalogMeta).where(eq(sealedCatalogMeta.id, 1)).get();
    expect(row?.buildVersion).toBe('5.3.0+20260907');
    expect(row?.setListEtag).toBe('"abc123"');
    expect(row?.syncedAt).toBe(100);
    expect(sql().prepare('select count(*) as c from sealed_catalog_meta').get()).toEqual({ c: 1 });
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

import { describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { listings, servers, type NewServerRow, type NewListingRow } from '../../src/db/schema.js';
import {
  getServerConfig,
  initializeWatermarkIfNeeded,
  prepareDigestListings,
  setServerWatermark,
  upsertServerConfig,
} from '../../src/services/digest-state.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

const serverRow: NewServerRow = {
  id: '300',
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

function addListing(at: number, id = 1): void {
  getDb()
    .insert(listings)
    .values({
      serverId: '300',
      userId: 'u1',
      username: 'alice',
      intent: 'have',
      accepts: 'cash',
      game: 'mtg',
      cardName: `Card ${id}`,
      cardNameNormalized: `card ${id}`,
      cardSet: null,
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
      expiresAt: at + 30 * 24 * 3600 * 1000,
      createdAt: at,
      updatedAt: at,
    } satisfies NewListingRow)
    .run();
}

describe('digest state', () => {
  it('selects only active listings created after the watermark', () => {
    getDb().insert(servers).values(serverRow).run();
    const watermark = 1000;
    setServerWatermark('300', watermark);
    addListing(500, 1); // before watermark
    addListing(1500, 2); // after watermark
    const config = getServerConfig('300')!;
    const rows = prepareDigestListings(config);
    expect(rows.map((r) => r.cardName)).toEqual(['Card 2']);
  });

  it('initializes the watermark when enabling an active mode for the first time', () => {
    getDb().insert(servers).values(serverRow).run();
    upsertServerConfig({ serverId: '300', digestMode: 'channel' });
    const config = getServerConfig('300')!;
    initializeWatermarkIfNeeded(config);
    const after = getServerConfig('300')!;
    expect(after.lastDigestAt).not.toBeNull();
  });
});

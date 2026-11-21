import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { listings, servers, type NewServerRow, type NewListingRow } from '../../src/db/schema.js';
import {
  getServerConfig,
  initializeWatermarkIfNeeded,
  advanceServerWatermark,
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
      marketUrl: null,
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

  it('selects nothing created after the cutoff', () => {
    getDb().insert(servers).values(serverRow).run();
    setServerWatermark('300', 1000);
    addListing(1500, 1);
    addListing(2500, 2);
    const rows = prepareDigestListings(getServerConfig('300')!, 2000);
    expect(rows.map((r) => r.cardName)).toEqual(['Card 1']);
  });

  it('only moves the watermark forward', () => {
    // Two overlapping digests can finish in either order.
    getDb().insert(servers).values(serverRow).run();
    advanceServerWatermark('300', 2000);
    advanceServerWatermark('300', 1000);
    expect(getServerConfig('300')!.lastDigestAt).toBe(2000);
  });

  it('advances a watermark that was never set', () => {
    getDb().insert(servers).values(serverRow).run();
    advanceServerWatermark('300', 1000);
    expect(getServerConfig('300')!.lastDigestAt).toBe(1000);
  });

  it('initializes the watermark when enabling an active mode for the first time', () => {
    getDb().insert(servers).values(serverRow).run();
    upsertServerConfig({ serverId: '300', digestMode: 'channel' });
    const config = getServerConfig('300')!;
    initializeWatermarkIfNeeded(config);
    const after = getServerConfig('300')!;
    expect(after.lastDigestAt).not.toBeNull();
  });

  it('does not initialize the watermark when digestMode is "disabled"', () => {
    getDb().insert(servers).values(serverRow).run();
    const config = getServerConfig('300')!;
    initializeWatermarkIfNeeded(config);
    expect(getServerConfig('300')!.lastDigestAt).toBeNull();
  });

  it('does not initialize the watermark when lastDigestAt is already set', () => {
    // Insert already in an active mode: enabling it through upsertServerConfig
    // counts as a resume and deliberately moves the watermark past the pause.
    getDb()
      .insert(servers)
      .values({ ...serverRow, digestMode: 'channel' })
      .run();
    setServerWatermark('300', 12345);
    const config = getServerConfig('300')!;
    initializeWatermarkIfNeeded(config);
    expect(getServerConfig('300')!.lastDigestAt).toBe(12345);
  });

  it('updates partial fields one at a time via upsertServerConfig', () => {
    getDb()
      .insert(servers)
      .values({ ...serverRow, digestMode: 'channel', digestCron: '0 8 * * *' })
      .run();
    upsertServerConfig({ serverId: '300', digestTimezone: 'America/New_York' });
    const after = getServerConfig('300')!;
    expect(after.digestMode).toBe('channel');
    expect(after.digestCron).toBe('0 8 * * *');
    expect(after.digestTimezone).toBe('America/New_York');
  });

  it('prefers the provided enabledGames list for new servers', () => {
    getDb().insert(servers).values(serverRow).run();
    upsertServerConfig({ serverId: '401', enabledGames: ['mtg', 'pokemon'] });
    const after = getServerConfig('401')!;
    expect(JSON.parse(after.enabledGames)).toEqual(['mtg', 'pokemon']);
  });
});

describe('turning digests on and off', () => {
  it('keeps the watermark while a mode changes between active ones', () => {
    getDb()
      .insert(servers)
      .values({ ...serverRow, digestMode: 'channel', lastDigestAt: 1000 })
      .run();
    upsertServerConfig({ serverId: '300', digestMode: 'both' });
    expect(getServerConfig('300')!.lastDigestAt).toBe(1000);
  });

  it('keeps the watermark when digests are turned off', () => {
    getDb()
      .insert(servers)
      .values({ ...serverRow, digestMode: 'channel', lastDigestAt: 1000 })
      .run();
    upsertServerConfig({ serverId: '300', digestMode: 'disabled' });
    expect(getServerConfig('300')!.lastDigestAt).toBe(1000);
  });

  describe('pausing and resuming', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const at = (time: number) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(time);
    };

    it('skips what was posted while paused, and still sends what was unsent before', () => {
      getDb()
        .insert(servers)
        .values({ ...serverRow, digestMode: 'channel', lastDigestAt: 1000 })
        .run();
      addListing(1500, 1); // before the pause, never sent
      at(2000);
      upsertServerConfig({ serverId: '300', digestMode: 'disabled' });
      addListing(2500, 2); // while paused
      at(3000);
      upsertServerConfig({ serverId: '300', digestMode: 'channel' });
      addListing(3500, 3); // after resuming
      at(4000);

      const rows = prepareDigestListings(getServerConfig('300')!);

      expect(rows.map((r) => r.cardName)).toEqual(['Card 1', 'Card 3']);
    });

    it('starts from the resume for a pause with no recorded start', () => {
      // Paused before pause times were recorded: what is unsent can't be told
      // apart from what was posted while paused, so neither is sent.
      getDb()
        .insert(servers)
        .values({ ...serverRow, digestMode: 'disabled', lastDigestAt: 1000 })
        .run();
      at(3000);
      upsertServerConfig({ serverId: '300', digestMode: 'channel' });

      const config = getServerConfig('300')!;
      expect(config.lastDigestAt).toBe(3000);
      expect(config.digestPausedAt).toBeNull();
    });
  });
});

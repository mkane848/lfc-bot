import cron from 'node-cron';
import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { servers, type NewServerRow } from '../../src/db/schema.js';
import { getServerConfig, upsertServerConfig } from '../../src/services/digest-state.js';
import {
  refreshServerDigest,
  removeServerDigest,
  scheduleAllDigests,
  startGameCatalogSync,
  startMaintenance,
  startSealedCatalogSync,
  stopAllJobs,
} from '../../src/services/scheduler.js';
import { pruneExpiredCardCache } from '../../src/services/card-cache.js';
import { syncEnabledGameCatalogs } from '../../src/services/game-catalogs.js';
import { expireListings, purgeMarkedServers } from '../../src/services/listing-expiry.js';
import { syncSealedCatalog } from '../../src/services/sealed.js';
import { setupTestDb } from '../helpers/db.js';

vi.mock('../../src/services/sealed.js', () => ({
  syncSealedCatalog: vi.fn(),
  isSealedCatalogStale: vi.fn(),
}));

vi.mock('../../src/services/game-catalogs.js', () => ({
  syncEnabledGameCatalogs: vi.fn(),
}));

vi.mock('../../src/services/card-cache.js', () => ({
  pruneExpiredCardCache: vi.fn(),
}));

vi.mock('../../src/services/listing-expiry.js', () => ({
  expireListings: vi.fn(),
  purgeMarkedServers: vi.fn(),
}));

setupTestDb();

const mockSyncSealedCatalog = vi.mocked(syncSealedCatalog);
const mockSyncGameCatalogs = vi.mocked(syncEnabledGameCatalogs);
const mockPruneExpiredCardCache = vi.mocked(pruneExpiredCardCache);
const mockExpireListings = vi.mocked(expireListings);
const mockPurgeMarkedServers = vi.mocked(purgeMarkedServers);

beforeEach(() => {
  mockSyncSealedCatalog.mockReset();
  mockSyncSealedCatalog.mockResolvedValue({ imported: 0, removed: 0 });
  mockSyncGameCatalogs.mockReset();
  mockSyncGameCatalogs.mockResolvedValue(undefined);
  mockPruneExpiredCardCache.mockReset();
  mockPruneExpiredCardCache.mockReturnValue(0);
  mockExpireListings.mockReset();
  mockExpireListings.mockReturnValue(0);
  mockPurgeMarkedServers.mockReset();
  mockPurgeMarkedServers.mockReturnValue(0);
});

// `createJob`/`cancelJob` are internal to the scheduler module (not exported);
// their behavior is exercised here indirectly through the public API
// (`scheduleAllDigests`, `refreshServerDigest`, `removeServerDigest`,
// `stopAllJobs`), which is how every real caller drives them.

function fakeClient(): Client {
  return {
    channels: { fetch: vi.fn() },
    users: { fetch: vi.fn() },
  } as unknown as Client;
}

function serverRow(overrides: Partial<NewServerRow> = {}): NewServerRow {
  return {
    id: 'guild-1',
    digestMode: 'channel',
    digestCron: '0 9 * * *',
    digestTimezone: 'UTC',
    enabledGames: '["mtg"]',
    adminChannelId: 'channel-1',
    digestDmUserId: null,
    lastDigestAt: null,
    removedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  // Jobs are tracked in a module-level map that outlives `setupTestDb`'s
  // per-test DB reset, so always clear it between tests.
  stopAllJobs();
});

describe('scheduleAllDigests', () => {
  it('schedules a job (and initializes the watermark) for every server with an active digest mode', () => {
    getDb()
      .insert(servers)
      .values(serverRow({ id: 'guild-1', digestMode: 'channel' }))
      .run();
    getDb()
      .insert(servers)
      .values(serverRow({ id: 'guild-2', digestMode: 'disabled' }))
      .run();
    const client = fakeClient();

    expect(() => scheduleAllDigests(client)).not.toThrow();

    expect(getServerConfig('guild-1')?.lastDigestAt).not.toBeNull();
    expect(getServerConfig('guild-2')?.lastDigestAt).toBeNull();
  });
});

describe('refreshServerDigest', () => {
  it('(re)creates the job and initializes the watermark for an active digest mode', () => {
    getDb().insert(servers).values(serverRow()).run();
    const client = fakeClient();

    expect(() => refreshServerDigest(client, 'guild-1')).not.toThrow();

    expect(getServerConfig('guild-1')?.lastDigestAt).not.toBeNull();
  });

  it('does nothing for an unknown server id', () => {
    const client = fakeClient();

    expect(() => refreshServerDigest(client, 'unknown-guild')).not.toThrow();
  });

  it('cancels any existing job and does not re-create one when digest mode is disabled', () => {
    getDb()
      .insert(servers)
      .values(serverRow({ digestMode: 'disabled' }))
      .run();
    const client = fakeClient();

    expect(() => refreshServerDigest(client, 'guild-1')).not.toThrow();
    expect(getServerConfig('guild-1')?.lastDigestAt).toBeNull();
  });

  it('does not throw for a server with an invalid cron expression (createJob guard)', () => {
    getDb()
      .insert(servers)
      .values(serverRow({ digestCron: 'not-a-valid-cron' }))
      .run();
    const client = fakeClient();

    expect(() => refreshServerDigest(client, 'guild-1')).not.toThrow();
  });

  it('falls back to "0 9 * * *" when digestCron is empty', () => {
    getDb()
      .insert(servers)
      .values(serverRow({ digestCron: '' }))
      .run();
    const client = fakeClient();
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    scheduleAllDigests(client);

    expect(scheduleSpy).toHaveBeenCalledWith('0 9 * * *', expect.any(Function), expect.any(Object));
  });
});

describe('removeServerDigest / stopAllJobs', () => {
  it('removeServerDigest cancels a server job without throwing', () => {
    getDb().insert(servers).values(serverRow()).run();
    const client = fakeClient();
    refreshServerDigest(client, 'guild-1');

    expect(() => removeServerDigest('guild-1')).not.toThrow();
    // Calling it again (nothing left to cancel) should also be safe.
    expect(() => removeServerDigest('guild-1')).not.toThrow();
  });

  it('stopAllJobs cancels every tracked job without throwing', () => {
    getDb()
      .insert(servers)
      .values(serverRow({ id: 'guild-1' }))
      .run();
    getDb()
      .insert(servers)
      .values(serverRow({ id: 'guild-2' }))
      .run();
    const client = fakeClient();
    scheduleAllDigests(client);

    expect(() => stopAllJobs()).not.toThrow();
  });
});

describe('startSealedCatalogSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a daily 16:00 UTC cron job', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startSealedCatalogSync();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith('0 16 * * *', expect.any(Function), {
      timezone: 'UTC',
    });
  });

  it('is idempotent: a second call does not register another job', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startSealedCatalogSync();
    startSealedCatalogSync();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('invokes syncSealedCatalog from the scheduled callback without throwing', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startSealedCatalogSync();

    const callback = scheduleSpy.mock.calls[0]?.[1] as () => void;
    expect(() => callback()).not.toThrow();
    expect(mockSyncSealedCatalog).toHaveBeenCalledTimes(1);
  });

  it('stopAllJobs clears sealedTask so a subsequent call registers a fresh job', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startSealedCatalogSync();
    stopAllJobs();
    startSealedCatalogSync();

    expect(scheduleSpy).toHaveBeenCalledTimes(2);
  });
});

describe('startGameCatalogSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a daily 21:00 UTC cron job, after TCGCSV’s ~20:00 UTC rebuild', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startGameCatalogSync();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy).toHaveBeenCalledWith('0 21 * * *', expect.any(Function), {
      timezone: 'UTC',
    });
  });

  it('is idempotent: a second call does not register another job', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startGameCatalogSync();
    startGameCatalogSync();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('syncs the enabled games’ catalogs from the scheduled callback without throwing', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startGameCatalogSync();

    const callback = scheduleSpy.mock.calls[0]?.[1] as () => void;
    expect(() => callback()).not.toThrow();
    expect(mockSyncGameCatalogs).toHaveBeenCalledTimes(1);
  });

  it('turns a rejected sync into nothing, so the process-level handler is not alerted', async () => {
    const unhandled = vi.fn();
    process.once('unhandledRejection', unhandled);
    mockSyncGameCatalogs.mockRejectedValue(new Error('boom'));
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startGameCatalogSync();
    (scheduleSpy.mock.calls[0]?.[1] as () => void)();
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('stopAllJobs clears the job so a subsequent call registers a fresh one', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startGameCatalogSync();
    stopAllJobs();
    startGameCatalogSync();

    expect(scheduleSpy).toHaveBeenCalledTimes(2);
  });
});

// Counterexamples found by `tests/models/server.model.test.ts` and
// `tests/models/digest.model.test.ts`. An `it.fails` is a known bug, kept as an
// expected failure until fixed: flip it to `it` with the fix.
describe('digest jobs and the server lifecycle', () => {
  it.fails('does not schedule a digest for a server the bot has left', () => {
    // `listScheduledServers` selects on digest_mode alone, so every restart in
    // the 30-day retention window schedules a digest that can only fail.
    getDb()
      .insert(servers)
      .values(serverRow({ removedAt: Date.now() }))
      .run();
    const schedule = vi.spyOn(cron, 'schedule');

    scheduleAllDigests(fakeClient());

    expect(schedule).not.toHaveBeenCalled();
  });

  it('turning digests back on after a pause does not send the backlog', () => {
    // The watermark from before the pause would send everything posted since.
    getDb()
      .insert(servers)
      .values(serverRow({ digestMode: 'disabled', lastDigestAt: 1 }))
      .run();

    const before = Date.now();
    upsertServerConfig({ serverId: 'guild-1', digestMode: 'channel' });
    refreshServerDigest(fakeClient(), 'guild-1');

    expect(getServerConfig('guild-1')?.lastDigestAt).toBeGreaterThanOrEqual(before);
  });
});

describe('startMaintenance', () => {
  it('runs expireListings -> pruneExpiredCardCache -> purgeMarkedServers inside its scheduled callback', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startMaintenance();

    expect(scheduleSpy).toHaveBeenCalled();
    const [expression, callback, opts] = scheduleSpy.mock.calls[0]!;
    expect(expression).toBe('0 * * * *');
    expect(opts).toEqual({ timezone: 'UTC' });

    (callback as () => void)();
    expect(mockExpireListings).toHaveBeenCalledTimes(1);
    expect(mockPruneExpiredCardCache).toHaveBeenCalledTimes(1);
    expect(mockPurgeMarkedServers).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second call does not register another job', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startMaintenance();
    startMaintenance();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('stopAllJobs clears the maintenance task and allows a fresh registration', () => {
    const scheduleSpy = vi.spyOn(cron, 'schedule');

    startMaintenance();
    stopAllJobs();
    startMaintenance();

    expect(scheduleSpy).toHaveBeenCalledTimes(2);
  });
});

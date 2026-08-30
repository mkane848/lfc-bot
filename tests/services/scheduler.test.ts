import type { Client } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { servers, type NewServerRow } from '../../src/db/schema.js';
import { getServerConfig } from '../../src/services/digest-state.js';
import {
  refreshServerDigest,
  removeServerDigest,
  scheduleAllDigests,
  stopAllJobs,
} from '../../src/services/scheduler.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

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

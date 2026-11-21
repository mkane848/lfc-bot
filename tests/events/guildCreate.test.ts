import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guild } from 'discord.js';
import { getDb } from '../../src/db/index.js';
import { servers } from '../../src/db/schema.js';
import { handleGuildCreate } from '../../src/events/guildCreate.js';
import { getServerConfig } from '../../src/services/digest-state.js';
import { refreshServerDigest } from '../../src/services/scheduler.js';
import { setupTestDb } from '../helpers/db.js';

vi.mock('../../src/services/scheduler.js', () => ({ refreshServerDigest: vi.fn() }));

setupTestDb();

beforeEach(() => {
  vi.mocked(refreshServerDigest).mockReset();
});

const guild = { id: 'g1', name: 'Test', client: {} } as unknown as Guild;

describe('handleGuildCreate', () => {
  it('creates a config row for a new guild', () => {
    handleGuildCreate(guild);

    expect(getServerConfig('g1')?.removedAt).toBeNull();
  });

  it('cancels a pending removal when the guild re-adds the bot', () => {
    getDb().insert(servers).values({ id: 'g1', removedAt: 5, createdAt: 1, updatedAt: 1 }).run();

    handleGuildCreate(guild);

    expect(getServerConfig('g1')?.removedAt).toBeNull();
  });

  // Found by `tests/models/server.model.test.ts`: `handleGuildDelete` cancels
  // the digest job, so rejoining has to restore it.
  it('restores the digest job of a guild that re-adds the bot', () => {
    getDb()
      .insert(servers)
      .values({ id: 'g1', digestMode: 'channel', removedAt: 5, createdAt: 1, updatedAt: 1 })
      .run();

    handleGuildCreate(guild);

    expect(refreshServerDigest).toHaveBeenCalledWith(guild.client, 'g1');
  });
});

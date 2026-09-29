import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as dbModule from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { servers, sealedCatalogMeta } from '../../src/db/schema.js';

let tmpDir: string;

beforeEach(() => {
  dbModule.closeDb();
  tmpDir = mkdtempSync(join(tmpdir(), 'lfcbot-migrate-'));
  process.env.DATABASE_PATH = join(tmpDir, 'lfcbot.db');
});

afterEach(() => {
  dbModule.closeDb();
  delete process.env.DATABASE_PATH;
  vi.unstubAllEnvs();
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('runMigrations', () => {
  it('applies the project migrations and surfaces their effects in the schema', () => {
    runMigrations();
    const db = dbModule.getDb();

    db.insert(servers).values({
      id: 'guild-1',
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
    }).run();

    db.insert(sealedCatalogMeta).values({
      id: 1,
      buildVersion: 'v1',
      setListEtag: '"e1"',
      syncedAt: 100,
    }).run();

    const row = db.select().from(servers).where(eq(servers.id, 'guild-1')).get();
    expect(row?.digestMode).toBe('disabled');

    const meta = db.select().from(sealedCatalogMeta).where(eq(sealedCatalogMeta.id, 1)).get();
    expect(meta?.buildVersion).toBe('v1');
  });

  it('is idempotent: a second call leaves existing data intact', () => {
    runMigrations();
    const db = dbModule.getDb();
    db.insert(servers).values({
      id: 'guild-1',
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
    }).run();

    runMigrations();
    const row = db.select().from(servers).where(eq(servers.id, 'guild-1')).get();
    expect(row?.id).toBe('guild-1');
  });
});

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as dbModule from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { servers } from '../../src/db/schema.js';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  dbModule.closeDb();
  tmpDir = mkdtempSync(join(tmpdir(), 'lfcbot-test-'));
  dbPath = join(tmpDir, 'lfcbot.db');
  process.env.DATABASE_PATH = dbPath;
});

afterEach(() => {
  dbModule.closeDb();
  delete process.env.DATABASE_PATH;
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('getDb (file-backed)', () => {
  it('creates the parent directory on demand and opens the database file', () => {
    const nestedDir = join(tmpDir, 'nested', 'deeper');
    const nestedPath = join(nestedDir, 'lfcbot.db');
    process.env.DATABASE_PATH = nestedPath;

    const db = dbModule.getDb();
    runMigrations();
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

    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(nestedPath)).toBe(true);

    const row = db.select().from(servers).where(eq(servers.id, 'guild-1')).all();
    expect(row).toHaveLength(1);
  });

  it('getSqliteClient initializes the connection on demand', () => {
    const client = dbModule.getSqliteClient();
    expect(client).toBeDefined();
    expect(client.open).toBe(true);
  });

  it('getSqliteClient reuses the cached connection on subsequent calls', () => {
    const a = dbModule.getSqliteClient();
    const b = dbModule.getSqliteClient();
    expect(b).toBe(a);
  });
});

describe('closeDb', () => {
  it('closes the active connection and clears the cache', () => {
    dbModule.getDb();
    dbModule.closeDb();

    expect(() => dbModule.getSqliteClient()).not.toThrow();

    dbModule.closeDb();
  });
});

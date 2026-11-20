import { getSqliteClient } from '../../src/db/index.js';
import { getDb } from '../../src/db/index.js';
import { servers, type NewServerRow } from '../../src/db/schema.js';

/**
 * Empty every table between replayed traces. Conformance tests replay hundreds
 * of traces in one test, and re-running the migrations for each would be far
 * slower than this.
 */
export function clearTables(): void {
  const sqlite = getSqliteClient();
  for (const table of ['listings', 'digest_log', 'admin_audit_log', 'servers']) {
    sqlite.prepare(`DELETE FROM ${table}`).run();
  }
}

export function seedServer(overrides: Partial<NewServerRow> = {}): void {
  getDb()
    .insert(servers)
    .values({
      id: 'guild-1',
      digestMode: 'disabled',
      digestCron: '0 9 * * *',
      digestTimezone: 'UTC',
      enabledGames: '["mtg"]',
      adminChannelId: null,
      digestDmUserId: null,
      lastDigestAt: null,
      removedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    })
    .run();
}

export const DAY_MS = 24 * 60 * 60 * 1000;

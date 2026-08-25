import { beforeAll, beforeEach } from 'vitest';
import { closeDb, getSqliteClient } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';

/**
 * Point the connection at an in-memory SQLite database, migrate it, and re-create
 * it between tests so each test runs against an empty schema.
 */
export function setupTestDb(): void {
  beforeAll(() => {
    process.env.DATABASE_PATH = ':memory:';
    closeDb();
  });

  beforeEach(() => {
    process.env.DATABASE_PATH = ':memory:';
    closeDb();
    runMigrations();
  });
}

/** Direct access to the underlying SQLite client for raw assertions. */
export function sql() {
  return getSqliteClient();
}

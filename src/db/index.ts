import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

let client: Database.Database | undefined;
let db: BetterSQLite3Database<typeof schema> | undefined;

/**
 * Resolve the configured database path against the current working directory.
 * The special value `:memory:` is returned as-is for tests.
 */
export function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_PATH ?? './data/lfcbot.db';
  if (configured === ':memory:') {
    return ':memory:';
  }
  return resolve(process.cwd(), configured);
}

/**
 * Return the shared database instance, creating the connection and the parent
 * directory on first use.
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (db) {
    return db;
  }

  const path = resolveDatabasePath();
  if (path !== ':memory:') {
    const parent = dirname(path);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
  }

  client = new Database(path);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');

  db = drizzle(client, { schema });
  return db;
}

/** Low-level access to the underlying SQLite connection for pragmas. */
export function getSqliteClient(): Database.Database {
  if (!client) {
    getDb();
  }
  if (!client) {
    throw new Error('Database client was not initialized');
  }
  return client;
}

/** Close the shared connection. Used during tests and graceful shutdown. */
export function closeDb(): void {
  if (client) {
    client.close();
  }
  client = undefined;
  db = undefined;
}

export { schema };

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb } from './index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Find the project root by walking up from this module until `package.json` is
 * found. Works for both source (`src/db`) and compiled (`dist/db`) layouts.
 */
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Unable to locate the LFCbot project root');
    }
    dir = parent;
  }
}

/**
 * Apply all pending Drizzle migrations. Migrations are tracked in the
 * `__drizzle_migrations` table and only applied once. The migrations folder is
 * resolved from the project root so it works in dev and production builds.
 */
export function runMigrations(): void {
  const projectRoot = findProjectRoot(moduleDir);
  const db = getDb();
  migrate(db, { migrationsFolder: resolve(projectRoot, 'src', 'db', 'migrations') });
}

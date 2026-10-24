import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

const MIGRATIONS_DIR = resolve(process.cwd(), 'src/db/migrations');

interface Journal {
  entries: Array<{ tag: string }>;
}

/** Migration tags in the order drizzle-kit recorded them (`0000_…`, `0001_…`, …). */
export function migrationTags(): string[] {
  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  return journal.entries.map((entry) => entry.tag);
}

/**
 * Apply the generated SQL migrations to a bare connection, in journal order,
 * starting at `from` and ending at `through` (both inclusive, matched by tag
 * prefix such as `0004`). Lets a test build a database as it looked before a
 * migration, load data into it, and then apply that migration on top.
 */
export function applyMigrations(
  db: Database.Database,
  range: { from?: string; through?: string } = {},
): void {
  const tags = migrationTags();
  const start = range.from ? tags.findIndex((tag) => tag.startsWith(range.from ?? '')) : 0;
  const end = range.through
    ? tags.findIndex((tag) => tag.startsWith(range.through ?? ''))
    : tags.length - 1;
  if (start < 0 || end < 0) {
    throw new Error(`Unknown migration range ${JSON.stringify(range)}`);
  }
  for (const tag of tags.slice(start, end + 1)) {
    const statements = readFileSync(resolve(MIGRATIONS_DIR, `${tag}.sql`), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      db.exec(statement);
    }
  }
}

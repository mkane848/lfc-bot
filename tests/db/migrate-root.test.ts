import { describe, expect, it, vi } from 'vitest';

// `findProjectRoot` walks up looking for package.json. Hiding it from
// `existsSync` drives the walk to the filesystem root and out the only throw
// path that a working checkout never reaches.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

import { runMigrations } from '../../src/db/migrate.js';

describe('runMigrations without a project root', () => {
  it('throws instead of silently finding no migrations folder', () => {
    process.env.DATABASE_PATH = ':memory:';

    expect(() => runMigrations()).toThrow(/Unable to locate the LFCbot project root/);

    delete process.env.DATABASE_PATH;
  });
});

import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDatabasePath } from '../../src/db/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.DATABASE_PATH;
});

describe('resolveDatabasePath', () => {
  it('returns the special :memory: value verbatim', () => {
    vi.stubEnv('DATABASE_PATH', ':memory:');
    expect(resolveDatabasePath()).toBe(':memory:');
  });

  it('falls back to ./data/lfcbot.db relative to the process cwd when unset', () => {
    delete process.env.DATABASE_PATH;
    expect(resolveDatabasePath()).toBe(resolve(process.cwd(), './data/lfcbot.db'));
  });

  it('resolves a relative DATABASE_PATH against the cwd', () => {
    vi.stubEnv('DATABASE_PATH', './custom/path.db');
    expect(resolveDatabasePath()).toBe(resolve(process.cwd(), './custom/path.db'));
  });
});

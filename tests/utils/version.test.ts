import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Harness {
  pkg: unknown;
  requireThrows: boolean;
}

const h = vi.hoisted<Harness>(() => ({
  pkg: null,
  requireThrows: false,
}));

vi.mock('node:module', () => ({
  createRequire: vi.fn(() => () => {
    if (h.requireThrows) {
      throw new Error('package.json not found');
    }
    return h.pkg;
  }),
}));

/** `version.ts` reads the version at import time, so each case re-imports it. */
async function projectVersion(): Promise<string> {
  vi.resetModules();
  const { PROJECT_VERSION } = await import('../../src/utils/version.js');
  return PROJECT_VERSION;
}

beforeEach(() => {
  h.pkg = undefined;
  h.requireThrows = false;
});

describe('PROJECT_VERSION', () => {
  it('reads the version from package.json', async () => {
    h.pkg = { name: 'lfcbot', version: '1.2.3' };

    await expect(projectVersion()).resolves.toBe('1.2.3');
  });

  it('falls back to "unknown" when package.json has no version', async () => {
    h.pkg = { name: 'lfcbot' };

    await expect(projectVersion()).resolves.toBe('unknown');
  });

  it('falls back to "unknown" when package.json cannot be read', async () => {
    h.requireThrows = true;

    await expect(projectVersion()).resolves.toBe('unknown');
  });
});

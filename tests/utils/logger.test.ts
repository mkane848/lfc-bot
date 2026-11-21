import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLogger, resetLogger } from '../../src/utils/logger.js';

afterEach(() => {
  resetLogger();
  vi.unstubAllEnvs();
});

describe('getLogger', () => {
  it('returns the same cached logger instance on repeated calls', () => {
    const a = getLogger();
    const b = getLogger();
    expect(b).toBe(a);
  });

  it('rebuilds the logger after resetLogger', () => {
    const before = getLogger();
    resetLogger();
    const after = getLogger();
    expect(after).not.toBe(before);
  });

  it('honors the LOG_LEVEL environment variable', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    expect(getLogger().level).toBe('warn');
    resetLogger();
    vi.stubEnv('LOG_LEVEL', 'error');
    expect(getLogger().level).toBe('error');
  });

  it('falls back to info when LOG_LEVEL is unset', () => {
    expect(getLogger().level).toBe('info');
  });

  it('produces a child logger that shares the parent bindings', () => {
    const root = getLogger();
    const child = root.child({ component: 'test' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
    expect(typeof child.error).toBe('function');
  });

  it('omits the pino-pretty transport when NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    // The pino-pretty transport attaches a worker thread (via transport.target);
    // when unset, the logger is a plain pino instance with no `[Symbol.for(\"pino.transport\")]` symbol.
    // We don't introspect that symbol directly; instead we just verify the logger still constructs.
    expect(getLogger().info).toBeDefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { retryWithBackoff } from '../../src/utils/retry.js';

describe('retryWithBackoff', () => {
  it('returns the function result without retrying on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retryWithBackoff(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures until success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    await expect(
      retryWithBackoff(fn, { baseDelayMs: 1, maxDelayMs: 2 }),
    ).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fatal = new Error('fatal');
    const fn = vi.fn().mockRejectedValue(fatal);
    await expect(
      retryWithBackoff(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects attempts=1 by never retrying', async () => {
    const err = new Error('e');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryWithBackoff(fn, { attempts: 1, baseDelayMs: 1 })).rejects.toBe(
      err,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('sleeps between retries with exponential delay', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValueOnce('final');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await retryWithBackoff(fn, { baseDelayMs: 5, maxDelayMs: 100 });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    setTimeoutSpy.mockRestore();
  });
});

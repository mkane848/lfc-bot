import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupManapoolPrinting } from '../../src/services/manapool.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('lookupManapoolPrinting', () => {
  it('returns null without calling fetch when no API key is configured', async () => {
    vi.stubEnv('MANAPOOL_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await lookupManapoolPrinting('scryfall-id-1');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the access token header and scryfall_ids query, returning url/price', async () => {
    vi.stubEnv('MANAPOOL_API_KEY', 'mpat_test123');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ url: 'https://manapool.com/card/ice/89/polar-kraken', price_cents: 500 }],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await lookupManapoolPrinting('scryfall-id-1');
    expect(result).toEqual({
      url: 'https://manapool.com/card/ice/89/polar-kraken',
      priceCents: 500,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/products/singles?scryfall_ids=scryfall-id-1');
    expect((init.headers as Record<string, string>)['X-ManaPool-Access-Token']).toBe(
      'mpat_test123',
    );
  });

  it('returns null on a non-OK response', async () => {
    vi.stubEnv('MANAPOOL_API_KEY', 'mpat_test123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }),
    );
    await expect(lookupManapoolPrinting('scryfall-id-1')).resolves.toBeNull();
  });

  it('returns null on an empty data array', async () => {
    vi.stubEnv('MANAPOOL_API_KEY', 'mpat_test123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) }),
    );
    await expect(lookupManapoolPrinting('scryfall-id-1')).resolves.toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubEnv('MANAPOOL_API_KEY', 'mpat_test123');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    await expect(lookupManapoolPrinting('scryfall-id-1')).resolves.toBeNull();
  });
});

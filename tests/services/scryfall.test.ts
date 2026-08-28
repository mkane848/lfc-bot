import { afterEach, describe, expect, it, vi } from 'vitest';
import { autocompleteCards, autocompleteSets, resolveCard } from '../../src/services/scryfall.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) };
}

describe('scryfall service', () => {
  it('returns autocomplete suggestions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: ['Black Lotus', 'Black Vice'] })),
    );
    await expect(autocompleteCards('black')).resolves.toEqual(['Black Lotus', 'Black Vice']);
  });

  it('resolves a card through the fuzzy endpoint and caches it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 'lotus-id',
          name: 'Black Lotus',
          set: 'LEA',
          collector_number: '232',
          image_uris: { normal: 'http://img/lotus.png' },
        }),
      ),
    );

    const resolved = await resolveCard('Black Lotus');
    expect(resolved.resolved).toBe(true);
    expect(resolved.cardName).toBe('Black Lotus');
    expect(resolved.cardSet).toBe('LEA');
    expect(resolved.cardImageUrl).toBe('http://img/lotus.png');
    expect(resolved.collectorNumber).toBe('232');
    // No MANAPOOL_API_KEY configured, so it falls back to a locally-built link.
    expect(resolved.manapoolUrl).toBe('https://manapool.com/card/lea/232/black-lotus');

    const fetchMock = vi.mocked(fetch);
    const callsBefore = fetchMock.mock.calls.length;
    const cached = await resolveCard('Black Lotus');
    expect(cached.cardName).toBe('Black Lotus');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('falls back to an unresolved entry when Scryfall is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false)));
    const resolved = await resolveCard('Totally Fake Card');
    expect(resolved.resolved).toBe(false);
    expect(resolved.cardName).toBe('Totally Fake Card');
    expect(resolved.cardImageUrl).toBeNull();
    expect(resolved.manapoolUrl).toBeNull();
  });

  it('builds a printing-filtered search query when set/finish/variant/collector number are given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'bolt-id',
            name: 'Lightning Bolt',
            set: 'mh3',
            collector_number: '128',
            image_uris: { normal: 'http://img/bolt.png' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveCard('Lightning Bolt', {
      cardSet: 'MH3',
      finish: 'foil',
      variant: 'extended',
      collectorNumber: '128',
    });

    expect(resolved.resolved).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/cards/search?q=');
    const query = decodeURIComponent(url.split('q=')[1]);
    expect(query).toContain('set:MH3');
    expect(query).toContain('is:foil');
    expect(query).toContain('is:extended');
    expect(query).toContain('cn:128');
  });

  it('prefers a live Manapool URL over the local fallback when configured', async () => {
    vi.stubEnv('MANAPOOL_API_KEY', 'mpat_test');
    const manapoolCalls: string[] = [];
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('manapool.com')) {
        manapoolCalls.push(url);
        return Promise.resolve(
          jsonResponse({
            data: [{ url: 'https://manapool.com/card/mh3/128/lightning-bolt', price_cents: 199 }],
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          id: 'bolt-id',
          name: 'Lightning Bolt',
          set: 'mh3',
          collector_number: '128',
          image_uris: { normal: 'http://img/bolt.png' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveCard('Lightning Bolt', {
      cardSet: 'MH3',
      collectorNumber: '128',
    });
    expect(resolved.manapoolUrl).toBe('https://manapool.com/card/mh3/128/lightning-bolt');
    expect(resolved.manapoolPriceCents).toBe(199);
    expect(manapoolCalls).toHaveLength(1);
    expect(manapoolCalls[0]).toContain('scryfall_ids=bolt-id');
  });

  it('falls back to a local Manapool URL when the live lookup fails', async () => {
    vi.stubEnv('MANAPOOL_API_KEY', 'mpat_test');
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('manapool.com')) {
        return Promise.resolve(jsonResponse({}, false));
      }
      return Promise.resolve(
        jsonResponse({
          id: 'bolt-id',
          name: 'Lightning Bolt',
          set: 'mh3',
          collector_number: '128',
          image_uris: { normal: 'http://img/bolt.png' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveCard('Lightning Bolt', {
      cardSet: 'MH3',
      collectorNumber: '128',
    });
    expect(resolved.manapoolUrl).toBe('https://manapool.com/card/mh3/128/lightning-bolt');
    expect(resolved.manapoolPriceCents).toBeNull();
  });

  it('returns set autocomplete choices filtered by code or name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { code: 'mh3', name: 'Modern Horizons 3' },
            { code: 'lea', name: 'Limited Edition Alpha' },
          ],
        }),
      ),
    );
    const choices = await autocompleteSets('mh3');
    expect(choices).toEqual([{ name: 'Modern Horizons 3 (MH3)', value: 'MH3' }]);
  });
});

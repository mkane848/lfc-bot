import { afterEach, describe, expect, it, vi } from 'vitest';
import { autocompleteCards, resolveCard } from '../../src/services/scryfall.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scryfall service', () => {
  it('returns autocomplete suggestions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: ['Black Lotus', 'Black Vice'] }),
      }),
    );
    await expect(autocompleteCards('black')).resolves.toEqual(['Black Lotus', 'Black Vice']);
  });

  it('resolves a card through the fuzzy endpoint and caches it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'lotus-id',
            name: 'Black Lotus',
            set: 'LEA',
            image_uris: { normal: 'http://img/lotus.png' },
          }),
      }),
    );

    const resolved = await resolveCard('Black Lotus');
    expect(resolved.resolved).toBe(true);
    expect(resolved.cardName).toBe('Black Lotus');
    expect(resolved.cardSet).toBe('LEA');
    expect(resolved.cardImageUrl).toBe('http://img/lotus.png');

    const fetchMock = vi.mocked(fetch);
    const callsBefore = fetchMock.mock.calls.length;
    const cached = await resolveCard('Black Lotus');
    expect(cached.cardName).toBe('Black Lotus');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('falls back to an unresolved entry when Scryfall is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }),
    );
    const resolved = await resolveCard('Totally Fake Card');
    expect(resolved.resolved).toBe(false);
    expect(resolved.cardName).toBe('Totally Fake Card');
    expect(resolved.cardImageUrl).toBeNull();
  });
});

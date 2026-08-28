import { describe, expect, it, vi } from 'vitest';
import {
  buildCacheKey,
  getCachedCard,
  pruneExpiredCardCache,
  upsertCachedCard,
} from '../../src/services/card-cache.js';
import { setupTestDb } from '../helpers/db.js';

setupTestDb();

describe('card cache', () => {
  it('stores and retrieves a resolved card', () => {
    upsertCachedCard({
      cacheKey: 'black-lotus::LEA',
      scryfallId: 'abc',
      cardName: 'Black Lotus',
      cardNameNormalized: 'black lotus',
      cardSet: 'LEA',
      cardImageUrl: 'http://img/black-lotus.png',
      collectorNumber: '232',
      manapoolUrl: 'https://manapool.com/card/lea/232/black-lotus',
      manapoolPriceCents: 4500000,
      resolved: true,
    });
    const row = getCachedCard('black-lotus::LEA');
    expect(row?.cardName).toBe('Black Lotus');
    expect(row?.resolved).toBe(1);
    expect(row?.collectorNumber).toBe('232');
    expect(row?.manapoolUrl).toBe('https://manapool.com/card/lea/232/black-lotus');
    expect(row?.manapoolPriceCents).toBe(4500000);
  });

  it('prunes expired rows and treats them as a miss', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      upsertCachedCard({
        cacheKey: 'expired-card',
        cardName: 'Expired',
        cardNameNormalized: 'expired',
        cardSet: null,
        cardImageUrl: null,
        resolved: false,
      });
      // Advance beyond the 24h TTL.
      vi.setSystemTime(new Date('2026-01-03T00:00:00Z'));
      expect(getCachedCard('expired-card')).toBeUndefined();
      pruneExpiredCardCache();
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds stable cache keys with optional set', () => {
    expect(buildCacheKey('Black Lotus', 'lea')).toBe('black lotus::LEA');
    expect(buildCacheKey('Sol Ring')).toBe('sol ring');
  });

  it('distinguishes cache keys by printing details', () => {
    const nonfoil = buildCacheKey('Lightning Bolt', 'MH3', 'nonfoil', undefined, '128');
    const foil = buildCacheKey('Lightning Bolt', 'MH3', 'foil', undefined, '128');
    const extended = buildCacheKey('Lightning Bolt', 'MH3', 'foil', 'extended', '128');
    expect(nonfoil).not.toBe(foil);
    expect(foil).not.toBe(extended);
  });
});

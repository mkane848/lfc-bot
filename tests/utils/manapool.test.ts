import { describe, expect, it } from 'vitest';
import { buildManapoolUrl } from '../../src/utils/manapool.js';

describe('buildManapoolUrl', () => {
  it('builds an exact-print URL from set + collector number + slugified name', () => {
    expect(
      buildManapoolUrl({ cardName: 'Polar Kraken', cardSet: 'ICE', collectorNumber: '89' }),
    ).toBe('https://manapool.com/card/ice/89/polar-kraken');
  });

  it('strips apostrophes and punctuation when slugifying, e.g. Jace, the Mind Sculptor', () => {
    expect(
      buildManapoolUrl({
        cardName: 'Jace, the Mind Sculptor',
        cardSet: 'WWK',
        collectorNumber: '31',
      }),
    ).toBe('https://manapool.com/card/wwk/31/jace-the-mind-sculptor');
  });

  it('returns null when the set is missing', () => {
    expect(buildManapoolUrl({ cardName: 'Polar Kraken', collectorNumber: '89' })).toBeNull();
  });

  it('returns null when the collector number is missing', () => {
    expect(buildManapoolUrl({ cardName: 'Polar Kraken', cardSet: 'ICE' })).toBeNull();
  });

  it('returns null for an empty card name', () => {
    expect(buildManapoolUrl({ cardName: '   ', cardSet: 'ICE', collectorNumber: '89' })).toBeNull();
  });
});

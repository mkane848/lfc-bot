import { describe, expect, it } from 'vitest';
import type { ListingRow } from '../../src/db/schema.js';
import { formatDigest } from '../../src/services/digest.js';
import { DIGEST_SECTION_CAP } from '../../src/utils/constants.js';

function listing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 1,
    serverId: '200',
    userId: 'u1',
    username: 'alice',
    listingType: 'sell',
    game: 'mtg',
    cardName: 'Black Lotus',
    cardNameNormalized: 'black lotus',
    cardSet: 'LEA',
    cardImageUrl: null,
    condition: 'nm',
    priceCents: 4500000,
    quantity: 1,
    notes: null,
    status: 'active',
    expiresAt: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('formatDigest', () => {
  it('groups listings by type with headings', () => {
    const text = formatDigest([
      listing({ id: 1, listingType: 'sell', cardName: 'Black Lotus', username: 'alice' }),
      listing({ id: 2, listingType: 'buy', cardName: 'Force of Will', priceCents: null }),
      listing({ id: 3, listingType: 'trade', cardName: 'Tarmogoyf', condition: 'lp' }),
    ]);
    expect(text).toContain('NEW SELLS (1)');
    expect(text).toContain('NEW BUYS (1)');
    expect(text).toContain('NEW TRADES (1)');
    expect(text).toContain('- Black Lotus (LEA) — NM — $45,000.00 — @alice');
  });

  it('omits empty sections', () => {
    const text = formatDigest([listing({ id: 1, listingType: 'sell' })]);
    expect(text).not.toContain('NEW BUYS');
    expect(text).not.toContain('NEW TRADES');
  });

  it('caps each section and notes overflow', () => {
    const rows = Array.from({ length: DIGEST_SECTION_CAP + 5 }, (_, i) =>
      listing({ id: i + 1, listingType: 'sell', cardName: `Card ${i + 1}` }),
    );
    const text = formatDigest(rows);
    expect(text).toContain('NEW SELLS (30)');
    expect(text).toContain('+5 more');
    expect(text).toContain('- Card 1 (LEA)');
    expect(text).not.toContain('- Card 26 (LEA)');
  });
});

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
    intent: 'have',
    accepts: 'cash',
    game: 'mtg',
    cardName: 'Black Lotus',
    cardNameNormalized: 'black lotus',
    cardSet: 'LEA',
    cardImageUrl: null,
    finish: null,
    variant: null,
    collectorNumber: null,
    manapoolUrl: null,
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
  it('groups listings by intent with headings', () => {
    const text = formatDigest([
      listing({ id: 1, intent: 'have', cardName: 'Black Lotus', username: 'alice' }),
      listing({ id: 2, intent: 'want', cardName: 'Force of Will', priceCents: null }),
      listing({ id: 3, intent: 'have', accepts: 'trade', cardName: 'Tarmogoyf', condition: 'lp' }),
    ]);
    expect(text).toContain('NEW HAVES (2)');
    expect(text).toContain('NEW WANTS (1)');
    expect(text).toContain('- Black Lotus (LEA) — NM — $45,000.00 — @alice');
  });

  it('omits empty sections', () => {
    const text = formatDigest([listing({ id: 1, intent: 'have' })]);
    expect(text).not.toContain('NEW WANTS');
  });

  it('appends a Manapool link when available', () => {
    const text = formatDigest([
      listing({
        id: 1,
        intent: 'have',
        manapoolUrl: 'https://manapool.com/card/lea/232/black-lotus',
      }),
    ]);
    expect(text).toContain('[View on Manapool](https://manapool.com/card/lea/232/black-lotus)');
  });

  it('caps each section and notes overflow', () => {
    const rows = Array.from({ length: DIGEST_SECTION_CAP + 5 }, (_, i) =>
      listing({ id: i + 1, intent: 'have', cardName: `Card ${i + 1}` }),
    );
    const text = formatDigest(rows);
    expect(text).toContain('NEW HAVES (30)');
    expect(text).toContain('+5 more');
    expect(text).toContain('- Card 1 (LEA)');
    expect(text).not.toContain('- Card 26 (LEA)');
  });
});

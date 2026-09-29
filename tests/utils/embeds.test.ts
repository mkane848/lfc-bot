import { describe, expect, it } from 'vitest';
import {
  brandColor,
  cardKey,
  digestLine,
  formatListingTitle,
  formatPrice,
  listingEmbed,
} from '../../src/utils/embeds.js';
import type { ListingRow } from '../../src/db/schema.js';

const baseFields = {
  intent: 'have',
  accepts: 'cash',
  cardName: 'Black Lotus',
  cardSet: 'LEP',
};

function listing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 1,
    userId: 'user-1',
    username: 'alice',
    guildId: 'guild-1',
    intent: 'have',
    accepts: 'cash',
    kind: 'card',
    cardName: 'Black Lotus',
    cardSet: 'LEP',
    finish: null,
    variant: null,
    collectorNumber: '1',
    condition: 'nm',
    priceCents: 100000,
    quantity: 1,
    sealedCategory: null,
    sealedSubtype: null,
    notes: null,
    manapoolUrl: null,
    cardImageUrl: null,
    status: 'active',
    expiresAt: Date.now() + 1000,
    createdAt: 1700000000000,
    channelId: 'channel-1',
    messageId: 'message-1',
    ...overrides,
  };
}

describe('brandColor', () => {
  it('returns the documented Liverpool red', () => {
    expect(brandColor()).toBe(0x8f1d2c);
  });
});

describe('formatPrice', () => {
  it('formats an integer cent amount as USD currency', () => {
    expect(formatPrice(12345)).toBe('$123.45');
  });
  it('returns an empty string for null or undefined prices', () => {
    expect(formatPrice(null)).toBe('');
    expect(formatPrice(undefined)).toBe('');
  });
});

describe('formatListingTitle', () => {
  it('packs intent, accepts, name and set into a single line', () => {
    expect(formatListingTitle(baseFields)).toBe('Have · Cash — Black Lotus (LEP)');
  });

  it('falls back to the raw intent/accepts when not in the label map', () => {
    expect(
      formatListingTitle({
        intent: 'unknown-intent',
        accepts: 'unknown-accepts',
        cardName: 'Foo',
        cardSet: 'BAR',
      }),
    ).toBe('unknown-intent · unknown-accepts — Foo (BAR)');
  });

  it('omits the parenthetical when set is missing', () => {
    expect(formatListingTitle({ ...baseFields, cardSet: null })).toBe(
      'Have · Cash — Black Lotus',
    );
  });
});

describe('listingEmbed', () => {
  it('embeds the user line when showUser is true', () => {
    const embed = listingEmbed(listing(), { showUser: true }).toJSON();
    expect(embed.description).toContain('Posted by');
    expect(embed.description).toContain('<@user-1>');
  });

  it('omits the user line when showUser is not set', () => {
    const embed = listingEmbed(listing()).toJSON();
    expect(embed.description).toBeUndefined();
  });

  it('uses a precomputed manapool URL when present on the row', () => {
    const embed = listingEmbed(listing({ manapoolUrl: 'https://manapool.com/card/x' })).toJSON();
    expect(embed.url).toBe('https://manapool.com/card/x');
  });

  it('falls back to a locally built manapool URL when the row has none', () => {
    const embed = listingEmbed(
      listing({ manapoolUrl: null, cardSet: 'ICE', collectorNumber: '89' }),
    ).toJSON();
    expect(embed.url).toBe('https://manapool.com/card/ice/89/black-lotus');
  });

  it('omits the URL entirely when no exact printing can be linked', () => {
    const embed = listingEmbed(listing({ manapoolUrl: null, cardSet: null })).toJSON();
    expect(embed.url).toBeUndefined();
  });

  it('renders condition, price, quantity, finish, variant, collector #, and notes', () => {
    const row = listing({
      finish: 'foil',
      variant: 'borderless',
      notes: 'tagged as proxy',
    });
    const fields = (listingEmbed(row).toJSON().fields ?? []).map((f) => f.name);
    expect(fields).toEqual(
      expect.arrayContaining([
        'Condition',
        'Price',
        'Quantity',
        'Finish',
        'Variant',
        'Collector #',
        'Notes',
      ]),
    );
  });

  it('falls back to raw enum values when not in the label map', () => {
    const row = listing({ condition: 'unknown-cond', finish: 'raw-finish', variant: 'raw-var' });
    const fields = listingEmbed(row).toJSON().fields ?? [];
    const byName: Record<string, string> = {};
    for (const f of fields) byName[f.name] = String(f.value);
    expect(byName['Condition']).toBe('unknown-cond');
    expect(byName['Finish']).toBe('raw-finish');
    expect(byName['Variant']).toBe('raw-var');
  });

  it('always includes the Quantity field even when other fields are null', () => {
    const row = listing({
      condition: null,
      priceCents: null,
      finish: null,
      variant: null,
      collectorNumber: null,
      notes: null,
    });
    const fields = listingEmbed(row).toJSON().fields ?? [];
    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual(
      expect.objectContaining({ name: 'Quantity', value: '1' }),
    );
  });

  it('renders the sealed Product field when category or subtype is present', () => {
    const embed = listingEmbed(
      listing({
        kind: 'sealed',
        sealedCategory: 'booster-box',
        sealedSubtype: 'modern-horizons-2',
        condition: null,
        priceCents: null,
        notes: null,
      }),
    ).toJSON();
    const fields = embed.fields ?? [];
    const product = fields.find((f) => f.name === 'Product');
    expect(product?.value).toContain('Booster Box');
    expect(product?.value).toContain('Modern Horizons 2');
  });

  it('uses the cardImageUrl as thumbnail when present', () => {
    const embed = listingEmbed(listing({ cardImageUrl: 'https://example.com/img.png' })).toJSON();
    expect(embed.thumbnail?.url).toBe('https://example.com/img.png');
  });

  it('uses createdAt as the embed timestamp', () => {
    const embed = listingEmbed(listing({ createdAt: 1700000000000 })).toJSON();
    expect(embed.timestamp).toBe('2023-11-14T22:13:20.000Z');
  });
});

describe('digestLine', () => {
  it('renders a one-line digest entry with set, condition label, price, and Manapool link', () => {
    const line = digestLine(listing({ collectorNumber: '1' }));
    expect(line).toContain('Black Lotus (LEP)');
    expect(line).toContain('— NM');
    expect(line).toContain('$1,000.00');
    expect(line).toContain('@alice');
    expect(line).toContain('https://manapool.com/card/lep/1/black-lotus');
  });

  it('falls back to the raw condition code when not in the label map', () => {
    const line = digestLine(listing({ condition: 'unknown-cond' }));
    expect(line).toContain('— unknown-cond');
  });

  it('omits set, condition, and price when those columns are null', () => {
    const line = digestLine(
      listing({
        cardSet: null,
        condition: null,
        priceCents: null,
        collectorNumber: null,
        manapoolUrl: null,
      }),
    );
    expect(line).toBe('- Black Lotus — @alice');
  });
});

describe('cardKey', () => {
  it('composes name + set uppercased + collector # prefixed', () => {
    expect(cardKey('Black Lotus', 'lep', null, null, '1')).toBe('black lotus::LEP::CN1');
  });

  it('appends finish and variant when provided', () => {
    expect(cardKey('Brainstorm', 'emn', 'foil', 'borderless', '36')).toBe(
      'brainstorm::EMN::CN36::foil::borderless',
    );
  });

  it('omits optional segments when null', () => {
    expect(cardKey('Brainstorm')).toBe('brainstorm');
    expect(cardKey('Brainstorm', 'emn')).toBe('brainstorm::EMN');
  });
});

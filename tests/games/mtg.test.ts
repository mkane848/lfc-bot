import { describe, expect, it } from 'vitest';
import { getGame } from '../../src/games/index.js';
import type { ListingRow } from '../../src/db/schema.js';

const mtg = getGame('mtg');

describe('the Magic game definition', () => {
  it('is registered by default with Manapool as its marketplace', () => {
    expect(mtg).toMatchObject({
      id: 'mtg',
      tag: 'mtg',
      label: 'Magic: The Gathering',
      marketLabel: 'Manapool',
      supportsVariant: true,
    });
  });

  it('takes nonfoil, foil and etched, but not reverse holo', () => {
    expect(mtg?.finishes).toEqual(['nonfoil', 'foil', 'etched']);
  });

  it('treats only a uuid-prefixed sealed value as a catalog pick', () => {
    expect(mtg?.isCatalogPick('sealed', 'uuid:abc')).toBe(true);
    expect(mtg?.isCatalogPick('sealed', 'Bloomburrow Bundle')).toBe(false);
    expect(mtg?.isCatalogPick('card', 'uuid:abc')).toBe(false);
  });

  it('searches a card by its normalized name', () => {
    expect(mtg?.searchTarget('  Lim-Dûl’s Vault ')).toEqual({
      displayName: 'Lim-Dûl’s Vault',
      searchKey: 'lim dul s vault',
    });
  });

  it('falls back to a Manapool link only when set and collector number are known', () => {
    const listing = (cardSet: string | null, collectorNumber: string | null) =>
      ({ cardName: 'Black Lotus', cardSet, collectorNumber }) as Pick<
        ListingRow,
        'cardName' | 'cardSet' | 'collectorNumber'
      >;
    expect(mtg?.fallbackMarketUrl(listing('LEA', '232'))).toBe(
      'https://manapool.com/card/lea/232/black-lotus',
    );
    expect(mtg?.fallbackMarketUrl(listing('LEA', null))).toBeNull();
  });
});

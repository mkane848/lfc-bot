import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListingRow } from '../../src/db/schema.js';
import { conditionText, languageTag, listingEmbed } from '../../src/utils/embeds.js';
import { FAKE_GAME_ID, registerFakeGame, unregisterFakeGame } from '../helpers/games.js';

function listing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 7,
    serverId: '200',
    userId: 'u1',
    username: 'alice',
    intent: 'have',
    accepts: 'cash',
    game: 'mtg',
    language: 'en',
    cardName: 'Black Lotus',
    cardNameNormalized: 'black lotus',
    cardSet: null,
    cardImageUrl: null,
    finish: null,
    variant: null,
    collectorNumber: null,
    marketUrl: null,
    condition: 'nm',
    gradingCompany: null,
    grade: null,
    priceCents: null,
    kind: 'card',
    catalogId: null,
    sealedCategory: null,
    sealedSubtype: null,
    quantity: 1,
    notes: null,
    status: 'active',
    expiresAt: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const fields = (row: ListingRow, options: { showGame?: boolean } = {}) =>
  Object.fromEntries(
    (listingEmbed(row, options).toJSON().fields ?? []).map((field) => [field.name, field.value]),
  );

describe('conditionText', () => {
  it('names a raw condition, and a graded slab by its grade', () => {
    expect(conditionText({ condition: 'lp', gradingCompany: null, grade: null })).toBe('LP');
    expect(conditionText({ condition: 'graded', gradingCompany: 'BGS', grade: '9.5' })).toBe(
      'BGS 9.5',
    );
  });

  it('falls back to "Graded" for a slab with no grade stored, and to nothing for no condition', () => {
    expect(conditionText({ condition: 'graded', gradingCompany: null, grade: null })).toBe(
      'Graded',
    );
    expect(conditionText({ condition: null, gradingCompany: null, grade: null })).toBeNull();
  });
});

describe('languageTag', () => {
  it('is the upper-cased code, except for English and nothing', () => {
    expect(languageTag('ja')).toBe('JA');
    expect(languageTag('zh-cn')).toBe('ZH-CN');
    expect(languageTag('en')).toBeNull();
    expect(languageTag(null)).toBeNull();
    expect(languageTag(undefined)).toBeNull();
  });
});

describe('listingEmbed', () => {
  beforeEach(() => {
    registerFakeGame({ fallbackMarketUrl: () => 'https://fake.example/fallback' });
  });

  afterEach(() => {
    unregisterFakeGame();
  });

  it('shows a raw condition as a Condition field and no Language for English', () => {
    expect(fields(listing())).toEqual({ Condition: 'NM', Quantity: '1' });
  });

  it('shows a graded slab as a Grade field instead of a Condition field', () => {
    expect(fields(listing({ condition: 'graded', gradingCompany: 'PSA', grade: '10' }))).toEqual({
      Grade: 'PSA 10',
      Quantity: '1',
    });
  });

  it('shows the language by name when it is not English', () => {
    expect(fields(listing({ language: 'ja' })).Language).toBe('Japanese');
    expect(fields(listing({ language: 'zh-tw' })).Language).toBe('Chinese (Traditional)');
  });

  it('labels the reverse holo finish', () => {
    expect(fields(listing({ finish: 'reverse' })).Finish).toBe('Reverse Holo');
  });

  it('puts the game in the footer only when asked', () => {
    expect(listingEmbed(listing()).toJSON().footer?.text).toBe('Listing #7');
    expect(listingEmbed(listing(), { showGame: true }).toJSON().footer?.text).toBe(
      'Listing #7 · MTG',
    );
    expect(
      listingEmbed(listing({ game: FAKE_GAME_ID }), { showGame: true }).toJSON().footer?.text,
    ).toBe('Listing #7 · FKG');
  });

  it('links to the stored URL, else the game’s own fallback, else nothing', () => {
    const stored = listing({ marketUrl: 'https://manapool.com/card/lea/232/black-lotus' });
    expect(listingEmbed(stored).toJSON().url).toBe(stored.marketUrl);

    const magic = listing({ cardSet: 'LEA', collectorNumber: '232' });
    expect(listingEmbed(magic).toJSON().url).toBe('https://manapool.com/card/lea/232/black-lotus');
    expect(listingEmbed(listing()).toJSON().url).toBeUndefined();

    const fake = listing({ game: FAKE_GAME_ID, cardSet: 'LEA', collectorNumber: '232' });
    expect(listingEmbed(fake).toJSON().url).toBe('https://fake.example/fallback');
  });

  it('never borrows another game’s fallback link for a game that has none', () => {
    unregisterFakeGame();
    registerFakeGame({ fallbackMarketUrl: () => null });
    const fake = listing({ game: FAKE_GAME_ID, cardSet: 'LEA', collectorNumber: '232' });
    expect(listingEmbed(fake).toJSON().url).toBeUndefined();
  });

  it('renders a listing whose game is no longer registered, without a link or a game label', () => {
    unregisterFakeGame();
    const orphan = listing({ game: FAKE_GAME_ID, cardSet: 'LEA', collectorNumber: '232' });
    const embed = listingEmbed(orphan, { showGame: true }).toJSON();
    expect(embed.url).toBeUndefined();
    expect(embed.footer?.text).toBe('Listing #7');
  });
});

import { describe, expect, it } from 'vitest';
import { formatSealedType } from '../../src/utils/constants.js';

describe('formatSealedType', () => {
  it('de-underscores and title-cases a plain enum value', () => {
    expect(formatSealedType('booster_box')).toBe('Booster Box');
    expect(formatSealedType('limited_aid_tool')).toBe('Limited Aid Tool');
    expect(formatSealedType('bundle')).toBe('Bundle');
  });

  it('applies the label overrides', () => {
    expect(formatSealedType('mtgo_redemption')).toBe('MTGO Redemption');
    expect(formatSealedType('deck_builders_toolkit')).toBe("Deck Builder's Toolkit");
    expect(formatSealedType('collectors_edition')).toBe("Collector's Edition");
    expect(formatSealedType('from_the_vault')).toBe('From the Vault');
    expect(formatSealedType('two_player_starter')).toBe('Two-Player Starter');
    expect(formatSealedType('six-card')).toBe('Six-Card');
  });

  it('renders placeholder values as an empty string so callers skip the field', () => {
    expect(formatSealedType('unknown')).toBe('');
    expect(formatSealedType('default')).toBe('');
    expect(formatSealedType('other')).toBe('');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(formatSealedType('')).toBe('');
    expect(formatSealedType('   ')).toBe('');
  });

  it('title-cases an unrecognized value rather than blanking it', () => {
    // MTGJSON adds enum values without warning; a new one must still render.
    expect(formatSealedType('brand_new_category')).toBe('Brand New Category');
  });

  it('normalizes casing and surrounding whitespace', () => {
    expect(formatSealedType('  Booster_Pack  ')).toBe('Booster Pack');
  });
});

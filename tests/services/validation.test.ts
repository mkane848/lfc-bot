import { describe, expect, it } from 'vitest';
import {
  isCardCondition,
  isDigestMode,
  isListingType,
  normalizeCardName,
  parsePriceToCents,
  parseQuantity,
  validateNotes,
  ValidationError,
} from '../../src/utils/validation.js';

describe('condition/type/mode guards', () => {
  it('accepts valid card conditions', () => {
    expect(isCardCondition('nm')).toBe(true);
    expect(isCardCondition('dmg')).toBe(true);
    expect(isCardCondition('mint')).toBe(false);
  });

  it('accepts valid listing types', () => {
    expect(isListingType('buy')).toBe(true);
    expect(isListingType('trade')).toBe(true);
    expect(isListingType('rent')).toBe(false);
  });

  it('accepts valid digest modes', () => {
    expect(isDigestMode('both')).toBe(true);
    expect(isDigestMode('disabled')).toBe(true);
    expect(isDigestMode('carrier-pigeon')).toBe(false);
  });
});

describe('normalizeCardName', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeCardName('Lightning Bolt !')).toBe('lightning bolt');
    expect(normalizeCardName('  Jace,  the   Mind Sculptor  ')).toBe('jace the mind sculptor');
  });

  it('strips diacritics', () => {
    expect(normalizeCardName('Ereshkigäl')).toBe('ereshkigal');
  });
});

describe('parsePriceToCents', () => {
  it('converts dollars to cents', () => {
    expect(parsePriceToCents('2.50')).toBe(250);
    expect(parsePriceToCents('100000.00')).toBe(10000000);
  });

  it('rejects invalid or out-of-range prices', () => {
    expect(() => parsePriceToCents('abc')).toThrow(ValidationError);
    expect(() => parsePriceToCents('-5')).toThrow(ValidationError);
    expect(() => parsePriceToCents('100001.00')).toThrow(ValidationError);
  });
});

describe('parseQuantity', () => {
  it('accepts quantities in range', () => {
    expect(parseQuantity('1')).toBe(1);
    expect(parseQuantity('99')).toBe(99);
  });

  it('rejects out-of-range or fractional quantities', () => {
    expect(() => parseQuantity('0')).toThrow(ValidationError);
    expect(() => parseQuantity('100')).toThrow(ValidationError);
    expect(() => parseQuantity('2.5')).toThrow(ValidationError);
  });
});

describe('validateNotes', () => {
  it('returns null for empty notes', () => {
    expect(validateNotes('')).toBeNull();
    expect(validateNotes(undefined)).toBeNull();
  });

  it('rejects long notes', () => {
    expect(() => validateNotes('x'.repeat(501))).toThrow(ValidationError);
    expect(validateNotes('x'.repeat(500))).toHaveLength(500);
  });
});

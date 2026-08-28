import { describe, expect, it } from 'vitest';
import {
  isAccepts,
  isCardCondition,
  isCardFinish,
  isCardVariant,
  isDigestMode,
  isListingIntent,
  normalizeCardName,
  parsePriceToCents,
  parseQuantity,
  validateCollectorNumber,
  validateNotes,
  ValidationError,
} from '../../src/utils/validation.js';

describe('condition/intent/accepts/mode guards', () => {
  it('accepts valid card conditions', () => {
    expect(isCardCondition('nm')).toBe(true);
    expect(isCardCondition('dmg')).toBe(true);
    expect(isCardCondition('mint')).toBe(false);
  });

  it('accepts valid listing intents', () => {
    expect(isListingIntent('have')).toBe(true);
    expect(isListingIntent('want')).toBe(true);
    expect(isListingIntent('rent')).toBe(false);
  });

  it('accepts valid accepts values', () => {
    expect(isAccepts('cash')).toBe(true);
    expect(isAccepts('trade')).toBe(true);
    expect(isAccepts('both')).toBe(true);
    expect(isAccepts('crypto')).toBe(false);
  });

  it('accepts valid card finishes', () => {
    expect(isCardFinish('nonfoil')).toBe(true);
    expect(isCardFinish('foil')).toBe(true);
    expect(isCardFinish('etched')).toBe(true);
    expect(isCardFinish('holographic')).toBe(false);
  });

  it('accepts valid card variants', () => {
    expect(isCardVariant('extended')).toBe(true);
    expect(isCardVariant('borderless')).toBe(true);
    expect(isCardVariant('signed')).toBe(false);
  });

  it('accepts valid digest modes', () => {
    expect(isDigestMode('both')).toBe(true);
    expect(isDigestMode('disabled')).toBe(true);
    expect(isDigestMode('carrier-pigeon')).toBe(false);
  });
});

describe('validateCollectorNumber', () => {
  it('accepts alphanumeric collector numbers', () => {
    expect(validateCollectorNumber('89')).toBe('89');
    expect(validateCollectorNumber(' 123a ')).toBe('123a');
    expect(validateCollectorNumber('★7')).toBe('★7');
  });

  it('rejects empty or invalid collector numbers', () => {
    expect(() => validateCollectorNumber('')).toThrow(ValidationError);
    expect(() => validateCollectorNumber('   ')).toThrow(ValidationError);
    expect(() => validateCollectorNumber('89/100')).toThrow(ValidationError);
    expect(() => validateCollectorNumber('x'.repeat(21))).toThrow(ValidationError);
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

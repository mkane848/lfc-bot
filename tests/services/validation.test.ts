import { describe, expect, it } from 'vitest';
import {
  isAccepts,
  isCardCondition,
  isCardFinish,
  isCardVariant,
  isDigestMode,
  isListingIntent,
  isListingLanguage,
  formatGrade,
  normalizeCardName,
  parseConditionOrGrade,
  parseGrade,
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
    expect(isCardCondition('graded')).toBe(true);
    expect(isCardCondition('mint')).toBe(false);
  });

  it('accepts reverse holo as a finish', () => {
    expect(isCardFinish('reverse')).toBe(true);
  });

  it('accepts the supported listing languages only', () => {
    expect(isListingLanguage('en')).toBe(true);
    expect(isListingLanguage('zh-tw')).toBe(true);
    expect(isListingLanguage('klingon')).toBe(false);
    expect(isListingLanguage('EN')).toBe(false);
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

describe('parseGrade', () => {
  it('splits a company and a grade, ignoring case and spacing', () => {
    expect(parseGrade('PSA 10')).toEqual({ gradingCompany: 'PSA', grade: '10' });
    expect(parseGrade('psa10')).toEqual({ gradingCompany: 'PSA', grade: '10' });
    expect(parseGrade('  bgs   9.5 ')).toEqual({ gradingCompany: 'BGS', grade: '9.5' });
    expect(parseGrade('CGC 9')).toEqual({ gradingCompany: 'CGC', grade: '9' });
  });

  it('accepts every supported company', () => {
    for (const company of ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'ACE']) {
      expect(parseGrade(`${company} 8`).gradingCompany).toBe(company);
    }
  });

  it('rejects an unknown company, a missing grade, and an out-of-range grade', () => {
    expect(() => parseGrade('XYZ 10')).toThrow(/Companies: PSA, BGS, CGC, SGC, TAG, ACE/);
    expect(() => parseGrade('PSA')).toThrow(ValidationError);
    expect(() => parseGrade('PSA 0')).toThrow(ValidationError);
    expect(() => parseGrade('PSA 11')).toThrow(ValidationError);
    expect(() => parseGrade('BGS 9.7')).toThrow(ValidationError);
    expect(() => parseGrade('BGS 10.5')).toThrow(ValidationError);
    expect(() => parseGrade('PSA 10 black label')).toThrow(ValidationError);
  });
});

describe('formatGrade', () => {
  it('renders the way members type it', () => {
    expect(formatGrade('PSA', '10')).toBe('PSA 10');
    expect(formatGrade('BGS', '9.5')).toBe('BGS 9.5');
  });

  it('renders nothing for a missing grade', () => {
    expect(formatGrade(null, null)).toBe('');
    expect(formatGrade(undefined, undefined)).toBe('');
  });
});

describe('parseConditionOrGrade', () => {
  it('reads a raw condition, ignoring case', () => {
    expect(parseConditionOrGrade('NM')).toEqual({
      condition: 'nm',
      gradingCompany: null,
      grade: null,
    });
  });

  it('reads a grade as a graded condition', () => {
    expect(parseConditionOrGrade('PSA 10')).toEqual({
      condition: 'graded',
      gradingCompany: 'PSA',
      grade: '10',
    });
  });

  it('rejects a bare "graded", since a slab without its grade says nothing', () => {
    expect(() => parseConditionOrGrade('graded')).toThrow(/Say which grade/);
  });

  it('rejects anything else, pointing at both forms', () => {
    expect(() => parseConditionOrGrade('mint')).toThrow(
      /Invalid condition "mint".*nm, lp, mp, hp, dmg, or a grade such as PSA 10/,
    );
  });
});

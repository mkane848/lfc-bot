import { describe, expect, it } from 'vitest';
import {
  parseBatchAccepts,
  parseHaveBatchLine,
  parseHaveSealedBatchLine,
  parseWantBatchLine,
  parseWantSealedBatchLine,
} from '../../src/utils/batch.js';

describe('parseHaveBatchLine', () => {
  it('parses a full line', () => {
    expect(parseHaveBatchLine('Lightning Bolt | nm | 2.50 | 2')).toEqual({
      cardName: 'Lightning Bolt',
      condition: 'nm',
      priceCents: 250,
      quantity: 2,
    });
  });

  it('parses a minimal line (name and condition only), defaulting quantity to 1', () => {
    expect(parseHaveBatchLine('Lightning Bolt | nm')).toEqual({
      cardName: 'Lightning Bolt',
      condition: 'nm',
      priceCents: null,
      quantity: 1,
    });
  });

  it('rejects a line missing the condition segment entirely', () => {
    expect(() => parseHaveBatchLine('Lightning Bolt')).toThrow(/Use the format/);
  });

  it('rejects a blank card name', () => {
    expect(() => parseHaveBatchLine(' | nm')).toThrow(/Card name is required/);
  });

  it('rejects an invalid condition code', () => {
    expect(() => parseHaveBatchLine('Lightning Bolt | xx')).toThrow(/Invalid condition/);
  });

  it('rejects a malformed price', () => {
    expect(() => parseHaveBatchLine('Lightning Bolt | nm | abc')).toThrow(
      /Price must be a positive number/,
    );
  });

  it('rejects a quantity outside the allowed range', () => {
    expect(() => parseHaveBatchLine('Lightning Bolt | nm | 2.50 | 200')).toThrow(
      /Quantity must be between/,
    );
  });

  it('rejects too many segments', () => {
    expect(() => parseHaveBatchLine('A | nm | 1 | 2 | 3')).toThrow(/Use the format/);
  });
});

describe('parseWantBatchLine', () => {
  it('parses a full line', () => {
    expect(parseWantBatchLine('Solitude | nm | 15.00')).toEqual({
      cardName: 'Solitude',
      condition: 'nm',
      maxPriceCents: 1500,
    });
  });

  it('parses a name-only line, leaving condition and max price unset', () => {
    expect(parseWantBatchLine('Solitude')).toEqual({
      cardName: 'Solitude',
      condition: null,
      maxPriceCents: null,
    });
  });

  it('rejects a blank card name', () => {
    expect(() => parseWantBatchLine(' | nm')).toThrow(/Card name is required/);
  });

  it('rejects an invalid condition code', () => {
    expect(() => parseWantBatchLine('Solitude | xx')).toThrow(/Invalid condition/);
  });

  it('rejects a malformed max price', () => {
    expect(() => parseWantBatchLine('Solitude | nm | abc')).toThrow(
      /Price must be a positive number/,
    );
  });

  it('rejects too many segments', () => {
    expect(() => parseWantBatchLine('A | nm | 1 | extra')).toThrow(/Use the format/);
  });
});

describe('parseBatchAccepts', () => {
  it('accepts valid values, trimmed and case-insensitive', () => {
    expect(parseBatchAccepts('cash')).toBe('cash');
    expect(parseBatchAccepts(' Trade ')).toBe('trade');
    expect(parseBatchAccepts('BOTH')).toBe('both');
  });

  it('rejects an invalid value', () => {
    expect(() => parseBatchAccepts('crypto')).toThrow(/Invalid accepts value/);
  });
});

describe('parseHaveSealedBatchLine', () => {
  it('parses a full line', () => {
    expect(parseHaveSealedBatchLine('Bloomburrow Bundle | 89.99 | 2')).toEqual({
      productName: 'Bloomburrow Bundle',
      priceCents: 8999,
      quantity: 2,
    });
  });

  it('parses a name-only line, defaulting quantity to 1 and price to null', () => {
    expect(parseHaveSealedBatchLine('Bloomburrow Bundle')).toEqual({
      productName: 'Bloomburrow Bundle',
      priceCents: null,
      quantity: 1,
    });
  });

  it('rejects more columns than the sealed format has', () => {
    expect(() => parseHaveSealedBatchLine('A | 1.00 | 2 | 3')).toThrow(/Product Name \| price/);
  });

  // Sealed has no condition column, so a card-shaped line lands a condition
  // where the price belongs. The price error is the correct complaint.
  it('rejects a card-shaped line that includes a condition', () => {
    expect(() => parseHaveSealedBatchLine('Bloomburrow Bundle | nm | 89.99')).toThrow(/Price/);
  });
});

describe('parseWantSealedBatchLine', () => {
  it('parses a full line', () => {
    expect(parseWantSealedBatchLine('Bloomburrow Bundle | 100.00')).toEqual({
      productName: 'Bloomburrow Bundle',
      maxPriceCents: 10000,
    });
  });

  it('parses a name-only line', () => {
    expect(parseWantSealedBatchLine('Bloomburrow Bundle')).toEqual({
      productName: 'Bloomburrow Bundle',
      maxPriceCents: null,
    });
  });

  it('rejects more columns than the sealed format has', () => {
    expect(() => parseWantSealedBatchLine('A | 1.00 | 2')).toThrow(/Product Name \| max_price/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  baseProductName,
  cleanGroupName,
  cleanProductName,
  collectorNumberOf,
  releaseDateOf,
  searchKeyFor,
  setLabelFor,
} from '../../src/utils/catalog-names.js';
import { tcgplayerImageUrl, tcgplayerProductUrl } from '../../src/utils/tcgplayer.js';
import { normalizeCardName, validateCollectorNumber } from '../../src/utils/validation.js';

// Every case below is a product name or number that TCGCSV really publishes.

describe('collectorNumberOf', () => {
  it('takes the numerator and drops the denominator or promo marker', () => {
    expect(collectorNumberOf('125/197')).toBe('125');
    expect(collectorNumberOf('024/144')).toBe('024');
    expect(collectorNumberOf('H25/H32')).toBe('H25');
    expect(collectorNumberOf('TG01/TG30')).toBe('TG01');
    expect(collectorNumberOf('001/SV-P')).toBe('001');
  });

  it('keeps a number that has no denominator, spaces and all', () => {
    expect(collectorNumberOf('125')).toBe('125');
    expect(collectorNumberOf('PW 1')).toBe('PW 1');
  });

  it('is null for no number, which is how sealed product is told from a card', () => {
    expect(collectorNumberOf(null)).toBeNull();
    expect(collectorNumberOf(undefined)).toBeNull();
    expect(collectorNumberOf('')).toBeNull();
    expect(collectorNumberOf('  ')).toBeNull();
  });

  it('gives a numerator the collector-number validator accepts', () => {
    for (const raw of ['125/197', 'H25/H32', 'TG01/TG30', '001/SV-P', '069/SV-P']) {
      expect(() => validateCollectorNumber(collectorNumberOf(raw) ?? '')).not.toThrow();
    }
  });
});

describe('cleanProductName', () => {
  it('takes out the product’s own number written as a suffix', () => {
    expect(cleanProductName('Blastoise ex - 202/165', '202/165')).toBe('Blastoise ex');
    expect(cleanProductName('Minior - 070/062', '070/062')).toBe('Minior');
    expect(cleanProductName('Charizard ex - 161', '161')).toBe('Charizard ex');
    expect(cleanProductName('Pikachu - 291/SV-P', '291/SV-P')).toBe('Pikachu');
  });

  it('takes it out even when the name pads the number with zeros the Number field lacks', () => {
    expect(cleanProductName('Corphish - 062/110', '62/110')).toBe('Corphish');
    expect(cleanProductName('Bulbasaur - 045/100', '45/100')).toBe('Bulbasaur');
  });

  it('keeps the qualifier that follows the number', () => {
    expect(cleanProductName('Mr. Mime - 122/165 (Poke Ball Pattern)', '122/165')).toBe(
      'Mr. Mime (Poke Ball Pattern)',
    );
    expect(cleanProductName('Latias - 011/110 (Delta Species)', '11/110')).toBe(
      'Latias (Delta Species)',
    );
    expect(cleanProductName('Golisopod - 049/182 (Non-Holo)', '049/182')).toBe(
      'Golisopod (Non-Holo)',
    );
  });

  it('takes out a trailing parenthetical that only repeats the number', () => {
    expect(cleanProductName('Piloswine (24)', '024/144')).toBe('Piloswine');
    expect(cleanProductName('Raichu (H25)', 'H25/H32')).toBe('Raichu');
    expect(cleanProductName('Nidoran F (81)', '081/165')).toBe('Nidoran F');
    expect(cleanProductName('Grookey (011)', '011/202')).toBe('Grookey');
  });

  it('keeps a parenthetical that names the printing, and one that is a different number', () => {
    expect(cleanProductName('Nidoran F (Poke Ball Pattern)', '81/165')).toBe(
      'Nidoran F (Poke Ball Pattern)',
    );
    expect(cleanProductName('Charizard ex (Full Art)', '125/197')).toBe('Charizard ex (Full Art)');
    expect(cleanProductName('Pikachu (25)', '30/100')).toBe('Pikachu (25)');
  });

  it('keeps an unrelated " - " suffix, such as a World Championship deck card', () => {
    expect(cleanProductName('Gardevoir ex - 2010 (Michael Pramawat)', '1')).toBe(
      'Gardevoir ex - 2010 (Michael Pramawat)',
    );
  });

  it('leaves a name with no number in it alone, and trims it', () => {
    expect(cleanProductName('  Pikachu  ', '25/100')).toBe('Pikachu');
    expect(cleanProductName('Pikachu', null)).toBe('Pikachu');
  });

  it('never returns more than a listing’s name can hold', () => {
    expect(cleanProductName('x'.repeat(150), null)).toHaveLength(100);
  });
});

describe('baseProductName / searchKeyFor', () => {
  it('drops a trailing printing qualifier and only that', () => {
    expect(baseProductName('Charizard ex (Full Art)')).toBe('Charizard ex');
    expect(baseProductName('Mr. Mime (Poke Ball Pattern)')).toBe('Mr. Mime');
    expect(baseProductName('Charizard ex')).toBe('Charizard ex');
    expect(baseProductName('Unown (A) Holo')).toBe('Unown (A) Holo');
  });

  it('makes a search key every printing of a card shares', () => {
    expect(searchKeyFor('Charizard ex')).toBe('charizard ex');
    expect(searchKeyFor('Charizard ex (Full Art)')).toBe('charizard ex');
    expect(searchKeyFor("Farfetch'd (Master Ball Pattern)")).toBe('farfetch d');
  });

  it('keeps the two Nidoran apart, whether spelled F/M or with the signs', () => {
    expect(searchKeyFor('Nidoran F')).toBe('nidoran f');
    expect(searchKeyFor('Nidoran M')).toBe('nidoran m');
    expect(normalizeCardName('Nidoran♀')).toBe('nidoran f');
    expect(normalizeCardName('Nidoran♂')).toBe('nidoran m');
    expect(normalizeCardName('Nidoran♀')).not.toBe(normalizeCardName('Nidoran♂'));
  });

  it('leaves Magic names’ keys as they were', () => {
    expect(normalizeCardName('Lim-Dûl’s Vault')).toBe('lim dul s vault');
    expect(normalizeCardName('Black Lotus')).toBe('black lotus');
  });
});

describe('cleanGroupName', () => {
  it('drops the code TCGCSV prefixes a group with', () => {
    expect(cleanGroupName('SV03: Obsidian Flames')).toBe('Obsidian Flames');
    expect(cleanGroupName('M6a: MEGA Expansion 30th Celebration')).toBe(
      'MEGA Expansion 30th Celebration',
    );
    expect(cleanGroupName('ME: 30th Celebration')).toBe('30th Celebration');
    expect(cleanGroupName('SWSH12: Silver Tempest Trainer Gallery')).toBe(
      'Silver Tempest Trainer Gallery',
    );
  });

  it('keeps words before a colon that are not a code', () => {
    expect(cleanGroupName('XY Trainer Kit: Pikachu Libre & Suicune')).toBe(
      'XY Trainer Kit: Pikachu Libre & Suicune',
    );
    expect(cleanGroupName('Call of Legends')).toBe('Call of Legends');
  });
});

describe('releaseDateOf', () => {
  it('reads a real date, which TCGCSV writes at midnight', () => {
    expect(releaseDateOf('2023-08-11T00:00:00')).toBe('2023-08-11');
    expect(releaseDateOf('2026-11-06T00:00:00')).toBe('2026-11-06');
  });

  it('treats the build timestamp TCGplayer uses for a set with no date as unknown', () => {
    expect(releaseDateOf('2026-10-23T20:00:07.1827719Z')).toBeNull();
    expect(releaseDateOf('2026-10-23T20:00:07.2072614Z')).toBeNull();
  });

  it('is null for anything that is not a date', () => {
    expect(releaseDateOf(null)).toBeNull();
    expect(releaseDateOf(undefined)).toBeNull();
    expect(releaseDateOf('')).toBeNull();
    expect(releaseDateOf('soon')).toBeNull();
  });
});

describe('setLabelFor', () => {
  it('is the code in upper case', () => {
    expect(setLabelFor('OBF', 'Obsidian Flames')).toBe('OBF');
    expect(setLabelFor('m6a', 'MEGA Expansion 30th Celebration')).toBe('M6A');
    expect(setLabelFor('SWSH12: TG', 'Silver Tempest Trainer Gallery')).toBe('SWSH12: TG');
  });

  it('is the name, cut to what the edit modal’s set field holds, when there is no code', () => {
    const label = setLabelFor('', 'ex Starter Set Marnie’s Morpeko');
    expect(label).toBe('EX STARTER');
    expect(label.length).toBeLessThanOrEqual(10);
    expect(setLabelFor('  ', 'Short')).toBe('SHORT');
  });

  it('is already what the edit modal’s unchanged-set check compares against', () => {
    // `/edit` upper-cases what the member submits and compares it to the stored
    // set, so a label that is not already upper case would always look changed.
    for (const [code, name] of [
      ['m6a', 'x'],
      ['', 'lower case name'],
      ['Obf', 'y'],
    ] as const) {
      const label = setLabelFor(code, name);
      expect(label).toBe(label.toUpperCase());
    }
  });
});

describe('TCGplayer URLs', () => {
  it('builds the product link and the thumbnail from the id', () => {
    expect(tcgplayerProductUrl('501256')).toBe('https://www.tcgplayer.com/product/501256');
    expect(tcgplayerProductUrl(509879)).toBe('https://www.tcgplayer.com/product/509879');
    expect(tcgplayerImageUrl('501256')).toBe(
      'https://tcgplayer-cdn.tcgplayer.com/product/501256_200w.jpg',
    );
  });
});

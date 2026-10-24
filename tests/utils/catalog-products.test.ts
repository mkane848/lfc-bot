import { describe, expect, it } from 'vitest';
import { classifyProduct, POKEMON_SEALED_CATEGORIES } from '../../src/utils/catalog-products.js';
import type { ProductClass } from '../../src/utils/catalog-products.js';
import { formatSealedType } from '../../src/utils/constants.js';

// Every name below is a product name TCGCSV really publishes for Pokémon.

const sealed = (name: string): string | null => {
  const result: ProductClass = classifyProduct(name, null);
  return result.kind === 'sealed' ? result.category : result.kind;
};

describe('classifyProduct: a product with a number', () => {
  it('is always a card, whatever its name says', () => {
    expect(classifyProduct('Charizard ex', '125/197')).toEqual({ kind: 'card' });
    expect(classifyProduct('Elite Trainer Box Pikachu', '4/10')).toEqual({ kind: 'card' });
    expect(classifyProduct('Code Card - Something', '1')).toEqual({ kind: 'card' });
  });

  it('treats a blank number as none', () => {
    expect(classifyProduct('Obsidian Flames Booster Box', '  ')).toEqual({
      kind: 'sealed',
      category: 'booster_box',
    });
  });
});

describe('classifyProduct: sealed product', () => {
  it.each([
    ['Obsidian Flames Booster Pack', 'booster_pack'],
    ['Phantom Forces Sleeved Booster Pack', 'booster_pack'],
    ['Surging Sparks Fun Pack', 'booster_pack'],
    ['Pokemon GO Booster Pack', 'booster_pack'],
    ['Obsidian Flames Booster Box', 'booster_box'],
    ['Crown Zenith Booster Display Box', 'booster_box'],
    ['Twilight Masquerade Sleeved Booster Pack Display', 'booster_box'],
    ['Obsidian Flames Booster Bundle', 'booster_bundle'],
    ['Evolutions Sleeved Booster Pack Art Bundle [Set of 4]', 'booster_bundle'],
    ['Scarlet & Violet Elite Trainer Box', 'elite_trainer_box'],
    ['Scarlet & Violet Elite Trainer Boxes [Set of 2]', 'elite_trainer_box'],
    ['Black Bolt Pokemon Center Elite Trainer Box (Exclusive)', 'elite_trainer_box'],
    ['Surging Sparks 3 Pack Blisters [Zapdos]', 'blister'],
    ['XY Single Pack Blister [Dragonite]', 'blister'],
    ['Paldean Fates Tin', 'tin'],
    ['Ascended Heroes Mini Tins 5-Pack', 'tin'],
    ['Pokemon Stacking Tins [Set of 3] (Psychic, Metal, and Dragon)', 'tin'],
    ['Paldean Fates Premium Collection [Skeledirge ex]', 'collection'],
    ['Charizard ex Super-Premium Collection', 'collection'],
    ['Galarian Rapidash V Box', 'collection'],
    ['Prime Challenge Box [Espeon]', 'collection'],
    ['XY Flashfire Collector Chest', 'collection'],
    ['White Flare Binder Collection', 'collection'],
    ['Arceus Theme Deck - "Flamemaster"', 'deck'],
    ['League Battle Deck [Zacian V]', 'deck'],
    ['Kalos Starter Deck [Fennekin]', 'deck'],
    ['Sun & Moon Trainer Kit: Lycanroc & Alolan Raichu', 'deck'],
    ["Pokemon TCG: Trainer's Toolkit (2021)", 'deck'],
    ['2023 World Championship Deck [Set of 4]', 'deck'],
    ['Pokemon 2-Player Starter Set', 'deck'],
    ['Sun & Moon Build & Battle Box', 'build_and_battle'],
    ['Steam Siege Prerelease Kit', 'prerelease_kit'],
    ['Steam Siege Prerelease Kit Display', 'prerelease_kit'],
  ])('%s is %s', (name, category) => {
    expect(sealed(name)).toBe(category);
  });

  it('calls a case of anything a case, ahead of what is in it', () => {
    expect(sealed('Journey Together Elite Trainer Box Case')).toBe('case');
    expect(sealed('Brilliant Stars Booster Box Case')).toBe('case');
    expect(sealed('Paldean Fates Tin Case')).toBe('case');
    expect(sealed('Eevee Evolutions Premium Collection Case')).toBe('case');
  });

  it('files a product with no better word as "other", which shows nothing on the listing', () => {
    expect(sealed('Pokemon TCG: Battle Academy 2024')).toBe('other');
    expect(sealed('Holiday Calendar 2025')).toBe('other');
    expect(sealed('Pokemon TCG: Back to School Pencil Case')).toBe('other');
    expect(sealed('Mewtwo V-UNION [Set of 4]')).toBe('other');
    expect(sealed('Pokemon Card 151 Card File Set - Poke Ball')).toBe('other');
    expect(sealed('Play! Pokemon Prize Pack Series Three')).toBe('other');
    expect(formatSealedType('other')).toBe('');
  });
});

describe('classifyProduct: an unnumbered single is a card', () => {
  it.each([
    'Charizard',
    'Magneton',
    'Fire Energy',
    'Basic Metal Energy',
    'Fire Energy (2006 Unnumbered)',
    'Fighting Energy (WotC 2002 League Promo)',
    "Erika's Oddish (Lv.10)",
    'Gardevoir LV.X',
    'Double Full Heal',
    'Miraidon ex (Unnumbered)',
    'Victory Medal - 2008-2009 (Battle Road Spring)',
    'Dragapult ex - 2025 (Jose Cruz Galindo-Resendiz) [Gold Stamped]',
  ])('%s', (name) => {
    expect(classifyProduct(name, null)).toEqual({ kind: 'card' });
  });

  it('is not fooled by "Prize Pack", which is a series of energy cards, not a pack', () => {
    expect(classifyProduct('Fire Energy (Prize Pack Series 1)', null)).toEqual({ kind: 'card' });
    expect(classifyProduct('Lightning Energy (Prize Pack Series 3) (Cosmos Holo)', null)).toEqual({
      kind: 'card',
    });
  });
});

describe('classifyProduct: digital codes', () => {
  it('skips a code card, which a listing cannot be about', () => {
    expect(classifyProduct('Code Card - Scarlet & Violet Booster Pack', null)).toEqual({
      kind: 'skip',
    });
    expect(classifyProduct('Code Card - Pikachu Battle Deck', null)).toEqual({ kind: 'skip' });
  });
});

describe('the categories', () => {
  it('render as readable labels, with Build & Battle given its ampersand', () => {
    expect(formatSealedType('booster_box')).toBe('Booster Box');
    expect(formatSealedType('elite_trainer_box')).toBe('Elite Trainer Box');
    expect(formatSealedType('prerelease_kit')).toBe('Prerelease Kit');
    expect(formatSealedType('build_and_battle')).toBe('Build & Battle');
  });

  it('are exactly the ones the classifier can return', () => {
    const returned = new Set(
      [
        'Obsidian Flames Booster Pack',
        'Obsidian Flames Booster Box',
        'Obsidian Flames Booster Bundle',
        'Scarlet & Violet Elite Trainer Box',
        'XY Single Pack Blister [Dragonite]',
        'Paldean Fates Tin',
        'Premium Collection',
        'Theme Deck',
        'Build & Battle Box',
        'Prerelease Kit',
        'Booster Box Case',
        'Holiday Calendar',
      ].map(sealed),
    );
    expect([...returned].sort()).toEqual([...POKEMON_SEALED_CATEGORIES].sort());
  });
});

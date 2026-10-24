/**
 * Telling TCGCSV's Pokémon products apart. A product with a `Number` is a
 * single card. One without is not necessarily sealed: of the ~7,600 products
 * with no number, about 3,100 are older singles the source never numbered
 * (`Charizard`, `Fire Energy (2006 Unnumbered)`, `Erika's Oddish (Lv.10)`) and
 * about 1,300 are digital code cards, so this reads the name. The rules are
 * keyword matches pinned by tests against real product names; a name that
 * matches none of them is a single, since that is what an unnumbered product
 * most often is.
 */

/** What a sealed product is, stored in `catalog_items.category` and shown on the listing. */
export const POKEMON_SEALED_CATEGORIES = [
  'booster_pack',
  'booster_box',
  'booster_bundle',
  'elite_trainer_box',
  'blister',
  'tin',
  'collection',
  'deck',
  'build_and_battle',
  'prerelease_kit',
  'case',
  'other',
] as const;

export type PokemonSealedCategory = (typeof POKEMON_SEALED_CATEGORIES)[number];

export type ProductClass =
  | { kind: 'card' }
  | { kind: 'sealed'; category: PokemonSealedCategory }
  /** Not something a listing can be about: a digital code for the online game. */
  | { kind: 'skip' };

/**
 * Checked in order, so a more specific product wins over a more general word
 * in its name (`Elite Trainer Box Case` is a case, `Booster Bundle Display` a
 * bundle). `Prize Pack Series 1` energy cards are singles and `Prize Pack`
 * never counts as a pack.
 */
const SEALED_RULES: ReadonlyArray<readonly [PokemonSealedCategory, RegExp]> = [
  ['case', /(?<!pencil )\bcases?\b/i],
  ['elite_trainer_box', /\belite trainer box(?:es)?\b|\betbs?\b/i],
  ['booster_bundle', /\bbundles?\b/i],
  ['booster_box', /\bbooster (?:box(?:es)?|display)\b|\bbooster\b.*\bdisplay\b/i],
  ['blister', /\bblisters?\b/i],
  ['tin', /\btins?\b/i],
  ['build_and_battle', /\bbuild (?:&|and) battle\b/i],
  ['prerelease_kit', /\bpre-?release\b/i],
  ['deck', /\bdecks?\b|\bstart(?:er)? set\b|\btrainer kit\b|\btoolkit\b|\blaunch kit\b/i],
  ['collection', /\bcollections?\b|\bchest\b|\bbox(?:es)?\b|\bbinder\b/i],
  ['booster_pack', /\bbooster\b|(?<!prize )\bpacks?\b/i],
  [
    'other',
    /\bset of \d+\b|\b(?:card|special|gift|card file|commemoration) set\b|\bset$|battle academy|\bkit\b|calendar|my first battle|v-union|pencil case|prize pack series (?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
  ],
];

/** Digital code cards (`Code Card - Scarlet & Violet Booster Pack`), redeemed online. */
const CODE_CARD = /^code card\b/i;

/**
 * Classify a product from its (cleaned) name and whether it has a collector
 * number. A numbered product is always a card.
 */
export function classifyProduct(name: string, rawNumber: string | null | undefined): ProductClass {
  if (rawNumber?.trim()) {
    return { kind: 'card' };
  }
  if (CODE_CARD.test(name)) {
    return { kind: 'skip' };
  }
  for (const [category, pattern] of SEALED_RULES) {
    if (pattern.test(name)) {
      return { kind: 'sealed', category };
    }
  }
  return { kind: 'card' };
}

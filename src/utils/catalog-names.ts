import { normalizeCardName } from './validation.js';

/**
 * Helpers that turn TCGCSV's product and group fields into the names and
 * numbers the catalog stores. They are pure, and pinned by tests against real
 * product names, because TCGCSV's text is untidy in ways that matter to a
 * member typing a card.
 */

/** Longest card name a listing may hold (`validateCardName`). */
export const CATALOG_NAME_MAX = 100;
/** The edit modal's set field holds at most this many characters. */
export const SET_CODE_MAX = 10;

/** `024` and `24` are the same number. */
function sameNumber(a: string, b: string): boolean {
  const strip = (value: string) =>
    value
      .trim()
      .toUpperCase()
      .replace(/^0+(?=.)/, '');
  return strip(a) === strip(b);
}

/**
 * The collector number's numerator as printed: `125/197` → `125`, `H25/H32` →
 * `H25`, `TG01/TG30` → `TG01`. The denominator (the set's size, or a promo
 * marker such as `SV-P`) is dropped. Null for no number, which is how sealed
 * product is told from a card.
 */
export function collectorNumberOf(rawNumber: string | null | undefined): string | null {
  const numerator = rawNumber?.split('/')[0]?.trim();
  return numerator ? numerator : null;
}

/**
 * A product's display name. TCGCSV writes the number into many names
 * (`Blastoise ex - 202/165`, `Piloswine (24)`), but the number has its own
 * column, so exactly that is taken out: a ` - <number>` suffix that is this
 * product's own number, and a trailing parenthetical that only repeats it. Qualifiers that say
 * which printing it is (`(Poke Ball Pattern)`, `(Cosmos Holo)`) stay, because
 * they are what tells two cards of one number apart, and so does any other
 * ` - ` suffix (a World Championship deck card, `… - 2010 (Player Name)`).
 */
export function cleanProductName(name: string, rawNumber: string | null | undefined): string {
  let cleaned = name.trim();
  const number = rawNumber?.trim();
  const numerator = collectorNumberOf(number);
  if (number) {
    cleaned = cleaned.replace(` - ${number}`, '');
  }
  if (numerator) {
    // The name often spells the number with leading zeros the Number field
    // lacks (`Corphish - 062/110` against `62/110`), so compare numerators.
    cleaned = cleaned.replace(/ - ([^\s/]+)(?:\/\S+)?/, (match, written: string) =>
      sameNumber(written, numerator) ? '' : match,
    );
  }
  const trailing = /^(.*) \(([^()]+)\)$/.exec(cleaned);
  if (trailing && numerator && sameNumber(trailing[2] ?? '', numerator)) {
    cleaned = trailing[1] ?? cleaned;
  }
  return cleaned.trim().slice(0, CATALOG_NAME_MAX);
}

/** A name without its trailing printing qualifier: `Charizard ex (Full Art)` → `Charizard ex`. */
export function baseProductName(name: string): string {
  return name.replace(/ \([^()]*\)$/, '').trim();
}

/**
 * The key a listing is searched by: the base name, normalized. Searching
 * `charizard ex` therefore finds every printing of it, not just the one whose
 * name has no qualifier.
 */
export function searchKeyFor(name: string): string {
  return normalizeCardName(baseProductName(name));
}

/**
 * A group's name for display. TCGCSV prefixes it with the set's code
 * (`SV03: Obsidian Flames`); only a single short token before the first colon
 * is taken for a code, so `XY Trainer Kit: Pikachu Libre & Suicune` keeps its
 * words.
 */
export function cleanGroupName(name: string): string {
  const trimmed = name.trim();
  const prefixed = /^[A-Za-z0-9+.-]{1,8}: (.+)$/.exec(trimmed);
  return prefixed?.[1]?.trim() || trimmed;
}

/**
 * A set's release date (`2023-08-11`) from TCGCSV's `publishedOn`, or null when
 * it isn't one. A real date is written at midnight (`2023-08-11T00:00:00`);
 * for groups TCGplayer has no date for, `publishedOn` is the moment the build
 * ran (`2026-10-23T20:00:07.1827719Z`, with fractional seconds and a `Z`), which
 * would put an old promo series ahead of the newest expansion if it were taken
 * for a release date.
 */
export function releaseDateOf(publishedOn: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T00:00:00$/.exec(publishedOn?.trim() ?? '');
  return match?.[1] ?? null;
}

/**
 * The set text a listing shows and `/edit` round-trips: the set's code in
 * upper case, or, for a set the source gave no code, its name cut to what the
 * edit modal's set field can hold.
 */
export function setLabelFor(code: string, name: string): string {
  const trimmedCode = code.trim();
  return (trimmedCode || name.trim()).slice(0, SET_CODE_MAX).toUpperCase();
}

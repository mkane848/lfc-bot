import {
  MAX_NOTES_LENGTH,
  MAX_PRICE_CENTS,
  MAX_QUANTITY,
  MIN_PRICE_CENTS,
  MIN_QUANTITY,
} from './constants.js';
import {
  ACCEPTS_VALUES,
  CARD_CONDITIONS,
  CARD_FINISHES,
  CARD_VARIANTS,
  DIGEST_MODES,
  GRADING_COMPANIES,
  LISTING_INTENTS,
  LISTING_KINDS,
  LISTING_LANGUAGES,
} from '../types/index.js';
import type { CardCondition, GradingCompany, ListingLanguage } from '../types/index.js';

const COLLECTOR_NUMBER_PATTERN = /^[A-Za-z0-9★-]+$/;
const MAX_COLLECTOR_NUMBER_LENGTH = 20;
// A grading company then a grade: 1 to 10, with half grades below 10 (BGS 9.5).
const GRADE_PATTERN = new RegExp(`^(${GRADING_COMPANIES.join('|')})\\s*(10|[1-9](?:\\.5)?)$`, 'i');

/** Thrown by every `validate*`/`parse*` helper here on user-facing invalid input. */
export class ValidationError extends Error {}

/** Type guard for a raw string against the `nm`/`lp`/`mp`/`hp`/`dmg` condition enum. */
export function isCardCondition(value: string): value is (typeof CARD_CONDITIONS)[number] {
  return (CARD_CONDITIONS as readonly string[]).includes(value);
}

/** Type guard for a raw string against the `have`/`want` intent enum. */
export function isListingIntent(value: string): value is (typeof LISTING_INTENTS)[number] {
  return (LISTING_INTENTS as readonly string[]).includes(value);
}

/** Type guard for a raw string against the `cash`/`trade`/`both` accepts enum. */
export function isAccepts(value: string): value is (typeof ACCEPTS_VALUES)[number] {
  return (ACCEPTS_VALUES as readonly string[]).includes(value);
}

/** Type guard for a raw string against the `nonfoil`/`foil`/`etched` finish enum. */
export function isCardFinish(value: string): value is (typeof CARD_FINISHES)[number] {
  return (CARD_FINISHES as readonly string[]).includes(value);
}

/** Type guard for a raw string against the printing-variant enum (extended/showcase/etc.). */
export function isCardVariant(value: string): value is (typeof CARD_VARIANTS)[number] {
  return (CARD_VARIANTS as readonly string[]).includes(value);
}

/** Type guard for a raw string against the supported listing languages (`en`, `ja`, …). */
export function isListingLanguage(value: string): value is ListingLanguage {
  return (LISTING_LANGUAGES as readonly string[]).includes(value);
}

/** Type guard for a raw string against the `disabled`/`channel`/`dm`/`both` digest mode enum. */
export function isDigestMode(value: string): value is (typeof DIGEST_MODES)[number] {
  return (DIGEST_MODES as readonly string[]).includes(value);
}

/** Type guard for a raw string against the `card`/`sealed` listing kind enum. */
export function isListingKind(value: string): value is (typeof LISTING_KINDS)[number] {
  return (LISTING_KINDS as readonly string[]).includes(value);
}

/**
 * Parse a dollar-amount string (e.g. "2.50") into whole cents, rounding to
 * avoid floating point drift. Throws `ValidationError` for a missing, non-numeric,
 * negative, or out-of-range ($0.00–$100,000.00) value.
 */
export function parsePriceToCents(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Price is required.');
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError('Price must be a positive number.');
  }
  // Round to whole cents to avoid floating point drift.
  const cents = Math.round(value * 100);
  if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) {
    throw new ValidationError('Price must be between $0.00 and $100,000.00.');
  }
  return cents;
}

/** Parse a whole-number quantity string, throwing `ValidationError` outside 1–99. */
export function parseQuantity(input: string): number {
  const value = Number(input);
  if (!Number.isInteger(value)) {
    throw new ValidationError('Quantity must be a whole number.');
  }
  if (value < MIN_QUANTITY || value > MAX_QUANTITY) {
    throw new ValidationError(`Quantity must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}.`);
  }
  return value;
}

/**
 * Trim and validate a notes field. Returns null for empty/missing input rather
 * than throwing, since notes are optional; throws `ValidationError` only when
 * present and over the length limit.
 */
export function validateNotes(input: string | undefined | null): string | null {
  if (input === undefined || input === null || input.trim().length === 0) {
    return null;
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new ValidationError(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Trim and validate a collector number (letters, digits, ★, or - only, max 20
 * characters). Unlike `validateNotes`, this field is required when called —
 * an empty string throws rather than returning null.
 */
export function validateCollectorNumber(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Collector number is required.');
  }
  if (trimmed.length > MAX_COLLECTOR_NUMBER_LENGTH || !COLLECTOR_NUMBER_PATTERN.test(trimmed)) {
    throw new ValidationError('Collector number must be letters, numbers, ★, or - only.');
  }
  return trimmed;
}

/** Trim and validate a card name (required, max 100 characters). */
export function validateCardName(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Card name is required.');
  }
  if (trimmed.length > 100) {
    throw new ValidationError('Card name is too long.');
  }
  return trimmed;
}

/**
 * Normalize a string into a stable search key: lowercase, trim whitespace, and
 * strip punctuation and diacritics.
 */
export function normalizeCardName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A graded slab's company and grade, split for storage. */
export interface ParsedGrade {
  gradingCompany: GradingCompany;
  /** The grade as written without the company: `10`, `9.5`. */
  grade: string;
}

const GRADE_EXAMPLES = 'PSA 10, BGS 9.5, or CGC 9';

/**
 * Parse a grade such as `PSA 10`, `psa10` or `BGS 9.5` into its company and
 * grade. Throws `ValidationError` for an unknown company or an out-of-range grade.
 */
export function parseGrade(input: string): ParsedGrade {
  const match = GRADE_PATTERN.exec(input.trim());
  if (!match) {
    throw new ValidationError(
      `Grade must be a grading company and a grade, such as ${GRADE_EXAMPLES}. ` +
        `Companies: ${GRADING_COMPANIES.join(', ')}.`,
    );
  }
  return {
    gradingCompany: (match[1] as string).toUpperCase() as GradingCompany,
    grade: match[2] as string,
  };
}

/** Render a stored company and grade the way members type it: `PSA 10`. */
export function formatGrade(
  gradingCompany: string | null | undefined,
  grade: string | null | undefined,
): string {
  return [gradingCompany, grade].filter(Boolean).join(' ');
}

/** What a free-text "condition or grade" field (a batch line, the `/edit` modal) holds. */
export interface ParsedConditionOrGrade {
  condition: CardCondition;
  gradingCompany: GradingCompany | null;
  grade: string | null;
}

/**
 * Parse a field that takes either a raw condition (`nm`, `lp`, …) or a grade
 * (`PSA 10`), the latter meaning a `graded` condition. A bare `graded` is
 * rejected: a graded card without its grade isn't a listing.
 */
export function parseConditionOrGrade(input: string): ParsedConditionOrGrade {
  const trimmed = input.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered === 'graded') {
    throw new ValidationError(`Say which grade, such as ${GRADE_EXAMPLES}.`);
  }
  if (isCardCondition(lowered)) {
    return { condition: lowered, gradingCompany: null, grade: null };
  }
  if (GRADE_PATTERN.test(trimmed)) {
    const { gradingCompany, grade } = parseGrade(trimmed);
    return { condition: 'graded', gradingCompany, grade };
  }
  throw new ValidationError(
    `Invalid condition "${trimmed}". Use nm, lp, mp, hp, dmg, or a grade such as ${GRADE_EXAMPLES}.`,
  );
}

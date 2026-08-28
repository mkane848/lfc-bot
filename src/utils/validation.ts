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
  LISTING_INTENTS,
} from '../types/index.js';

const COLLECTOR_NUMBER_PATTERN = /^[A-Za-z0-9★-]+$/;
const MAX_COLLECTOR_NUMBER_LENGTH = 20;

export class ValidationError extends Error {}

export function isCardCondition(value: string): value is (typeof CARD_CONDITIONS)[number] {
  return (CARD_CONDITIONS as readonly string[]).includes(value);
}

export function isListingIntent(value: string): value is (typeof LISTING_INTENTS)[number] {
  return (LISTING_INTENTS as readonly string[]).includes(value);
}

export function isAccepts(value: string): value is (typeof ACCEPTS_VALUES)[number] {
  return (ACCEPTS_VALUES as readonly string[]).includes(value);
}

export function isCardFinish(value: string): value is (typeof CARD_FINISHES)[number] {
  return (CARD_FINISHES as readonly string[]).includes(value);
}

export function isCardVariant(value: string): value is (typeof CARD_VARIANTS)[number] {
  return (CARD_VARIANTS as readonly string[]).includes(value);
}

export function isDigestMode(value: string): value is (typeof DIGEST_MODES)[number] {
  return (DIGEST_MODES as readonly string[]).includes(value);
}

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

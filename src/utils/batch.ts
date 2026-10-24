import type { Accepts, CardCondition, GradingCompany } from '../types/index.js';
import {
  isAccepts,
  parseConditionOrGrade,
  parsePriceToCents,
  parseQuantity,
  validateCardName,
  ValidationError,
} from './validation.js';
import type { ParsedConditionOrGrade } from './validation.js';

export interface ParsedHaveLine {
  cardName: string;
  condition: CardCondition;
  gradingCompany: GradingCompany | null;
  grade: string | null;
  priceCents: number | null;
  quantity: number;
}

export interface ParsedWantLine {
  cardName: string;
  condition: CardCondition | null;
  gradingCompany: GradingCompany | null;
  grade: string | null;
  maxPriceCents: number | null;
}

export interface ParsedHaveSealedLine {
  productName: string;
  priceCents: number | null;
  quantity: number;
}

export interface ParsedWantSealedLine {
  productName: string;
  maxPriceCents: number | null;
}

function splitLine(raw: string): string[] {
  return raw.split('|').map((part) => part.trim());
}

/** A condition column holds a raw condition (`nm`) or a grade (`PSA 10`); empty means none. */
function parseOptionalCondition(part: string | undefined): ParsedConditionOrGrade | null {
  if (!part || part.trim() === '') {
    return null;
  }
  return parseConditionOrGrade(part);
}

/**
 * Parse one `/have-multi` card line: `Card Name | condition | price | quantity`.
 * Condition is required (mirrors `/have`); price and quantity are optional, and
 * quantity defaults to 1 when omitted.
 */
export function parseHaveBatchLine(raw: string): ParsedHaveLine {
  const parts = splitLine(raw);
  if (parts.length < 2 || parts.length > 4) {
    throw new ValidationError(
      'Use the format: Card Name | condition | price | quantity (price and quantity are optional).',
    );
  }
  const [namePart, conditionPart, pricePart, quantityPart] = parts;
  const cardName = validateCardName(namePart ?? '');
  const parsedCondition = parseOptionalCondition(conditionPart);
  if (!parsedCondition) {
    throw new ValidationError(
      'Condition is required. Use nm, lp, mp, hp, dmg, or a grade such as PSA 10.',
    );
  }
  const priceCents = pricePart && pricePart !== '' ? parsePriceToCents(pricePart) : null;
  const quantity = quantityPart && quantityPart !== '' ? parseQuantity(quantityPart) : 1;
  return { cardName, ...parsedCondition, priceCents, quantity };
}

/**
 * Parse one `/want-multi` card line: `Card Name | condition | max_price`.
 * Condition and max price are both optional (mirrors `/want`).
 */
export function parseWantBatchLine(raw: string): ParsedWantLine {
  const parts = splitLine(raw);
  if (parts.length < 1 || parts.length > 3) {
    throw new ValidationError(
      'Use the format: Card Name | condition | max_price (condition and max_price are optional).',
    );
  }
  const [namePart, conditionPart, maxPricePart] = parts;
  const cardName = validateCardName(namePart ?? '');
  const parsedCondition = parseOptionalCondition(conditionPart);
  const maxPriceCents =
    maxPricePart && maxPricePart !== '' ? parsePriceToCents(maxPricePart) : null;
  return {
    cardName,
    condition: parsedCondition?.condition ?? null,
    gradingCompany: parsedCondition?.gradingCompany ?? null,
    grade: parsedCondition?.grade ?? null,
    maxPriceCents,
  };
}

/**
 * Parse one sealed `/have-multi` line: `Product Name | price | quantity`.
 * There is no condition field — sealed product is NM by definition — so this is
 * the card format minus that column. Price and quantity are optional, and
 * quantity defaults to 1 when omitted.
 */
export function parseHaveSealedBatchLine(raw: string): ParsedHaveSealedLine {
  const parts = splitLine(raw);
  if (parts.length < 1 || parts.length > 3) {
    throw new ValidationError(
      'Use the format: Product Name | price | quantity (price and quantity are optional).',
    );
  }
  const [namePart, pricePart, quantityPart] = parts;
  const productName = validateCardName(namePart ?? '');
  const priceCents = pricePart && pricePart !== '' ? parsePriceToCents(pricePart) : null;
  const quantity = quantityPart && quantityPart !== '' ? parseQuantity(quantityPart) : 1;
  return { productName, priceCents, quantity };
}

/**
 * Parse one sealed `/want-multi` line: `Product Name | max_price`.
 * Mirrors `parseWantBatchLine` minus the condition column.
 */
export function parseWantSealedBatchLine(raw: string): ParsedWantSealedLine {
  const parts = splitLine(raw);
  if (parts.length < 1 || parts.length > 2) {
    throw new ValidationError('Use the format: Product Name | max_price (max_price is optional).');
  }
  const [namePart, maxPricePart] = parts;
  const productName = validateCardName(namePart ?? '');
  const maxPriceCents =
    maxPricePart && maxPricePart !== '' ? parsePriceToCents(maxPricePart) : null;
  return { productName, maxPriceCents };
}

/** Parse the shared "accepts" field used by both batch-create modals. */
export function parseBatchAccepts(raw: string): Accepts {
  const normalized = raw.trim().toLowerCase();
  if (!isAccepts(normalized)) {
    throw new ValidationError('Invalid accepts value. Use cash, trade, or both.');
  }
  return normalized;
}

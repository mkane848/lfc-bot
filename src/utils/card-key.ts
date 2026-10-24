import { normalizeCardName } from './validation.js';

/**
 * Build the card-cache key from a card name plus its printing details.
 * `services/card-cache.ts`'s `buildCacheKey` is a thin wrapper around this. It lives
 * in its own module so the card cache doesn't depend on the embed code.
 */
export function cardKey(
  cardName: string,
  cardSet?: string | null,
  finish?: string | null,
  variant?: string | null,
  collectorNumber?: string | null,
): string {
  const base = normalizeCardName(cardName);
  const parts = [base];
  if (cardSet) parts.push(cardSet.toUpperCase());
  if (collectorNumber) parts.push(`CN${collectorNumber.toUpperCase()}`);
  if (finish) parts.push(finish);
  if (variant) parts.push(variant);
  return parts.join('::');
}

import { eq, lt } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cardCache } from '../db/schema.js';
import { cardKey } from '../utils/embeds.js';
import { CARD_CACHE_TTL_MS } from '../utils/constants.js';
import { normalizeCardName } from '../utils/validation.js';
import type { CardCacheRow, NewCardCacheRow } from '../db/schema.js';

const now = () => Date.now();

/**
 * Look up a cached card by name plus optional set. Expired rows are pruned and
 * returned as undefined so the caller can re-resolve.
 */
export function getCachedCard(cacheKey: string): CardCacheRow | undefined {
  const db = getDb();
  const row = db.select().from(cardCache).where(eq(cardCache.cacheKey, cacheKey)).get();
  if (!row) {
    return undefined;
  }
  if (row.expiresAt <= now()) {
    db.delete(cardCache).where(eq(cardCache.cacheKey, cacheKey)).run();
    return undefined;
  }
  return row;
}

/**
 * Insert or refresh a cache row. Passing `resolved: 0` stores a temporary
 * fallback entry that is pruned after the TTL so lookups can be retried.
 */
export function upsertCachedCard(input: {
  cacheKey: string;
  scryfallId?: string | null;
  cardName: string;
  cardNameNormalized: string;
  cardSet?: string | null;
  cardImageUrl?: string | null;
  collectorNumber?: string | null;
  manapoolUrl?: string | null;
  manapoolPriceCents?: number | null;
  resolved: boolean;
}): void {
  const db = getDb();
  const timestamp = now();
  const row: NewCardCacheRow = {
    cacheKey: input.cacheKey,
    scryfallId: input.scryfallId ?? null,
    cardName: input.cardName,
    cardNameNormalized: input.cardNameNormalized,
    cardSet: input.cardSet ?? null,
    cardImageUrl: input.cardImageUrl ?? null,
    collectorNumber: input.collectorNumber ?? null,
    manapoolUrl: input.manapoolUrl ?? null,
    manapoolPriceCents: input.manapoolPriceCents ?? null,
    resolved: input.resolved ? 1 : 0,
    resolvedAt: timestamp,
    expiresAt: timestamp + CARD_CACHE_TTL_MS,
  };
  db.insert(cardCache)
    .values(row)
    .onConflictDoUpdate({
      target: cardCache.cacheKey,
      set: {
        scryfallId: row.scryfallId,
        cardName: row.cardName,
        cardNameNormalized: row.cardNameNormalized,
        cardSet: row.cardSet,
        cardImageUrl: row.cardImageUrl,
        collectorNumber: row.collectorNumber,
        manapoolUrl: row.manapoolUrl,
        manapoolPriceCents: row.manapoolPriceCents,
        resolved: row.resolved,
        resolvedAt: row.resolvedAt,
        expiresAt: row.expiresAt,
      },
    })
    .run();
}

/** Build the canonical cache key for a card name + optional printing details. */
export function buildCacheKey(
  cardName: string,
  cardSet?: string | null,
  finish?: string | null,
  variant?: string | null,
  collectorNumber?: string | null,
): string {
  return cardKey(cardName, cardSet, finish, variant, collectorNumber);
}

/**
 * Opportunistically prune expired cache rows. Called periodically so the table
 * does not grow unbounded.
 */
export function pruneExpiredCardCache(): number {
  const db = getDb();
  return db.delete(cardCache).where(lt(cardCache.expiresAt, now())).run().changes;
}

/** Convenience for tests and cache lookups keyed by a raw name. */
export function normalizeForCache(cardName: string): string {
  return normalizeCardName(cardName);
}

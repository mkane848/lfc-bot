import { PROJECT_NAME, PROJECT_REPOSITORY } from '../utils/constants.js';
import type { ResolvedCard } from '../types/index.js';
import { normalizeCardName } from '../utils/validation.js';
import { buildCacheKey, getCachedCard, upsertCachedCard } from './card-cache.js';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const MIN_REQUEST_INTERVAL_MS = 100;

interface ScryfallCard {
  id?: string | null;
  name?: string | null;
  set?: string | null;
  image_uris?: { normal?: string | null; large?: string | null } | null;
  card_faces?: Array<{
    image_uris?: { normal?: string | null; large?: string | null } | null;
  }> | null;
}

interface AutocompleteResponse {
  data: string[];
}

/**
 * A tiny sequential queue that enforces Scryfall's minimum request interval.
 * Every outbound request is serialised so a burst of autocomplete calls cannot
 * trip the rate limiter.
 */
class RateLimiter {
  private lastRequestAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const wait = this.lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastRequestAt = Date.now();
      return task();
    });
    this.chain = result.catch(() => undefined);
    return result;
  }
}

const limiter = new RateLimiter();

async function scryfallFetch<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${SCRYFALL_BASE}${path}`, {
      headers: {
        'User-Agent': `${PROJECT_NAME}/${PROJECT_REPOSITORY}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Return autocomplete suggestions from Scryfall for a partial card name.
 * Limited to 25 choices to keep Discord embeds compact.
 */
export async function autocompleteCards(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const data = await limiter.run(() =>
    scryfallFetch<AutocompleteResponse>(
      `/cards/autocomplete?q=${encodeURIComponent(q)}&include_extras=true`,
    ),
  );
  return data?.data.slice(0, 25) ?? [];
}

function pickImageUrl(card: ScryfallCard): string | null {
  const faces = card.card_faces;
  if (faces && faces.length > 0) {
    const first = faces[0];
    if (first?.image_uris?.normal) {
      return first.image_uris.normal;
    }
  }
  if (card.image_uris?.normal) {
    return card.image_uris.normal;
  }
  if (card.image_uris?.large) {
    return card.image_uris.large;
  }
  return null;
}

/**
 * Resolve a full card name against Scryfall. Uses the database cache first,
 * then the fuzzy endpoint, and falls back to an unresolved raw-name entry when
 * Scryfall is unreachable.
 */
export async function resolveCard(input: string, cardSet?: string | null): Promise<ResolvedCard> {
  const normalizedInput = normalizeCardName(input);
  const cacheKey = buildCacheKey(input, cardSet);
  const cached = getCachedCard(cacheKey);
  if (cached) {
    return {
      scryfallId: cached.scryfallId,
      cardName: cached.cardName,
      cardNameNormalized: cached.cardNameNormalized,
      cardSet: cached.cardSet,
      cardImageUrl: cached.cardImageUrl,
      resolved: cached.resolved === 1,
    };
  }

  let card: ScryfallCard | null = null;
  if (cardSet) {
    const search = await limiter.run(() =>
      scryfallFetch<{ data: ScryfallCard[] }>(
        `/cards/search?q=${encodeURIComponent(
          `!"${input}" set:${cardSet.replace(/[^a-zA-Z0-9]/g, '')}`,
        )}`,
      ),
    );
    card = search?.data?.[0] ?? null;
    // Set-filtered search can be brittle; fall back to a plain fuzzy lookup.
    if (!card) {
      card = await fuzzyLookup(input);
    }
  } else {
    card = await fuzzyLookup(input);
  }

  if (card?.name) {
    const resolved: ResolvedCard = {
      scryfallId: card.id ?? null,
      cardName: card.name,
      cardNameNormalized: normalizeCardName(card.name),
      cardSet: card.set ?? null,
      cardImageUrl: pickImageUrl(card),
      resolved: true,
    };
    upsertCachedCard({
      cacheKey,
      scryfallId: resolved.scryfallId,
      cardName: resolved.cardName,
      cardNameNormalized: resolved.cardNameNormalized,
      cardSet: resolved.cardSet,
      cardImageUrl: resolved.cardImageUrl,
      resolved: true,
    });
    return resolved;
  }

  // Scryfall is unavailable or the card is unknown. Store an unresolved
  // fallback so retries are throttled, but still let the listing be created
  // with the raw name and no image per the spec.
  const fallback: ResolvedCard = {
    scryfallId: null,
    cardName: input,
    cardNameNormalized: normalizedInput,
    cardSet: cardSet ?? null,
    cardImageUrl: null,
    resolved: false,
  };
  upsertCachedCard({
    cacheKey,
    scryfallId: null,
    cardName: input,
    cardNameNormalized: normalizedInput,
    cardSet: cardSet ?? null,
    cardImageUrl: null,
    resolved: false,
  });
  return fallback;
}

function fuzzyLookup(input: string): Promise<ScryfallCard | null> {
  return limiter.run(() =>
    scryfallFetch<ScryfallCard>(`/cards/named?fuzzy=${encodeURIComponent(input)}`),
  );
}

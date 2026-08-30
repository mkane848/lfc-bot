import { PROJECT_NAME, PROJECT_REPOSITORY } from '../utils/constants.js';
import { buildManapoolUrl } from '../utils/manapool.js';
import type { CardFinish, CardVariant, ResolvedCard } from '../types/index.js';
import { normalizeCardName } from '../utils/validation.js';
import { retryWithBackoff } from '../utils/retry.js';
import { buildCacheKey, getCachedCard, upsertCachedCard } from './card-cache.js';
import { lookupManapoolPrinting } from './manapool.js';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const MIN_REQUEST_INTERVAL_MS = 100;
const SET_LIST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ATTEMPT_TIMEOUT_MS = 5000;

interface ScryfallCard {
  id?: string | null;
  name?: string | null;
  set?: string | null;
  collector_number?: string | null;
  games?: string[] | null;
  image_uris?: { normal?: string | null; large?: string | null } | null;
  card_faces?: Array<{
    image_uris?: { normal?: string | null; large?: string | null } | null;
  }> | null;
}

interface AutocompleteResponse {
  data: string[];
}

interface ScryfallSet {
  code?: string | null;
  name?: string | null;
}

interface SetListResponse {
  data: ScryfallSet[];
}

export interface ResolveCardOptions {
  cardSet?: string | null;
  finish?: CardFinish | null;
  variant?: CardVariant | null;
  collectorNumber?: string | null;
}

/**
 * A tiny sequential queue that enforces Scryfall's minimum request interval.
 * Every outbound request is serialized so a burst of autocomplete calls cannot
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

/**
 * One Scryfall request attempt. A 404 is a definitive "not found" and
 * resolves to `null` without retrying; any other non-2xx status or thrown
 * network/timeout error throws so the caller can retry it.
 */
async function scryfallFetchOnce<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(`${SCRYFALL_BASE}${path}`, {
      headers: {
        'User-Agent': `${PROJECT_NAME}/${PROJECT_REPOSITORY}`,
      },
      signal: controller.signal,
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Scryfall request failed with status ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch from Scryfall, retrying transient failures (timeouts, network errors,
 * non-404 error responses) once before giving up. The per-attempt timeout is
 * kept short (5s) because this also backs Discord autocomplete interactions,
 * which must respond within 3 seconds and can never be deferred.
 */
async function scryfallFetch<T>(path: string): Promise<T | null> {
  try {
    return await retryWithBackoff(() => scryfallFetchOnce<T>(path), {
      attempts: 2,
      baseDelayMs: 300,
      maxDelayMs: 1500,
    });
  } catch {
    return null;
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

const FINISH_PREDICATES: Record<CardFinish, string> = {
  nonfoil: '',
  foil: ' is:foil',
  etched: ' is:etched',
};

const VARIANT_PREDICATES: Record<CardVariant, string> = {
  extended: ' is:extended',
  showcase: ' is:showcase',
  borderless: ' is:borderless',
  retro: ' is:retro',
  full: ' is:full',
};

/**
 * Resolve a full card name against Scryfall. Uses the database cache first,
 * then a printing-filtered search (when any printing details are given) or
 * the fuzzy endpoint, and falls back to an unresolved raw-name entry when
 * Scryfall is unreachable. Also resolves the card's Manapool link, preferring
 * a live lookup and falling back to a locally-built URL.
 */
export async function resolveCard(
  input: string,
  options: ResolveCardOptions = {},
): Promise<ResolvedCard> {
  const { cardSet, finish, variant, collectorNumber } = options;
  const normalizedInput = normalizeCardName(input);
  const cacheKey = buildCacheKey(input, cardSet, finish, variant, collectorNumber);
  const cached = getCachedCard(cacheKey);
  if (cached) {
    return {
      scryfallId: cached.scryfallId,
      cardName: cached.cardName,
      cardNameNormalized: cached.cardNameNormalized,
      cardSet: cached.cardSet,
      cardImageUrl: cached.cardImageUrl,
      collectorNumber: cached.collectorNumber,
      manapoolUrl: cached.manapoolUrl,
      manapoolPriceCents: cached.manapoolPriceCents,
      resolved: cached.resolved === 1,
    };
  }

  const hasPrintingFilter = Boolean(cardSet || finish || variant || collectorNumber);
  let card: ScryfallCard | null;
  if (hasPrintingFilter) {
    let query = `!"${input}"`;
    if (cardSet) query += ` set:${cardSet.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (finish) query += FINISH_PREDICATES[finish];
    if (variant) query += VARIANT_PREDICATES[variant];
    if (collectorNumber) query += ` cn:${collectorNumber.replace(/[^A-Za-z0-9★-]/g, '')}`;
    const search = await limiter.run(() =>
      scryfallFetch<{ data: ScryfallCard[] }>(`/cards/search?q=${encodeURIComponent(query)}`),
    );
    card = search?.data?.[0] ?? null;
    // Printing-filtered search can be brittle; fall back to a plain fuzzy lookup.
    if (!card) {
      card = await fuzzyLookup(input);
    }
  } else {
    // With no printing filter, prefer a paper printing over Scryfall's fuzzy
    // default, which can land on a digital-only (MTGO/Arena) printing that
    // has no real-world market and therefore no Manapool listing.
    const paperSearch = await limiter.run(() =>
      scryfallFetch<{ data: ScryfallCard[] }>(
        `/cards/search?q=${encodeURIComponent(`!"${input}" game:paper`)}`,
      ),
    );
    card = paperSearch?.data?.[0] ?? (await fuzzyLookup(input));
  }

  if (card?.name) {
    const scryfallId = card.id ?? null;
    const cardSetCode = card.set ?? null;
    const cardCollectorNumber = card.collector_number ?? null;
    const isPaperCard = card.games?.includes('paper') ?? false;
    const manapool = isPaperCard && scryfallId ? await lookupManapoolPrinting(scryfallId) : null;
    const manapoolUrl = isPaperCard
      ? (manapool?.url ??
        buildManapoolUrl({
          cardName: card.name,
          cardSet: cardSetCode,
          collectorNumber: cardCollectorNumber,
        }))
      : null;
    const resolved: ResolvedCard = {
      scryfallId,
      cardName: card.name,
      cardNameNormalized: normalizeCardName(card.name),
      cardSet: cardSetCode,
      cardImageUrl: pickImageUrl(card),
      collectorNumber: cardCollectorNumber,
      manapoolUrl,
      manapoolPriceCents: manapool?.priceCents ?? null,
      resolved: true,
    };
    upsertCachedCard({
      cacheKey,
      scryfallId: resolved.scryfallId,
      cardName: resolved.cardName,
      cardNameNormalized: resolved.cardNameNormalized,
      cardSet: resolved.cardSet,
      cardImageUrl: resolved.cardImageUrl,
      collectorNumber: resolved.collectorNumber,
      manapoolUrl: resolved.manapoolUrl,
      manapoolPriceCents: resolved.manapoolPriceCents,
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
    collectorNumber: null,
    manapoolUrl: null,
    manapoolPriceCents: null,
    resolved: false,
  };
  upsertCachedCard({
    cacheKey,
    scryfallId: null,
    cardName: input,
    cardNameNormalized: normalizedInput,
    cardSet: cardSet ?? null,
    cardImageUrl: null,
    collectorNumber: null,
    manapoolUrl: null,
    manapoolPriceCents: null,
    resolved: false,
  });
  return fallback;
}

function fuzzyLookup(input: string): Promise<ScryfallCard | null> {
  return limiter.run(() =>
    scryfallFetch<ScryfallCard>(`/cards/named?fuzzy=${encodeURIComponent(input)}`),
  );
}

let setListCache: { sets: ScryfallSet[]; fetchedAt: number } | null = null;

async function loadSetList(): Promise<ScryfallSet[]> {
  if (setListCache && Date.now() - setListCache.fetchedAt < SET_LIST_TTL_MS) {
    return setListCache.sets;
  }
  const data = await limiter.run(() => scryfallFetch<SetListResponse>('/sets'));
  const sets = data?.data ?? [];
  if (sets.length > 0) {
    setListCache = { sets, fetchedAt: Date.now() };
  }
  return sets;
}

/**
 * Return set-code autocomplete choices for a partial set name or code.
 * Scryfall has no set-search endpoint, so the full set list is fetched once
 * and cached in memory, then filtered by prefix/substring match here.
 */
export async function autocompleteSets(
  query: string,
): Promise<Array<{ name: string; value: string }>> {
  const q = query.trim().toLowerCase();
  const sets = await loadSetList();
  const matches = sets.filter((set) => {
    const code = (set.code ?? '').toLowerCase();
    const name = (set.name ?? '').toLowerCase();
    return q.length === 0 || code.startsWith(q) || name.includes(q);
  });
  return matches.slice(0, 25).map((set) => ({
    name: `${set.name} (${(set.code ?? '').toUpperCase()})`.slice(0, 100),
    value: (set.code ?? '').toUpperCase(),
  }));
}

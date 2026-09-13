const MANAPOOL_BASE = 'https://manapool.com/api/v1';
const MIN_REQUEST_INTERVAL_MS = 100;

interface ManapoolSingle {
  url?: string | null;
  price_cents?: number | null;
}

interface ManapoolSinglesResponse {
  data?: ManapoolSingle[] | null;
}

/**
 * A tiny sequential queue that enforces a minimum interval between outbound
 * Manapool requests, mirroring the Scryfall client's rate limiter.
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

export interface ManapoolPrinting {
  url: string;
  priceCents: number | null;
}

/**
 * Look up the canonical Manapool listing for a specific Scryfall printing.
 * Returns null (with no network call) when MANAPOOL_API_KEY is not
 * configured, and null on any request failure or empty result so callers can
 * fall back to a locally-built link.
 */
export async function lookupManapoolPrinting(scryfallId: string): Promise<ManapoolPrinting | null> {
  const apiKey = process.env.MANAPOOL_API_KEY;
  if (!apiKey || !scryfallId) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await limiter.run(() =>
      fetch(`${MANAPOOL_BASE}/products/singles?scryfall_ids=${encodeURIComponent(scryfallId)}`, {
        headers: { 'X-ManaPool-Access-Token': apiKey },
        signal: controller.signal,
      }),
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as ManapoolSinglesResponse;
    const entry = body.data?.[0];
    if (!entry?.url) {
      return null;
    }
    return { url: entry.url, priceCents: entry.price_cents ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface ManapoolSealedProduct {
  url?: string | null;
}

interface ManapoolSealedResponse {
  data?: ManapoolSealedProduct[] | null;
}

/**
 * Look up the canonical Mana Pool page for an MTGJSON sealed-product uuid.
 *
 * Returns the URL string only, or null (with no network call) when
 * MANAPOOL_API_KEY is not configured or the uuid is empty, and null on any
 * request failure or empty result so callers can post the listing without a
 * link. An unknown-but-well-formed uuid answers `200` with `data: []` rather
 * than a 404, so the empty-data guard is the real "not found" path.
 *
 * Deliberately NOT retried: like `lookupManapoolPrinting`, the link is an
 * optional enrichment and null-on-failure is the correct behavior. A retry
 * here would sit in front of a user-facing command for no benefit.
 *
 * Two deliberate constraints a future reader should not "fix":
 *
 * 1. NO PRICE IS EVER READ. The sealed endpoint returns `low_price` and
 *    `price_market` (both integer cents) alongside the URL. We do not read
 *    them, do not return them, and `sealed_cache` has no price column. A
 *    listing lives for 30 days; a marketplace price snapshot taken at post
 *    time is wrong for most of that window, and we are not in the business of
 *    storing another marketplace's pricing data. `ManapoolSealedProduct`
 *    above declares `url` and nothing else on purpose — that type is the
 *    guard.
 * 2. THIS IS ONE CALL PER LISTING, USER-INITIATED, AND MUST STAY THAT WAY.
 *    Mana Pool's Terms of Use prohibit using automated means to "catalog,
 *    download or otherwise reproduce, store or distribute" their content. A
 *    single lookup made because a person just posted that exact product is
 *    the defensible pattern. Bulk-harvesting all 4,000+ sealed products on a
 *    nightly cron to pre-populate a local table is not, and must never be
 *    added — not as an optimization, not as a cache warm-up.
 */
export async function lookupManapoolSealedProduct(mtgjsonUuid: string): Promise<string | null> {
  const apiKey = process.env.MANAPOOL_API_KEY;
  if (!apiKey || !mtgjsonUuid) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await limiter.run(() =>
      fetch(`${MANAPOOL_BASE}/products/sealed?mtgjson_uuids=${encodeURIComponent(mtgjsonUuid)}`, {
        headers: { 'X-ManaPool-Access-Token': apiKey },
        signal: controller.signal,
      }),
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as ManapoolSealedResponse;
    return body.data?.[0]?.url ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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

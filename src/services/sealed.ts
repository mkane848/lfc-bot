import type { ResolvedSealedProduct } from '../types/index.js';

/**
 * Sealed-product catalog service.
 *
 * The catalog lives in the `sealed_cache` table (`src/db/schema.ts`), seeded from
 * MTGJSON's `SetList.json` (`SEALED_CATALOG_URL`) by a daily sync, with sync
 * bookkeeping in the single-row `sealed_catalog_meta` table.
 *
 * These are signature stubs: the contract other workstreams compile against.
 * The bodies land in the sealed-service workstream.
 */

/**
 * Refresh `sealed_cache` from MTGJSON.
 *
 * Fetches `SEALED_CATALOG_URL` wrapped in `retryWithBackoff` (`src/utils/retry.ts`),
 * flat-maps every set's `sealedProduct[]`, then upserts by `uuid` and deletes
 * uuids no longer present — all inside a single better-sqlite3 transaction.
 * `name` is truncated to `SEALED_PRODUCT_NAME_MAX` before storing and
 * `nameNormalized` is derived from the *truncated* name, so autocomplete values
 * and `resolveSealedProduct` lookups agree.
 *
 * Before downloading the multi-megabyte payload it compares MTGJSON's build version
 * (`SEALED_CATALOG_META_URL`) and the `SetList.json` ETag against
 * `sealed_catalog_meta` (row id 1) and skips the download when neither changed,
 * returning zero counts. On success it writes the new version/ETag/`syncedAt`
 * back to that row.
 *
 * Never throws: every failure is caught and logged, leaving the previous
 * catalog intact, so a bad sync can't crash boot or the cron.
 *
 * @returns counts of rows upserted (`imported`) and deleted (`removed`).
 */
// eslint-disable-next-line @typescript-eslint/require-await -- stub body; the real implementation awaits network and DB work.
export async function syncSealedCatalog(): Promise<{ imported: number; removed: number }> {
  throw new Error('not implemented');
}

/**
 * Discord autocomplete choices for a partial sealed product name.
 *
 * Normalizes `query` and substring-matches it against `name_normalized`,
 * optionally scoped to `setCode`, capped at 25 rows. Both `name` and `value`
 * are the stored (already <= 100 character) product name. An empty or
 * whitespace-only query returns an empty array, matching `autocompleteCards`.
 *
 * Synchronous: it is a local SQLite read, and autocomplete must answer within
 * Discord's 3-second deadline.
 */
export function autocompleteSealedProducts(
  query: string,
  setCode?: string | null,
): Array<{ name: string; value: string }> {
  void query;
  void setCode;
  throw new Error('not implemented');
}

/**
 * Discord autocomplete choices for a sealed set code.
 *
 * Distinct `set_code` values from `sealed_cache`, prefix-filtered by `query`
 * and capped at 25. Preferred over the Scryfall-backed set autocomplete, which
 * offers hundreds of sets that have no sealed product at all.
 */
export function autocompleteSealedSets(query: string): Array<{ name: string; value: string }> {
  void query;
  throw new Error('not implemented');
}

/**
 * Canonicalize a sealed product name against the catalog.
 *
 * Looks for an exact `name_normalized` match, scoped by `options.setCode` when
 * given. On a hit it enriches the result with the Mana Pool canonical URL for
 * the product's MTGJSON uuid (hence async) and returns `resolved: true`.
 *
 * On a miss it returns a free-text result — the raw name, its normalized form,
 * every other field null, `resolved: false` — and makes no Mana Pool call. The
 * sealed commands accept and post that, unlike the strict card path.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- stub body; the real implementation awaits network and DB work.
export async function resolveSealedProduct(
  name: string,
  options?: { setCode?: string | null },
): Promise<ResolvedSealedProduct> {
  void name;
  void options;
  throw new Error('not implemented');
}

/**
 * Whether the catalog needs a refresh: true when `sealed_catalog_meta` has no
 * row (never synced) or its `syncedAt` is older than `SEALED_CATALOG_STALE_MS`.
 * Used by the boot warm-up so a restart doesn't re-download an already-fresh
 * catalog.
 */
export function isSealedCatalogStale(): boolean {
  throw new Error('not implemented');
}

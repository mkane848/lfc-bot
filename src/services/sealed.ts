import { and, eq, inArray, like } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { sealedCache, sealedCatalogMeta } from '../db/schema.js';
import type { NewSealedCacheRow } from '../db/schema.js';
import {
  PROJECT_NAME,
  PROJECT_REPOSITORY,
  SEALED_CATALOG_META_URL,
  SEALED_CATALOG_STALE_MS,
  SEALED_CATALOG_URL,
  SEALED_PRODUCT_NAME_MAX,
} from '../utils/constants.js';
import { getLogger } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/retry.js';
import { normalizeCardName } from '../utils/validation.js';
import { lookupManapoolSealedProduct } from './manapool.js';
import type { ResolvedSealedProduct } from '../types/index.js';

/**
 * Sealed-product catalog service.
 *
 * The catalog lives in the `sealed_cache` table (`src/db/schema.ts`), seeded from
 * MTGJSON's `SetList.json` (`SEALED_CATALOG_URL`) by a daily sync, with sync
 * bookkeeping in the single-row `sealed_catalog_meta` table.
 */

/** Discord caps autocomplete responses at 25 choices. */
const AUTOCOMPLETE_LIMIT = 25;
/** SQLite's default bound-parameter ceiling is 999; stay well under it. */
const DELETE_CHUNK = 500;
/** The meta document is 113 bytes; the set list is ~11.6 MB. */
const META_TIMEOUT_MS = 10_000;
const CATALOG_TIMEOUT_MS = 120_000;

const USER_AGENT = `${PROJECT_NAME}/${PROJECT_REPOSITORY}`;

/**
 * MTGJSON's placeholder for a product whose `category` the payload omits.
 * `category` is NOT NULL in the schema and `formatSealedType` already renders
 * this value as an empty string, so defaulting to it keeps a single
 * schema-drifted product from aborting the whole import transaction.
 */
const UNKNOWN_CATEGORY = 'unknown';

interface MtgjsonMetaResponse {
  data?: { date?: string | null; version?: string | null } | null;
}

interface MtgjsonSealedProduct {
  uuid?: string | null;
  name?: string | null;
  setCode?: string | null;
  category?: string | null;
  subtype?: string | null;
  releaseDate?: string | null;
}

interface MtgjsonSetListEntry {
  sealedProduct?: MtgjsonSealedProduct[] | null;
}

interface MtgjsonSetListResponse {
  data?: MtgjsonSetListEntry[] | null;
}

/** One fetch attempt with a timeout; non-2xx throws so `retryWithBackoff` retries it. */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>,
  allowNotModified = false,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: controller.signal,
    });
    if (allowNotModified && response.status === 304) {
      return response;
    }
    if (!response.ok) {
      throw new Error(`MTGJSON request for ${url} failed with status ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Stamp `sealed_catalog_meta` row 1 with the build version and ETag this run
 * confirmed, plus the current time. Called from all three outcomes that prove
 * the catalog is current — a completed import, a matching build version, and a
 * `304` — and from none of the failure paths.
 */
function recordSyncMeta(
  db: ReturnType<typeof getDb>,
  buildVersion: string | null,
  setListEtag: string | null,
): void {
  const syncedAt = Date.now();
  db.insert(sealedCatalogMeta)
    .values({ id: 1, buildVersion, setListEtag, syncedAt })
    .onConflictDoUpdate({
      target: sealedCatalogMeta.id,
      set: { buildVersion, setListEtag, syncedAt },
    })
    .run();
}

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
 * returning zero counts.
 *
 * Row 1 is rewritten on every run that reaches a definite answer — a completed
 * import, a matching build version, or a `304` — so `syncedAt` means "we last
 * confirmed the catalog current", not "we last imported". That is what keeps
 * `isSealedCatalogStale` from re-checking on every restart while MTGJSON is
 * quiet, which matters because MTGJSON is free, unmetered and publishes no rate
 * limit. Only a *failed* run leaves the row alone, so a failure can never
 * convince the next run that it is up to date.
 *
 * Never throws: every failure is caught and logged, leaving the previous
 * catalog intact, so a bad sync can't crash boot or the cron.
 *
 * @returns counts of rows upserted (`imported`) and deleted (`removed`).
 */
export async function syncSealedCatalog(): Promise<{ imported: number; removed: number }> {
  const logger = getLogger();
  const unchanged = { imported: 0, removed: 0 };

  try {
    const db = getDb();
    const meta = db.select().from(sealedCatalogMeta).where(eq(sealedCatalogMeta.id, 1)).get();

    // 1. The build-metadata document is 113 bytes. If MTGJSON's version matches
    //    what we last imported, the 11.6 MB set list cannot have changed.
    const metaResponse = await retryWithBackoff(() =>
      fetchWithTimeout(SEALED_CATALOG_META_URL, META_TIMEOUT_MS, {}),
    );
    const metaBody = (await metaResponse.json()) as MtgjsonMetaResponse;
    const version = metaBody.data?.version ?? null;
    if (version !== null && meta?.buildVersion === version) {
      logger.debug({ version }, 'Sealed catalog already at the current MTGJSON build');
      // The ETag is carried forward untouched: this run never asked for
      // SetList.json, so it learned nothing new about it.
      recordSyncMeta(db, version, meta.setListEtag);
      return unchanged;
    }

    // 2. Conditional download. A 304 means the set list is byte-identical to the
    //    one behind our stored ETag even though the build version moved.
    const storedEtag = meta?.setListEtag ?? null;
    const catalogResponse = await retryWithBackoff(() =>
      fetchWithTimeout(
        SEALED_CATALOG_URL,
        CATALOG_TIMEOUT_MS,
        storedEtag ? { 'If-None-Match': storedEtag } : {},
        true,
      ),
    );
    const etag = catalogResponse.headers.get('etag') ?? storedEtag;
    if (catalogResponse.status === 304) {
      logger.debug({ version }, 'Sealed catalog unchanged (304 Not Modified)');
      // MTGJSON just confirmed our rows are current *for this build version*, so
      // record it and the next run short-circuits at the 113-byte meta check.
      recordSyncMeta(db, version, etag);
      return unchanged;
    }

    // 3. Flat-map every set's sealed products, truncating the name *before*
    //    normalizing it so autocomplete values and lookups agree.
    const body = (await catalogResponse.json()) as MtgjsonSetListResponse;
    const updatedAt = Date.now();
    const rows: NewSealedCacheRow[] = [];
    const seen = new Set<string>();
    for (const set of body.data ?? []) {
      for (const product of set.sealedProduct ?? []) {
        const uuid = product.uuid?.trim();
        const rawName = product.name?.trim();
        const setCode = product.setCode?.trim();
        if (!uuid || !rawName || !setCode || seen.has(uuid)) {
          continue;
        }
        seen.add(uuid);
        const name = rawName.slice(0, SEALED_PRODUCT_NAME_MAX);
        const category = product.category?.trim();
        const subtype = product.subtype?.trim();
        rows.push({
          uuid,
          name,
          nameNormalized: normalizeCardName(name),
          setCode: setCode.toUpperCase(),
          category: category && category.length > 0 ? category : UNKNOWN_CATEGORY,
          subtype: subtype && subtype.length > 0 ? subtype : null,
          releaseDate: product.releaseDate ?? null,
          updatedAt,
        });
      }
    }

    // A well-formed response that yields no products means MTGJSON changed its
    // schema, not that every sealed product was discontinued. Importing it would
    // delete the entire catalog, so treat it as a failed sync instead.
    if (rows.length === 0) {
      logger.error('Sealed catalog sync aborted: MTGJSON returned no sealed products');
      return unchanged;
    }

    // 4. Upsert every product and drop vanished uuids in one transaction, so a
    //    mid-import failure can never leave a half-written catalog.
    let removed = 0;
    db.transaction((tx) => {
      for (const row of rows) {
        tx.insert(sealedCache)
          .values(row)
          .onConflictDoUpdate({
            target: sealedCache.uuid,
            set: {
              name: row.name,
              nameNormalized: row.nameNormalized,
              setCode: row.setCode,
              category: row.category,
              subtype: row.subtype,
              releaseDate: row.releaseDate,
              updatedAt: row.updatedAt,
            },
          })
          .run();
      }

      const stale = tx
        .select({ uuid: sealedCache.uuid })
        .from(sealedCache)
        .all()
        .map((row) => row.uuid)
        .filter((uuid) => !seen.has(uuid));
      for (let i = 0; i < stale.length; i += DELETE_CHUNK) {
        const chunk = stale.slice(i, i + DELETE_CHUNK);
        removed += tx.delete(sealedCache).where(inArray(sealedCache.uuid, chunk)).run().changes;
      }
    });

    // 5. Bookkeeping is written only once the import has committed, so a failed
    //    sync never convinces the next run that it is up to date.
    recordSyncMeta(db, version, etag);

    logger.info({ imported: rows.length, removed, version }, 'Sealed catalog sync complete');
    return { imported: rows.length, removed };
  } catch (err) {
    // Never throws: the previous catalog keeps serving and neither boot nor the
    // cron can be brought down by a bad sync.
    logger.error({ err }, 'Sealed catalog sync failed');
    return unchanged;
  }
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
  // `normalizeCardName` reduces the query to [a-z0-9 ], so no LIKE wildcard can
  // survive it and the pattern below is safe to bind as a parameter.
  const normalized = normalizeCardName(query);
  if (normalized.length === 0) {
    return [];
  }

  const code = setCode?.trim().toUpperCase();
  const nameMatch = like(sealedCache.nameNormalized, `%${normalized}%`);
  const rows = getDb()
    .select({ name: sealedCache.name })
    .from(sealedCache)
    .where(code ? and(nameMatch, eq(sealedCache.setCode, code)) : nameMatch)
    .orderBy(sealedCache.name, sealedCache.uuid)
    .limit(AUTOCOMPLETE_LIMIT)
    .all();

  return rows.map((row) => ({ name: row.name, value: row.name }));
}

/**
 * Discord autocomplete choices for a sealed set code.
 *
 * Distinct `set_code` values from `sealed_cache`, prefix-filtered by `query`
 * and capped at 25. Preferred over the Scryfall-backed set autocomplete, which
 * offers hundreds of sets that have no sealed product at all.
 */
export function autocompleteSealedSets(query: string): Array<{ name: string; value: string }> {
  // Set codes are alphanumeric, so stripping everything else both normalizes the
  // query and removes any LIKE wildcard before it reaches the pattern.
  const prefix = query
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const rows = getDb()
    .selectDistinct({ setCode: sealedCache.setCode })
    .from(sealedCache)
    .where(prefix.length > 0 ? like(sealedCache.setCode, `${prefix}%`) : undefined)
    .orderBy(sealedCache.setCode)
    .limit(AUTOCOMPLETE_LIMIT)
    .all();

  return rows.map((row) => ({ name: row.setCode, value: row.setCode }));
}

/**
 * Canonicalize a sealed product name against the catalog.
 *
 * Looks for an exact `name_normalized` match, scoped by `options.setCode` when
 * given. On a hit it enriches the result with the Mana Pool canonical URL for
 * the product's MTGJSON uuid (hence async) and returns `resolved: true`.
 *
 * On a miss it returns a free-text result — the raw name, its normalized form,
 * the caller's `setCode` upper-cased (or null when none was given), every
 * catalog-derived field null, `resolved: false` — and makes no Mana Pool call.
 * The sealed commands accept and post that, unlike the strict card path.
 *
 * Preserving `setCode` through a miss matches `resolveCard`'s unresolved
 * fallback (`cardSet: cardSet ?? null`, `src/services/scryfall.ts`) and is what
 * the free-text path exists for: a brand-new or Store-Only product the catalog
 * has never seen still carries the set the user typed onto the embed, into
 * `/search` and into the digest.
 */
export async function resolveSealedProduct(
  name: string,
  options?: { setCode?: string | null },
): Promise<ResolvedSealedProduct> {
  const productName = name.trim();
  const productNameNormalized = normalizeCardName(productName);
  const trimmedCode = options?.setCode?.trim().toUpperCase();
  const code = trimmedCode && trimmedCode.length > 0 ? trimmedCode : null;

  const nameMatch = eq(sealedCache.nameNormalized, productNameNormalized);
  const row =
    productNameNormalized.length === 0
      ? undefined
      : getDb()
          .select()
          .from(sealedCache)
          .where(code ? and(nameMatch, eq(sealedCache.setCode, code)) : nameMatch)
          // Product names are unique in today's catalog, but that is not an
          // invariant MTGJSON guarantees, so tie-break deterministically.
          .orderBy(sealedCache.uuid)
          .limit(1)
          .get();

  if (!row) {
    return {
      productName,
      productNameNormalized,
      setCode: code,
      uuid: null,
      category: null,
      subtype: null,
      manapoolUrl: null,
      resolved: false,
    };
  }

  return {
    productName: row.name,
    productNameNormalized: row.nameNormalized,
    setCode: row.setCode,
    uuid: row.uuid,
    category: row.category,
    subtype: row.subtype,
    manapoolUrl: await lookupManapoolSealedProduct(row.uuid),
    resolved: true,
  };
}

/**
 * Whether the catalog needs a refresh: true when `sealed_catalog_meta` has no
 * row (never synced) or its `syncedAt` is older than `SEALED_CATALOG_STALE_MS`.
 * Used by the boot warm-up so a restart doesn't re-download an already-fresh
 * catalog.
 */
export function isSealedCatalogStale(): boolean {
  const row = getDb()
    .select({ syncedAt: sealedCatalogMeta.syncedAt })
    .from(sealedCatalogMeta)
    .where(eq(sealedCatalogMeta.id, 1))
    .get();
  if (!row) {
    return true;
  }
  return Date.now() - row.syncedAt > SEALED_CATALOG_STALE_MS;
}

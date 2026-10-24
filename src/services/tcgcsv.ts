import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { catalogItems, catalogSets, catalogSyncMeta } from '../db/schema.js';
import type { NewCatalogItemRow } from '../db/schema.js';
import { PROJECT_NAME, PROJECT_REPOSITORY } from '../utils/constants.js';
import { classifyProduct } from '../utils/catalog-products.js';
import {
  baseProductName,
  cleanGroupName,
  cleanProductName,
  collectorNumberOf,
  releaseDateOf,
  setLabelFor,
} from '../utils/catalog-names.js';
import { getLogger } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/retry.js';
import { normalizeCardName } from '../utils/validation.js';
import { PROJECT_VERSION } from '../utils/version.js';

/**
 * Pokémon catalog sync from TCGCSV (tcgcsv.com), a daily mirror of TCGplayer's
 * catalog: categories → groups (sets) → products (cards and sealed product).
 *
 * TCGCSV publishes usage guidelines, and this follows them: one sync a day,
 * `last-updated.txt` checked first so an unchanged day costs one request, a
 * `User-Agent` naming the app and version, at least 100 ms between requests,
 * conditional requests so an unchanged set costs a `304`, and no request from
 * a user-facing path (commands read the local catalog this fills). Only
 * identity is kept (names, sets, numbers); prices are never requested.
 */

const TCGCSV_BASE = 'https://tcgcsv.com';
const REQUEST_TIMEOUT_MS = 60_000;
/** TCGCSV asks for at least 100 ms between requests, and throttles above its rate. */
const DEFAULT_REQUEST_INTERVAL_MS = 150;
/** Give up on the whole run after this many groups in a row fail, instead of hammering a dead host. */
const MAX_CONSECUTIVE_GROUP_FAILURES = 5;
/** SQLite's bound-parameter ceiling can be as low as 999; 11 columns per row. */
const INSERT_CHUNK = 80;
const DELETE_CHUNK = 500;

export const POKEMON_GAME_ID = 'pokemon';
/** The `catalog_sync_meta` row for this sync. */
export const POKEMON_SYNC_SOURCE = 'tcgcsv:pokemon';
/** How long before a boot-time check asks for another sync. TCGCSV rebuilds once a day. */
export const CATALOG_STALE_MS = 24 * 60 * 60 * 1000;
/**
 * Bump this when the way a product becomes a row changes (which kind it is,
 * its name, its category). Each set records the version that imported it, and a
 * set imported by an older one is fetched again without `If-None-Match`: its
 * stored ETag and the "nothing new today" check would otherwise leave it as the
 * old code made it for as long as TCGCSV doesn't touch it.
 * 0: before sets recorded a version (kind from the presence of a number).
 * 1: kind and category from the name (`classifyProduct`).
 */
export const IMPORT_VERSION = 1;

/** TCGCSV's two Pokémon categories: English, and Japan, whose products also have English names. */
const POKEMON_CATEGORIES = [
  { categoryId: 3, language: 'en' },
  { categoryId: 85, language: 'ja' },
] as const;

const USER_AGENT = `${PROJECT_NAME}/${PROJECT_VERSION} (+${PROJECT_REPOSITORY})`;

interface TcgcsvGroup {
  groupId?: number | null;
  name?: string | null;
  abbreviation?: string | null;
  isSupplemental?: boolean | null;
  publishedOn?: string | null;
}

interface TcgcsvProduct {
  productId?: number | null;
  name?: string | null;
  extendedData?: Array<{ name?: string | null; value?: string | null }> | null;
}

interface TcgcsvEnvelope<T> {
  results?: T[] | null;
}

export interface CatalogSyncResult {
  /** `skipped` when TCGCSV hadn't published anything new, `failed` when the run did not finish cleanly. */
  status: 'synced' | 'skipped' | 'failed';
  /** Sets whose product list was fetched and imported. */
  setsImported: number;
  /** Sets TCGCSV confirmed unchanged with a `304`. */
  setsUnchanged: number;
  /** Sets no longer published, removed along with their products. */
  setsRemoved: number;
  /** Products written. */
  items: number;
}

export interface CatalogSyncOptions {
  /** Pause between requests; tests pass 0. */
  requestIntervalMs?: number;
}

/** A column of the row an upsert tried to insert, for `ON CONFLICT DO UPDATE`. */
const excluded = (column: string) => sql.raw(`excluded.${column}`);

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** A request pacer: each `pace()` resolves once `intervalMs` has passed since the previous one. */
function createPacer(intervalMs: number): () => Promise<void> {
  let last = 0;
  return async () => {
    const remaining = last + intervalMs - Date.now();
    if (last !== 0 && remaining > 0) {
      await wait(remaining);
    }
    last = Date.now();
  };
}

/** One request. A non-2xx throws so `retryWithBackoff` retries it, except what `accept` lets through. */
async function request(
  path: string,
  headers: Record<string, string>,
  accept: readonly number[] = [],
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TCGCSV_BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!response.ok && !accept.includes(response.status)) {
      throw new Error(`TCGCSV request for ${path} failed with status ${response.status}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function withRetry<T>(run: () => Promise<T>): Promise<T> {
  return retryWithBackoff(run, { attempts: 2, baseDelayMs: 500, maxDelayMs: 2000 });
}

/** Whether some set was imported by an older version of the importer than this one. */
function hasOutdatedSets(): boolean {
  const row = getDb()
    .select({ id: catalogSets.id })
    .from(catalogSets)
    .where(
      and(eq(catalogSets.game, POKEMON_GAME_ID), lt(catalogSets.importVersion, IMPORT_VERSION)),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

/**
 * Whether the catalog sync is due: never run, not confirmed current for a day,
 * or holding sets an older version of the importer wrote.
 */
export function isCatalogSyncStale(source = POKEMON_SYNC_SOURCE): boolean {
  const row = getDb()
    .select({ syncedAt: catalogSyncMeta.syncedAt })
    .from(catalogSyncMeta)
    .where(eq(catalogSyncMeta.source, source))
    .get();
  return !row || Date.now() - row.syncedAt > CATALOG_STALE_MS || hasOutdatedSets();
}

function recordSyncMeta(source: string, fingerprint: string): void {
  const syncedAt = Date.now();
  getDb()
    .insert(catalogSyncMeta)
    .values({ source, fingerprint, syncedAt })
    .onConflictDoUpdate({ target: catalogSyncMeta.source, set: { fingerprint, syncedAt } })
    .run();
}

/** A product's `Number`, which singles have and sealed product does not. */
function productNumber(product: TcgcsvProduct): string | null {
  const entry = product.extendedData?.find((data) => data.name === 'Number');
  const value = entry?.value?.trim();
  return value ? value : null;
}

/** Turn one product into a catalog row, or null for a product too malformed to keep. */
function toItemRow(
  product: TcgcsvProduct,
  language: string,
  setId: string,
  updatedAt: number,
): NewCatalogItemRow | null {
  const productId = product.productId;
  const rawName = product.name?.trim();
  if (typeof productId !== 'number' || !Number.isFinite(productId) || !rawName) {
    return null;
  }
  const rawNumber = productNumber(product);
  const name = cleanProductName(rawName, rawNumber);
  if (!name) {
    return null;
  }
  const productClass = classifyProduct(name, rawNumber);
  if (productClass.kind === 'skip') {
    return null;
  }
  return {
    game: POKEMON_GAME_ID,
    kind: productClass.kind,
    language,
    id: String(productId),
    name,
    nameNormalized: normalizeCardName(name),
    baseNormalized: normalizeCardName(baseProductName(name)),
    setId,
    number: collectorNumberOf(rawNumber),
    category: productClass.kind === 'sealed' ? productClass.category : null,
    updatedAt,
  };
}

function parseEnvelope<T>(body: unknown, what: string): T[] {
  const results = (body as TcgcsvEnvelope<T> | null)?.results;
  if (!Array.isArray(results)) {
    throw new Error(`TCGCSV ${what} had no results list`);
  }
  return results;
}

/**
 * Replace one set's products with the ones just fetched, and record the set's
 * metadata and ETag, in one transaction so a failure can't leave half a set.
 */
function importSet(input: {
  language: string;
  setId: string;
  name: string;
  code: string;
  releaseDate: string | null;
  supplemental: boolean;
  etag: string | null;
  products: TcgcsvProduct[];
}): number {
  const db = getDb();
  const updatedAt = Date.now();
  const rows: NewCatalogItemRow[] = [];
  for (const product of input.products) {
    const row = toItemRow(product, input.language, input.setId, updatedAt);
    if (row) {
      rows.push(row);
    }
  }
  db.transaction((tx) => {
    tx.delete(catalogItems)
      .where(
        and(
          eq(catalogItems.game, POKEMON_GAME_ID),
          eq(catalogItems.language, input.language),
          eq(catalogItems.setId, input.setId),
        ),
      )
      .run();
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      tx.insert(catalogItems)
        .values(rows.slice(start, start + INSERT_CHUNK))
        // A product TCGCSV moved between groups is still one row, under its new set.
        .onConflictDoUpdate({
          target: [catalogItems.game, catalogItems.kind, catalogItems.language, catalogItems.id],
          set: {
            name: excluded('name'),
            nameNormalized: excluded('name_normalized'),
            baseNormalized: excluded('base_normalized'),
            setId: excluded('set_id'),
            number: excluded('number'),
            category: excluded('category'),
            updatedAt: excluded('updated_at'),
          },
        })
        .run();
    }
    upsertSet(tx, input, updatedAt);
  });
  return rows.length;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function upsertSet(
  db: Db | Tx,
  input: {
    language: string;
    setId: string;
    name: string;
    code: string;
    releaseDate: string | null;
    supplemental: boolean;
    etag: string | null;
  },
  updatedAt: number,
): void {
  const values = {
    game: POKEMON_GAME_ID,
    language: input.language,
    id: input.setId,
    name: input.name,
    code: input.code,
    releaseDate: input.releaseDate,
    supplemental: input.supplemental ? 1 : 0,
    etag: input.etag,
    importVersion: IMPORT_VERSION,
    updatedAt,
  };
  db.insert(catalogSets)
    .values(values)
    .onConflictDoUpdate({
      target: [catalogSets.game, catalogSets.language, catalogSets.id],
      set: {
        name: values.name,
        code: values.code,
        releaseDate: values.releaseDate,
        supplemental: values.supplemental,
        etag: values.etag,
        importVersion: values.importVersion,
        updatedAt,
      },
    })
    .run();
}

/**
 * Refresh the Pokémon catalog (`catalog_sets`, `catalog_items`) from TCGCSV.
 *
 * If `last-updated.txt` matches the stamp of the last good sync, nothing has
 * been published since and the run stops there. Otherwise it reads each
 * category's group list and then each group's products, sending the ETag stored
 * from last time so an unchanged group is a `304`. Each group is replaced in its
 * own transaction, so a failure part-way keeps everything already imported, and
 * groups TCGCSV no longer lists are removed.
 *
 * The sync stamp is written only when every group was handled. A group list
 * with no groups, or a response without a results list, is a failure rather
 * than an import (it would otherwise wipe the catalog if TCGCSV changed shape).
 * A `404` for a group's products is TCGCSV's way of saying it has none.
 *
 * Never throws: every failure is logged and the previous catalog stays, so a
 * bad run can't crash boot or the cron.
 */
export function syncPokemonCatalog(options: CatalogSyncOptions = {}): Promise<CatalogSyncResult> {
  // A boot warm-up and an admin enabling the game can ask at the same moment;
  // the second gets the first's run rather than starting another download.
  inFlight ??= runPokemonSync(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let inFlight: Promise<CatalogSyncResult> | null = null;

async function runPokemonSync(options: CatalogSyncOptions): Promise<CatalogSyncResult> {
  const logger = getLogger();
  const result: CatalogSyncResult = {
    status: 'failed',
    setsImported: 0,
    setsUnchanged: 0,
    setsRemoved: 0,
    items: 0,
  };
  const pace = createPacer(options.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS);

  try {
    const db = getDb();
    const meta = db
      .select()
      .from(catalogSyncMeta)
      .where(eq(catalogSyncMeta.source, POKEMON_SYNC_SOURCE))
      .get();

    // 1. One small file says whether TCGCSV published anything since last time.
    const stampResponse = await withRetry(() => request('/last-updated.txt', {}));
    const stamp = (await stampResponse.text()).trim();
    if (!stamp) {
      throw new Error('TCGCSV last-updated.txt was empty');
    }
    // Sets an older version of the importer wrote are fetched again below even
    // though TCGCSV hasn't changed them, so "nothing new" only counts without any.
    const outdated = hasOutdatedSets();
    if (!outdated && meta?.fingerprint === stamp) {
      logger.debug({ stamp }, 'Pokémon catalog already at the latest TCGCSV build');
      recordSyncMeta(POKEMON_SYNC_SOURCE, stamp);
      return { ...result, status: 'skipped' };
    }
    if (outdated) {
      logger.info(
        { importVersion: IMPORT_VERSION },
        'Pokémon catalog has sets from an older importer; importing them again',
      );
    }

    // 2. Every category's group list, before anything is changed, so an empty or
    //    malformed one aborts the run with the catalog untouched.
    const categories: Array<{ language: string; groups: TcgcsvGroup[] }> = [];
    for (const { categoryId, language } of POKEMON_CATEGORIES) {
      await pace();
      const response = await withRetry(() => request(`/tcgplayer/${categoryId}/groups`, {}));
      const groups = parseEnvelope<TcgcsvGroup>(await response.json(), `groups for ${categoryId}`);
      if (groups.length === 0) {
        throw new Error(`TCGCSV listed no groups for category ${categoryId}`);
      }
      categories.push({ language, groups });
    }

    // 3. Each group's products, one transaction per group.
    let failures = 0;
    let consecutiveFailures = 0;
    let notReached = 0;
    for (const { language, groups } of categories) {
      const listed = new Set<string>();
      for (const group of groups) {
        if (typeof group.groupId !== 'number' || !group.name?.trim()) {
          continue;
        }
        const setId = String(group.groupId);
        listed.add(setId);
        if (consecutiveFailures >= MAX_CONSECUTIVE_GROUP_FAILURES) {
          notReached += 1;
          continue;
        }
        const name = cleanGroupName(group.name);
        const code = setLabelFor(group.abbreviation ?? '', name);
        const setMeta = {
          language,
          setId,
          name,
          // The label, not the raw abbreviation, is what members type and see.
          code: group.abbreviation?.trim() ? code : '',
          releaseDate: releaseDateOf(group.publishedOn),
          supplemental: group.isSupplemental === true,
        };
        try {
          const stored = db
            .select({ etag: catalogSets.etag, importVersion: catalogSets.importVersion })
            .from(catalogSets)
            .where(
              and(
                eq(catalogSets.game, POKEMON_GAME_ID),
                eq(catalogSets.language, language),
                eq(catalogSets.id, setId),
              ),
            )
            .get();
          await pace();
          const response = await withRetry(() =>
            request(
              `/tcgplayer/${categoryIdFor(language)}/${setId}/products`,
              // An ETag only vouches for a set the current importer wrote.
              stored?.etag && stored.importVersion === IMPORT_VERSION
                ? { 'If-None-Match': stored.etag }
                : {},
              [304, 404],
            ),
          );
          if (response.status === 304 && stored) {
            // Nothing changed in the products; the set's own name or date might have.
            upsertSet(db, { ...setMeta, etag: stored.etag }, Date.now());
            result.setsUnchanged += 1;
          } else {
            const products =
              response.status === 404
                ? []
                : parseEnvelope<TcgcsvProduct>(await response.json(), `products for ${setId}`);
            result.items += importSet({
              ...setMeta,
              etag: response.headers.get('etag'),
              products,
            });
            result.setsImported += 1;
          }
          consecutiveFailures = 0;
        } catch (err) {
          failures += 1;
          consecutiveFailures += 1;
          logger.warn({ err, setId, language }, 'Pokémon catalog: a set failed to import');
        }
      }

      // 4. Sets TCGCSV no longer lists go, along with their products. The group
      //    list was read in full above, so this is safe even if some sets failed.
      result.setsRemoved += removeUnlistedSets(language, listed);
    }

    if (failures > 0 || notReached > 0) {
      logger.error(
        { failures, notReached, ...result },
        'Pokémon catalog sync finished with failures; the sync stamp is left alone so the next run retries',
      );
      return result;
    }

    recordSyncMeta(POKEMON_SYNC_SOURCE, stamp);
    const synced: CatalogSyncResult = { ...result, status: 'synced' };
    logger.info(synced, 'Pokémon catalog synced from TCGCSV');
    return synced;
  } catch (err) {
    logger.error({ err }, 'Pokémon catalog sync failed; keeping the previous catalog');
    return result;
  }
}

function categoryIdFor(language: string): number {
  const category = POKEMON_CATEGORIES.find((candidate) => candidate.language === language);
  if (!category) {
    throw new Error(`No TCGCSV category for language ${language}`);
  }
  return category.categoryId;
}

/** Remove sets (and their products) of one language that are not in `listed`. */
function removeUnlistedSets(language: string, listed: ReadonlySet<string>): number {
  const db = getDb();
  const present = db
    .select({ id: catalogSets.id })
    .from(catalogSets)
    .where(and(eq(catalogSets.game, POKEMON_GAME_ID), eq(catalogSets.language, language)))
    .all()
    .map((row) => row.id);
  const stale = present.filter((id) => !listed.has(id));
  let removed = 0;
  db.transaction((tx) => {
    for (let start = 0; start < stale.length; start += DELETE_CHUNK) {
      const chunk = stale.slice(start, start + DELETE_CHUNK);
      tx.delete(catalogItems)
        .where(
          and(
            eq(catalogItems.game, POKEMON_GAME_ID),
            eq(catalogItems.language, language),
            inArray(catalogItems.setId, chunk),
          ),
        )
        .run();
      removed += tx
        .delete(catalogSets)
        .where(
          and(
            eq(catalogSets.game, POKEMON_GAME_ID),
            eq(catalogSets.language, language),
            inArray(catalogSets.id, chunk),
          ),
        )
        .run().changes;
    }
  });
  return removed;
}

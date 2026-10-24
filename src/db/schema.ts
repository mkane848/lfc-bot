import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  adminChannelId: text('admin_channel_id'),
  digestDmUserId: text('digest_dm_user_id'),
  digestMode: text('digest_mode').notNull().default('disabled'),
  digestCron: text('digest_cron').notNull().default('0 9 * * *'),
  digestTimezone: text('digest_timezone').notNull().default('UTC'),
  lastDigestAt: integer('last_digest_at'),
  enabledGames: text('enabled_games')
    .notNull()
    .default(sql`'["mtg"]'`),
  removedAt: integer('removed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const listings = sqliteTable(
  'listings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    username: text('username').notNull(),
    intent: text('intent').notNull(),
    accepts: text('accepts').notNull(),
    game: text('game').notNull().default('mtg'),
    language: text('language').notNull().default('en'),
    cardName: text('card_name').notNull(),
    cardNameNormalized: text('card_name_normalized').notNull(),
    cardSet: text('card_set'),
    cardImageUrl: text('card_image_url'),
    finish: text('finish'),
    variant: text('variant'),
    collectorNumber: text('collector_number'),
    marketUrl: text('market_url'),
    condition: text('condition'),
    gradingCompany: text('grading_company'),
    grade: text('grade'),
    priceCents: integer('price_cents'),
    kind: text('kind').notNull().default('card'),
    catalogId: text('catalog_id'),
    sealedCategory: text('sealed_category'),
    sealedSubtype: text('sealed_subtype'),
    quantity: integer('quantity').notNull().default(1),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => {
    return {
      searchIdx: index('listings_search_idx').on(
        table.serverId,
        table.status,
        table.cardNameNormalized,
      ),
      digestIdx: index('listings_digest_idx').on(table.serverId, table.status, table.createdAt),
      myListingsIdx: index('listings_user_idx').on(table.serverId, table.userId, table.createdAt),
    };
  },
);

export const digestLog = sqliteTable('digest_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  sentAt: integer('sent_at').notNull(),
  trigger: text('trigger').notNull(),
  listingCount: integer('listing_count').notNull(),
  listingIdsIncluded: text('listing_ids_included').notNull(),
  deliveryResults: text('delivery_results').notNull(),
});

export const cardCache = sqliteTable(
  'card_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    scryfallId: text('scryfall_id'),
    cardName: text('card_name').notNull(),
    cardNameNormalized: text('card_name_normalized').notNull(),
    cardSet: text('card_set'),
    cardImageUrl: text('card_image_url'),
    collectorNumber: text('collector_number'),
    manapoolUrl: text('manapool_url'),
    manapoolPriceCents: integer('manapool_price_cents'),
    resolved: integer('resolved').notNull().default(0),
    resolvedAt: integer('resolved_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => {
    return {
      normalizedIdx: index('card_cache_normalized_idx').on(table.cardNameNormalized),
    };
  },
);

/**
 * The full MTGJSON sealed-product catalog, refreshed by the daily sync. Unlike
 * `card_cache` this is a complete index rather than a per-lookup TTL cache: it
 * backs sealed autocomplete and name canonicalization.
 */
export const sealedCache = sqliteTable(
  'sealed_cache',
  {
    uuid: text('uuid').primaryKey(),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    setCode: text('set_code').notNull(),
    category: text('category').notNull(),
    subtype: text('subtype'),
    releaseDate: text('release_date'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => {
    return {
      normalizedIdx: index('sealed_cache_normalized_idx').on(table.nameNormalized),
      setIdx: index('sealed_cache_set_idx').on(table.setCode),
    };
  },
);

/**
 * Single-row bookkeeping for the sealed catalog sync (always id 1). Storing the
 * last-seen MTGJSON build version and the `SetList.json` ETag lets the sync skip
 * re-downloading ~11.6 MB of JSON when the upstream catalog has not changed.
 */
export const sealedCatalogMeta = sqliteTable('sealed_catalog_meta', {
  id: integer('id').primaryKey(),
  buildVersion: text('build_version'),
  setListEtag: text('set_list_etag'),
  syncedAt: integer('synced_at').notNull(),
});

/**
 * One set of a non-Magic game's catalog, such as a TCGCSV "group". Magic keeps
 * its own tables (`card_cache`, `sealed_cache`); this and `catalog_items` hold
 * every other game. Identified by the source's own id, never by `code`: set
 * codes repeat, can be empty, and can contain spaces.
 */
export const catalogSets = sqliteTable(
  'catalog_sets',
  {
    game: text('game').notNull(),
    language: text('language').notNull(),
    /** The source's id for the set (a TCGCSV `groupId`), as text. */
    id: text('id').notNull(),
    name: text('name').notNull(),
    /** The abbreviation members type and see, e.g. `OBF`. Empty when the source has none. */
    code: text('code').notNull().default(''),
    releaseDate: text('release_date'),
    /** 1 for a supplemental set, which a typed set code prefers not to land on. */
    supplemental: integer('supplemental').notNull().default(0),
    /** The ETag of this set's product list at the last import, so the next sync can send `If-None-Match`. */
    etag: text('etag'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.game, table.language, table.id] }),
      codeIdx: index('catalog_sets_code_idx').on(table.game, table.code),
    };
  },
);

/**
 * One card or sealed product of a non-Magic game's catalog. Holds identity
 * only (name, set, number); never prices or stock. A product's image and
 * marketplace link are derived from `id`, so neither is stored.
 */
export const catalogItems = sqliteTable(
  'catalog_items',
  {
    game: text('game').notNull(),
    /** `card` or `sealed`. */
    kind: text('kind').notNull(),
    language: text('language').notNull(),
    /** The source's id for the product (a TCGCSV `productId`), as text. */
    id: text('id').notNull(),
    /** Display name, with any printing qualifier such as `(Poke Ball Pattern)` kept. */
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    /** `name` without its trailing parenthetical, normalized: the key a listing is searched by. */
    baseNormalized: text('base_normalized').notNull(),
    /** `catalog_sets.id` of the set this belongs to. */
    setId: text('set_id').notNull(),
    /** The collector number's numerator as printed (`125`, `H25`, `TG01`); null for sealed. */
    number: text('number'),
    /** The kind of sealed product (`booster_box`, …); null for a card. */
    category: text('category'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.game, table.kind, table.language, table.id] }),
      nameIdx: index('catalog_items_name_idx').on(table.game, table.kind, table.nameNormalized),
      baseIdx: index('catalog_items_base_idx').on(table.game, table.kind, table.baseNormalized),
      setIdx: index('catalog_items_set_idx').on(table.game, table.kind, table.setId),
    };
  },
);

/**
 * Bookkeeping for a catalog sync, one row per source. `fingerprint` is whatever
 * the source uses to say "nothing changed" (TCGCSV's `last-updated.txt`), and
 * `synced_at` is when a run last confirmed the catalog current. Generalizes
 * `sealed_catalog_meta`, which stays as it is for Magic.
 */
export const catalogSyncMeta = sqliteTable('catalog_sync_meta', {
  source: text('source').primaryKey(),
  fingerprint: text('fingerprint'),
  syncedAt: integer('synced_at').notNull(),
});

export type ServerRow = typeof servers.$inferSelect;
export type NewServerRow = typeof servers.$inferInsert;

export type ListingRow = typeof listings.$inferSelect;
export type NewListingRow = typeof listings.$inferInsert;

export type DigestLogRow = typeof digestLog.$inferSelect;
export type NewDigestLogRow = typeof digestLog.$inferInsert;

export type CardCacheRow = typeof cardCache.$inferSelect;
export type NewCardCacheRow = typeof cardCache.$inferInsert;

export type SealedCacheRow = typeof sealedCache.$inferSelect;
export type NewSealedCacheRow = typeof sealedCache.$inferInsert;

export type CatalogSetRow = typeof catalogSets.$inferSelect;
export type NewCatalogSetRow = typeof catalogSets.$inferInsert;

export type CatalogItemRow = typeof catalogItems.$inferSelect;
export type NewCatalogItemRow = typeof catalogItems.$inferInsert;

export type CatalogSyncMetaRow = typeof catalogSyncMeta.$inferSelect;

export type SealedCatalogMetaRow = typeof sealedCatalogMeta.$inferSelect;
export type NewSealedCatalogMetaRow = typeof sealedCatalogMeta.$inferInsert;

export const adminAuditLog = sqliteTable(
  'admin_audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    adminId: text('admin_id').notNull(),
    adminUsername: text('admin_username').notNull(),
    action: text('action').notNull(),
    details: text('details'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => {
    return {
      serverIdx: index('admin_audit_log_server_idx').on(table.serverId, table.createdAt),
    };
  },
);

export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLogRow = typeof adminAuditLog.$inferInsert;

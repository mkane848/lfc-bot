import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    cardName: text('card_name').notNull(),
    cardNameNormalized: text('card_name_normalized').notNull(),
    cardSet: text('card_set'),
    cardImageUrl: text('card_image_url'),
    finish: text('finish'),
    variant: text('variant'),
    collectorNumber: text('collector_number'),
    manapoolUrl: text('manapool_url'),
    condition: text('condition'),
    priceCents: integer('price_cents'),
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

export type ServerRow = typeof servers.$inferSelect;
export type NewServerRow = typeof servers.$inferInsert;

export type ListingRow = typeof listings.$inferSelect;
export type NewListingRow = typeof listings.$inferInsert;

export type DigestLogRow = typeof digestLog.$inferSelect;
export type NewDigestLogRow = typeof digestLog.$inferInsert;

export type CardCacheRow = typeof cardCache.$inferSelect;
export type NewCardCacheRow = typeof cardCache.$inferInsert;

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

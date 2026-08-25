import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { listings, servers, type ListingRow, type ServerRow } from '../db/schema.js';
import {
  DEFAULT_DIGEST_CRON,
  DEFAULT_DIGEST_MODE,
  DEFAULT_DIGEST_TIMEZONE,
} from '../utils/constants.js';

const now = () => Date.now();

/**
 * Fetch all servers that have an active digest delivery mode. Used at startup
 * to schedule cron jobs.
 */
export function listScheduledServers(): ServerRow[] {
  const db = getDb();
  return db.select().from(servers).where(ne(servers.digestMode, 'disabled')).all();
}

/**
 * Select the active listings that belong in a digest for this server using the
 * `last_digest_at` watermark. On the very first digest the watermark is the
 * value set when digest config completed, so only listings created afterward
 * are included.
 */
export function prepareDigestListings(server: ServerRow): ListingRow[] {
  const db = getDb();
  const from = server.lastDigestAt ?? 0;
  return db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.serverId, server.id),
        eq(listings.status, 'active'),
        gte(listings.createdAt, from),
        lte(listings.createdAt, now()),
      ),
    )
    .orderBy(asc(listings.createdAt))
    .all();
}

/** Advance the server's digest watermark after a successful delivery. */
export function setServerWatermark(serverId: string, timestamp: number): void {
  const db = getDb();
  db.update(servers)
    .set({ lastDigestAt: timestamp, updatedAt: now() })
    .where(eq(servers.id, serverId))
    .run();
}

/**
 * Initialise the watermark to the current time when digest mode moves from
 * disabled to an active mode, so a digest does not flood with old listings.
 */
export function initializeWatermarkIfNeeded(server: ServerRow): void {
  if (server.digestMode === 'disabled' || server.lastDigestAt !== null) {
    return;
  }
  setServerWatermark(server.id, now());
}

/** Persist or create the server configuration row. */
export function upsertServerConfig(partial: {
  serverId: string;
  digestMode?: string;
  digestCron?: string;
  digestTimezone?: string;
  adminChannelId?: string | null;
  digestDmUserId?: string | null;
  enabledGames?: string[];
}): ServerRow {
  const db = getDb();
  const timestamp = now();
  const existing = db.select().from(servers).where(eq(servers.id, partial.serverId)).get();
  if (!existing) {
    const row: ServerRow = {
      id: partial.serverId,
      adminChannelId: partial.adminChannelId ?? null,
      digestDmUserId: partial.digestDmUserId ?? null,
      digestMode: partial.digestMode ?? DEFAULT_DIGEST_MODE,
      digestCron: partial.digestCron ?? DEFAULT_DIGEST_CRON,
      digestTimezone: partial.digestTimezone ?? DEFAULT_DIGEST_TIMEZONE,
      lastDigestAt: null,
      enabledGames: JSON.stringify(partial.enabledGames ?? ['mtg']),
      removedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.insert(servers).values(row).run();
    return row;
  }
  const update: Partial<ServerRow> = { updatedAt: timestamp };
  if (partial.adminChannelId !== undefined) update.adminChannelId = partial.adminChannelId;
  if (partial.digestDmUserId !== undefined) update.digestDmUserId = partial.digestDmUserId;
  if (partial.digestMode !== undefined) update.digestMode = partial.digestMode;
  if (partial.digestCron !== undefined) update.digestCron = partial.digestCron;
  if (partial.digestTimezone !== undefined) update.digestTimezone = partial.digestTimezone;
  if (partial.enabledGames !== undefined)
    update.enabledGames = JSON.stringify(partial.enabledGames);
  db.update(servers).set(update).where(eq(servers.id, partial.serverId)).run();
  return db.select().from(servers).where(eq(servers.id, partial.serverId)).get() as ServerRow;
}

/** Return a single server config row or undefined. */
export function getServerConfig(serverId: string): ServerRow | undefined {
  const db = getDb();
  return db.select().from(servers).where(eq(servers.id, serverId)).get();
}

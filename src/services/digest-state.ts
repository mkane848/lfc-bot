import { and, asc, eq, gt, gte, inArray, lt, lte, ne, not, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { listings, servers, type ListingRow, type ServerRow } from '../db/schema.js';
import { enabledGameIdsFromConfig } from '../games/index.js';
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
 * are included. Listings of a game the server has since disabled are left out;
 * they are kept, and appear again if the game is re-enabled.
 */
export function prepareDigestListings(server: ServerRow, cutoff: number = now()): ListingRow[] {
  const db = getDb();
  const from = server.lastDigestAt ?? 0;
  return db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.serverId, server.id),
        eq(listings.status, 'active'),
        inArray(listings.game, enabledGameIdsFromConfig(server.enabledGames)),
        gte(listings.createdAt, from),
        lte(listings.createdAt, cutoff),
        // Posted while digests were paused. The bounds are exclusive: a listing
        // created in the very millisecond of a pause or resume is sent.
        server.digestPausedAt !== null && server.digestResumedAt !== null
          ? not(
              and(
                gt(listings.createdAt, server.digestPausedAt),
                lt(listings.createdAt, server.digestResumedAt),
              )!,
            )
          : undefined,
      ),
    )
    .orderBy(asc(listings.createdAt))
    .all();
}

/**
 * Move the server's digest watermark forward to `timestamp` after a successful
 * delivery, never back: when two runs overlap, the one that selected less must
 * not undo the other's progress.
 */
export function advanceServerWatermark(serverId: string, timestamp: number): void {
  const db = getDb();
  db.update(servers)
    .set({
      lastDigestAt: sql`max(coalesce(${servers.lastDigestAt}, 0), ${timestamp})`,
      updatedAt: now(),
    })
    .where(eq(servers.id, serverId))
    .run();
}

/** Set the server's digest watermark. */
export function setServerWatermark(serverId: string, timestamp: number): void {
  const db = getDb();
  db.update(servers)
    .set({ lastDigestAt: timestamp, updatedAt: now() })
    .where(eq(servers.id, serverId))
    .run();
}

/**
 * Initialize the watermark to the current time when digest mode moves from
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
      digestPausedAt: null,
      digestResumedAt: null,
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
  if (partial.digestMode !== undefined) {
    update.digestMode = partial.digestMode;
    Object.assign(update, pauseChange(existing, partial.digestMode, timestamp));
  }
  if (partial.digestCron !== undefined) update.digestCron = partial.digestCron;
  if (partial.digestTimezone !== undefined) update.digestTimezone = partial.digestTimezone;
  if (partial.enabledGames !== undefined)
    update.enabledGames = JSON.stringify(partial.enabledGames);
  db.update(servers).set(update).where(eq(servers.id, partial.serverId)).run();
  return db.select().from(servers).where(eq(servers.id, partial.serverId)).get() as ServerRow;
}

/**
 * What changing the digest mode does to the watermark. Pausing records when.
 * Resuming must not send what was posted while paused, but must still send
 * what was posted before the pause and never sent, so the pause is kept as a
 * window `prepareDigestListings` skips. A second pause before the next digest
 * replaces the window, so the first pause's listings are sent after all:
 * sending too much is preferred to dropping listings.
 */
function pauseChange(existing: ServerRow, mode: string, at: number): Partial<ServerRow> {
  const wasOn = existing.digestMode !== 'disabled';
  const turnsOn = mode !== 'disabled';
  if (wasOn && !turnsOn) {
    return { digestPausedAt: at, digestResumedAt: null };
  }
  if (wasOn || !turnsOn || existing.lastDigestAt === null) {
    // No change, or the first time on, which `initializeWatermarkIfNeeded` handles.
    return {};
  }
  // A pause from before pause times were recorded has no start, so there is no
  // telling what was posted before it: start from now.
  return existing.digestPausedAt !== null && existing.lastDigestAt <= existing.digestPausedAt
    ? { digestResumedAt: at }
    : { lastDigestAt: at, digestPausedAt: null, digestResumedAt: null };
}

/** Return a single server config row or undefined. */
export function getServerConfig(serverId: string): ServerRow | undefined {
  const db = getDb();
  return db.select().from(servers).where(eq(servers.id, serverId)).get();
}

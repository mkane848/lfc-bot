import { and, eq, isNotNull, isNull, lte, notInArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { listings, servers } from '../db/schema.js';

const now = () => Date.now();

/**
 * Mark any active listings past their expiry as expired. Called on a schedule
 * and opportunistically on startup. Expired listings remain in the database but
 * are excluded from search and digests by the `active` status filter.
 */
export function expireListings(serverId?: string): number {
  const db = getDb();
  const conditions = [eq(listings.status, 'active'), lte(listings.expiresAt, now())];
  if (serverId) {
    conditions.push(eq(listings.serverId, serverId));
  }
  return db
    .update(listings)
    .set({ status: 'expired', updatedAt: now() })
    .where(and(...conditions))
    .run().changes;
}

/**
 * When a guild removes the bot, mark its server row for removal. The row and
 * its cascade-deleted listings/digest logs are removed later by
 * `purgeMarkedServers` once the retention window elapses.
 */
export function markServerForRemoval(serverId: string): void {
  const db = getDb();
  db.update(servers)
    .set({ removedAt: now(), updatedAt: now() })
    .where(eq(servers.id, serverId))
    .run();
}

/**
 * Permanently delete server rows that were marked for removal more than
 * `retentionMs` ago. Listings and digest logs cascade via foreign keys.
 * Returns the number of servers removed.
 */
export function purgeMarkedServers(retentionMs: number): number {
  const db = getDb();
  const cutoff = now() - retentionMs;
  const marked = db
    .select({ id: servers.id })
    .from(servers)
    .where(and(isNotNull(servers.removedAt), lte(servers.removedAt, cutoff)))
    .all();
  if (marked.length === 0) {
    return 0;
  }
  let count = 0;
  for (const row of marked) {
    db.delete(servers).where(eq(servers.id, row.id)).run();
    count += 1;
  }
  return count;
}

/**
 * Mark every live server the bot is no longer in, given the guilds it is in.
 * Called at startup: a guild that removed the bot while it was offline sent no
 * `guildDelete`. Does nothing for an empty list, which at startup is far more
 * likely a cache problem than a bot in no guilds at all. Returns the number marked.
 */
export function markServersNotIn(guildIds: readonly string[]): number {
  if (guildIds.length === 0) {
    return 0;
  }
  const db = getDb();
  return db
    .update(servers)
    .set({ removedAt: now(), updatedAt: now() })
    .where(and(isNull(servers.removedAt), notInArray(servers.id, [...guildIds])))
    .run().changes;
}

/** Cancel a pending removal (used when a guild is re-invited). */
export function clearRemovalMarker(serverId: string): void {
  const db = getDb();
  db.update(servers)
    .set({ removedAt: null, updatedAt: now() })
    .where(eq(servers.id, serverId))
    .run();
}

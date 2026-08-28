import { and, count, desc, eq, gte, or, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { listings, type ListingRow, type NewListingRow } from '../db/schema.js';
import {
  DUPLICATE_WINDOW_MS,
  LISTING_COOLDOWN_MS,
  LISTING_TTL_MS,
  MY_LISTINGS_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
} from '../utils/constants.js';
import type { Accepts, ListingCreateInput, ListingIntent } from '../types/index.js';

const now = () => Date.now();

export interface CreateListingResult {
  listing: ListingRow;
  warning?: string;
}

/**
 * Create an active listing after applying the cooldown and duplicate guards.
 * Throws a human-readable error when the user is on cooldown.
 */
export function createListing(input: ListingCreateInput): CreateListingResult {
  const db = getDb();
  const created = now();
  const warning = duplicateWarning(input, created);
  enforceCooldown(input.serverId, input.userId, created);

  const row: NewListingRow = {
    serverId: input.serverId,
    userId: input.userId,
    username: input.username,
    intent: input.intent,
    accepts: input.accepts,
    game: input.game ?? 'mtg',
    cardName: input.cardName,
    cardNameNormalized: input.cardNameNormalized,
    cardSet: input.cardSet ?? null,
    cardImageUrl: input.cardImageUrl ?? null,
    finish: input.finish ?? null,
    variant: input.variant ?? null,
    collectorNumber: input.collectorNumber ?? null,
    manapoolUrl: input.manapoolUrl ?? null,
    condition: input.condition ?? null,
    priceCents: input.priceCents ?? null,
    quantity: input.quantity ?? 1,
    notes: input.notes ?? null,
    status: 'active',
    expiresAt: created + LISTING_TTL_MS,
    createdAt: created,
    updatedAt: created,
  };
  const inserted = db.insert(listings).values(row).returning().get();
  return { listing: inserted, warning };
}

function enforceCooldown(serverId: string, userId: string, at: number): void {
  const db = getDb();
  const last = db
    .select({ createdAt: listings.createdAt })
    .from(listings)
    .where(and(eq(listings.serverId, serverId), eq(listings.userId, userId)))
    .orderBy(desc(listings.createdAt))
    .all()
    .at(0);
  if (last && at - last.createdAt < LISTING_COOLDOWN_MS) {
    const wait = Math.ceil((LISTING_COOLDOWN_MS - (at - last.createdAt)) / 1000);
    throw new Error(
      `You are posting too quickly. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
    );
  }
}

function duplicateWarning(input: ListingCreateInput, at: number): string | undefined {
  const db = getDb();
  const windowStart = at - DUPLICATE_WINDOW_MS;
  const dup = db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        eq(listings.serverId, input.serverId),
        eq(listings.userId, input.userId),
        eq(listings.status, 'active'),
        eq(listings.cardNameNormalized, input.cardNameNormalized),
        eq(listings.intent, input.intent),
        eq(listings.accepts, input.accepts),
        sql`${listings.finish} IS ${input.finish ?? null}`,
        sql`${listings.variant} IS ${input.variant ?? null}`,
        sql`${listings.collectorNumber} IS ${input.collectorNumber ?? null}`,
        sql`${listings.condition} IS ${input.condition ?? null}`,
        sql`${listings.priceCents} IS ${input.priceCents ?? null}`,
        gte(listings.createdAt, windowStart),
      ),
    )
    .get();
  if (dup) {
    return `Note: you already have an active matching listing (#${dup.id}) posted in the last 24 hours.`;
  }
  return undefined;
}

/** Search active listings in a server with pagination, newest first. */
export function searchListings(
  serverId: string,
  cardNameNormalized: string,
  intent: ListingIntent | undefined,
  accepts: Accepts | undefined,
  page: number,
): ListingRow[] {
  const db = getDb();
  const conditions = searchConditions(serverId, cardNameNormalized, intent, accepts);
  const offset = Math.max(0, page - 1) * SEARCH_PAGE_SIZE;
  return db
    .select()
    .from(listings)
    .where(and(...conditions))
    .orderBy(desc(listings.createdAt))
    .limit(SEARCH_PAGE_SIZE)
    .offset(offset)
    .all();
}

/** Count matching active listings for pagination. */
export function countSearchResults(
  serverId: string,
  cardNameNormalized: string,
  intent: ListingIntent | undefined,
  accepts: Accepts | undefined,
): number {
  const db = getDb();
  const conditions = searchConditions(serverId, cardNameNormalized, intent, accepts);
  const row = db
    .select({ value: count() })
    .from(listings)
    .where(and(...conditions))
    .get();
  return row?.value ?? 0;
}

function searchConditions(
  serverId: string,
  cardNameNormalized: string,
  intent?: ListingIntent,
  accepts?: Accepts,
) {
  const conditions = [
    eq(listings.serverId, serverId),
    eq(listings.status, 'active'),
    eq(listings.cardNameNormalized, cardNameNormalized),
  ];
  if (intent) {
    conditions.push(eq(listings.intent, intent));
  }
  if (accepts) {
    // A listing that accepts 'both' should match a filter for either 'cash'
    // or 'trade'; only an exact 'both' filter should require 'both' itself.
    const clause =
      accepts === 'both'
        ? eq(listings.accepts, 'both')
        : or(eq(listings.accepts, accepts), eq(listings.accepts, 'both'));
    if (clause) {
      conditions.push(clause);
    }
  }
  return conditions;
}

/** List the user's own active listings, newest first, paginated. */
export function myListings(serverId: string, userId: string, page: number): ListingRow[] {
  const db = getDb();
  const offset = Math.max(0, page - 1) * MY_LISTINGS_PAGE_SIZE;
  return db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.serverId, serverId),
        eq(listings.userId, userId),
        eq(listings.status, 'active'),
      ),
    )
    .orderBy(desc(listings.createdAt))
    .limit(MY_LISTINGS_PAGE_SIZE)
    .offset(offset)
    .all();
}

/** Fetch a single listing regardless of status. */
export function getListingById(id: number): ListingRow | undefined {
  const db = getDb();
  return db.select().from(listings).where(eq(listings.id, id)).get();
}

/** Update owner-editable fields on a listing. */
export function updateListing(
  id: number,
  fields: {
    condition?: string | null;
    priceCents?: number | null;
    quantity?: number;
    notes?: string | null;
    cardSet?: string | null;
  },
): ListingRow | undefined {
  const db = getDb();
  const update: Partial<NewListingRow> = { updatedAt: now() };
  if (fields.condition !== undefined) update.condition = fields.condition;
  if (fields.priceCents !== undefined) update.priceCents = fields.priceCents;
  if (fields.quantity !== undefined) update.quantity = fields.quantity;
  if (fields.notes !== undefined) update.notes = fields.notes;
  if (fields.cardSet !== undefined) update.cardSet = fields.cardSet;
  db.update(listings).set(update).where(eq(listings.id, id)).run();
  return getListingById(id);
}

/** Mark a listing fulfilled. Only the owner may do this. */
export function fulfillListing(id: number): ListingRow | undefined {
  return setStatus(id, 'fulfilled');
}

/** Soft-delete a listing. Only the owner or an admin may do this. */
export function softDeleteListing(id: number): ListingRow | undefined {
  return setStatus(id, 'deleted');
}

function setStatus(id: number, status: 'fulfilled' | 'deleted'): ListingRow | undefined {
  const db = getDb();
  db.update(listings).set({ status, updatedAt: now() }).where(eq(listings.id, id)).run();
  return getListingById(id);
}

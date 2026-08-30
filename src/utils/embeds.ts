import { EmbedBuilder, ColorResolvable } from 'discord.js';
import {
  ACCEPTS_LABELS,
  CONDITION_LABELS,
  FINISH_LABELS,
  INTENT_LABELS,
  VARIANT_LABELS,
} from './constants.js';
import { buildManapoolUrl } from './manapool.js';
import { normalizeCardName } from './validation.js';
import type { ListingRow } from '../db/schema.js';

const BRAND_COLOR: ColorResolvable = 0x8f1d2c; // Liverpool red

/** The bot's brand color used on every embed. */
export function brandColor(): ColorResolvable {
  return BRAND_COLOR;
}

/** Format cents as a USD currency string, or an empty string when unset. */
export function formatPrice(priceCents: number | null | undefined): string {
  if (priceCents === null || priceCents === undefined) {
    return '';
  }
  return (priceCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

/** Build an embed title line: `{Intent} · {Accepts} — {Card Name} (SET)`. */
export function formatListingTitle(listing: {
  intent: string;
  accepts: string;
  cardName: string;
  cardSet?: string | null;
}): string {
  const intent = INTENT_LABELS[listing.intent as keyof typeof INTENT_LABELS] ?? listing.intent;
  const accepts = ACCEPTS_LABELS[listing.accepts as keyof typeof ACCEPTS_LABELS] ?? listing.accepts;
  const set = listing.cardSet ? ` (${listing.cardSet})` : '';
  return `${intent} · ${accepts} — ${listing.cardName}${set}`;
}

/** Resolve the Manapool link for a listing, falling back to a locally-built URL. */
function listingManapoolUrl(listing: ListingRow): string | null {
  return (
    listing.manapoolUrl ??
    buildManapoolUrl({
      cardName: listing.cardName,
      cardSet: listing.cardSet,
      collectorNumber: listing.collectorNumber,
    })
  );
}

/**
 * Build the full embed for a single listing (used by `/have`, `/want`, and
 * their batch/edit success replies). `showUser` adds a "Posted by" line,
 * used where the poster isn't otherwise implied by context.
 */
export function listingEmbed(
  listing: ListingRow,
  options: { showUser?: boolean } = {},
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(formatListingTitle(listing))
    .setFooter({ text: `Listing #${listing.id}` })
    .setTimestamp(new Date(listing.createdAt));

  const manapoolUrl = listingManapoolUrl(listing);
  if (manapoolUrl) {
    embed.setURL(manapoolUrl);
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (listing.condition) {
    const label =
      CONDITION_LABELS[listing.condition as keyof typeof CONDITION_LABELS] ?? listing.condition;
    fields.push({ name: 'Condition', value: label, inline: true });
  }
  if (listing.priceCents !== null && listing.priceCents !== undefined) {
    fields.push({ name: 'Price', value: formatPrice(listing.priceCents), inline: true });
  }
  fields.push({ name: 'Quantity', value: String(listing.quantity), inline: true });
  if (listing.finish) {
    const label = FINISH_LABELS[listing.finish as keyof typeof FINISH_LABELS] ?? listing.finish;
    fields.push({ name: 'Finish', value: label, inline: true });
  }
  if (listing.variant) {
    const label = VARIANT_LABELS[listing.variant as keyof typeof VARIANT_LABELS] ?? listing.variant;
    fields.push({ name: 'Variant', value: label, inline: true });
  }
  if (listing.collectorNumber) {
    fields.push({ name: 'Collector #', value: listing.collectorNumber, inline: true });
  }
  if (listing.notes) {
    fields.push({ name: 'Notes', value: listing.notes, inline: false });
  }
  if (fields.length > 0) {
    embed.addFields(fields);
  }

  if (options.showUser && listing.username) {
    embed.setDescription(`Posted by <@${listing.userId}> (${listing.username})`);
  }
  if (listing.cardImageUrl) {
    embed.setThumbnail(listing.cardImageUrl);
  }
  return embed;
}

/** Build a compact single-line description used inside digests. */
export function digestLine(listing: ListingRow): string {
  const set = listing.cardSet ? ` (${listing.cardSet})` : '';
  const condition = listing.condition
    ? ` — ${CONDITION_LABELS[listing.condition as keyof typeof CONDITION_LABELS] ?? listing.condition}`
    : '';
  const price =
    listing.priceCents !== null && listing.priceCents !== undefined
      ? ` — ${formatPrice(listing.priceCents)}`
      : '';
  const manapoolUrl = listingManapoolUrl(listing);
  const link = manapoolUrl ? ` — [View on Manapool](${manapoolUrl})` : '';
  return `- ${listing.cardName}${set}${condition}${price} — @${listing.username}${link}`;
}

/**
 * Build the card-cache key from a card name plus its printing details.
 * `services/card-cache.ts`'s `buildCacheKey` is a thin wrapper around this.
 */
export function cardKey(
  cardName: string,
  cardSet?: string | null,
  finish?: string | null,
  variant?: string | null,
  collectorNumber?: string | null,
): string {
  const base = normalizeCardName(cardName);
  const parts = [base];
  if (cardSet) parts.push(cardSet.toUpperCase());
  if (collectorNumber) parts.push(`CN${collectorNumber.toUpperCase()}`);
  if (finish) parts.push(finish);
  if (variant) parts.push(variant);
  return parts.join('::');
}

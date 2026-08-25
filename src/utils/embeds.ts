import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { CONDITION_LABELS, LISTING_TYPE_LABELS } from './constants.js';
import { normalizeCardName } from './validation.js';
import type { ListingRow } from '../db/schema.js';

const BRAND_COLOR: ColorResolvable = 0x8f1d2c; // Liverpool red

export function brandColor(): ColorResolvable {
  return BRAND_COLOR;
}

export function formatPrice(priceCents: number | null | undefined): string {
  if (priceCents === null || priceCents === undefined) {
    return '';
  }
  return (priceCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export function formatListingTitle(listing: {
  listingType: string;
  cardName: string;
  cardSet?: string | null;
}): string {
  const type =
    LISTING_TYPE_LABELS[listing.listingType as keyof typeof LISTING_TYPE_LABELS] ??
    listing.listingType;
  const set = listing.cardSet ? ` (${listing.cardSet})` : '';
  return `${type} — ${listing.cardName}${set}`;
}

export function listingEmbed(
  listing: ListingRow,
  options: { showUser?: boolean } = {},
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(formatListingTitle(listing))
    .setFooter({ text: `Listing #${listing.id}` })
    .setTimestamp(new Date(listing.createdAt));

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
  return `- ${listing.cardName}${set}${condition}${price} — @${listing.username}`;
}

export function cardKey(cardName: string, cardSet?: string | null): string {
  const base = normalizeCardName(cardName);
  return cardSet ? `${base}::${cardSet.toUpperCase()}` : base;
}

import { EmbedBuilder, ColorResolvable } from 'discord.js';
import {
  ACCEPTS_LABELS,
  CONDITION_LABELS,
  FINISH_LABELS,
  formatSealedType,
  INTENT_LABELS,
  LANGUAGE_LABELS,
  VARIANT_LABELS,
} from './constants.js';
import { formatGrade } from './validation.js';
import { getGame } from '../games/index.js';
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

/**
 * A listing's marketplace link: the one stored when it was posted, else its
 * game's locally-built fallback (Manapool, for Magic), else none.
 */
function listingMarketUrl(listing: ListingRow): string | null {
  return listing.marketUrl ?? getGame(listing.game)?.fallbackMarketUrl(listing) ?? null;
}

/** What a listing's condition reads as: `NM`, or `PSA 10` for a graded slab. */
export function conditionText(
  listing: Pick<ListingRow, 'condition' | 'gradingCompany' | 'grade'>,
): string | null {
  if (!listing.condition) {
    return null;
  }
  if (listing.condition === 'graded') {
    return formatGrade(listing.gradingCompany, listing.grade) || CONDITION_LABELS.graded;
  }
  return CONDITION_LABELS[listing.condition as keyof typeof CONDITION_LABELS] ?? listing.condition;
}

/** `JA`, or null for English, the language a listing has unless it says otherwise. */
export function languageTag(language: string | null | undefined): string | null {
  return language && language !== 'en' ? language.toUpperCase() : null;
}

/**
 * Build the full embed for a single listing (used by `/have`, `/want`, and
 * their batch/edit success replies). `showUser` adds a "Posted by" line,
 * used where the poster isn't otherwise implied by context.
 */
export function listingEmbed(
  listing: ListingRow,
  options: { showUser?: boolean; showGame?: boolean } = {},
): EmbedBuilder {
  // The game only earns a place when the server has more than one.
  const gameLabel = options.showGame ? getGame(listing.game)?.shortLabel : undefined;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(formatListingTitle(listing))
    .setFooter({ text: `Listing #${listing.id}${gameLabel ? ` · ${gameLabel}` : ''}` })
    .setTimestamp(new Date(listing.createdAt));

  const marketUrl = listingMarketUrl(listing);
  if (marketUrl) {
    embed.setURL(marketUrl);
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (listing.condition === 'graded') {
    fields.push({ name: 'Grade', value: conditionText(listing) ?? '', inline: true });
  } else if (listing.condition) {
    fields.push({ name: 'Condition', value: conditionText(listing) ?? '', inline: true });
  }
  if (listing.language && listing.language !== 'en') {
    const label =
      LANGUAGE_LABELS[listing.language as keyof typeof LANGUAGE_LABELS] ?? listing.language;
    fields.push({ name: 'Language', value: label, inline: true });
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
  if (listing.kind === 'sealed') {
    const category = formatSealedType(listing.sealedCategory ?? '');
    const subtype = formatSealedType(listing.sealedSubtype ?? '');
    const product = [category, subtype].filter(Boolean).join(' — ');
    if (product) {
      fields.push({ name: 'Product', value: product, inline: true });
    }
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

/**
 * Build a compact single-line description used inside digests. `showGame` adds
 * the game's short name, for a server with more than one.
 */
export function digestLine(listing: ListingRow, options: { showGame?: boolean } = {}): string {
  const game = getGame(listing.game);
  const set = listing.cardSet ? ` (${listing.cardSet})` : '';
  const condition = [
    conditionText(listing),
    languageTag(listing.language),
    options.showGame ? game?.shortLabel : null,
  ]
    .filter(Boolean)
    .map((part) => ` — ${part}`)
    .join('');
  const price =
    listing.priceCents !== null && listing.priceCents !== undefined
      ? ` — ${formatPrice(listing.priceCents)}`
      : '';
  const marketUrl = listingMarketUrl(listing);
  const link = marketUrl ? ` — [View on ${game?.marketLabel ?? 'Market'}](${marketUrl})` : '';
  return `- ${listing.cardName}${set}${condition}${price} — @${listing.username}${link}`;
}

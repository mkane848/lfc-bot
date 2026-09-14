import {
  ACCEPTS_VALUES,
  CARD_CONDITIONS,
  CARD_FINISHES,
  CARD_VARIANTS,
  DIGEST_MODES,
  LISTING_INTENTS,
} from '../types/index.js';

export const PROJECT_NAME = 'LFCbot';
export const PROJECT_REPOSITORY = 'https://github.com/mkane848/lfc-bot';

export const DEFAULT_DIGEST_CRON = '0 9 * * *';
export const DEFAULT_DIGEST_TIMEZONE = 'UTC';
export const DEFAULT_DIGEST_MODE = 'disabled';

export const LISTING_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CARD_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const LISTING_COOLDOWN_MS = 10 * 1000; // 10 seconds
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const GUILD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SEALED_CATALOG_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

export const MAX_PRICE_CENTS = 10_000_000; // $100,000.00
export const MIN_PRICE_CENTS = 0;
export const MAX_NOTES_LENGTH = 500;
export const MAX_QUANTITY = 99;
export const MIN_QUANTITY = 1;
export const SEARCH_PAGE_SIZE = 10;
export const MY_LISTINGS_PAGE_SIZE = 5;
export const DIGEST_SECTION_CAP = 25;
/** Discord caps autocomplete choice name and value at 100 characters. */
export const SEALED_PRODUCT_NAME_MAX = 100;

/** MTGJSON's full set list; every set's `sealedProduct[]` is read from it. */
export const SEALED_CATALOG_URL = 'https://mtgjson.com/api/v5/SetList.json';
/** MTGJSON's tiny build-metadata document, used to skip an unchanged catalog. */
export const SEALED_CATALOG_META_URL = 'https://mtgjson.com/api/v5/Meta.json';

export const CONDITION_LABELS: Record<(typeof CARD_CONDITIONS)[number], string> = {
  nm: 'NM',
  lp: 'LP',
  mp: 'MP',
  hp: 'HP',
  dmg: 'DMG',
};

export const INTENT_LABELS: Record<(typeof LISTING_INTENTS)[number], string> = {
  have: 'Have',
  want: 'Want',
};

export const ACCEPTS_LABELS: Record<(typeof ACCEPTS_VALUES)[number], string> = {
  cash: 'Cash',
  trade: 'Trade',
  both: 'Cash or Trade',
};

export const FINISH_LABELS: Record<(typeof CARD_FINISHES)[number], string> = {
  nonfoil: 'Nonfoil',
  foil: 'Foil',
  etched: 'Etched',
};

export const VARIANT_LABELS: Record<(typeof CARD_VARIANTS)[number], string> = {
  extended: 'Extended Art',
  showcase: 'Showcase',
  borderless: 'Borderless',
  retro: 'Retro Frame',
  full: 'Full Art',
};

export const DIGEST_MODE_LABELS: Record<(typeof DIGEST_MODES)[number], string> = {
  disabled: 'Disabled',
  channel: 'Channel',
  dm: 'DM',
  both: 'Channel + DM',
};

export const GAME_LABELS: Record<string, string> = {
  mtg: 'Magic: The Gathering',
};

/**
 * Display overrides for sealed `category`/`subtype` values that plain
 * title-casing gets wrong. Deliberately a loose `Record<string, string>` rather
 * than the exhaustive `Record<(typeof ARRAY)[number], string>` form used above:
 * MTGJSON adds enum values without warning, and an exhaustive map would either
 * fail type-check or render a blank label for anything new.
 */
export const SEALED_TYPE_LABEL_OVERRIDES: Record<string, string> = {
  mtgo_redemption: 'MTGO Redemption',
  deck_builders_toolkit: "Deck Builder's Toolkit",
  collectors_edition: "Collector's Edition",
  from_the_vault: 'From the Vault',
  two_player_starter: 'Two-Player Starter',
  'six-card': 'Six-Card',
};

/**
 * MTGJSON placeholder values that appear in the `category` and/or `subtype`
 * enums but tell a reader nothing. Rendering them literally would put a
 * meaningless "Unknown"/"Default"/"Other" in a user-facing field, so
 * `formatSealedType` collapses them to an empty string and callers skip the
 * field exactly as they do for an empty input.
 */
const SEALED_TYPE_PLACEHOLDERS: ReadonlySet<string> = new Set(['unknown', 'default', 'other']);

/**
 * Render an MTGJSON sealed `category` or `subtype` for display: underscores and
 * hyphens become spaces and each word is title-cased (`booster_box` → "Booster
 * Box"), unless `SEALED_TYPE_LABEL_OVERRIDES` supplies a better label. Returns
 * an empty string for an empty/whitespace input, and for the placeholder values
 * in `SEALED_TYPE_PLACEHOLDERS`, so callers can skip the field.
 */
export function formatSealedType(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key.length === 0 || SEALED_TYPE_PLACEHOLDERS.has(key)) {
    return '';
  }
  const override = SEALED_TYPE_LABEL_OVERRIDES[key];
  if (override !== undefined) {
    return override;
  }
  return key
    .split(/[_\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const SUPPORTED_GAMES = ['mtg'] as const;
export type SupportedGame = (typeof SUPPORTED_GAMES)[number];

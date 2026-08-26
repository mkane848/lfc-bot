import { CARD_CONDITIONS, DIGEST_MODES, LISTING_TYPES } from '../types/index.js';

export const PROJECT_NAME = 'LFCbot';
export const PROJECT_REPOSITORY = 'https://github.com/example/lfcbot';

export const DEFAULT_DIGEST_CRON = '0 9 * * *';
export const DEFAULT_DIGEST_TIMEZONE = 'UTC';
export const DEFAULT_DIGEST_MODE = 'disabled';

export const LISTING_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CARD_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const LISTING_COOLDOWN_MS = 10 * 1000; // 10 seconds
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const GUILD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const MAX_PRICE_CENTS = 10_000_000; // $100,000.00
export const MIN_PRICE_CENTS = 0;
export const MAX_NOTES_LENGTH = 500;
export const MAX_QUANTITY = 99;
export const MIN_QUANTITY = 1;
export const SEARCH_PAGE_SIZE = 10;
export const MY_LISTINGS_PAGE_SIZE = 2;
export const DIGEST_SECTION_CAP = 25;

export const CONDITION_LABELS: Record<(typeof CARD_CONDITIONS)[number], string> = {
  nm: 'NM',
  lp: 'LP',
  mp: 'MP',
  hp: 'HP',
  dmg: 'DMG',
};

export const LISTING_TYPE_LABELS: Record<(typeof LISTING_TYPES)[number], string> = {
  buy: 'Buy',
  sell: 'Sell',
  trade: 'Trade',
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

export const SUPPORTED_GAMES = ['mtg'] as const;
export type SupportedGame = (typeof SUPPORTED_GAMES)[number];

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

export const MAX_PRICE_CENTS = 10_000_000; // $100,000.00
export const MIN_PRICE_CENTS = 0;
export const MAX_NOTES_LENGTH = 500;
export const MAX_QUANTITY = 99;
export const MIN_QUANTITY = 1;
export const SEARCH_PAGE_SIZE = 10;
export const MY_LISTINGS_PAGE_SIZE = 5;
export const DIGEST_SECTION_CAP = 25;

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

export const SUPPORTED_GAMES = ['mtg'] as const;
export type SupportedGame = (typeof SUPPORTED_GAMES)[number];

import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';

export type ListingIntent = 'have' | 'want';
export type Accepts = 'cash' | 'trade' | 'both';
export type CardFinish = 'nonfoil' | 'foil' | 'etched' | 'reverse';
export type CardVariant = 'extended' | 'showcase' | 'borderless' | 'retro' | 'full';
export type ListingStatus = 'active' | 'fulfilled' | 'expired' | 'deleted';
export type CardCondition = 'nm' | 'lp' | 'mp' | 'hp' | 'dmg' | 'graded';
export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'TAG' | 'ACE';
export type ListingLanguage =
  'en' | 'ja' | 'de' | 'fr' | 'it' | 'es' | 'pt' | 'ko' | 'zh-cn' | 'zh-tw' | 'ru';
export type DigestMode = 'disabled' | 'channel' | 'dm' | 'both';
export type ListingKind = 'card' | 'sealed';
export type DigestTrigger = 'scheduled' | 'manual';

export const LISTING_INTENTS: readonly ListingIntent[] = ['have', 'want'];
export const ACCEPTS_VALUES: readonly Accepts[] = ['cash', 'trade', 'both'];
export const CARD_FINISHES: readonly CardFinish[] = ['nonfoil', 'foil', 'etched', 'reverse'];
export const CARD_VARIANTS: readonly CardVariant[] = [
  'extended',
  'showcase',
  'borderless',
  'retro',
  'full',
];
export const CARD_CONDITIONS: readonly CardCondition[] = ['nm', 'lp', 'mp', 'hp', 'dmg', 'graded'];
export const GRADING_COMPANIES: readonly GradingCompany[] = [
  'PSA',
  'BGS',
  'CGC',
  'SGC',
  'TAG',
  'ACE',
];
export const LISTING_LANGUAGES: readonly ListingLanguage[] = [
  'en',
  'ja',
  'de',
  'fr',
  'it',
  'es',
  'pt',
  'ko',
  'zh-cn',
  'zh-tw',
  'ru',
];
export const DEFAULT_LISTING_LANGUAGE: ListingLanguage = 'en';
export const DIGEST_MODES: readonly DigestMode[] = ['disabled', 'channel', 'dm', 'both'];
export const LISTING_KINDS: readonly ListingKind[] = ['card', 'sealed'];

export interface ResolvedCard {
  scryfallId?: string | null;
  cardName: string;
  cardNameNormalized: string;
  cardSet?: string | null;
  cardImageUrl?: string | null;
  collectorNumber?: string | null;
  marketUrl?: string | null;
  manapoolPriceCents?: number | null;
  /** The source catalog's id for this exact printing, when it has one (not set for MTG). */
  catalogId?: string | null;
  /** The printing's language when the catalog row fixes it (a Japanese print is `ja`). */
  language?: ListingLanguage | null;
  resolved: boolean;
}

/**
 * A sealed product looked up in `sealed_cache`. On a catalog miss every field
 * but `productName`/`productNameNormalized` is null and `resolved` is false —
 * the commands still post that as a free-text listing.
 */
export interface ResolvedSealedProduct {
  productName: string;
  productNameNormalized: string;
  setCode: string | null;
  uuid: string | null;
  category: string | null;
  subtype: string | null;
  marketUrl: string | null;
  /** The product's language when the catalog row fixes it (a Japanese product is `ja`). */
  language?: ListingLanguage | null;
  resolved: boolean;
}

export interface ListingCreateInput {
  serverId: string;
  userId: string;
  username: string;
  intent: ListingIntent;
  accepts: Accepts;
  cardName: string;
  cardNameNormalized: string;
  cardSet?: string | null;
  cardImageUrl?: string | null;
  finish?: CardFinish | null;
  variant?: CardVariant | null;
  collectorNumber?: string | null;
  marketUrl?: string | null;
  condition?: CardCondition | null;
  priceCents?: number | null;
  quantity?: number;
  notes?: string | null;
  game?: string;
  language?: ListingLanguage;
  gradingCompany?: GradingCompany | null;
  grade?: string | null;
  kind?: ListingKind;
  catalogId?: string | null;
  sealedCategory?: string | null;
  sealedSubtype?: string | null;
}

/** A top-level slash command. */
export interface GuildCommand {
  name: string;
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

/** A subcommand within an admin group. */
export interface AdminSubcommand {
  name: string;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export type SubcommandGroupBuilder = SlashCommandSubcommandGroupBuilder;

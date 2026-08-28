import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';

export type ListingIntent = 'have' | 'want';
export type Accepts = 'cash' | 'trade' | 'both';
export type CardFinish = 'nonfoil' | 'foil' | 'etched';
export type CardVariant = 'extended' | 'showcase' | 'borderless' | 'retro' | 'full';
export type ListingStatus = 'active' | 'fulfilled' | 'expired' | 'deleted';
export type CardCondition = 'nm' | 'lp' | 'mp' | 'hp' | 'dmg';
export type DigestMode = 'disabled' | 'channel' | 'dm' | 'both';
export type DigestTrigger = 'scheduled' | 'manual';

export const LISTING_INTENTS: readonly ListingIntent[] = ['have', 'want'];
export const ACCEPTS_VALUES: readonly Accepts[] = ['cash', 'trade', 'both'];
export const CARD_FINISHES: readonly CardFinish[] = ['nonfoil', 'foil', 'etched'];
export const CARD_VARIANTS: readonly CardVariant[] = [
  'extended',
  'showcase',
  'borderless',
  'retro',
  'full',
];
export const CARD_CONDITIONS: readonly CardCondition[] = ['nm', 'lp', 'mp', 'hp', 'dmg'];
export const DIGEST_MODES: readonly DigestMode[] = ['disabled', 'channel', 'dm', 'both'];

export interface ResolvedCard {
  scryfallId?: string | null;
  cardName: string;
  cardNameNormalized: string;
  cardSet?: string | null;
  cardImageUrl?: string | null;
  collectorNumber?: string | null;
  manapoolUrl?: string | null;
  manapoolPriceCents?: number | null;
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
  manapoolUrl?: string | null;
  condition?: CardCondition | null;
  priceCents?: number | null;
  quantity?: number;
  notes?: string | null;
  game?: string;
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

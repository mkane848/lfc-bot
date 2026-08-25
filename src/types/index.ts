import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';

export type ListingType = 'buy' | 'sell' | 'trade';
export type ListingStatus = 'active' | 'fulfilled' | 'expired' | 'deleted';
export type CardCondition = 'nm' | 'lp' | 'mp' | 'hp' | 'dmg';
export type DigestMode = 'disabled' | 'channel' | 'dm' | 'both';
export type DigestTrigger = 'scheduled' | 'manual';

export const LISTING_TYPES: readonly ListingType[] = ['buy', 'sell', 'trade'];
export const CARD_CONDITIONS: readonly CardCondition[] = ['nm', 'lp', 'mp', 'hp', 'dmg'];
export const DIGEST_MODES: readonly DigestMode[] = ['disabled', 'channel', 'dm', 'both'];

export interface ResolvedCard {
  scryfallId?: string | null;
  cardName: string;
  cardNameNormalized: string;
  cardSet?: string | null;
  cardImageUrl?: string | null;
  resolved: boolean;
}

export interface ListingCreateInput {
  serverId: string;
  userId: string;
  username: string;
  listingType: ListingType;
  cardName: string;
  cardNameNormalized: string;
  cardSet?: string | null;
  cardImageUrl?: string | null;
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

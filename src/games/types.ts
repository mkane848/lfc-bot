import type { ListingRow } from '../db/schema.js';
import type {
  CardFinish,
  CardVariant,
  ListingKind,
  ListingLanguage,
  ResolvedCard,
  ResolvedSealedProduct,
} from '../types/index.js';

/** One Discord autocomplete choice. Discord caps both fields at 100 characters. */
export interface AutocompleteChoice {
  name: string;
  value: string;
}

/** The printing details a member can narrow a card lookup by. */
export interface CardResolveOptions {
  cardSet?: string | null;
  finish?: CardFinish | null;
  variant?: CardVariant | null;
  collectorNumber?: string | null;
  /** Restrict the lookup to one language's printings, for games whose catalog has several. */
  language?: ListingLanguage | null;
}

export interface AutocompleteContext {
  /** Epoch ms by which suggestions must be ready; Discord drops a later response. */
  deadline: number;
  /** The set the member already picked, to narrow sealed-product suggestions. */
  setCode: string | null;
  /** The `language` the member already chose, to narrow suggestions to that language's printings. */
  language: ListingLanguage | null;
}

/**
 * A game whose cards and products come from a local catalog that a sync fills
 * (Magic has its own, older sync for sealed product). The bot only syncs a
 * game's catalog while some server has the game enabled.
 */
export interface GameCatalog {
  /** Refresh the catalog. Never throws; a failed run leaves the old catalog in place. */
  sync: () => Promise<unknown>;
  /** Whether the catalog has never been synced or hasn't been confirmed current for a day. */
  isStale: () => boolean;
}

/** What `/search` needs from a card the member typed or picked. */
export interface SearchTarget {
  /** Shown in the results heading. */
  displayName: string;
  /** Matches `listings.card_name_normalized`. */
  searchKey: string;
}

/**
 * Everything the bot needs to know about one trading card game. The commands
 * never name a game: they resolve one (`resolveGameForValue`) and call through
 * its definition, so supporting another game means registering another one of
 * these (`registerGame`).
 */
export interface GameDefinition {
  /** Stored in `listings.game` and `servers.enabled_games`. */
  id: string;
  /** Prefixes autocomplete values in a server with several games (`mtg:Black Lotus`). */
  tag: string;
  /** Full name, shown to admins and in `/admin games`. */
  label: string;
  /** Short name for compact lines and merged autocomplete labels. */
  shortLabel: string;
  /** The marketplace listings link to, as in "View on Manapool". */
  marketLabel: string;
  /** The kinds of listing this game supports. A game without `sealed` rejects the sealed commands. */
  kinds: readonly ListingKind[];
  /** Present for a game backed by a synced catalog, so the bot knows when to refresh it. */
  catalog?: GameCatalog;
  /** The finishes this game's cards come in; any other is rejected for it. */
  finishes: readonly CardFinish[];
  /** Whether printing variants (extended art, showcase, …) exist for this game. */
  supportsVariant: boolean;

  /** Suggestions for a card or sealed-product name. */
  autocompleteItems: (
    kind: ListingKind,
    query: string,
    context: AutocompleteContext,
  ) => Promise<AutocompleteChoice[]>;
  /** Suggestions for the `set` option. */
  autocompleteSets: (kind: ListingKind, query: string) => Promise<AutocompleteChoice[]>;
  /** Resolve a typed or picked card to one printing. `resolved: false` when unknown. */
  resolveCard: (name: string, options: CardResolveOptions) => Promise<ResolvedCard>;
  /** Resolve a typed or picked sealed product. A miss is a free-text result. */
  resolveSealed: (
    name: string,
    options: { setCode?: string | null },
  ) => Promise<ResolvedSealedProduct>;
  /**
   * Whether `value` is a picked suggestion that names one exact catalog entry,
   * as opposed to a name the member typed. A pick that no longer resolves
   * can't fall back to its text.
   */
  isCatalogPick: (kind: ListingKind, value: string) => boolean;
  /** The name and search key behind a typed or picked card, or null if unknown. */
  searchTarget: (value: string) => SearchTarget | null;
  /** A link to show when a listing has none stored, or null. */
  fallbackMarketUrl: (
    listing: Pick<ListingRow, 'cardName' | 'cardSet' | 'collectorNumber'>,
  ) => string | null;
}

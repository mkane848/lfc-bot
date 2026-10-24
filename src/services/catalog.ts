import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { catalogItems, catalogSets } from '../db/schema.js';
import { baseProductName, setLabelFor } from '../utils/catalog-names.js';
import { tcgplayerImageUrl, tcgplayerProductUrl } from '../utils/tcgplayer.js';
import { normalizeCardName } from '../utils/validation.js';
import type { CardResolveOptions, SearchTarget } from '../games/types.js';
import type {
  ListingKind,
  ListingLanguage,
  ResolvedCard,
  ResolvedSealedProduct,
} from '../types/index.js';

/**
 * Reads from the non-Magic catalog (`catalog_sets`, `catalog_items`), filled by
 * a sync (`src/services/tcgcsv.ts`). Everything here is a local query, so it
 * answers inside Discord's 3-second autocomplete window and never touches the
 * network at post time.
 */

/** Discord allows at most 25 autocomplete choices. */
const CHOICE_LIMIT = 25;
/** Discord caps a choice's name and value at 100 characters. */
const CHOICE_MAX_LENGTH = 100;

/** Prefix on an autocomplete value that carries an exact catalog id rather than a typed name. */
export const CATALOG_PICK_PREFIX = 'id:';

/** The id inside a picked suggestion (`id:501256`), or null for text a member typed. */
export function catalogPickId(value: string): string | null {
  const match = /^id:(\d+)$/.exec(value.trim());
  return match?.[1] ?? null;
}

/**
 * Which catalog language a member's `language` option points at. Japanese has
 * its own rows; every other language shares the English product (a German card
 * is the same card as the English one), and no option at all means both.
 */
function catalogLanguage(language: ListingLanguage | null | undefined): 'en' | 'ja' | null {
  if (!language) {
    return null;
  }
  return language === 'ja' ? 'ja' : 'en';
}

/** The tokens of a query, each safe to put inside a `LIKE` pattern (letters, digits only). */
function tokensOf(query: string): string[] {
  return normalizeCardName(query)
    .split(' ')
    .filter((token) => token.length > 0);
}

/** `Name · SET 125 · JA`, with the name shortened to keep the whole label within Discord's cap. */
function itemLabel(row: {
  name: string;
  number: string | null;
  language: string;
  setCode: string;
  setName: string;
}): string {
  const set = setLabelFor(row.setCode, row.setName);
  const suffix = ` · ${set}${row.number ? ` ${row.number}` : ''}${row.language === 'ja' ? ' · JA' : ''}`;
  const room = CHOICE_MAX_LENGTH - suffix.length;
  const name = row.name.length > room ? `${row.name.slice(0, Math.max(room - 1, 1))}…` : row.name;
  return `${name}${suffix}`.slice(0, CHOICE_MAX_LENGTH);
}

const joinSets = and(
  eq(catalogItems.game, catalogSets.game),
  eq(catalogItems.language, catalogSets.language),
  eq(catalogItems.setId, catalogSets.id),
);

/**
 * Suggestions for a card or product name. Every whitespace-separated token of
 * the query has to match somewhere in the name, set code, set name or number
 * (all tokens, any order), so `pikachu obf 025` and `charizard 125` both work.
 * A card has many printings, so the newest set comes first (supplemental sets
 * last), and an exact name match comes before a partial one. Each choice's value
 * carries the exact id. A `setCode` (typed, or picked as `id:<set id>`) keeps to
 * that set's products.
 */
export function searchCatalogItems(
  game: string,
  kind: ListingKind,
  query: string,
  language?: ListingLanguage | null,
  setCode?: string | null,
): Array<{ name: string; value: string }> {
  const tokens = tokensOf(query);
  if (tokens.length === 0) {
    return [];
  }
  const wanted = catalogLanguage(language);
  const matchesToken = (token: string) => {
    const pattern = `%${token}%`;
    return or(
      like(catalogItems.nameNormalized, pattern),
      sql`lower(${catalogSets.code}) like ${pattern}`,
      sql`lower(${catalogSets.name}) like ${pattern}`,
      sql`lower(${catalogItems.number}) like ${pattern}`,
    );
  };
  const rows = getDb()
    .select({
      id: catalogItems.id,
      name: catalogItems.name,
      number: catalogItems.number,
      language: catalogItems.language,
      setCode: catalogSets.code,
      setName: catalogSets.name,
    })
    .from(catalogItems)
    .innerJoin(catalogSets, joinSets)
    .where(
      and(
        eq(catalogItems.game, game),
        eq(catalogItems.kind, kind),
        wanted ? eq(catalogItems.language, wanted) : undefined,
        setCode ? setCondition(setCode) : undefined,
        ...tokens.map(matchesToken),
      ),
    )
    .orderBy(
      // An exact name first, then one that has every token as a whole word (so
      // `tin` finds Mini Tin ahead of Victini Box), then one whose own name has
      // every token somewhere (so a lone `m` finds Nidoran M ahead of cards that
      // only match it in a set code), and only then the rest.
      sql`(${catalogItems.baseNormalized} = ${tokens.join(' ')}) desc`,
      sql`(${and(...tokens.map((token) => like(sql`' ' || ${catalogItems.nameNormalized} || ' '`, `% ${token} %`)))}) desc`,
      sql`(${and(...tokens.map((token) => like(catalogItems.nameNormalized, `%${token}%`)))}) desc`,
      // Of what is left, the shorter name is the closer to what was typed
      // (`Charizard ex` before `Mega Charizard X ex` for "charizard ex 125").
      sql`length(${catalogItems.nameNormalized})`,
      // With no language chosen, English comes first: Japanese sets usually
      // release earlier, and would otherwise take the top of every search.
      sql`(${catalogItems.language} = 'en') desc`,
      asc(catalogSets.supplemental),
      desc(catalogSets.releaseDate),
      asc(catalogItems.name),
      asc(catalogItems.number),
      asc(catalogItems.id),
    )
    .limit(CHOICE_LIMIT)
    .all();
  return rows.map((row) => ({
    name: itemLabel(row),
    value: `${CATALOG_PICK_PREFIX}${row.id}`,
  }));
}

/**
 * Suggestions for the `set` option: sets that have at least one product of
 * `kind`, matched by code or name, newest first (an empty query lists the
 * newest). The value carries the set's id, since codes repeat and can be empty.
 */
export function searchCatalogSets(
  game: string,
  kind: ListingKind,
  query: string,
): Array<{ name: string; value: string }> {
  const tokens = tokensOf(query);
  const hasProduct = sql`exists (
    select 1 from ${catalogItems}
    where ${catalogItems.game} = ${catalogSets.game}
      and ${catalogItems.language} = ${catalogSets.language}
      and ${catalogItems.setId} = ${catalogSets.id}
      and ${catalogItems.kind} = ${kind}
  )`;
  const rows = getDb()
    .select({
      id: catalogSets.id,
      name: catalogSets.name,
      code: catalogSets.code,
      language: catalogSets.language,
    })
    .from(catalogSets)
    .where(
      and(
        eq(catalogSets.game, game),
        hasProduct,
        ...tokens.map((token) =>
          or(
            sql`lower(${catalogSets.code}) like ${`%${token}%`}`,
            sql`lower(${catalogSets.name}) like ${`%${token}%`}`,
          ),
        ),
      ),
    )
    .orderBy(asc(catalogSets.supplemental), desc(catalogSets.releaseDate), asc(catalogSets.name))
    .limit(CHOICE_LIMIT)
    .all();
  return rows.map((row) => {
    const code = setLabelFor(row.code, row.name);
    const suffix = ` (${code}${row.language === 'ja' ? ' · JA' : ''})`;
    const room = CHOICE_MAX_LENGTH - suffix.length;
    const name = row.name.length > room ? `${row.name.slice(0, Math.max(room - 1, 1))}…` : row.name;
    return { name: `${name}${suffix}`, value: `${CATALOG_PICK_PREFIX}${row.id}` };
  });
}

/** One catalog product with its set, as the commands need it. */
export interface CatalogEntry {
  id: string;
  kind: string;
  name: string;
  nameNormalized: string;
  baseNormalized: string;
  number: string | null;
  /** The kind of sealed product, null for a card. */
  category: string | null;
  language: string;
  /** What a listing's set shows and `/edit` round-trips (see `setLabelFor`). */
  setLabel: string;
}

const entryColumns = {
  id: catalogItems.id,
  kind: catalogItems.kind,
  name: catalogItems.name,
  nameNormalized: catalogItems.nameNormalized,
  baseNormalized: catalogItems.baseNormalized,
  number: catalogItems.number,
  category: catalogItems.category,
  language: catalogItems.language,
  setCode: catalogSets.code,
  setName: catalogSets.name,
};

function toEntry(row: {
  id: string;
  kind: string;
  name: string;
  nameNormalized: string;
  baseNormalized: string;
  number: string | null;
  category: string | null;
  language: string;
  setCode: string;
  setName: string;
}): CatalogEntry {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    nameNormalized: row.nameNormalized,
    baseNormalized: row.baseNormalized,
    number: row.number,
    category: row.category,
    language: row.language,
    setLabel: setLabelFor(row.setCode, row.setName),
  };
}

/** Look one product up by the id a picked suggestion carried. */
export function findCatalogEntry(
  game: string,
  kind: ListingKind,
  id: string,
): CatalogEntry | undefined {
  const row = getDb()
    .select(entryColumns)
    .from(catalogItems)
    .innerJoin(catalogSets, joinSets)
    .where(and(eq(catalogItems.game, game), eq(catalogItems.kind, kind), eq(catalogItems.id, id)))
    .get();
  return row ? toEntry(row) : undefined;
}

/** A typed set (`OBF`, `Obsidian Flames`) or a picked one (`id:23228`) as a condition on `catalog_sets`. */
function setCondition(cardSet: string): SQL | undefined {
  const pickedId = catalogPickId(cardSet);
  if (pickedId) {
    return eq(catalogSets.id, pickedId);
  }
  const typed = cardSet.trim().toLowerCase();
  if (!typed) {
    return undefined;
  }
  // A set with no code shows its name cut to the modal's width, so a name that
  // merely starts with the typed text has to count too. The text is typed by a
  // member, so its `%` and `_` are escaped rather than left to act as wildcards.
  const prefix = `${typed.replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    sql`lower(${catalogSets.code}) = ${typed}`,
    sql`lower(${catalogSets.name}) = ${typed}`,
    sql`lower(${catalogSets.name}) like ${prefix} escape '\\'`,
  );
}

function resolvedFrom(entry: CatalogEntry): ResolvedCard {
  return {
    cardName: entry.name,
    cardNameNormalized: entry.baseNormalized,
    cardSet: entry.setLabel,
    cardImageUrl: tcgplayerImageUrl(entry.id),
    collectorNumber: entry.number,
    marketUrl: tcgplayerProductUrl(entry.id),
    catalogId: entry.id,
    // An English product is the generic printing, so it fixes nothing: the
    // member may say German, say. A Japanese one does fix the language.
    language: entry.language === 'ja' ? 'ja' : null,
    resolved: true,
  };
}

/**
 * Resolve a typed or picked card to one product. A pick (`id:501256`) is
 * looked up exactly. A typed name matches the full name or the name without
 * its printing qualifier, narrowed by the set, collector number and language
 * if given; of what is left, an exact full-name match wins, then English over
 * Japanese (unless a language was given), then the newest set. A miss is
 * `resolved: false`, which the card commands reject.
 */
export function resolveCatalogCard(
  game: string,
  input: string,
  options: CardResolveOptions = {},
): ResolvedCard {
  const unresolved: ResolvedCard = {
    cardName: input.trim(),
    cardNameNormalized: normalizeCardName(input),
    cardSet: options.cardSet && !catalogPickId(options.cardSet) ? options.cardSet : null,
    cardImageUrl: null,
    collectorNumber: null,
    marketUrl: null,
    resolved: false,
  };

  const pickedId = catalogPickId(input);
  if (pickedId) {
    const entry = findCatalogEntry(game, 'card', pickedId);
    return entry ? resolvedFrom(entry) : { ...unresolved, cardName: '', cardNameNormalized: '' };
  }

  const typed = normalizeCardName(input);
  if (!typed) {
    return unresolved;
  }
  const wanted = catalogLanguage(options.language);
  const row = getDb()
    .select(entryColumns)
    .from(catalogItems)
    .innerJoin(catalogSets, joinSets)
    .where(
      and(
        eq(catalogItems.game, game),
        eq(catalogItems.kind, 'card'),
        or(eq(catalogItems.nameNormalized, typed), eq(catalogItems.baseNormalized, typed)),
        wanted ? eq(catalogItems.language, wanted) : undefined,
        options.cardSet ? setCondition(options.cardSet) : undefined,
        options.collectorNumber
          ? // `024` and `24` are the same collector number.
            sql`ltrim(upper(${catalogItems.number}), '0') = ${options.collectorNumber
              .trim()
              .toUpperCase()
              .replace(/^0+/, '')}`
          : undefined,
      ),
    )
    .orderBy(
      sql`(${catalogItems.nameNormalized} = ${typed}) desc`,
      sql`(${catalogItems.language} = 'en') desc`,
      asc(catalogSets.supplemental),
      desc(catalogSets.releaseDate),
      asc(catalogItems.number),
      asc(catalogItems.id),
    )
    .get();
  return row ? resolvedFrom(toEntry(row)) : unresolved;
}

function sealedFrom(entry: CatalogEntry): ResolvedSealedProduct {
  return {
    productName: entry.name,
    productNameNormalized: entry.nameNormalized,
    setCode: entry.setLabel,
    uuid: entry.id,
    category: entry.category,
    subtype: null,
    marketUrl: tcgplayerProductUrl(entry.id),
    language: entry.language === 'ja' ? 'ja' : null,
    resolved: true,
  };
}

/**
 * Resolve a typed or picked sealed product. A pick (`id:501256`) is looked up
 * exactly; a typed name matches the product's full name, narrowed by the set
 * and language if given. A name two sets share can't say which, so the English
 * one in the newest set wins (a picked suggestion never has that problem). A
 * miss is the free-text result the sealed commands still post, with no link.
 */
export function resolveCatalogSealed(
  game: string,
  input: string,
  options: { setCode?: string | null; language?: ListingLanguage | null } = {},
): ResolvedSealedProduct {
  const typedName = input.trim();
  const unresolved: ResolvedSealedProduct = {
    productName: typedName,
    productNameNormalized: normalizeCardName(typedName),
    setCode: options.setCode && !catalogPickId(options.setCode) ? options.setCode.trim() : null,
    uuid: null,
    category: null,
    subtype: null,
    marketUrl: null,
    resolved: false,
  };

  const pickedId = catalogPickId(input);
  if (pickedId) {
    const entry = findCatalogEntry(game, 'sealed', pickedId);
    return entry
      ? sealedFrom(entry)
      : { ...unresolved, productName: '', productNameNormalized: '' };
  }

  const typed = normalizeCardName(typedName);
  if (!typed) {
    return unresolved;
  }
  const wanted = catalogLanguage(options.language);
  const row = getDb()
    .select(entryColumns)
    .from(catalogItems)
    .innerJoin(catalogSets, joinSets)
    .where(
      and(
        eq(catalogItems.game, game),
        eq(catalogItems.kind, 'sealed'),
        eq(catalogItems.nameNormalized, typed),
        wanted ? eq(catalogItems.language, wanted) : undefined,
        options.setCode ? setCondition(options.setCode) : undefined,
      ),
    )
    .orderBy(
      sql`(${catalogItems.language} = 'en') desc`,
      asc(catalogSets.supplemental),
      desc(catalogSets.releaseDate),
      asc(catalogItems.id),
    )
    .get();
  return row ? sealedFrom(toEntry(row)) : unresolved;
}

/** What `/search` needs from a typed or picked card name. */
export function catalogSearchTarget(game: string, value: string): SearchTarget | null {
  const pickedId = catalogPickId(value);
  if (pickedId) {
    const entry = findCatalogEntry(game, 'card', pickedId);
    return entry
      ? { displayName: baseProductName(entry.name), searchKey: entry.baseNormalized }
      : null;
  }
  const displayName = value.trim();
  return { displayName, searchKey: normalizeCardName(displayName) };
}

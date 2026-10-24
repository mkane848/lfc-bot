> **Status: Phase 0 done; PRs 1–4 implemented (PR 5, Pokémon sealed product, is next).** Written 2026-10-23 against `main` at
> `9060ae9` (v1.6.2); Phase 0 ran on 2026-10-24 and its results are in §11. **Phase 0 changed the
> plan:** TCGCSV alone is the source of record for Pokémon singles and sealed product (English
> and Japanese), and TCGdex is no longer used. Sections amended after Phase 0 are marked
> *(amended after Phase 0)*; where §11 and an unamended sentence disagree, §11 wins.

# Multi-Game Support: Pokémon Cards and Sealed Product

This is a handoff document: a fresh session should be able to pick it up from here. It follows
the shape of [`SEALED_PRODUCT_PLAN.md`](./SEALED_PRODUCT_PLAN.md) (shipped in PR #67), which is
the best precedent in the repo for adding a second data source.

## 0. Start here (next session) *(amended after Phase 0)*

1. Read §2 (decisions), §3 (what exists in the code) and §11 (verified facts).
2. Phase 0 is done (§5, §11). The only hosts the Pokémon work needs are `tcgcsv.com` (the sync)
   and, at render time only, `tcgplayer.com` links and `tcgplayer-cdn.tcgplayer.com` images,
   which Discord and members fetch, not the bot. Re-run the §5 probes if you suspect the
   source has changed shape; if `tcgcsv.com` returns `403` on `CONNECT`, stop and tell the user.
3. Decisions **A–E in §2** are recommendations, not agreements: the user asked for the plan to
   be implemented but has not individually confirmed them. Work proceeds on them as written, and
   each PR description says so, so the user can redirect on review before anything merges.
4. Implement in the PR order in §9, one PR at a time.

## 1. Context

LFCbot is MTG-only: Scryfall for singles, MTGJSON for sealed product, Mana Pool for links. The
goal is Pokémon singles **and** sealed product, with commands that behave the same across
games, and each server's admin choosing which games the bot supports. Optional form fields
should favour what is common to major card games rather than Pokémon-specific extras.

**Prior art in the repo: none for Pokémon.** A search of the tree and git history found no
Pokémon design. The only mentions are three sentences saying the `game` column "leaves room
for other games": `docs/FAQ.md:123`, `README.md:11`, `HANDOFF.md:20`.

## 2. Decisions

### Confirmed by the user

1. **No per-game commands.** Admins choose games per server with `/admin games`; `/have`,
   `/want`, `/have-sealed`, `/want-sealed`, `/have-multi`, `/want-multi`, `/search` and
   `/edit` all become game-aware.
2. **Optional fields favour universal ones:** language, grade, finish, set, collector number,
   condition. Game-specific extras (1st Edition, stamps, energy type) go in `notes`.
3. **Free data sources only:** TCGdex for cards, TCGCSV for sealed product and TCGplayer
   product ids.
4. **v1 scope:** English singles, sealed product, Japanese and other languages, graded slabs
   (PSA/BGS/CGC).

### Recommended by the planner — **unconfirmed, confirm with the user first**

| # | Decision | Why |
|---|---|---|
| A | **Game resolution:** (1) a game-tagged autocomplete pick wins; (2) else the optional `game` option; (3) else the server's first enabled game; reject if that game isn't enabled. With more than one game enabled, card/sealed autocomplete merges all games and **tags every value** (`mtg:Black Lotus`, `pkm:card:sv03-125`). With one game enabled, values and labels are byte-identical to today. | Discord can't make an option conditional on another, and an optional `game` has to sit after the required options, so the member hasn't chosen a game when they start typing the name. Tagging the value is the only way to know. |
| B | **Graded slabs:** add `graded` as a `condition` value, plus one optional `grade` string such as `PSA 10`, validated against a company list (PSA, BGS, CGC, SGC, TAG, ACE). `grade` is required if and only if condition is `graded`. Stored as `grading_company` + `grade`. | Keeps `/have`'s **required** `condition` intact. The sealed plan (§2 #2) rejected demoting it to optional as a regression for existing members. |
| C | **Language is a listing attribute** (`listings.language`, default `en`), not a separate command or a catalog dimension, unless Phase 0 shows the sources give English names for Japanese printings (§10 risk 2). | Per-language catalogs multiply sync size and autocomplete ambiguity. As an attribute it also works for MTG immediately. |
| D | **Generic column names:** rename `listings.manapool_url` → `market_url` and `listings.sealed_uuid` → `catalog_id`, as a mechanical PR of its own. The link label ("Manapool" / "TCGplayer") comes from the game. `card_cache` stays MTG-only and is not touched. | Otherwise a Pokémon listing stores its TCGplayer link in a `manapool_` column. About 89 mechanical hits across `src/` and `tests/`. |
| E | **Game lifecycle:** new servers keep `["mtg"]`, so **Pokémon is opt-in and upgrading changes nothing for anyone.** Disabling a game hides its active listings from search and digests (they are not deleted) and the last remaining game can't be disabled. | Zero-regression deploy. |

## 3. What exists in the code today

Seams already in place:

- `listings.game` and `servers.enabled_games` (default `["mtg"]`) are in the schema, but
  **nothing reads `enabled_games`.**
- `GAME_LABELS` and `SUPPORTED_GAMES` (`src/utils/constants.ts:101,153`).
- `src/commands/admin/games.ts` is fully written but **deliberately not registered** in
  `src/commands/admin/admin.ts` (see the last bullet of `AGENTS.md` "Behavior Notes"). That note
  says to register it once `enabledGames` is enforced; this work does exactly that, and the note
  must be rewritten when it lands.

Hardcodes to remove:

- `game: 'mtg'` in `have.ts:133`, `want.ts:139`, `have-sealed.ts:96`, `want-sealed.ts:96`,
  `have-multi.ts:135,164`, `want-multi.ts:133,161`, and the default at `listings.ts:28`.
- Scryfall-only card autocomplete and resolution (`src/utils/cards.ts`:
  `handleCardAutocomplete`, `handleSetAutocomplete`, `resolveCardForCommand`).
- "Manapool" baked into `listingManapoolUrl` and `digestLine` (`src/utils/embeds.ts:46,123`).
- `normalizeCardName` (`src/utils/validation.ts:141`) is applied to every search key, regardless of game.
- The edit modal is already at Discord's five-row cap for cards (`edit.ts:61-129`), and the
  set-change branch only knows cards and MTG sealed (`edit.ts:182-224`).

Reusable patterns (copy these, don't reinvent):

- Catalog sync: `syncSealedCatalog` in `src/services/sealed.ts` (cheap version check first, one
  transaction, never throws, a zero-row response counts as failure), with its scheduler hook
  (`scheduler.ts:77`), boot warm-up (`ready.ts:32`) and `stopAllJobs`.
- Autocomplete values that carry an exact id: `SEALED_PRODUCT_CHOICE_PREFIX` /
  `sealedProductChoiceUuid` in `constants.ts`.
- Locally built fallback links: `buildManapoolUrl` in `src/utils/manapool.ts`.
- Display labels with a loose map instead of an exhaustive one: `formatSealedType`.

## 4. Data sources *(amended after Phase 0: TCGCSV is the source of record; see §11)*

| Source | Finding | Status |
|---|---|---|
| **pokemontcg.io API** | The `PokemonTCG/pokemon-tcg-data` README says the project "is being deprecated", is "no longer recommended for new integrations", and "is scheduled to be taken offline on **March 1, 2027**", naming Scrydex as the successor. Scrydex's own FAQ only says an end-of-life "will be announced". **Do not build on it.** | Read from the README; the date is the README's claim |
| **Scrydex** | Official successor, covers Pokémon, Lorcana, MTG, One Piece, Gundam, Riftbound. **Paid only:** Starter is $29/month for 5,000 credits, 100 req/s, no free tier or trial found. Rejected because every self-hoster of this MIT bot would need a plan, and its caching terms are unread. | Search-result summary of scrydex.com/pricing; not read directly |
| **TCGdex** | MIT-licensed database, REST API at `api.tcgdex.net/v2`, no API key, multilingual. Live and healthy (the "dead" directory listing was wrong). | **Probed, not chosen.** Its Japanese catalog has Japanese names, it exposes no TCGplayer id outside a per-card detail call, and TCG Pocket sets aren't flagged in bulk lists. Details in §11 |
| **TCGCSV** | Free community mirror of TCGplayer's catalog at `tcgcsv.com`, refreshed daily around 20:00 UTC. Hierarchy: categories → groups (sets) → products (cards **and** sealed). Pokémon is category `3`, Pokémon Japan is `85`. Prices are a separate file joined by `productId`; no SKU-level data, so no per-condition prices. | **Verified 2026-10-24, chosen as the single source** for singles and sealed, English and Japanese |

Mana Pool is MTG-only, so Pokémon links are TCGplayer links.

## 5. Phase 0: verify before writing Pokémon code (gate) *(done 2026-10-24; results in §11)*

The probes below are kept so they can be re-run. Allowlisted hosts: `api.tcgdex.net`, `tcgcsv.com`, plus `tcgdex.dev` (docs and terms) and
`assets.tcgdex.net` (card images; this hostname is from memory, so confirm it).

```sh
curl -sS -m 20 -D - "https://api.tcgdex.net/v2/en/sets" | head -60
curl -sS -m 30 "https://api.tcgdex.net/v2/en/cards" | head -c 3000
curl -sS -m 20 "https://tcgcsv.com/tcgplayer/categories" | head -c 3000
curl -sS -m 20 "https://tcgcsv.com/tcgplayer/3/groups" | head -c 3000
```

Read response headers too (`ETag`, `Last-Modified`, `Cache-Control`). Questions to answer and record:

**TCGdex**
- Does one bulk `GET /v2/{lang}/cards` return id, localId, name and image for every card, and how large is it?
- Can a card's set be derived from its id? If set ids can contain hyphens (the author recalls promo/trainer-kit sets like `tk-xy-b`, unverified), a naive split on `-` is unsafe; prefer a longest-prefix match against `/sets`.
- Does `/sets` give the PTCGL abbreviation (the code players type, e.g. `OBF`), card counts and release date?
- How are digital-only TCG Pocket cards identified, so they can be excluded (the Scryfall `game:paper` analogue)?
- Image URL scheme and file format, and whether Discord accepts it as an embed thumbnail.
- Does a card expose a TCGplayer product id?
- Rate limits, attribution requirement, and the status endpoint.

**TCGCSV**
- Exact JSON shapes for categories, groups and products; payload sizes.
- How sealed product is told apart from singles (does `extendedData` carry Number/Rarity only for singles?).
- The Japanese category id, and whether Japanese products carry **English names**.
- Conditional-request support (`ETag` / `If-Modified-Since`) for a cheap sync check.
- **Terms of use.** The Mana Pool lesson applies (`SEALED_PRODUCT_PLAN.md` header, `src/services/manapool.ts`): store identity data only (ids, names, set, category), never prices or stock, and never mirror content beyond what the listing flow needs.

**Decision point.** If TCGCSV alone supplies singles with English names for both English and Japanese product, plus exact TCGplayer product ids, make it the source of record for singles and keep TCGdex only for set abbreviations and images. That would give every listing an exact link and remove the Japanese-name problem in §10.

If the hosts still can't be reached, Phases 1 and 2 of §9 are offline-testable and can proceed.

## 6. Architecture *(catalog, sync, links and name handling amended after Phase 0; see §11)*

**`src/games/` registry.** A small `GameDefinition` per game: `id`, `label`, `marketLabel`, allowed finishes, whether `variant` applies, and four functions: `autocompleteItems`, `autocompleteSets`, `resolveCard`, `resolveSealed`.

- `mtg.ts` wraps the existing `scryfall.ts` and `sealed.ts` with **no behaviour change**.
- `pokemon.ts` is backed by the local catalog below.
- `src/utils/listing-options.ts` holds `addUniversalOptions(builder)` (adds `game`, `language`, `grade`) and `readUniversalOptions(interaction)`, so six commands don't each copy the validation. `resolveCardForCommand` and `handleCardAutocomplete` dispatch through the registry.

**Catalog.** Two generic tables for any non-MTG game, both filled by one TCGCSV sync (§11).

`catalog_sets` is one row per TCGCSV group. Primary key `(game, language, id)`, where `id` is the `groupId`. **Set codes are not identifiers** (they repeat, can be empty, and can contain spaces or colons; §11), so sets are always referred to by `groupId` internally and the code is display and search text only.

| Column | Notes |
|---|---|
| `game`, `language`, `id` | `id` is the TCGCSV `groupId` |
| `name`, `code` | `name` has the `"SV03: "` prefix trimmed; `code` is TCGplayer's abbreviation, possibly empty |
| `release_date` | from `publishedOn`; orders "newest set first" |
| `supplemental` | TCGCSV `isSupplemental`; autocomplete prefers non-supplemental sets when a typed code is ambiguous |
| `etag` | the group's `products` response ETag, so the next sync can send `If-None-Match` |

`catalog_items` is one row per product. Primary key `(game, kind, language, id)`.

| Column | Notes |
|---|---|
| `game`, `kind` (`card`/`sealed`), `language`, `id` | `id` is the TCGCSV `productId` as text |
| `name`, `name_normalized` | `name` is display text with the redundant `" - 125/197"` or `" (24)"` suffix removed; the key is made by the Pokémon-safe normalizer (§6, name handling) |
| `set_id` | the `catalog_sets.id` (a `groupId`) |
| `number` | the collector number's numerator as printed (`125`, `H25`, `TG01`); the `/197` denominator is dropped |
| `category` | sealed only; filled by the classifier in PR 5 |
| `updated_at` | |

There is **no `image_url` or `url` column:** every product's image is `https://tcgplayer-cdn.tcgplayer.com/product/<id>_200w.jpg` and every link starts `https://www.tcgplayer.com/product/<id>/`, so both are derived from `id` (63,623 of 63,623 products checked).

Indexes: `(game, kind, name_normalized)` and `(game, kind, set_id)`. Add `catalog_sync_meta(source PK, fingerprint, synced_at)`, generalizing `sealed_catalog_meta`. MTG's `sealed_cache` and `sealed_catalog_meta` are **left untouched.**

**Sync.** Follows TCGCSV's published usage guidelines (§11), mirroring `syncSealedCatalog` where they agree: fetch `last-updated.txt` first and stop if it is unchanged since the last good sync; otherwise fetch the groups for categories `3` and `85`, then each group's products with `If-None-Match` (a `304` skips the group). A custom `User-Agent`, at least 100 ms between requests, never throws, and a payload with zero products is a failure rather than an import. Rows are replaced per group in one transaction each, so a mid-sync failure leaves every other group intact. Daily cron (TCGCSV rebuilds around 20:00 UTC, so run later than that) plus a fire-and-forget boot warm-up gated on a staleness check, wired next to the sealed ones. **No live dependency at post time and no request from a user-facing path:** the catalog carries everything a listing needs, so if TCGCSV is down, autocomplete and posting keep working from the last catalog. The first sync is about 681 requests and 74 MB; later ones are `last-updated.txt` plus up to 683 conditional requests that mostly return `304`.

**Autocomplete.** Match whitespace-separated tokens (AND) across name + set code + set name + number, so `pikachu obf 025` works. Cards repeat across hundreds of printings, so order newest set first and label each choice `Name · SET number` (plus `· JA` for Japanese). The value carries the exact id, like `uuid:` does for MTG sealed. Labels and values stay within Discord's 100-character cap, 25 choices.

**Links.** `https://www.tcgplayer.com/product/<id>`, built from the product id, which every catalog row has, so the "search URL" fallback of the original plan is not needed. Never store prices or stock. *Caveat:* this short form is a prefix of the canonical URLs TCGCSV returns, but `www.tcgplayer.com` was unreachable from the verification session, so that it redirects is expected, not verified.

**Sealed product.** From the same TCGCSV sync (sealed products are the ones with no `Number`). Derive `category` with a keyword classifier over the product name (Booster Box, Elite Trainer Box, Booster Bundle, Tin, Collection, Build & Battle, …), falling back to `other`, with an override map in the style of `SEALED_TYPE_LABEL_OVERRIDES`. Product names are not unique across sets, so choices are `Name (SET)` with an id-carrying value, exactly as MTG sealed does.

**Universal fields.**

| Field | Applies to | Notes |
|---|---|---|
| `game` | all | optional, choices from the registry; see decision A |
| `language` | all | optional; en, ja, de, fr, it, es, pt, ko, zh-cn, zh-tw, ru; default `en` |
| `condition` | cards | existing choices plus `graded` |
| `grade` | cards | e.g. `PSA 10`; required iff condition is `graded` |
| `finish` | cards | existing `nonfoil`/`foil`/`etched` plus `reverse` (Reverse Holo); Pokémon "holo" maps to `foil`; reject `etched` for Pokémon and `reverse` for MTG |
| `set`, `collector_number`, price, quantity, notes | existing | unchanged |
| `variant` | MTG only | rejected with a clear message for other games |

**Rendering.** Embeds gain `Language` (when not English) and `Grade` fields, and a game tag only when the server has more than one game. Digest and `/search` lines show `PSA 10` and `JA`. The link label follows the game. `/search` gets an optional `game` filter.

**`/edit`.** The modal can't take another row. Let the existing `condition` row accept either a raw condition or a grade string (`PSA 10`); language is immutable after posting (document it). The set-change branch dispatches on `listing.game`.

**Name handling.** `normalizeCardName` collapses `Nidoran♀` and `Nidoran♂` to the same key `nidoran`. Map `♀` → `f` and `♂` → `m` before stripping (no MTG card uses them, so existing keys are unaffected). TCGCSV already spells them `Nidoran F` and `Nidoran M`, so the catalog keys are `nidoran f` / `nidoran m`, and a member who types the symbol still lands on the same key.

TCGCSV product names need light cleaning (§11): the product's own number as a suffix (`" - 202/165"`) is stripped because the number is its own column (other ` - ` suffixes are kept), and a trailing parenthetical is stripped **only when it just repeats the card number** (`Piloswine (24)` with number `024/144`). Parentheticals that name a printing (`(Poke Ball Pattern)`, `(Cosmos Holo)`, `(Mirror Holofoil)`, `(Full Art)`) are kept: they are real, distinct products and they are the only thing telling two printings of one number apart in autocomplete. `cleanName` is not used (it strips punctuation, e.g. `Aarons Collection`).

The edit modal's set field has `setMaxLength(10)` (`edit.ts:95`); TCGCSV set codes are at most 10 characters (English) and 8 (Japanese), so typed codes fit, but codes are ambiguous and sometimes empty, so the set autocomplete value carries the `groupId` instead (§6, Catalog). `validateCollectorNumber` allows `[A-Za-z0-9★-]` up to 20 characters, and 56,000 of 56,017 catalog numerators pass it as is (the exceptions are a handful of promo labels such as `PW 1` and `Recommended Rules No. 2`); catalog-picked numbers are not re-validated, only typed ones are.

## 7. Tests

Follow the repo conventions: `setupTestDb()`, the builders in `tests/helpers/interaction.ts`, explicit `.mockReset()` in `beforeEach`, and keep mock-interaction assertions under `tests/commands/` (the ESLint carve-out is narrow; see `.claude/skills/steward/SKILL.md`).

- **Foundation:** game-resolution matrix (tagged / `game` option / default / disabled game / last game); `/admin games` (no test file exists: add `tests/commands/admin/games.test.ts`); graded validation in both directions; finish-per-game rules; with one game enabled, autocomplete output equals today's; a migration smoke test on a pre-migration DB copy.
- **Pokémon:** catalog sync from small fixtures (upsert, vanished rows removed, malformed or zero-row payload leaves the catalog intact, fingerprint skip); token-AND autocomplete and the 25 cap; label length ≤ 100; the Nidoran pair stays distinct; sealed classifier over real product names; the link builder; no network call at post time.
- Fixtures that spell out every column need the new ones: `tests/db/schema.test.ts`, `tests/services/listings.test.ts`, `tests/services/scheduler.test.ts`.

## 8. Verification (every PR)

```sh
npm run lint && npm run format:check && npm run type-check
env -u MANAPOOL_API_KEY npm test     # a set key breaks a scryfall test; see the steward skill
npm run db:check                     # PRs that touch the schema
```

Then a manual pass in a test guild (`DISCORD_GUILD_ID`): enable Pokémon with `/admin games`; `/have` a raw card, a graded slab and a Japanese card; `/have-sealed`; `/search` with and without `game`; `/edit`; a manual digest; and confirm an MTG-only server behaves exactly as before. Run a real catalog sync twice: the second must be a no-op.

Docs to update as the work lands: `CHANGELOG.md` (per PR), `README.md`, `docs/FAQ.md:123`, `docs/index.md`, `HANDOFF.md`, `AGENTS.md` (the `/admin games` note and the `game: 'mtg'` hardcode notes), `/help`, `.env.example`, and `PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md` and `docs/*.html` wherever they name Scryfall, MTGJSON or Mana Pool as data sources.

## 9. Delivery: five PRs *(amended after Phase 0)*

PR 1 merged as #113; the Phase 0 results in §11 ship as a follow-up docs PR. PRs 2–5 are stacked in
order, each opened against the previous branch until the one below it merges.

| PR | Branch | Content |
|---|---|---|
| 1 | `docs/multi-game-plan` | This document (merged), then `docs/multi-game-verified-facts` with §11. |
| 2 | `refactor/generic-market-columns` | The decision-D renames. **drizzle-kit asks interactively whether a column was renamed and can emit DROP + ADD instead, which would lose data. Inspect the generated SQL and hand-edit it to `ALTER TABLE … RENAME COLUMN`**, update the snapshot consistently, and test against a pre-migration DB copy. No behaviour change. |
| 3 | `feature/multi-game-foundation` | Registry and MTG adapter; register and enforce `/admin games`; the game-resolution rule; `language`, `grade`, graded condition and `reverse` finish (a migration adding the three new `listings` columns); rendering; `/search game`; `/edit`. Pokémon is not yet selectable. Release as 1.7.0. |
| 4 | `feature/pokemon-cards` | `catalog_sets`, `catalog_items` and the TCGCSV sync (it stores both kinds, because a group's `products` file holds singles and sealed together), Pokémon card provider, autocomplete, links, and `SUPPORTED_GAMES` gains `'pokemon'`. |
| 5 | `feature/pokemon-sealed` | Sealed classifier and the sealed provider behind `/have-sealed` and `/want-sealed`, product links. No new sync. |

Each PR is a minor-version candidate under the release flow in `AGENTS.md` / `CONTRIBUTING.md`.

## 10. Risks and out of scope

| # | Risk | Mitigation |
|---|---|---|
| 1 | ~~TCGdex and TCGCSV shapes and terms may differ from what is assumed.~~ **Resolved by Phase 0 (§11).** Residual: TCGCSV can change its shape. | The sync treats a malformed or empty payload as a failure and keeps the old rows. |
| 2 | ~~Japanese printings may lack English names.~~ **Resolved:** TCGCSV's Pokémon Japan category (`85`) has English names for every product (0 of 30,741 non-ASCII). | Language stays a listing attribute and also a catalog dimension (`ja` rows). Other languages (de, fr, ko, …) have no catalog, so they are free-text listings with a warning. |
| 3 | ~~TCGdex availability.~~ **Moot:** TCGdex is not used. TCGCSV availability replaces it. | The catalog is local; a failed sync keeps the old rows. |
| 4 | TCGCSV is a community mirror of TCGplayer data. Terms read in Phase 0: permission implicit, no attribution required, but strict request etiquette (§11). | Identity fields only, no prices or stock; honour the usage guidelines in the sync. |
| 5 | Merged autocomplete exceeds Discord's 3-second window. | Local catalogs answer synchronously; the Scryfall call keeps its 2.5 s deadline and is dropped, not awaited, when late. |
| 6 | Schema renames lose data. | PR 2 inspects the SQL and tests against a pre-migration copy. |
| 7 | **TCGplayer and its image CDN were unreachable from the verification session**, so the short product URL and the `_200w.jpg` image are derived from TCGCSV's own `url` / `imageUrl` patterns but never fetched. | Both patterns held for 63,623 of 63,623 products. Check the first real embed in a test guild. |
| 8 | Set codes are not unique or reliable (§11). | Sets are identified by `groupId`; codes are search and display text only. |

**Out of scope for v1:** storing prices or stock anywhere; Pokémon-specific fields (1st Edition, stamps, energy type); editing a listing's language; a catalog for languages other than English and Japanese (TCGplayer has no category for them); a Scrydex adapter; a TCGdex adapter; other games (the registry is the seam for them).

## 11. Verified facts (Phase 0, 2026-10-24)

Probed from the planning session with `curl` through the environment proxy. `api.tcgdex.net`, `assets.tcgdex.net` and `tcgcsv.com` resolved (HTTP 200). `api.pokemontcg.io`, `www.tcgplayer.com` and `tcgplayer-cdn.tcgplayer.com` did not (`403` on `CONNECT`). Raw responses were not committed; every number below came from them and can be reproduced with the §5 probes.

### TCGCSV (the chosen source)

**Shapes.** All responses are `{ totalItems, success, errors, results }`.

- `GET /tcgplayer/categories`: 94 categories. Pokémon is `categoryId` `3`, **Pokémon Japan is `85`**. No other Pokémon-language category exists.
- `GET /tcgplayer/{cat}/groups`: `results[]` of `{ groupId, name, abbreviation, isSupplemental, publishedOn, modifiedOn, categoryId }`. 220 English groups, 461 Japanese.
- `GET /tcgplayer/{cat}/{groupId}/products`: `results[]` of `{ productId, name, cleanName, imageUrl, categoryId, groupId, url, modifiedOn, imageCount, presaleInfo, extendedData[{ name, displayName, value }] }`.
- `GET /last-updated.txt`: one timestamp, e.g. `2026-10-23T20:06:07+0000`.

**Volume.** 63,623 products over 681 group files, about 74 MB uncompressed (38 MB English, 36 MB Japanese). English: 32,882 products (28,068 singles, 4,814 sealed). Japanese: 30,741 (27,949 singles, 2,792 sealed). A single group file is about 100 to 300 KB.

**Sealed vs single.** `extendedData` has a `Number` entry for every single and for no sealed product (checked on all 63,623 products). Sealed items include booster packs and boxes, ETBs, blisters, tins, bundles, cases, and `Code Card - …` digital codes.

**Japanese names are English.** 0 of 30,741 Japanese-category product names contain non-ASCII text, and the group names are English too (`M6: Storm Emeralda`, `SV11B: Black Bolt`). This resolves risk 2 and the §5 decision point.

**Names.** `cleanName` strips punctuation (`Aaron's Collection` → `Aarons Collection`, `Tropius - 001/073` → `Tropius 001 073`), so it is unusable for display. `name` carries two kinds of suffix on singles:

- The product's own number as a suffix, `Blastoise ex - 202/165` (14,554 of 56,017 singles: 11,971 at the end of the name and 2,583 before a parenthetical, e.g. `Mr. Mime - 122/165 (Poke Ball Pattern)`). Strip exactly ` - <that product's Number>`; the number is its own field. Do **not** strip other ` - ` suffixes: 4,220 singles use them for something real, such as World Championship deck cards (`… - 2010 (Player Name)`).
- A trailing parenthetical. 1,270 just repeat the number (`Piloswine (24)`, number `024/144`). 10,462 name a distinct printing: `Mirror Holofoil` (1,323), `Poke Ball Pattern` (693), `Master Ball Pattern` (612), `Cosmos Holo` (601), `Full Art` (545), `Secret` (502), … Keep these.

Gendered and punctuated names are already clean: `Nidoran F`, `Nidoran M`, `Farfetch'd`, `Mr. Mime`, `Porygon-Z`.

**Numbers.** Shapes: `125/197` (24,992 English), `H25/H32`, `001/SV-P`, `TG01/TG30`, bare `125`, and a few oddities. Numerator = text before `/`; 56,000 of 56,017 are valid collector numbers as is (exceptions: `PW 1`…`PW 9`, `Recommended Rules No. 1…5`, `!/28`, `?/28`). Maximum `Number` length is 17 (English) and 23 (Japanese).

**Set codes (`abbreviation`) are unreliable.**

| | English | Japanese |
|---|---|---|
| Groups with an empty abbreviation | 4 | 138 |
| Codes shared by more than one group (case-insensitive) | 9 (`PR` is used by 21 groups; `30C`, `CL`, `GEN`, `BKP`, `LTR`, …) | 24 (`SC`, `SA`, `SNP`, `SI`, `SVAM`, `SM1+`, …) |
| Codes containing a colon, space or `+` | `CRZ:GG`, `SWSH12: TG`, `HIF:SV` | `L1: HG`, `SM5+`, `No.PROMO` |
| Maximum length | 10 | 8 |
| Case | upper | mixed (`m6a`, `mEE`) |

Group names carry a code prefix (`SV03: Obsidian Flames`) that should be trimmed for display. 15 English and 5 Japanese groups are `isSupplemental`.

**Links and images.** Every product `url` is `https://www.tcgplayer.com/product/<productId>/<slug>` and every `imageUrl` is `https://tcgplayer-cdn.tcgplayer.com/product/<productId>_200w.jpg` (63,623 of 63,623), including 3,962 products whose `imageCount` is 0. Both can therefore be derived from `productId` and need no column. Neither host was reachable from the sandbox, so the short URL `https://www.tcgplayer.com/product/<id>` (which should redirect to the canonical slug) was not fetched.

**Conditional requests.** Responses come from S3 behind CloudFront and carry `ETag` and `Last-Modified`. `If-None-Match` and `If-Modified-Since` both return `304` (checked on the groups endpoint). The groups file is rebuilt daily; a group's `products` file keeps its `ETag` until its content changes.

**Terms** (`tcgcsv.com/docs#usage-guidelines` and `/faq`):

- Permission is implicit and no attribution is required (a thank-you link is appreciated). Card-game copyright is called a grey area; marketplaces and binder tools generally use images for identification.
- Data updates **once a day around 20:00 UTC**. Check `last-updated.txt` first and run a full sync only when it is newer than the last successful pull.
- Do not request TCGCSV from a user-facing path; read from a stored copy.
- Set a custom `User-Agent` such as `App/X.Y.Z`; generic or missing ones may be blocked.
- Sleep at least 100 ms between requests; exceeding the rate gets the IP throttled for 10 minutes. More than 10,000 requests in 24 hours risks a ban.
- Prices are separate files (`/prices`). This bot never fetches or stores them.

A Pokémon-only English and Japanese sync is 3 requests plus at most 681 group files, well inside the limits.

### TCGdex (probed, not chosen)

- `GET /v2/en/sets`: 220 sets, 35 KB, `{ id, name, logo?, symbol?, cardCount }` only. `GET /v2/en/sets/{id}` adds `releaseDate`, `serie.id`, `tcgOnline` and `abbreviation.official` (the PTCGL code, e.g. `OBF`), but TCG Pocket sets (`serie.id` `tcgp`) have no abbreviation, so it takes a per-set call to tell paper from digital.
- `GET /v2/en/cards`: 23,736 cards, 2.4 MB, `{ id, localId, name, image? }` (1,749 lack an image). A card id is `<setId>-<localId>`; `localId` has no hyphen, so stripping the suffix recovers the set for all 23,736 cards, even though 22 set ids contain hyphens (`tk-xy-b`, `P-A`, `30th-c`). No prefix matching is needed.
- Image URLs have no extension (`https://assets.tcgdex.net/en/sv/sv03/125` returns HTML); append `/high.png`, `/high.webp`, `/low.webp` etc. (`high.png` 360 KB, `high.webp` 123 KB, `low.webp` 31 KB).
- A TCGplayer product id appears only in a per-card detail response (`variants_detailed[].thirdParty.tcgplayer`), which would be 23,736 calls.
- `GET /v2/ja/cards`: 968 KB with **Japanese names** (`モンジャラ`), and different set ids (`PMCG1`, `M1S`).
- There is no `/status` endpoint (`/v2/status` and `/v2/en/status` return 404) and no rate-limit headers; responses are `cache-control: no-cache` with a weak `ETag`.

**Why TCGCSV won:** English names for Japanese product, an exact TCGplayer product id on every row (so every listing gets an exact link), one source for singles and sealed, a documented cheap-sync protocol, and TCG Pocket never appears in it. TCGdex would have needed a second source for sealed and for ids, plus a name-matching step to join them.

### Decisions this changes

- **Source:** TCGCSV only. §4, §6 and §9 are amended above.
- **Decision C (language):** still a listing attribute, but Japanese is also a catalog dimension: a picked `ja` row sets `language` to `ja` for the listing. Other languages stay free-text.
- **PR 4 and PR 5** share one sync, so PR 4 stores both kinds and PR 5 adds the classifier and commands (§9).
- **Decisions A, B, D, E** are unaffected.

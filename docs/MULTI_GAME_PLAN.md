> **Status: planned, not implemented.** Written 2026-10-23 against `main` at `9060ae9` (v1.6.2).
> No code, schema, or test has been changed for this work. The data-source facts in §4 come from
> web search summaries and repository READMEs; **no TCGdex or TCGCSV endpoint has been called
> yet**, because the session that wrote this plan could not reach them. Phase 0 (§5) exists to
> close that gap and **must finish before any Pokémon code is written.**

# Multi-Game Support: Pokémon Cards and Sealed Product

This is a handoff document: a fresh session should be able to pick it up from here. It follows
the shape of [`SEALED_PRODUCT_PLAN.md`](./SEALED_PRODUCT_PLAN.md) (shipped in PR #67), which is
the best precedent in the repo for adding a second data source.

## 0. Start here (next session)

1. Read §2 (decisions) and §3 (what exists in the code).
2. **Run Phase 0 (§5).** The environment allowlist has been updated for `api.tcgdex.net` and
   `tcgcsv.com`; confirm both resolve with `curl` before anything else. If they still return
   `403` on `CONNECT`, the allowlist change hasn't reached the session: stop and tell the
   user, naming the host. Do not mock results.
3. Append the results to this file as a "Verified facts" section (as the sealed plan did),
   amending §4, §6 and §8 wherever reality differs from what is assumed here.
4. Put decisions **A–E in §2** to the user before building. They are recommendations, not
   agreements.
5. Then implement in the PR order in §9, one PR at a time.

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

## 4. Data sources

| Source | Finding | Status |
|---|---|---|
| **pokemontcg.io API** | The `PokemonTCG/pokemon-tcg-data` README says the project "is being deprecated", is "no longer recommended for new integrations", and "is scheduled to be taken offline on **March 1, 2027**", naming Scrydex as the successor. Scrydex's own FAQ only says an end-of-life "will be announced". **Do not build on it.** | Read from the README; the date is the README's claim |
| **Scrydex** | Official successor, covers Pokémon, Lorcana, MTG, One Piece, Gundam, Riftbound. **Paid only:** Starter is $29/month for 5,000 credits, 100 req/s, no free tier or trial found. Rejected because every self-hoster of this MIT bot would need a plan, and its caching terms are unread. | Search-result summary of scrydex.com/pricing; not read directly |
| **TCGdex** | MIT-licensed database (`github.com/tcgdex/cards-database`), REST API at `api.tcgdex.net` (use **v2**; v1 has been unsupported since Feb 2021), docs at `tcgdex.dev`, no API key, multilingual (en, fr, es, de, it, pt, plus Asian languages), SDKs for JS/TS/PHP/Java. One third-party directory listed it as "dead" in April 2026, which contradicts the live repo and docs pages. | **Response shapes unverified.** Hit its `/status` in Phase 0 |
| **TCGCSV** | Free community mirror of TCGplayer's catalog at `tcgcsv.com`, refreshed daily around 20:00 UTC. Hierarchy: categories → groups (sets) → products (cards **and** sealed). Pokémon is category `3`. Prices are a separate file joined by `productId`; no SKU-level data, so no per-condition prices. | **Sealed-vs-single flag, Japanese category id and terms of use unverified** |

Mana Pool is MTG-only, so Pokémon links are TCGplayer links.

## 5. Phase 0: verify before writing Pokémon code (gate)

Allowlisted hosts: `api.tcgdex.net`, `tcgcsv.com`, plus `tcgdex.dev` (docs and terms) and
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

## 6. Architecture

**`src/games/` registry.** A small `GameDefinition` per game: `id`, `label`, `marketLabel`, allowed finishes, whether `variant` applies, and four functions: `autocompleteItems`, `autocompleteSets`, `resolveCard`, `resolveSealed`.

- `mtg.ts` wraps the existing `scryfall.ts` and `sealed.ts` with **no behaviour change**.
- `pokemon.ts` is backed by the local catalog below.
- `src/utils/listing-options.ts` holds `addUniversalOptions(builder)` (adds `game`, `language`, `grade`) and `readUniversalOptions(interaction)`, so six commands don't each copy the validation. `resolveCardForCommand` and `handleCardAutocomplete` dispatch through the registry.

**Catalog.** One generic table, `catalog_items`, for any non-MTG game. Primary key `(game, kind, language, id)`.

| Column | Notes |
|---|---|
| `game`, `kind` (`card`/`sealed`), `language`, `id` | `id` is the source id (TCGdex id or TCGCSV `productId`) |
| `name`, `name_normalized` | normalized with the Pokémon-safe normalizer (§6, name handling) |
| `set_id`, `set_code`, `set_name` | `set_code` is what members type and see (PTCGL abbreviation where one exists) |
| `number` | collector number |
| `category`, `subtype` | sealed only |
| `image_url`, `market_product_id`, `release_date`, `updated_at` | |

Indexes: `(game, kind, name_normalized)` and `(game, kind, set_code)`. Add `catalog_sync_meta(source PK, fingerprint, etag, synced_at)`, generalizing `sealed_catalog_meta`. MTG's `sealed_cache` and `sealed_catalog_meta` are **left untouched.**

**Sync.** Mirror `syncSealedCatalog`: a cheap fingerprint or version check first, a single transaction, never throws, and a zero-row response is a failure rather than an import. Daily cron plus a fire-and-forget boot warm-up gated on a staleness check, wired next to the sealed ones. **No per-card detail calls and no live dependency at post time:** the index carries everything a listing needs (name, set, number, image), so if a source is down, autocomplete and posting keep working from the last catalog.

**Autocomplete.** Match whitespace-separated tokens (AND) across name + set code + number, so `pikachu sv3 025` works. Cards repeat across hundreds of printings, so order newest set first and label each choice `Name · SET number` (plus `· JA` for non-English). The value carries the exact id, like `uuid:` does for MTG sealed. Labels and values stay within Discord's 100-character cap, 25 choices.

**Links.** Exact `https://www.tcgplayer.com/product/<id>` when a product id is known, otherwise a TCGplayer search URL built locally (the `buildManapoolUrl` pattern). Never store prices or stock.

**Sealed product.** From TCGCSV. Derive `category` with a keyword classifier over the product name (Booster Box, Elite Trainer Box, Booster Bundle, Tin, Collection, Build & Battle, …), falling back to `other`, with an override map in the style of `SEALED_TYPE_LABEL_OVERRIDES`. Product names are not unique across sets, so choices are `Name (SET)` with an id-carrying value, exactly as MTG sealed does.

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

**Name handling.** `normalizeCardName` collapses `Nidoran♀` and `Nidoran♂` to the same key `nidoran`. Map `♀` → `f` and `♂` → `m` before stripping (no MTG card uses them, so existing keys are unaffected). The edit modal's set field has `setMaxLength(10)` (`edit.ts:95`), and some Pokémon set ids are longer (the old pokemontcg.io id for a Crown Zenith subset is `swsh12pt5gg`, 11 characters; TCGdex's ids may differ). Using the short typed PTCGL abbreviation as `set_code` should avoid the problem, so check the real lengths in Phase 0. `validateCollectorNumber` allows `[A-Za-z0-9★-]` up to 20 characters, which covers `TG01` and `125`; confirm against real data.

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

## 9. Delivery: five PRs

| PR | Branch | Content |
|---|---|---|
| 1 | `docs/multi-game-plan` | This document (plus the Phase 0 "Verified facts" once available). |
| 2 | `refactor/generic-market-columns` | The decision-D renames. **drizzle-kit asks interactively whether a column was renamed and can emit DROP + ADD instead, which would lose data. Inspect the generated SQL and hand-edit it to `ALTER TABLE … RENAME COLUMN`**, update the snapshot consistently, and test against a pre-migration DB copy. No behaviour change. |
| 3 | `feature/multi-game-foundation` | Registry and MTG adapter; register and enforce `/admin games`; the game-resolution rule; `language`, `grade`, graded condition and `reverse` finish (a migration adding the three new `listings` columns); rendering; `/search game`; `/edit`. Pokémon is not yet selectable. Release as 1.7.0. |
| 4 | `feature/pokemon-cards` | `catalog_items` and sync (source per Phase 0), Pokémon provider, autocomplete, links, and `SUPPORTED_GAMES` gains `'pokemon'`. |
| 5 | `feature/pokemon-sealed` | TCGCSV sealed sync, classifier, product links. |

Each PR is a minor-version candidate under the release flow in `AGENTS.md` / `CONTRIBUTING.md`.

## 10. Risks and out of scope

| # | Risk | Mitigation |
|---|---|---|
| 1 | TCGdex and TCGCSV shapes and terms may differ from what is assumed here (nothing is verified). | Phase 0 gate; PRs 2 and 3 don't depend on it. |
| 2 | **Japanese printings may lack English names** in the catalog, making them hard to find by the name a member types. | Language stays a listing attribute; Phase 0 decision point on TCGCSV's Japan category; fallback is a free-text listing with a warning for non-English cards not in the catalog. |
| 3 | TCGdex availability (one directory calls it "dead"). | The catalog is local; a failed sync keeps the old rows. |
| 4 | TCGCSV is a community mirror of TCGplayer data, so terms are unclear. | Identity fields only, no prices or stock; read the terms in Phase 0. |
| 5 | Merged autocomplete exceeds Discord's 3-second window. | Local catalogs answer synchronously; the Scryfall call keeps its 2.5 s deadline and is dropped, not awaited, when late. |
| 6 | Schema renames lose data. | PR 2 inspects the SQL and tests against a pre-migration copy. |

**Out of scope for v1:** storing prices or stock anywhere; Pokémon-specific fields (1st Edition, stamps, energy type); editing a listing's language; per-language catalogs unless Phase 0 supports them; a Scrydex adapter; other games (the registry is the seam for them).

# LFCbot — Technical Reference

> Reference for the current implementation (v1.5.0). This describes what the
> bot actually does today, not a build plan — for what's changed release to
> release, see [CHANGELOG.md](./CHANGELOG.md); for contribution workflow, see
> [CONTRIBUTING.md](./CONTRIBUTING.md); for developer conventions and behavior
> notes, see [AGENTS.md](./AGENTS.md).

## Project Overview

LFCbot is a multi-server Discord bot where users post `/have` and `/want`
listings for trading cards, search for cards other members are offering, and
admins receive configurable digest notifications of new activity. `/have-sealed`
and `/want-sealed` extend the same have/want model to sealed product —
booster boxes, bundles, prerelease kits, and Commander decks — as listings in
the same table, distinguished only by a `kind` column.

Two games are registered. Magic: The Gathering is resolved through the Scryfall
API (singles) and the MTGJSON catalog (sealed product). Pokémon singles (English
and Japanese) are resolved against a local catalog a daily TCGCSV sync fills;
Pokémon sealed product comes from the same catalog, sorted into categories by a
keyword classifier over the product name. Games
sit behind a registry (`src/games/`): every command resolves a game and calls
through its `GameDefinition`, each server chooses which games it has with
`/admin games` (new servers have Magic only), and `listings.game` records which
one a listing belongs to. Adding a game means registering another definition.

**Open source (MIT), designed for small game stores and friend groups.**

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js >=22 (Docker image: `node:24-bookworm-slim`) with TypeScript |
| Discord | discord.js v14 |
| ORM | Drizzle ORM |
| Database | better-sqlite3 |
| Card data | Scryfall API |
| Sealed product catalog | MTGJSON (daily sync, `sealed_cache` table) |
| Pokémon catalog | TCGCSV (daily sync, `catalog_sets` / `catalog_items` tables) |
| Product links | Manapool API (optional) — exact printings for cards, matched products for sealed |
| Scheduler | node-cron |
| Testing | Vitest |
| Linting | ESLint + Prettier |
| CI | GitHub Actions (lint, type-check, test, CodeQL) |

Migrations use generated Drizzle migration files in `src/db/migrations/`.
`drizzle-kit push` is not used as a production migration path.

## Database Schema

Source of truth: `src/db/schema.ts`. All timestamps are Unix milliseconds.

### `servers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Discord guild ID |
| `admin_channel_id` | TEXT, nullable | Channel for digest posts |
| `digest_dm_user_id` | TEXT, nullable | User ID to receive digest DMs |
| `digest_mode` | TEXT, default `disabled` | `disabled`, `channel`, `dm`, or `both` |
| `digest_cron` | TEXT, default `0 9 * * *` | Five-field cron expression |
| `digest_timezone` | TEXT, default `UTC` | IANA timezone name |
| `last_digest_at` | INTEGER, nullable | Watermark used to select new listings |
| `enabled_games` | TEXT, default `["mtg"]` | JSON array of game ids, in the order they were enabled; the first is the game a command uses when the member names none. Managed with `/admin games`; read through `enabledGameIds` in `src/games/server.ts` |
| `removed_at` | INTEGER, nullable | Set when the bot is removed from the guild; row is purged after 30 days |
| `created_at` / `updated_at` | INTEGER | |

### `listings`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `server_id` | TEXT, FK → `servers.id` (cascade delete) | |
| `user_id` | TEXT | Discord user ID of the poster |
| `username` | TEXT | Display name at time of posting |
| `intent` | TEXT, not null | `have` or `want` |
| `accepts` | TEXT, not null | `cash`, `trade`, or `both` — what the poster will take in return |
| `game` | TEXT, default `mtg` | Id of a registered game (`src/games/`). A listing of a game the server has since disabled is kept but hidden from search and digests |
| `language` | TEXT, not null, default `en` | `en`, `ja`, `de`, `fr`, `it`, `es`, `pt`, `ko`, `zh-cn`, `zh-tw` or `ru` (`LISTING_LANGUAGES`). Fixed when the listing is posted |
| `card_name` | TEXT | Canonical name from Scryfall, or raw input on resolution failure |
| `card_name_normalized` | TEXT | Search key (see Search Logic) |
| `card_set` | TEXT, nullable | Scryfall set code |
| `card_image_url` | TEXT, nullable | |
| `finish` | TEXT, nullable | `nonfoil`, `foil`, `etched` or `reverse` (Reverse Holo). Which of these a card can have depends on its game (`GameDefinition.finishes`) |
| `variant` | TEXT, nullable | `extended`, `showcase`, `borderless`, `retro`, or `full` |
| `collector_number` | TEXT, nullable | |
| `market_url` | TEXT, nullable | Link to this printing (card) or product (sealed) on the game's marketplace (Manapool for MTG). Renamed from `manapool_url` in migration 0005 |
| `condition` | TEXT, nullable | `nm`, `lp`, `mp`, `hp`, `dmg` or `graded`. Always null for a sealed listing (`kind: sealed`) |
| `grading_company` | TEXT, nullable | `PSA`, `BGS`, `CGC`, `SGC`, `TAG` or `ACE`; set exactly when `condition` is `graded` |
| `grade` | TEXT, nullable | The grade without the company (`10`, `9.5`); set exactly when `condition` is `graded` |
| `price_cents` | INTEGER, nullable | Asking price for `have`, max price for `want` |
| `kind` | TEXT, not null, default `card` | `card` or `sealed` — see `ListingKind`/`LISTING_KINDS` in `src/types/index.ts` |
| `catalog_id` | TEXT, nullable | Source-catalog id of the matched sealed product (MTGJSON `sealed_cache.uuid` for MTG); null if `kind: card` or the product wasn't in the catalog. Renamed from `sealed_uuid` in migration 0005 |
| `sealed_category` | TEXT, nullable | MTGJSON category (e.g. `booster_box`, `bundle`), rendered for display via `formatSealedType` |
| `sealed_subtype` | TEXT, nullable | MTGJSON subtype, same rendering as `sealed_category` |
| `quantity` | INTEGER, default 1 | 1–99 |
| `notes` | TEXT, nullable | Max 500 characters |
| `status` | TEXT, default `active` | `active`, `fulfilled`, `expired`, or `deleted` (terminal) |
| `expires_at` | INTEGER | `created_at + 30 days` |
| `created_at` / `updated_at` | INTEGER | |

There is no `listing_type` field — `/sell`, `/buy`, and `/trade` were
replaced by the `intent` (`have`/`want`) + `accepts` (`cash`/`trade`/`both`)
model in the 1.3.0–1.4.0 range. `manapool_price_cents` lives only on
`card_cache`, not on `listings`; sealed listings never store a price of any
kind beyond the poster's own `price_cents` ask/max.

Sealed listings are ordinary rows in this table, added in the
0004 migration (`kind` defaulting to `'card'` for every pre-existing row, the
three `sealed_*` columns nullable). Search, digest collection, expiry,
cooldown, `duplicateWarning`, `/fulfill`, and `/delete` all operate on `kind:
sealed` rows with no special-casing, since they key on `card_name_normalized`,
`server_id`, and `status` regardless of `kind`. A card and a sealed product
that happen to share a normalized name are not treated as duplicates of each
other — `duplicateWarning` also matches on `kind`.

Indexes: `(server_id, status, card_name_normalized)` for search,
`(server_id, status, created_at)` for digest collection,
`(server_id, user_id, created_at)` for `/mylistings`.

### `digest_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `server_id` | TEXT, FK → `servers.id` (cascade delete) | |
| `sent_at` | INTEGER | |
| `trigger` | TEXT | `scheduled` or `manual` |
| `listing_count` | INTEGER | |
| `listing_ids_included` | TEXT | JSON array |
| `delivery_results` | TEXT | JSON `{channel: bool, dm: bool}` |

Append-only; not used for deduplication. Digest selection always uses
`servers.last_digest_at`.

### `card_cache`

| Column | Type | Notes |
|--------|------|-------|
| `cache_key` | TEXT PK | `name + set + finish + variant + collector_number` |
| `scryfall_id` | TEXT, nullable | |
| `card_name` | TEXT | |
| `card_name_normalized` | TEXT | |
| `card_set` | TEXT, nullable | |
| `card_image_url` | TEXT, nullable | |
| `collector_number` | TEXT, nullable | |
| `manapool_url` | TEXT, nullable | |
| `manapool_price_cents` | INTEGER, nullable | |
| `resolved` | INTEGER, default 0 | 1 after a successful Scryfall lookup, 0 for a temporary fallback entry |
| `resolved_at` | INTEGER | |
| `expires_at` | INTEGER | `resolved_at + 24h` |

Index: `(card_name_normalized)`.

### `sealed_cache`

| Column | Type | Notes |
|--------|------|-------|
| `uuid` | TEXT PK | MTGJSON product UUID |
| `name` | TEXT | |
| `name_normalized` | TEXT | Search/autocomplete key |
| `set_code` | TEXT | |
| `category` | TEXT, not null | e.g. `booster_box`, `bundle`, `commander_deck` |
| `subtype` | TEXT, nullable | |
| `release_date` | TEXT, nullable | |
| `updated_at` | INTEGER | |

The full MTGJSON sealed-product catalog (roughly 4,000 rows; the exact count
moves with MTGJSON's data), not a per-lookup TTL cache like `card_cache` — it
is replaced wholesale by each successful sync. Backs `/have-sealed` and
`/want-sealed`'s autocomplete and `resolveSealedProduct`'s name/set matching
entirely from local SQLite, with no external request per keystroke. Indexes:
`(name_normalized)`, `(set_code)`.

### `sealed_catalog_meta`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Always `1` — single-row table |
| `build_version` | TEXT, nullable | Last-seen MTGJSON build version |
| `set_list_etag` | TEXT, nullable | ETag of the last-fetched `SetList.json` |
| `synced_at` | INTEGER | Last time the sync reached a definite answer (import, version match, or 304) |

Sync bookkeeping for the daily catalog sync (`syncSealedCatalog`,
`src/services/sealed.ts`). `synced_at` means "last confirmed current," not
"last imported" — it's rewritten on every run that reaches a definite
outcome, so the boot warm-up (`isSealedCatalogStale`) doesn't re-check a
catalog that's already current on every restart. Only a failed run leaves the
row untouched, so a failure can't convince the next run the catalog is fresh.

### `catalog_sets`

| Column | Type | Notes |
|--------|------|-------|
| `game`, `language`, `id` | TEXT, composite PK | `id` is the source's set id (a TCGCSV `groupId`) as text; set codes are not unique, sometimes empty and can contain spaces, so nothing keys on them |
| `name` | TEXT | Set name with the source's `SV01:`-style prefix removed |
| `code` | TEXT, default `''` | Abbreviation members see and type (`OBF`); empty when the source has none |
| `release_date` | TEXT, nullable | Only a real `T00:00:00` date is kept; the source's build-stamped placeholders become null |
| `supplemental` | INTEGER | 1 for a supplemental set, which a typed set code prefers not to land on |
| `etag` | TEXT, nullable | ETag of the set's product list at the last import, for `If-None-Match` |
| `import_version` | INTEGER, default 0 | `IMPORT_VERSION` (`src/services/tcgcsv.ts`) of the importer that wrote the set's products. A set imported by an older one is fetched again without `If-None-Match`, and its presence stops the "nothing new today" shortcut. Added in migration 0008 |
| `updated_at` | INTEGER | |

Index: `(game, code)`.

### `catalog_items`

| Column | Type | Notes |
|--------|------|-------|
| `game`, `kind`, `language`, `id` | TEXT, composite PK | `kind` is `card` or `sealed`; `id` is the source's product id (a TCGCSV `productId`) |
| `name` | TEXT | Display name, with a printing qualifier such as `(Poke Ball Pattern)` kept and the product's own ` - 058/078` suffix removed |
| `name_normalized` | TEXT | Search key for the full name |
| `base_normalized` | TEXT | The name without its trailing parenthetical, normalized; what `listings.card_name_normalized` holds and `/search` matches on, so every printing of a card finds the others |
| `set_id` | TEXT | `catalog_sets.id` |
| `number` | TEXT, nullable | Collector number numerator as printed (`125`, `H25`, `TG01`); null for sealed product and for the older singles TCGplayer never numbered |
| `category` | TEXT, nullable | For sealed product, what the classifier made of the name (`booster_pack`, `booster_box`, `booster_bundle`, `elite_trainer_box`, `blister`, `tin`, `collection`, `deck`, `build_and_battle`, `prerelease_kit`, `case`, `other`); null for cards. Copied to `listings.sealed_category` |
| `updated_at` | INTEGER | |

Holds identity only. Prices and stock are never requested or stored, and a
product's image and TCGplayer link are derived from `id` (`src/utils/tcgplayer.ts`)
rather than stored. Indexes: `(game, kind, name_normalized)`,
`(game, kind, base_normalized)`, `(game, kind, set_id)`. `listings.catalog_id`
holds the product id for a Pokémon listing, `listings.market_url` its TCGplayer
link, frozen at posting like Magic's.

### `catalog_sync_meta`

| Column | Type | Notes |
|--------|------|-------|
| `source` | TEXT PK | `tcgcsv:pokemon` |
| `fingerprint` | TEXT, nullable | TCGCSV's `last-updated.txt` value at the last clean run |
| `synced_at` | INTEGER | Last time a run completed cleanly (import, or nothing to import) |

Written only after a run in which every group imported or came back `304`; a
partial run leaves it alone, so the next run retries instead of trusting a
half-filled catalog.

### `admin_audit_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `server_id` | TEXT, FK → `servers.id` (cascade delete) | |
| `admin_id` / `admin_username` | TEXT | |
| `action` | TEXT | `/admin` subcommand name |
| `details` | TEXT, nullable | JSON snapshot of the invocation's options |
| `created_at` | INTEGER | |

Every `/admin` subcommand invocation is recorded here before its handler
runs, independent of whether the handler succeeds.

## Slash Commands

All commands are guild-only. `/have`, `/want`, `/have-sealed`, `/want-sealed`,
`/have-multi`, `/want-multi` (their success reply), and `/search` responses
are public. `/mylistings`, `/edit`, `/fulfill`, `/delete`, `/help`, and every
`/admin` response are ephemeral.

### User Commands

| Command | Parameters | Behavior |
|---------|-----------|----------|
| `/have` | `card_name`*, `accepts`*, `condition`*, `set?`, `finish?`, `variant?`, `collector_number?`, `price?`, `quantity?` (1–99, default 1), `notes?`, `game?`, `language?`, `grade?` | Posts one card you have. Resolves through the card's game (Scryfall for Magic); rejects with an ephemeral error if unresolvable. `condition: graded` requires `grade` (`PSA 10`, `BGS 9.5`, …), and `grade` is rejected with any other condition. `game` appears only once more than one game is registered. |
| `/want` | `card_name`*, `accepts`*, `set?`, `condition?`, `finish?`, `variant?`, `collector_number?`, `max_price?`, `notes?`, `game?`, `language?`, `grade?` | Posts one card you want. `condition` is the desired condition and is optional; `grade` follows the same rule as `/have`. |
| `/have-sealed` | `product_name`*, `accepts`*, `set?`, `price?`, `quantity?` (1–99, default 1), `notes?`, `game?`, `language?` | Posts sealed product you have. Resolves against the local MTGJSON catalog; unlike `/have`, an unresolved product still posts — with the raw typed name and no Manapool link — rather than being rejected. No `condition`, `finish`, `variant`, or `collector_number` option. |
| `/want-sealed` | `product_name`*, `accepts`*, `set?`, `max_price?`, `notes?`, `game?`, `language?` | Posts sealed product you want. Same catalog-miss behavior as `/have-sealed`. No `quantity` option (defaults to 1). |
| `/have-multi` | `type?`, `game?`, `language?`, then a modal: up to 3 lines `Card Name \| condition \| price \| qty` + `accepts` | Opens a modal to post up to 3 "have" listings in one submission. Each line is resolved and inserted independently; failures are reported per line. The condition column takes a grade (`PSA 10`) for a graded slab. A chosen `game` and `language` ride in the modal's custom ID and apply to every line. |
| `/want-multi` | `type?`, `game?`, `language?`, then a modal: up to 3 lines `Card Name \| condition \| max_price` + `accepts` | Same as above for "want" listings. |
| `/search` | `card_name`*, `intent?` (`have`/`want`), `accepts?` (`cash`/`trade`/`both`), `game?`, `page?` | Searches active listings, 10 per page, newest first. Searches every game the server has enabled; a picked suggestion's game or `game` narrows it to one. |
| `/mylistings` | `page?` | Shows the caller's own active listings (2 per page) with per-listing Fulfill/Delete buttons, plus batch-delete, batch-fulfill, and batch-edit select menus covering their most recent 25 active listings. |
| `/edit` | `listing_id`*, then a modal (`condition`, `price`, `quantity`, `set`, `notes`, all optional) | Owner-only. The `condition` row takes a raw condition or a grade (`PSA 10`, meaning graded); language can't be edited. If `set` changes, re-resolves the listing through its own game's catalog (Scryfall for a Magic card, the sealed catalog for `kind: sealed`) and updates the resulting fields (`card_name`, `card_image_url`, `collector_number`, `market_url` for a card; `card_name`, `market_url`, and the three `sealed_*` columns for sealed product) to match. The modal for a sealed listing omits the `condition` row entirely — sealed product is NM by definition. A card set-resolution failure aborts the edit with an error; a sealed catalog miss does not — it writes the free-text result, matching how `/have-sealed`/`/want-sealed` creation behaves. |
| `/fulfill` | `listing_id`* | Owner-only. Sets `status: fulfilled`. |
| `/delete` | `listing_id`* | Owner-only. Sets `status: deleted`. |
| `/help` | — | Static command summary. |

`*` = required. Card names use Discord autocomplete backed by Scryfall;
sealed product names and set codes use autocomplete backed entirely by the
local `sealed_cache` table. If a submitted card name can't be resolved,
single-card commands reject with an ephemeral error; batch commands
(`/have-multi`, `/want-multi`) skip that line and report the failure
alongside any successes. A sealed product that can't be resolved is the
opposite: `/have-sealed`, `/want-sealed`, and `/edit` all still post/save the
listing, with the raw typed name and no Manapool link.

**"Accepts both" search semantics:** filtering `/search` by `accepts: cash`
or `accepts: trade` also matches listings with `accepts: both` (a "both"
listing satisfies either specific ask). Filtering by `accepts: both` matches
only exact `both` listings.

### Admin Commands

One top-level `/admin` command with subcommands, gated on Discord's Manage
Server permission (checked both at command registration and at runtime).
Every invocation is written to `admin_audit_log`.

| Command | Parameters | Behavior |
|---------|-----------|----------|
| `/admin config` | — | Shows current digest configuration (read-only status view). |
| `/admin digest` | — | Manually triggers a digest immediately; errors if digest mode is `disabled`. |
| `/admin schedule` | `time?` (natural language) or `cron?` (five-field, exactly one required) | Sets the digest schedule. |
| `/admin timezone` | `timezone`* | IANA timezone name, validated via `Intl.DateTimeFormat`. |
| `/admin channel` | `channel`* | Sets the digest channel. |
| `/admin dm-target` | `user`* | Sets the user to receive digest DMs. |
| `/admin mode` | `mode`* | `disabled`, `channel`, `dm`, or `both`. |
| `/admin remove` | `listing_id`* | Moderator removal of any listing in the guild (no ownership check, only same-server). |
| `/admin history` | — | Shows the 10 most recent admin actions for the guild. |
| `/admin games` | `game`* (a registered game), `enabled`* (boolean) | Enables or disables a game for the server. A disabled game's listings are kept but hidden from search and digests, and the last enabled game can't be disabled. |

Any change to `schedule`, `timezone`, or a `mode` transition into an active
mode re-creates that server's cron job (`refreshServerDigest`); `mode:
disabled` cancels it.

## Component Custom ID Scheme

Source of truth: `src/utils/customId.ts`. All component custom IDs are
prefixed `lfc:` and colon-delimited — this file exists specifically to keep
encode/decode logic from drifting apart, since `/edit` broke once from
exactly that kind of mismatch.

| Custom ID shape | Encoder / decoder | Used by |
|---|---|---|
| `lfc:fulfill:{id}` / `lfc:delete:{id}` | `encodeListingActionId` / `decodeListingActionId` | Per-listing buttons on `/mylistings` |
| `lfc:editmodal:{id}[:q1,q2,...]` | `encodeEditModalId` / `decodeEditModalId` | Opening the edit modal, optionally with a queue of remaining listing IDs for a batch edit |
| `lfc:editnext:{id}[:q1,q2,...]` | `encodeEditNextId` / `decodeEditNextId` | The "Edit next" button shown after a queued edit modal submits (a modal submission can't itself open another modal, but a button interaction can) |
| `lfc:batchdelete` / `lfc:batchfulfill` / `lfc:batchedit` | `encodeBatchSelectId` / `decodeBatchSelectId` | The three select menus on `/mylistings` |
| `lfc:havemultimodal:{kind}[:{game}:{language}]` / `lfc:wantmultimodal:{kind}[:{game}:{language}]` | `encodeMultiModalId` / `decodeMultiModal` (`decodeMultiModalKind` for just the kind) | `/have-multi`, `/want-multi`. `kind` is `card` or `sealed`; `game` and `language` are present only when the member chose them, and either may be empty (`…:card::ja`). An id without them decodes as a card modal for the server's default game, no language |

A batch-edit queue is carried entirely in the custom ID string as a
comma-joined list of listing IDs — no server-side session state is needed.
Routing lives in `src/events/interactionCreate.ts`.

## Scryfall Integration

Service: `src/services/scryfall.ts`.

- Autocomplete: `GET /cards/autocomplete?q={query}&include_extras=true`, capped at 25 results.
- Resolution (`resolveCard`): checks `card_cache` first (keyed by name + set + finish + variant + collector number). On a miss, if any printing filter is given, queries `/cards/search` with a constructed query and falls back to `/cards/named?fuzzy=` if that returns nothing; with no filter, prefers a `game:paper` search result over the raw fuzzy endpoint to avoid landing on digital-only (MTGO/Arena) printings.
- Image selection: prefers the first card face's image for double-faced cards, else `image_uris.normal`/`large`.
- Rate limiting: a shared `RateLimiter` enforces a 100ms minimum interval between requests; requests retry once (`retryWithBackoff`) on network error, timeout, or non-404 response — a 404 is treated as definitive and never retried — with a 5s per-attempt abort timeout (kept short since this backs 3-second Discord autocomplete interactions).
- Caching: successful resolutions are cached in `card_cache` for 24 hours (`resolved: true`). A failed resolution caches an **unresolved fallback** row (`resolved: false`) with the raw input, throttling repeated failed lookups; single-card commands still reject the interaction, batch commands skip that line.
- Set autocomplete (`autocompleteSets`): fetches and caches the full `/sets` list in memory for 24 hours, filtered by set-code prefix or name substring.
- Every request sends both a `User-Agent` (`LFCbot/<version> (+<repo url>)`, version read from `package.json` at runtime) and an `Accept` header, since Scryfall requires both and may block a request missing either.

## Manapool Integration

Service: `src/services/manapool.ts`. Two independent lookups sharing one rate limiter, one for card printings and one for sealed products.

- Card printings: `GET /api/v1/products/singles?scryfall_ids={id}` (`lookupManapoolPrinting`), returning a URL and `priceCents`. When no live Manapool match exists, `resolveCard` falls back to a locally-built manapool.com URL from card name/set/collector number. `manapool_price_cents` is stored only in `card_cache`; `listings.market_url` is copied from the resolved card at listing-creation or edit time.
- Sealed product: `GET /api/v1/products/sealed?mtgjson_uuids={uuid}` (`lookupManapoolSealedProduct`), returning **only** a URL — the endpoint also returns `low_price`/`price_market`, and those fields are deliberately never read or stored; no marketplace pricing exists anywhere for a sealed listing. One call per listing, made only when a member posts or edits that exact product — Mana Pool's Terms of Use prohibit cataloging/bulk-storing their content, so there is no nightly harvest of the ~4,000-product catalog and there must not be one added later.
- Both requests use header `X-ManaPool-Access-Token`, gated on the optional `MANAPOOL_API_KEY` env var — with no key set, both are a no-op (no network call) and a sealed listing gets no link at all.
- Own 100ms rate limiter mirroring Scryfall's; a 15s timeout, failures return `null` rather than surfacing an error. Neither lookup is retried — an optional enrichment sitting in front of a user-facing command is not worth a retry.

## Sealed Product Catalog

Service: `src/services/sealed.ts`. Backs `/have-sealed`, `/want-sealed`, and `/edit`'s sealed path.

- **Sync** (`syncSealedCatalog`): reads MTGJSON's 113-byte `Meta.json` first and stops there if the build version is unchanged; otherwise fetches `SetList.json` (~11.6 MB) with `If-None-Match` so an unchanged payload comes back `304` with no body. Steady state is ~113 bytes/day against a source that publishes no rate limit. `sealed_catalog_meta` (row `id: 1`) is rewritten on every run reaching a definite outcome (import, version match, or 304); a failed run leaves it alone, so a failure can't convince the next run the catalog is current. A well-formed response with zero products is treated as a failure, not an import — protects against an upstream key rename silently emptying `sealed_cache`.
- Runs daily at 16:00 UTC (`src/services/scheduler.ts`) — clear of MTGJSON's ~09:00 ET build year-round regardless of DST — plus a fire-and-forget warm-up at boot (`src/events/ready.ts`) gated on `isSealedCatalogStale()`, so a restart doesn't re-download a catalog that's already current. Both swallow rejections; `syncSealedCatalog` already logs its own failures internally.
- **Resolution** (`resolveSealedProduct`): matches the typed name (and set, if given) against `sealed_cache`, tie-breaking on `uuid` since unique product names are a property of today's catalog, not a guarantee. On a miss, keeps the caller's typed set code and name rather than dropping them — the free-text path exists specifically for a product not yet in the catalog (a new release, a store exclusive).
- **Autocomplete** (`autocompleteSealedProducts`, `autocompleteSealedSets`): both query `sealed_cache` directly, so — unlike Scryfall card autocomplete — no external request happens per keystroke. The set option only offers codes with sealed product on record.
- Display: `formatSealedType` (`src/utils/constants.ts`) renders MTGJSON `category`/`subtype` values (`booster_box` → "Booster Box"), with a manual override map for values plain title-casing gets wrong and an empty-string result for MTGJSON's placeholder values (`unknown`/`default`/`other`) so callers omit the field.

## Pokémon Catalog

Services: `src/services/tcgcsv.ts` (sync), `src/services/catalog.ts` (search and
resolution), `src/services/game-catalogs.ts` (which catalogs to keep fresh), game
definition `src/games/pokemon.ts`, name parsing `src/utils/catalog-names.ts`,
product classification `src/utils/catalog-products.ts`.

- **Source**: TCGCSV (tcgcsv.com) alone, English (category 3) and Japan (category 85). TCGdex and pokemontcg.io aren't used (`docs/MULTI_GAME_PLAN.md` §11 has the probes that led here).
- **Sync** (`syncPokemonCatalog`): follows TCGCSV's usage guidelines. Reads `last-updated.txt` first and stops if it matches the stored fingerprint; otherwise lists each category's groups and fetches each group's products with `If-None-Match`, so an unchanged group is a `304`. Requests carry `User-Agent: LFCbot/<version> (+<repository>)` and are at least 150 ms apart. Each group imports in its own transaction; groups TCGCSV no longer lists are pruned; a `404` group is an empty one; five groups failing in a row abort the run. `catalog_sync_meta` is stamped only on a fully clean run. An in-flight guard keeps two syncs from overlapping. Each set records the `IMPORT_VERSION` that imported it; when the way a product becomes a row changes, bump the constant and every set from an older version is fetched again (no `If-None-Match`, no "nothing new" stop) and `isCatalogSyncStale` is true until they are, so a change reaches sets TCGCSV never touches again. A first sync is about 681 requests and 74 MB and takes several minutes; steady state is one request. No prices are requested or stored.
- **When it runs**: only while some server has Pokémon enabled (`catalogGamesInUse` in `game-catalogs.ts`). Daily at 21:00 UTC (`startGameCatalogSync` in `scheduler.ts`), at boot when the catalog is missing or a day old (`warmUpGameCatalogs` in `ready.ts`), and when an admin enables a game whose catalog is stale (`refreshCatalogIfStale`, called by `/admin games`). All swallow rejections; the sync logs its own failures.
- **Card or sealed** (`classifyProduct`): a product with a `Number` is a card. TCGCSV gives no number to about 3,100 older singles (`Magneton`, `Fire Energy (2006 Unnumbered)`, `Erika's Oddish (Lv.10)`), to about 1,300 digital code cards (`Code Card - …`, never stored) and to the sealed product, so a product without one is classified from its name: keyword rules in a fixed order (`case`, `elite_trainer_box`, `booster_bundle`, `booster_box`, `blister`, `tin`, `build_and_battle`, `prerelease_kit`, `deck`, `collection`/`box`/`chest`/`binder`, `booster_pack`/`pack`, then `other` for calendars, battle academy sets, card file sets and the like). A name that matches none is a card with a null number. `Prize Pack Series 1` energy cards are cards, so "prize pack" never counts as a pack. The rules are a heuristic over names; `tests/utils/catalog-products.test.ts` pins them against real product names, and a new family of products that lands in the wrong bucket is fixed by adding a rule and bumping `IMPORT_VERSION`.
- **Names**: TCGCSV product names embed the number (`Pikachu - 058/078`), sometimes redundantly (`(58)`) or with leading zeros. `cleanProductName` strips those, `baseProductName` drops a trailing printing parenthetical, `normalizeCardName` folds `♀`/`♂` to `f`/`m` so Nidoran♀ is findable. A set's label is its code uppercased, or its name cut to 10 characters, so the edit modal's `set` field round-trips.
- **Sealed resolution** (`resolveCatalogSealed`): a pick (`id:<id>`) resolves to exactly that product; a typed name matches `name_normalized`, narrowed by `set` (code, name prefix, or a picked `id:<set id>`) and by language, preferring English, a non-supplemental set, then the newest. A miss is the free-text result Magic's sealed commands also post: the typed name, no link, no category. The product's category becomes `listings.sealed_category`, shown through `formatSealedType`; `other` shows nothing. Sealed autocomplete narrows to the picked `set` (`context.setCode`); card autocomplete does not.
- **Resolution** (`resolveCatalogCard`): a picked suggestion's value is `id:<product id>` and resolves to exactly that product; a typed name resolves by `base_normalized`, preferring an exact base match, then names containing every token, then shorter names, English before Japanese, non-supplemental sets, then newest. A typed `set` matches by code or name prefix (LIKE metacharacters escaped), a `collector_number` by `number`. A language the catalog fixes (Japanese) decides the listing's language and a contradicting `language` option is rejected.
- **Links and images** come from the product id: `https://www.tcgplayer.com/product/<id>` and `https://tcgplayer-cdn.tcgplayer.com/product/<id>_200w.jpg`. Neither host is reachable from the development environment, so both URL shapes are unverified; Discord and members fetch them, not the bot.
- **Autocomplete**: local queries only, so no external request per keystroke. A server with Pokémon and Magic gets one merged, tagged list (`pkm:id:<product id>`); a game that misses the 2.5 s deadline is dropped from it.

## Digest System

Services: `src/services/digest.ts`, `src/services/digest-state.ts`, `src/services/scheduler.ts`.

- One `node-cron` job per server with a non-`disabled` `digest_mode`, held in an in-memory map. Scheduled for all eligible servers on startup, rebuilt on any relevant `/admin` change.
- **Watermark-based selection**: each run collects active listings with `created_at` between `servers.last_digest_at` (or 0) and now, oldest first. The watermark only advances after at least one configured destination succeeds; on total failure the listings are left un-watermarked so the same content retries next run, and a critical alert fires (if `DISCORD_ALERT_WEBHOOK_URL` is set).
- On the disabled→active mode transition, the watermark is initialized to "now" so the first digest doesn't flood with historical listings.
- Delivery: `channel` (post to `admin_channel_id`), `dm` (DM `digest_dm_user_id`), or `both`. Each delivery attempt retries transient failures within the same run (up to 3 attempts, 1s base / 8s max backoff) rather than waiting for the next scheduled tick.
- Sections: **NEW HAVES (n)** / **NEW WANTS (n)**, grouped by `intent`, capped at 25 listings per section with an overflow note.
- Every run (success or failure) is logged to `digest_log`.
- `/admin digest` runs the same logic immediately, bypassing the cron schedule but still gated on `digest_mode !== disabled`.

Example digest:

```text
Daily Listing Digest — Aug 25, 2026

NEW HAVES (3)
- Black Lotus (Alpha) — NM — $45,000 — @user1
- Lightning Bolt (MH3) — LP — $2.50 — @user2
- Sol Ring (C21) — NM — $1.50 — @user3

NEW WANTS (2)
- Force of Will (EMA) — any condition — @user4
- Tarmogoyf (MM3) — LP — @user5
```

## Search Logic

Service: `src/services/listings.ts`, command: `src/commands/user/search.ts`.

1. Normalize the input card name (`normalizeCardName`: NFKD-normalize, strip diacritics, lowercase, collapse non-alphanumerics) and match against `card_name_normalized`.
2. Always filter by `server_id` and `status = active`, and to the games the search covers: every game the server has enabled, or the one a picked suggestion's tag or the `game` option names.
3. Optionally filter by `intent` (exact match).
4. Optionally filter by `accepts` — see "Accepts both" semantics above.
5. Order `created_at DESC`, 10 per page.
6. No results → ephemeral "No active listings found for that card." Otherwise a public embed, one field per listing: `#{id} · {Intent} · {Accepts} · @{username}`, value line `CONDITION · language · game · price · qty N` (fields omitted when null; a graded slab shows its grade, e.g. `PSA 10`, in place of the condition; the language shows only when it isn't English and the game only when the server has several). A sealed listing has no `condition`, so its value line substitutes the MTGJSON category (via `formatSealedType`) in that slot when one is known.

Search itself needed no changes for sealed listings — they're ordinary `listings` rows keyed on the same `card_name_normalized` column as card listings, so `/search`, `/mylistings`, and digest collection find them without any `kind`-specific query logic. Rendering (`/search`, `/mylistings`, and `listingEmbed`'s "Product" field on the full listing embed) is the only place that branches on `kind`.

## Listing Lifecycle

- **Creation guards**: a 10-second cooldown per user per server (checked once per batch submission, not per line); a non-blocking 24-hour duplicate warning when an identical active listing (same server/user/card/intent/accepts/finish/variant/collector number/condition/price) already exists.
- **Expiry**: an hourly cron job (`0 * * * *`, `services/scheduler.ts`) sets `status: expired` on any `active` listing whose `expires_at <= now`. Expired rows stay in the database but are excluded everywhere by the `status = active` filter.
- **Guild removal retention**: when the bot is removed from a guild, `servers.removed_at` is set. The same hourly job hard-deletes `servers` rows whose `removed_at` is older than 30 days; listings and digest logs cascade-delete via the foreign key. Re-inviting the bot before the 30 days elapse clears the marker.
- **Card cache pruning**: the same hourly job also deletes expired `card_cache` rows.
- `/fulfill` and `/delete` (and their `/mylistings` button/batch equivalents) are owner-only and terminal (`fulfilled`/`deleted`); there is no un-fulfill or restore path. `/admin remove` is a moderation path scoped to "same server," not ownership.
- `/edit` never changes `status`.

## Validation and Abuse Controls

Source of truth: `src/utils/validation.ts`.

- Price: `$0.00`–`$100,000.00`, parsed to whole cents.
- Quantity: integer, 1–99.
- Notes: max 500 characters.
- Collector number: pattern `[A-Za-z0-9★-]+`, max 20 characters.
- Card/sealed product name (`validateCardName`, shared by both): non-empty, max 100 characters.
- Condition: one of `nm`, `lp`, `mp`, `hp`, `dmg`. Not applicable to a sealed listing.
- Intent: one of `have`, `want`. Accepts: one of `cash`, `trade`, `both`. Kind (`isListingKind`): one of `card`, `sealed`.
- Cron: validated with `node-cron`'s `cron.validate` before saving.
- Timezone: validated against `Intl.DateTimeFormat`'s IANA support before saving.
- Cooldown: 10 seconds per user per server between listing creations.
- Duplicate guard: warns (does not block) on a matching active listing within 24 hours.

## Health Check and Alerting

- `GET /health` on the port set by `HEALTH_PORT` (default 3000), used by the Dockerfile `HEALTHCHECK` and `docker-compose` healthcheck.
- `DISCORD_ALERT_WEBHOOK_URL`, if set, receives critical alerts: fatal startup errors, unhandled interaction errors, and total digest delivery failures.

## Project Structure

```text
lfc-bot/
  src/
    commands/
      user/
        have.ts
        want.ts
        have-sealed.ts
        want-sealed.ts
        have-multi.ts
        want-multi.ts
        search.ts
        mylistings.ts
        edit.ts
        fulfill.ts
        delete.ts
        help.ts
      admin/
        admin.ts
        context.ts
        config.ts
        digest.ts
        schedule.ts
        timezone.ts
        channel.ts
        dm-target.ts
        mode.ts
        games.ts
        remove.ts
        history.ts
    events/
      ready.ts
      interactionCreate.ts
      guildCreate.ts
      guildDelete.ts
    db/
      schema.ts
      migrate.ts
      index.ts
      migrations/
    services/
      scryfall.ts
      manapool.ts
      sealed.ts
      tcgcsv.ts
      catalog.ts
      game-catalogs.ts
      digest.ts
      digest-state.ts
      scheduler.ts
      card-cache.ts
      listing-expiry.ts
      listings.ts
    utils/
      embeds.ts
      replies.ts
      permissions.ts
      validation.ts
      constants.ts
      customId.ts
      batch.ts
      cards.ts
      manapool.ts
      retry.ts
    types/
      index.ts
    index.ts
  tests/
    commands/
    services/
    db/
  drizzle.config.ts
  tsconfig.json
  package.json
  Dockerfile
  docker-compose.yml
  .env.example
  .gitignore
  LICENSE
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  README.md
  CHANGELOG.md
  AGENTS.md
  docs/
    DEPLOYMENT.md
    Manual_Tasks.md
    index.md
  .github/
    workflows/
    ISSUE_TEMPLATE/
    PULL_REQUEST_TEMPLATE.md
```

## Environment Variables

```env
# Required
DISCORD_TOKEN=
DISCORD_CLIENT_ID=

# Optional
DATABASE_PATH=./data/lfcbot.db
DISCORD_GUILD_ID=
NODE_ENV=development
LOG_LEVEL=info
MANAPOOL_API_KEY=
HEALTH_PORT=3000
DISCORD_ALERT_WEBHOOK_URL=
```

- `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` are required; the rest default as shown.
- `DISCORD_GUILD_ID` registers commands to a single guild for fast iteration during development. Leave it empty in production to register commands globally.
- `MANAPOOL_API_KEY` is optional; without it, card listings fall back to a locally-built manapool.com link (or no link) and sealed listings get no link at all.
- `DISCORD_ALERT_WEBHOOK_URL` is optional; without it, critical alerts are only logged, not delivered.

## Security and Privacy

- The bot token and API keys come from environment variables and are never committed.
- All user input is validated and bounded before storage (see Validation and Abuse Controls).
- All database access uses Drizzle parameter binding.
- Admin commands require Manage Server permission, enforced both declaratively and at runtime.
- Users can only edit, fulfill, or delete their own listings; `/admin remove` is the only moderation override, scoped to the same server.
- Stored data is limited to Discord user IDs, display names, listing content, and Scryfall/MTGJSON/Manapool/TCGCSV card and sealed-product metadata (TCGCSV: names, sets and numbers only, never prices). Manapool pricing data is cached transiently for card printings only (`card_cache.manapool_price_cents`, 24h TTL); sealed listings never store or display any Manapool pricing data.
- When the bot is removed from a guild, that guild's data is marked for deletion and purged after 30 days.
- The bot does not send unsolicited DMs outside configured digests.

## Assumptions and Defaults

- Magic: The Gathering and Pokémon are registered; a server has only Magic enabled until an admin changes `/admin games`. Pokémon sealed product is classified from names, so the occasional product sits in the wrong category (see the classifier notes under Pokémon Catalog).
- SQLite is the database; a future PostgreSQL migration would require type and migration adjustments, not just a driver swap.
- Digest cron defaults to `0 9 * * *`; timezone defaults to `UTC`; mode defaults to `disabled` until an admin configures delivery.
- Active listings expire after 30 days.
- Prices are stored in cents.
- One bot process serves multiple Discord servers, with independent config and listings per guild.
- Discord is the only identity provider.

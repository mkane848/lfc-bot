# LFCbot — Technical Reference

> Reference for the current implementation (v1.5.0). This describes what the
> bot actually does today, not a build plan — for what's changed release to
> release, see [CHANGELOG.md](./CHANGELOG.md); for contribution workflow, see
> [CONTRIBUTING.md](./CONTRIBUTING.md); for developer conventions and behavior
> notes, see [AGENTS.md](./AGENTS.md).

## Project Overview

LFCbot is a multi-server Discord bot where users post `/have` and `/want`
listings for trading cards, search for cards other members are offering, and
admins receive configurable digest notifications of new activity.

Magic: The Gathering is the only supported game, resolved through the
Scryfall API. The data model keeps a `game` column so other games could be
added later without a schema migration, but no other game is selectable.

**Open source (MIT), designed for small game stores and friend groups.**

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js >=22 (Docker image: `node:24-bookworm-slim`) with TypeScript |
| Discord | discord.js v14 |
| ORM | Drizzle ORM |
| Database | better-sqlite3 |
| Card data | Scryfall API |
| Pricing | Manapool API (optional) |
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
| `enabled_games` | TEXT, default `["mtg"]` | JSON array |
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
| `game` | TEXT, default `mtg` | |
| `card_name` | TEXT | Canonical name from Scryfall, or raw input on resolution failure |
| `card_name_normalized` | TEXT | Search key (see Search Logic) |
| `card_set` | TEXT, nullable | Scryfall set code |
| `card_image_url` | TEXT, nullable | |
| `finish` | TEXT, nullable | `nonfoil`, `foil`, or `etched` |
| `variant` | TEXT, nullable | `extended`, `showcase`, `borderless`, `retro`, or `full` |
| `collector_number` | TEXT, nullable | |
| `manapool_url` | TEXT, nullable | Link to this printing on manapool.com |
| `condition` | TEXT, nullable | `nm`, `lp`, `mp`, `hp`, or `dmg` |
| `price_cents` | INTEGER, nullable | Asking price for `have`, max price for `want` |
| `quantity` | INTEGER, default 1 | 1–99 |
| `notes` | TEXT, nullable | Max 500 characters |
| `status` | TEXT, default `active` | `active`, `fulfilled`, `expired`, or `deleted` (terminal) |
| `expires_at` | INTEGER | `created_at + 30 days` |
| `created_at` / `updated_at` | INTEGER | |

There is no `listing_type` field — `/sell`, `/buy`, and `/trade` were
replaced by the `intent` (`have`/`want`) + `accepts` (`cash`/`trade`/`both`)
model in the 1.3.0–1.4.0 range. `manapool_price_cents` lives only on
`card_cache`, not on `listings`.

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

All commands are guild-only. `/have`, `/want`, `/have-multi`, `/want-multi`
(their success reply), and `/search` responses are public. `/mylistings`,
`/edit`, `/fulfill`, `/delete`, `/help`, and every `/admin` response are
ephemeral.

### User Commands

| Command | Parameters | Behavior |
|---------|-----------|----------|
| `/have` | `card_name`*, `accepts`*, `condition`*, `set?`, `finish?`, `variant?`, `collector_number?`, `price?`, `quantity?` (1–99, default 1), `notes?` | Posts one card you have. Resolves via Scryfall; rejects with an ephemeral error if unresolvable. |
| `/want` | `card_name`*, `accepts`*, `set?`, `condition?`, `finish?`, `variant?`, `collector_number?`, `max_price?`, `notes?` | Posts one card you want. `condition` is the desired condition and is optional. |
| `/have-multi` | modal, up to 3 lines `Card Name \| condition \| price \| qty` + `accepts` | Opens a modal to post up to 3 "have" listings in one submission. Each line is resolved and inserted independently; failures are reported per line. |
| `/want-multi` | modal, up to 3 lines `Card Name \| condition \| max_price` + `accepts` | Same as above for "want" listings. |
| `/search` | `card_name`*, `intent?` (`have`/`want`), `accepts?` (`cash`/`trade`/`both`), `page?` | Searches active listings, 10 per page, newest first. |
| `/mylistings` | `page?` | Shows the caller's own active listings (2 per page) with per-listing Fulfill/Delete buttons, plus batch-delete, batch-fulfill, and batch-edit select menus covering their most recent 25 active listings. |
| `/edit` | `listing_id`*, then a modal (`condition`, `price`, `quantity`, `set`, `notes`, all optional) | Owner-only. If `set` changes, re-resolves the card via Scryfall and updates the printing-dependent fields (`card_name`, `card_image_url`, `collector_number`, `manapool_url`) to match. |
| `/fulfill` | `listing_id`* | Owner-only. Sets `status: fulfilled`. |
| `/delete` | `listing_id`* | Owner-only. Sets `status: deleted`. |
| `/help` | — | Static command summary. |

`*` = required. Card names use Discord autocomplete backed by Scryfall. If a
submitted name can't be resolved, single-card commands reject with an
ephemeral error; batch commands (`/have-multi`, `/want-multi`) skip that line
and report the failure alongside any successes.

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
| `lfc:havemultimodal` / `lfc:wantmultimodal` | fixed constants, no dynamic segment | `/have-multi`, `/want-multi` |

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

## Manapool Price Integration

Service: `src/services/manapool.ts`.

- `GET https://manapool.com/api/v1/products/singles?scryfall_ids={id}` with header `X-ManaPool-Access-Token`, gated on the optional `MANAPOOL_API_KEY` env var — with no key set, this is a no-op (no network call).
- Own 100ms rate limiter mirroring Scryfall's; a 15s timeout, failures return `null` rather than surfacing an error.
- When no live Manapool match exists, `resolveCard` falls back to a locally-built manapool.com URL from card name/set/collector number.
- `manapool_price_cents` is stored only in `card_cache`; `listings.manapool_url` is copied from the resolved card at listing-creation or edit time.

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
2. Always filter by `server_id` and `status = active`.
3. Optionally filter by `intent` (exact match).
4. Optionally filter by `accepts` — see "Accepts both" semantics above.
5. Order `created_at DESC`, 10 per page.
6. No results → ephemeral "No active listings found for that card." Otherwise a public embed, one field per listing: `#{id} · {Intent} · {Accepts} · @{username}`, value line `CONDITION · price · qty N` (fields omitted when null).

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
- Card name: non-empty, max 100 characters.
- Condition: one of `nm`, `lp`, `mp`, `hp`, `dmg`.
- Intent: one of `have`, `want`. Accepts: one of `cash`, `trade`, `both`.
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
- `MANAPOOL_API_KEY` is optional; without it, listings fall back to a locally-built manapool.com link or no link.
- `DISCORD_ALERT_WEBHOOK_URL` is optional; without it, critical alerts are only logged, not delivered.

## Security and Privacy

- The bot token and API keys come from environment variables and are never committed.
- All user input is validated and bounded before storage (see Validation and Abuse Controls).
- All database access uses Drizzle parameter binding.
- Admin commands require Manage Server permission, enforced both declaratively and at runtime.
- Users can only edit, fulfill, or delete their own listings; `/admin remove` is the only moderation override, scoped to the same server.
- Stored data is limited to Discord user IDs, display names, listing content, and Scryfall/Manapool card metadata.
- When the bot is removed from a guild, that guild's data is marked for deletion and purged after 30 days.
- The bot does not send unsolicited DMs outside configured digests.

## Assumptions and Defaults

- Magic: The Gathering is the only supported game.
- SQLite is the database; a future PostgreSQL migration would require type and migration adjustments, not just a driver swap.
- Digest cron defaults to `0 9 * * *`; timezone defaults to `UTC`; mode defaults to `disabled` until an admin configures delivery.
- Active listings expire after 30 days.
- Prices are stored in cents.
- One bot process serves multiple Discord servers, with independent config and listings per guild.
- Discord is the only identity provider.

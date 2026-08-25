# LFCbot — Implementation Handoff

> Approved implementation plan for LFCbot, a Discord card trading bot.

## Project Overview

LFCbot is a multi-server Discord bot where users post buy, sell, and trade
listings for trading cards, search for cards others are offering, and admins
receive configurable digest notifications of new activity.

Version 1 targets Magic: The Gathering through the Scryfall API. The data model
keeps a `game` column so other games can be added later without a schema
migration, but no other game is selectable in v1.

**Open source (MIT), designed for small game stores and friend groups.**

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20+ with TypeScript | Required by discord.js v14 and provides strong typing |
| Discord | discord.js v14 | Most mature Discord library |
| ORM | Drizzle ORM | TypeScript-native and supports generated migrations |
| Database | better-sqlite3 | File-based, simple to self-host, and appropriate for small deployments |
| Card API | Scryfall API | Free, no API key, fuzzy matching, and card images |
| Scheduler | node-cron | Per-server digest schedules with timezone support |
| Testing | Vitest | Fast, TypeScript-native test runner |
| Linting | ESLint + Prettier | Standard code quality |
| CI | GitHub Actions | Lint, test, and type-check every push and PR |

Use generated Drizzle migrations in development and production. Do not use
`drizzle-kit push` as the production migration path.

## Database Schema

### servers

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Discord guild ID |
| admin_channel_id | TEXT, nullable | Channel for digest posts |
| digest_dm_user_id | TEXT, nullable | User ID to receive digest DMs |
| digest_mode | TEXT | `disabled`, `channel`, `dm`, or `both` |
| digest_cron | TEXT | Five-field cron expression |
| digest_timezone | TEXT | IANA timezone name, default `UTC` |
| last_digest_at | INTEGER, nullable | Watermark used to select new listings |
| enabled_games | TEXT | JSON array, default `["mtg"]` |
| created_at | INTEGER | Unix timestamp in milliseconds |
| updated_at | INTEGER | Unix timestamp in milliseconds |

`digest_mode` defaults to `disabled` until an admin configures delivery.
`last_digest_at` is the only source of truth for digest deduplication.

### listings

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| server_id | TEXT FK to servers | |
| user_id | TEXT | Discord user ID of the poster |
| username | TEXT | Display name at time of posting |
| listing_type | TEXT | `buy`, `sell`, or `trade` |
| game | TEXT | Always `mtg` in v1 |
| card_name | TEXT | Canonical name from Scryfall, or raw input on failure |
| card_name_normalized | TEXT | Lowercased, punctuation-stripped search key |
| card_set | TEXT, nullable | Scryfall set code |
| card_image_url | TEXT, nullable | Scryfall image URI |
| condition | TEXT | `nm`, `lp`, `mp`, `hp`, or `dmg` |
| price_cents | INTEGER, nullable | Price in cents; required for `sell`, optional for `buy` |
| quantity | INTEGER | 1 to 99 |
| notes | TEXT, nullable | Freeform notes, maximum 500 characters |
| status | TEXT | `active`, `fulfilled`, `expired`, or `deleted` |
| expires_at | INTEGER | Unix timestamp; active listings expire 30 days after creation |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

Indexes:

- `listings(server_id, status, card_name_normalized)` for search
- `listings(server_id, status, created_at)` for digest collection
- `listings(server_id, user_id, created_at)` for `/mylistings`

### digest_log

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| server_id | TEXT FK to servers | |
| sent_at | INTEGER | Unix timestamp when the digest completed |
| trigger | TEXT | `scheduled` or `manual` |
| listing_count | INTEGER | Number of listings included |
| listing_ids_included | TEXT | JSON array of listing IDs |
| delivery_results | TEXT | JSON object describing channel and DM success |

`digest_log` is append-only and is not used for deduplication. Digest selection
always uses `servers.last_digest_at`.

### card_cache

| Column | Type | Notes |
|--------|------|-------|
| cache_key | TEXT PK | Normalized card name plus optional set code |
| scryfall_id | TEXT, nullable | Scryfall card ID |
| card_name | TEXT | Canonical Scryfall name |
| card_name_normalized | TEXT | Normalized search key |
| card_set | TEXT, nullable | Scryfall set code |
| card_image_url | TEXT, nullable | Preferred image URL |
| resolved | INTEGER | 1 after successful Scryfall lookup, 0 for temporary fallback |
| resolved_at | INTEGER | Unix timestamp when the row was cached |
| expires_at | INTEGER | Unix timestamp; TTL is 24 hours |

## Slash Commands

All commands are guild-only. Listing creation and search responses are public.
`/mylistings`, `/help`, and every `/admin` response are ephemeral.

### User Commands

| Command | Parameters | Behavior |
|---------|-----------|----------|
| `/sell` | `card_name`, `condition`, `price`, `set?`, `quantity?`, `notes?` | Creates a sell listing. Resolves the card through Scryfall. |
| `/buy` | `card_name`, `set?`, `condition?`, `max_price?`, `notes?` | Creates a buy listing. |
| `/trade` | `card_name`, `condition`, `set?`, `notes?` | Creates a trade listing. |
| `/search` | `card_name`, `listing_type?`, `page?` | Searches active listings in the server. Results are paginated. |
| `/mylistings` | `page?` | Shows the user's own active listings with edit, fulfill, and delete buttons. |
| `/edit` | `listing_id`, fields via modal | Allows the owner to edit condition, price, quantity, notes, and set. |
| `/fulfill` | `listing_id` | Marks the owner's listing as fulfilled. |
| `/delete` | `listing_id` | Soft-deletes the owner's listing. |
| `/help` | — | Shows available commands and usage. |

Card names use Discord autocomplete backed by Scryfall. If a submitted name is
ambiguous or unresolved, the bot responds with an ephemeral error and suggestions;
it does not create a listing from an ambiguous card name.

### Admin Commands

Admin commands use one top-level `/admin` command with subcommands and require
Discord's Manage Server permission.

| Command | Parameters | Behavior |
|---------|-----------|----------|
| `/admin config` | — | Interactive setup for digest mode, channel, DM target, cron, and timezone. |
| `/admin digest` | — | Manually triggers a digest now. |
| `/admin schedule` | `cron` | Sets the five-field digest cron expression. |
| `/admin timezone` | `timezone` | Sets the server's IANA timezone. |
| `/admin channel` | `channel` | Sets the digest channel. |
| `/admin dm-target` | `user` | Sets the user to receive digest DMs. |
| `/admin mode` | `mode` | Sets delivery to `disabled`, `channel`, `dm`, or `both`. |
| `/admin games` | `game`, `enabled` | Enables or disables a supported game. Only `mtg` is available in v1. |
| `/admin remove` | `listing_id` | Removes any listing for moderation. |

## Scryfall Integration

Service: `src/services/scryfall.ts`

- Autocomplete: `GET https://api.scryfall.com/cards/autocomplete?q={query}`
- Fuzzy lookup: `GET https://api.scryfall.com/cards/named?fuzzy={name}`
- Set-filtered lookup: `GET https://api.scryfall.com/cards/search?q={query}`
- Rate limiting: at least 100ms between requests, implemented as a sequential queue
- Caching: use the `card_cache` table with a 24-hour TTL
- User-Agent: include a descriptive `User-Agent` header with the project name and repository URL

Card resolution flow:

1. The user begins typing a card name and Discord requests autocomplete options.
2. The bot queries Scryfall autocomplete and returns up to 25 choices.
3. If the user submits an exact or unambiguous name, the bot resolves it through the fuzzy endpoint.
4. If Scryfall returns an ambiguous result, the bot sends an ephemeral error with autocomplete suggestions.
5. If Scryfall is unavailable, the bot stores the normalized raw name, omits the image, and marks the cache row as unresolved until retry.

For double-faced cards, prefer `card_faces[0].image_uris.normal`. If that is
unavailable, fall back to `image_uris.normal`, then `image_uris.large`, then no image.

## Admin Digest System

Service: `src/services/digest.ts`

- Each server gets one node-cron job using its own cron expression and timezone.
- On startup, schedule jobs for all servers with `digest_mode` other than `disabled`.
- When config changes, cancel and recreate the affected job.
- When digest mode changes from disabled to an active mode, initialize last_digest_at to the current time.
- Collect active listings where `server_id` matches, `created_at > last_digest_at`, and `created_at <= now`.
- On the first digest for a server, collect only listings created after digest configuration was completed.
- Format digests with sections for New Sells, New Buys, and New Trades.
- Cap each section at 25 listings and include an overflow note.
- If there are no new listings, skip delivery and do not advance the watermark.
- Deliver according to `digest_mode`: channel, DM, or both.
- Advance `last_digest_at` only after at least one configured destination succeeds.
- Log each successful digest in `digest_log`.
- A manual digest follows the same watermark rules as a scheduled digest.

If the configured channel is missing or the DM fails, record the failure in the
log and leave the watermark unchanged so the same listings are retried next time.

Example digest:

```text
Daily Listing Digest — Aug 25, 2026

NEW SELLS (3)
- Black Lotus (Alpha) — NM — $45,000 — @user1
- Lightning Bolt (MH3) — LP — $2.50 — @user2
- Sol Ring (C21) — NM — $1.50 — @user3

NEW BUYS (1)
- Force of Will (EMA) — any condition — @user4

NEW TRADES (2)
- Tarmogoyf (MM3) — NM — @user5
- Liliana of the Veil (INN) — LP — @user6
```

## Search and Listing Expiry

Search flow:

1. Resolve or normalize the card name.
2. Query active listings by `server_id`, `card_name_normalized`, and optional `listing_type`.
3. Return results sorted newest first, 10 per page.
4. Include card image when available, plus listing type, condition, price, quantity, notes, poster username, and listing ID.
5. If there are no results, return an ephemeral "No active listings found" message.

Expiration:

- New active listings get `expires_at = created_at + 30 days`.
- The digest scheduler marks listings as `expired` when `expires_at <= now`.
- Expired listings remain in the database but never appear in search or digests.

## Validation and Abuse Controls

- Price: between $0.00 and $100,000.00, parsed as dollars and stored in cents.
- Quantity: integer from 1 to 99.
- Notes: maximum 500 characters.
- Condition: one of `nm`, `lp`, `mp`, `hp`, or `dmg`.
- Listing type: one of `buy`, `sell`, or `trade`.
- Cron: validate the five-field expression with node-cron before saving.
- Timezone: validate against the IANA timezone list before saving.
- Cooldown: one listing per user per server every 10 seconds.
- Duplicate guard: warn when a user posts the same active card, type, set, condition, and price within 24 hours.

## Project Structure

```text
LFCbot/
  src/
    commands/
      user/
        sell.ts
        buy.ts
        trade.ts
        search.ts
        mylistings.ts
        edit.ts
        fulfill.ts
        delete.ts
        help.ts
      admin/
        config.ts
        digest.ts
        schedule.ts
        timezone.ts
        channel.ts
        dm-target.ts
        mode.ts
        games.ts
        remove.ts
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
      digest.ts
      card-cache.ts
      listing-expiry.ts
    utils/
      embeds.ts
      permissions.ts
      validation.ts
      constants.ts
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
  .eslintrc.json
  .prettierrc
  .env.example
  .gitignore
  LICENSE
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  README.md
  .github/
    workflows/
      ci.yml
    ISSUE_TEMPLATE/
      bug_report.md
      feature_request.md
    PULL_REQUEST_TEMPLATE.md
```

## Open Source and Quality

- License: MIT
- README: setup guide, feature overview, self-hosting instructions, and command reference
- CONTRIBUTING.md: contribution expectations, code style, and PR process
- CODE_OF_CONDUCT.md: Contributor Covenant
- CI: GitHub Actions runs lint, type-check, and tests on every push and PR
- `.env.example`: documents all required and optional environment variables
- Tests: service tests with a mocked Scryfall client, database tests against in-memory SQLite, and command handler tests with mocked Discord interactions

## Security and Privacy

- Bot token comes from an environment variable and is never committed.
- All user input is validated and bounded before storage.
- All database access uses Drizzle parameter binding.
- Scryfall rate limits are respected.
- Admin commands require Manage Server permission.
- Users can only edit, fulfill, or delete their own listings.
- Store only Discord user IDs, display names, listing content, and Scryfall card metadata.
- When the bot is removed from a guild, mark the server row for deletion and remove that server's data after 30 days.
- Provide `/admin config` guidance for digest channels and DM targets, but do not send unsolicited DMs outside configured digests.

## Implementation Order

1. Project scaffolding, TypeScript config, ESLint, Prettier, `.env.example`, and CI
2. Drizzle schema, generated migrations, and connection singleton
3. Discord client, event handlers, command registration, and permission checks
4. Scryfall service, card cache, and autocomplete handler
5. User commands: `/sell`, `/buy`, `/trade`, `/search`, `/mylistings`, `/edit`, `/fulfill`, `/delete`, `/help`
6. Admin command group and configuration persistence
7. Digest scheduler, formatter, delivery, watermark, and audit log
8. Listing expiry and guild removal retention job
9. Tests for services, database operations, validation, permissions, and command handlers
10. Open source files and documentation

## Assumptions and Defaults

- Version 1 supports Magic: The Gathering only.
- SQLite is the initial database. A future PostgreSQL migration may require type and migration adjustments; it is not a driver-only change.
- Digest cron defaults to `0 9 * * *`.
- Digest timezone defaults to `UTC` and can be changed per server.
- Digest mode defaults to `disabled` until configured.
- Active listings expire after 30 days.
- Prices are stored in cents.
- One bot process serves multiple Discord servers, with independent config and listings per guild.
- Discord is the only identity provider.

## Environment Variables

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DATABASE_PATH=./data/lfcbot.db
NODE_ENV=development
LOG_LEVEL=info
```

`DISCORD_TOKEN` and `DISCORD_CLIENT_ID` are required. The other values are
optional and use the defaults shown above.

## Implementation Notes

- Use discord.js v14 or newer and its bundled builders.
- Use `drizzle-orm/better-sqlite3` and generated migrations.
- Create the database file's parent directory on startup.
- Register commands globally in production. During development, register to the guild in `DISCORD_GUILD_ID` when provided.
- Use the `Guilds` intent only. Do not request privileged intents.
- Handle unknown commands, permission failures, validation errors, and unexpected exceptions with user-safe messages.
- Stop all cron jobs on shutdown and restart them from database state on boot.
- Test in a private Discord server before inviting the bot to a production server.
- Required bot permissions: Send Messages, Embed Links, Read Message History, and Use Application Commands.

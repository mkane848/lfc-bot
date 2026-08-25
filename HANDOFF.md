# LFCbot — Implementation Handoff

> This file contains the full approved plan for LFCbot, a Discord card trading bot.
> An implementing agent should follow this spec top-to-bottom. All design decisions
> have been made — no ambiguity remains.

---

## Project Overview

A multi-server Discord bot that lets users post buy/sell/trade listings for trading cards
(starting with Magic: The Gathering via the Scryfall API), search for cards others are
offering, and gives admins configurable digest notifications of new activity.

**Open source (MIT), designed for small game stores and friend groups.**

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js + TypeScript | discord.js ecosystem, strong typing |
| Discord | discord.js v14 | Most mature Discord library |
| ORM | Drizzle ORM | TypeScript-native, supports SQLite to PostgreSQL migration |
| Database | better-sqlite3 | Zero-dependency, file-based, perfect for small servers |
| Card API | Scryfall API | Free, no API key, fuzzy matching, card images |
| Scheduler | node-cron | Configurable digest intervals |
| Testing | Vitest | Fast, TypeScript-native test runner |
| Linting | ESLint + Prettier | Standard code quality |
| CI | GitHub Actions | Lint, test, type-check on every PR |

---

## Database Schema

Three tables, designed for multi-server support and future PostgreSQL migration:

### servers — per-guild configuration

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Discord guild ID |
| admin_channel_id | TEXT, nullable | Channel for digest posts |
| digest_dm_user_id | TEXT, nullable | User ID to DM digests to |
| digest_mode | TEXT | channel / dm / both |
| digest_cron | TEXT | Cron expression, default 0 9 * * * (daily 9 AM) |
| enabled_games | TEXT | JSON array, default [mtg] |
| created_at | INTEGER | Timestamp |
| updated_at | INTEGER | Timestamp |

### listings — individual buy/sell/trade posts

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| server_id | TEXT FK to servers | |
| user_id | TEXT | Discord user ID of the poster |
| username | TEXT | Display name at time of posting |
| listing_type | TEXT | buy / sell / trade |
| game | TEXT | mtg / pokemon / etc. |
| card_name | TEXT | Canonical name from Scryfall |
| card_set | TEXT, nullable | Set code |
| card_image_url | TEXT, nullable | Scryfall image URI |
| condition | TEXT | nm / lp / mp / hp / dmg |
| price_cents | INTEGER, nullable | Price in cents to avoid float issues |
| quantity | INTEGER | Default 1 |
| notes | TEXT, nullable | Freeform user notes |
| status | TEXT | active / fulfilled / expired / deleted |
| created_at | INTEGER | Timestamp |
| updated_at | INTEGER | Timestamp |

Index: listings(server_id, status, card_name) for fast search queries.

### digest_log — tracks what was sent in each digest

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| server_id | TEXT FK to servers | |
| last_digest_at | INTEGER | Timestamp of last digest send |
| listing_ids_included | TEXT | JSON array of listing IDs included |

---

## Slash Commands

### User Commands

| Command | Parameters | Behavior |
|---------|-----------|----------|
| /sell | card_name, condition, price, set?, quantity?, notes? | Creates a sell listing. Resolves card via Scryfall for image + canonical name. |
| /buy | card_name, set?, condition?, max_price?, notes? | Creates a buy/wanted listing. |
| /trade | card_name, condition, set?, notes? | Creates a trade listing. |
| /search | card_name, game?, listing_type? | Searches active listings in the server. Returns matching cards with seller info. |
| /mylistings | — | Shows the user's own active listings with edit/delete buttons. |
| /delete | listing_id | Soft-deletes a listing (owner only). |
| /help | — | Shows available commands and usage. |

### Admin Commands (require Manage Server permission)

| Command | Parameters | Behavior |
|---------|-----------|----------|
| /admin config | — | Interactive setup: set admin channel, digest DM target, digest mode, cron schedule. |
| /admin digest | — | Manually trigger a digest now. |
| /admin digest-schedule | cron | Set the digest cron expression. |
| /admin channel | channel | Set the admin digest channel. |
| /admin dm-target | user | Set the user to receive DM digests. |
| /admin digest-mode | mode | Set delivery: channel, dm, or both. |
| /admin games | games | Enable/disable supported games. |

---

## Scryfall Integration

Service: src/services/scryfall.ts

- Card search: GET https://api.scryfall.com/cards/named?fuzzy={name} — fuzzy match card names
- Set search: GET https://api.scryfall.com/cards/search?q={query} — filter by set
- Rate limiting: Scryfall asks for 50-100ms between requests. Implement a simple token-bucket or sequential queue.
- Caching: Cache resolved card data (name, set, image URL) in a local card_cache table to reduce API calls. TTL: 24 hours.
- Error handling: Graceful fallback if Scryfall is down — store user-entered name, skip image.

Card resolution flow:
1. User enters card name (e.g., "Black Lotus")
2. Bot calls Scryfall fuzzy endpoint
3. If match found: store canonical name, set, image URL
4. If ambiguous: present user with disambiguation (autocomplete in slash command)
5. If no match: store raw name, warn user

---

## Admin Digest System

Service: src/services/digest.ts

- Runs on a cron schedule per server (configurable via /admin digest-schedule)
- Collects all active listings created since last_digest_at
- Formats into a Discord embed with sections: New Sells, New Buys, New Trades
- Delivers based on digest_mode:
  - channel: posts to configured admin channel
  - dm: DMs the configured user
  - both: does both
- Logs sent listing IDs in digest_log to avoid duplicates
- Manual trigger via /admin digest bypasses the schedule

Digest embed format:
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

---

## Card Search / Match

When a user runs /search Black Lotus:
1. Fuzzy-resolve the card name via Scryfall
2. Query listings table: WHERE server_id = ? AND card_name LIKE ? AND status = active
3. Return results as embeds with card image, listing type, condition, price, and poster username
4. If no results: "No active listings found for Black Lotus in this server."

---

## Project Structure

LFCbot/
  src/
    commands/
      user/
        sell.ts
        buy.ts
        trade.ts
        search.ts
        mylistings.ts
        delete.ts
        help.ts
      admin/
        config.ts
        digest.ts
        digest-schedule.ts
        channel.ts
        dm-target.ts
        digest-mode.ts
        games.ts
    events/
      ready.ts
      interactionCreate.ts
      guildCreate.ts
    db/
      schema.ts          — Drizzle schema definitions
      migrate.ts         — Migration runner
      index.ts           — DB connection singleton
      migrations/        — Generated migration files
    services/
      scryfall.ts        — Scryfall API client
      digest.ts          — Digest scheduler + formatter
      card-cache.ts      — Card data caching layer
    utils/
      embeds.ts          — Discord embed builders
      permissions.ts     — Permission checks
      validation.ts      — Input validation
      constants.ts       — Game types, conditions, etc.
    types/
      index.ts           — Shared TypeScript types
    index.ts             — Bot entry point
  tests/
    commands/            — Command handler tests
    services/            — Service tests (scryfall, digest)
    db/                  — Database operation tests
  drizzle.config.ts
  tsconfig.json
  package.json
  .eslintrc.json
  .prettierrc
  .env.example
  .gitignore
  LICENSE               — MIT
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  README.md
  .github/
    workflows/
      ci.yml            — Lint, test, type-check
    ISSUE_TEMPLATE/
      bug_report.md
      feature_request.md
    PULL_REQUEST_TEMPLATE.md

---

## Open Source & Quality

- License: MIT
- README: Setup guide, feature overview, screenshots, self-hosting instructions, cloud deployment tips
- CONTRIBUTING.md: How to contribute, code style, PR process
- CODE_OF_CONDUCT.md: Contributor Covenant
- CI: GitHub Actions runs lint + type-check + tests on every push/PR
- .env.example: Documents all required/optional env vars
- Tests: Unit tests for services (Scryfall, digest), integration tests for DB operations, command handler tests with mocked Discord interactions

---

## Security Considerations

- Bot token via environment variable, never committed
- All user input validated and sanitized before DB queries
- Parameterized queries via Drizzle (no string interpolation)
- Scryfall rate limiting respected (50-100ms between requests)
- Admin commands require Discord Manage Server permission
- Users can only delete/edit their own listings
- No PII stored beyond Discord user IDs and display names

---

## Implementation Order

1. Project scaffolding: package.json, tsconfig, ESLint, Prettier, .gitignore, .env.example
2. Database layer: Drizzle schema, migrations, connection singleton
3. Bot skeleton: discord.js client setup, event handlers, command registration
4. Scryfall service: API client, fuzzy search, caching
5. User commands: /sell, /buy, /trade, /search, /mylistings, /delete, /help
6. Admin commands: /admin config, channel/dm/mode/schedule setup
7. Digest system: Cron scheduler, embed formatter, delivery logic
8. Tests: Unit + integration tests for all services and commands
9. Open source files: LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, CI, issue/PR templates
10. Documentation: Setup guide, deployment guide, command reference

---

## Assumptions & Defaults

- Scryfall is the primary card data source for MTG. Other games (Pokemon, Yu-Gi-Oh!) will be added later with their own API integrations.
- SQLite is the initial database. Drizzle's schema is designed so switching to PostgreSQL requires only changing the driver and running drizzle-kit push — no schema changes needed.
- Digest cron defaults to daily at 9 AM server-local time. Admins can change it to any valid cron expression.
- Card condition uses standard TCG grading: NM (Near Mint), LP (Lightly Played), MP (Moderately Played), HP (Heavily Played), DMG (Damaged).
- Prices stored in cents to avoid floating-point issues. Display formatted as dollars.
- Single bot instance per server — the bot supports multiple servers, but each server has independent config and listings.
- No authentication beyond Discord — users are identified by their Discord account. No separate login.

---

## Environment Variables

  DISCORD_TOKEN=          # Discord bot token (required)
  DISCORD_CLIENT_ID=      # Discord application client ID (required)
  DATABASE_PATH=./data/lfcbot.db  # SQLite database file path (optional, default shown)
  NODE_ENV=development    # development | production
  LOG_LEVEL=info          # debug | info | warn | error

---

## Notes for Implementer

- Start with npm init and install dependencies incrementally as you build each layer.
- Use discord.js v14+ (latest stable). Use @discordjs/builders for slash command definitions.
- Drizzle ORM with drizzle-kit for migrations. Use better-sqlite3 as the SQLite driver.
- The Scryfall API is free and requires no API key. Respect their rate limits (50-100ms between requests).
- For the digest scheduler, node-cron is lightweight and supports standard cron expressions.
- Test with a private Discord server before deploying to a production server.
- The bot needs the applications.commands scope and bot scope with permissions: Send Messages, Embed Links, Use Slash Commands, Read Message History.

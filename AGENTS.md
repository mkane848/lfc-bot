# AGENTS.md

Guidance for coding agents working in this repository.

## Project

LFCbot is a multi-server Discord bot for buy, sell, and trade listings of
trading cards. Version 1 targets Magic: The Gathering via the Scryfall API.
Stack: Node.js 22+, TypeScript (strict, ESM with `NodeNext`), discord.js v14,
Drizzle ORM with better-sqlite3, node-cron for per-guild digest schedules, and
Vitest for tests.

## Commands

- `npm install` - install dependencies
- `npm run dev` - run the bot with tsx watch (requires a valid `.env`)
- `npm test` - run the Vitest suite once
- `npm run test:watch` - run Vitest in watch mode
- `npm run lint` / `npm run lint:fix` - ESLint
- `npm run format` / `npm run format:check` - Prettier
- `npm run type-check` - `tsc --noEmit`
- `npm run build` - compile to `dist/`
- `npm run db:generate` - generate a Drizzle migration after a schema change
- `npm run db:check` - check pending migration changes

CI (`.github/workflows/ci.yml`) runs lint, format check, type-check, and tests
on every push to `main` and every pull request. Run those four checks locally
before considering work done. A separate release workflow
(`.github/workflows/release.yml`) builds a multi-architecture Docker image,
publishes it to GHCR, and creates a GitHub Release whenever a `v*` tag is
pushed.

## Environment

Copy `.env.example` to `.env`. Required: `DISCORD_TOKEN` and
`DISCORD_CLIENT_ID`. Optional: `DATABASE_PATH` (default `./data/lfcbot.db`),
`DISCORD_GUILD_ID` (registers commands to a test guild in development instead
of globally), `NODE_ENV`, and `LOG_LEVEL`.

Never read, quote, or commit `.env`; it contains the bot token. `.env.example`
is the documentation surface for environment variables.

## Layout

- `src/index.ts` - startup: env validation, migrations, Discord client
  (`Guilds` intent only), event wiring, graceful shutdown
- `src/commands/user/` - member-facing listing commands
- `src/commands/admin/` - `/admin` subcommands; require Manage Server
- `src/events/` - Discord event handlers
- `src/db/` - Drizzle schema, connection singleton, and generated migrations
- `src/services/` - Scryfall client, card cache, listings, digests, scheduler
- `src/utils/` - validation, embeds, permissions, logging, constants
- `tests/` - mirrors `src`; `tests/helpers/db.ts` provides in-memory SQLite
- `scripts/` - operational helpers, including `backup.sh` for the SQLite volume
- `docs/` - deployment and hosting documentation
- `Dockerfile`, `docker-compose.yml`, `.dockerignore` - container packaging

## Conventions

- Relative imports use `.js` specifiers (ESM `NodeNext` resolution).
- Prettier enforces 100-column width, single quotes, and trailing commas; run
  `npm run format` rather than formatting by hand.
- Keep changes scoped and prefer existing patterns over new abstractions.
- Prices are stored in integer cents; timestamps are Unix milliseconds.
- Card names carry a `card_name_normalized` search key; preserve it when
  touching listing flow.
- All database access goes through Drizzle with parameter binding.
- Discord commands are guild-only; do not add privileged intents.
- Admin authorization is Discord's Manage Server permission; listing edit,
  fulfill, and delete are restricted to the listing owner.

## Database Rules

After changing `src/db/schema.ts`, run `npm run db:generate` and commit the
generated SQL and meta files under `src/db/migrations/`. Do not use
`drizzle-kit push` as the production migration path. Migrations run
automatically at startup and the database file's parent directory is created on
boot.

## Testing

Service tests mock the Scryfall client, database tests run against in-memory
SQLite via `setupTestDb()`, and command tests mock Discord interactions. Add or
update tests alongside behavior changes; do not weaken assertions to make a
change pass.

## Behavior Notes

- Active listings expire 30 days after creation and are excluded from search
  and digests but retained with an `expired` status.
- Digest deduplication is driven solely by `servers.last_digest_at`; the
  watermark advances only after at least one configured delivery succeeds.
- Scryfall requests go through the rate-limited queue in
  `src/services/scryfall.ts`, with a 24-hour cache in the `card_cache` table.
- When the bot is removed from a guild, that guild's data is removed after a
  30-day retention window.

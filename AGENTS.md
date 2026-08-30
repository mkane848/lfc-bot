# AGENTS.md

Guidance for coding agents working in this repository.

## Project

LFCbot is a multi-server Discord bot for have/want trading card listings:
members post a card they have or want, whether they'll accept cash, trade, or
both, and optionally an exact printing (set, finish, variant, collector
number). Version 1 targets Magic: The Gathering via the Scryfall API, with
optional links to the exact printing on Manapool. Stack: Node.js 22+,
TypeScript (strict, ESM with `NodeNext`), discord.js v14, Drizzle ORM with
better-sqlite3, node-cron for per-guild digest schedules, and Vitest for
tests.

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

CI (`.github/workflows/ci.yml`) runs lint, format check, type-check, tests,
and an `npm audit` pass (blocking for production dependencies, non-blocking
for dev-only ones) on every push to `main` and every pull request. Run those
checks locally before considering work done. `.github/workflows/codeql.yml`
runs GitHub CodeQL scanning (`javascript-typescript`) on the same triggers
plus a weekly schedule. A separate release workflow
(`.github/workflows/release.yml`) builds a multi-architecture Docker image,
publishes it to GHCR, and creates a GitHub Release whenever a `v*` tag is
pushed.

## Environment

Copy `.env.example` to `.env`. Required: `DISCORD_TOKEN` and
`DISCORD_CLIENT_ID`. Optional: `DATABASE_PATH` (default `./data/lfcbot.db`),
`DISCORD_GUILD_ID` (registers commands to a test guild in development instead
of globally), `NODE_ENV`, `LOG_LEVEL`, `HEALTH_PORT` (default `3000`),
`MANAPOOL_API_KEY` (a Mana Pool API access token, `mpat_...`; enables live
"View on Manapool" links and price lookups for exact printings, otherwise the
bot falls back to a locally-built link or none), and `DISCORD_ALERT_WEBHOOK_URL`
(Discord webhook URL to receive critical error alerts; leave empty to disable).

Never read, quote, or commit `.env`; it contains the bot token. `.env.example`
is the documentation surface for environment variables.

## Layout

- `src/index.ts` - startup: env validation, migrations, Discord client
  (`Guilds` intent only), event wiring, health server, graceful shutdown
- `src/commands/user/` - member-facing listing commands
- `src/commands/admin/` - `/admin` subcommands; require Manage Server
- `src/events/` - Discord event handlers
- `src/db/` - Drizzle schema, connection singleton, and generated migrations
- `src/services/` - Scryfall client, Manapool client, card cache, listings,
  digests, scheduler, health checks, critical alerts, and admin audit logging
- `src/utils/` - validation, embeds, permissions, logging, constants, custom
  IDs, batch operations, and retry-with-backoff
- `tests/` - mirrors `src`; `tests/helpers/db.ts` provides in-memory SQLite
- `scripts/` - operational helpers, including `backup.sh` for the SQLite volume
- `docs/` - deployment and hosting documentation
- `Dockerfile`, `docker-compose.yml`, `.dockerignore` - container packaging

## Git Workflow

All new sessions should create a feature branch for their work without being
explicitly told. Follow the naming convention: `fix/` for bug fixes, `feature/`
for new features, `docs/` for documentation, `refactor/` for refactoring, or
other descriptive prefixes as appropriate. This keeps work isolated, enables
parallel development, and makes PR reviews clearer. Create the branch early,
commit frequently with clear messages, and push regularly so work is never lost.

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

To add a `NOT NULL` column backed by existing data (SQLite can't add a
`NOT NULL` column without a constant default, and can't backfill from another
column in the same `ALTER TABLE`), generate in two passes: first add the
column nullable and run `db:generate`, then hand-edit that migration to
`UPDATE` the backfilled values, then flip the column to `.notNull()` in
`schema.ts` and run `db:generate` again — drizzle-kit will emit a SQLite
table-rebuild migration that succeeds because the data is already backfilled.
See `src/db/migrations/0001_have_want_printing_fields.sql` and
`0002_listings_intent_accepts_not_null.sql` for a worked example.

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
  `src/services/scryfall.ts`, with a 24-hour cache in the `card_cache` table
  keyed by name plus set/finish/variant/collector number.
- Each listing's Manapool link is resolved once, at card-resolution time, and
  frozen onto the row (`listings.manapool_url`) and the card cache — it is
  not re-fetched live when rendering embeds or digests. `src/utils/manapool.ts`
  builds the local fallback URL; `src/services/manapool.ts` does the live
  lookup and is a no-op (no network call) when `MANAPOOL_API_KEY` is unset.
- When the bot is removed from a guild, that guild's data is removed after a
  30-day retention window.
- Discord interaction custom IDs are encoded/decoded in `src/utils/customId.ts`
  using a deterministic, tested format for button and select menu routing.
- Every `/admin` subcommand invocation (config, digest, schedule, timezone,
  channel, dm-target, mode, remove, history) is recorded to the
  `admin_audit_log` table via `src/services/audit-log.ts`, logged as invoked
  (subcommand + arguments) rather than confirmed successful, since the
  subcommand handlers don't report a success/failure signal back. Viewable
  via `/admin history`.
- Fatal startup errors, Discord client errors, unhandled interaction errors,
  and total digest-delivery failures trigger a Discord webhook alert via
  `src/services/alerts.ts` when `DISCORD_ALERT_WEBHOOK_URL` is set (a
  five-minute per-message cooldown prevents a recurring failure from
  spamming the channel); it's a no-op when unset.
- Health checks are available at `GET /health` (port 3000 by default,
  `HEALTH_PORT`) for container orchestration: `200`/`ok` when both the
  Discord gateway is connected and SQLite responds, `503`/`degraded`
  otherwise (e.g. during startup before login resolves).
- Scryfall lookups and digest delivery (channel/DM send) retry transient
  failures once via `src/utils/retry.ts`'s exponential backoff; a Scryfall
  `404` is a definitive not-found and is never retried. The interactive
  commands that resolve a card (`/have`, `/want`, `/have-multi`,
  `/want-multi`, `/edit`) call `interaction.deferReply()` first so the retry
  has room to work within Discord's 15-minute deferred-response window
  instead of the 3-second initial-ACK deadline.

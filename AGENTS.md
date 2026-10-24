# AGENTS.md

Guidance for coding agents working in this repository.

## Project

LFCbot is a multi-server Discord bot for have/want trading card listings:
members post a card they have or want, whether they'll accept cash, trade, or
both, and optionally an exact printing (set, finish, variant, collector
number). It supports Magic: The Gathering via the Scryfall API, with
optional links to the exact printing on Manapool, and Pokémon singles and
sealed product via a local catalog synced from TCGCSV, with links to TCGplayer.
Stack: Node.js 22+,
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
publishes it to GHCR, and creates a GitHub Release for a `v*` tag. Tags are
created automatically: after CI passes on `main`,
`.github/workflows/tag-release.yml` tags the commit that set the `package.json`
version (found with `git log -S`, not the commit whose CI triggered the run),
once CI has passed on that commit and if the tag doesn't exist yet, then calls
the release workflow directly, because a tag pushed with the workflow token
doesn't trigger other workflows.
To cut a release, merge a PR that bumps the version with
`npm version X.Y.Z --no-git-tag-version` and adds its `CHANGELOG.md` section
(see `CONTRIBUTING.md`).

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
- `src/games/` - the game registry: one `GameDefinition` per game (`types.ts`),
  registration (`registry.ts`, and `index.ts`, which registers Magic from
  `mtg.ts` and Pokémon from `pokemon.ts`), per-server enabled games (`server.ts`), game resolution and
  autocomplete tagging (`resolve.ts`), and the merged autocomplete
  (`autocomplete.ts`). Import from `games/index.js`, which is what registers
  the games
- `src/commands/user/` - member-facing listing commands
- `src/commands/admin/` - `/admin` subcommands; require Manage Server
- `src/events/` - Discord event handlers
- `src/db/` - Drizzle schema, connection singleton, and generated migrations
- `src/services/` - Scryfall client, Manapool client, card cache, listings,
  digests, scheduler, health checks, critical alerts, and admin audit logging;
  the Pokémon catalog (`tcgcsv.ts` syncs it, `catalog.ts` searches and resolves
  against it, `game-catalogs.ts` decides which catalogs to keep fresh)
- `src/utils/` - validation, embeds, permissions, logging, constants, custom
  IDs, batch operations, the shared listing options (`listing-options.ts`:
  `game`, `language`, `grade`, and the rules between them), and
  retry-with-backoff
- `tests/` - mirrors `src`; `tests/helpers/db.ts` provides in-memory SQLite
  and `tests/helpers/interaction.ts` provides shared mock Discord
  interactions for command tests; `tests/helpers/games.ts` registers a fake
  second game for the multi-game paths, and `tests/helpers/migrations.ts`
  replays the generated SQL up to a migration
- `scripts/` - operational helpers, including `backup.sh` for the SQLite volume
- `docs/` - deployment and hosting documentation
- `Dockerfile`, `docker-compose.yml`, `docker-compose.prebuilt.yml` (GHCR image
  override), `.dockerignore` - container packaging

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

To rename a column, change it in `schema.ts` and run `npm run db:generate`:
drizzle-kit asks, per column, whether it was created or renamed, and needs a
TTY to ask (in a non-interactive shell it exits with "Interactive prompts
require a TTY"; drive it through a pseudo-terminal and pick the rename option).
Choosing "create" emits DROP + ADD, which loses the data, so read the generated
SQL: it must be `ALTER TABLE … RENAME COLUMN`. See
`src/db/migrations/0005_rename_market_columns.sql` and its test in
`tests/db/migrations.test.ts`, which builds a database at the old schema, loads
rows, applies the migration, and checks the rows survived (`applyMigrations` in
`tests/helpers/migrations.ts` replays the generated SQL up to a given tag).

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
SQLite via `setupTestDb()`, and command tests mock Discord interactions via
the shared builders in `tests/helpers/interaction.ts`
(`fakeChatInputInteraction`, `fakeModalSubmitInteraction`,
`fakeButtonInteraction`, `fakeSelectMenuInteraction`,
`fakeAutocompleteInteraction`) rather than hand-rolling mocks per test. A
module-level `vi.mock(...)` (e.g. mocking `resolveCard`) is not auto-reset
between tests in this repo's Vitest config — call
`.mockReset()` in `beforeEach` yourself. Add or update tests alongside
behavior changes; do not weaken assertions to make a change pass.

## Behavior Notes

- Active listings expire 30 days after creation and are excluded from search
  and digests but retained with an `expired` status.
- Digest deduplication is driven solely by `servers.last_digest_at`; the
  watermark advances only after at least one configured delivery succeeds.
- Scryfall requests go through the rate-limited queue in
  `src/services/scryfall.ts`, with a 24-hour cache in the `card_cache` table
  keyed by name plus set/finish/variant/collector number.
- Each listing's Manapool link is resolved once, at card-resolution time, and
  frozen onto the row (`listings.market_url`) and the card cache — it is
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
  spamming the channel); it's a no-op when unset. Autocomplete failures are
  the exception: `src/events/interactionCreate.ts` logs them as warnings,
  since they are usually Discord's 3-second window closing and there is
  nothing to reply to.
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
  instead of the 3-second initial-ACK deadline. Every reply after that point
  must use `interaction.editReply()`/`followUp()`, never a bare `.reply()` —
  calling `.reply()` on an already-deferred interaction throws, which is
  exactly the bug class `resolveCardForCommand` and `/edit`'s invalid-condition
  path shipped with once already (see `src/utils/replies.ts` for the
  deferred-aware pattern to copy). Autocomplete can't be deferred, so card
  autocomplete makes one Scryfall attempt with no retry, and the handlers in
  `src/utils/cards.ts` send suggestions only if they're ready 2.5 seconds
  after Discord created the interaction.
- `src/index.ts` registers `process.on('unhandledRejection'/'uncaughtException')`
  handlers alongside the Discord client's own `Events.Error` handler, so an
  uncaught throw anywhere (e.g. inside a cron callback in
  `src/services/scheduler.ts`) still logs and fires a critical alert before
  the process exits, instead of dying silently and relying only on Docker's
  `restart: unless-stopped`.
- Digest delivery (`src/services/digest.ts`) sends with
  `allowedMentions: { parse: [] }` because the message body embeds a
  user-controlled Discord display name (`@${username}`); without it, a
  member named e.g. `everyone` would produce a literal `@everyone` in the
  channel. Any other outbound message that interpolates a listing's
  `username` as plain text (not inside an embed) needs the same guard. The
  digest is split into messages under Discord's 2,000-character limit
  (`splitDigestMessage`), and a destination counts as delivered only when
  every message arrives.
- Sealed product autocomplete (`autocompleteSealedProducts` in
  `src/services/sealed.ts`) labels each choice `Name (SET)` and sets its value
  to `uuid:<catalog uuid>`, not the name, because MTGJSON repeats some names
  across sets. `resolveSealedProduct` resolves that value by uuid; anything
  else is treated as a typed name. `sealedProductChoiceUuid` in
  `src/utils/constants.ts` tells the two apart.
- Games are chosen per server with `/admin games`, stored in
  `servers.enabled_games` (in the order they were enabled; the first is the
  game a command uses when the member names none). Every listing command
  resolves its game with `resolveGameForValue` (`src/games/resolve.ts`), in this
  order: the game tag on a picked autocomplete suggestion (`mtg:Black Lotus`),
  else the `game` option, else the server's first game, and rejects a game the
  server hasn't enabled. A server with several games gets one merged
  autocomplete whose values are all tagged; with one game the values and labels
  are untagged and identical to what they were before games existed. A disabled
  game's listings are kept but hidden from search and digests (a listing's own
  game decides its link label and fallback link), and the last enabled game
  can't be disabled. The `game` option isn't added to a command until a second
  game is registered, and a finish no registered game has (reverse holo) isn't
  offered. To add a game, build a `GameDefinition` and call `registerGame`; in
  a test, register a fake one with `tests/helpers/games.ts`.
- `language` (default English) is a listing attribute, fixed at posting, not a
  separate catalog; a catalog entry that fixes its language decides it, and a
  contradicting `language` option is rejected (`languageFor`). Graded slabs are
  `condition: graded` plus `grading_company` and `grade`, required together:
  the `grade` option (`PSA 10`, `BGS 9.5`) must be given exactly when the
  condition is graded, and `/edit` and the batch lines take a grade where they
  take a condition (`parseConditionOrGrade`).
- Pokémon singles and sealed product resolve against the local `catalog_sets`/`catalog_items`
  tables that `src/services/tcgcsv.ts` fills from TCGCSV (English and Japan
  categories), so autocomplete and posting never make a network call. The sync
  follows TCGCSV's usage guidelines and must keep doing so: one pass a day,
  `last-updated.txt` first, a `User-Agent` naming the app and version, at least
  100 ms between requests (150 by default), `If-None-Match` per group, and no
  prices requested or stored. It runs only while some server has Pokémon
  enabled (daily at 21:00 UTC, at boot when stale, and when `/admin games`
  enables it), imports each group in its own transaction, and stamps
  `catalog_sync_meta` only after a fully clean run. Sets are identified by
  TCGCSV's `groupId`, never by code, which is non-unique and sometimes empty.
  `base_normalized` (the product name without its trailing printing
  parenthetical) is what `listings.card_name_normalized` and `/search` key on,
  so every printing of a card matches. A product's image and TCGplayer link are
  derived from its id (`src/utils/tcgplayer.ts`) and the link is frozen onto
  `listings.market_url` at posting, like Magic's. A Pokémon autocomplete value is
  `id:<product id>` (tagged `pkm:` on a multi-game server); the Japanese catalog
  decides a listing's language. TCGCSV gives no collector number to
  sealed product, digital code cards, or about 3,100 older singles, so a
  product without one is classified from its name (`classifyProduct` in
  `src/utils/catalog-products.ts`): keyword rules, in order, give a sealed
  category, a card, or nothing (code cards are not stored). When that
  classification or any other part of how a product becomes a row changes, bump
  `IMPORT_VERSION` in `src/services/tcgcsv.ts`: each set records the version that
  imported it, and a set from an older one is fetched again without
  `If-None-Match`, which an unchanged ETag or `last-updated.txt` would otherwise
  prevent.

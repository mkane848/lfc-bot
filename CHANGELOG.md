# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `scripts/auto-update-prebuilt.sh` never deployed the image it pulled. It
  pulled `ghcr.io/mkane848/lfc-bot:latest` and then ran `docker compose up -d`,
  but `docker-compose.yml` runs the locally built `lfcbot:latest`. A bot started
  with the documented `docker run --name lfcbot` stayed on its old image, and
  compose could start a second copy of the bot next to it. Its "has the image
  changed" check read the size column of `docker compose images` rather than a
  digest, so it also redeployed on every run. A new `docker-compose.prebuilt.yml`
  override (enabled with `COMPOSE_FILE` in `.env`) now points the compose
  service at the GHCR image, optionally pinned with `LFCBOT_IMAGE`. The script
  compares the running container's image ID with the pulled one, recreates the
  container only when they differ, confirms it switched, and refuses to run
  while a legacy `lfcbot` container exists. `docs/DEPLOYMENT.md` covers the
  compose setup and moving an existing `docker run` install over, and now
  gives pinned tags with their `v` prefix (`:v1.6.0`, not `:1.6.0`).

## [1.6.0] - 2026-09-18

### Added

- Sealed product support in the batch commands: `/have-multi` and
  `/want-multi` gain an optional `type` option (`Cards` or `Sealed product`,
  defaulting to cards), and the modal adapts its labels and line format to
  match. A sealed line drops the condition column — `Product Name | price |
qty` for `/have-multi`, `Product Name | max_price` for `/want-multi`. Unlike
  the card path, a line naming a product that is not in the catalog still
  posts, with the raw name and no link, matching `/have-sealed`.
  A `type` option is workable here where it was not on `/have` and `/want`,
  because the batch commands take no required options for it to sit behind
  (`src/commands/user/have-multi.ts`, `want-multi.ts`,
  `src/utils/batch.ts`, `src/utils/customId.ts`).
- `/have-sealed` and `/want-sealed` commands for posting sealed product —
  booster boxes, bundles, prerelease kits, and Commander decks — mirroring
  `/have` and `/want` minus the single-card machinery. Neither command has a
  `condition`, `finish`, `variant`, or `collector_number` option, since none
  of them mean anything for a sealed box; `/want-sealed` takes `max_price`
  instead of `price` and omits `quantity`, matching `/want`.
- Sealed listings live in the existing `listings` table rather than a
  separate one: a new `kind` column (`card`/`sealed`, `NOT NULL DEFAULT
'card'`) plus nullable `sealed_uuid`, `sealed_category`, and
  `sealed_subtype` columns (`src/db/migrations/0004_sealed_product_support.sql`).
  Search, digests, expiry/TTL, the posting cooldown, `/fulfill`, and
  `/delete` therefore work for sealed rows with no code changes.
- A new `sealed_cache` table holding the full MTGJSON sealed-product catalog
  (roughly 4,000 products) and a single-row `sealed_catalog_meta` table
  tracking the last-seen MTGJSON build version, so the daily sync
  (`src/services/sealed.ts`) can skip re-downloading an ~11.6 MB payload that
  hasn't changed. The sync runs at 16:00 UTC (`src/services/scheduler.ts`),
  clear of MTGJSON's ~09:00 ET build regardless of DST, plus a
  fire-and-forget warm-up at boot (`src/events/ready.ts`) when the catalog is
  stale.
- Autocomplete for sealed product names and set codes is served entirely
  from the local `sealed_cache` table (`autocompleteSealedProducts`,
  `autocompleteSealedSets` in `src/services/sealed.ts`), making no external
  request per keystroke; the set option only offers codes that actually have
  sealed product.
- `resolveSealedProduct` looks up a Mana Pool product link for a matched
  catalog entry (`lookupManapoolSealedProduct`, `src/services/manapool.ts`).
  Only the canonical product URL is stored — no marketplace pricing is read
  or retained. A catalog miss still creates the listing with the raw
  typed name and no link, the opposite of the card path (which rejects an
  unresolved name), since a new release or store-exclusive drop may not be
  in the catalog yet.
- `/edit` support for sealed listings (`src/commands/user/edit.ts`): the
  modal omits the condition row for a sealed listing (sealed product is NM
  by definition), and changing the set re-resolves against the sealed
  catalog instead of Scryfall.
- Attribution for the two new upstream data sources: MTGJSON (sealed catalog
  data, MIT License) and Mana Pool (product links) credited in `README.md`,
  `TERMS_OF_SERVICE.md`, and `PRIVACY_POLICY.md`, alongside the existing
  Scryfall mentions. `README.md` also gains the Wizards of the Coast Fan
  Content Policy disclaimer, which was missing entirely despite the bot
  displaying Magic: The Gathering card and product data.

### Fixed

- Scryfall requires both a `User-Agent` and an `Accept` header and may block
  requests missing either; `src/services/scryfall.ts` sent only
  `User-Agent`, and its value was `LFCbot/<repo url>` — a bare URL where
  Scryfall documents a `name/version`. Now sends both headers, with
  `User-Agent` as `LFCbot/<version> (+<repo url>)`, the version read from
  `package.json` at runtime so it can't drift on release. Predates the
  sealed-product work and affects every card lookup, autocomplete request,
  and `/search`.

## [1.5.0] - 2026-08-30

### Added

- GitHub CodeQL code scanning (`javascript-typescript`) on every push to
  `main`, every pull request, and a weekly schedule. Runs on GitHub's free
  code-scanning tier since the repo is public.
- Retry-with-backoff (`src/utils/retry.ts`) for the two delivery paths the
  1.4.0 review flagged as giving up too easily:
  - Scryfall lookups now retry once on a network error, timeout, or non-404
    error response; a `404` is treated as a definitive not-found and is
    never retried.
  - Digest delivery (channel/DM send) now retries a transient Discord API
    failure within the same run instead of waiting for the next scheduled
    cron tick, which could be a full day away for a daily digest.
- `SECURITY.md` documenting how to report a vulnerability privately via
  GitHub's private security advisories.
- `docs/FAQ.md` (posting/editing/search/digest questions and MTG
  trading-safety norms — PayPal Goods & Services, tracked shipping, honest
  grading) and `docs/TROUBLESHOOTING.md` (self-hosting failure diagnosis),
  linked from `README.md` and `docs/index.md`.
- `process.on('unhandledRejection'/'uncaughtException')` handlers in
  `src/index.ts`, alongside the existing Discord client `Events.Error`
  handler, so an uncaught throw (e.g. inside the hourly maintenance cron)
  logs and fires a critical alert before the process exits instead of dying
  silently.
- JSDoc on every command handler (`src/commands/user/`, `src/commands/admin/`)
  and the previously-undocumented exports of `src/utils/validation.ts` and
  `src/utils/embeds.ts`.
- A command-handler and service test suite: `tests/commands/**` (one file
  per command, using a new shared mock-interaction builder,
  `tests/helpers/interaction.ts`) and `tests/services/listing-expiry.test.ts`
  / `tests/services/scheduler.test.ts`, which previously had no direct
  coverage despite running unattended on an hourly cron and touching data
  destructively. 126 → 221 tests.

### Changed

- `HANDOFF.md` rewritten from a stale pre-1.3 implementation plan (still
  describing the removed `/sell`/`/buy`/`/trade` commands) into a
  current-state technical reference matching the live command set, schema,
  and behavior.
- `/mylistings` page size raised from 2 to 5 listings per page.

### Fixed

- None of `/have`, `/want`, `/have-multi`, `/want-multi`, or `/edit` called
  `interaction.deferReply()` before resolving a card against Scryfall.
  Discord requires a reply or defer within 3 seconds, so a slow (not even
  down) Scryfall response could already cause "This interaction failed" for
  the user. All five commands now defer immediately, and the shared reply
  helpers (`src/utils/replies.ts`) send the real response via `editReply`/
  `followUp` once deferred.
- That fix didn't get threaded all the way through: `resolveCardForCommand`
  (used by `/have` and `/want`) and `/edit`'s invalid-condition path still
  called a bare `interaction.reply()` after the command had already
  deferred, which throws and surfaced a generic "Something went wrong"
  instead of the intended, specific error message — on every mistyped card
  name, the single most common way this bug could trigger. `/have` and
  `/want` also left card-name, price, and notes validation unguarded (only
  the collector-number field was wrapped in a try/catch), hitting the same
  generic-error path on an ordinary input mistake.
- `package-lock.json` had an internally inconsistent entry for `tsx`'s
  nested `esbuild@0.28.2` dependency (several required platform packages
  were missing), which made `npm ci` — and therefore the Docker build —
  fail. Regenerated the lockfile to fix it.
- `docs/index.md`'s Discord invite link used an overly broad OAuth
  permission integer (`274877906944`); corrected to match
  `docs/DEPLOYMENT.md`'s `84992`.
- `deploy_plan.md` specified Node 20; corrected to Node 24, matching the
  Dockerfile's actual base image.
- `PROJECT_REPOSITORY` (`src/utils/constants.ts`) was still the scaffolding
  placeholder (`github.com/example/lfcbot`), which fed directly into the
  Scryfall `User-Agent` header on every outbound request.
- `enforceCooldown` (`src/services/listings.ts`) fetched a user's entire
  listing history to read only the newest row's timestamp; added
  `.limit(1)`.

### Security

- Upgraded `vitest` 2 → 4, `drizzle-kit` 0.27 → 0.31, and
  `eslint-config-prettier` 9 → 10 (via Dependabot), resolving the
  moderate/high/critical advisories in the dev-only `vite`/`esbuild`
  dependency chain called out as an unaddressed follow-up in 1.4.0. These
  are dev tooling only and are not present in the production Docker image.
- Digest delivery (`src/services/digest.ts`) now sends with
  `allowedMentions: { parse: [] }`. The digest body embeds a user-controlled
  Discord display name as plain text (`@${username}`); without this, a
  member named e.g. `everyone` would produce a literal `@everyone` mention
  in the delivery channel.

### Removed

- `/admin games` subcommand. `enabledGames` was never read anywhere else
  (`/have`, `/want`, and `/search` all hardcode `game: 'mtg'`), so the
  command let an admin "disable" MTG without that doing anything. The
  handler (`src/commands/admin/games.ts`) is kept but unregistered, to
  re-enable once a second game is actually supported.

## [1.4.0] - 2026-08-29

### Added

- `/have-multi` and `/want-multi` commands to post up to 3 cards in one form,
  each with its own condition, price, and (for `have`) quantity — one line per
  card, shared accepts (cash/trade/both) for the batch. Cards that fail to
  parse or resolve are reported individually without blocking the rest of the
  batch from posting.
- Two dropdowns on `/mylistings` to delete or fulfill several of your active
  listings at once, alongside the existing per-listing buttons.
- A third `/mylistings` dropdown to edit several listings in sequence, reusing
  the existing `/edit` form for each one so every listing's changes stay
  independent.
- A `GET /health` endpoint (Discord-gateway readiness and a SQLite liveness
  check), backed by a Docker `HEALTHCHECK` so `docker compose ps` reports
  `healthy`/`unhealthy` directly.
- Dependabot (npm and GitHub Actions, weekly) and an `npm audit` CI step.
- Per-interaction correlation IDs: a `traceId` is generated for every Discord
  interaction and attached to its log lines, so one user's action can be
  traced end-to-end through the logs.
- Optional Discord webhook critical-error alerts (`DISCORD_ALERT_WEBHOOK_URL`)
  for fatal startup errors, Discord client errors, unhandled interaction
  errors, and total digest-delivery failures — no-ops if unset.
- Admin audit logging: every `/admin` subcommand invocation is recorded
  (admin, action, arguments, timestamp), viewable via the new
  `/admin history` subcommand.
- A public GitHub Pages site (`docs/index.md`, plus a legal page and Privacy
  Policy / Terms of Service for Discord app verification), deployed
  automatically on push to `main`.
- `scripts/auto-update.sh` for unattended cron-based deployment updates on a
  VM (fetches, rebuilds only if there are changes, verifies the container
  started, logs its actions) — inactive until scheduled with cron.

### Fixed

- `/edit` modal submissions were silently failing for every user — a customId
  parsing bug meant the handler always returned before loading the listing.
  Submitting the edit form appeared to do nothing (Discord would show "This
  interaction failed"). Fixed as part of adding the batch-edit flow above,
  which touches the same code path. The encode/decode logic for every
  interaction customId was subsequently extracted into tested pure functions
  (`src/utils/customId.ts`) to catch this class of bug going forward.

### Security

- Upgraded `drizzle-orm` 0.36 → 0.45.2, fixing a high-severity SQL injection
  advisory ([GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9))
  in how query identifiers were escaped. Upgraded `node-cron` 3 → 4.6.0 in the
  same pass, removing a vulnerable transitive dependency.

### Known gap

- The new `/have-multi`, `/want-multi`, and `/mylistings` batch-action
  dropdowns (delete/fulfill/edit, including the batch-edit "Edit next" button
  relay) are covered by type-checking, linting, and unit tests, but have not
  yet been exercised against a live Discord client — modals, select menus,
  and multi-step button flows are outside what this project's test suite can
  reach (see the Testing section in `AGENTS.md`/`CONTRIBUTING.md`). Do a
  manual click-through in a test guild before relying on them in production.
  This is exactly the kind of gap that let the `/edit` bug above ship
  unnoticed originally, so treat it as a real outstanding action, not a
  formality.

## [1.3.1] - 2026-08-28

### Fixed

- A card resolved with no set/finish/variant/collector number specified could
  land on a digital-only (MTGO/Arena) printing (e.g. Vintage Masters for
  "Black Lotus"), which has no real-world market and produced a broken
  Manapool link. Resolution now prefers a paper printing when one exists, and
  a Manapool link is only ever built for a paper printing.
- Changing a listing's set via `/edit` left its collector number, card image,
  and Manapool link pointing at the old printing. The card is now re-resolved
  against the new set (keeping any pinned finish/variant) and all of those
  fields are updated together; if the new set can't be resolved, the edit is
  rejected with a clear message instead of applying a mismatched state.

## [1.3.0] - 2026-08-27

### Added

- `/have` and `/want` commands, replacing `/sell`, `/buy`, and `/trade`, built
  on a two-axis listing model: `intent` (have/want) and `accepts` (cash,
  trade, or both).
- Optional exact-printing metadata on listings: set (now autocompleted),
  finish, variant, and collector number, resolved against a
  printing-filtered Scryfall search.
- Manapool integration: listings link out to their exact printing on
  manapool.com via a live lookup (`MANAPOOL_API_KEY`, optional) with a
  locally-built fallback link when the API key isn't set or the printing
  isn't carried; listing embeds and digest lines now show a "View on
  Manapool" link.

### Changed

- `/search` filters by `intent` and `accepts` instead of a single listing
  type; an `accepts: both` listing matches a filter for cash or trade.
- The daily digest groups listings into "New Haves" and "New Wants" instead
  of separate sell/buy/trade sections.
- The database migration backfills existing listings' `intent`/`accepts`
  from their prior `listing_type` (`sell` → have/cash, `buy` → want/cash,
  `trade` → have/trade) automatically at startup; no manual data migration
  is required.

### Removed

- `/sell`, `/buy`, and `/trade` commands (replaced by `/have` and `/want`).

## [1.2.0] - 2026-08-26

### Added

- `scripts/backup.sh`, a helper that snapshots the SQLite database from the
  Docker named volume to a compressed archive, restarts the bot, and prunes
  archives older than a configurable retention window.
- A documented path to run the bot from the prebuilt multi-architecture GHCR
  image instead of building from source.

## [1.1.0] - 2026-08-26

### Added

- Docker packaging for self-hosted and free-cloud deployment: a multi-stage
  `Dockerfile`, a `.dockerignore`, and a `docker-compose.yml` with a named
  `lfcbot-data` volume.
- A GitHub Actions release workflow that builds a multi-architecture image
  (amd64 and arm64), publishes it to GitHub Container Registry, and creates a
  GitHub Release whenever a `v*` tag is pushed.
- `docs/DEPLOYMENT.md` covering a shared bot your friends can invite and
  per-community free-VM setup (Oracle Cloud Free Tier and Google Cloud Free
  Tier), including SQLite backup guidance.
- Project documentation, including the MIT license, code of conduct, and
  contributing guide.

### Changed

- Bumped the runtime from Node.js 20 to Node.js 22+ (Node 24 in the Docker
  image and CI) to satisfy `better-sqlite3`'s engine requirement.
- The `/sell` command's `price` option is now optional, so members can post
  sell listings without specifying a price.

### Fixed

- Corrected the `DISCORD_GUILD_ID` documentation in `.env.example`; it accepts
  a single guild ID, not a comma-separated list.

## [1.0.0] - 2026-08-25

### Added

- Multi-server Discord bot for buying, selling, and trading Magic: The Gathering
  cards, with card data from the Scryfall API.
- Member-facing commands for creating, searching, editing, fulfilling, and
  deleting listings; editing, fulfilling, and deleting are restricted to the
  listing owner.
- `/admin` subcommands for server configuration, restricted to members with
  Discord's Manage Server permission.
- Per-guild digest schedules with deduplication driven by the
  `servers.last_digest_at` watermark, which advances only after a configured
  delivery succeeds.
- Rate-limited Scryfall client with a 24-hour card cache.
- Automatic Drizzle database migrations at startup.
- 30-day expiration for active listings, retained with an `expired` status and
  excluded from search and digests.
- Removal of a guild's data 30 days after the bot leaves that guild.
- CI workflow running lint, format check, type-check, and tests on every push
  to `main` and every pull request.

[Unreleased]: https://github.com/mkane848/lfc-bot/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/mkane848/lfc-bot/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/mkane848/lfc-bot/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/mkane848/lfc-bot/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/mkane848/lfc-bot/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/mkane848/lfc-bot/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mkane848/lfc-bot/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mkane848/lfc-bot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mkane848/lfc-bot/releases/tag/v1.0.0

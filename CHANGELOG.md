# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/mkane848/lfc-bot/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/mkane848/lfc-bot/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mkane848/lfc-bot/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mkane848/lfc-bot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mkane848/lfc-bot/releases/tag/v1.0.0

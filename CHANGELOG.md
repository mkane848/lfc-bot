# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-08-26

### Added

- Docker packaging for self-hosted and free-cloud deployment: a multi-stage
  `Dockerfile`, a `.dockerignore`, and a `docker-compose.yml` with a named
  `lfcbot-data` volume.
- `docs/DEPLOYMENT.md` covering a shared bot your friends can invite and
  per-community free-VM setup (Oracle Cloud Free Tier and Google Cloud Free
  Tier), including SQLite backup guidance.
- Project documentation, including the MIT license, code of conduct, and
  contributing guide.

### Changed

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

[Unreleased]: https://github.com/mkane848/lfc-bot/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/mkane848/lfc-bot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mkane848/lfc-bot/releases/tag/v1.0.0

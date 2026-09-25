# Contributing to LFCbot

Thanks for your interest in contributing. This project is open source under the
MIT license and welcomes contributions from the community.

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and
   `DISCORD_CLIENT_ID`. For development, also set `DISCORD_GUILD_ID` to a test
   server so commands are registered locally rather than globally.
4. Run the test suite with `npm test` and the linter with `npm run lint`.

## Code Style

- TypeScript with strict mode enabled.
- ESLint (with Prettier) is enforced in CI. Run `npm run lint:fix` and
  `npm run format` before pushing.
- Keep changes scoped to the task. Prefer the existing patterns in the
  codebase over new abstractions.

## Commands

- `npm run dev`: run the bot with hot reloading
- `npm run build`: compile TypeScript to `dist`
- `npm run type-check`: type-check without emitting
- `npm run lint`: lint the code
- `npm test`: run the Vitest suite
- `npm run db:generate`: generate a new Drizzle migration after schema changes

## Database Migrations

We use generated Drizzle migrations in development and production. After
changing `src/db/schema.ts`, run `npm run db:generate` and commit the generated
migration. Do not use `drizzle-kit push` as the production migration path.

## Tests

Tests live in `tests/`. Service tests mock the Scryfall client, database tests
run against in-memory SQLite, and command tests mock Discord interactions. Please
add or update tests that cover your change.

## Changelog

User-facing changes are documented in `CHANGELOG.md`, which follows the
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format. When your pull
request changes behavior, add an entry under the `Unreleased` section using the
appropriate type: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or
`Security`. Releases are tagged as `vMAJOR.MINOR.PATCH`.

## Releases

A release is an ordinary pull request. In it:

1. Bump the version: `npm version X.Y.Z --no-git-tag-version` (this updates
   `package.json` and `package-lock.json` together).
2. In `CHANGELOG.md`, move the `Unreleased` entries under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading and update the comparison links at the
   bottom.

Once it merges and CI passes on `main`, `.github/workflows/tag-release.yml`
tags the merge commit `vX.Y.Z` and runs the release workflow, which publishes
the Docker image (`:vX.Y.Z` and `:latest`) and the GitHub Release. Don't push
the tag yourself. Only plain `X.Y.Z` versions are tagged automatically, and
the workflow fails if `CHANGELOG.md` has no section for the new version.

## Pull Requests

- Open a PR against `main`.
- Keep the title concise and describe the change and motivation.
- Ensure CI (lint, format check, type-check, tests) passes.
- Reference any related issue.

## Reporting Issues

Use the issue templates to report bugs or request features. Include a clear
description, steps to reproduce, and, for bugs, any relevant logs.

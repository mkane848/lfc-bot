# Test coverage audit

Snapshot of the Vitest suite against `src/`. Generated locally with
[`@vitest/coverage-v8@5`](https://vitest.dev/guide/coverage) (installed ad hoc
with `npm install --no-save`; the lockfile is unchanged and `coverage/` is
already `.gitignore`d). `MANAPOOL_API_KEY` was unset for the run, per the
documented trap in the project's `steward` skill.

## Top-line

## Top-line

Without a `vitest.config.ts`, Vitest's default coverage include only counts
files imported by tests, so the 15 untested source files contributed 0 % to
the report without appearing in it. With the strict include now in
`vitest.config.ts` (counts every `src/**/*.ts`), the honest top-line is the
one below. The earlier 89.98 % figure was the *tested-fraction*, not the
project-fraction, and was misleading.

| Statements | Branches | Functions | Lines | Tests |
|---|---|---|---|---|
| **84.18 %** (1 613 / 1 916) | **75.46 %** (941 / 1 247) | **88.04 %** (302 / 343) | **84.27 %** (1 559 / 1 850) | 43 files, 335 tests |

## Coverage by directory

| Directory | % Stmts | % Branch | % Lines |
|---|---|---|---|
| `src/events` | 100.00 | 75.00 | 100.00 |
| `src/utils` | 94.65 | 86.80 | 94.52 |
| `src/services` | 90.64 | 85.42 | 91.21 |
| `src/commands/admin` | 90.47 | 75.58 | 91.01 |
| `src/db` | 80.39 | 60.00 | 80.39 |
| `src/commands/user` | 86.69 | 68.60 | 86.73 |

`src/events` only looks finished because the only tested file (`ready.ts`) is
heavily covered. Three sibling event handlers have no test file and therefore
do not appear in the report at all.

## Files with no matching test (structural gaps)

Listed in roughly descending order of blast radius. These contribute 0 % to
the totals because Vitest cannot report on what no test file imports.

| File | LOC | Risk | Why it matters |
|---|---|---|---|
| `src/events/interactionCreate.ts` | 99 | High | Single dispatch point for every incoming interaction: autocomplete, button, select menu, modal submit, chat input, plus the catch-and-alert error path. |
| `src/index.ts` | 79 | High | Entrypoint: env validation, migrations, signal traps (`SIGINT`/`SIGTERM`/`unhandledRejection`/`uncaughtException`), client wiring, graceful shutdown order. Bugs only surface in production boots. |
| `src/events/guildCreate.ts` | 10 | Medium | Composes `digest-state`, `listing-expiry`, and the `servers` upsert. |
| `src/events/guildDelete.ts` | 13 | Medium | Triggers the 30-day retention removal — verified only via dependencies, not the wiring itself. |
| `src/utils/cards.ts` | 44 | Medium | `handleCardAutocomplete`, `handleSetAutocomplete`, `resolveCardForCommand`, `searchKey` — exercised through command tests but never directly asserted. |
| `src/utils/embeds.ts` | 155 | Medium | 88.52 %: sealed-product branch (`formatSealedType`), `digestLine` linker, price formatter, `cardKey` are loosely hit. |
| `src/utils/replies.ts` | 64 | Medium | Helper for the "did the caller forget to `deferReply()`?" bug class AGENTS.md flags. The non-deferred branches on `replyWithListing` (line 22) and `replyPublicText` (line 62) are uncovered. |
| `src/utils/retry.ts` | 26 | Low | No direct test. Internals covered only through `sealed.test.ts` / `scryfall.test.ts` retries; `attempts=1` and clamp-at-`maxDelayMs` are unverified. |
| `src/utils/logger.ts` | 23 | Low | Used everywhere; one uncovered line, no assertions on log output. |
| `src/db/migrate.ts` | 36 | Medium | `findProjectRoot` walker — its "no `package.json`" throw path is uncovered; the dev-vs-built `migrationsFolder` resolution is unverified. |
| `src/db/index.ts` | 67 | Medium | 76 %: `getSqliteClient`, parent-directory creation, `closeDb` re-init-throw path not asserted directly. |
| `src/commands/admin/context.ts` | 23 | Medium | `requireGuild` returning `null` (DM-attempt guard) is uncovered. Every admin subcommand goes through it. |
| `src/commands/admin/games.ts` | 41 | Intentionally n/a | AGENTS.md: intentionally unregistered because `enabledGames` is not enforced. Re-track when enforcement lands. |
| `src/commands/index.ts` | 38 | Low | Command router and `commandMap`. Indirectly validated through every command test; the `data` export for deploy and Map ordering are not pinned. |
| `src/deploy.ts` | 29 | Low | Guild-vs-global branch is covered; `client.application === undefined` warn-and-skip path is not. |

## Files where the test exists but writes skim

| File | % Stmts | What's missing |
|---|---|---|
| `services/scheduler.ts` | 70.58 | Cron lifecycle, `stopAllJobs`/`removeServerDigest`, maintenance-job start, sealed-catalog cron — undertested for a module that schedules every per-server digest and the retention removal. |
| `services/alerts.ts` | 73.91 | Webhook send path: constructor, send, and the 5-minute cooldown are not asserted. |
| `services/digest.ts` | 75.86 | DM delivery and partial-failure rollback. Channel path heavily covered; DM-target and per-server fallback branches are the gap. |
| `commands/user/want.ts` | 77.02 | Single-card `/want` flow: lines 93, 107-108, 143 — early-return edges like "card name already used". |
| `commands/user/have.ts` | 80.00 | Mirror gap to `want.ts`. |
| `commands/user/mylistings.ts` | 83.00 | Batch select menu and `handleBatchSelect` not fully covered. |
| `commands/user/want-multi.ts` | 87.14 | Function coverage at 80 % — multi-listing resolve + insert. |
| `commands/user/edit.ts` | 86.04 | Lines 40, 255, 260-261 — edit modal owner-check edge and the "edit another" button branch. |
| `services/sealed.ts` | 98.00 | Line 196 — likely the prune-when-fresh branch. |

Branch coverage is consistently ~10 points below line coverage on command files
(e.g. `have.ts` 80 % stmts vs 55.26 % branches) because error / early-return
edges are not asserted.

## Patterns that look healthy

- **Near-100 % modules**: `events/ready.ts` (100/75), `services/listings.ts`
  (100/95.5), `services/manapool.ts` (95.83/95), `services/sealed.ts`
  (98/95), `utils/customId.ts` (100/96.77), `utils/validation.ts`
  (95.45/96.96), `commands/admin/admin.ts` (97.67/87.5).
- **Test density is honest**: `tests/commands/user/edit.test.ts` 16 cases / 4
  describe; `tests/services/listings.test.ts` 21 / 6;
  `tests/services/sealed.test.ts` 26 / 5.
- **Module-level `vi.mock` reset is honored** in
  `tests/events/ready.test.ts` (`.mockReset()` in `beforeEach`), as AGENTS.md
  requires against the no-`vitest.config.ts` config.
- **Shared interaction builder** (`tests/helpers/interaction.ts`) is used
  consistently for command tests.

## Patterns worth tightening

1. **No `vitest.config.ts`.** Without one, `@vitest/coverage-v8` runs with
   defaults and module-level mocks do not auto-reset. Adding a minimal config
   with `coverage.include = ['src/**/*.ts']` (so the 15 untested files show as
   0 % rather than being absent) and `coverage.thresholds` would make CI
   integration trivial.
2. **Hermetic test env.** `MANAPOOL_API_KEY` is read from the test runner's
   environment in `tests/services/scryfall.test.ts`. Either stub it in
   `beforeEach` or use `vi.stubEnv` so the test does not depend on the
   developer's shell.
3. **77 -> 90 % branch coverage is the highest-leverage swing.** Most
   uncovered branches are early-return / "already-used" / "not in guild"
   guards. A handful of negative-path tests per command would move branches
   above 85 % without touching the well-tested happy paths.
4. **Three event handlers and `src/index.ts` have no test file** and these
   are the modules most likely to silently break and most expensive to debug
   in production.

## Suggested coverage targets

| Tier | Goal | Effort |
|---|---|---|
| Bronze | Statements >= 90 %, branches >= 80 % (today: 89.74 / 79.05) | Add ~6 small tests: `interactionCreate` button/modal dispatch, `cards.ts` autocomplete shape, `replies.ts` non-deferred branch, `context.ts` no-guild guard, `migrate.ts` `findProjectRoot` failure. |
| Silver | Statements >= 92 %, branches >= 85 % | Cover `scheduler.ts` cron lifecycle, `digest.ts` DM path, `alerts.ts` webhook + cooldown, embed builder sealed/price branches. |
| Gold | Statements >= 95 %, branches >= 90 %, integration smoke for `src/index.ts` startup + graceful shutdown | Spin up `Client` once with a stubbed Discord gateway and assert signal-trap wiring, deploy-mode selection, and shutdown ordering. |

The roughly 14-point gap between *structural* (15 untested files) and *line*
coverage (89.98 %) shows the suite is honest where it exists. The work is to
widen the floor, not raise the ceiling on what is already tested.

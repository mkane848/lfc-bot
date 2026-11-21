# Test coverage audit

Snapshot of the Vitest suite against `src/`, taken 2026-11-21, generated with
[`@vitest/coverage-v8`](https://vitest.dev/guide/coverage):

```
npm test -- --coverage
```

`MANAPOOL_API_KEY` was unset for the run so the numbers match CI.

## Top-line

| Statements | Branches | Functions | Lines | Tests |
|---|---|---|---|---|
| **96.80 %** (2 606 / 2 692) | **90.61 %** (1 631 / 1 800) | **96.00 %** (504 / 525) | **97.02 %** (2 510 / 2 587) | 75 files, 1 031 passing + 10 expected fail |

`vitest.config.ts` uses the strict `src/**/*.ts` include, so a source file with
no test counts as 0 % instead of disappearing from the report. Excluded from
the denominator: `src/db/migrations/**` (generated SQL), `src/types/**`
(type-only), and `src/deploy.ts` (a one-shot command script with no unit
surface — its guild-vs-global branch is exercised indirectly by the command
registry test).

## Coverage by directory

| Directory | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| `src/` (entrypoint) | 100.00 | 100.00 | 100.00 | 100.00 |
| `src/commands` | 95.74 | 85.95 | 97.87 | 95.85 |
| `src/db` | 91.07 | 90.00 | 80.00 | 91.07 |
| `src/events` | 98.51 | 89.47 | 100.00 | 98.51 |
| `src/games` | 95.04 | 88.10 | 92.31 | 94.70 |
| `src/services` | 97.68 | 94.18 | 94.76 | 98.34 |
| `src/utils` | 98.08 | 92.67 | 99.07 | 98.03 |

`src/index.ts` is the entrypoint smoke in `tests/index.test.ts`: it imports the
module with Discord, the database, the schedule, and the health server mocked,
then drives startup, `ClientReady`, every event, both signal handlers, and the
fatal-startup path. It covers the wiring that only shows up in production
boots.

## Where the gap is

Files with the lowest statement coverage, in ascending order:

| File | % Stmts | % Branch | % Lines | What's missing |
|---|---|---|---|---|
| `src/games/pokemon.ts` | 80.00 | 100.00 | 80.00 | Game metadata wiring. |
| `src/utils/version.ts` | 80.00 | 50.00 | 80.00 | Cache/fallback branch. |
| `src/db/schema.ts` | 84.21 | 100.00 | 84.21 | Index declarations with no observable behavior. |
| `src/commands/user/want-multi.ts` | 84.88 | 76.00 | 84.33 | Malformed batch line and early-return edges. |
| `src/games/registry.ts` | 85.71 | 100.00 | 85.71 | Duplicate-registration guard. |
| `src/services/scheduler.ts` | 88.33 | 81.25 | 89.65 | Cron lifecycle and job removal. |
| `src/commands/admin/digest.ts` | 89.47 | 91.66 | 89.47 | Empty-digest reply. |
| `src/commands/user/delete.ts` | 89.47 | 87.50 | 89.47 | Already-closed guard. |
| `src/utils/permissions.ts` | 90.90 | 77.77 | 90.90 | Permission-denied branches. |
| `src/db/migrate.ts` | 91.66 | 75.00 | 91.66 | `findProjectRoot` failure path. |

Branch coverage is the limiting dimension at 90.61 %. The remaining sharp
edges are the DM-target and per-server fallback branches in `digest.ts`, the
no-guild guards, and the scheduler's cron callbacks.

## The gate

`vitest.config.ts` holds the `coverage.thresholds` that CI enforces via
`npm test -- --coverage`, and uploads `coverage/` as a workflow artifact on
every run (including failures) so a drop can be inspected from the PR page.

| | Gate | Measured |
|---|---|---|
| Statements | 96 | 96.80 |
| Branches | 90 | 90.61 |
| Functions | 95 | 96.00 |
| Lines | 97 | 97.02 |

These thresholds are a ratchet: a PR that measurably improves coverage should
raise them in the same commit, and none may lower them. The margins are
deliberately thin on lines — that is what makes the gate useful.

The function threshold sits one point below the measured value because it is
the smallest denominator (525 functions), so a single refactor that deletes a
well-covered helper moves it further than the other dimensions.

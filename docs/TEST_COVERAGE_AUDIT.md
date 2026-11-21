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
| **97.91 %** (2 636 / 2 692) | **91.55 %** (1 648 / 1 800) | **97.90 %** (514 / 525) | **98.18 %** (2 540 / 2 587) | 80 files, 1 057 passing + 10 expected fail |

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
| `src/commands` | 97.33 | 87.42 | 99.29 | 97.47 |
| `src/db` | 98.21 | 95.00 | 100.00 | 98.21 |
| `src/events` | 98.51 | 89.47 | 100.00 | 98.51 |
| `src/games` | 97.16 | 88.10 | 98.08 | 96.97 |
| `src/services` | 98.23 | 94.83 | 95.81 | 98.93 |
| `src/utils` | 98.50 | 93.38 | 99.07 | 98.46 |

`src/index.ts` is covered by the entrypoint smoke in `tests/index.test.ts`,
which drives startup, `ClientReady`, every event, both signal handlers, and the
fatal-startup path with Discord, the database, the schedule, and the health
server mocked.

## Where the gap is

Files with the lowest statement coverage, in ascending order:

| File | % Stmts | % Branch | % Lines | What's missing |
|---|---|---|---|---|
| `src/commands/user/have-multi.ts` | 91.86 | 84.00 | 91.56 | The batch's creation catch and duplicate-warning line, mirroring `want-multi`. |
| `src/commands/user/edit.ts` | 92.45 | 78.65 | 92.45 | "Edit another" button and the modal owner-check edges. |
| `src/utils/schedule-parser.ts` | 92.50 | 82.60 | 92.50 | Natural-language schedule fallbacks. |
| `src/services/card-cache.ts` | 94.44 | 100.00 | 94.11 | The `expiresAt` prune where a row survives. |
| `src/services/health.ts` | 94.73 | 91.66 | 94.73 | The degraded-status branch. |
| `src/games/autocomplete.ts` | 95.31 | 88.63 | 94.91 | A game's suggestions missing the deadline. |
| `src/commands/user/want.ts` | 95.45 | 79.16 | 95.45 | Early-return edges ("name already used", invalid condition). |
| `src/services/manapool.ts` | 95.83 | 95.00 | 100.00 | The price-lookup miss. |
| `src/db/index.ts` | 96.00 | 93.75 | 96.00 | Parent-directory creation and the `closeDb` re-init throw. |
| `src/commands/user/want-sealed.ts` | 96.22 | 76.92 | 96.22 | Sealed validation guards. |

Branch coverage is the limiting dimension at 91.55 %. What is left is mostly
one-line defensive guards (a `slot === undefined` fallback, a missing-row
return that another caller already checks) plus the negative edges in
`edit.ts` and `want-sealed.ts`.

## The gate

`vitest.config.ts` holds the `coverage.thresholds` that CI enforces via
`npm test -- --coverage`, and uploads `coverage/` as a workflow artifact on
every run (including failures) so a drop can be inspected from the PR page.

| | Gate | Measured |
|---|---|---|
| Statements | 97 | 97.91 |
| Branches | 91 | 91.55 |
| Functions | 97 | 97.90 |
| Lines | 98 | 98.18 |

These thresholds are a ratchet: a PR that measurably improves coverage should
raise them in the same commit, and none may lower them.

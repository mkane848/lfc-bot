# Test coverage audit

Snapshot of the Vitest suite against `src/`, taken 2026-11-21, generated with
[`@vitest/coverage-v8@5.1`](https://vitest.dev/guide/coverage):

```
npm test -- --coverage
```

`MANAPOOL_API_KEY` was unset for the run so the numbers match CI.

## Top-line

| Statements | Branches | Functions | Lines | Tests |
|---|---|---|---|---|
| **95.17 %** (2 562 / 2 692) | **90.38 %** (1 627 / 1 800) | **93.71 %** (492 / 525) | **95.40 %** (2 468 / 2 587) | 74 files, 1 020 passing + 10 expected fail |

`vitest.config.ts` uses the strict `src/**/*.ts` include, so a source file with
no test counts as 0 % instead of disappearing from the report. Excluded from
the denominator: `src/db/migrations/**` (generated SQL), `src/types/**`
(type-only), and `src/deploy.ts` (a one-shot command script with no unit
surface — its guild-vs-global branch is exercised indirectly by the command
registry test).

## Coverage by directory

| Directory | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| `src/` (entrypoint) | 0.00 | 0.00 | 0.00 | 0.00 |
| `src/commands` | 95.74 | 85.95 | 97.87 | 95.85 |
| `src/db` | 91.07 | 90.00 | 80.00 | 91.07 |
| `src/events` | 98.51 | 89.47 | 100.00 | 98.51 |
| `src/games` | 95.04 | 88.10 | 92.31 | 94.70 |
| `src/services` | 97.64 | 94.00 | 94.68 | 98.31 |
| `src/utils` | 98.08 | 92.67 | 99.07 | 98.03 |

## Where the gap is

Files with the lowest statement coverage, in ascending order:

| File | % Stmts | % Branch | % Lines | What's missing |
|---|---|---|---|---|
| `src/index.ts` | 0.00 | 0.00 | 0.00 | The whole entrypoint: env validation, migrations, signal traps, client wiring, graceful shutdown. No test imports it. |
| `src/games/pokemon.ts` | 80.00 | 100.00 | 80.00 | Game metadata wiring. |
| `src/utils/version.ts` | 80.00 | 50.00 | 80.00 | Cache/fallback branch. |
| `src/db/schema.ts` | 84.21 | 100.00 | 84.21 | Index declarations with no observable behavior. |
| `src/commands/user/want-multi.ts` | 84.88 | 76.00 | 84.33 | Malformed batch line and early-return edges. |
| `src/games/registry.ts` | 85.71 | 100.00 | 85.71 | Duplicate-registration guard. |
| `src/services/scheduler.ts` | 88.33 | 81.25 | 89.65 | Cron lifecycle and job removal. |
| `src/commands/admin/digest.ts` | 89.47 | 91.66 | 89.47 | Empty-digest reply. |
| `src/commands/user/delete.ts` | 89.47 | 87.50 | 89.47 | Already-closed guard. |

Branch coverage now sits at 90.28 %, so the remaining sharp edges are narrow:
the DM-target and per-server fallback branches in `digest.ts`, the no-guild
guards, and the scheduler's cron callbacks.

## The gate

`vitest.config.ts` holds the `coverage.thresholds` that CI enforces via
`npm test -- --coverage`, and uploads `coverage/` as a workflow artifact on
every run (including failures) so a drop can be inspected from the PR page.

| | Gate | Measured |
|---|---|---|
| Statements | 95 | 95.17 |
| Branches | 90 | 90.38 |
| Functions | 90 | 93.71 |
| Lines | 95 | 95.40 |

This is the **Gold** tier from the original audit, and it is a ratchet: a PR
that measurably improves coverage should raise the thresholds in the same
commit, and none may lower them. The margins are deliberately thin on
statements and lines — that is what makes the gate useful.

Gold also called for an integration smoke for `src/index.ts` startup and
graceful shutdown. That is the one item still open: the file is 0 % covered
and is worth roughly 2 points of statements and 3 of lines on its own, so it
would put real headroom under the thresholds rather than leaving them on the
edge.

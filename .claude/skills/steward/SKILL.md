---
name: steward
description: Repo-specific conventions for driving an lfc-bot pull request to green — what to run before pushing, two environment traps that produce failures CI never sees, how to update a branch, and which files are generated rather than hand-edited.
---

# Stewarding lfc-bot pull requests

Guidance for fixing CI, answering review comments, and getting a pull request
mergeable in this repository. It covers local conventions and how proactive to
be; it does not loosen any rule your operating instructions state as "never" —
in particular, never skip, disable, or quarantine a test to reach green, never
push an empty commit to kick CI, and never rewrite history on a branch you did
not create.

## The gate before every push

`.github/workflows/ci.yml` runs these on Node 24. Run them locally first — a
push that turns CI red costs a review cycle.

```bash
npm run lint
npm run format:check
npm run type-check
npm test
```

CI also runs `npm audit --omit=dev --audit-level=high`, which is **blocking**:
a high or critical vulnerability in a production dependency fails the build. A
second audit pass covers dev-only tooling and is `continue-on-error`, so a
finding there is visible in the log but is not a gate.

Never hand-format to satisfy `format:check` — run `npm run format`. Prettier
owns 100-column width, single quotes, and trailing commas.

## Two environment traps that produce false failures

Both cost real time. Rule them out before concluding anything is broken.

### `MANAPOOL_API_KEY` breaks a scryfall test

With that variable set in your shell, `tests/services/scryfall.test.ts` →
"retries a transient failure once before falling back" fails, asserting 2 fetch
calls but seeing 3. `resolveCard` in `src/services/scryfall.ts` reaches
`lookupManapoolPrinting`, and `src/services/manapool.ts` returns `null` with no
network call **only** when the key is unset — so a third fetch appears that the
test never stubbed.

CI has no key, which is why CI is green. Reproduce CI's environment:

```bash
env -u MANAPOOL_API_KEY npm test
```

Do not report this as a defect on `main` or as a pre-existing failure — it is
neither. The test reads ambient environment instead of stubbing the key, so it
passes or fails depending on who runs it. Making it hermetic is a fair
standalone change, but it is not any PR's fault.

### `npm ci` can fail locally while CI is fine

CI uses Node 24's npm. An older local npm may compute a different ideal tree and
reject the lockfile with `Missing: <pkg> from lock file`. Use `npm install` to
get a working `node_modules`, then restore the lockfile before committing:

```bash
git checkout -- package-lock.json
```

A lockfile change belongs in a pull request only when updating dependencies is
the point of that pull request. Dependabot owns routine bumps.

## Updating a branch against main

Every commit on `main` is a GitHub merge commit (`Merge pull request #N`). Bring
the base in with a merge, not a rebase:

```bash
git fetch origin main && git merge origin/main
```

## Files that are generated, never hand-edited

- **Migrations.** After changing `src/db/schema.ts`, run `npm run db:generate`
  and commit the generated SQL together with the `meta/` files under
  `src/db/migrations/`. `drizzle-kit push` is not the production migration path
  — do not reach for it.
- **`package-lock.json`.** Through `npm install`, never by hand.

## CHANGELOG is easy to forget

`CONTRIBUTING.md` requires a `CHANGELOG.md` entry under `## [Unreleased]` for
any user-facing change, typed per Keep a Changelog (`Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed`, `Security`). Internal refactors and test-only
changes do not need one. If a pull request changes behavior and has no entry,
add it rather than waiting for a reviewer to ask.

## Test conventions that cause real failures

- **Module-level `vi.mock` is not auto-reset.** There is no `vitest.config.ts`,
  so call `.mockReset()` yourself in `beforeEach`; otherwise a mock configured
  in one test leaks into the next.
- **Use the shared interaction builders** in `tests/helpers/interaction.ts`
  (`fakeChatInputInteraction`, `fakeModalSubmitInteraction`,
  `fakeButtonInteraction`, `fakeSelectMenuInteraction`,
  `fakeAutocompleteInteraction`) rather than hand-rolling discord.js mocks.
- **The ESLint carve-out is narrow.** `unbound-method` and
  `no-unsafe-assignment` are disabled only for `tests/commands/**` and
  `tests/helpers/interaction.ts` (`eslint.config.js`). Asserting on a mock
  method from a test outside those paths fails `npm run lint`, so keep
  interaction assertions under `tests/commands/`.
- Database tests use `setupTestDb()` from `tests/helpers/db.ts` (in-memory
  SQLite).

## Dependabot pull requests

Dependabot runs weekly for npm and github-actions, capped at 10 open npm pull
requests, so several are usually open at once. Green CI is most of the signal
for a patch or minor bump. For a major, read the upstream changelog for breaking
changes before treating green CI as sufficient — the suite does not exercise
everything.

## Conventions worth not breaking

- Relative imports carry `.js` specifiers (ESM `NodeNext` resolution).
- Prices are stored in integer cents; timestamps are Unix milliseconds.
- Preserve `card_name_normalized` when touching the listing flow.
- Commands are guild-only; do not add privileged intents.
- Branch prefixes: `fix/`, `feature/`, `docs/`, `refactor/`.

`AGENTS.md` is the fuller reference for conventions and behavior notes;
`CONTRIBUTING.md` covers the contribution workflow. This file is the subset that
tends to bite during a pull request.

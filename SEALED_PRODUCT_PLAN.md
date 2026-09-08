# Sealed Product Support — Final Implementation Plan

Status: **ready to implement** — this is the build spec, hand it to an implementing agent.

This document replaces the proposal merged in
[PR #55](https://github.com/mkane848/lfc-bot/pull/55). That earlier revision (see this
file's git history) was research with several open questions; every one of them has since
been resolved against live sources, and five of its design decisions were reversed. §2
lists what changed and why, §3 records what was verified.

## 1. Context

LFCbot members can post `/have` and `/want` listings for MTG **singles** only. Sealed
product (booster boxes, bundles, prerelease kits, Commander decks) is a first-class part
of how people actually trade, and today those listings can't be posted at all — the card
path resolves through Scryfall, which has no sealed data.

The goal is to let members post sealed listings that behave like card listings in every
downstream system (search, digests, TTL/expiry, cooldown, edit/fulfill/delete, admin
flows) without re-architecting the listing pipeline.

The lever that makes this cheap: sealed listings are rows in the **existing `listings`
table**, storing the product name in `card_name` / `card_name_normalized`. Because
`searchListings` (`src/services/listings.ts:130`), `prepareDigestListings`
(`src/services/digest-state.ts:27`), `expireListings`, and `digestLine`
(`src/utils/embeds.ts:114`) are all driven off those columns, they work for sealed rows
with **zero changes**.

A new `sealed_cache` table, seeded daily from MTGJSON, drives autocomplete and
canonicalization. Mana Pool supplies the live link and a price hint, exactly as it does
for singles today.

## 2. Decisions taken during review (these override the proposal doc)

| # | Decision | Why |
|---|---|---|
| 1 | **Separate `/have-sealed` and `/want-sealed` commands**, not a `type` option on `/have`/`/want` | Discord requires required options before optional ones, so a `type` option must sit after the required `card_name`. A user filling left-to-right would get *card* autocomplete before ever reaching `type`. Separate commands also drop `condition` cleanly (see #2) and leave `/have`/`/want` completely untouched — zero regression risk. |
| 2 | **No `condition` option on the sealed commands** | Sealed is NM by definition. Discord can't express "required only when type=card", so the proposal's conditional-required `condition` would have meant demoting it to optional on `/have` — a real regression for existing card users. Separate commands sidestep this entirely. |
| 3 | **Free-text fallback for sealed only** | A product not in the catalog (new release, Store-Only drop, custom lot) still creates a listing with the raw name and no metadata or link. Note this is **new behavior, not reuse**: the free-text path in `scryfall.ts:264` is currently dead code because `resolveCardForCommand` (`src/utils/cards.ts:31-37`) hard-rejects unresolved cards. The card path stays strict and unchanged. |
| 4 | **Mana Pool enrichment ships in v1** (link + price hint) | Reversed from the first draft once the egress allowlist was opened. The endpoint is now fully verified end-to-end against a live key — see §3.2. One call per listing returns both the canonical URL and the price. |
| 5 | **Truncate product names to 100 chars at sync time** | 4 of 4,210 products exceed Discord's 100-char cap on autocomplete choice name *and* value, and `validateCardName` throws above 100. Verified: truncating to 100 leaves all **4,210 normalized names still unique**, so every product still resolves exactly. The loss is cosmetic on 4 labels, and `validateCardName` needs no change. |

## 3. Verified facts

Everything below was checked against live sources during this review, not assumed.

### 3.1 MTGJSON catalog

Fetched `https://mtgjson.com/api/v5/SetList.json` — `5.3.0+20260907`, 11,641,814 bytes.

- **4,210 sealed products across 345 of 869 sets** — proposal's numbers confirmed exactly.
- Fields confirmed present: `uuid`, `name`, `setCode`, `category`, `subtype`,
  `identifiers.tcgplayerProductId`, `releaseDate`, `purchaseUrls`, `contents`.
- `setCode` present on **all 4,210** and always equal to the parent set's `code` — read it
  off the product; no need to thread the parent set through.
- `category` (14 distinct) and `subtype` (48 distinct) present on **100%** of products.
- **`releaseDate` on only 2,340/4,210 and `cardCount` on 2,622** — the proposal's
  "tie-break on most recent `releaseDate`" would have been unusable. Moot anyway:
- **Product names are globally unique under `normalizeCardName`** (4,210/4,210 distinct),
  before *and* after truncation to 100 chars. **Proposal open question §9.2 is resolved —
  no ambiguity policy is needed.**

### 3.2 Mana Pool sealed API — proposal open question §9.1, now answered

`GET https://manapool.com/api/v1/products/sealed`, header `X-ManaPool-Access-Token`.
Verified live. **A single call returns both the link and the prices — `/prices/sealed` is
not needed at all.**

```json
{"meta":{"as_of":"2026-09-08T14:28:57.687Z"},
 "data":[{"url":"https://manapool.com/sealed/blb/bundle","product_type":"mtg_sealed",
   "product_id":"11f2a7e8-...","set_code":"BLB","name":"Bloomburrow Bundle",
   "tcgplayer_product_id":541241,"language_id":"EN",
   "low_price":20346,"price_market":15000,"available_quantity":2,
   "recent_sales":[{"created_at":"...","price":24498,"quantity":1}, ...]}]}
```

Five findings that directly shape the implementation:

1. **There is no `price_cents` field.** Singles use `price_cents`
   (`manapool.ts:69`); sealed uses **`low_price`** and **`price_market`**, both integer
   cents. A parser copied from `lookupManapoolPrinting` would silently always yield null.
2. **`low_price: 0` means "none in stock", not "free".** Across a 20-product sample,
   `low_price === 0` in exactly the 11 rows where `available_quantity === 0` — a perfect
   correlation. **Must coerce `0` to `null`** or listings render "$0.00".
3. **`price_market` is unreliable** — 0 in 14 of 20 rows, including 3 rows that *do* have
   stock. Use `low_price` (the real lowest ask) for the hint; ignore `price_market`.
4. **`mtgjson_uuids` is parsed as an array, not a comma-separated string.** Comma-joining
   returns `400 {"code":"invalid_format","message":"Invalid UUID","path":["mtgjson_uuids",0]}`.
   Batching requires the repeated-parameter form
   (`?mtgjson_uuids=a&mtgjson_uuids=b`). **v1 sends one uuid per call, so this doesn't
   arise** — but it's the reason batching is not worth it (see #5).
5. **The response does not echo the MTGJSON uuid, and row order does not match request
   order.** Batched responses could only be mapped back via `tcgplayer_product_id`, which
   is `null` for the 773 products that lack one — so batch mapping would need a
   name+set fallback. One-uuid-per-call sidesteps this entirely.

**Coverage is far better than the proposal assumed.** It cited ~82% from
`tcgplayerProductId` presence in MTGJSON, but that is not what Mana Pool keys on — it
resolves the MTGJSON uuid directly. Across 45 products sampled (recent sets, oldest sets,
an even spread across the whole catalog, and 5 chosen specifically for having **no**
`tcgplayerProductId`), **45/45 returned a row with a usable `url`**. About a third carry a
nonzero `low_price`; the rest are out of stock but still yield a valid link.

An unknown-but-well-formed uuid returns **`200` with `data: []`**, not a 404 — so the
existing "empty data ⇒ null" guard is the right shape.

### 3.3 Discord limits

Autocomplete choice `name` and string `value` are both capped at **100 characters**, max
**25 choices** per response.

### 3.4 Environment note for whoever implements this

`manapool.com` is reachable from cloud sessions only if the environment's **Network
access** is **Custom** with `manapool.com` allowed, and `MANAPOOL_API_KEY` is set in the
environment's variables. Both are configured now.

The session proxy drops `manapool.com` connections **intermittently** — several
`SSL_ERROR_SYSCALL` / `Connection reset` failures appeared between identical calls that
succeeded on retry (the proxy logs them as `ws_closed_mid_exchange`). This is the sandbox
relay, not the API, and not production. **Retry before concluding the endpoint is broken.**
Do not add a retry to the client for it — `lookupManapoolPrinting` doesn't retry either,
and null-on-failure is the correct behavior for an optional hint.

## 4. Data model

### 4.1 `listings` — five new columns (`src/db/schema.ts:20-60`)

```ts
kind: text('kind').notNull().default('card'),
sealedUuid: text('sealed_uuid'),
sealedCategory: text('sealed_category'),
sealedSubtype: text('sealed_subtype'),
marketPriceCents: integer('market_price_cents'),
```

`marketPriceCents` is the Mana Pool `low_price` frozen at creation, kept distinct from
`priceCents` (the user's own asking price). Populated for sealed only in v1; wiring the
card path to it is a one-line follow-up, deliberately out of scope.

Card-only columns (`finish`, `variant`, `collectorNumber`, `condition`, `cardImageUrl`)
stay `null` on sealed rows. Existing rows become `kind='card'` via the constant default —
**no backfill**, so the two-pass NOT NULL dance in `AGENTS.md:95-111` does not apply.

### 4.2 New `sealed_cache` table

A full catalog index, not a per-lookup TTL cache like `card_cache`. Use the
**object-return** index form to match every other table in the file (`schema.ts:49-59`) —
the proposal used the newer array form, which would be inconsistent.

```ts
export const sealedCache = sqliteTable(
  'sealed_cache',
  {
    uuid: text('uuid').primaryKey(),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    setCode: text('set_code').notNull(),
    category: text('category').notNull(),
    subtype: text('subtype'),
    releaseDate: text('release_date'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => {
    return {
      normalizedIdx: index('sealed_cache_normalized_idx').on(table.nameNormalized),
      setIdx: index('sealed_cache_set_idx').on(table.setCode),
    };
  },
);
```

Export `SealedCacheRow` / `NewSealedCacheRow` via the existing `$inferSelect` /
`$inferInsert` pattern (`schema.ts:97-107`).

**Deliberately no `tcgplayer_product_id` column.** The proposal included one as the Mana
Pool join key, but §3.2 established that Mana Pool keys on the MTGJSON uuid directly and
resolves products that have no TCGplayer ID at all. The column would be dead weight.

### 4.3 Migration

One `npm run db:generate`, commit the SQL **and** `meta/` under `src/db/migrations/`, then
`npm run db:check`. Never `drizzle-kit push` (`AGENTS.md:95`).

**Verify the generated SQL** rather than assuming: adding `NOT NULL DEFAULT 'card'` should
emit a plain `ALTER TABLE ADD COLUMN`, but drizzle-kit does full table rebuilds on
nullability changes (see `0002_listings_intent_accepts_not_null.sql`). Either is correct;
just confirm the three `listings` indexes survive if it rebuilds.

## 5. Services

### 5.1 `src/services/manapool.ts` — add a sealed lookup

Mirror `lookupManapoolPrinting` (`:42-77`) exactly: read `MANAPOOL_API_KEY` **per call**,
return `null` with no network when unset, reuse the module's existing `limiter` (`:17-35`)
and the 15s `AbortController`, and collapse every failure to `null`.

```ts
export async function lookupManapoolSealedProduct(
  mtgjsonUuid: string,
): Promise<ManapoolPrinting | null>;
```

Endpoint: `${MANAPOOL_BASE}/products/sealed?mtgjson_uuids=${encodeURIComponent(uuid)}`.

Two deviations from the singles version, both mandated by §3.2 — call them out in a
comment so a future reader doesn't "fix" them:

- read **`low_price`**, not `price_cents` (which does not exist on this endpoint);
- **coerce `0` to `null`** (`low_price || null`), because 0 means nothing in stock.

Return the `url` even when the price is null — an out-of-stock product still has a useful
canonical page.

### 5.2 `src/services/sealed.ts` (new)

```ts
export async function syncSealedCatalog(): Promise<{ imported: number; removed: number }>;
export function autocompleteSealedProducts(query: string, setCode?: string | null):
  Array<{ name: string; value: string }>;
export function autocompleteSealedSets(query: string): Array<{ name: string; value: string }>;
export async function resolveSealedProduct(name: string, options?: { setCode?: string | null }):
  Promise<ResolvedSealedProduct>;
export function isSealedCatalogStale(): boolean;
```

**`syncSealedCatalog`** — fetch `SEALED_CATALOG_URL` wrapped in `retryWithBackoff`
(`src/utils/retry.ts:8`), parse, flat-map every set's `sealedProduct[]`, then upsert by
`uuid` and delete uuids no longer present, **inside a single better-sqlite3 transaction**
(~4,210 rows). Truncate `name` to `SEALED_PRODUCT_NAME_MAX` (100) before storing, and
derive `nameNormalized` from the **truncated** name so autocomplete values and lookups
agree. Log imported/removed counts. Catch and log every failure — a sync error must never
crash boot or the cron. Note ~100 MB transient heap while the 11.6 MB JSON is parsed.

**`autocompleteSealedProducts`** — `LIKE '%' || ? || '%'` on `name_normalized` (normalize
the query first), optionally `AND set_code = ?`, `LIMIT 25`. Return `{ name, value }` with
both set to the stored (already ≤100 char) name. Empty query → empty array, matching
`autocompleteCards` (`scryfall.ts:120-123`).

**`autocompleteSealedSets`** — `SELECT DISTINCT set_code`, prefix-filtered, 25 cap. Prefer
this over the existing `handleSetAutocomplete`, which serves all 869 Scryfall sets — 524
of which have no sealed product at all.

**`resolveSealedProduct`** — exact `name_normalized` match, scoped by `setCode` when given.
On a hit, call `lookupManapoolSealedProduct(uuid)` and fold `url` / price into the result
(this is why it's async). On a miss, return a free-text result (`resolved: false`, raw
name, null metadata, no Mana Pool call), which the commands **accept and post** per
decision #3.

## 6. Commands

### 6.1 `/have-sealed` (`src/commands/user/have-sealed.ts`)

Model on `have.ts`, minus the single-card machinery. Options in order:

| option | required | notes |
|---|---|---|
| `product_name` | yes | autocomplete |
| `accepts` | yes | `ACCEPTS_VALUES` × `ACCEPTS_LABELS`, as `have.ts:153` |
| `set` | no | autocomplete, sealed set codes only |
| `price` | no | `parsePriceToCents` |
| `quantity` | no | integer 1–99 |
| `notes` | no | `validateNotes` |

No `condition`, `finish`, `variant`, or `collector_number`.

Execute follows `have.ts:33-139`: guild guard → `deferReply({ ephemeral: true })` →
`validateCardName` (reused as-is for product names) → option validation →
`resolveSealedProduct` → `createListing({ kind: 'sealed', ... })` → `replyWithListing`.
The defer matters here — resolution now makes a Mana Pool call.

Map onto `ListingCreateInput`: `cardName` ← product name, `cardNameNormalized` ←
normalized product name, `cardSet` ← `setCode`, `manapoolUrl` and `marketPriceCents` ←
enrichment, plus `sealedUuid` / `sealedCategory` / `sealedSubtype`. Leave `condition`,
`finish`, `variant`, `collectorNumber`, `cardImageUrl` unset.

Autocomplete dispatch mirrors `have.ts:195-201`: branch on
`interaction.options.getFocused(true).name === 'set'`.

### 6.2 `/want-sealed` (`src/commands/user/want-sealed.ts`)

Same, mirroring `want.ts`'s differences: `max_price` instead of `price`, and **no
`quantity` option** (`want.ts` omits it; `insertListingRow` defaults to 1).

### 6.3 Registration

Append both to the `commands` array in `src/commands/index.ts:14`. Nothing else is needed —
`commandMap` and the autocomplete route in `src/events/interactionCreate.ts` are both
driven off that array. Add both to `/help` (`src/commands/user/help.ts`).

## 7. Downstream changes

**`src/services/listings.ts`**
- `insertListingRow` (`:20-47`) — thread `kind` (default `'card'`) and the four new
  columns through.
- `duplicateWarning` (`:100-127`) — add `eq(listings.kind, input.kind ?? 'card')` so a card
  and a product sharing a normalized name don't collide. Use `eq`, not the `IS` form the
  nullable columns use, since `kind` is NOT NULL. Do **not** add `marketPriceCents` to the
  guard — it's derived, not user intent.
- `updateListing` (`:244-274`) — add `sealedUuid`, `sealedCategory`, `sealedSubtype`,
  `marketPriceCents` to both the param type and the `if (fields.x !== undefined)` chain, or
  edit re-resolution silently drops them.

**`src/commands/user/edit.ts`**
- `buildEditModal` (`:60-122`) — for `listing.kind === 'sealed'`, **omit the `condition`
  row**. The modal is at Discord's 5-row cap, so this both frees a row and avoids
  presenting a field that would be silently discarded.
- `handleEditModal` (`:142`) — read the `condition` field only when
  `listing.kind === 'card'`; it will not exist on a sealed modal.
- Set-change branch (`:166-189`) — branch on `kind` **before** the `resolveCard` call. For
  sealed, call `resolveSealedProduct(listing.cardName, { setCode: cardSet })` and update
  `cardSet` / `cardName` / `cardNameNormalized` / the sealed columns / `manapoolUrl` /
  `marketPriceCents`. Unlike the card branch, a miss must **not** abort — it writes the
  free-text result, consistent with creation.

**`src/utils/embeds.ts`** — in `listingEmbed` (`:61-111`), for `kind === 'sealed'` push a
`Product` field (category/subtype label) and, when `marketPriceCents` is non-null, a
`Market` field. Label it so it reads as a point-in-time hint, not a live quote — the value
is frozen at creation and listings live 30 days. `digestLine` (`:114`) needs no change.
`formatListingTitle` and `listingManapoolUrl` already degrade correctly, and
`buildManapoolUrl` (`src/utils/manapool.ts:23`) returns `null` without a collector number,
so a sealed row with no Mana Pool URL renders no link rather than a bogus `/card/...` one.

**`src/commands/user/search.ts`** — append the category label to the `parts` array
(`:57-64`) for sealed rows. The array-join pattern already handles a null `condition`
without a dangling separator; same for `mylistings.ts`'s select-menu descriptions, which
also already `.slice(0, 100)`.

**`src/types/index.ts`**
```ts
export type ListingKind = 'card' | 'sealed';
export const LISTING_KINDS: readonly ListingKind[] = ['card', 'sealed'];

export interface ResolvedSealedProduct {
  productName: string;
  productNameNormalized: string;
  setCode: string | null;
  uuid: string | null;
  category: string | null;
  subtype: string | null;
  manapoolUrl: string | null;
  marketPriceCents: number | null;
  resolved: boolean;
}
```
Plus `kind?: ListingKind` and the four optional new fields on `ListingCreateInput`
(`:43-62`). Add an `isListingKind` guard alongside the others in `validation.ts:24-51`.

**`src/utils/constants.ts`** — `SEALED_CATALOG_URL`, `SEALED_CATALOG_STALE_MS` (24h),
`SEALED_PRODUCT_NAME_MAX` (100).

For labels, do **not** use the exhaustive `Record<(typeof ARRAY)[number], string>` form the
other label maps use — MTGJSON can add enum values, and an exhaustive map would fail
type-check or render blanks. Ship a `formatSealedType(raw: string)` helper that title-cases
and de-underscores (`booster_box` → "Booster Box"), backed by a small
`Record<string, string>` override map for the handful auto-formatting gets wrong (e.g.
`mtgo_redemption` → "MTGO Redemption"). Follows the looser `GAME_LABELS` precedent
(`constants.ts:72`).

## 8. Scheduler

**`src/services/scheduler.ts`** — add a module-level `sealedTask: ScheduledTask | null`
alongside `maintenanceTask` (`:14`), and:

```ts
export function startSealedCatalogSync(): void  // daily cron '0 16 * * *' UTC
```

Use **16:00 UTC**, not the proposal's 14:00. MTGJSON refreshes ~09:00 ET; 14:00 UTC is
09:00 EST in winter — right on the boundary. 16:00 UTC is 11:00 EST / 12:00 EDT, safely
after it year-round.

`stopAllJobs()` (`:68-76`) **must** also stop and null `sealedTask` —
`tests/services/scheduler.test.ts` calls it in `afterEach` to clean module state that
outlives the per-test DB reset.

Do **not** fold this into the hourly `startMaintenance` (`:52`): an 11.6 MB download every
hour is wasteful.

**`src/events/ready.ts:7-19`** — add a warm-up after `startMaintenance()`:
`void warmSealedCatalog()`, syncing only when `isSealedCatalogStale()`. Fire-and-forget so
boot isn't blocked; autocomplete returns empty until the first sync lands.

## 9. Testing

Conventions: `setupTestDb()` at module level (`tests/helpers/db.ts`), builders from
`tests/helpers/interaction.ts`, `vi.stubGlobal('fetch', ...)` for HTTP, and **explicit
`.mockReset()` in `beforeEach`** — module-level `vi.mock` is not auto-reset in this repo
(`AGENTS.md:113-123`; there is no `vitest.config.ts`).

**Gotcha:** the eslint carve-out disabling `unbound-method` / `no-unsafe-assignment` covers
only `tests/commands/**` and `tests/helpers/interaction.ts` (`eslint.config.js:38-53`). A
test outside `tests/commands/**` that asserts on `fakeChatInputInteraction` mock methods
will fail `npm run lint`. Keep interaction assertions in `tests/commands/user/`.

- **`tests/services/manapool.test.ts`** — extend, following the existing file's shape.
  Cover: no key ⇒ `null` with **zero** fetch calls; URL is
  `/products/sealed?mtgjson_uuids=<uuid>` with the `X-ManaPool-Access-Token` header;
  `low_price` is read (**not** `price_cents`); **`low_price: 0` ⇒ price `null` but the URL
  still returned**; `data: []` ⇒ `null`; non-2xx ⇒ `null`; fetch throws ⇒ `null`. Use the
  real payload in §3.2 as the fixture.
- **`tests/services/sealed.test.ts`** — a **small fixture** JSON (2–3 sets, a handful of
  products; never the real 11.6 MB file): sync upsert + removal of vanished uuids; a
  >100-char name is truncated and still resolves; `autocompleteSealedProducts` substring
  matching, `setCode` filter, 25 cap; `autocompleteSealedSets` distinctness;
  `resolveSealedProduct` exact hit, setCode scoping, free-text miss (**and that a miss
  makes no Mana Pool call**); sync failure (non-2xx, malformed JSON, fetch throws) leaves
  the existing catalog intact.
- **`tests/commands/user/have-sealed.test.ts` / `want-sealed.test.ts`** — catalog hit
  populates `kind='sealed'`, the sealed columns, `manapoolUrl` and `marketPriceCents`, and
  leaves card-only columns null; catalog miss still creates a listing (decision #3);
  enrichment returning null still creates the listing; autocomplete branches between
  product and set; guild guard and the defer-then-edit contract.
- **`tests/services/listings.test.ts`** — the duplicate guard does **not** fire across
  differing `kind` for an otherwise identical row.
- **`tests/commands/user/edit.test.ts`** — sealed modal omits the condition row; set change
  on a sealed listing re-resolves against `sealed_cache`, re-enriches, and does not abort
  on a miss.
- **`tests/commands/user/search.test.ts`** — a sealed listing is returned by normalized
  name with no query change.
- **`tests/services/scheduler.test.ts`** — the sealed cron registers and `stopAllJobs`
  clears it (mock the sync function).
- Existing fixtures in `tests/db/schema.test.ts`, `tests/services/listings.test.ts` and
  `tests/services/scheduler.test.ts` spell out every column — check whether the new columns
  need adding.

## 10. Verification

1. `npm run db:generate` → inspect the emitted SQL, confirm `kind` defaults to `'card'` and
   the three `listings` indexes survive; `npm run db:check`.
2. Full gate: `npm run lint`, `npm run format:check`, `npm run type-check`, `npm test`.
   Note `tsconfig.json` excludes `tests/`, so **test type errors surface through
   `npm run lint`**, not `type-check`.
3. Migration smoke test: point `DATABASE_PATH` at a copy of a pre-migration DB, boot, and
   confirm existing rows read back as `kind='card'` with the new columns null.
4. One real sync against live MTGJSON — assert ~4,210 rows land, then re-run and assert it
   is idempotent (0 imported / 0 removed on an unchanged catalog).
5. One real Mana Pool call for a known in-stock product (`ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb`,
   Bloomburrow Bundle) and one out-of-stock product, asserting the price is null for the
   latter while the URL is still returned. **Retry once on a connection reset** before
   concluding anything — see §3.4.
6. Manual pass in a test guild (`DISCORD_GUILD_ID`): `/have-sealed` with an autocompleted
   product, `/have-sealed` with a made-up name (must still post, without a link),
   `/want-sealed`, `/search` for the product name, `/mylistings`, `/edit` changing the set,
   `/fulfill`, `/delete`, and a manual digest run showing a sealed line.
7. `CHANGELOG.md` under `[Unreleased] → Added` (house style is verbose and names file
   paths — see the 1.5.0 block), plus the feature list in `docs/index.md:11-18`,
   `HANDOFF.md`, and the `MANAPOOL_API_KEY` description in `.env.example` if it names
   singles specifically.

## 11. Explicitly out of scope

- **Product images** — none exist from any free source. Sealed embeds render without a
  thumbnail.
- **Batch Mana Pool enrichment during sync.** Tempting (43 calls would price the whole
  catalog nightly), but §3.2 #4 and #5 make it materially harder — repeated-param encoding
  plus a `tcgplayer_product_id`/name mapping fallback for the 773 products with no
  TCGplayer ID — and it would serve prices up to 24h stale. One call per listing is
  simpler, fresher, and mirrors the existing singles path.
- **Storing a market price for card listings.** `ResolvedCard.manapoolPriceCents` is
  already resolved and cached but never persisted; `market_price_cents` now exists, so
  wiring it up is a one-line follow-up. Not part of this change.
- **A `kind` filter on `/search`** — names are unique across the sealed catalog and
  collisions with card names are negligible.
- **`/have-multi` and `/want-multi` sealed support** — they share the resolve helpers, so a
  follow-up is near-identical work.
- **Changing the card path's strict unresolved-name rejection** — sealed gets free text,
  cards keep current behavior.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Copying the singles parser into the sealed client | The single most likely bug: `price_cents` doesn't exist here and `0` is a sentinel. §5.1 mandates a comment; §9 mandates a test for each. |
| MTGJSON schema drift or an outage | Sync is `retryWithBackoff`-wrapped, fully try/caught, and transactional — a failure leaves the previous catalog serving. Boot never blocks on it. |
| Frozen market price goes stale over a 30-day listing | Rendered as a point-in-time hint, matching the already-frozen Mana Pool link (`AGENTS.md:133-138`). |
| Two new commands push the surface to 13 | Accepted trade for clean autocomplete and no `/have`/`/want` regression. Both documented in `/help`. |
| 11.6 MB parse in a long-lived process | Transient (~100 MB), once daily. Parse and drop; don't retain the raw JSON. |
| Sealed rows breaking null-sensitive rendering | Verified: `search.ts:57-64`, `mylistings.ts` and `digestLine` all build `parts` arrays conditionally. |

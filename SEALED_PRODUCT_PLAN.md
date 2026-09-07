# Sealed Product Support — Implementation Plan

Status: **proposed** (not yet scheduled for a shift)
Branch: `feature/sealed-product-support`

## 1. Goal

Let members post `/have` and `/want` listings for **sealed MTG products** (booster boxes/packs, bundles, decks, prerelease kits, etc.) alongside single-card listings. Sealed listings should get the same core treatment as cards — free text plus canonical names where possible, Manapool links, market-price hints, search, digests, edit/fulfill/delete — without re-architecting the listing pipeline.

The design is a **hybrid**: an MTGJSON-backed local catalog drives autocomplete and canonicalization for known products, Manapool enriches the chosen product with a live link + price, and any non-catalog product (new release, Store-Only drop, custom item) falls back to the existing free-text path exactly like today's unresolved-card path.

## 2. Previous research (summary of confirmed facts)

All facts below were verified against live sources during the research phase.

| Question                               | Answer                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does Scryfall support sealed products? | **No.** Cards and sets only. Not usable as a product source.                                                                                                                                                                                                                                                                           |
| Best free catalog source?              | **MTGJSON** `SetList.json`. MIT-licensed, ~11.6 MB, refreshed daily (~09:00 ET) with published SHA-256 checksums. URL: `https://mtgjson.com/api/v5/SetList.json`.                                                                                                                                                                      |
| Catalog size                           | 4,210 sealed products across 345 sets (of 869 total).                                                                                                                                                                                                                                                                                  |
| Per-product fields                     | `name`, `setCode`, `uuid`, `releaseDate`, `cardCount`, `category`, `subtype`, `identifiers` (`tcgplayerProductId`), `purchaseUrls`.                                                                                                                                                                                                    |
| Product images                         | **None from any free source.** MTGJSON defers imagery to Scryfall, which has no product imagery. Sealed embeds render without thumbnails.                                                                                                                                                                                              |
| Manapool sealed coverage               | ~82% of catalog products (3,437/4,210) carry a `tcgplayerProductId`, the key Manapool links. Enrichment is best-effort.                                                                                                                                                                                                                |
| Manapool sealed endpoints              | `GET /v1/products/sealed` (ID lookup via `mtgjson_uuids` / `tcgplayer_ids` / `product_ids`, max 100 IDs, **no name search** — hence the local catalog) and `GET /v1/prices/sealed` (in-stock prices, `low_price`/`price_market` in integer cents, `name`, `set_code`, `url`). Requires `X-ManaPool-Access-Token` (`MANAPOOL_API_KEY`). |
| MTGGraphQL                             | Currently gated behind Patreon tokens — **out**.                                                                                                                                                                                                                                                                                       |
| Precedent                              | Sealed is first-class in MTG trading Discords; Scrydex/TCGTracking model sealed as a distinct category; at least one production pipeline (curly-train) uses exactly Scryfall + Manapool.                                                                                                                                               |

## 3. Design decisions

### 3.1 Where sealed identity lives: a `kind` column on `listings`

Add `listings.kind: 'card' | 'sealed'` (default `'card'`). Reuse the existing `card_name` / `card_name_normalized` columns to store the product name — this is the single most important lever, because it means `/search` and the digest query paths work for sealed listings **with zero changes**:

- `searchListings` (`src/services/listings.ts:130`) matches on `cardNameNormalized` — a sealed listing stores its normalized product name there and is instantly searchable.
- `digestLine` / `listingEmbed` (`src/utils/embeds.ts:61,114`) already render `Name (SET)` + Manapool link + price; sealed listings produce sensible output for free.

Additional nullable columns carry product metadata that has no single-card meaning:

- `sealed_uuid` (MTGJSON uuid) — lets us re-resolve/refresh the Manapool link later.
- `sealed_category` (e.g. `booster_box`, `bundle`, `deck`) — display label.
- `sealed_subtype` (e.g. `draft`, `collector`, `prerelease_kit`) — display label.

The single-card fields (`finish`, `variant`, `collector_number`) are **null** for sealed listings. `condition` is also null (sealed is effectively NM by default) — see 3.4.

### 3.2 New catalog table: `sealed_cache`

Mirrors the `card_cache` pattern but is a full catalog index seeded from MTGJSON, not a per-lookup TTL cache.

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
    tcgplayerProductId: text('tcgplayer_product_id'),
    releaseDate: text('release_date'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('sealed_cache_normalized_idx').on(table.nameNormalized)],
);
```

Render the raw MTGJSON `sealedProduct` enum values as database values (constants for display live in `src/utils/constants.ts`, consistent with how `FINISH_LABELS` already works in `src/utils/constants.ts:51`). SQLite treats `sealed_cache` as opaque storage; only `name_normalized` is ever queried, so the index works.

### 3.3 Hybrid resolution flow

`/have` and `/want` gain an optional `type` choice option (`card` | `sealed`, default `card`):

1. **Autocomplete**: when `type == 'sealed'`, `handleSealedProductAutocomplete` queries `sealed_cache` by prefix/substring on `name_normalized` (`LIKE '%' || ? || '%'`, capped at 25, value = exact MTGJSON `name`). Cards keep the existing Scryfall path. The existing `set` option, when provided, filters by `setCode` too — reuse, no new fields.
2. **Resolution**: on submit, exact `name_normalized` lookup in `sealed_cache` (optionally scoped by `setCode`). Hit → canonical name, set code, category/subtype, uuid, optional Manapool enrichment via `GET /products/sealed?mtgjson_uuids=<uuid>` (frozen onto the row via `manapoolUrl`/price, same pattern as singles at `src/services/manapool.ts:48`). Miss → free-text fallback exactly matching the unresolved-card path (`src/services/scryfall.ts:264`): raw name, `resolved=0` semantics, no image, no Manapool link.
3. **Set-change on edit**: for sealed listings, re-resolve against `sealed_cache` (name + new setCode) instead of Scryfall (`src/commands/user/edit.ts:169`).

Prices: Manapool returns cents already; `price_cents` convention holds. `/want` `max_price` and `/have` `price` use the existing `parsePriceToCents`.

### 3.4 Condition is not applicable to sealed

Sealed goods have no meaningful condition (assume NM). In `/have`, the `condition` option stays **required for `type == 'card'` only**; when `type == 'sealed'` it's ignored and stored as null. Same for `/want` (already optional there). The edit modal shows the same fields for both kinds — effort-wise simplest to leave the modal unchanged and let sealed users leave Condition blank (`src/commands/user/edit.ts:61`); stored null renders no field.

### 3.5 Catalog sync job

Extend `src/services/scheduler.ts`:

- **Startup**: if `sealed_cache` is empty or oldest `updatedAt` is > 24h old, run a sync once (before first autocomplete needs it). MTGJSON is free and unauthenticated, so this needs no `MANAPOOL_API_KEY`.
- **Daily**: a dedicated cron (e.g. `0 14 * * *` UTC, shortly after the ~09:00 ET refresh) re-syncs.
- **Sync body** (`src/services/sealed.ts`): download `SetList.json` with `retryWithBackoff` (`src/utils/retry.ts`), parse, filter `sealedProduct != null` across all sets, upsert by `uuid` inside a single transaction (~4,210 rows). Log import/removal counts.
- Do **not** fold this into the hourly `startMaintenance` task (`src/services/scheduler.ts:52`) — an 11.6 MB download hourly is wasteful; daily + startup-warm is right.

### 3.6 Not in scope for v1

- A `kind` filter on `/search`. Search currently returns both kinds for a matched name; mixing happens only if a card and a product share a normalized name, which is negligible. Add later if requested.
- Sealed-specific images (none exist anywhere free).
- `/have-multi` / `/want-multi` sealed support in the **first** pass (they share the same autocomplete + resolve helpers, so the `type` toggle can be added to them in a follow-up with ~identical code).

## 4. Data model & migration

New/changed tables (see `src/db/schema.ts`):

1. `listings`: add `kind` (text, `notNull`, default `'card'`), `sealed_uuid`, `sealed_category`, `sealed_subtype` (all nullable).
2. New `sealed_cache` table (3.2).

Migration is a single `npm run db:generate` — all new columns are nullable or have constant defaults, so there's **no backfill needed** (existing rows become `kind='card'`). Per AGENTS.md: run `npm run db:generate`, commit the generated SQL + meta under `src/db/migrations/`, never `drizzle-kit push`. Run `npm run db:check` after.

## 5. Code-change map

| File                                    | Change                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                      | `listings.kind` + sealed columns; new `sealedCache` table; exported row/insert types.                                                                |
| `src/db/migrations/*`                   | Generated migration(s).                                                                                                                              |
| `src/types/index.ts`                    | `ListingKind = 'card' \| 'sealed'`; `ResolvedSealedProduct` interface; add `kind`/sealed fields to `ListingCreateInput`.                             |
| `src/utils/validation.ts`               | Reuse `normalizeCardName` (`:135`) and `validateCardName` (`:120`) for product names — no change required (max 100 chars is fine for product names). |
| `src/utils/constants.ts`                | `SEALED_CATEGORY_LABELS` / `SEALED_SUBTYPE_LABELS` maps for the ~15 categories / ~45 subtypes; `SEALED_CATALOG_URL`; `SEALED_CATALOG_STALE_MS`.      |
| `src/services/sealed.ts` (new)          | `syncSealedCatalog()`, `autocompleteSealedProducts(query, setCode?)`, `resolveSealedProduct(name, { setCode? })`.                                    |
| `src/services/manapool.ts`              | `lookupManapoolSealedProduct(uuid)` mirroring `lookupManapoolPrinting` (`:48`) against `/products/sealed?mtgjson_uuids=`.                            |
| `src/services/scheduler.ts`             | Sealed catalog warm-up on startup + daily cron job.                                                                                                  |
| `src/utils/cards.ts`                    | Branch autocomplete + resolution on `type`; add `handleSealedProductAutocomplete`.                                                                   |
| `src/commands/user/have.ts` / `want.ts` | `type` option; condition conditional; sealed creation path.                                                                                          |
| `src/commands/user/search.ts`           | No functional change (works via normalized name). Optionally surface sealed category in the result line.                                             |
| `src/commands/user/edit.ts`             | Sealed-aware re-resolution on set change.                                                                                                            |
| `src/utils/embeds.ts`                   | Sealed: add a "Product" field (category/subtype label); keep everything else. `digestLine` unchanged.                                                |
| `src/services/listings.ts`              | Include `kind` in the duplicate-check guard (`:100`) so a card and a sealed product with identical names don't collide.                              |
| `src/index.ts`                          | Nothing required (schema applies at boot); only if we want a one-off sync log line.                                                                  |

## 6. Interfaces

```ts
// src/types/index.ts
export type ListingKind = 'card' | 'sealed';

export interface ResolvedSealedProduct {
  productName: string;
  productNameNormalized: string;
  setCode: string | null;
  uuid: string | null;
  category: string | null;
  subtype: string | null;
  manapoolUrl: string | null;
  manapoolPriceCents: number | null;
  resolved: boolean;
}
```

`ListingCreateInput` gains `kind?: ListingKind`, `sealedUuid?/sealedCategory?/sealedSubtype?` (nullable). The command layer branches: `type == 'sealed'` builds a `ResolvedSealedProduct` and maps its fields onto `card_name`/`card_name_normalized`/`card_set`/`manapool_url`, leaving card-only fields null.

## 7. Testing

Follow repo conventions (`tests/helpers/db.ts` in-memory SQLite, `tests/helpers/interaction.ts` builders, module-level `vi.mock(...)` reset in `beforeEach`).

- **`sealed.ts`**: fixture JSON (small catalog subset) → `syncSealedCatalog` upsert/delete behavior; `autocompleteSealedProducts` prefix/substring/setCode filtering + 25 cap; `resolveSealedProduct` exact match, setCode scoping, free-text fallback when missing, and resolution when Manapool returns null (no key / empty / non-2xx).
- **`manapool.ts`**: mock fetch for `/products/sealed` success and empty cases; no-op when `MANAPOOL_API_KEY` unset.
- **Commands**: `/have` and `/want` with `type=sealed` (catalog hit + free-text fallback; condition ignored for sealed, required for card); autocomplete branching on `type`; `/search` returning a sealed listing; `/edit` set-change re-resolution for a sealed listing.
- **`listings.ts`**: duplicate guard does not cross `kind`.
- **Scheduler**: catalog sync scheduled at startup when stale and on the daily cron (mock the sync function).
- Full gate: `npm run lint`, `npm run format:check`, `npm run type-check`, `npm test`, `npm run db:check`.

## 8. Rollout

1. Merge to `main`; the migration runs automatically at boot (existing rows → `kind='card'`).
2. First boot syncs the sealed catalog (startup warm-up) so autocomplete is live immediately.
3. Sealed listings behave like cards in every downstream system (TTL/expiry, cooldown, digests, admin flows) because they're rows in `listings` with `kind='sealed'`.
4. Update `CHANGELOG.md` and `docs/index.md` features list.

## 9. Open questions to resolve at implementation time

1. **Manapool `/products/sealed` response shape** — confirm whether the product response includes `price_cents` (research strongly suggests prices key off `/prices/sealed`; if absent, either fetch `price_market` from `/prices/sealed` keyed by `set_code`+`product_id` or skip the price hint and keep only the link).
2. **Ambiguous free-typed names** — exact normalized name matches more than one product (rare; product names are set-scoped in practice). Policy: if the user also supplied `set`, scope by `setCode`; otherwise pick the most recent `releaseDate`; if truly ambiguous, take the free-text fallback.
3. **`type` option UX** — recommended `card` default with explicit `sealed` choice in the same command. (Alternative: separate `/have-sealed` `/want-sealed` commands. Rejected in v1: duplicates command surface; the `type` toggle interoperates with the existing `set` autocomplete.)
4. **Show `sealed_category` in `/search` result lines** — cosmetic; do it if trivial.

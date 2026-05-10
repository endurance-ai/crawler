---
id: SPEC-PLATFORM-EXPANSION-002
version: 0.1.0
status: draft
created_at: "2026-05-05"
updated_at: "2026-05-05"
author: hansangho
priority: high
issue_number: 0
labels: [crawler, platform, uniqlo, uniqlo-us, infrastructure]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-05 | v0.1.0 | Initial draft. Extends SPEC-PLATFORM-EXPANSION-001 (Uniqlo KR) to add Uniqlo US storefront. Four user-confirmed decisions baked in: (1) **gate override** — SPEC-001's 7-day Uniqlo KR soak gate is explicitly bypassed; SPEC-002 proceeds in parallel with SPEC-001; (2) **shared-engine architecture** — one `uniqlo-engine.ts` with a `region: "KR" \| "US"` parameter, no separate `uniqlo-us-engine.ts`; (3) **import-time USD→KRW conversion** via existing hardcoded FX table lifted into `src/lib/fx.ts`; cache file stores native USD; no live FX API; (4) **scope ceiling** — engine + US robots.txt verification only; size-system normalization, multi-region fanout/orchestration, IP rotation, schema migration, new test framework, and ESLint/Biome introduction are explicitly out of scope. |

---

## Overview

This SPEC adds Uniqlo (US storefront, `uniqlo.com/us/en`) as the 34th registered platform in the crawler, paired with the Uniqlo KR engine introduced in SPEC-PLATFORM-EXPANSION-001. The US storefront exposes the same JSON API surface as the KR storefront — `/us/api/commerce/v5/en/products` returns HTTP 200 to a plain `fetch` with realistic Mozilla User-Agent, returns the identical `{result:{items[], pagination, aggregations}}` response shape, uses the same `image.uniqlo.com` / `asset.uniqlo.com` CDN hosts, and is currently configured permissively for the API path under the same Akamai Bot Manager deployment that fronts KR (research.md §1, §2.4). The three genuine differences from KR — region-specific numeric category IDs, USD currency requiring KRW conversion, and tax-exclusive pricing convention — are addressed without invalidating the shared-engine approach.

This SPEC executes in parallel with SPEC-PLATFORM-EXPANSION-001 rather than after its 7-day soak window. The decision to bypass that gate is documented and justified in the next subsection. The implementation refactors `src/lib/uniqlo-engine.ts` from a KR-only module into a region-parameterized shared module (one `region: "KR" | "US"` parameter drives baseUrl path, locale string, and source currency code), lifts the existing hardcoded FX table out of `src/lib/shopify-engine.ts` into a small shared module `src/lib/fx.ts`, and inserts a USD→KRW conversion step into `src/import-products.ts` at upsert time. The cache file `data/uniqlo-us-products.json` stores `price` natively in USD (decimal). All other infrastructure introduced in SPEC-001 — `robots-check.ts`, `--dry-run` flow, 1 req/sec rate-limit policy with `--rate=N` operator override, abort-on-3-consecutive-errors, characterization-test fixture pattern — is reused as-is.

### Gate Override Justification

SPEC-001 §2.4 (plan.md) and §Non-Goals (spec.md) define a HARD entry condition for SPEC-PLATFORM-002 (and any sibling follow-up SPEC): the Uniqlo KR engine must run successfully in production for **7 calendar days with zero crawl-aborts** before a new platform SPEC is opened. The user has explicitly directed that this gate is bypassed for SPEC-002 specifically. SPEC-002 is to be planned and executed immediately, in parallel with SPEC-001, before any soak data has been gathered.

The reason this override is acceptable for SPEC-002 specifically (and not for ZARA / 29CM, which retain the SPEC-001 entry condition unchanged):

- SPEC-002 is a **structural sibling** of SPEC-001, not a new engine class. The API surface, the anti-bot service, the response schema, and the image CDN hosts are all shared (research.md §1). The "new platform onboarding" risk that the soak gate is designed to detect — undocumented API drift, anti-bot escalation, schema mismatch — is largely shared between KR and US, not independent.
- The SPEC-001 risk register (§Open Risks) lists three risks: API shape drift, Akamai escalation, and robots.txt policy change. For SPEC-002, all three are inherited risks rather than novel risks. The mitigations encoded in SPEC-001 — characterization fixture, 1 req/sec rate limit, abort-on-3-consecutive-errors, robots.txt re-check at every crawl start — apply to US identically.

The acknowledged residual risk that the gate override creates: **a bug in the shared parse path may surface in US production crawls before KR has accumulated soak evidence to expose it**. The bug could be present today and would be hidden until production traffic on either region triggers it.

The explicit mitigation for this residual risk, encoded as a HARD requirement in this SPEC (REQ-008): the existing characterization-test suite from SPEC-001 (`tests/uniqlo-engine.test.ts`) is parameterized to run against **both** the KR fixture and a new US fixture on every `pnpm test` invocation. Any drift in the shared parse path surfaces on either fixture immediately. The `region` parameter touches only API path string, source currency code, and locale formatter — a deliberately narrow surface for region-specific bugs. The two fixtures are captured from real API responses on the SPEC creation date and are frozen until manual refresh.

This mitigation does not eliminate the residual risk; it bounds it. If a bug is discovered in production after both KR and US ship, the rollback is to revert the SPEC-002 SiteConfig entry and continue running KR alone — the engine refactor itself remains in place because it changes neither KR's API path nor KR's currency handling.

## Goals

- Ship a working Uniqlo (US) crawler that produces a `data/uniqlo-us-products.json` cache file with USD-native `price` values, consumable by the existing `import-products.ts` Supabase upsert path with a small USD→KRW conversion hook added at upsert time.
- Refactor `src/lib/uniqlo-engine.ts` from a KR-only module into a region-parameterized shared module driven by a `region: "KR" | "US"` field on `SiteConfig`. KR behavior is preserved bit-for-bit.
- Lift the existing hardcoded `FX_TO_KRW` table out of `src/lib/shopify-engine.ts` into a small shared module `src/lib/fx.ts` so it can be imported by both `shopify-engine.ts` (no behavior change) and `import-products.ts` (new USD→KRW conversion call site for Uniqlo US).
- Introduce a new SiteConfig entry `uniqlo-us` with hardcoded US-specific `apiCategoryPaths` enumerating the four US gender top-levels (22210, 22211, 22212, 22213) and their direct sub-categories.
- Extend the existing characterization-test suite to run the engine's parse path against **both** the KR fixture and a new US fixture, surfacing any shared-engine drift on either fixture.
- Add `uniqlo.com/us/en` as a verified known-good baseUrl in the documentary allowlist for `robots-check.ts`. The runtime check itself is content-based and unchanged.
- Document the gate-override decision and its mitigation transparently in this SPEC's HISTORY and Overview sections so a reader six months from now understands why SPEC-002 shipped without waiting for the SPEC-001 soak window.

## Non-Goals / Exclusions

The following are explicitly out of scope for this SPEC. Items in this section MUST NOT be treated as "nice-to-have" or partially implemented; they are deferred to follow-up SPECs (with documented entry conditions) or indefinitely.

- **Size-system normalization**: Uniqlo US uses XS/S/M/L/XL/XXL; Uniqlo KR uses 90/95/100/105/110. Both region-native sizes are stored as-is in the existing `Product.sizes` field and the existing `size_info` Supabase column. No translation layer, no canonical size code, no per-region normalization map. If kiko.ai needs cross-region size matching in the future, that is a kiko.ai schema concern (project rule "schema management is owned by kiko.ai") and a separate SPEC.
- **Multi-region fanout / orchestration**: Each region is a separate `pnpm crawl --site=...` invocation. No `--site=uniqlo-all`, no parallel multi-region runner, no shared state between KR and US runs. Operators run KR and US as independent commands.
- **IP rotation, residential proxy networks**: Forbidden by project HARD rules and explicitly out of scope. Inherited prohibition from SPEC-001.
- **Supabase schema migration**: No `products` schema change. All US response fields map onto existing columns. Per orchestrator decision §3, no `price_usd` or `original_price_usd` column is added; the cache stores USD natively but Supabase only sees post-conversion KRW.
- **Live FX rate API**: The hardcoded FX table in `src/lib/fx.ts` (post-lift) remains POC-grade with `USD: 1430`. Live FX rate API is project-level out-of-scope per `product.md` and is not introduced by this SPEC.
- **New test framework introduction**: Inherited from SPEC-001. `node:test` (built-in) remains the test runner. Vitest is intentionally avoided.
- **ESLint / Biome / Prettier introduction**: Inherited from SPEC-001. `tsc --noEmit` remains the only static check.
- **Other Uniqlo regional storefronts**: Uniqlo JP, EU, UK, AU, CA, etc. are NOT in scope for this SPEC. The shared-engine architecture introduced here is structurally extensible to those regions, but a separate SPEC and entry-condition discussion is required before any of them ships.
- **ZARA, 29CM, Musinsa, H&M, Inditex sub-brands, H&M Group sub-brands**: Status from SPEC-001 is unchanged. ZARA and 29CM remain 2순위 with the SPEC-001 7-day Uniqlo KR soak entry condition (the gate override granted to SPEC-002 is **specific to SPEC-002**; it does not propagate to ZARA / 29CM). Musinsa and H&M remain deferred under their original rationale (robots.txt explicit block, Akamai active blocker).

## Architecture Impact

### Region parameter refactor of `src/lib/uniqlo-engine.ts`

The existing module hardcodes three KR-specific values:

- `UNIQLO_API_PATH = "/kr/api/commerce/v5/ko/products"` (single constant, post-SPEC-001 baseline)
- `sourceCurrency: "KRW"` (returned as a hardcoded field on every emitted `Product`)
- `priceFormatted` builder uses `"ko-KR"` `Intl.NumberFormat` locale

These three are refactored to be driven by a region parameter resolved from `SiteConfig`:

- API path becomes `buildApiPath(region: "KR" | "US"): string` returning `/kr/api/commerce/v5/ko/products` or `/us/api/commerce/v5/en/products`.
- `sourceCurrency` is no longer hardcoded; the engine reads from `config.sourceCurrency` (which the SiteConfig schema already supports). KR config sets `"KRW"`, US config sets `"USD"`.
- `priceFormatted` locale becomes `region === "KR" ? "ko-KR" : "en-US"`.

The region parameter source: a new optional `region?: "KR" | "US"` field on `SiteConfig` (semantic limited to the `"uniqlo"` engine type, documented in JSDoc). Engine reads `config.region` and defaults to `"KR"` for backward compatibility if the field is absent. The `uniqlo-kr` SiteConfig entry from SPEC-001 is updated to set `region: "KR"` explicitly; the new `uniqlo-us` entry sets `region: "US"`.

KR behavior MUST be preserved bit-for-bit: identical API URL, identical sourceCurrency, identical locale formatting, identical fixture-based test outcomes.

### FX table lift to `src/lib/fx.ts`

The existing `FX_TO_KRW` constant and `convertToKrw(price, currency)` function in `src/lib/shopify-engine.ts:11-41` are lifted into a new shared module `src/lib/fx.ts`. The Shopify engine re-imports them — no behavior change for any existing Shopify platform. The new call site is in `import-products.ts`, which calls `convertToKrw` for any product whose `sourceCurrency` is non-`"KRW"` (currently only Shopify USD/EUR/GBP and the new Uniqlo USD).

The FX table is **not extended**. USD is already populated at `1430` (line 12 in pre-lift `shopify-engine.ts`). No new currency entries are added by this SPEC.

### USD→KRW conversion at import time in `src/import-products.ts`

`import-products.ts:148-212` (the Supabase upsert mapping path) gains a single new branch: when the cached `Product.sourceCurrency` is `"USD"` (or any non-`"KRW"` value), the Supabase upsert payload's `price` field is computed as `convertToKrw(product.price, product.sourceCurrency)`. The cached `Product.price` field is left untouched on disk. The upsert payload's `original_price` field receives the same conversion treatment if present.

This is a small, localized hook — not a refactor of the upsert pipeline.

### `robots-check.ts` allowlist documentation update

`src/lib/robots-check.ts` is not behaviorally changed. The runtime check is content-based on the fetched `robots.txt` body. The documentary allowlist comment in the file — listing baseUrls verified to pass the blanket-disallow check — gains `uniqlo.com/us/en` as a known-good entry alongside `uniqlo.com/kr/ko`. This is purely a maintainability marker for the next operator who adds a platform.

## Requirements

The following requirements use EARS (Easy Approach to Requirements Syntax) format. SPEC-002 inherits and reuses requirements REQ-002 through REQ-007 from SPEC-001 (rate limit, dry-run, robots-check, abort-on-error, characterization tests, `--rate` override) — those are not re-stated here. The requirements below are the SPEC-002-specific deltas.

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register Uniqlo US as a platform with `key: "uniqlo-us"`, `type: "uniqlo"`, `baseUrl: "https://www.uniqlo.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, and `crawlDelay: 1000` in `src/configs/platforms.ts`. The SiteConfig entry **SHALL** include a hardcoded `apiCategoryPaths: string[]` field listing the four US gender top-level codes (`"22210,,,"` for WOMEN, `"22211,,,"` for MEN, `"22212,,,"` for KIDS, `"22213,,,"` for BABY) and their direct sub-categories enumerated as comma-tuples consumable by the `/us/api/commerce/v5/en/products?path=` query parameter. Sitemap-driven category discovery is explicitly NOT used (consistent with SPEC-001 REQ-001).

Source: research.md §1 [^u-us2], §2.1, §2.4; spec.md Architecture Impact subsection.

### REQ-002 [Ubiquitous]

**THE Uniqlo engine SHALL** be region-parameterized via a `region: "KR" | "US"` field on `SiteConfig`. The engine **SHALL** derive the API path, the source currency code, and the price-formatter locale from this field. KR behavior **SHALL** be preserved bit-for-bit: the existing `tests/fixtures/uniqlo-kr-products.fixture.json` characterization tests continue to pass without any assertion change. The engine **SHALL NOT** contain any hardcoded `"kr/ko"`, `"KRW"`, or `"ko-KR"` literal after the refactor (these become functions of `region`).

Source: research.md §3.2; orchestrator spawn prompt §2 (shared-engine decision).

### REQ-003 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=uniqlo-us` without the `--dry-run` flag, **THE crawler SHALL** fetch products from `https://www.uniqlo.com/us/api/commerce/v5/en/products` for each path in the US `apiCategoryPaths`, paginate by `offset` (incrementing by `limit=100`) until either `pagination.count === 0` or `offset >= pagination.total`, and write the aggregated `Product[]` result to `data/uniqlo-us-products.json` with `price` stored as the native USD decimal value (no conversion at engine time) and `sourceCurrency: "USD"`. Pacing and UA rotation behavior **SHALL** be identical to the KR engine path (REQ-002 from SPEC-001 reused).

Source: research.md §1, §3.3; orchestrator spawn prompt §3 (cache stores native USD).

### REQ-004 [State-driven]

**WHILE** importing Uniqlo US (or any non-KRW-source) products via `pnpm tsx src/import-products.ts`, **THE import script SHALL** detect `Product.sourceCurrency !== "KRW"` and apply `convertToKrw(price, sourceCurrency)` from `src/lib/fx.ts` to the upsert payload's `price` field before the Supabase upsert. The `original_price` field, if present and non-null, **SHALL** receive the same conversion treatment. The cached on-disk `Product.price` value **SHALL** remain untouched (the conversion is in-memory at upsert time only). When the FX table does not contain the source currency, `convertToKrw` returns `null` per its existing contract; the import script **SHALL** surface this as a warning and skip the affected product rather than upsert a null price.

Source: research.md §3.3; orchestrator spawn prompt §3 (import-time conversion via existing FX table).

### REQ-005 [Ubiquitous]

**THE shared FX module at `src/lib/fx.ts`** **SHALL** export the existing `FX_TO_KRW` constant (with USD, EUR, GBP, KRW already populated) and the `convertToKrw(price: number, currency: string): number | null` function. `src/lib/shopify-engine.ts` **SHALL** import from this module rather than declaring the table inline. The lift **SHALL NOT** alter Shopify engine behavior — every existing Shopify platform's output (USD/EUR/GBP→KRW conversion) MUST remain numerically identical before and after the lift.

Source: research.md §3.3; spec.md Architecture Impact (FX table lift subsection).

### REQ-006 [State-driven]

**WHILE** the user invokes `pnpm crawl --site=uniqlo-us` (with or without `--dry-run`), **THE crawler SHALL** invoke `robots-check.ts` against `https://www.uniqlo.com/robots.txt` (the same blanket-disallow check defined in SPEC-001 REQ-004) and **SHALL** refuse to proceed if the `User-agent: *` group contains a verbatim `Disallow: /` rule. Behavior, error message format, and exit code are identical to SPEC-001 REQ-004 — this REQ exists in SPEC-002 only to make the US storefront's coverage by the existing check explicit.

Source: research.md §1 [^u-us1] (US `#US` block has narrow Disallow only, passes blanket check); SPEC-001 REQ-004 reused.

### REQ-007 [Ubiquitous]

**THE Uniqlo engine characterization-test suite at `tests/uniqlo-engine.test.ts`** **SHALL** load both `tests/fixtures/uniqlo-kr-products.fixture.json` (existing, from SPEC-001) and a new `tests/fixtures/uniqlo-us-products.fixture.json` (a real captured Uniqlo US API response of approximately 50 to 100 products from one US category page) and **SHALL** run the engine's parse path against both fixtures. For both fixtures, the suite **SHALL** assert that every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, and `price` fields, and that every `imageUrl` matches the shared Uniqlo image-host whitelist (`image.uniqlo.com`, `asset.uniqlo.com`). For the US fixture specifically, the suite **SHALL** also assert `Product.sourceCurrency === "USD"` and that `Product.price` is a positive decimal number (USD value, not KRW). No new devDependency **SHALL** be added (`node:test` reused from SPEC-001).

Source: research.md §3.4; spec.md Overview (Gate Override Justification — shared characterization is the explicit mitigation).

### REQ-008 [Unwanted Behavior]

**IF** any assertion in REQ-007's parameterized characterization suite fails on either the KR fixture OR the US fixture, **THEN THE test runner SHALL** fail the entire suite with a non-zero exit code, and the CI gate / `pnpm test` invocation **SHALL** block any subsequent commit or production deployment. Failure on either fixture **SHALL** be treated as a shared-engine regression regardless of which region triggered it; the engine is NOT to be split into separate KR/US modules in response to a fixture failure.

Source: spec.md Overview (Gate Override Justification — fixture parity is the binding mitigation).

## Files Affected

| File | Action | Est. LOC | Purpose |
|---|---|---|---|
| `src/lib/uniqlo-engine.ts` | MODIFY | ~30 | Replace hardcoded `UNIQLO_API_PATH` with `buildApiPath(region)`. Stop hardcoding `sourceCurrency` and locale; derive from `config.region` and `config.sourceCurrency`. |
| `src/lib/types.ts` | MODIFY | ~3 | Add optional `region?: "KR" \| "US"` to `SiteConfig`. |
| `src/lib/fx.ts` | NEW | ~30 | Lift `FX_TO_KRW`, `CURRENCY_SYMBOL`, `convertToKrw` from `shopify-engine.ts`. |
| `src/lib/shopify-engine.ts` | MODIFY | ~5 | Replace inline FX declarations with import from `./fx`. Behavior unchanged. |
| `src/lib/robots-check.ts` | MODIFY | ~3 | Add `uniqlo.com/us/en` to documentary allowlist comment. No runtime change. |
| `src/import-products.ts` | MODIFY | ~15 | Insert USD→KRW conversion hook at upsert mapping (line ~148-212). |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `uniqlo-us` SiteConfig entry. Update existing `uniqlo-kr` entry to set `region: "KR"` explicitly. |
| `tests/fixtures/uniqlo-us-products.fixture.json` | NEW | ~150 | Frozen snapshot of one real US API page (`path=22210,,,` Women, ~50–100 products). |
| `tests/uniqlo-engine.test.ts` | MODIFY | ~40 | Parameterize existing tests by region. Add USD-specific assertions on US fixture. Add import-time FX conversion test. |
| `.moai/project/structure.md` | MODIFY | ~5 | Mention SPEC-002 in the platform table; document the per-region engine pattern. |

Total estimated LOC delta: ~308.

## Acceptance References

Detailed Given-When-Then acceptance scenarios are documented in `.moai/specs/SPEC-PLATFORM-EXPANSION-002/acceptance.md`.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Gate-override risk** — a bug in the shared parse path surfaces in US production before KR has soaked | Medium | Medium | Shared characterization fixtures (KR + US) run on every `pnpm test` invocation (REQ-007, REQ-008). Engine `region` parameter touches only API path, currency code, and locale — narrow surface for region-specific bugs. Rollback path: revert SPEC-002 SiteConfig entry; engine refactor remains in place because it does not change KR behavior. |
| US API shape diverges from KR | Low–Medium | Medium | Both fixtures run through same parse path; drift surfaces on either fixture. Defensive field mapping (every field falls back to `null` if absent). |
| Akamai escalates anti-bot for `/us/api/...` path | Low | High | Inherits SPEC-001 mitigation: 1 req/sec baseline, 5-element UA rotation, abort-on-3-consecutive-errors. No IP rotation, no fingerprint randomization. Crawler fails loud (visible in `CrawlResult.errors`) rather than retrying silently. |
| Uniqlo introduces `Disallow: /us/api/` in `robots.txt` | Low | High | `robots-check.ts` runs at every crawl start (REQ-006). A blanket `Disallow: /` introduction would block. A more targeted rule would not be caught — that finer-grained gap is documented in SPEC-001 §Open Risks and remains an accepted residual risk. |
| USD→KRW FX rate staleness (hardcoded `USD: 1430`) | Medium | Low | Same risk already accepted for Shopify engines using USD/EUR/GBP. POC-grade; live FX rate API is project-level out-of-scope. |
| US `apiCategoryPaths` becomes stale | Medium | Low | Empty `total=0` is handled (REQ-002 termination). Stale entries waste a request but do not corrupt output. Revisit if maintenance burden materializes. |
| FX module lift introduces subtle regression in Shopify USD/EUR/GBP conversions | Low | Medium | REQ-005 explicit: pre-lift and post-lift Shopify outputs MUST be numerically identical. Verified by re-running existing Shopify dry-run probe before merge. |

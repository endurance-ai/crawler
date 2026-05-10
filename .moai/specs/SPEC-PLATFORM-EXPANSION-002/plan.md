# Plan: SPEC-PLATFORM-EXPANSION-002 — Uniqlo (US) Engine Extension

Status: draft
Author: manager-spec subagent
Date: 2026-05-05

## 1. Intent

Extend the Uniqlo engine introduced in SPEC-PLATFORM-EXPANSION-001 to cover the US storefront (`uniqlo.com/us/en`), executing in parallel with SPEC-001 rather than waiting for its 7-day soak gate. The work is a region-parameter refactor of an existing module plus one new SiteConfig entry plus an import-time FX conversion hook. No new engine class. No new infrastructure. Per orchestrator decisions (see §6 below), the four major architectural choices are pre-resolved: gate override accepted with explicit mitigation, shared engine with region parameter, import-time USD→KRW conversion via existing FX table, and a tight scope ceiling that excludes size normalization, multi-region orchestration, and schema changes.

## 2. Scope

### 2.1 In-Scope

- Refactor `src/lib/uniqlo-engine.ts` to be region-parameterized via a `region: "KR" | "US"` field on `SiteConfig`. KR behavior preserved bit-for-bit (research.md §3.2; verified by existing KR fixture continuing to pass).
- New file `src/lib/fx.ts` exporting `FX_TO_KRW`, `CURRENCY_SYMBOL`, `convertToKrw` — lifted verbatim from `src/lib/shopify-engine.ts:11-41`. No FX table extension; USD is already populated at 1430 (research.md §2.2).
- Update `src/lib/shopify-engine.ts` to import from `./fx` (replacing inline declarations). Numerically identical outputs before/after the lift (REQ-005).
- New SiteConfig entry `uniqlo-us` in `src/configs/platforms.ts` with `key: "uniqlo-us"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 1000`, hardcoded `apiCategoryPaths` enumerating four US gender top-levels (22210/22211/22212/22213) and direct sub-categories. Update existing `uniqlo-kr` entry to add explicit `region: "KR"`.
- Insert USD→KRW conversion hook into `src/import-products.ts:148-212` (the Supabase upsert mapping). Detect `sourceCurrency !== "KRW"` and apply `convertToKrw` to upsert payload's `price` and `original_price` fields.
- Add `uniqlo.com/us/en` to documentary allowlist comment in `src/lib/robots-check.ts`. Runtime check unchanged (the existing blanket `Disallow: /` detector covers US storefront identically — research.md §1 [^u-us1]).
- New characterization fixture `tests/fixtures/uniqlo-us-products.fixture.json` (real US API capture, ~50–100 products from `path=22210,,,` Women).
- Modify `tests/uniqlo-engine.test.ts` to parameterize existing tests by region. Run engine parse path against BOTH fixtures. Add US-specific assertions: `sourceCurrency === "USD"`, decimal positive `price`, image hosts pass shared whitelist. Add import-time FX conversion test.
- Update `.moai/project/structure.md` to mention SPEC-002 in the platform table and document the per-region engine pattern.

### 2.2 Out-of-Scope (this SPEC)

- **Size-system normalization**: Uniqlo US uses XS/S/M/L; KR uses 90/95/100. Both stored as-is in `Product.sizes`. Cross-region size mapping is a kiko.ai schema concern, not a crawler concern.
- **Multi-region fanout / orchestration**: No `--site=uniqlo-all`, no parallel multi-region runner. Each region is a separate `pnpm crawl --site=...` invocation.
- **IP rotation, residential proxy networks**: Forbidden by project HARD rules. Inherited from SPEC-001.
- **Supabase schema migration**: No new `price_usd` column, no `original_price_usd` column. Per orchestrator decision §3, conversion happens at import time and Supabase only sees post-conversion KRW.
- **Live FX rate API**: Hardcoded `USD: 1430` in lifted `fx.ts` remains POC-grade. Live rate API is project-level out-of-scope per `product.md`.
- **Vitest framework introduction**: Inherited from SPEC-001. `node:test` is the runner.
- **ESLint / Biome / Prettier introduction**: Inherited from SPEC-001. `tsc --noEmit` is the only static check.
- **Other Uniqlo regional storefronts** (JP, EU, UK, AU, CA, etc.): The shared-engine architecture introduced here is structurally extensible, but each requires its own SPEC and entry-condition discussion.
- **Scope propagation from gate override**: The 7-day Uniqlo KR soak gate from SPEC-001 §2.4 remains in force for ZARA (SPEC-PLATFORM-002) and 29CM (SPEC-PLATFORM-003). The override granted for SPEC-002 is **specific to SPEC-002** because SPEC-002 is a structural sibling of SPEC-001. It does NOT propagate.

### 2.3 Out-of-Scope (any future SPEC in this series)

Inherited verbatim from SPEC-001 §2.3: IP rotation, CAPTCHA solving, headless browser fingerprint evasion, robots.txt violations, authenticated scraping, Inditex sub-brands deferred-with-ZARA, H&M Group sub-brands deferred-with-H&M.

### 2.4 Gate Override Specifics

SPEC-001 §2.4 defines the entry condition for SPEC-PLATFORM-002 (ZARA) and SPEC-PLATFORM-003 (29CM): 7 calendar days of successful Uniqlo KR production runs with zero crawl-aborts. SPEC-002 (Uniqlo US) is exempted from that gate per explicit user direction. The exemption is justified by the structural-sibling argument (research.md §1, §2.4): the US storefront shares the API surface, the response schema, the image CDN hosts, and the Akamai posture with KR. The risks the soak gate is designed to detect — undocumented API drift, anti-bot escalation, schema mismatch — are largely shared between KR and US, not independent.

The mitigation for the residual risk (a bug in shared parse path surfacing in US production before KR has soak data) is binding: the shared characterization fixture pattern (REQ-007, REQ-008 in spec.md) runs both KR and US fixtures on every `pnpm test` invocation. Any drift surfaces on either fixture immediately.

This exemption does NOT propagate. ZARA and 29CM remain gated by the SPEC-001 7-day Uniqlo KR soak.

## 3. EARS Requirements (proposed — finalized in spec.md)

REQ-001 [Ubiquitous]: THE crawler SHALL register Uniqlo US as a platform with `key: "uniqlo-us"`, `region: "US"`, `sourceCurrency: "USD"`, hardcoded US `apiCategoryPaths`. (research.md §1, §2.4, §5.1.)

REQ-002 [Ubiquitous]: THE Uniqlo engine SHALL be region-parameterized; KR behavior preserved bit-for-bit. (research.md §3.2.)

REQ-003 [Event-driven]: WHEN `pnpm crawl --site=uniqlo-us` runs without `--dry-run`, THE crawler SHALL fetch from `/us/api/commerce/v5/en/products`, paginate, write `data/uniqlo-us-products.json` with native USD `price` and `sourceCurrency: "USD"`. Pacing/UA rotation identical to KR (REQ-002 from SPEC-001 reused). (research.md §3.3.)

REQ-004 [State-driven]: WHILE importing via `import-products.ts`, THE script SHALL apply `convertToKrw` to non-KRW source-currency products before upsert. (research.md §3.3.)

REQ-005 [Ubiquitous]: THE shared FX module `src/lib/fx.ts` SHALL export the existing FX table; lift MUST be numerically equivalent. (research.md §3.3.)

REQ-006 [State-driven]: WHILE running US crawl, THE crawler SHALL invoke `robots-check.ts` (SPEC-001 REQ-004 reused). (research.md §1 [^u-us1].)

REQ-007 [Ubiquitous]: THE characterization-test suite SHALL run engine parse path against BOTH KR and US fixtures. (research.md §3.4; spec.md Gate Override Justification.)

REQ-008 [Unwanted Behavior]: IF either fixture's assertions fail, THEN THE suite SHALL fail and block deployment. Engine NOT to be split in response. (spec.md Gate Override Justification — binding mitigation.)

Inherited from SPEC-001 (not re-stated here): rate limit pacing (SPEC-001 REQ-002), `--rate=N` operator override (SPEC-001 REQ-007), dry-run flow (SPEC-001 REQ-003), abort-on-3-consecutive-errors (SPEC-001 REQ-005), characterization-test runner (SPEC-001 REQ-006).

## 4. Files to Modify

User decisions confirmed by orchestrator spawn prompt: gate override (§1), shared engine (§2), import-time FX via existing table (§3), tight scope ceiling (§4).

| File | Action | Est. LOC | Reason |
|---|---|---|---|
| `src/lib/uniqlo-engine.ts` | MODIFY | ~30 | Region-parameter refactor. Replace `UNIQLO_API_PATH` constant with `buildApiPath(region)` (~5 LOC). Stop hardcoding `sourceCurrency: "KRW"` (~2 LOC). Stop hardcoding `"ko-KR"` locale (~5 LOC). Read `region` from `config.region` with `"KR"` default for backcompat (~3 LOC). Defensive type narrowing + JSDoc (~15 LOC). |
| `src/lib/types.ts` | MODIFY | ~3 | Add `region?: "KR" \| "US"` optional field to `SiteConfig`. |
| `src/lib/fx.ts` | NEW | ~30 | Lift `FX_TO_KRW`, `CURRENCY_SYMBOL`, `CURRENCY_TO_COUNTRY`, `convertToKrw` from `shopify-engine.ts:11-41`. Export each. |
| `src/lib/shopify-engine.ts` | MODIFY | ~5 | Replace inline FX declarations with `import {FX_TO_KRW, CURRENCY_SYMBOL, CURRENCY_TO_COUNTRY, convertToKrw} from "./fx"`. No behavior change. |
| `src/lib/robots-check.ts` | MODIFY | ~3 | Add `uniqlo.com/us/en` to documentary allowlist comment. No runtime change. |
| `src/import-products.ts` | MODIFY | ~15 | At upsert mapping (line ~148-212), detect `sourceCurrency !== "KRW"` and apply `convertToKrw` to `price` and `original_price` fields of the upsert payload. Skip-with-warning when conversion returns null. |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `uniqlo-us` SiteConfig entry with hardcoded US `apiCategoryPaths` (4 gender top-levels + direct sub-categories from research.md §1 [^u-us4] tree). Update existing `uniqlo-kr` entry to add `region: "KR"` explicitly. |
| `tests/fixtures/uniqlo-us-products.fixture.json` | NEW | ~150 | Frozen snapshot of US API response: `curl https://www.uniqlo.com/us/api/commerce/v5/en/products?path=22210%2C%2C%2C&limit=100&offset=0`. Captured once, frozen. |
| `tests/uniqlo-engine.test.ts` | MODIFY | ~40 | Parameterize existing tests by region (loop over `[krFixture, usFixture]`). Add US-specific tests: USD currency, decimal positive price, image hosts pass shared whitelist. Add import-time FX conversion test (mocks `import-products.ts` upsert mapping branch). |
| `.moai/project/structure.md` | MODIFY | ~5 | Add Uniqlo US to platform table; document `region: "KR" \| "US"` SiteConfig field. |

Verification needed before Run phase:

- [x] Q1 resolved (orchestrator §1) — gate override accepted; mitigation is fixture-parity + binding REQ-008.
- [x] Q2 resolved (orchestrator §2) — shared engine, region parameter, no separate `uniqlo-us-engine.ts`.
- [x] Q3 resolved (orchestrator §3) — import-time USD→KRW conversion via existing FX table; cache stores native USD.
- [x] Q4 resolved (orchestrator §4) — engine + US robots.txt verification only; size normalization, multi-region fanout, IP rotation, schema migration, new test framework, ESLint/Biome are explicitly OUT of scope.
- [x] FX table lift compatibility — USD already in `FX_TO_KRW` at 1430; no extension needed; Shopify engine outputs unchanged after lift (verified via REQ-005).
- [x] US `apiCategoryPaths` discovery — gender IDs (22210/22211/22212/22213) and class IDs (Outerwear=23294, T-Shirts=23295, Pants=23296, etc.) confirmed live via `path=22210` probe response `aggregations.tree.classes` (research.md §1 [^u-us4]).
- [x] US robots.txt blanket-disallow check — passes; US `#US` block has narrow Disallow only on `cms`, `size/*`, `search`, `news/search`, `reviews/new` (research.md [^u-us1]).
- [x] US Akamai posture — observed permissive on API path (research.md §2.4); inherits SPEC-001 mitigation (1 req/sec, UA rotation, abort-on-3).

## 5. Reference Implementations

- **SPEC-001 baseline** (post-merge state): `src/lib/uniqlo-engine.ts` is the structural template — region refactor preserves all KR behavior. Test suite at `tests/uniqlo-engine.test.ts` is the parameterization template.
- **Shopify engine FX pattern** (research.md §3.3): `src/lib/shopify-engine.ts:11-16` (`FX_TO_KRW`), `:34-41` (`convertToKrw`), `:104` (`config.sourceCurrency` read), `:169` (`convertToKrw` call site at upsert) — these all move to `src/lib/fx.ts` and re-import.
- **Cafe24 engine** (out of relevance for SPEC-002): not modified; explicitly noted to confirm no cross-engine dependency emerges.
- **Import path FX hook precedent**: there is no existing FX hook in `import-products.ts` (Cafe24 always KRW; current Shopify path computes KRW at engine time). SPEC-002 introduces the first import-time FX hook by design (orchestrator decision §3).
- **Probe handler** (`src/crawl.ts:probeSite`): the `if (config.type === "uniqlo")` branch from SPEC-001 covers `uniqlo-us` as well — no dispatch wiring change needed because dispatch is by `type`, not by `region`.

## 6. Technology Stack

No new production dependencies. No new devDependencies. Stack is unchanged from `tech.md`:

- Node.js >=22.0.0, TypeScript ^5.6.0, pnpm >=9.0.0
- Existing deps: `playwright` (untouched by SPEC-002), `@supabase/supabase-js`, `tsx`, `dotenv-cli`
- Test runner: `node:test` (built-in, inherited from SPEC-001)

The `src/lib/fx.ts` lift is a code reorganization, not a dependency change.

## 7. Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Gate-override risk** — shared parse path bug surfaces in US before KR soak | Medium | Medium | REQ-007 + REQ-008: shared characterization fixtures (KR + US) on every test run. Engine region parameter has narrow surface (API path, currency code, locale string only). Rollback path: revert `uniqlo-us` SiteConfig entry; engine refactor stays because KR behavior preserved. |
| US API shape diverges from KR | Low–Medium | Medium | Both fixtures run through same parse path; drift surfaces on either fixture. Defensive field mapping (every field falls back to `null` if absent — pattern inherited from SPEC-001). |
| Akamai escalates anti-bot for `/us/api/...` | Low | High | Inherits SPEC-001 mitigation: 1 req/sec, 5-element UA rotation, abort-on-3-consecutive-errors. Crawler fails loud (visible in `CrawlResult.errors`). |
| Uniqlo introduces `Disallow: /us/api/` in robots.txt | Low | High | `robots-check.ts` runs at every crawl start (REQ-006). Blanket `Disallow: /` would block. Targeted-rule gap is documented residual risk inherited from SPEC-001. |
| FX module lift introduces subtle regression in existing Shopify USD/EUR/GBP outputs | Low | Medium | REQ-005 explicit: pre-lift and post-lift Shopify outputs MUST be numerically identical. Verification: re-run existing Shopify dry-run probe (`pnpm crawl --probe=<existing-shopify-platform>`) before merge; compare outputs against pre-lift snapshot. |
| USD→KRW FX rate staleness | Medium | Low | Same risk already accepted for Shopify USD/EUR/GBP. POC-grade. Live FX API is project-level OOS. |
| US `apiCategoryPaths` becomes stale | Medium | Low | Empty `total=0` is handled (REQ-002 from SPEC-001 termination). Stale entries waste a request but do not corrupt output. |
| Tax-exclusive USD prices misinterpreted as tax-inclusive | Low | Low | Documented convention: stored USD value is displayed pre-tax PLP price. Matches `shopify-engine.ts` behavior for global Shopify stores. No special handling. |

## 8. Decision Log (Pre-Resolved)

These items are pre-resolved by orchestrator spawn prompt; no user decision required at /moai run time:

- **D1 — Entry gate**: Gate override accepted. SPEC-002 proceeds in parallel with SPEC-001. Mitigation: REQ-007 + REQ-008 binding fixture-parity. Justified by structural-sibling argument (shared API surface, schema, CDN, Akamai posture). Override does NOT propagate to ZARA / 29CM.
- **D2 — Engine architecture**: Single `uniqlo-engine.ts` with `region` parameter. No `uniqlo-us-engine.ts`. KR behavior preserved bit-for-bit.
- **D3 — Currency handling**: Cache stores native USD; `import-products.ts` performs USD→KRW conversion via existing FX table (lifted to `src/lib/fx.ts`). No live FX API. No schema migration.
- **D4 — Scope ceiling**: Engine + US robots-check verification only. Size-system normalization, multi-region orchestration, IP rotation, schema migration, new test framework, ESLint/Biome introduction all explicitly OUT of scope. SPEC-002 is structurally narrow.

Open clarifications that may surface during /moai run (low-priority, non-blocking):

- **C1 — Region parameter source**: Is `region` an explicit `SiteConfig` field, or derived from `config.key` prefix (`uniqlo-kr` → KR, `uniqlo-us` → US)? Plan recommends: explicit field with `"KR"` default for backcompat. Defer to /moai run if a cleaner pattern emerges.
- **C2 — `convertToKrw` null handling in `import-products.ts`**: When the FX table does not contain the source currency, `convertToKrw` returns null. spec.md REQ-004 says "skip with warning." Defer detailed log-format / metric-emission to /moai run.

## 9. Methodology Note (DDD)

Project's `.moai/config/sections/quality.yaml` has `development_mode: ddd` (auto-config rule for projects with <10% test coverage; this project has limited coverage post-SPEC-001). The Run phase will follow ANALYZE-PRESERVE-IMPROVE:

- **ANALYZE**: Re-read `src/lib/uniqlo-engine.ts` post-SPEC-001 to map every KR-specific assumption (API path, sourceCurrency, locale). Re-read `src/lib/shopify-engine.ts:11-41` to confirm FX lift is a verbatim copy. Re-read `src/import-products.ts:148-212` to identify the exact upsert-mapping insertion point.
- **PRESERVE**: KR fixture (`tests/fixtures/uniqlo-kr-products.fixture.json` from SPEC-001) is the regression baseline. After every refactor step, re-run `pnpm test` and confirm all KR assertions still pass. Capture the new US fixture once via curl and freeze it. The Shopify engine's FX-lift is also PRESERVE-bound: capture pre-lift outputs of one Shopify dry-run probe and compare against post-lift outputs (REQ-005).
- **IMPROVE**: Implement region parameter refactor, FX module lift, US SiteConfig entry, US fixture, parameterized test suite, import-time FX hook. Tests must remain green throughout. The IMPROVE phase ends when (a) `pnpm test` passes for both KR and US fixtures, (b) the live US dry-run probe (`pnpm crawl --site=uniqlo-us --dry-run`) succeeds, and (c) the Shopify engine's pre-lift / post-lift outputs match.

This is a brownfield refactor (the engine module exists from SPEC-001) plus greenfield addition (US SiteConfig, US fixture). DDD is the appropriate methodology because the KR fixture is the binding regression artifact; TDD-style "write test before code" does not apply because the test is already written and must continue to pass through the refactor.

## 10. References

- Research artifact: `.moai/specs/SPEC-PLATFORM-EXPANSION-002/research.md`
- Parent SPEC: `.moai/specs/SPEC-PLATFORM-EXPANSION-001/spec.md`, `plan.md`, `research.md`, `acceptance.md`
- Project product context: `.moai/project/product.md` (33-platform target post-SPEC-001; SPEC-002 makes it 34)
- Project structure context: `.moai/project/structure.md` ("Adding a New Platform" checklist updated by SPEC-001 to include robots-check)
- Project tech context: `.moai/project/tech.md`
- Existing engine reference: `src/lib/uniqlo-engine.ts` (post-SPEC-001 baseline; refactor target)
- FX table source: `src/lib/shopify-engine.ts:11-41` (lift target)
- Import path: `src/import-products.ts:148-212` (FX hook insertion point)

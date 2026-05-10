# Plan: SPEC-PLATFORM-EXPANSION-003 — ZARA (KR) Playwright Engine

Status: draft
Author: manager-spec subagent
Date: 2026-05-05

## 1. Intent

Add ZARA (KR storefront) as the 35th registered platform in the crawler — the first Playwright-based engine after Cafe24, the first non-Cafe24 Playwright engine, and the first new engine type since Uniqlo (SPEC-001/002). This is also the first engine that the project research has classified as "best-effort" rather than "well-supported": every probable HTTP-fetch path is hard-blocked by Akamai Bot Manager (research.md §2-3), and the engine's viability hinges on Playwright's real-browser execution of Akamai's bm-verify JS challenge being reliable enough under project HARD constraints (no fingerprint evasion, no IP rotation, no authenticated scraping). The Run phase is gated by two HARD preconditions encoded as REQ-007 (Playwright `headless: "new"` reliability ≥ 80% verified against the live ZARA KR category page) and REQ-008 (ZARA KR Korean-language ToS clause read in a real browser, verbatim text committed as audit evidence). If either precondition fails, the engine is shelved before any production code is written. This SPEC executes immediately — the SPEC-001 7-day soak gate was removed by user direction on 2026-05-05.

## 2. Scope

### 2.1 In-Scope

- New file `src/lib/zara-engine.ts` (~280 LOC) implementing Playwright-based DOM scrape against ZARA KR category landing pages (research.md §4.2; architecture impact subsection of spec.md). Browser launched internally with `headless: "new"`, vanilla launch options, realistic context (UA from 5-element rotation list reused from `uniqlo-engine.ts`, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport`), infinite-scroll pagination loop, selector fallback chain, abort-on-3-consecutive-errors, bm-verify-intercept detector.
- `PlatformType` union extension from `"cafe24" | "shopify" | "uniqlo"` to `"cafe24" | "shopify" | "uniqlo" | "zara"` in `src/lib/types.ts:53`.
- New optional `SiteConfig` field `categoryUrls?: string[]` in `src/lib/types.ts` (added alongside the existing `apiCategoryPaths` and `region` fields), JSDoc binding to `type === "zara"`.
- New SiteConfig entry `zara-kr` in `src/configs/platforms.ts` with hardcoded `categoryUrls` listing ~18 Women + Men L2 category landing-page URLs (research.md §1.5). `crawlDelay: 2000`. `sourceCurrency: "KRW"`.
- Engine dispatch wiring in `src/crawl.ts:runCrawl` to route `type === "zara"` to the new engine (sequential, NOT `Promise.all` — each ZARA crawl launches its own Chromium browser; mirrors Cafe24 dispatch but for now zara-kr is the only entry, so a 1-at-a-time loop is sufficient and avoids premature optimization). ~30 LOC.
- Probe handler in `src/crawl.ts:probeSite` for the `"zara"` branch with bm-verify-intercept assertion (the page HTML must contain real product DOM, NOT the JS challenge shell). ~20 LOC.
- New characterization fixture `tests/fixtures/zara-kr-products.fixture.json` (frozen `RawZaraProduct[]` snapshot from one real ZARA category page, captured ONCE during Run-phase PRESERVE step).
- New characterization tests in `tests/zara-engine.test.ts` running `parseProductsFromDom` (the engine's pure parse function) against a synthetic HTML body wrapping the fixture; image-host whitelist test; abort-on-3-errors test (mocked); bm-verify-intercept detector test. `node:test` runner reused (no new dep).
- robots-check pre-flight at every ZARA crawl start (REQ-005, reused from SPEC-001 REQ-004 — no code change to `src/lib/robots-check.ts`).
- Update to `.moai/project/structure.md` Step 1 of "Adding a New Platform" — add ZARA Playwright pattern note to the engine-layering subsection; bump platform table count from 34 to 35.

### 2.2 Out-of-Scope (this SPEC)

- **ZARA regions other than KR** — US, ES, EU, UK, JP, AU, etc. Each region has its own SPA structure, its own seasonal category slugs, and its own ToS. Each requires its own SPEC. The engine architecture introduced here is structurally extensible to other ZARA regions, but the `region`-parameterization pattern from SPEC-002 (Uniqlo KR + US sharing one engine) does NOT carry over without per-region probe + ToS verification.
- **Inditex sub-brands** — Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home all share the Inditex Akamai parent infrastructure. They remain deferred-with-ZARA per SPEC-001 §2.3. SPEC-003 sets the engine pattern; each sub-brand requires its own SPEC and ToS verification, even if SPEC-003 ships successfully.
- **ZARA Kids and Baby sections** — Out of scope per user direction. Only Women + Men URL hierarchies are crawled.
- **Mobile-app reverse-engineering** — Forbidden by project HARD rule (research.md §2.5). Not pursued.
- **Fingerprint-evasion libraries** (`puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` JA3, etc.) — Forbidden by project HARD rule (research.md §3.4).
- **Xvfb-in-CI for `headless: false` mode** — If `headless: "new"` proves insufficient against Akamai (REQ-007 verification fails), introducing Xvfb is a separate SPEC with its own operational dependency on the CI image. SPEC-003's rollback path on REQ-007 failure is deferral, not workaround.
- **IP rotation, residential proxy networks, CAPTCHA solving services, authenticated scraping** — Inherited HARD prohibitions from SPEC-001 §2.3.
- **Schema migration** — No kiko.ai Supabase schema change. ZARA fields (name, price, image URL, product URL, color names, sizes, gender) all map onto existing `Product` columns.
- **Live FX rate API** — ZARA KR is KRW-native. No FX conversion at engine OR import time. The `src/lib/fx.ts` table is untouched.
- **Linter / formatter introduction** — Inherited from SPEC-001/002. `tsc --noEmit` is the only static check.
- **Vitest framework introduction** — Inherited from SPEC-001/002. `node:test` is the runner.
- **Other deferred platforms** (29CM, Musinsa, H&M, COS, Weekday, Monki, Arket) — Status unchanged from SPEC-001/002.

### 2.3 Out-of-Scope (any future SPEC in this series)

Inherited verbatim from SPEC-001 §2.3 and SPEC-002 §2.3:
- IP rotation / residential proxy networks
- CAPTCHA solving services or third-party CAPTCHA APIs
- Headless browser fingerprint evasion libraries
- Any technique that violates a platform's robots.txt for `User-agent: *`
- Authenticated scraping (login automation, session cookie hijack)
- Inditex sub-brands deferred-with-ZARA (Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home)
- H&M Group sub-brands deferred-with-H&M (COS, Weekday, Monki, Arket)

### 2.4 Soak-Gate Status

The 7-day Uniqlo KR soak entry condition originally defined in SPEC-001 §2.4 was **removed by user direction on 2026-05-05**. SPEC-003 may proceed immediately once REQ-007 (Akamai bypass verification) and REQ-008 (ToS verification) are green. No production soak window is required.

The risks the soak gate originally guarded against (API drift, anti-bot escalation, robots.txt change) are now caught by the always-on test suite, the runtime `robots-check.ts` pre-flight, and the engine's abort-on-3-errors fail-loud behavior. Production drift, if it occurs, surfaces in the next crawl run rather than being preemptively blocked.

## 3. EARS Requirements (proposed — finalized in spec.md)

REQ-001 [Ubiquitous]: THE crawler SHALL register `zara-kr` SiteConfig with `key: "zara-kr"`, `type: "zara"`, `baseUrl: "https://www.zara.com/kr/ko"`, `sourceCurrency: "KRW"`, `crawlDelay: 2000`, hardcoded `categoryUrls`. PlatformType extended to include "zara". (research.md §1.5.)

REQ-002 [Ubiquitous]: THE ZARA engine SHALL be implemented in `src/lib/zara-engine.ts`, launching Playwright Chromium with `headless: "new"` and vanilla launch options (no stealth plugins, no fingerprint evasion). (research.md §3.4, §4.2.)

REQ-003 [Event-driven]: WHEN `pnpm crawl --site=zara-kr` runs without `--dry-run`, THE crawler SHALL iterate over `categoryUrls`, perform infinite-scroll extraction per URL, write `data/zara-kr-products.json`. Pacing: 2 sec/page. (research.md §1.4.)

REQ-004 [Event-driven]: WHEN `pnpm crawl --site=zara-kr --dry-run` (or `--probe=zara-kr`) runs, THE crawler SHALL invoke probe handler against the FIRST `categoryUrls` entry, assert real product DOM is reached (not bm-verify intercept), print sample product summary, NOT write JSON. (SPEC-001 REQ-003 dry-run pattern.)

REQ-005 [State-driven]: WHILE starting any ZARA crawl, THE crawler SHALL invoke `checkRobots` from `src/lib/robots-check.ts`. (SPEC-001 REQ-004 reused; research.md §1.1.)

REQ-006 [Unwanted Behavior]: IF 3 consecutive errors occur in a single category iteration (page.goto timeout, selector timeout, bm-verify intercept signature, or page.evaluate exception), THEN the engine SHALL abort that category, append a structured error entry to `CrawlResult.errors`, continue with next URL. No retry, no IP rotation, no evasion. (research.md §3.4, §5; SPEC-001 REQ-005 abort-on-3 pattern adapted.)

REQ-007 [State-driven]: WHILE Run-phase ANALYZE is in progress (BEFORE any production engine code), THE operator SHALL verify `headless: "new"` mode reliably bypasses Akamai bm-verify intercept (≥4 of 5 sequential page.goto calls reach real product DOM within 30 sec). If <80%, escalate to rollback path (Xvfb separate SPEC, or defer SPEC-003 entirely). NO fingerprint evasion as compensation. (research.md §3.3, §4.3.)

REQ-008 [State-driven]: WHILE Run-phase ANALYZE is in progress (AFTER REQ-007 passes, BEFORE non-dry-run crawl), THE operator SHALL read ZARA KR Korean-language ToS in a real browser, capture verbatim scrape clause into a comment block at top of `src/lib/zara-engine.ts`, AND confirm clause permits or is acceptably ambiguous about automated access. If forbidden, set `disabled: true` on SiteConfig, abandon engine, notify project owner. (research.md §1.2; project HARD rule #1.)

REQ-009 [Ubiquitous]: THE characterization-test suite at `tests/zara-engine.test.ts` SHALL load fixture, run `parseProductsFromDom` against synthetic HTML wrapping the fixture, assert all `Product` fields populated, image hosts whitelisted, productUrl format correct, price within KRW sanity range. `node:test` reused; no new dep. SHALL NOT test Playwright lifecycle. (SPEC-001 REQ-006 fixture pattern.)

Inherited from SPEC-001 (not re-stated): rate limit pacing baseline mechanic (SPEC-001 REQ-002), `--rate=N` operator override (SPEC-001 REQ-007), abort-on-3-consecutive-errors mechanic (SPEC-001 REQ-005), characterization-test runner conventions (SPEC-001 REQ-006).

## 4. Files to Modify

User decisions confirmed by orchestrator spawn prompt: ZARA KR only (region scope), Women + Men only (catalog scope), engine path determined by research (Path (a) Pure Playwright per research.md §4.2), soak gate removed.

| File | Action | Est. LOC | Reason |
|---|---|---|---|
| `src/lib/zara-engine.ts` | NEW | ~280 | Playwright Chromium engine: launch with `headless: "new"`, vanilla context options (UA rotation, ko-KR locale, Asia/Seoul timezone, 1440x900 viewport). For each URL in `config.categoryUrls`: `page.goto`, wait for product-card selector, infinite-scroll loop until count plateaus or cap reached, `page.evaluate` extraction with selector fallback chain, map to `Product[]` via `parseProductsFromDom`, image-host whitelist, abort-on-3-errors, bm-verify-intercept detector (HTML < 5KB AND contains "bm-verify"), browser closed in `finally`. Top-of-file comment block holds the verbatim ToS clause from REQ-008. |
| `src/lib/types.ts` | MODIFY | ~5 | Extend `PlatformType` union (line 53, +1 LOC) to add `"zara"`. Add optional `categoryUrls?: string[]` to `SiteConfig` (lines 97-149, +4 LOC) with JSDoc explicitly binding to `type === "zara"` (do NOT cross-contaminate with Uniqlo's `apiCategoryPaths` or the `region` field). |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `zara-kr` SiteConfig entry. Hardcoded `categoryUrls` enumerates ~18 Women + Men L2 category landing-page URLs from research.md §1.5 (verified during ANALYZE). `crawlDelay: 2000`. `sourceCurrency: "KRW"`. `notes` documents the ZARA-specific behavior. |
| `src/crawl.ts` | MODIFY | ~50 | Add `zaraSites = configs.filter((c) => c.type === "zara")` partition with sequential dispatch loop (NOT `Promise.all` — each ZARA crawl launches a Chromium browser; mirrors Cafe24 batch pattern but 1-at-a-time for now): ~30 LOC. Add `if (config.type === "zara")` branch in `probeSite` with bm-verify intercept assertion: ~20 LOC. Imports `crawlZara` from `./lib/zara-engine`. |
| `tests/fixtures/zara-kr-products.fixture.json` | NEW | ~150 | Frozen `RawZaraProduct[]` snapshot captured during Run-phase PRESERVE via `pnpm crawl --probe=zara-kr` followed by manual JSON extraction from one real category page (~50-100 products). Committed to repo. |
| `tests/zara-engine.test.ts` | NEW | ~150 | `node:test` suite. AC-1 platform registry test. AC-2 `parseProductsFromDom` against synthetic HTML wrapping fixture (asserts name/price/imageUrl/productUrl populated, image hosts whitelisted, KRW sanity). AC-4 robots-check delegation test (re-uses SPEC-001 patterns). AC-5 abort-on-3-errors mock test. AC-6 bm-verify-intercept detector test (synthetic HTML matching the intercept signature). |
| `.moai/project/structure.md` | MODIFY | ~10 | Add `zara-kr` row to platform table (now 35 entries: 22 Cafe24 + 10 Shopify + 2 Uniqlo + 1 ZARA). Document the ZARA Playwright pattern in the engine-layering subsection. |
| `package.json` | NO CHANGE | 0 | Playwright `^1.58.2` already in `dependencies` (added by Cafe24 engine era). `node:test` runner already configured by SPEC-001. No new deps, no new scripts. |

Total estimated LOC delta: **~675**.

Verification needed before Run phase:
- [x] Region scope resolved — KR only (other regions out of scope per user direction).
- [x] Catalog scope resolved — Women + Men only (Kids/Baby out of scope per user direction).
- [x] Engine path resolved — Path (a) Pure Playwright (research.md §4.2; Path (b) and (c) ruled out by §2.2-2.5 probe evidence).
- [x] Soak gate resolved — removed by user direction 2026-05-05; SPEC-003 proceeds immediately.
- [x] Sub-brand handling resolved — Inditex sub-brands deferred-with-ZARA, NOT auto-graduated by SPEC-003 success (§2.2 above).
- [x] Test framework resolved — `node:test` reused (no new dep).
- [x] Schema impact resolved — none. ZARA fields fit existing `Product` interface.
- [x] FX impact resolved — none. ZARA KR is KRW-native.
- [ ] **Pending Run-phase REQ-007**: Akamai bypass reliability ≥ 80% with `headless: "new"` mode — must verify before writing engine code.
- [ ] **Pending Run-phase REQ-008**: ZARA KR ToS Korean-language scrape clause — must read in real browser, capture verbatim, confirm acceptable, before non-dry-run crawl.
- [ ] **Pending Run-phase ANALYZE**: DOM selectors verified against live ZARA category page (research.md §1.3 selectors are best-effort hypothesis; Run-phase MUST re-verify in Playwright session).
- [ ] **Pending Run-phase ANALYZE**: `categoryUrls` list verified — research.md §1.5 noted `/kr/ko/woman-l1.html` redirected unexpectedly to `/kr/ko/kids-mkt1.html` on 2026-05-05; live URL list MUST be re-verified.

## 5. Reference Implementations (from research.md and existing code)

- **Cafe24 engine** (research.md §1 Cafe24 reference, internal `src/lib/cafe24-engine.ts`): structural template for Playwright lifecycle (browser launch, context, page navigation, selector fallback chain, abort-on-error). Specifically:
  - `cafe24-engine.ts:19-66` — `DEFAULT_SELECTORS` 8-fallback CSS selector chain pattern. ZARA's selector chain mirrors this structure (4-6 fallbacks per field) inside the `page.evaluate` block.
  - `cafe24-engine.ts:139-350` — `collectProductsFromPage` `page.evaluate` extraction pattern. ZARA's `parseProductsFromDom` borrows the structure but operates on a synthetic HTML body for testability (rather than directly on `page.evaluate` output, which is harder to fixture).
  - `cafe24-engine.ts:188-190` — comments on `tsx __name` transformation breaking `let`/`const` inside `page.evaluate`. ZARA's `page.evaluate` block MUST use `var` for the same reason.
  - `cafe24-engine.ts:354-394` — `crawlCategory` pagination loop. ZARA's loop is structurally similar but uses scroll-based termination (`page.waitForFunction(() => count plateaued)`) instead of `?page=N` numeric increment.
  - `cafe24-engine.ts:398-590` — `crawlCafe24` entry. ZARA's `crawlZara` borrows the wrapper (browser create → category iteration → result accumulation → browser close in `finally`) but launches its own Chromium internally instead of accepting a `Page` parameter, isolating ZARA's launch-options requirements.
- **Uniqlo engine** (`src/lib/uniqlo-engine.ts`, post-SPEC-002 baseline): structural template for the engine-internal abort-on-3-consecutive-errors mechanic, the 5-element UA rotation list, the image-host whitelist pattern, and the pure parse function exported for test. Specifically:
  - `uniqlo-engine.ts:47-53` — `UNIQLO_USER_AGENTS` 5-element rotation list. ZARA reuses an identical list (initially copied verbatim into `zara-engine.ts`; if a future SPEC needs to share across engines, refactor lifts it to `src/lib/user-agents.ts`).
  - `uniqlo-engine.ts:64-72` — `isSafeUniqloImageUrl` host whitelist. `zara-engine.ts` defines analogous `isSafeZaraImageUrl` with hosts `static.zara.net`, `static-images.zara.net` (verified during ANALYZE).
  - `uniqlo-engine.ts:171-229` — `parseProducts` pure function. ZARA's `parseProductsFromDom` is structurally analogous: input a DOM-extracted shape, output `Product[]`, defensive null-handling for every field.
  - `uniqlo-engine.ts:276-383` — `crawlUniqlo` outer loop with abort-on-3 mechanic. ZARA's outer loop borrows the abort counter and continue-with-next-category pattern; the "error" definition is broadened in REQ-006 to include Playwright-specific failure modes (timeout, selector-not-found, bm-verify intercept signature).
- **SiteConfig schema** (research.md §3.1 of SPEC-001 reference; internal `src/lib/types.ts:97-149`): the `categoryUrls?: string[]` field slots in alongside the existing optional fields (`apiCategoryPaths` from SPEC-001, `region` from SPEC-002). All three are bound to specific engine types via JSDoc and via the `type` discriminator in `runCrawl`'s partition step.
- **Crawl dispatch** (`src/crawl.ts:199-241`): the Uniqlo `runCrawl` partition is the structural template for ZARA's partition, BUT ZARA uses sequential dispatch (loop) instead of `Promise.all` — a single ZARA crawl already launches its own Chromium browser, and parallel browsers multiply memory cost without throughput benefit at the current 1-platform scale. The Cafe24 batch-of-3 pattern (`crawl.ts:261-300`) is the long-term reference if ZARA expands to multiple regions.
- **Probe dispatch** (`src/crawl.ts:62-93` Uniqlo branch): structural template for the ZARA probe branch. Uniqlo's branch performs one fetch and prints sample fields; ZARA's branch launches Playwright, navigates to the first `categoryUrls` URL, asserts product DOM is reached (NOT bm-verify intercept), and prints sample fields. Browser closed in `finally`.
- **robots-check helper** (`src/lib/robots-check.ts` from SPEC-001 REQ-004): used as-is, no modification. The blanket-disallow detector is engine-agnostic by design.
- **Test runner conventions** (`tests/uniqlo-engine.test.ts` from SPEC-001/002): the fixture-loading pattern, mock-fetch installer, `installFetch` helper, and parameterized assertion structure are the reference. ZARA's test file follows the same shape but with synthetic-HTML inputs instead of synthetic-JSON.

## 6. Technology Stack

No new production dependencies. No new devDependencies. Stack is unchanged from `tech.md`:

- Node.js >=22.0.0, TypeScript ^5.6.0, pnpm >=9.0.0
- Existing deps: `playwright` (^1.58.2 — used by Cafe24 engine; reused for ZARA), `@supabase/supabase-js`, `tsx`, `dotenv-cli`
- Test runner: `node:test` (built-in, inherited from SPEC-001/002)

The ZARA engine adds one new internal-only constant (the 5-element UA list, copied from `uniqlo-engine.ts` verbatim until a shared-list refactor is justified) and one new internal-only image-host whitelist (`static.zara.net`, `static-images.zara.net`, verified during ANALYZE).

**Playwright lifecycle pattern note**: Cafe24 accepts a `Page` object from outside (the launching browser is owned by `crawl.ts`'s batch dispatcher); ZARA owns the browser internally inside `crawlZara`. This is a deliberate divergence — ZARA's launch options (`headless: "new"`, specific viewport, specific timezone) are tied to the Akamai-bypass strategy and should not leak into the dispatcher's concerns. If a future SPEC introduces additional ZARA-class engines (e.g., Bershka, Pull&Bear), this pattern allows each engine to own its own launch-options surface without imposing that complexity on the dispatcher.

## 7. Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Akamai _abck cookie escalates to active 4xx block during a long crawl | High | High | 2 sec/page pacing baseline (Akamai-friendly), abort-on-3-consecutive-errors (REQ-006), no IP rotation, fail-loud via `CrawlResult.errors`. If a single full crawl run produces >50% category aborts, treat as broken (not transient) and invoke rollback path 1 or 2 from research.md §4.3. Accepted residual risk. |
| `headless: "new"` mode reliability below 80% against Akamai bm-verify | Medium | High | REQ-007 makes verification a HARD precondition before engine code is written. Bounds the risk by preventing wasted engineering effort. If verification fails: rollback path 1 (Xvfb separate SPEC) or rollback path 2 (defer entirely). NO fingerprint evasion as compensation. |
| ZARA KR ToS clause forbids automated access | Unknown (unverified) | Critical (de-facto deferral) | REQ-008 makes ToS verification in a real browser a HARD precondition. Verbatim Korean-language clause committed alongside engine code as audit evidence. If the clause forbids, set `disabled: true`, abandon engine, escalate to project owner per HARD rule #1. |
| DOM selectors become stale after a ZARA seasonal redesign (typically 1-2x/year) | Medium | Medium | Selector fallback chain inside `page.evaluate` (4-6 fallbacks per field, mirroring Cafe24's pattern). When all fallbacks fail on a category, abort-on-3-errors triggers and surfaces the failure visibly. Fixture-based characterization tests (REQ-009) catch shape drift between fixture-refresh-cadence runs. Operator refresh cadence: review fixture once per major season change OR when test failures surface. |
| `categoryUrls` list becomes stale after seasonal catalog rotation | Medium | Low | Same mechanism as Uniqlo's `apiCategoryPaths`: stale URLs return 404 or redirect (waste 1-2 requests per stale entry, not a corruption). The empty-category graceful-handling pattern from SPEC-001 REQ-002 carries over: if `page.waitForSelector` for the product-card selector fails AND the page HTML is < 5KB AND contains "404" OR redirects to a different L1, the category is logged as empty (no error entry) and the engine moves on. Operator refresh cadence: same as fixture refresh. |
| `woman-l1.html` redirect anomaly observed during research (research.md §1.6 — redirected to `kids-mkt1.html` on 2026-05-05) | Low | Low | Run-phase ANALYZE step explicitly verifies each `categoryUrls` entry resolves to the expected product list, NOT a redirect chain or a kids/marketing page. Anomalies surface during ANALYZE before the engine ships. |
| New PlatformType `"zara"` sets a precedent that future Inditex sub-brand SPECs may misuse | Low | Medium | The `categoryUrls` field is named conservatively (URL-bound, narrow type) and JSDoc explicitly binds to `type === "zara"`. Future Inditex sub-brand engines should reuse the `"zara"` PlatformType OR introduce their own narrow type — explicitly NOT a generic `"playwright"` or `"spa"` type, which would invite cross-contamination. Documented in §8 as design note D5. |
| Akamai introduces a new fingerprint signal that breaks vanilla Playwright | Low | High | Inherited from SPEC-001 mitigation philosophy: fail-loud, no evasion-library workaround. If Akamai escalates beyond what vanilla Playwright with realistic UA + locale + viewport + timezone can pass, the engine is deferred and the operator escalates to project owner. |
| robots.txt policy change (ZARA introduces blanket `Disallow: /` or path-disallows category landing pages) | Low | High | `robots-check.ts` blanket-disallow detector runs at every crawl start (REQ-005). A blanket `Disallow: /` would block. A more-targeted rule that path-disallows `/kr/ko/woman-*-l*.html` would NOT be caught by the current detector — that gap is documented in SPEC-001 §Open Risks and remains an accepted residual risk inherited unchanged. |
| Playwright lifecycle is not unit-tested → regressions go undetected until live `--probe` | Medium | Medium | Acknowledged in §6 — the engine's pure parse function is testable against a frozen fixture; the Playwright lifecycle (browser launch, navigation, scroll) is smoke-tested only via live `--probe` invocation. This is a deliberate scope ceiling inherited from Cafe24 engine (Cafe24's Playwright lifecycle is also not unit-tested in this project). Operator process: run `pnpm crawl --probe=zara-kr` after any change to `zara-engine.ts`'s lifecycle code (NOT just the parse function). Captured in acceptance.md AC-7. |

## 8. Decision Log (Pre-Resolved)

These items are pre-resolved by orchestrator spawn prompt and the research-driven engine recommendation; no user decision required at /moai run time:

- **D1 — Region scope**: ZARA KR only. Other regions (US, ES, EU, UK, JP, AU) are out of scope. Each region requires its own SPEC.
- **D2 — Catalog scope**: Women + Men only. Kids/Baby and home/lifestyle out of scope.
- **D3 — Engine path**: Path (a) Pure Playwright. Path (b) hybrid mobile-API + Playwright fallback ruled out by research.md §2.2-2.4 (every itxrest endpoint hard-blocked at gateway). Path (c) pure mobile-API ruled out by research.md §2.5 (forbidden by HARD rule).
- **D4 — Soak gate**: Removed by user direction 2026-05-05. SPEC-003 proceeds immediately.
- **D5 — PlatformType**: New `"zara"` type, distinct from `"cafe24"` (Cafe24 storefront framework) and `"shopify"` (Shopify storefront framework) and `"uniqlo"` (Uniqlo API). Future Inditex sub-brand SPECs may reuse `"zara"` if their SPA structure is identical OR introduce their own narrow type. Explicitly NOT a generic `"playwright"` or `"spa"` type.
- **D6 — Engine architecture**: NEW custom engine, NOT extending Cafe24. Cafe24's `DEFAULT_SELECTORS` and numeric pagination assume the Cafe24 storefront framework — neither applies to ZARA. The structural pattern is borrowed (Playwright lifecycle, fallback chain, abort-on-error); the implementation is independent.
- **D7 — Browser ownership**: ZARA's `crawlZara` owns its Playwright browser internally (launches and closes within the function), distinct from Cafe24's pattern of accepting a `Page` parameter from `crawl.ts`. This isolates ZARA-specific launch options (`headless: "new"`, `Asia/Seoul` timezone, 1440x900 viewport) from the dispatcher.
- **D8 — Currency**: ZARA KR is KRW-native. No FX conversion at engine OR import time. `src/lib/fx.ts` is untouched.
- **D9 — Test framework**: `node:test` reused (no new dep). Test surface covers `parseProductsFromDom` pure function against frozen fixture; Playwright lifecycle is NOT unit-tested.

Open clarifications that may surface during /moai run (low-priority, non-blocking):

- **C1 — UA rotation per request vs per context**: Playwright's browser context UA is set once per `browser.newContext` call. Per-request UA rotation would require per-request context creation (high overhead) OR `page.setExtraHTTPHeaders({"User-Agent": ...})` per request (effective but possibly fingerprint-detectable). Recommendation: one UA per crawl run, picked from rotation list at `crawlZara` entry, set on the context once. Re-evaluate if Akamai escalation patterns suggest UA-rotation is needed.
- **C2 — Image-host whitelist verification**: research.md hypothesizes `static.zara.net` and `static-images.zara.net` based on public ZARA reverse-engineering. Run-phase ANALYZE step MUST inspect actual `<img src>` values on a live ZARA category page and update the whitelist if needed.
- **C3 — Selector fallback chain composition**: research.md §1.3 lists candidate selectors (`.product-grid-product`, `[data-productid]`, `.money-amount__main`, etc.). Run-phase ANALYZE step MUST verify all of these against a live page and add fallbacks where the live DOM diverges. The DOM cannot be inspected from this research session because every curl-class fetch returns the bm-verify intercept.
- **C4 — Bm-verify intercept signature reliability**: REQ-006 defines the bm-verify signature as "HTML body length < 5000 bytes AND containing the literal string `bm-verify`." This heuristic is based on the observed 2,141-byte intercept body in research.md §1.3 + §3.1. If Akamai's intercept format changes (e.g., minified to a different size), the heuristic could miss. Run-phase IMPROVE step should add a metric counter (`interceptCount` in `CrawlResult.stats`) so operator can track intercept frequency over time and tune the heuristic.
- **C5 — Per-category product cap**: REQ-003 says "infinite-scroll loop until count plateaus or a per-category cap is reached." Initial cap recommendation: 200 products per category. Operator can tune via SiteConfig later if needed; not exposed via CLI flag in v1.

## 9. Methodology Note (DDD)

Project's `.moai/config/sections/quality.yaml` has `development_mode: ddd` (auto-config rule for projects with limited test coverage; this project has SPEC-001/002 fixture coverage but no Playwright lifecycle coverage). The Run phase will follow ANALYZE-PRESERVE-IMPROVE:

- **ANALYZE**:
  1. **Akamai bypass verification** (REQ-007): launch Playwright in a scratch script, navigate 5 sequential times to `https://www.zara.com/kr/ko/woman-new-in-l1180.html`, verify product DOM reaches in ≥4 of 5 attempts. If <80%, escalate per rollback path. If pass, proceed.
  2. **ToS verification** (REQ-008): open ZARA KR in a real browser, navigate to ToS, capture verbatim Korean-language scrape clause, paste into a comment block at top of `src/lib/zara-engine.ts`. If clause forbids, set `disabled: true`, escalate, abandon.
  3. **DOM inspection**: in the same Playwright session, inspect a live category page DOM. Verify the candidate selectors from research.md §1.3 match. Note image-host actual values (verify hypothesis `static.zara.net`, `static-images.zara.net`). Note pagination behavior (does scroll trigger AJAX, or full re-render?). Note bm-verify intercept body size and signature.
  4. **`categoryUrls` URL verification**: enumerate the live `/kr/ko/woman-*-l*.html` and `/man-*-l*.html` URLs from the page nav. Compare to research.md §1.5 starting list. Update SiteConfig if URLs have shifted.
- **PRESERVE**:
  1. Capture one live ZARA KR category page's product DOM (e.g., woman-new-in) into `tests/fixtures/zara-kr-products.fixture.json` as a `RawZaraProduct[]` array (extracted via the same `page.evaluate` block the engine will use). This is the regression baseline.
  2. Capture the bm-verify intercept HTML into a small string constant in `tests/zara-engine.test.ts` so the bm-verify-detector test can run against a frozen sample (NOT a live fetch).
  3. Run characterization tests against the fixture; confirm `parseProductsFromDom` produces the expected `Product[]` shape. The fixture is FROZEN at this point — any future engine change must either preserve the fixture's parse output or refresh the fixture and document why.
- **IMPROVE**:
  1. Implement `src/lib/zara-engine.ts` with the verified DOM selectors, image-host whitelist, infinite-scroll loop, abort-on-3-errors, bm-verify-detector. The verbatim ToS clause from REQ-008 is in the top-of-file comment block.
  2. Implement `src/lib/types.ts` PlatformType extension and `categoryUrls` field.
  3. Implement `src/configs/platforms.ts` `zara-kr` SiteConfig entry with verified `categoryUrls`.
  4. Implement `src/crawl.ts` dispatch + probe wiring.
  5. Implement `tests/zara-engine.test.ts` characterization suite. All tests green.
  6. Run `pnpm crawl --probe=zara-kr` against the live API; sample product summary prints; bm-verify intercept asserted to be bypassed.
  7. Run `pnpm crawl --site=zara-kr`; check `data/zara-kr-products.json` has ≥100 products with non-null required fields.
  8. Run `pnpm import:products`; spot-check 5 Supabase rows.

This is a **brownfield enhancement** (the project has Cafe24, Shopify, Uniqlo engines — ZARA reuses patterns from each) plus **greenfield engine addition** (no prior ZARA code). DDD is the appropriate methodology because: (a) the fixture is the binding regression artifact; (b) the engine's parse path must demonstrate it produces the expected `Product[]` shape against a frozen real-API capture before live runs are trusted; (c) project-level test coverage is low so TDD-style "test before code" doesn't apply naturally to the Playwright lifecycle.

## 10. References

- Research artifact: `.moai/specs/SPEC-PLATFORM-EXPANSION-003/research.md` (full probe results in §1-§3, engine recommendation in §4, risk register in §5, sources in §6)
- Sibling SPECs: `.moai/specs/SPEC-PLATFORM-EXPANSION-001/{spec,plan,research,acceptance}.md` (Uniqlo KR baseline, robots-check pattern, abort-on-3-errors mechanic, fixture pattern)
- Sibling SPECs: `.moai/specs/SPEC-PLATFORM-EXPANSION-002/{spec,plan,research,acceptance}.md` (region-parameterization pattern — informs that `region` is engine-internal, NOT cross-engine; FX module lift to `src/lib/fx.ts` — out of scope for SPEC-003 since ZARA KR is KRW-native)
- Project product context: `.moai/project/product.md` (32-platform original target → 34 post-SPEC-002 → 35 post-SPEC-003)
- Project structure context: `.moai/project/structure.md` ("Adding a New Platform" checklist amended by SPEC-001 to include robots-check; SPEC-003 adds ZARA Playwright pattern note to engine-layering subsection)
- Project tech context: `.moai/project/tech.md` (Playwright `^1.58.2` already in deps, `node:test` runner already configured)
- Live probe methodology reference: `.moai/research/uniqlo-multistore-probe-2026-05-05.md`
- Existing engine references:
  - `src/lib/cafe24-engine.ts` — Playwright lifecycle template (browser/context/page, selector fallback chain, abort-on-error, in-evaluate `var` constraint)
  - `src/lib/uniqlo-engine.ts` — Pure parse function pattern, UA rotation list, image-host whitelist, abort-on-3-errors counter mechanic
  - `src/lib/robots-check.ts` — Reused unchanged (REQ-005)
- SiteConfig schema: `src/lib/types.ts:53` (PlatformType) and `:97-149` (SiteConfig interface)
- Dispatch surface: `src/crawl.ts:62-93` (Uniqlo probe template), `:199-241` (Uniqlo runCrawl partition template), `:261-300` (Cafe24 batch dispatch reference)
- Test surface: `tests/uniqlo-engine.test.ts` (test structure precedent: fixture loading, `installFetch` mock, parameterized assertions)

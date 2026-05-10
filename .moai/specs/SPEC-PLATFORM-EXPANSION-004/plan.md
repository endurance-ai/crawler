# Plan: SPEC-PLATFORM-EXPANSION-004 — 29CM (KR) Playwright + XHR-Interception Engine

Status: draft
Author: manager-spec subagent
Date: 2026-05-05

## 1. Intent

Add 29CM (KR storefront) as the 36th registered platform in the crawler — the second Playwright-based engine after ZARA, the first Cloudflare-fronted (vs Akamai-fronted) Playwright engine, and the first new engine since SPEC-003 (commit `ccda0fe`). This is the second engine that the project research has classified as requiring real-browser execution rather than plain fetch (the first was ZARA), but unlike ZARA, the gating concern is NOT an active bot-wall challenge — it is an **auth-gated internal XHR endpoint**: every public 29CM API endpoint that returns full-catalog product data is either (a) keyword-required (`search-api`, no list mode) or (b) auth-gated (`item-api`, `display-bff-api` returning 500/404 from external clients). The only path that delivers full Women + Men catalog products is to execute the SPA in a real browser context, let it acquire its own cookies and any JWT injected by the SPA middleware, and intercept the XHR responses the SPA fires after hydration. This is the same pattern SPEC-003 ZARA established. The Run phase is gated by two HARD preconditions encoded as REQ-007 (Playwright vanilla `headless: "new"` reliability ≥ 80% verified against the live 29CM KR category page including XHR interception) and REQ-008 (29CM KR Korean-language ToS clause read in a real browser, verbatim text committed as audit evidence). If either precondition fails, the engine is shelved before any production code is written. This SPEC executes immediately — the SPEC-001 7-day soak gate was removed by user direction on 2026-05-05.

## 2. Scope

### 2.1 In-Scope

- New file `src/lib/29cm-engine.ts` (~300 LOC) implementing Playwright + XHR-interception against 29CM KR category landing pages (research.md §4.2; architecture impact subsection of spec.md). Browser launched internally with vanilla `headless: "new"` (NOT `channel: "chrome"` by default — see REQ-007), realistic context (UA from 5-element rotation list shared with Uniqlo/ZARA, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport: 1440x900`), `page.on("response")` listener for product-list XHR capture, infinite-scroll loop, abort-on-3-consecutive-errors, Cloudflare-challenge-intercept detector, gender derivation from L1 category code.
- `PlatformType` union extension from `"cafe24" | "shopify" | "uniqlo" | "zara"` to `"cafe24" | "shopify" | "uniqlo" | "zara" | "29cm"` in `src/lib/types.ts:53`.
- New optional `SiteConfig` field `apiCategoryCodes?: number[]` in `src/lib/types.ts` (added alongside the existing `apiCategoryPaths`, `categoryUrls`, and `region` fields), JSDoc binding to `type === "29cm"`.
- New SiteConfig entry `29cm-kr` in `src/configs/platforms.ts` with hardcoded `apiCategoryCodes` listing 10 Women + Men L1 category codes (research.md §1.6). `crawlDelay: 2000`. `sourceCurrency: "KRW"`.
- Engine dispatch wiring in `src/crawl.ts:runCrawl` to route `type === "29cm"` to the new engine (sequential, NOT `Promise.all` — each 29CM crawl launches its own Chromium browser; mirrors ZARA dispatch). ~30 LOC.
- Probe handler in `src/crawl.ts:probeSite` for the `"29cm"` branch with Cloudflare-challenge-intercept assertion. ~20 LOC.
- New characterization fixture `tests/fixtures/29cm-products.fixture.json` (frozen XHR JSON snapshot from one real 29CM category page, captured ONCE during Run-phase PRESERVE step).
- New characterization tests in `tests/29cm-engine.test.ts` running `parseProductsFromXhr` (the engine's pure parse function) against the XHR fixture; running `parseProductsFromDom` against a small synthetic HTML body; testing `is29cmCloudflareChallenge` against synthetic challenge HTML; image-host whitelist test; abort-on-3-errors test (mocked). `node:test` runner reused (no new dep).
- robots-check pre-flight at every 29CM crawl start (REQ-005, reused from SPEC-001 REQ-004 — no code change to `src/lib/robots-check.ts`).
- Update to `.moai/project/structure.md` Step 1 of "Adding a New Platform" — add 29CM Playwright + XHR-interception sub-pattern note to the engine-layering subsection (Cloudflare-passive variant); bump platform table count from 35 to 36.

### 2.2 Out-of-Scope (this SPEC)

- **29CM lifestyle/design/books/kitchen/beauty/electronics categories** — codes 265100100, 266100100, 291100100, 292100100, 293100100, 294100100 are NOT in scope. Only the 10 fashion codes (Women + Men 의류/가방/슈즈/액세서리/주얼리) are crawled. A future SPEC may add lifestyle coverage.
- **29CM regions other than KR** — 29CM is a Korean-only e-commerce platform. The `region`-parameterization pattern from SPEC-002 (Uniqlo KR + US) does NOT apply.
- **Musinsa graduation** — 29CM is owned by Musinsa (acquired 2021) but Musinsa.com remains deferred per project HARD rule #1 (verbatim `Disallow: /` for `User-agent: *`). SPEC-004 is NOT a precedent for Musinsa graduation. 29CM's permissive robots.txt does NOT carry over to Musinsa.com.
- **Mobile-app reverse-engineering** — forbidden by project HARD rules. Not pursued.
- **Fingerprint-evasion libraries** — `puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` JA3, etc. are forbidden by project HARD rules. The engine MUST work with vanilla Playwright + realistic UA + locale + viewport + timezone (or `channel: "chrome"` if escalation required), OR not at all.
- **Xvfb-in-CI for `headless: false` mode** — if vanilla `headless: "new"` AND `channel: "chrome"` both prove insufficient, introducing Xvfb is a separate SPEC. SPEC-004's rollback path on REQ-007 failure beyond `channel: "chrome"` is deferral, not workaround.
- **IP rotation, residential proxy networks, CAPTCHA solving services, authenticated scraping** — inherited HARD prohibitions from SPEC-001 §2.3 and SPEC-003 §2.3.
- **Schema migration** — no kiko.ai Supabase schema change. 29CM fields map onto existing `Product` columns.
- **Live FX rate API** — 29CM KR is KRW-native. No FX conversion. The `src/lib/fx.ts` table is untouched.
- **Linter / formatter introduction** — inherited from SPEC-001/002/003. `tsc --noEmit` is the only static check.
- **Vitest framework introduction** — inherited from SPEC-001/002/003. `node:test` is the runner.
- **Other deferred platforms** (H&M, COS, Weekday, Monki, Arket, Inditex sub-brands) — status unchanged from SPEC-001/002/003.

### 2.3 Out-of-Scope (any future SPEC in this series)

Inherited verbatim from SPEC-001 §2.3, SPEC-002 §2.3, SPEC-003 §2.3:
- IP rotation / residential proxy networks
- CAPTCHA solving services or third-party CAPTCHA APIs
- Headless browser fingerprint evasion libraries
- Any technique that violates a platform's robots.txt for `User-agent: *`
- Authenticated scraping (login automation, session cookie hijack, token replay)
- Inditex sub-brands deferred-with-ZARA (Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home)
- H&M Group sub-brands deferred-with-H&M (COS, Weekday, Monki, Arket)
- Musinsa.com (owns 29CM but separate robots.txt blocker — see §2.2)

### 2.4 Soak-Gate Status

The 7-day Uniqlo KR soak entry condition originally defined in SPEC-001 §2.4 was **removed by user direction on 2026-05-05**. SPEC-004 may proceed immediately once REQ-007 (Cloudflare-bypass verification) and REQ-008 (ToS verification) are green. No production soak window is required.

The risks the soak gate originally guarded against (API drift, anti-bot escalation, robots.txt change) are now caught by the always-on test suite, the runtime `robots-check.ts` pre-flight, and the engine's abort-on-3-errors fail-loud behavior. Production drift, if it occurs, surfaces in the next crawl run rather than being preemptively blocked.

## 3. EARS Requirements (proposed — finalized in spec.md)

REQ-001 [Ubiquitous]: THE crawler SHALL register `29cm-kr` SiteConfig with `key: "29cm-kr"`, `type: "29cm"`, `baseUrl: "https://www.29cm.co.kr"`, `sourceCurrency: "KRW"`, `crawlDelay: 2000`, hardcoded `apiCategoryCodes: number[]` (10 entries). PlatformType extended to include "29cm". (research.md §1.6.)

REQ-002 [Ubiquitous]: THE 29CM engine SHALL be implemented in `src/lib/29cm-engine.ts`, launching Playwright Chromium with vanilla `headless: "new"` (NOT `channel: "chrome"` by default) and vanilla launch options (no stealth plugins, no fingerprint evasion). (research.md §3, §4.2.)

REQ-003 [Event-driven]: WHEN `pnpm crawl --site=29cm-kr` runs without `--dry-run`, THE crawler SHALL iterate over `apiCategoryCodes`, construct category URL per code, perform infinite-scroll extraction with XHR interception (preferred) or DOM scrape (fallback) per category, write `data/29cm-products.json`. Pacing: 2 sec/category. (research.md §1.5, §1.6.)

REQ-004 [Event-driven]: WHEN `pnpm crawl --site=29cm-kr --dry-run` (or `--probe=29cm-kr`) runs, THE crawler SHALL invoke probe handler against the FIRST `apiCategoryCodes` entry, assert real product DOM is reached (not Cloudflare challenge intercept), print sample product summary, NOT write JSON. (SPEC-001 REQ-003 dry-run pattern; SPEC-003 REQ-004 Playwright probe pattern.)

REQ-005 [State-driven]: WHILE starting any 29CM crawl, THE crawler SHALL invoke `checkRobots` from `src/lib/robots-check.ts`. (SPEC-001 REQ-004 reused; research.md §1.1.)

REQ-006 [Unwanted Behavior]: IF 3 consecutive errors occur in a single category iteration (page.goto timeout, selector-not-found AND no XHR captured, Cloudflare-challenge intercept signature, page.evaluate exception, or JSON parse error), THEN the engine SHALL abort that category, append a structured error entry to `CrawlResult.errors`, continue with next code. No retry, no IP rotation, no evasion. (research.md §3.3, §5; SPEC-001 REQ-005 abort-on-3 pattern adapted; SPEC-003 REQ-006 broadened.)

REQ-007 [State-driven]: WHILE Run-phase ANALYZE is in progress (BEFORE any production engine code), THE operator SHALL verify vanilla `headless: "new"` mode reliably reaches real product DOM AND intercepts at least one JSON XHR (≥4 of 5 sequential page.goto calls satisfy: HTML > 5KB AND ≥1 application/json XHR captured AND ≥10 product card hrefs in DOM). If <80%, escalate to `channel: "chrome"` (1-LOC change); if still <80%, escalate to Xvfb separate SPEC or defer SPEC-004 entirely. NO fingerprint evasion as compensation. (research.md §3, §4.4.)

REQ-008 [State-driven]: WHILE Run-phase ANALYZE is in progress (AFTER REQ-007 passes, BEFORE non-dry-run crawl), THE operator SHALL open `https://www.29cm.co.kr/home/agreement` in the same Playwright session, capture the rendered Korean ToS text, scan for keywords (자동화, 크롤, 스크래, 봇, 로봇, 데이터 수집, 추출, agent, robot, scrape, crawl, automated, automation, AI 학습, 머신러닝), embed verbatim relevant clauses as comment block at top of `src/lib/29cm-engine.ts`, AND classify verdict (PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS). If FORBIDS, set `disabled: true` on SiteConfig, abandon engine, escalate. (research.md §1.2; project HARD rule #1; SPEC-003 v0.1.0 pattern pre-amendment.)

REQ-009 [Ubiquitous]: THE characterization-test suite at `tests/29cm-engine.test.ts` SHALL load XHR fixture, run `parseProductsFromXhr` against it, assert all `Product` fields populated, image hosts whitelisted, productUrl format correct, price within KRW sanity range, gender derived correctly. SHALL ALSO test `parseProductsFromDom` against synthetic HTML and `is29cmCloudflareChallenge` against synthetic challenge HTML. `node:test` reused; no new dep. SHALL NOT test Playwright lifecycle. (SPEC-001 REQ-006 fixture pattern; SPEC-003 REQ-009 architecture.)

Inherited from SPEC-001 (not re-stated): rate limit pacing baseline mechanic (SPEC-001 REQ-002), `--rate=N` operator override (SPEC-001 REQ-007), abort-on-3-consecutive-errors mechanic (SPEC-001 REQ-005), characterization-test runner conventions (SPEC-001 REQ-006).

Inherited from SPEC-003 (not re-stated): Playwright lifecycle pattern, ToS clause embedding contract (verbatim Korean text at top of engine source).

## 4. Files to Modify

User decisions confirmed by orchestrator spawn prompt: 29CM KR only (region scope, KR-only platform anyway), Women + Men full fashion catalog (10 L1 codes), engine path determined by research (Path (c) Pure Playwright + XHR interception per research.md §4.2), soak gate removed, vanilla `headless: "new"` is the default browser launch (Cloudflare passive per research.md §3.1).

| File | Action | Est. LOC | Reason |
|---|---|---|---|
| `src/lib/29cm-engine.ts` | NEW | ~300 | Playwright + XHR-interception engine: vanilla `headless: "new"`, vanilla context options (UA rotation, ko-KR locale, Asia/Seoul timezone, 1440x900 viewport). For each numeric code in `config.apiCategoryCodes`: construct URL `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED`, `page.goto`, install `page.on("response")` listener (heuristic: capture JSON payloads from `display-bff-api`/`item-api`/`front-api` hosts), wait for first XHR or product-card selector, infinite-scroll until product count plateaus or 200 cap reached, extract via `parseProductsFromXhr` (preferred) or `parseProductsFromDom` (fallback), apply image-host whitelist, derive gender from L1 code mapping, abort-on-3-errors, Cloudflare-challenge detector (`is29cmCloudflareChallenge`: HTML < 5KB AND contains `cf-mitigated`/`Just a moment`/`cf-challenge-platform`), browser closed in `finally`. Top-of-file comment block holds the verbatim ToS clause from REQ-008. |
| `src/lib/types.ts` | MODIFY | ~5 | Extend `PlatformType` union (line 53, +1 LOC) to add `"29cm"`. Add optional `apiCategoryCodes?: number[]` to `SiteConfig` (+4 LOC) with JSDoc explicitly binding to `type === "29cm"` (do NOT cross-contaminate with Uniqlo's `apiCategoryPaths` or ZARA's `categoryUrls` or the `region` field). |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `29cm-kr` SiteConfig entry. Hardcoded `apiCategoryCodes: [268100100, 269100100, 270100100, 271100100, 305100100, 272100100, 273100100, 274100100, 275100100, 306100100]`. `crawlDelay: 2000`. `sourceCurrency: "KRW"`. `notes` documents the 29CM-specific Cloudflare-passive Playwright + XHR-interception behavior. |
| `src/crawl.ts` | MODIFY | ~50 | Add `twentyninecmSites = configs.filter((c) => c.type === "29cm")` partition with sequential dispatch loop (NOT `Promise.all` — mirrors ZARA's per-engine browser-launch pattern): ~30 LOC. Add `if (config.type === "29cm")` branch in `probeSite` with Cloudflare-challenge intercept assertion: ~20 LOC. Imports `crawl29cm` from `./lib/29cm-engine`. |
| `tests/fixtures/29cm-products.fixture.json` | NEW | ~150 | Frozen intercepted XHR JSON response captured during Run-phase PRESERVE via `pnpm crawl --probe=29cm-kr` with a debug `console.log(json)` call on the first intercepted XHR (~50-100 products from one category page, e.g. categoryLargeCode=268100100 / 여성의류). Committed to repo. |
| `tests/29cm-engine.test.ts` | NEW | ~150 | `node:test` suite. AC-1 platform registry test. AC-2 `parseProductsFromXhr` against XHR fixture (asserts name/price/imageUrl/productUrl populated, image hosts whitelisted, KRW sanity range, gender derived from L1 code). AC-2b `parseProductsFromDom` against synthetic HTML. AC-3-detector `is29cmCloudflareChallenge` against synthetic challenge HTML. AC-4 robots-check delegation test (re-uses SPEC-001 patterns). AC-5 abort-on-3-errors mock test. |
| `.moai/project/structure.md` | MODIFY | ~10 | Add `29cm-kr` row to platform table (now 36 entries: 22 Cafe24 + 10 Shopify + 2 Uniqlo + 1 ZARA + 1 29CM). Document the 29CM Cloudflare-passive Playwright + XHR-interception sub-pattern in the engine-layering subsection. |
| `package.json` | NO CHANGE | 0 | Playwright `^1.58.2` already in `dependencies`. `node:test` runner already configured. No new deps. |

Total estimated LOC delta: **~695**.

Verification needed before Run phase:
- [x] Catalog scope resolved — Women + Men full fashion (10 L1 codes), lifestyle/etc out of scope.
- [x] Engine path resolved — Path (c) Pure Playwright + XHR interception (research.md §4.2; Path (a) and Path (b) ruled out by §2 probe evidence).
- [x] Soak gate resolved — removed by user direction 2026-05-05; SPEC-004 proceeds immediately.
- [x] Browser config resolved — vanilla `headless: "new"` default; `channel: "chrome"` documented as Run-phase escalation path (research.md §3.1, §4.3).
- [x] Region scope resolved — KR only (29CM is KR-only platform; `region` field NOT used).
- [x] Sub-brand handling resolved — 29CM has no sub-brands. Musinsa is the parent corp but remains deferred per HARD rule #1 (separate robots.txt blocker). SPEC-004 does NOT precedent Musinsa graduation.
- [x] Test framework resolved — `node:test` reused (no new dep).
- [x] Schema impact resolved — none. 29CM fields fit existing `Product` interface.
- [x] FX impact resolved — none. 29CM KR is KRW-native.
- [x] Field naming resolved — new `apiCategoryCodes?: number[]` field, distinct from Uniqlo/`apiCategoryPaths`, ZARA/`categoryUrls`, Uniqlo/`region`.
- [ ] **Pending Run-phase REQ-007**: Cloudflare-bypass + XHR-interception reliability ≥ 80% with `headless: "new"` mode — must verify before writing engine code.
- [ ] **Pending Run-phase REQ-008**: 29CM KR ToS Korean-language clause — must read in real Playwright session, capture verbatim, classify verdict, embed in engine source. ToS could not be retrieved via curl at plan phase (CSR shell).
- [ ] **Pending Run-phase ANALYZE**: actual XHR endpoint URL + response shape verified. Research §2.4-2.6 narrowed candidates to `display-bff-api` and `item-api` but exact URL not confirmable from external client.
- [ ] **Pending Run-phase ANALYZE**: image-host whitelist verified — research hypothesizes `img.29cm.co.kr` and `asset.29cm.co.kr` based on home page HTML inspection; Playwright session MUST inspect actual `<img src>` values on a live category page and update the whitelist if needed.
- [ ] **Pending Run-phase ANALYZE**: DOM selector fallback chain composition — `[href^="/product/catalog/"]` is the candidate primary; child selectors for name/price/image must be verified against a live page.

## 5. Reference Implementations (from research.md and existing code)

- **ZARA engine** (`src/lib/zara-engine.ts`, ~280 LOC, post-SPEC-003 baseline): structural template for the entire 29CM engine. SPEC-004 reuses the pattern wholesale with only three deltas:
  1. Vanilla `headless: "new"` instead of `channel: "chrome"` (Cloudflare passive vs Akamai active).
  2. Cloudflare-challenge detector (`is29cmCloudflareChallenge`) instead of bm-verify detector. Different HTML signature.
  3. Numeric category codes consumed via `apiCategoryCodes: number[]` and converted to URLs at runtime, instead of pre-built URL strings via `categoryUrls: string[]`.

  Specifically reused from `zara-engine.ts`:
  - Browser/context/page lifecycle wrapper (browser create → category iteration → result accumulation → browser close in `finally`).
  - `page.on("response")` AJAX-interception listener installed at context start.
  - 5-element UA rotation list, applied once per crawl run (NOT per request — Playwright's context UA is set once per `browser.newContext`, mirrors ZARA pattern).
  - Image-host whitelist function (`isSafeUniqloImageUrl` template).
  - `parseProductsFromDom` pure parse function with selector fallback chain, exported for unit testing against synthetic HTML.
  - Abort-on-3-consecutive-errors counter mechanic, broadened to include Playwright-specific failure modes.
  - Top-of-file comment block holding verbatim Korean ToS clause + capture metadata.

- **Uniqlo engine** (`src/lib/uniqlo-engine.ts`, post-SPEC-002 baseline): structural template for:
  - 5-element UA rotation list (`UNIQLO_USER_AGENTS`). 29CM reuses an identical list (initially copied verbatim into `29cm-engine.ts`; if a future SPEC needs to share across engines, refactor lifts it to `src/lib/user-agents.ts`).
  - Numeric-code → URL construction pattern (Uniqlo: `apiCategoryPaths` strings → API URL with `?path=...` param; 29CM: `apiCategoryCodes` numbers → page URL with `?categoryLargeCode=...` param). The contract is structurally similar even though the field types differ.
  - `parseProducts` pure-function pattern. 29CM has TWO pure parse functions (`parseProductsFromXhr` and `parseProductsFromDom`), one for each extraction path.

- **Cafe24 engine** (`src/lib/cafe24-engine.ts`, 591 LOC): structural reference for `var` constraint inside `page.evaluate` (cafe24-engine.ts:188-190 documents that `tsx __name` transformation breaks `let`/`const` inside `page.evaluate`; 29CM's `page.evaluate` block MUST use `var` for the same reason).

- **SiteConfig schema** (`src/lib/types.ts`): the new `apiCategoryCodes?: number[]` field slots in alongside existing optional fields (`apiCategoryPaths` from SPEC-001, `categoryUrls` from SPEC-003, `region` from SPEC-002). All four are bound to specific engine types via JSDoc and via the `type` discriminator in `runCrawl`'s partition step.

- **Crawl dispatch** (`src/crawl.ts`): the ZARA `runCrawl` partition is the structural template for 29CM's partition (sequential loop, mirrors the per-engine browser-launch isolation). The Uniqlo `runCrawl` partition (`Promise.all` with parallel fetches) is NOT the right template here — fetches are cheap, browser launches are not.

- **Probe dispatch** (`src/crawl.ts:probeSite` ZARA branch): structural template for the 29CM probe branch. ZARA's branch launches Playwright, navigates to the first `categoryUrls` URL, asserts product DOM is reached (NOT bm-verify intercept), and prints sample fields. 29CM's branch is identical except: navigates to URL constructed from first `apiCategoryCodes` entry, asserts NO Cloudflare challenge, can additionally print the first intercepted XHR's first product if available (otherwise prints DOM-extracted first card).

- **robots-check helper** (`src/lib/robots-check.ts` from SPEC-001 REQ-004): used as-is, no modification. The blanket-disallow detector is engine-agnostic by design.

- **Test runner conventions** (`tests/zara-engine.test.ts` from SPEC-003): the fixture-loading pattern, mock-fetch installer, parameterized assertion structure are the reference. 29CM's test file follows the same shape with two extensions: a separate test for `parseProductsFromXhr` (input is JSON, not HTML) and a separate test for `is29cmCloudflareChallenge` detector.

## 6. Technology Stack

No new production dependencies. No new devDependencies. Stack is unchanged from `tech.md`:

- Node.js >=22.0.0, TypeScript ^5.6.0, pnpm >=9.0.0
- Existing deps: `playwright` (^1.58.2 — used by Cafe24, ZARA; reused for 29CM), `@supabase/supabase-js`, `tsx`, `dotenv-cli`
- Test runner: `node:test` (built-in, inherited from SPEC-001/002/003)

The 29CM engine adds one new internal-only constant (the 5-element UA list, copied from `uniqlo-engine.ts`/`zara-engine.ts` verbatim until a shared-list refactor is justified) and one new internal-only image-host whitelist (`img.29cm.co.kr`, `asset.29cm.co.kr`, verified during ANALYZE).

**Playwright lifecycle pattern note**: 29CM owns its browser internally inside `crawl29cm`, mirroring ZARA's pattern (and distinct from Cafe24's `Page`-injection pattern). This is a deliberate inheritance — 29CM's launch options (`headless: "new"`, specific viewport, specific timezone) are tied to the Cloudflare-passive bypass strategy and should not leak into the dispatcher's concerns. If a future SPEC introduces additional Cloudflare-fronted engines, this pattern allows each engine to own its own launch-options surface without imposing that complexity on the dispatcher.

**Browser-launch escalation path note**: vanilla `headless: "new"` is the default. `channel: "chrome"` is documented as a 1-LOC escalation if REQ-007 verification fails (research.md §4.3). The escalation does NOT require a SPEC amendment — it's pre-authorized as a minimal change, consistent with project HARD rule #1 (which forbids fingerprint evasion BUT permits using a real Chrome binary, which is structurally equivalent to the Cafe24 engine's choice of Chromium).

## 7. Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cloudflare tightens posture and active-blocks vanilla Playwright | Low | High | 2 sec/category pacing (Cloudflare-friendly), abort-on-3-consecutive-errors (REQ-006), no IP rotation, fail-loud via `CrawlResult.errors`. REQ-007 gates engine code; if vanilla `headless: "new"` is below 80% reliability, escalate to `channel: "chrome"` (1-LOC change); if still below, escalate to Xvfb separate SPEC or defer entirely. NO fingerprint evasion as compensation. Accepted residual risk. |
| The internal XHR endpoint requires auth that vanilla Playwright doesn't acquire | Low | High | A real Playwright session naturally inherits the SPA's cookies and any JWT/session-token injected by the SPA's `_app` middleware (the SPA executes its full bootstrap, including auth-token-acquisition logic). If this fails, fallback path: programmatic scroll + DOM extraction via `parseProductsFromDom` (`[href^="/product/catalog/"]` selector). The engine has both paths and prefers XHR; DOM is the safety net. |
| 29CM KR ToS clause forbids automated access | Unknown (could not verify via curl at plan phase) | Critical (de-facto deferral) | REQ-008 makes ToS verification in a real Playwright browser a HARD precondition. The verbatim Korean clause (or relevant clauses) is committed alongside engine code as audit evidence. If the clause unambiguously forbids, set `disabled: true`, abandon engine, escalate to project owner per HARD rule #1. If clauses are ambiguous (analogous to ZARA §15 IP rights), operator has authority to classify AMBIGUOUS-ACCEPTED-BY-OWNER and proceed. Verdict label is one of: PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS. |
| Cloudflare cookie expires mid-crawl | Low | Medium | Cookie lifetime observed at 30 minutes (research.md §3.1 probed `__cf_bm` with `expires=2026-05-05 11:43:01`). A full Women+Men crawl with 10 categories at 2 sec/category + ~10 sec/category for scroll/XHR ≈ 2 minutes. Well within cookie lifetime. If a long-running crawl hits expiration, abort-on-3-errors triggers naturally and the next run starts fresh. |
| DOM selectors / XHR shape become stale after a 29CM redesign (1-2x/year typical) | Medium | Medium | Selector fallback chain inside `page.evaluate` (4-6 fallbacks per field, mirroring ZARA's pattern). When all fallbacks fail on a category, abort-on-3-errors triggers and surfaces the failure visibly. Fixture-based characterization tests (REQ-009) catch shape drift between fixture-refresh-cadence runs. Operator refresh cadence: review fixture once per major season change OR when test failures surface. |
| `apiCategoryCodes` list becomes stale after 29CM reorganizes its taxonomy | Low | Low | Stale codes return 404 or empty list (waste 1 page-navigation per stale entry, not a corruption). The empty-category graceful-handling pattern from SPEC-001 REQ-002 carries over: if `page.waitForSelector` fails AND HTML is < 5KB (Cloudflare challenge OR 404 page), the category is logged as empty and engine moves on. Operator refresh cadence: review code list once per year via the `apihub.29cm.co.kr/item/category/?category1_code={code}` probe (research.md §1.6). |
| New PlatformType `"29cm"` sets a precedent that future Cloudflare-fronted engines may misuse | Low | Medium | The `apiCategoryCodes` field is named conservatively (numeric-code-bound, narrow type) and JSDoc explicitly binds to `type === "29cm"`. Future Cloudflare-passive engines should introduce their own narrow type — explicitly NOT a generic `"playwright"` or `"cloudflare"` type, which would invite cross-contamination. Documented in §8 as design note D5. |
| Cloudflare introduces a new fingerprint signal that breaks vanilla Playwright AND `channel: "chrome"` | Low | High | Inherited from SPEC-001 mitigation philosophy: fail-loud, no evasion-library workaround. If both browser-launch modes fail, the engine is deferred and the operator escalates to project owner. This is a process-level mitigation, not a code-level one. |
| robots.txt policy change (29CM introduces blanket `Disallow: /` or path-disallows category landing pages) | Low | High | `robots-check.ts` blanket-disallow detector runs at every crawl start (REQ-005). A blanket `Disallow: /` would block the next crawl. A more-targeted rule (e.g., `Disallow: /store/category/`) would NOT be caught by the current detector — that gap is documented in SPEC-001 §Open Risks and remains an accepted residual risk inherited unchanged. |
| Playwright lifecycle is not unit-tested → regressions go undetected until live `--probe` | Medium | Medium | Acknowledged in §6 — the engine's pure parse functions (`parseProductsFromXhr`, `parseProductsFromDom`) are testable against frozen fixtures; the Playwright lifecycle (browser launch, navigation, scroll, XHR interception) is smoke-tested only via live `--probe` invocation. Operator process: run `pnpm crawl --probe=29cm-kr` after any change to lifecycle code. Captured in acceptance.md AC-7. |
| 29CM is owned by Musinsa and a future M&A change could revoke the permissive ToS / robots.txt | Very Low | High | Out of project control. Mitigation: REQ-008 ToS verification at plan phase + Run-phase plus the cease-and-desist response policy (immediate `disabled: true`) covers the corporate-policy-change scenario. No further engineering mitigation possible. |

## 8. Decision Log (Pre-Resolved)

These items are pre-resolved by orchestrator spawn prompt and the research-driven engine recommendation; no user decision required at /moai run time:

- **D1 — Region scope**: 29CM KR only. 29CM is a Korean-only platform. The `region`-parameterization pattern from SPEC-002 does NOT apply.
- **D2 — Catalog scope**: Women + Men full fashion catalog (10 L1 codes). Lifestyle/design/books/kitchen/beauty/electronics out of scope.
- **D3 — Engine path**: Path (c) Pure Playwright + XHR interception. Path (a) mobile-API discovery ruled out by research.md §2.2-2.6 (search-api keyword-required, item-api/display-bff-api auth-gated). Path (b) Next.js RSC reverse-engineering ruled out by §2.7 (no products in RSC streams).
- **D4 — Soak gate**: Removed by user direction 2026-05-05. SPEC-004 proceeds immediately.
- **D5 — PlatformType**: New `"29cm"` type, distinct from `"cafe24"`, `"shopify"`, `"uniqlo"`, `"zara"`. Future Cloudflare-passive Playwright SPECs may introduce their own narrow types. Explicitly NOT a generic `"playwright"` or `"cloudflare"` type.
- **D6 — Engine architecture**: NEW custom engine, modeled on ZARA's structural pattern but with three deltas: (1) vanilla `headless: "new"` default, (2) Cloudflare-challenge detector instead of bm-verify, (3) `apiCategoryCodes: number[]` URL-construction instead of `categoryUrls: string[]`.
- **D7 — Browser ownership**: 29CM's `crawl29cm` owns its Playwright browser internally (launches and closes within the function), mirroring ZARA's pattern. Isolates 29CM-specific launch options from the dispatcher.
- **D8 — Currency**: 29CM KR is KRW-native. No FX conversion. `src/lib/fx.ts` is untouched.
- **D9 — Test framework**: `node:test` reused (no new dep). Test surface covers `parseProductsFromXhr` + `parseProductsFromDom` pure functions + `is29cmCloudflareChallenge` detector against frozen fixtures; Playwright lifecycle is NOT unit-tested.
- **D10 — Browser launch mode**: Vanilla `headless: "new"` is the default; `channel: "chrome"` is documented as a 1-LOC Run-phase escalation if REQ-007 verification fails. The escalation is pre-authorized — does NOT require a SPEC amendment.

Open clarifications that may surface during /moai run (low-priority, non-blocking):

- **C1 — Exact XHR endpoint URL**: Research narrowed candidates to `display-bff-api.29cm.co.kr` and `item-api.29cm.co.kr` but the exact URL was not confirmable from external clients (auth-gated returns 404/500). Run-phase ANALYZE step MUST inspect `page.on("request")` to enumerate all XHRs the SPA fires, identify the product-list one (heuristic: largest application/json body, contains `itemNo` or `frontBrand` keys), and document the URL. The `page.on("response")` listener heuristic in `29cm-engine.ts` MAY be tightened from "any JSON from `*-api.29cm.co.kr`" to "exactly URL pattern X" once confirmed.
- **C2 — XHR response shape**: Research hypothesizes the shape is similar to `search-api.29cm.co.kr/api/v4/products` (which returned `{result: "SUCCESS", data: [{itemNo, itemName, frontBrandNameKor, frontBrandNameEng, consumerPrice, imageUrl, lastSalePrice, isSoldOut, frontCategoryInfo: [{categoryLargeCode, categoryLargeName, ...}], colorHexes: [...], ...}], ...}`). The actual list-API may have a different shape (cursor pagination, different field naming). `parseProductsFromXhr` MUST be defensive — read fields with optional chaining, fall back to `null` for missing fields.
- **C3 — UA rotation per request vs per context**: Same constraint as ZARA. Playwright's browser context UA is set once per `browser.newContext` call. One UA per crawl run, picked from rotation list at `crawl29cm` entry, set on the context once.
- **C4 — Image-host whitelist verification**: Research hypothesizes `img.29cm.co.kr` and `asset.29cm.co.kr` based on home page HTML inspection. Run-phase ANALYZE step MUST inspect actual `<img src>` values on a live category page and update the whitelist if needed.
- **C5 — DOM selector fallback chain composition**: `[href^="/product/catalog/"]` is the candidate primary selector for product cards. Run-phase ANALYZE step MUST verify and add 3-5 fallback selectors for name/price/image inside each card.
- **C6 — Cloudflare-challenge signature**: Initial heuristic is "HTML body length < 5,000 bytes AND containing `cf-mitigated` OR `Just a moment` OR `cf-challenge-platform`." Run-phase IMPROVE step should add a metric counter (`cloudflareInterceptCount` in `CrawlResult.stats`) so operator can track intercept frequency over time and tune the heuristic.
- **C7 — Per-category product cap**: REQ-003 says "infinite-scroll loop until count plateaus or a per-category cap is reached." Initial cap recommendation: 200 products per category. Operator can tune via SiteConfig later if needed; not exposed via CLI flag in v1.
- **C8 — Gender derivation correctness**: The L1 code → gender mapping (codes 268, 269, 270, 271, 305 → women; codes 272, 273, 274, 275, 306 → men) is hardcoded based on research.md §1.6. If 29CM later renames a code's L1 name (e.g., introduces a "unisex" L1), the engine's gender derivation may need a more robust source (parse `frontCategoryInfo[].categoryLargeName` from the XHR response and check for "여성"/"남성" prefix). Run-phase ANALYZE may upgrade this to the data-driven approach if simpler.

## 9. Methodology Note (DDD)

Project's `.moai/config/sections/quality.yaml` has `development_mode: ddd` (auto-config rule for projects with limited test coverage; this project has SPEC-001/002/003 fixture coverage but no Playwright lifecycle coverage). The Run phase will follow ANALYZE-PRESERVE-IMPROVE:

- **ANALYZE**:
  1. **Cloudflare bypass + XHR-interception verification** (REQ-007): launch Playwright in a scratch script, navigate 5 sequential times to `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100` with `page.on("response")` capturing all responses. Verify: HTML > 5KB, ≥1 application/json XHR captured per visit, ≥10 product card hrefs in DOM. ≥4 of 5 attempts must satisfy. If <80%, escalate to `channel: "chrome"` (1-LOC change), retry. If still <80%, escalate per rollback path. If pass, proceed.
  2. **ToS verification** (REQ-008): in the same Playwright session, navigate to `https://www.29cm.co.kr/home/agreement`, wait for the Angular CSR shell to hydrate, capture full Korean ToS body text via `page.evaluate(() => document.body.innerText)`, scan for keywords (자동화, 크롤, 스크래, 봇, 로봇, 데이터 수집, 추출, agent, robot, scrape, crawl, automated, automation, AI 학습, 머신러닝). Identify relevant clauses. Classify verdict (PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS). Embed verbatim Korean text + verdict + capture metadata as comment block at top of `src/lib/29cm-engine.ts`. If FORBIDS, abort and set `disabled: true`.
  3. **XHR endpoint identification**: install `page.on("request")` listener, navigate to category page, list all XHRs fired by the SPA. Identify the product-list one (heuristic: largest application/json response body containing `itemNo` or `frontBrand` keys). Document the URL pattern. Note auth headers required (cookies, JWT in `Authorization` header, etc.).
  4. **DOM inspection**: in the same Playwright session, inspect a live category page DOM. Verify the candidate selectors (`[href^="/product/catalog/"]`, child elements for name/price/image). Note image-host actual values. Document the selector fallback chain.
  5. **`apiCategoryCodes` verification**: navigate to each of the 10 hardcoded codes' category page and confirm products load. Update the SiteConfig if any code returns empty / 404.

- **PRESERVE**:
  1. Capture one live 29CM category page's intercepted XHR JSON into `tests/fixtures/29cm-products.fixture.json` (e.g., from categoryLargeCode=268100100 / 여성의류) as the regression baseline. Use a debug `console.log` line in the engine's `page.on("response")` listener to print the JSON, copy from stdout to fixture file.
  2. Capture a Cloudflare-challenge HTML body (if any was observed during ANALYZE) into a small string constant in `tests/29cm-engine.test.ts` for the `is29cmCloudflareChallenge` detector test.
  3. Capture a small synthetic HTML body (3-5 mock product cards) for the `parseProductsFromDom` fallback test.
  4. Run characterization tests against the fixtures; confirm `parseProductsFromXhr` and `parseProductsFromDom` produce the expected `Product[]` shape. The fixtures are FROZEN at this point — any future engine change must either preserve the fixtures' parse output or refresh and document why.

- **IMPROVE**:
  1. Implement `src/lib/29cm-engine.ts` with verified XHR endpoint pattern, image-host whitelist, infinite-scroll loop, abort-on-3-errors, Cloudflare-challenge detector, gender-derivation. The verbatim Korean ToS clause from REQ-008 is in the top-of-file comment block.
  2. Implement `src/lib/types.ts` PlatformType extension and `apiCategoryCodes` field.
  3. Implement `src/configs/platforms.ts` `29cm-kr` SiteConfig entry with verified `apiCategoryCodes`.
  4. Implement `src/crawl.ts` dispatch + probe wiring.
  5. Implement `tests/29cm-engine.test.ts` characterization suite. All tests green.
  6. Run `pnpm typecheck` — zero errors.
  7. Run `pnpm test` — zero failures.
  8. Run `pnpm crawl --probe=29cm-kr` against the live API; sample product summary prints; Cloudflare-challenge intercept asserted to be NOT triggered.
  9. Run `pnpm crawl --site=29cm-kr`; check `data/29cm-products.json` has ≥100 products with non-null required fields.
  10. Run `pnpm import:products`; spot-check 5 Supabase rows.

This is a **brownfield enhancement** (the project has Cafe24, Shopify, Uniqlo, ZARA engines — 29CM reuses patterns from each, especially ZARA) plus **greenfield engine addition** (no prior 29CM code). DDD is the appropriate methodology because: (a) the fixtures are the binding regression artifacts; (b) the engine's parse paths must demonstrate they produce the expected `Product[]` shape against frozen real-API/real-DOM captures before live runs are trusted; (c) project-level test coverage is low so TDD-style "test before code" doesn't apply naturally to the Playwright lifecycle.

## 10. References

- Research artifact: `.moai/specs/SPEC-PLATFORM-EXPANSION-004/research.md` (full probe results in §1-§3, engine recommendation in §4, risk register in §5, sources in §6)
- Sibling SPECs: `.moai/specs/SPEC-PLATFORM-EXPANSION-001/{spec,plan,research,acceptance}.md` (Uniqlo KR baseline, robots-check pattern, abort-on-3-errors mechanic, fixture pattern, `--rate=N` flag)
- Sibling SPECs: `.moai/specs/SPEC-PLATFORM-EXPANSION-002/{spec,plan,research,acceptance}.md` (region-parameterization pattern — informs that `region` is engine-internal, NOT cross-engine; FX module lift to `src/lib/fx.ts` — out of scope for SPEC-004 since 29CM is KRW-native)
- Sibling SPECs: `.moai/specs/SPEC-PLATFORM-EXPANSION-003/{spec,plan,research,acceptance}.md` (Playwright + XHR interception engine pattern, ToS clause embedding contract, abort-on-3 broadened to Playwright failure modes, fixture-based DOM/XHR characterization tests)
- Project product context: `.moai/project/product.md` (32-platform original target → 35 post-SPEC-003 → 36 post-SPEC-004)
- Project structure context: `.moai/project/structure.md` ("Adding a New Platform" checklist amended by SPEC-001 to include robots-check; SPEC-003 added ZARA Playwright pattern note; SPEC-004 adds 29CM Cloudflare-passive sub-pattern note)
- Project tech context: `.moai/project/tech.md` (Playwright `^1.58.2` already in deps, `node:test` runner already configured)
- Existing engine references:
  - `src/lib/zara-engine.ts` — Playwright + XHR-interception template (entire pattern reused; 3 deltas documented in §5)
  - `src/lib/uniqlo-engine.ts` — UA rotation list, image-host whitelist, abort-on-3-errors counter, pure parse function pattern
  - `src/lib/cafe24-engine.ts` — `var` constraint inside `page.evaluate` reference
  - `src/lib/robots-check.ts` — Reused unchanged (REQ-005)
- SiteConfig schema: `src/lib/types.ts:53` (PlatformType) and the SiteConfig interface (where `apiCategoryCodes?: number[]` slots in alongside `apiCategoryPaths`, `categoryUrls`, `region`)
- Dispatch surface: `src/crawl.ts` (ZARA `runCrawl` partition is the model for 29CM partition; ZARA `probeSite` branch is the model for 29CM probe branch)
- Test surface: `tests/zara-engine.test.ts` (test structure precedent: fixture loading, parameterized assertions, synthetic-HTML inputs); `tests/uniqlo-engine.test.ts` (test structure precedent for synthetic-JSON inputs and abort-on-3 mocks)

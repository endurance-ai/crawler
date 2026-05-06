---
id: SPEC-PLATFORM-EXPANSION-004
version: 0.1.0
status: draft
created_at: "2026-05-05"
updated_at: "2026-05-05"
author: hansangho
priority: high
issue_number: 0
labels: [crawler, platform, 29cm, playwright, infrastructure]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-05 | v0.1.0 | Initial draft. Adds 29CM (KR) as the 36th registered platform — second Playwright-based engine after ZARA, first Cloudflare-fronted (vs Akamai-fronted) Playwright engine. Five user-confirmed decisions baked in: (1) **scope** — 29CM KR Women + Men full fashion catalog (의류/가방/슈즈/액세서리/주얼리, 10 top-level codes); lifestyle/design/books/kitchen/beauty out of scope; (2) **engine path** — Path (c) Pure Playwright + XHR interception, selected after research.md §2 conclusively ruled out Path (a) mobile-API discovery (search-api requires non-empty keyword and returns ~48-item caps; item-api/display-bff-api are auth-gated returning HTTP 500/404 from external clients) and Path (b) Next.js RSC reverse-engineering (App Router pages ship navigation-only data; Pages Router /store/category/list ships `__NEXT_DATA__` with sub-category nav only — products are loaded via React Query client-side); (3) **soak gate removed** — SPEC-001 §2.4 amendment dated 2026-05-05 removes the 7-day Uniqlo KR soak entry condition; SPEC-004 proceeds immediately; (4) **scope ceiling** — engine + 29CM robots.txt verification + ToS verification only; size-system normalization, multi-region orchestration (29CM is KR-only), Musinsa graduation (29CM is owned by Musinsa but Musinsa.com remains deferred per its own `Disallow: /` robots.txt), IP rotation, schema migration, Xvfb-in-CI, and any fingerprint-evasion library are explicitly out of scope; (5) **Cloudflare browser config** — vanilla `chromium.launch({headless: "new"})` is the default (research.md §3.1 confirmed Cloudflare on 29CM is passive — 5/5 sequential plain-fetch HTTP 200 with full content); `channel: "chrome"` is the documented escalation path if vanilla proves insufficient at Run-phase verification (REQ-007). |

---

## Overview

This SPEC adds 29CM (KR storefront, `29cm.co.kr`) as the 36th registered platform in the crawler. 29CM is a Korean fashion select-shop (acquired by Musinsa in 2021). The engine class is the second Playwright-based engine after ZARA — structurally identical to `src/lib/zara-engine.ts` (Playwright Chromium + XHR interception + DOM-fallback) but with two divergences: (1) Cloudflare-passive bot wall instead of Akamai-active bm-verify (allowing vanilla `headless: "new"` instead of `channel: "chrome"`), (2) numeric category codes (`apiCategoryCodes: number[]`) instead of URL-slug strings (`categoryUrls: string[]`).

Path-selection rationale is documented in research.md §4 with a full path-comparison matrix (§4.1). To summarize: Path (a) mobile-API discovery was ruled out because every external API call to display-bff-api or item-api returns either 404 or auth-gated 500 (research.md §2.4-2.6), and the public search-api requires a non-empty keyword so cannot drive full-catalog browsing (research.md §2.2). Path (b) Next.js RSC reverse-engineering was ruled out because the App Router pages ship navigation-only data (no products in RSC streams) and the Pages Router /store/category/list page ships an `__NEXT_DATA__` block with only the sub-category navigation tree — products are loaded client-side via React Query (research.md §2.7). Only Path (c) remains — a real browser visits the category landing page, the SPA's React Query layer fires the actual product-list XHR (with the right cookies and headers naturally injected), and `page.on("response")` intercepts the response JSON.

This SPEC executes immediately, in parallel with any ongoing SPEC-001/002/003 production work, per the SPEC-001 §2.4 soak-gate removal amendment. SPEC-004 introduces no new test framework (`node:test` reused), no new lint tool (`tsc --noEmit` reused), no new Supabase schema (`Product` interface field-mapping covers 29CM shape), and no new dependency (Playwright already at `^1.58.2` in `package.json`). Approximately 90% of the new code is the Playwright engine (`src/lib/29cm-engine.ts`); the remaining 10% is dispatch wiring in `src/crawl.ts` and the SiteConfig entry in `src/configs/platforms.ts`.

### Engine-Path Justification

The user's spawn prompt explicitly delegated the engine-path decision to research-driven recommendation, with three candidates: (a) mobile API discovery first (29CM iOS/Android app surely calls some endpoint), (b) Next.js RSC payload reverse-engineering (29CM is built on Next.js App Router; RSC payloads ship structured data), (c) pure Playwright (DOM scrape + XHR interception, mirroring the SPEC-003 ZARA pattern).

The probe evidence in research.md §2 conclusively eliminates (a) and (b). For (a), `search-api.29cm.co.kr/api/v4/products` is **public and returns rich JSON** — but only with a non-empty keyword (the engine cannot list `categoryLargeCode=N` without a keyword). The internal `item-api` and `display-bff-api` paths are auth-gated. For (b), the modern Next.js stack on www.29cm.co.kr ships navigation-only data in RSC payloads and `__NEXT_DATA__` blobs — the actual product list is fetched client-side by React Query after hydration. For (c), the §3.1 sequential probe confirms Cloudflare on 29CM is passive (5/5 plain-fetch HTTP 200, no JS challenge, no escalation), so vanilla Playwright reaches the page without any bypass mechanic.

Path (c) is recommended with the explicit caveat that **the first Run-phase ANALYZE-step task is a Cloudflare-pass verification probe** (acceptance.md AC-9): if vanilla `headless: "new"` mode cannot reliably reach a real product list HTML at `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100` AND intercept at least one JSON XHR within 5 attempts, the engine escalates to `channel: "chrome"` (single launch-options change). If `channel: "chrome"` also fails, escalate to one of the rollback paths in research.md §4.4 (Xvfb separate SPEC, or defer entirely). This ANALYZE-first verification is HARD-required by REQ-007 below.

### Residual ToS Risk (UNVERIFIED at plan phase)

29CM KR's Terms of Service was probed at plan phase but could not be verified via curl. The page at `https://www.29cm.co.kr/home/agreement` returns a 5-KB Angular CSR shell that hydrates the actual ToS text from a backend after JS execution; static-asset CDN probes (asset.29cm.co.kr, attempted PDF paths) returned HTTP 403 or DNS unresolvable; `apihub.29cm.co.kr/notice/?notice_type=AGREEMENT` returned an empty result set.

**This is the same situation SPEC-003 (ZARA) faced at v0.1.0** before the project owner located the canonical PDF on `static.zara.net/static/pdfs/KR/`. SPEC-004 cannot benefit from the same shortcut because no canonical 29CM ToS PDF was located. Therefore:

- ToS verification is **DEFERRED to Run-phase Playwright session** (REQ-008 below).
- The Run-phase ANALYZE step MUST open `/home/agreement` in a real Playwright browser, scroll/extract the rendered Korean ToS text (full body), scan for keywords (자동화, 크롤, 스크래, 봇, 로봇, 데이터 수집, 추출, agent, robot, scrape, crawl, automated, automation, AI 학습, 머신러닝), and embed verbatim relevant clauses as a top-of-file comment block in `src/lib/29cm-engine.ts` for permanent audit record.
- If a clause unambiguously forbids automated catalog access (e.g., a clause naming "크롤" or "자동화된 데이터 수집" or "스크래핑"), the engine is shelved — `disabled: true` on the SiteConfig — and the operator escalates to project owner per HARD rule #1.
- If clauses are ambiguous (analogous to ZARA §15 IP rights) the operator records the verdict (AMBIGUOUS-ACCEPTED-BY-OWNER or AMBIGUOUS-REJECTED) and proceeds accordingly.
- portal.ai-internal-use only is the assumed scope. Public re-distribution of 29CM product data is NOT covered and would require separate legal review.
- If 29CM (or its parent Musinsa) issues a cease-and-desist communication, the operator MUST set `disabled: true` immediately, halt production crawls, and re-evaluate per project HARD rule #1.

The Run-phase agent has explicit authority to make the AMBIGUOUS-ACCEPTED-BY-OWNER call IF the captured ToS text contains no unambiguous prohibition AND the residual risk is comparable to ZARA's §15 IP rights clause. Otherwise the agent MUST report findings and request explicit project-owner review before unblocking the engine.

---

## Goals

- Ship a working 29CM (KR) Playwright-based crawler that produces a `data/29cm-products.json` cache file consumable by the existing `import-products.ts` Supabase upsert path with no schema changes (KRW-native, all fields fit existing `Product` interface).
- Introduce `"29cm"` as the 5th `PlatformType` in `src/lib/types.ts` (alongside `"cafe24" | "shopify" | "uniqlo" | "zara"`), without disturbing the four existing engines.
- Reuse SPEC-001's `robots-check.ts` blanket-disallow detector unchanged; reuse the abort-on-3-consecutive-errors pattern; reuse the 5-element User-Agent rotation list; reuse the `--rate=N` CLI override; reuse the `node:test` characterization-test fixture pattern.
- Reuse SPEC-003's Playwright + XHR interception architecture wholesale: browser/context/page lifecycle owned internally by the engine, AJAX response interception, ToS clause embedded as top-of-file comment block, image-host whitelist, abort-on-3-errors broadened to include Cloudflare-challenge signature.
- Establish a clean precedent for future Cloudflare-fronted (vs Akamai-fronted) Playwright engines — the `apiCategoryCodes: number[]` field and the vanilla `headless: "new"` default form a structurally distinct sub-pattern from SPEC-003's ZARA engine, while sharing the parse function + lifecycle wrapper structure.
- Make ToS verification a HARD precondition for the engine graduating from `status: draft` to live production: SPEC-004 cannot ship until the 29CM KR ToS clause has been read in a real browser and confirmed to permit automated access (or to be ambiguous in a way the project owner accepts).

## Non-Goals / Exclusions

The following are explicitly out of scope for this SPEC. Items in this section MUST NOT be treated as "nice-to-have" or partially implemented; they are deferred to follow-up SPECs (with documented entry conditions) or indefinitely.

- **29CM regions other than KR**: 29CM is a Korean-only e-commerce platform (no other regional storefronts exist as of 2026-05-05). The `region`-parameterization pattern from SPEC-002 (Uniqlo KR + US sharing one engine) does NOT apply here.
- **29CM lifestyle/design/books/kitchen/beauty/electronics categories**: the top-level codes 265100100 (컬처), 266100100 (뷰티), 291100100 (가구/인테리어), 292100100 (주방/생활), 293100100 (가전), 294100100 (컴퓨터/디지털) are NOT in the SPEC-004 scope. Only the 10 fashion codes (Women + Men 의류/가방/슈즈/액세서리/주얼리) are crawled. A future SPEC may add lifestyle/design coverage if portal.ai's product scope expands.
- **Musinsa graduation**: 29CM is owned by Musinsa (acquired 2021), but Musinsa.com remains deferred per project HARD rule #1 (verbatim `Disallow: /` for `User-agent: *`, see SPEC-001 §Non-Goals). SPEC-004 is **NOT** a precedent for Musinsa graduation. 29CM's permissive robots.txt does NOT carry over to Musinsa.com.
- **Mobile-app reverse-engineering**: forbidden by project HARD rules (SPEC-003 §2.5 precedent). Not pursued.
- **Fingerprint-evasion libraries**: `puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` with custom JA3, etc. are forbidden by project HARD rules. The engine MUST work with vanilla Playwright + realistic UA + locale + viewport, OR with `channel: "chrome"` if escalation is required, OR not at all.
- **Xvfb-in-CI for `headless: false` mode**: if vanilla `headless: "new"` AND `channel: "chrome"` both prove insufficient against Cloudflare, introducing Xvfb is a separate SPEC. SPEC-004's rollback path on insufficiency is deferral, not workaround.
- **IP rotation, residential proxy networks, CAPTCHA solving services, authenticated scraping**: inherited HARD prohibitions from SPEC-001 §2.3 and SPEC-003 §2.3.
- **Schema migration**: no portal.ai Supabase schema change. 29CM fields (name, price, image URL, product URL, color, gender) all map onto existing `Product` columns.
- **Live FX rate API**: 29CM KR sells natively in KRW. No FX conversion at engine OR import time. The `src/lib/fx.ts` table is untouched.
- **Linter / formatter introduction**: inherited from SPEC-001/002/003. `tsc --noEmit` remains the only static check.
- **Vitest framework introduction**: inherited from SPEC-001/002/003. `node:test` is the runner.
- **Other deferred platforms** (H&M, COS, Weekday, Monki, Arket, Inditex sub-brands): unchanged from SPEC-001/002/003.

## Architecture Impact

### New file `src/lib/29cm-engine.ts` (~300 LOC)

The engine is a new top-level module modeled structurally on `src/lib/zara-engine.ts`. The structural pattern is borrowed (Playwright Chromium launch, context, page navigation, XHR response interception via `page.on("response")`, abort-on-error wrapping, `parseProductsFromXhr` pure parse function exported for unit testing); the implementation is independent.

Public surface:

- `crawl29cm(config: SiteConfig): Promise<CrawlResult>` — engine entry. Launches Playwright Chromium internally with vanilla `headless: "new"` (NOT `channel: "chrome"` by default — see REQ-007), manages browser/context/page lifecycle, returns `CrawlResult`. Browser is created and closed within the function (mirroring ZARA's pattern).
- `parseProductsFromXhr(xhrJson: unknown, baseUrl: string, platformKey: string, gender: "women" | "men"): Product[]` — pure parse function consuming an intercepted XHR JSON payload. Exported for unit testing against the captured fixture.
- `parseProductsFromDom(html: string, baseUrl: string, platformKey: string, gender: "women" | "men"): Product[]` — fallback pure parse function consuming DOM-extracted HTML. Used when XHR interception fails or shape is unstable. Same signature as ZARA's, with a `gender` parameter derived from the category code's L1 name.
- `is29cmCloudflareChallenge(htmlOrResponse: string | Response): boolean` — Cloudflare-challenge signature detector. Returns `true` if the response is a Cloudflare interstitial (HTML body < 5KB containing `cf-mitigated`, `Just a moment`, or `cf-challenge-platform`); returns `false` for normal product DOM.
- `TWENTYNINECM_USER_AGENTS: readonly string[]` — same 5-element rotation list reused from `uniqlo-engine.ts` and `zara-engine.ts` (initially copied verbatim into `29cm-engine.ts`; if a future SPEC needs to share the list across engines, a future refactor lifts it to `src/lib/user-agents.ts`).

Internal Playwright lifecycle:
1. `chromium.launch({ headless: "new" })` — vanilla, no stealth plugins, no `channel: "chrome"` (the latter is documented as Run-phase escalation per REQ-007).
2. Browser context with realistic options: `userAgent` (one from rotation list per crawl run), `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport: {width: 1440, height: 900}`.
3. `page.on("response")` listener installed at context start. The listener inspects each response: if URL contains a likely product-list endpoint (heuristic: contains `display-bff-api` OR `item-api` OR `front-api` AND `application/json` content-type AND body parses as `{result, data: [...]}` or `{products: [...]}` or `[...]`), the listener captures the JSON payload and stores it in a per-category buffer.
4. For each `categoryLargeCode` in `config.apiCategoryCodes`:
   a. Construct URL: `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED`.
   b. `page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000})`.
   c. Wait for either: (1) at least one product-list XHR captured, OR (2) the product-card selector `[href^="/product/catalog/"]` to appear with ≥10 matches. Whichever comes first.
   d. Infinite-scroll loop: `page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` in a loop. After each scroll, wait 1 sec for the page's React Query infinite-list to fetch the next batch. Continue until either (1) the product count plateaus (no new products after 2 consecutive scrolls), OR (2) a per-category cap is reached (default: 200 products per category, operator-tunable later).
   e. Extract products: prefer the captured XHR JSON via `parseProductsFromXhr`; fall back to `parseProductsFromDom` if no XHR captured (e.g., the SPA's product fetch was cached or rerouted).
   f. Determine gender from the category code's L1 name (codes 268-271, 305 → "women"; codes 272-275, 306 → "men").
   g. Apply the 29CM image-host whitelist (`img.29cm.co.kr`, `asset.29cm.co.kr` — verified during ANALYZE).
   h. Pace: `await page.waitForTimeout(crawlDelay)` between category iterations. `crawlDelay: 2000` ms baseline.
   i. Abort-on-3-consecutive-errors per category (mirrors ZARA engine).
5. Browser closed in `finally` block.

The `parseProductsFromXhr` AND `parseProductsFromDom` pure functions are the testable surfaces. The Playwright lifecycle itself is NOT unit-tested — only smoke-tested via live `--probe` invocation. This mirrors the ZARA engine's testing posture.

The top-of-file comment block holds the verbatim Korean ToS clause from REQ-008, with capture date and operator name.

### New SiteConfig field `apiCategoryCodes?: number[]`

A new optional `SiteConfig` field is needed: a list of numeric L1 category codes consumed by the engine to construct category-landing-page URLs at runtime. Distinct from Uniqlo's `apiCategoryPaths: string[]` (4-position comma-tuples consumed by an API query parameter) and distinct from ZARA's `categoryUrls: string[]` (full URL paths). 29CM's category access requires the engine to construct `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED` for each numeric code.

The field is added to the `SiteConfig` interface alongside the existing `apiCategoryPaths`, `categoryUrls`, and `region` fields. Only consumed when `type === "29cm"`. The JSDoc explicitly notes the engine binding to avoid future engine-cross-contamination.

Rationale for new field (vs reusing `categoryUrls`):
- `categoryUrls: string[]` would force the SiteConfig to enumerate 10 full URLs containing redundant prefix and sort-param boilerplate.
- `apiCategoryCodes: number[]` is a clean, type-safe representation of the 29CM-specific contract: "engine converts numeric codes to URLs at runtime."
- The engine pattern is structurally analogous to Uniqlo's `apiCategoryPaths` (engine constructs URLs from list at runtime), but the type differs because 29CM uses numeric codes.

### `src/lib/types.ts` — `PlatformType` extension

`PlatformType` extends from `"cafe24" | "shopify" | "uniqlo" | "zara"` (the SPEC-003 baseline) to `"cafe24" | "shopify" | "uniqlo" | "zara" | "29cm"`. A 1-LOC change. The `Product` interface and `CrawlResult` interface are unchanged.

Note on the literal `"29cm"`: TypeScript permits string literal types starting with digits in union types. The engine internally references `PlatformType` as a tagged union, never as an identifier — no escaping is needed.

### `src/configs/platforms.ts` — new `29cm-kr` SiteConfig entry

A single new entry appended to the `PLATFORMS` array:
- `key: "29cm-kr"`, `name: "29CM (KR)"`, `type: "29cm"`, `baseUrl: "https://www.29cm.co.kr"`
- `sourceCurrency: "KRW"` (29CM is KRW-native; no FX conversion at engine OR import time)
- `crawlDelay: 2000` (browser overhead + Cloudflare-friendly pacing baseline; tunable via `--rate=N` CLI override at the operator's discretion within the rate-cap policy)
- `apiCategoryCodes: number[]` — hardcoded list of 10 Women + Men L1 category codes from research.md §1.6: `[268100100, 269100100, 270100100, 271100100, 305100100, 272100100, 273100100, 274100100, 275100100, 306100100]`.
- `notes: "29CM KR Playwright + XHR-interception engine. Cloudflare passive (no JS challenge); vanilla headless:'new' is sufficient. KRW-native, 2 sec/category, 5-UA rotation list (one UA per crawl run). robots-check enforced. ToS verification is a HARD precondition (REQ-008)."`

### `src/crawl.ts` — dispatch + probe wiring

`runCrawl()` partition: a new `twentyninecmSites = configs.filter((c) => c.type === "29cm")` partition, executed sequentially (NOT `Promise.all` — each 29CM crawl launches its own Chromium browser; running them in parallel would multiply browser memory cost without throughput benefit, mirrors ZARA's batch-of-1 pattern). Robots-check pre-flight identical to Uniqlo's and ZARA's branches.

`probeSite()`: a new `if (config.type === "29cm")` branch testing one category URL with a quick Playwright launch + `page.goto` + selector-presence check. Prints sample of first product card extracted (name, price, productUrl, image), asserts the Cloudflare challenge has NOT been triggered (page HTML > 5 KB and does not match the challenge signature). Browser closed in `finally`.

### Test surface

- `tests/fixtures/29cm-products.fixture.json` — frozen JSON snapshot of the intercepted XHR response from one real 29CM category landing page during the Run-phase PRESERVE step (analogous to ZARA's KR fixture). Captured ONCE via Playwright by the operator (e.g., `page.on("response")` listener prints the JSON to stdout, operator copies to fixture file), frozen, committed.
- `tests/29cm-engine.test.ts` — `node:test` suite (no new framework). Loads the fixture, runs `parseProductsFromXhr` against the JSON, asserts every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, `price`. Image-host whitelist test mirrors `isSafeUniqloImageUrl` and `isSafeZaraImageUrl`. **Does NOT test the Playwright lifecycle** (browser launch, navigation, scroll, XHR interception) — that surface is smoke-tested only via live `--probe` invocation. Includes a separate test for `parseProductsFromDom` (DOM-fallback) against a small synthetic HTML body, and a test for `is29cmCloudflareChallenge` against a synthetic challenge HTML.

### `src/import-products.ts` — no change

29CM KR is KRW-native (`sourceCurrency: "KRW"`), so the SPEC-002 `convertToKrw` import-time hook does NOT fire. 29CM fields map onto existing `products` table columns. No change required.

---

## Requirements

The following requirements use EARS (Easy Approach to Requirements Syntax) format. SPEC-004 inherits and reuses requirements from SPEC-001 (rate-limit pacing, dry-run flow, robots-check pre-flight, abort-on-3-consecutive-errors, characterization-test fixture pattern, `--rate=N` operator override) and SPEC-003 (ToS verification HARD precondition, Playwright lifecycle pattern) — those are not re-stated. The requirements below are SPEC-004-specific deltas.

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register 29CM KR as a platform with `key: "29cm-kr"`, `name: "29CM (KR)"`, `type: "29cm"`, `baseUrl: "https://www.29cm.co.kr"`, `sourceCurrency: "KRW"`, `crawlDelay: 2000`, and a non-empty hardcoded `apiCategoryCodes: number[]` field listing the 10 Women + Men L1 category codes (`[268100100, 269100100, 270100100, 271100100, 305100100, 272100100, 273100100, 274100100, 275100100, 306100100]`). The SiteConfig entry **SHALL NOT** include `apiCategoryPaths` (reserved for `type === "uniqlo"`), `categoryUrls` (reserved for `type === "zara"`), or `region` (reserved for the Uniqlo region-parameterized engine). `PlatformType` in `src/lib/types.ts` **SHALL** be extended to include `"29cm"`.

Source: research.md §1.6 (category code list), §4.2 (engine recommendation); architecture impact subsection above.

### REQ-002 [Ubiquitous]

**THE 29CM engine SHALL** be implemented in a new file `src/lib/29cm-engine.ts` exposing a single async entry function `crawl29cm(config: SiteConfig): Promise<CrawlResult>`. The engine **SHALL** launch a Playwright Chromium browser internally with `headless: "new"` (vanilla; NOT `channel: "chrome"` by default), configure the context with realistic options (`userAgent` from a 5-element rotation list, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport: {width: 1440, height: 900}`), and **SHALL** close the browser in a `finally` block. The engine **SHALL NOT** import any fingerprint-evasion library (`puppeteer-extra-plugin-stealth`, `playwright-stealth`, etc.). The engine **SHALL NOT** introduce any new `dependencies` or `devDependencies` to `package.json` — Playwright is already at `^1.58.2`.

Source: research.md §3 (Cloudflare passive posture), §4.2 (engine recommendation); architecture impact subsection above.

### REQ-003 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=29cm-kr` without the `--dry-run` flag, **THE crawler SHALL** invoke `crawl29cm`, which **SHALL** iterate over each category code in `config.apiCategoryCodes`, performing for each code: (1) construct URL `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED`, (2) `page.goto(url)` with `waitUntil: "domcontentloaded"`, (3) wait for either the first product-list XHR to be intercepted via `page.on("response")` OR the DOM selector `[href^="/product/catalog/"]` to appear with ≥10 matches, (4) execute an infinite-scroll loop until product count plateaus or a per-category cap (default 200) is reached, (5) extract products preferentially from the intercepted XHR JSON via `parseProductsFromXhr`; fall back to `parseProductsFromDom` if no XHR was captured for that category, (6) determine the `gender` field from the category code's L1 name mapping (codes 268-271 and 305 → `"women"`; codes 272-275 and 306 → `"men"`), (7) apply the 29CM image-host whitelist (`img.29cm.co.kr`, `asset.29cm.co.kr` — verified during ANALYZE). The aggregated `Product[]` result **SHALL** be written to `data/29cm-products.json`. Each category iteration **SHALL** be paced with `await page.waitForTimeout(crawlDelay)` after extraction; default `crawlDelay: 2000`.

Source: research.md §1.5 (infinite scroll pagination), §1.6 (category codes), §4.2; architecture impact subsection above.

### REQ-004 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=29cm-kr --dry-run` (or `--probe=29cm-kr`), **THE crawler SHALL** invoke the probe handler for the `"29cm"` engine type, launching Playwright Chromium with the same realistic context options, navigating to the URL constructed from the FIRST entry in `config.apiCategoryCodes` (default: `categoryLargeCode=268100100`), asserting the page HTML reaches real product DOM (HTML body length > 5,000 bytes AND no Cloudflare challenge signature detected), printing a sample product summary to stdout (key fields: `name`, `price`, `productUrl`, `imageUrl` — extracted from the FIRST intercepted XHR response if available, else from DOM), and **SHALL NOT** write `data/29cm-products.json`. The dry-run **SHALL NOT** modify any file in the `data/` directory. Browser **SHALL** be closed in a `finally` block.

Source: research.md §4 (engine path), §3.1 (Cloudflare passive); SPEC-001 REQ-003 dry-run pattern; SPEC-003 REQ-004 Playwright probe pattern.

### REQ-005 [State-driven]

**WHILE** a 29CM crawl is starting (whether `--dry-run` or full crawl), **THE crawler SHALL** invoke `checkRobots(config.baseUrl)` from `src/lib/robots-check.ts` (introduced by SPEC-001 REQ-004) and **SHALL** refuse to proceed if the returned result is `{allowed: false}`. The check **SHALL** run before any Playwright browser is launched. Behavior, error message format, and exit code are identical to SPEC-001 REQ-004 — this REQ exists in SPEC-004 only to make 29CM's coverage by the existing engine-agnostic check explicit.

Source: research.md §1.1 (29CM `robots.txt` is permissive — passes blanket-disallow check); SPEC-001 REQ-004 reused.

### REQ-006 [Unwanted Behavior]

**IF** `crawl29cm` encounters 3 consecutive errors within a single category iteration — where "error" is defined as: (a) `page.goto` timeout, (b) selector-not-found timeout AND no XHR captured within 15 seconds (both fallbacks failed), (c) the page response matching the Cloudflare challenge signature (`is29cmCloudflareChallenge` returns true), or (d) a thrown exception during `page.evaluate` extraction OR JSON parse of the intercepted XHR — **THEN THE engine SHALL** abort that category, append a structured error entry to `CrawlResult.errors` (containing category code, error type, timestamp, and a brief descriptor), and continue with the next code in `config.apiCategoryCodes`. "Consecutive" means without an intervening successful extraction (≥1 product card emitted) on the same category. The engine **SHALL NOT** retry indefinitely, **SHALL NOT** silently swallow errors, **SHALL NOT** rotate IP addresses, **SHALL NOT** invoke any fingerprint-evasion technique, and **SHALL NOT** introduce any retry-with-backoff delay beyond the configured `crawlDelay`. After all categories are processed, the partial result **SHALL** be written to `data/29cm-products.json` with the populated `errors` array so the operator can audit which categories failed.

Source: research.md §3.3 (HARD-rule constraints), §5 (Cloudflare escalation risk row); SPEC-001 REQ-005 abort-on-3 pattern adapted to Playwright + Cloudflare failure modes; SPEC-003 REQ-006 broadened.

### REQ-007 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (BEFORE any production engine code is written), **THE operator SHALL** verify that `chromium.launch({headless: "new"})` mode reliably reaches a real product list HTML against `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100` AND intercepts at least one JSON XHR within 15 seconds. Reliability is defined as: at least 4 of 5 sequential `page.goto` invocations from a single Playwright session reach a state where (1) the page HTML is > 5,000 bytes (NOT a Cloudflare challenge intercept), AND (2) at least one `application/json` response from `*.29cm.co.kr` is captured by `page.on("response")` within 15 seconds, AND (3) `document.querySelectorAll('[href^="/product/catalog/"]').length >= 10`. If reliability is below this threshold, **THE operator SHALL** invoke escalation path 1 in research.md §4.4 (upgrade to `channel: "chrome"`, single launch-options change). If `channel: "chrome"` is also below threshold, **THE operator SHALL** invoke escalation path 2 (introduce Xvfb-in-CI as a separate SPEC) or escalation path 3 (defer SPEC-004 entirely and notify the project owner). **THE operator SHALL NOT** introduce a fingerprint-evasion library or otherwise circumvent the project HARD rules to compensate for an insufficient browser-launch reliability rate.

Source: research.md §3 (Cloudflare passive but verification needed), §4.3-4.4 (rollback paths); architecture impact (the engine's viability hinges on this single verification — encoding it as a HARD precondition is the bias-prevention mechanism).

### REQ-008 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (AFTER REQ-007 passes, BEFORE any non-dry-run crawl), **THE operator SHALL** open `https://www.29cm.co.kr/home/agreement` in the same Playwright session, wait for the Angular CSR shell to hydrate the rendered Korean ToS text, capture the full body text, scan for keywords (자동화, 크롤, 스크래, 봇, 로봇, 데이터 수집, 추출, agent, robot, scrape, crawl, automated, automation, AI 학습, 머신러닝), and embed the verbatim relevant clauses (any clause referencing automation, scraping, content use, or IP rights) as a top-of-file comment block in `src/lib/29cm-engine.ts` for permanent audit record. The block **SHALL** include: (a) the verbatim Korean clause text, (b) the capture date and operator name, (c) a verdict label (one of: PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS), (d) the SPEC-004 cross-reference, (e) a one-line summary of the residual-risk conditions (portal.ai-internal-use only; halt-on-cease-and-desist). The original Korean text **MUST NOT** be paraphrased, translated-only, or summarized in this comment block — verbatim quoting is the audit-evidence contract.

If the captured text contains ANY clause that unambiguously forbids automated catalog access, web scraping, or the use of crawler/bot/automation tools (analogous to a verbatim `Disallow: /` in robots.txt — i.e., a clause that names the exact prohibited behavior), **THE operator SHALL**: (1) set `disabled: true` on the `29cm-kr` SiteConfig, (2) abandon the engine implementation, (3) escalate to project owner with the verbatim forbidding clause and a recommendation for a B2B partner-API conversation with 29CM (or its parent Musinsa). The operator **SHALL NOT** ship the engine with `disabled: false` if the verdict is FORBIDS.

If the captured text contains ambiguous clauses (e.g., IP rights clauses that technically restrict content use without naming automation specifically — analogous to ZARA's §15), **THE operator SHALL** classify the verdict as AMBIGUOUS-ACCEPTED-BY-OWNER and proceed, OR escalate to project owner if the residual risk is qualitatively higher than ZARA's §15 IP rights clause.

Source: research.md §1.2 (ToS unverified at plan phase); SPEC-003 §Residual ToS Risk (v0.1.0 pattern, before pre-amendment shortcut); project HARD rule #1.

### REQ-009 [Ubiquitous]

**THE 29CM engine characterization-test suite at `tests/29cm-engine.test.ts`** **SHALL** load the frozen fixture at `tests/fixtures/29cm-products.fixture.json` (a real intercepted XHR response captured during the Run-phase PRESERVE step from a real 29CM category landing page, ~50-100 products) and **SHALL** run `parseProductsFromXhr` against the JSON, asserting that every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, and `price` fields, that every `imageUrl` matches the 29CM image-host whitelist (initial hypothesis: `img.29cm.co.kr`, `asset.29cm.co.kr`; verified during ANALYZE), that every `productUrl` starts with `https://www.29cm.co.kr/product/catalog/`, that every `price` is a positive KRW integer (typically 1,000 ≤ price ≤ 5,000,000 — sanity range), and that `gender` is set correctly per the category code's L1 name mapping. The suite **SHALL** also include a separate test for `parseProductsFromDom` against a small synthetic HTML body containing 3-5 mock product cards, and a test for `is29cmCloudflareChallenge` against a synthetic Cloudflare challenge HTML. No new devDependency **SHALL** be added (`node:test` reused). The test suite **SHALL NOT** attempt to test the Playwright lifecycle (browser launch, navigation, scroll, XHR interception); that surface is smoke-tested only via live `--probe` invocation per REQ-004.

Source: SPEC-001 REQ-006 fixture pattern; SPEC-003 REQ-009 test surface architecture; architecture impact subsection above.

## Files Affected

| File | Action | Est. LOC | Purpose |
|---|---|---|---|
| `src/lib/29cm-engine.ts` | NEW | ~300 | Playwright + XHR-interception engine: browser/context/page lifecycle, `page.on("response")` listener, infinite-scroll loop, `parseProductsFromXhr` + `parseProductsFromDom` pure functions, image-host whitelist, abort-on-3-errors, Cloudflare-challenge detector, gender derivation from category code. Top-of-file comment block holds the verbatim ToS clause from REQ-008. |
| `src/lib/types.ts` | MODIFY | ~5 | Extend `PlatformType` (line 53, +1 LOC) to add `"29cm"`. Add optional `apiCategoryCodes?: number[]` to `SiteConfig` (current SiteConfig interface, +4 LOC) with JSDoc explicitly binding to `type === "29cm"` (do NOT cross-contaminate with Uniqlo's `apiCategoryPaths` or ZARA's `categoryUrls` or the `region` field). |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `29cm-kr` SiteConfig entry. Hardcoded `apiCategoryCodes: [268100100, 269100100, 270100100, 271100100, 305100100, 272100100, 273100100, 274100100, 275100100, 306100100]`. `crawlDelay: 2000`. `sourceCurrency: "KRW"`. `notes` documents the 29CM-specific behavior. |
| `src/crawl.ts` | MODIFY | ~50 | Add `twentyninecmSites = configs.filter((c) => c.type === "29cm")` partition with sequential dispatch loop (NOT `Promise.all` — each 29CM crawl launches a Chromium browser; mirrors ZARA pattern): ~30 LOC. Add `if (config.type === "29cm")` branch in `probeSite` with Cloudflare-challenge assertion: ~20 LOC. Imports `crawl29cm` from `./lib/29cm-engine`. |
| `tests/fixtures/29cm-products.fixture.json` | NEW | ~150 | Frozen XHR JSON response captured during Run-phase PRESERVE via `pnpm crawl --probe=29cm-kr` with a `console.log(json)` debug line on the first intercepted XHR (~50-100 products from one category page). Committed to repo. |
| `tests/29cm-engine.test.ts` | NEW | ~150 | `node:test` suite. AC-1 platform registry test. AC-2 `parseProductsFromXhr` against XHR fixture. AC-2b `parseProductsFromDom` against synthetic HTML. AC-3-detector `is29cmCloudflareChallenge` against synthetic challenge HTML. AC-5 robots-check delegation test. AC-6 abort-on-3-errors mock test. |
| `.moai/project/structure.md` | MODIFY | ~10 | Add `29cm-kr` row to platform table (now 36 entries: 22 Cafe24 + 10 Shopify + 2 Uniqlo + 1 ZARA + 1 29CM). Document the 29CM Playwright + XHR-interception sub-pattern (Cloudflare-passive variant) in the engine-layering subsection. |
| `package.json` | NO CHANGE | 0 | Playwright `^1.58.2` already in dependencies. node:test runner already configured. No new deps. |

Total estimated LOC delta: **~695**.

## Acceptance References

Detailed Given-When-Then acceptance scenarios are documented in `.moai/specs/SPEC-PLATFORM-EXPANSION-004/acceptance.md`. The acceptance suite contains 10 scenarios mapping to REQ-001 through REQ-009, with AC-9 (REQ-007 Cloudflare-bypass verification) and AC-10 (REQ-008 ToS verification) being the two HARD preconditions for engine graduation.

## Risks

Three risks are tracked here for visibility throughout the Run phase. Mitigations are described in research.md §5 and will be implemented as part of the engine code or operator process, not as separate SPECs.

- **Cloudflare tightens posture and active-blocks vanilla Playwright** — Likelihood: Low, Impact: High. Mitigation: REQ-007 verification gates engine implementation; if vanilla `headless: "new"` is below 80% reliability, escalate to `channel: "chrome"` (1-LOC change); if still below threshold, escalate to Xvfb separate SPEC or defer entirely. No fingerprint-evasion library as compensation. Accepted residual risk.
- **The internal XHR endpoint requires auth that vanilla Playwright doesn't acquire** — Likelihood: Low, Impact: High. Mitigation: a real Playwright session naturally inherits the SPA's cookies and any JWT injected by the SPA's `_app` middleware. If this fails, fallback path: programmatic scroll + DOM extraction via `parseProductsFromDom`. The engine has both paths and prefers XHR; DOM is the safety net.
- **ToS clause forbids automated access** — Likelihood: Unknown (could not verify via curl), Impact: Critical (de-facto deferral). Mitigation: REQ-008 makes ToS verification in a real browser a HARD precondition. The verbatim clause is committed alongside engine code as audit evidence. If the clause forbids, the engine is shelved and the SiteConfig entry is set to `disabled: true`. Accepted process-level mitigation.

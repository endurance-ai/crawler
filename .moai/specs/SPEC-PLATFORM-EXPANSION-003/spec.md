---
id: SPEC-PLATFORM-EXPANSION-003
version: 0.1.0
status: draft
created_at: "2026-05-05"
updated_at: "2026-05-05"
author: hansangho
priority: high
issue_number: 0
labels: [crawler, platform, zara, playwright, infrastructure]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-05 | v0.1.0 | Initial draft. Adds ZARA (KR) as the 35th registered platform — first Playwright-based engine after Cafe24, first non-fetch engine after Uniqlo. Four user-confirmed decisions baked in: (1) **scope** — ZARA KR only (`zara.com/kr/ko`), Women + Men full catalog; Kids/Baby and other regions out of scope; (2) **engine path** — Path (a) pure Playwright is selected after research.md §2 conclusively ruled out Path (b) hybrid mobile-API + Playwright (every itxrest endpoint returns "blocked, no service match" from the gateway) and Path (c) pure mobile-API (forbidden by HARD rule); (3) **soak gate removed** — SPEC-001 §2.4 amendment dated 2026-05-05 removes the 7-day Uniqlo KR soak entry condition; SPEC-003 proceeds immediately; (4) **scope ceiling** — engine + ZARA robots.txt verification + ToS verification only; size-system normalization, multi-region orchestration (other ZARA regions), Inditex sub-brands (Bershka/Pull&Bear/Massimo Dutti/Stradivarius/Oysho/Zara Home), IP rotation, schema migration, Xvfb-in-CI, and any fingerprint-evasion library are explicitly out of scope. |
| 2026-05-05 | v0.2.0 | **AMENDMENT — ToS pre-verified at plan phase.** Project owner (hansangho) retrieved the canonical ZARA KR ToS PDF (2025-11-25 version) from `static.zara.net/static/pdfs/KR/`, scanned all 11 pages for automation/scraping keywords, and accepted the residual risk after reviewing the §2.1 (general use limit), §6-bullet-2 (automated-purchasing prohibition — does not apply to read-only scraping), and §15 (IP rights — primary residual risk) clauses verbatim. Verdict: **AMBIGUOUS-ACCEPTED-BY-OWNER**. No explicit anti-scraping clause exists; §15 IP rights clause is the residual risk. REQ-008 / AC-10 graduate from "Run-phase HARD precondition" to "plan-phase pre-satisfied"; Run-phase task is reduced to embedding the verbatim Korean ToS clauses as a top-of-file comment block in `src/lib/zara-engine.ts` for permanent audit record. See research.md §1.2 (verified) for full clause text. |

---

## Overview

This SPEC adds ZARA (KR storefront, `zara.com/kr/ko`) as the 35th registered platform in the crawler. ZARA is the first platform to require a Playwright-based engine that is neither Cafe24 (which targets the Cafe24 storefront framework) nor Uniqlo (fetch-only against a JSON API). The engine class is Playwright + DOM scrape, structurally analogous to the existing Cafe24 engine (`src/lib/cafe24-engine.ts`, 591 LOC) but tailored to ZARA's React SPA: infinite-scroll pagination instead of `?page=N` numeric pagination, Akamai bm-verify JS challenge handled by real-browser execution, ZARA-specific DOM selectors instead of Cafe24-specific selectors, and KRW-native pricing requiring no FX conversion.

Path-selection rationale is documented in research.md §4 with a full path-comparison matrix (§4.1). To summarize: Path (b) hybrid mobile-API + Playwright fallback was ruled out because every itxrest endpoint probed (`/itxrest/2/catalog/...`, `/itxrest/3/...`, `/api/v1/products`) returns either a structured `{"message":"Your request is blocked, no service match for your request"}` server-side reject from the Inditex gateway or a 0-byte silent block (research.md §2.2-2.4). Path (c) pure mobile-API reverse-engineering was ruled out because it would require replaying iOS/Android app authentication tokens, which is forbidden by project HARD rules ("no fingerprint randomization", "no authenticated scraping" — research.md §2.5). Only Path (a) pure Playwright remains — a real browser executes the bm-verify JS challenge, populates `_abck` cookie legitimately, and reaches real product DOM at category landing pages such as `https://www.zara.com/kr/ko/woman-new-in-l1180.html`.

This SPEC executes immediately, in parallel with any ongoing SPEC-001/002 production work, per the SPEC-001 §2.4 soak-gate removal amendment. SPEC-003 introduces no new test framework (`node:test` reused), no new lint tool (`tsc --noEmit` reused), no new Supabase schema (`Product` interface field-mapping covers ZARA shape), and no new dependency (Playwright already at `^1.58.2` in `package.json`). Approximately 90% of the new code is the Playwright engine (`src/lib/zara-engine.ts`); the remaining 10% is dispatch wiring in `src/crawl.ts` and the SiteConfig entry in `src/configs/platforms.ts`.

### Engine-Path Justification

The user's spawn prompt explicitly delegated the engine-path decision to research-driven recommendation: "(a) Pure Playwright headless browser, (b) Hybrid mobile API discovery first with Playwright fallback, (c) Pure mobile API reverse-engineering. Investigate which is feasible. Document findings in research.md §2 with concrete URLs and HTTP probe results."

The probe evidence in research.md §2 conclusively eliminates (b) and (c). For (a), the probe evidence in research.md §3 confirms that the Akamai bm-verify intercept appears on every fetch from a non-browser client (deterministic, not rate-limit-based — see §3.1 sequential same-UA test and §3.2 UA-rotation test). Akamai's bypass mechanic for legitimate browsers is well-documented in the public reverse-engineering literature: real Chromium executes the JS challenge, populates the `_abck` cookie, and the intercept lifts. Vanilla Playwright `chromium.launch({headless: "new"})` mode passes the challenge ~85% of the time per public reports; vanilla `headless: false` passes reliably. Both are within project HARD rules (no stealth plugins, no IP rotation, no fingerprint randomization beyond UA + locale + viewport).

Path (a) is recommended with the explicit caveat that **the first Run-phase ANALYZE-step task is a Playwright-bypass verification probe** (acceptance.md AC-9): if `headless: "new"` mode cannot reliably reach a real product list HTML at `https://www.zara.com/kr/ko/woman-new-in-l1180.html` within 5 attempts, the engine is shelved before any code is written, and the operator escalates to one of two rollback paths in research.md §4.3 (`headless: false` + Xvfb requires a separate SPEC; deferral requires no SPEC). This ANALYZE-first verification is HARD-required by REQ-007 below.

### Residual ToS Risk (UPDATED 2026-05-05 v0.2.0 — pre-verified)

ZARA KR's Terms of Service was pre-verified at plan phase by retrieving the canonical PDF (2025-11-25 version) from Inditex's static asset CDN (`static.zara.net/static/pdfs/KR/terms-and-conditions/terms-and-conditions-ko_KR-20251125.pdf`, 228 KB, 11 pages) and scanning all pages for automation/scraping keywords (자동화, 크롤, 스크래, 봇, 로봇, agent, robot, scrape, crawl, automated, automation, etc.). Full keyword scan results and verbatim clause quotations are recorded in research.md §1.2 (verified). Three relevant clauses were identified and reviewed by the project owner:

1. **§2.1** (general use limit) — "이용자는 회사에 대한 정당한 요청이나 주문 목적으로만 웹사이트를 이용할 수 있습니다." Verdict: AMBIGUOUS, no automation-specific language.
2. **§6 bullet 2** (automated purchasing) — "자동구매 소프트웨어 기타 유사한 도구를 사용하여 다중 주문, 반복 구매, 사재기를 하는 행위." Verdict: DOES NOT APPLY — clause specifically targets automated purchasing, not data harvesting; kiko.ai's crawler does not place orders.
3. **§15** (IP rights) — "웹사이트 내의 모든 콘텐츠에 대한 저작권, 상표권 등 일체의 지적 재산권은 회사 또는 회사가 권한을 부여한 자에게 귀속됩니다. 이용자는 회사 또는 회사가 권한을 부여한 자의 허락을 받아 해당 콘텐츠를 사용할 수 있습니다." Verdict: PRIMARY RESIDUAL RISK — IP rights clause technically requires permission for any content use beyond personal order history.

**Verdict: AMBIGUOUS-ACCEPTED-BY-OWNER.** No explicit anti-scraping clause exists in the ZARA KR ToS. The §15 IP clause is the primary residual risk, accepted by project owner on 2026-05-05 with the following conditions:

1. Verbatim §2.1, §6-bullet-2, and §15 Korean text MUST be embedded as a top-of-file comment block in `src/lib/zara-engine.ts` for permanent audit record (this is REQ-008's Run-phase task — narrowed from "verify ToS in browser" to "embed pre-verified clauses").
2. Capture date and operator name (2026-05-05, hansangho) MUST be recorded.
3. `disabled: false` is permitted on the `zara-kr` SiteConfig entry — engine ships live.
4. kiko.ai-internal-use only is the assumed scope. Public re-distribution of ZARA product data is NOT covered by this acceptance and would require separate legal review.
5. If ZARA Inditex Korea (ITX Korea Limited) issues a cease-and-desist communication, the operator MUST set `disabled: true` immediately, halt production crawls, and re-evaluate per project HARD rule #1.

---

## Goals

- Ship a working ZARA (KR) Playwright-based crawler that produces a `data/zara-kr-products.json` cache file consumable by the existing `import-products.ts` Supabase upsert path with no schema changes (KRW-native, all fields fit existing `Product` interface).
- Introduce `"zara"` as the 4th `PlatformType` in `src/lib/types.ts` (alongside `"cafe24" | "shopify" | "uniqlo"`), without disturbing the three existing engines.
- Reuse SPEC-001's `robots-check.ts` blanket-disallow detector unchanged; reuse the abort-on-3-consecutive-errors pattern; reuse the 5-element User-Agent rotation list; reuse the `--rate=N` CLI override; reuse the `node:test` characterization-test fixture pattern.
- Establish the ZARA Playwright engine pattern (selector fallback chain, infinite-scroll pagination, AJAX-response interception fallback) in `src/lib/zara-engine.ts` so future Inditex-sibling SPECs (Bershka, Pull&Bear, etc., still deferred) inherit a structurally clean precedent.
- Make ToS verification a HARD precondition for the engine graduating from `status: draft` to live production: SPEC-003 cannot ship until the ZARA KR ToS clause has been read in a real browser and confirmed to permit automated access (or to be ambiguous in a way the project owner accepts).

## Non-Goals / Exclusions

The following are explicitly out of scope for this SPEC. Items in this section MUST NOT be treated as "nice-to-have" or partially implemented; they are deferred to follow-up SPECs (with documented entry conditions) or indefinitely.

- **ZARA regions other than KR**: Other ZARA storefronts (US, ES, EU, UK, JP, AU, etc.) are NOT in scope. The `region`-parameterized engine pattern from SPEC-002 (Uniqlo KR + US sharing one engine module) does NOT carry over to ZARA in this SPEC. ZARA per-region SPA structure may differ (different category slugs, different L-codes, different ToS), so each region requires its own SPEC, its own probe, and its own ToS verification. The engine architecture introduced here is structurally extensible to other ZARA regions, but each requires its own SPEC.
- **Inditex sub-brands**: Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home all share Inditex's Akamai Bot Manager parent infrastructure. They remain deferred-with-ZARA per SPEC-001 §2.3. SPEC-003 is a precedent for the engine pattern only — it does NOT auto-graduate sub-brands. Each sub-brand requires its own SPEC with its own probe + ToS verification, even if SPEC-003 succeeds.
- **ZARA Kids and Baby sections**: ZARA's `/kids-l*.html` URL hierarchy is NOT in scope. Only Women (`/woman-*-l*.html`) and Men (`/man-*-l*.html`) catalog branches are crawled.
- **Mobile-app reverse-engineering**: forbidden by project HARD rules (research.md §2.5). Not pursued.
- **Fingerprint-evasion libraries**: `puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` with custom JA3, etc., are forbidden by project HARD rules. The engine MUST work with vanilla Playwright + realistic UA + locale + viewport, OR not at all.
- **Xvfb-in-CI for `headless: false` mode**: if `headless: "new"` proves insufficient against Akamai, introducing Xvfb is a separate SPEC (operational dependency on the CI image), NOT part of SPEC-003. SPEC-003's rollback path on `headless: "new"` insufficiency is deferral, not workaround.
- **IP rotation, residential proxy networks, CAPTCHA solving services, authenticated scraping**: inherited HARD prohibitions from SPEC-001 §2.3. Forbidden.
- **Schema migration**: no kiko.ai Supabase schema change. ZARA fields (name, price, image URL, product URL, color names, sizes, gender) all map onto existing `Product` columns. No new column needed.
- **Live FX rate API**: ZARA KR sells natively in KRW. No FX conversion is invoked. The hardcoded `FX_TO_KRW` table in `src/lib/fx.ts` (lifted from `shopify-engine.ts` per SPEC-002 REQ-005) remains untouched.
- **Linter / formatter introduction**: inherited from SPEC-001/002. `tsc --noEmit` remains the only static check.
- **Vitest framework introduction**: inherited from SPEC-001/002. `node:test` is the runner.
- **Other deferred platforms** (29CM, Musinsa, H&M, COS, Weekday, Monki, Arket): unchanged from SPEC-001/002. Musinsa remains deferred per HARD rule #1 (`Disallow: /` for `User-agent: *`). H&M Group sub-brands remain deferred per AkamaiGHost active-blocker. 29CM remains 2순위 with no entry condition since the soak gate was removed.

## Architecture Impact

### New file `src/lib/zara-engine.ts` (~280 LOC)

The engine is a new top-level module. It does NOT extend `cafe24-engine.ts` because Cafe24's `DEFAULT_SELECTORS` chain and `cate_no=` numeric-pagination loop assume the Cafe24 storefront framework — neither applies to ZARA. The structural pattern is borrowed (Playwright Chromium launch, context, page navigation, selector fallback chain, abort-on-error), but the implementation is independent.

Public surface:
- `crawlZara(config: SiteConfig): Promise<CrawlResult>` — engine entry. Launches Playwright Chromium internally, manages browser/context/page lifecycle, returns `CrawlResult` like every other engine. Browser is created and closed within the function (NOT injected from outside, distinct from Cafe24's pattern of accepting a `Page` parameter — this isolates ZARA's launch-options requirements).
- `parseProductsFromDom(html: string, baseUrl: string, platformKey: string): Product[]` — pure parse function consuming a frozen DOM-snapshot HTML string. Exported for unit testing against the captured fixture.
- `ZARA_USER_AGENTS: readonly string[]` — same 5-element rotation list reused from `uniqlo-engine.ts` (extracted to a shared constant in `zara-engine.ts` initially; if a future SPEC needs to share the list across engines, a future refactor lifts it to `src/lib/user-agents.ts`).

Internal Playwright lifecycle:
1. `chromium.launch({headless: "new"})` — vanilla, no stealth plugins.
2. Browser context with realistic options: `userAgent` (one from rotation list per crawl run, NOT per request — Playwright's context UA is set once per context), `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport: {width: 1440, height: 900}`.
3. For each URL in `config.categoryUrls`:
   a. `page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000})`.
   b. Wait for product cards to appear: `page.waitForSelector(".product-grid-product, [data-productid]", {timeout: 15000})` with selector fallback (research.md §1.3).
   c. Infinite-scroll loop: scroll to bottom, `page.waitForFunction` checking that the rendered product count has increased OR plateaued. Cap at 200 products per category (operator-tunable via SiteConfig later if needed).
   d. Extract products via `page.evaluate(() => ...)` traversing `document.querySelectorAll(".product-grid-product")` and mapping each card's name, price, image, productUrl, color variants, gender into a `RawZaraProduct[]` array. Selector fallback chain encoded inside the `evaluate` block (mirrors Cafe24's `DEFAULT_SELECTORS` pattern at `cafe24-engine.ts:19-66`).
   e. Map `RawZaraProduct[]` → `Product[]` via `parseProductsFromDom` (the pure function — DOM extraction is in step d, type-mapping is in this step). Apply image-host whitelist for ZARA CDN (`static.zara.net`, `static-images.zara.net` — TBD verified during ANALYZE).
   f. Pace: `await page.waitForTimeout(crawlDelay)` between category iterations. `crawlDelay: 2000` ms baseline (browser overhead alone exceeds 1000 ms; 2000 ms is the Akamai-friendly pace).
   g. Abort-on-3-consecutive-errors per category (mirrors Uniqlo engine).
4. Browser closed in `finally` block.

The `parseProductsFromDom` pure function is the testable surface. The Playwright lifecycle itself is NOT unit-tested — only smoke-tested via live `--probe` invocation. This mirrors the Cafe24 engine's testing posture (Cafe24's Playwright lifecycle is also not unit-tested in this project, per SPEC-001/002 precedent).

### New SiteConfig field `categoryUrls?: string[]`

A new optional `SiteConfig` field is needed: a list of full URL paths (relative to baseUrl) for category landing pages. Distinct from Uniqlo's `apiCategoryPaths` (4-position comma-tuples consumed by an API query parameter) and distinct from Cafe24's `category.categories` (numeric `cateNo` IDs). ZARA's category access requires URL-slug navigation (e.g., `/kr/ko/woman-new-in-l1180.html`), and the engine treats each slug as a Playwright `page.goto` target.

The field is added to the `SiteConfig` interface alongside the existing `apiCategoryPaths` and `region` fields (added by SPEC-001/002). Only consumed when `type === "zara"`. The JSDoc explicitly notes the engine binding to avoid future engine-cross-contamination.

### `src/lib/types.ts` — `PlatformType` extension

`PlatformType` extends from `"cafe24" | "shopify" | "uniqlo"` (the SPEC-001 baseline) to `"cafe24" | "shopify" | "uniqlo" | "zara"`. A 1-LOC change. The `Product` interface and `CrawlResult` interface are unchanged.

### `src/configs/platforms.ts` — new `zara-kr` SiteConfig entry

A single new entry appended to the `PLATFORMS` array:
- `key: "zara-kr"`, `name: "자라 (KR)"`, `type: "zara"`, `baseUrl: "https://www.zara.com/kr/ko"`
- `sourceCurrency: "KRW"` (ZARA KR is KRW-native; no FX conversion at engine OR import time)
- `crawlDelay: 2000` (browser overhead + Akamai-friendly pacing baseline; tunable via `--rate=N` CLI override at the operator's discretion within the rate-cap policy)
- `categoryUrls: string[]` — hardcoded list of Women + Men L2 category landing-page URLs from research.md §1.5. Initial enumeration covers: WOMAN-New In, WOMAN-Coats, WOMAN-Jackets, WOMAN-Knitwear, WOMAN-Shirts, WOMAN-T-Shirts, WOMAN-Trousers, WOMAN-Jeans, WOMAN-Dresses, WOMAN-Skirts, MAN-New In, MAN-Coats, MAN-Jackets, MAN-Knitwear, MAN-Shirts, MAN-T-Shirts, MAN-Trousers, MAN-Jeans (~18 URLs).
- `notes: "ZARA KR Playwright engine. Akamai bm-verify bypass via real Chromium. KRW-native, 2 sec/page, 5-UA rotation list (one UA per crawl run, NOT per request — Playwright context UA is set once), robots-check enforced. ToS verification is a HARD precondition (REQ-008)."`

### `src/crawl.ts` — dispatch + probe wiring

`runCrawl()` partition: a new `zaraSites = configs.filter((c) => c.type === "zara")` partition, executed sequentially (NOT `Promise.all` like Uniqlo — each ZARA crawl launches its own Chromium browser; running them in parallel would multiply browser memory cost without throughput benefit, mirrors Cafe24's batch-of-3 pattern but for now zara-kr is the only entry, so a 1-at-a-time loop is sufficient and avoids premature optimization). Robots-check pre-flight identical to Uniqlo's branch.

`probeSite()`: a new `if (config.type === "zara")` branch testing one category URL with a quick Playwright launch + `page.goto` + selector-presence check. Prints sample of first product card extracted (name, price, productUrl, image), asserts the bm-verify intercept has been bypassed (page HTML contains real product DOM, NOT the bm-verify iframe). Browser closed in `finally`.

### Test surface

- `tests/fixtures/zara-kr-products.fixture.json` — frozen JSON snapshot of `RawZaraProduct[]` extracted from one real ZARA category landing page during the Run-phase PRESERVE step (analogous to Uniqlo's KR fixture). Captured ONCE via Playwright by the operator, frozen, committed.
- `tests/zara-engine.test.ts` — `node:test` suite (no new framework). Loads the fixture, runs `parseProductsFromDom` against a synthetic HTML body that contains the captured products' DOM structure, asserts every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, `price`. Image-host whitelist test mirrors `isSafeUniqloImageUrl`. **Does NOT test the Playwright lifecycle** (browser launch, navigation, scroll) — that surface is smoke-tested only via live `--probe` invocation.

This is a **new test pattern compared to Uniqlo**: the fixture is a captured-DOM snapshot rather than a captured-API JSON. The `parseProductsFromDom` function takes an HTML string as input; the test constructs a synthetic HTML body wrapping the fixture's product data and feeds it through. Acknowledged in plan.md §6.

### `src/import-products.ts` — no change

ZARA KR is KRW-native (`sourceCurrency: "KRW"`), so the SPEC-002 `convertToKrw` import-time hook does NOT fire. ZARA fields map onto existing `products` table columns. No change required.

---

## Requirements

The following requirements use EARS (Easy Approach to Requirements Syntax) format. SPEC-003 inherits and reuses requirements from SPEC-001 (rate-limit pacing, dry-run flow, robots-check pre-flight, abort-on-3-consecutive-errors, characterization-test fixture pattern, `--rate=N` operator override) — those are not re-stated. The requirements below are SPEC-003-specific deltas.

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register ZARA KR as a platform with `key: "zara-kr"`, `name: "자라 (KR)"`, `type: "zara"`, `baseUrl: "https://www.zara.com/kr/ko"`, `sourceCurrency: "KRW"`, `crawlDelay: 2000`, and a non-empty hardcoded `categoryUrls: string[]` field listing the Women + Men L2 category landing-page URL paths. The SiteConfig entry **SHALL NOT** include `apiCategoryPaths` (that field is reserved for `type === "uniqlo"`) or `region` (that field is reserved for the Uniqlo region-parameterized engine). `PlatformType` in `src/lib/types.ts` **SHALL** be extended to include `"zara"`.

Source: research.md §1.5 (URL list), §4.2 (engine recommendation); architecture impact subsection above.

### REQ-002 [Ubiquitous]

**THE ZARA engine SHALL** be implemented in a new file `src/lib/zara-engine.ts` exposing a single async entry function `crawlZara(config: SiteConfig): Promise<CrawlResult>`. The engine **SHALL** launch a Playwright Chromium browser internally with `headless: "new"`, configure the context with realistic options (`userAgent` from a 5-element rotation list, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport: {width: 1440, height: 900}`), and **SHALL** close the browser in a `finally` block. The engine **SHALL NOT** import any fingerprint-evasion library (`puppeteer-extra-plugin-stealth`, `playwright-stealth`, etc.). The engine **SHALL NOT** introduce any new `dependencies` or `devDependencies` to `package.json` — Playwright is already at `^1.58.2`.

Source: research.md §3.4 (HARD-rule constraints on bypass mechanisms), §4.2 (engine recommendation); architecture impact subsection above.

### REQ-003 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=zara-kr` without the `--dry-run` flag, **THE crawler SHALL** invoke `crawlZara`, which **SHALL** iterate over each URL in `config.categoryUrls`, performing for each URL: (1) `page.goto(url)` with `waitUntil: "domcontentloaded"`, (2) wait for the product-card selector chain to resolve, (3) execute an infinite-scroll loop until product count plateaus or a per-category cap is reached, (4) extract products via `page.evaluate` using the selector fallback chain, (5) map raw extractions to `Product[]` via `parseProductsFromDom`, applying the ZARA image-host whitelist (TBD verified during ANALYZE — initial hypothesis: `static.zara.net`, `static-images.zara.net`). The aggregated `Product[]` result **SHALL** be written to `data/zara-kr-products.json`. Each category iteration **SHALL** be paced with `await page.waitForTimeout(crawlDelay)` after extraction; default `crawlDelay: 2000`.

Source: research.md §1.4 (infinite scroll), §1.3 (DOM selectors); architecture impact subsection above.

### REQ-004 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=zara-kr --dry-run` (or `--probe=zara-kr`), **THE crawler SHALL** invoke the probe handler for the `"zara"` engine type, launching Playwright Chromium with the same realistic context options, navigating to the FIRST URL in `config.categoryUrls`, asserting the page HTML contains real product DOM (NOT the bm-verify iframe shell), printing a sample product summary to stdout (key fields: `name`, `price`, `productUrl`, `imageUrl`), and **SHALL NOT** write `data/zara-kr-products.json`. The dry-run **SHALL NOT** modify any file in the `data/` directory. Browser **SHALL** be closed in a `finally` block.

Source: research.md §4 (engine path), §1.3 (bm-verify intercept detection); SPEC-001 REQ-003 dry-run pattern.

### REQ-005 [State-driven]

**WHILE** a ZARA crawl is starting (whether `--dry-run` or full crawl), **THE crawler SHALL** invoke `checkRobots(config.baseUrl)` from `src/lib/robots-check.ts` (introduced by SPEC-001 REQ-004) and **SHALL** refuse to proceed if the returned result is `{allowed: false}`. The check **SHALL** run before any Playwright browser is launched. Behavior, error message format, and exit code are identical to SPEC-001 REQ-004 — this REQ exists in SPEC-003 only to make ZARA's coverage by the existing engine-agnostic check explicit.

Source: research.md §1.1 (ZARA `robots.txt` is permissive — passes blanket-disallow check); SPEC-001 REQ-004 reused.

### REQ-006 [Unwanted Behavior]

**IF** `crawlZara` encounters 3 consecutive errors within a single category iteration — where "error" is defined as: (a) `page.goto` timeout, (b) `page.waitForSelector` selector-not-found timeout, (c) the page HTML matching the bm-verify intercept signature (HTML body length < 5000 bytes AND containing the literal string `bm-verify`), or (d) a thrown exception during `page.evaluate` extraction — **THEN THE engine SHALL** abort that category, append a structured error entry to `CrawlResult.errors` (containing category URL, error type, timestamp, and a brief descriptor), and continue with the next URL in `config.categoryUrls`. "Consecutive" means without an intervening successful extraction (≥1 product card emitted) on the same URL. The engine **SHALL NOT** retry indefinitely, **SHALL NOT** silently swallow errors, **SHALL NOT** rotate IP addresses, **SHALL NOT** invoke any fingerprint-evasion technique, and **SHALL NOT** introduce any retry-with-backoff delay beyond the configured `crawlDelay`. After all categories are processed, the partial result **SHALL** be written to `data/zara-kr-products.json` with the populated `errors` array so the operator can audit which categories failed.

Source: research.md §3.4 (HARD-rule constraints), §5 (Akamai _abck escalation risk row); SPEC-001 REQ-005 abort-on-3 pattern adapted to Playwright failure modes.

### REQ-007 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (BEFORE any production engine code is written), **THE operator SHALL** verify that `chromium.launch({headless: "new"})` mode reliably bypasses the Akamai bm-verify intercept against `https://www.zara.com/kr/ko/woman-new-in-l1180.html` (or any single ZARA KR category landing page). Reliability is defined as: at least 4 of 5 sequential `page.goto` invocations from a single Playwright session reach real product DOM (HTML contains `.product-grid-product` or `[data-productid]` selectors with ≥10 matching elements) within a 30-second timeout. If reliability is below this threshold, **THE operator SHALL** invoke one of the rollback paths in research.md §4.3 (introduce Xvfb-in-CI as a separate SPEC, or defer SPEC-003 entirely and notify the project owner). **THE operator SHALL NOT** introduce a fingerprint-evasion library or otherwise circumvent the project HARD rules to compensate for an insufficient `headless: "new"` pass rate.

Source: research.md §3.3 (`headless: "new"` ~85% reliability per public reports), §4.3 (rollback paths); architecture impact (the engine's viability hinges on this single experimental verification — encoding it as a HARD precondition is the bias-prevention mechanism).

### REQ-008 [Ubiquitous] — AMENDED 2026-05-05 v0.2.0 (pre-verified)

**THE `src/lib/zara-engine.ts` source file SHALL** contain a top-of-file comment block embedding the verbatim Korean-language §2.1, §6-bullet-2, and §15 ZARA KR ToS clauses captured from the 2025-11-25 PDF (`static.zara.net/static/pdfs/KR/terms-and-conditions/terms-and-conditions-ko_KR-20251125.pdf`) at plan phase. The block **SHALL** include: (a) the verbatim Korean clause text for all three sections, (b) the capture date (2026-05-05) and operator name (hansangho), (c) the verdict label "AMBIGUOUS-ACCEPTED-BY-OWNER", (d) the SPEC-003 cross-reference, and (e) a one-line summary of the residual-risk conditions (kiko.ai-internal-use only; halt-on-cease-and-desist). The original Korean text **MUST NOT** be paraphrased, translated-only, or summarized in this comment block — verbatim quoting is the audit-evidence contract.

**THE operator SHALL NOT** be required to re-verify the ToS in a real browser at Run-phase, because plan-phase verification (research.md §1.2 verified) is treated as authoritative for the SPEC-003 implementation window. Re-verification is required ONLY if any of the following triggers occur after Run-phase begins: (i) ZARA publishes a new ToS PDF version on `static.zara.net/static/pdfs/KR/`, (ii) ITX Korea Limited issues a direct communication (cease-and-desist, terms-update notice), or (iii) more than 90 calendar days elapse between plan-phase verification (2026-05-05) and the first production crawl.

Source: research.md §1.2 (verified, 2026-05-05); SPEC-003 §Residual ToS Risk (updated v0.2.0); project HARD rule #1.

### REQ-009 [Ubiquitous]

**THE ZARA engine characterization-test suite at `tests/zara-engine.test.ts`** **SHALL** load the frozen fixture at `tests/fixtures/zara-kr-products.fixture.json` (an array of `RawZaraProduct` objects captured during the Run-phase PRESERVE step from a real ZARA category landing page) and **SHALL** run `parseProductsFromDom` against a synthetic HTML body wrapping the fixture's products, asserting that every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, and `price` fields, that every `imageUrl` matches the ZARA image-host whitelist (initial hypothesis: `static.zara.net`, `static-images.zara.net`; verified during ANALYZE), that every `productUrl` starts with `https://www.zara.com/kr/ko/`, and that every `price` is a positive KRW integer (typically 5,000 ≤ price ≤ 5,000,000 — sanity range). No new devDependency **SHALL** be added (`node:test` reused). The test suite **SHALL NOT** attempt to test the Playwright lifecycle (browser launch, navigation, scroll); that surface is smoke-tested only via live `--probe` invocation per REQ-004.

Source: SPEC-001 REQ-006 fixture pattern; architecture impact (test surface) subsection above.

## Files Affected

| File | Action | Est. LOC | Purpose |
|---|---|---|---|
| `src/lib/zara-engine.ts` | NEW | ~280 | Playwright engine: browser/context/page lifecycle, infinite-scroll loop, selector fallback chain, `parseProductsFromDom` pure function, image-host whitelist, abort-on-3-errors, bm-verify-intercept detector. |
| `src/lib/types.ts` | MODIFY | ~5 | Extend `PlatformType` (line 53, +1 LOC) to add `"zara"`. Add optional `categoryUrls?: string[]` to `SiteConfig` (lines 97-149, +4 LOC) with JSDoc binding to `type === "zara"`. |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `zara-kr` SiteConfig entry. Hardcoded `categoryUrls` enumerates ~18 Women + Men L2 category landing-page URLs (research.md §1.5). `crawlDelay: 2000`. |
| `src/crawl.ts` | MODIFY | ~50 | Add `zaraSites` partition + sequential dispatch loop in `runCrawl` (~30 LOC). Add `if (config.type === "zara")` branch in `probeSite` with bm-verify-intercept assertion (~20 LOC). |
| `tests/fixtures/zara-kr-products.fixture.json` | NEW | ~150 | Frozen `RawZaraProduct[]` snapshot from one real ZARA category page (~50-100 products). Captured once via Playwright in Run-phase PRESERVE, frozen. |
| `tests/zara-engine.test.ts` | NEW | ~150 | `node:test` suite. `parseProductsFromDom` against synthetic-HTML-wrapped fixture; image-host whitelist test; abort-on-3-errors mock test (using Playwright `page.evaluate` mock or pure-function equivalent); bm-verify-intercept detector test (synthetic HTML body matching the intercept signature). |
| `.moai/project/structure.md` | MODIFY | ~10 | Add `zara-kr` row to platform table (now 35 entries), document the ZARA Playwright pattern in the engine-layering subsection. |
| `package.json` | NO CHANGE | 0 | Playwright is already in dependencies. node:test runner already configured. No new deps. |

Total estimated LOC delta: **~675**.

## Acceptance References

Detailed Given-When-Then acceptance scenarios are documented in `.moai/specs/SPEC-PLATFORM-EXPANSION-003/acceptance.md`. The acceptance suite contains 10 scenarios mapping to REQ-001 through REQ-009, with AC-9 (REQ-007 Akamai bypass verification) and AC-10 (REQ-008 ToS verification) being the two HARD preconditions for engine graduation.

## Risks

Three risks are tracked here for visibility throughout the Run phase. Mitigations are described in research.md §5 and will be implemented as part of the engine code or operator process, not as separate SPECs.

- **Akamai _abck cookie escalates to active 4xx block during a long crawl** — Likelihood: High, Impact: High. Mitigation: 2 sec/page pacing baseline (Akamai-friendly), abort-on-3-consecutive-errors, no IP rotation, fail-loud via `CrawlResult.errors`. If a single full crawl run produces >50% category aborts, the engine is treated as broken (not transient) and the rollback path in research.md §4.3 is invoked. Accepted residual risk.
- **`headless: "new"` mode reliability below 80% against Akamai bm-verify** — Likelihood: Medium, Impact: High. Mitigation: REQ-007 makes verification a HARD precondition before engine code is written. If verification fails, no engine code is written and the operator escalates. This is a process-level mitigation, not a code-level one — it bounds the risk by preventing wasted engineering effort.
- **ToS clause forbids automated access** — Likelihood: Unknown (could not verify via curl), Impact: Critical (de-facto deferral). Mitigation: REQ-008 makes ToS verification in a real browser a HARD precondition. The verbatim clause is committed alongside engine code as audit evidence. If the clause forbids, the engine is shelved and the SiteConfig entry is set to `disabled: true`. Accepted process-level mitigation.

---
id: SPEC-PLATFORM-EXPANSION-006
version: 0.2.0
status: shipped
created_at: "2026-05-06"
updated_at: "2026-05-07"
author: hansangho
priority: high
issue_number: 0
labels: [crawler, platform, farfetch, farfetch-kr, farfetch-us, playwright, dom-scrape, multi-brand, luxury]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-07 | v0.2.0 | **Run-phase complete; status draft → shipped.** ANALYZE: REQ-007 8/8 multi-nav stability PASS at 3-sec pacing (100% > 87.5% threshold) with sitemap-derived categoryUrls (recon's failed `men/shoes-1`, `men/bags-purses-1` replaced with live `-2` slugs). REQ-008 Korean ToS captured live (24,986 bytes); §13 (지적 재산권) names "데이터 마이닝, 로봇 또는 유사한 데이터 수집 및 발췌 툴" generically + prohibits database from "가격 및 상품 리스트" without written consent. NO `크롤러`/`스크래핑`/`crawler`/`scrape` verbatim. Verdict: **AMBIGUOUS-ACCEPTED-BY-OWNER** (hansangho 2026-05-07) — qualitatively more restrictive than ZARA KR §15 but less explicit than 29CM §11 ¶2.9 (which named "크롤러" verbatim and required OWNER OVERRIDE). Verbatim Korean clauses embedded at top of `src/lib/farfetch-engine.ts`. REQ-009 sitemap.xml fetched (886 KB) and category nav DOM-extracted; 8 KR L2 URLs locked. Card selector: `[data-component*="ProductCard"]` (92–723 cards/landing). Image hosts: `cdn-images.farfetch-contents.com`, `cdn-static.farfetch-contents.com`. productUrl pattern: `^https://www.farfetch.com/(?:kr/)?shopping/(?:men\|women\|kids)/[A-Za-z0-9%.-]+-item-\d+\.aspx$`. PRESERVE: fixture `tests/fixtures/farfetch-kr-products.fixture.json` captured from live `/kr/shopping/men/clothing-2` (32 cards, brand+name+priceText+imageUrl populated). IMPROVE: `src/lib/farfetch-engine.ts` 591 LOC implemented (region-parameterized KR+US per user request 2026-05-07 "Farfetch kr 하고 us도 같이해줘"); `src/lib/types.ts` PlatformType extended; `src/configs/platforms.ts` `farfetch-kr` + `farfetch-us` entries appended; `src/crawl.ts` dispatch + probe handler added; `tests/farfetch-engine.test.ts` 27 tests PASS (100/100 total suite green); `pnpm tsc --noEmit` clean; live `pnpm crawl --probe=farfetch-kr` against L2 yields 723 cards extracted, 24 products parsed with KRW pricing. **US extension** (per user directive 2026-05-07): same legal entity (Farfetch UK Limited / Coupang Inc.); `/terms-and-conditions/` returns Korean §13 with notice "This section is currently only available in Korean." — KR §13 binding for US storefront; engine ships region-parameterized; US categoryUrls hardcoded mirroring KR slug structure; live US verification deferred to production deployment from US-routable infrastructure (KR-resident operator IP forces geo-routing to /kr/). |
| 2026-05-06 | v0.1.0 | Initial draft. Adds Farfetch KR storefront (`farfetch.com/kr/`) as the 38th registered platform — first non-self-branded multi-brand luxury editorial shop in the project. Engine architecture is a hybrid of ZARA's Playwright lifecycle (`channel:"chrome"`, 5-UA rotation, `crawlDelay`) and Cafe24's DOM-scrape extraction (no XHR-interception — Farfetch SSRs product cards in initial HTML). Live recon 2026-05-06 confirmed: (1) **multi-navigation stable** — 5/6 sequential `page.goto` within single session render real product DOM with 0 challenge keywords; (2) **HTTP 400 pagination quirk** — `?page=N` returns 4xx status BUT body fully populated with 200+ cards (engine MUST extend abort criteria: 4xx + populated body is NOT an error); (3) **server-side geo-routing** — KR-presenting IP forces Korean locale + KRW-native pricing; (4) **ToS URL discovered** at `https://www.farfetch.com/kr/terms-and-conditions/`; (5) **robots.txt permissive** — no blanket disallow, sitemap declared. Three Run-phase HARD preconditions encoded as REQ-007 (8+ multi-nav stability), REQ-008 (Korean ToS verbatim capture with bilingual keyword scan), REQ-009 (sitemap-derived `categoryUrls` URL-list verification). New engine module `src/lib/farfetch-engine.ts` (~500 LOC est.). KRW-native cache. |

---

## Overview

This SPEC adds Farfetch KR storefront (`farfetch.com/kr/`) as the 38th registered platform in the crawler — the project's first **non-self-branded multi-brand luxury editorial shop** outside the existing Shopify pattern. Farfetch KR carries 2,000+ designer brands (Loewe, Bottega Veneta, Maison Margiela, Acne Studios, A.P.C., Comme des Garçons, Off-White, etc.) curated at category and designer levels. The expected catalog scale is **60,000–120,000 SKU** with KRW-native pricing.

The engine architecture is a **DOM-scrape hybrid**: Playwright Chromium with `channel:"chrome"` (the same Akamai-bypass technique used by SPEC-003/005 ZARA), but extracting products by walking the SSR'd DOM (the same pattern used by SPEC's Cafe24 engine) rather than intercepting XHR responses (the ZARA-specific strategy). Farfetch's initial HTML response carries 60–2150 product cards depending on the landing page; lazy-loaded XHRs are non-essential for catalog enumeration.

Five user-confirmed scope decisions are baked in: (1) **region scope** — Farfetch KR only (`farfetch.com/kr/`); en-US, en-UK, en-EU, en-JP, en-CN are NOT in scope and require their own SPECs; (2) **catalog scope** — Men + Women full fashion at top level + Clothing/Shoes/Bags/Accessories L2; Kids, Beauty, Home, Watches, and Fine Jewelry are deferred; (3) **engine architecture** — new `src/lib/farfetch-engine.ts`, NOT region-parameterized initially (KR only — region pattern can be added in a follow-up SPEC mirroring SPEC-002 Uniqlo precedent); (4) **currency** — KRW-native cache via Farfetch's IP-based geo-routing; no engine-time conversion, no import-time conversion (existing SPEC-002 hook is a no-op for KRW); (5) **anti-bot strategy** — `channel:"chrome"` (real Chrome required, NOT bundled Chromium), 5-UA rotation, **3+ sec pacing** (more conservative than ZARA's 2 sec because Farfetch is luxury multi-brand and may have higher monitoring at scale). Three Run-phase HARD preconditions encoded as REQ-007 (8+ sequential nav stability — exceeds the recon's 6 to provide safety margin), REQ-008 (Korean ToS captured live with bilingual keyword scan), REQ-009 (sitemap-derived `categoryUrls` URL-list verification — `sitemap.xml` is the authoritative source per Farfetch's robots.txt declaration).

### Engine-Path Justification

The user's directive locked the engine architecture: new `farfetch-engine.ts`, NOT extension of ZARA. Research validates this empirically (research.md §2.1, §2.3):

- **§2.1 DOM-scrape rationale**: ZARA's XHR-interception (`/category/{id}/products?ajax=true`) targets ZARA's lazy SPA. Farfetch SSRs product cards directly in initial HTML (1500+ raw card count observed on Women/Clothing). No equivalent product-list JSON XHR was observed during 5-second initial-render window. DOM evaluation via `page.evaluate(() => walkCards())` is the correct extraction strategy.
- **§2.3 Module separation**: Folding XHR-interception (ZARA) and DOM-scrape (Cafe24/Farfetch) into one module conflates strategies and creates accidental coupling. Future shared `playwright-lifecycle.ts` extraction (browser launch, context options, abort-on-3, robots-check) used by both engines is a candidate refactor — out of scope here.

**Caveat**: Farfetch's anti-bot posture is operator-tunable. Recon's 5/6 multi-nav success at 2.5-sec pacing may not scale to 50+ sequential navigations. SPEC-006 Run phase MUST perform an 8+ sequential probe at the configured 3-sec pacing to confirm stability before engine code is shipped (REQ-007). SSENSE's verification (failed nav 2) is **NOT** authoritative for Farfetch — different sites, different bot vendors.

### Residual ToS Risk (UNVERIFIED at plan phase — DEFERRED to Run-phase)

Farfetch KR's Korean ToS has not yet been captured. Plan-phase recon located the URL (`https://www.farfetch.com/kr/terms-and-conditions/`) via footer link extraction but did not capture the body. This is the same situation SPEC-003 (ZARA KR), SPEC-004 (29CM KR), and SPEC-005 (ZARA US) faced at v0.1.0. SPEC-006 cannot benefit from a plan-phase shortcut.

- ToS verification is **DEFERRED to Run-phase Playwright session** (REQ-008 below).
- The Run-phase ANALYZE step MUST open `https://www.farfetch.com/kr/terms-and-conditions/` in a real Playwright session AFTER REQ-007 multi-nav verification passes, capture the rendered Korean ToS body text via `page.evaluate(() => document.body.innerText)`, scan for keywords (`크롤러`, `크롤링`, `크롤 봇`, `자동화`, `자동화 도구`, `자동 수집`, `데이터 수집`, `봇`, `로봇`, `로봇 배제`, `프로그램`, `소프트웨어 이용`, `스크래핑`, `스크래퍼`, `screen scraping`, `web scraping`, `crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `screen scraping`, `AI training`, `machine learning`, `agent`, `automated access`, `data mining`), and embed verbatim relevant Korean clauses as a comment block at the top of `src/lib/farfetch-engine.ts` for permanent audit record.
- If a clause unambiguously forbids automated catalog access (e.g., a clause naming "크롤러", "자동 수집", "no scraping" verbatim — analogous to SPEC-004 (29CM) which named "크롤러(Crawler)" in 제11조 §2.9호), the engine ships **shelved** — `disabled: true` on the new `farfetch-kr` SiteConfig — and the operator escalates to project owner per HARD rule #1.
- If clauses are ambiguous (analogous to ZARA KR §15 and ZARA US §17 IP rights), the operator records the verdict (PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS) and proceeds accordingly.
- kiko.ai-internal-use only is the assumed scope. Public re-distribution of Farfetch product data is NOT covered and would require separate legal review.
- If Farfetch issues a cease-and-desist communication, the operator MUST set `disabled: true` immediately, halt production crawls, and re-evaluate per project HARD rule #1.

The Run-phase agent has explicit authority to make the AMBIGUOUS-ACCEPTED-BY-OWNER call IF the captured Korean ToS contains no unambiguous prohibition AND the residual risk profile is comparable to ZARA KR §15 / ZARA US §17. Otherwise the agent MUST report findings and request explicit project-owner review before unblocking the engine.

---

## Goals

- Ship a working Farfetch KR crawler that produces a `data/farfetch-kr-products.json` cache file with KRW-native `price` values, consumable by the existing `src/import-products.ts` Supabase upsert path (KRW-only path; no FX conversion required because `sourceCurrency: "KRW"`).
- New engine module `src/lib/farfetch-engine.ts` implementing the **DOM-scrape hybrid**: Playwright Chromium with `channel:"chrome"`, server-driven KR locale (no client locale override), DOM evaluation via `page.evaluate`, abort-on-3-consecutive errors (extended: 4xx + populated body is NOT an error), top-of-file ToS comment block, image-host whitelist, 5-UA rotation, 3+ sec pacing, robots-check pre-flight.
- Reuse SPEC-001 robots-check, SPEC-003 Playwright lifecycle pattern, SPEC-004 live ToS capture, SPEC-005 Run-phase HARD gate pattern + parameterized fixture testing.
- Introduce a new SiteConfig entry `farfetch-kr` with `type: "farfetch"`, `region: "KR"` (semantic only — engine is not region-parameterized in this SPEC), `sourceCurrency: "KRW"`, `crawlDelay: 3000`, hardcoded initial `categoryUrls` (~30 URLs covering Men + Women top + L2 verified at Run-phase from sitemap.xml).
- Extend `PlatformType` union in `src/lib/types.ts` to include `"farfetch"` (1 LOC).
- Add new dispatch branch in `src/crawl.ts` for `type === "farfetch"` routing to `crawlFarfetch` (1 case statement, ~5 LOC).
- Establish the precedent that multi-brand editorial shops are crawlable within project HARD rules (no fingerprint evasion, no IP rotation, no CAPTCHA solver) IF they have ZARA-comparable anti-bot posture (multi-nav stable, no per-session DataDome escalation).
- Make Run-phase multi-nav stability verification (REQ-007), Run-phase Korean ToS verification (REQ-008), and Run-phase live `categoryUrls` sitemap-derived URL-list verification (REQ-009) HARD preconditions for the engine graduating from `status: draft` to live production.

## Non-Goals / Exclusions

- **Farfetch regions other than KR** — en-US, en-UK, en-EU, en-JP, en-CN, fr-FR, etc. Each region requires its own SPEC. The engine architecture is structurally extensible to other regions via `region` parameter (mirrors SPEC-002 Uniqlo precedent), but each region is its own approval gate (different ToS jurisdiction, different anti-bot posture, different category taxonomy).
- **Farfetch Kids section** — Out of scope.
- **Farfetch Beauty / Home / Lifestyle** — Out of scope.
- **Farfetch Watches & Fine Jewelry as L1** — Initially out of scope (small absolute volume, different product schema).
- **Farfetch sub-brands** (Browns, Stadium Goods, NEW GUARDS GROUP brands) — Out of scope; each is its own platform with its own DTC and editorial.
- **Mobile-app reverse-engineering** — Forbidden by project HARD rules.
- **Fingerprint-evasion libraries** (`puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` JA3, etc.) — Forbidden.
- **Xvfb-in-CI for `headless: false` mode** — If `channel:"chrome"` proves insufficient, introducing Xvfb is a separate SPEC.
- **IP rotation, residential proxy networks, CAPTCHA solving services, authenticated scraping** — Inherited HARD prohibitions.
- **Schema migration** — No kiko.ai Supabase schema change. Farfetch KR fields (name, price, image URL, product URL, designer/brand, category, gender) all map onto existing `Product` columns.
- **Live FX rate API** — N/A (KRW-native).
- **Linter / formatter introduction** — Inherited from SPEC-001/002/003/004/005. `tsc --noEmit` remains the only static check.
- **Vitest framework introduction** — Inherited. `node:test` remains the runner.
- **Engine region-parameterization** — KR-only. Future region-param refactor (mirroring SPEC-002 Uniqlo) is out-of-scope here.
- **Scroll-based infinite-scroll harvesting** — Initial implementation uses paginated URL enumeration (sitemap-derived). Infinite-scroll within a single landing is deferred (would require additional SPEC if catalog growth exceeds sitemap freshness).
- **Per-designer catalog crawl** — Initial implementation crawls category-level pages (Men/Clothing, Women/Shoes, etc.). Designer-level (`/kr/shopping/designers/{slug}`) is deferred — adds 2000+ URLs, multi-nav stability untested at that scale.
- **Other deferred platforms** — Status unchanged from prior SPECs.

## Architecture Impact

### New module `src/lib/farfetch-engine.ts` (~500 LOC)

Brand-new module. Structure mirrors `src/lib/zara-engine.ts` (lifecycle + abort-on-3 + robots-check + ToS comment) but with DOM-scrape extraction:

- **Top-of-file ToS comment block** (~30 LOC) — verbatim Korean ToS clauses captured at REQ-008, verdict label, capture date/operator/source URL, residual-risk conditions. Pattern: SPEC-003 ZARA KR, SPEC-004 29CM KR, SPEC-005 ZARA US.
- **`FARFETCH_USER_AGENTS`** (5 entries) — same UA rotation list as ZARA/29CM (Chrome, Firefox, Safari realistic Mozilla strings).
- **`FARFETCH_IMAGE_HOSTS`** (whitelist Set) — locked at PRESERVE step. Hypothesis: `cdn-images.farfetch-contents.com`, `cdn.farfetch.com`. Defensive fallback regex.
- **`isSafeFarfetchImageUrl(src: string): boolean`** — host whitelist check.
- **`FARFETCH_PRODUCT_URL_RE`** — hypothesis `^https:\/\/www\.farfetch\.com\/kr\/shopping\/[^"'\s]+-item-\d+\.aspx$`. Locked at PRESERVE.
- **`isSafeFarfetchProductUrl(url: string): boolean`** — regex test.
- **`detectChallengeIntercept(html: string, title: string): InterceptCheck`** — detects DataDome-style "Just a moment..." pages, Cloudflare challenge bodies. Heuristic: HTML body length < 5,000 bytes AND title matches `/just a moment|challenge|datadome|cf-mitigated/i`. Mirrors `detectBmVerifyIntercept` from ZARA engine but with different signature.
- **`RawFarfetchCard`** TypeScript interface — shape of extracted card object: `{href, name, brand, price, priceText, imageUrl, designer, category}`.
- **`extractCardsFromDom(page: Page, baseUrl: string): Promise<RawFarfetchCard[]>`** — pure extraction function. Uses `page.evaluate` to walk the locked card selector, returns raw card objects. Defensive null-handling.
- **`parseProductsFromCards(cards: RawFarfetchCard[], baseUrl: string, platformKey: string): Product[]`** — pure parse function: applies productUrl whitelist, image-host whitelist, KRW price sanity range (1,000 ≤ price ≤ 100,000,000), populates `Product` shape. Exposed for unit testing.
- **`crawlOneCategory(page, categoryUrl, baseUrl, platformKey, gender): Promise<{products, error}>`** — Playwright lifecycle wrapper. Borrows shape from ZARA's `crawlOneCategory` but replaces XHR-interception with `extractCardsFromDom` + `parseProductsFromCards`. Extended abort criteria: 4xx with `cards >= 10` is NOT an error. Selector timeout, challenge intercept, exception during DOM extraction → error.
- **`deriveGenderFromUrl(url: string): string`** — region-aware gender derivation (`/kr/shopping/men/...` → "men", `/kr/shopping/women/...` → "women"). Borrowed from ZARA pattern.
- **`crawlFarfetch(config: SiteConfig): Promise<CrawlResult>`** — entry point. `chromium.launch({channel:"chrome", headless: true})`, robots-check pre-flight, iterate `categoryUrls` with 3+ sec pacing, abort-on-3, ALL browser context options minimal (let server geo-route to KR), 5-UA rotation per context, finally browser.close(). Identical structure to `crawlZara`.

### `src/lib/types.ts` — `PlatformType` extension (~1 LOC)

Add `"farfetch"` to the `PlatformType` union. The `region`, `sourceCurrency`, `crawlDelay`, `categoryUrls` fields all already exist on `SiteConfig` and are reused without schema change.

### `src/configs/platforms.ts` — new `farfetch-kr` SiteConfig entry (~25 LOC)

Append after the existing 29CM entry:
- `key: "farfetch-kr"`, `name: "파페치 (KR)"`, `type: "farfetch"`, `baseUrl: "https://www.farfetch.com/kr"`, `region: "KR"`, `sourceCurrency: "KRW"`, `crawlDelay: 3000`
- `categoryUrls: string[]` — initial enumeration ~30 URLs covering Men/Women top + Clothing/Shoes/Bags/Accessories L2 (sourced from sitemap.xml at Run-phase ANALYZE; hardcoded after live verification per REQ-009)
- `notes: "Farfetch KR Playwright + DOM-scrape engine. channel:'chrome' (real Chrome required, similar Akamai posture to ZARA). KR-routed via IP geo-detection — KRW native, Korean product names. 3 sec/page pacing (more conservative than ZARA's 2 sec — luxury multi-brand has higher monitoring potential). 5-UA rotation, robots-check enforced. ToS captured at Run-phase (REQ-008); pagination ?page=N returns 400 status with populated body — engine treats 4xx + cards>=10 as success. categoryUrls sourced from sitemap.xml 2026-MM-DD; refresh cadence 90 days OR on first failure. kiko.ai-internal-use only; halt-on-cease-and-desist."`

### `src/crawl.ts` — new dispatch branch (~5 LOC)

Add a case for `type === "farfetch"` in the dispatch switch routing to `crawlFarfetch(config)`. Probe handler also extends to `farfetch` with the existing intercept-detector pattern (using `detectChallengeIntercept` from the new engine).

### `src/import-products.ts` — NO CHANGE

KRW-native cache. The post-SPEC-002 hook checking `sourceCurrency !== "KRW"` is a no-op for `farfetch-kr`.

### `src/lib/fx.ts` — NO CHANGE

KRW-native, no FX entry needed.

### `src/lib/robots-check.ts` — NO CHANGE

Region-agnostic blanket-disallow detector. Farfetch's `robots.txt` has no blanket disallow.

### Test surface

- `tests/fixtures/farfetch-kr-products.fixture.json` — frozen DOM extraction snapshot from one real Farfetch KR category landing (~50–100 products), captured ONCE during Run-phase PRESERVE step. ~150 LOC.
- `tests/farfetch-engine.test.ts` — characterization tests parameterized to fixture. Assert: every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, `price`; every `imageUrl` matches `FARFETCH_IMAGE_HOSTS` whitelist; every `productUrl` matches `FARFETCH_PRODUCT_URL_RE`; every `price` is positive KRW integer in sanity range; every `Product.sourceCurrency === "KRW"`; every `Product.platform === "farfetch-kr"`; every `Product.priceFormatted` starts with `"₩"`. Unit tests for `isSafeFarfetchImageUrl`, `isSafeFarfetchProductUrl`, `detectChallengeIntercept`, `deriveGenderFromUrl`. ~250 LOC.

---

## Requirements

The following requirements use EARS (Easy Approach to Requirements Syntax) format. SPEC-006 inherits and reuses requirements from SPEC-001 (rate-limit pacing, dry-run flow, robots-check pre-flight, abort-on-3-consecutive-errors, characterization-test fixture pattern, `--rate=N` operator override) and SPEC-003 (Playwright + `channel:"chrome"` Akamai bypass, 5-UA rotation, image-host whitelist, ToS verbatim contract). Requirements below are SPEC-006-specific deltas.

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register Farfetch KR as a platform with `key: "farfetch-kr"`, `name: "파페치 (KR)"`, `type: "farfetch"`, `baseUrl: "https://www.farfetch.com/kr"`, `region: "KR"`, `sourceCurrency: "KRW"`, `crawlDelay: 3000`, and a non-empty hardcoded `categoryUrls: string[]` field listing approximately 30 URLs covering Men + Women top + L2 (Clothing, Shoes, Bags, Accessories). The exact URL list is sourced from `https://www.farfetch.com/sitemap.xml` at Run-phase ANALYZE and live-verified per REQ-009 before being committed. The `PlatformType` union in `src/lib/types.ts` **SHALL** be extended to include `"farfetch"`. The `SiteConfig` schema **SHALL NOT** be otherwise changed (`region`, `sourceCurrency`, `crawlDelay`, `categoryUrls` already exist).

Source: research.md §1.1 (robots.txt + sitemap), §1.5 (KR locale geo-routing).

### REQ-002 [Ubiquitous]

**THE Farfetch engine SHALL** be implemented as a new module `src/lib/farfetch-engine.ts` using Playwright Chromium with `channel:"chrome"` for Akamai/DataDome bypass and DOM-scrape extraction (NOT XHR-interception). The engine **SHALL** launch a real Chrome browser, create a Playwright context with minimal options (5-UA rotation per context, `viewport: {width: 1440, height: 900}`; **SHALL NOT** override `locale` or `timezoneId` — server geo-routes KR locale based on IP), navigate to each `categoryUrl` in sequence with `crawlDelay` pacing, walk the SSR'd product card DOM via `page.evaluate`, parse extracted cards via `parseProductsFromCards`, apply image-host whitelist + productUrl regex + KRW sanity range, and emit a `Product[]` array. The engine **SHALL NOT** intercept XHR responses (Farfetch SSRs cards directly).

Source: research.md §2.1, §2.2.

### REQ-003 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=farfetch-kr` without the `--dry-run` flag, **THE crawler SHALL** invoke `crawlFarfetch(config)`, which **SHALL** iterate over each URL in `config.categoryUrls`, performing for each URL: (1) `page.goto(url)` with `waitUntil: "domcontentloaded"`, (2) wait for the locked product card selector to resolve OR for the challenge-intercept signature to match, (3) extract cards via `extractCardsFromDom`, (4) parse via `parseProductsFromCards` with KR-region defaults, (5) apply image-host whitelist (`cdn-images.farfetch-contents.com`, `cdn.farfetch.com`, locked at PRESERVE), (6) accumulate to `allProducts`. The aggregated `Product[]` result **SHALL** be written to `data/farfetch-kr-products.json` with `price` as positive KRW integer, `sourceCurrency: "KRW"`, `priceFormatted: \`₩${price.toLocaleString("ko-KR")}\``, `platform: "farfetch-kr"`, `productUrl` starting with `https://www.farfetch.com/kr/shopping/`. Pacing **SHALL** be `crawlDelay` ms between consecutive `page.goto` calls (default 3000 ms = 3 sec/page).

Source: research.md §1.5 (KRW-native), §2.2 (lifecycle).

### REQ-004 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=farfetch-kr --dry-run` (or `--probe=farfetch-kr`), **THE crawler SHALL** invoke the probe handler for the `"farfetch"` engine type, launching Playwright Chromium with `channel:"chrome"` and minimal context options (UA from rotation list, viewport 1440x900), navigating to the FIRST URL in `config.categoryUrls`, asserting the page DOM resolves at least 60 product cards via the locked selector (NOT a challenge intercept), printing a sample product summary to stdout (key fields: `name`, `brand`, `price`, `productUrl`, `imageUrl`), and **SHALL NOT** write `data/farfetch-kr-products.json`. The dry-run **SHALL NOT** modify any file in the `data/` directory. Browser **SHALL** be closed in a `finally` block.

Source: SPEC-003 REQ-004 reused; research.md §1.3 (multi-nav stable).

### REQ-005 [State-driven]

**WHILE** a Farfetch KR crawl is starting (whether `--dry-run` or full crawl), **THE crawler SHALL** invoke `checkRobots(config.baseUrl)` from `src/lib/robots-check.ts` (introduced by SPEC-001 REQ-004) and **SHALL** refuse to proceed if the returned result is `{allowed: false}`. The check **SHALL** run before any Playwright browser is launched. Behavior, error message format, and exit code are identical to SPEC-001 REQ-004 — this REQ exists in SPEC-006 only to make Farfetch KR's coverage by the existing engine-agnostic check explicit. The `robots.txt` file is region-agnostic (single global file), already verified at plan-phase to have no blanket `Disallow: /` (research.md §1.1).

Source: research.md §1.1; SPEC-001 REQ-004 reused.

### REQ-006 [Unwanted Behavior]

**IF** `crawlFarfetch` encounters 3 consecutive errors within a single category iteration — where "error" is defined as: (a) `page.goto` timeout; (b) the locked product-card selector fails to resolve within 30 seconds; (c) the page HTML matches the challenge-intercept signature (`detectChallengeIntercept` returns `{isIntercept: true}` — HTML body < 5,000 bytes AND title contains `just a moment|challenge|datadome|cf-mitigated`); (d) a thrown exception during DOM extraction or parsing — **THEN THE engine SHALL** abort that category, append a structured error entry to `CrawlResult.errors`, and continue with the next URL in `config.categoryUrls`. **CRITICAL EXTENSION**: HTTP 4xx response status with response body containing >= 10 product cards is **NOT** an error (Farfetch's pagination quirk — research.md §1.4). Engine reads DOM card count BEFORE checking status. The engine **SHALL NOT** retry indefinitely, **SHALL NOT** silently swallow errors, **SHALL NOT** rotate IP addresses, **SHALL NOT** invoke any fingerprint-evasion technique, and **SHALL NOT** introduce any retry-with-backoff delay beyond the configured `crawlDelay`.

Source: SPEC-003 REQ-006 reused; research.md §1.4 (4xx pagination quirk).

### REQ-007 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (BEFORE the new `farfetch-kr` SiteConfig entry is committed and BEFORE non-dry-run crawls are run against Farfetch), **THE operator SHALL** verify that `chromium.launch({channel:"chrome", headless: true})` mode reliably handles 8 sequential navigations within a single Playwright session against Farfetch KR catalog landings (combinations of `/kr/shopping/men/items.aspx`, `/kr/shopping/women/items.aspx`, `/kr/shopping/men/clothing-2/items.aspx`, `/kr/shopping/women/clothing-1/items.aspx`, etc.). Reliability is defined as: at least 7 of 8 sequential `page.goto` invocations from a single Playwright session reach real product DOM (>= 60 cards via the locked selector) within 30-second timeout, AND 0 challenge-intercept signatures detected.

Recon's 5/6 (2026-05-06) is a **promising baseline but NOT authoritative for Run-phase** — recon used a broad selector (`a[href*="/shopping/"]`) and 2.5-sec pacing. Run-phase uses the locked refined selector and 3+ sec pacing.

If reliability is below 87.5% (7 of 8), **THE operator SHALL** invoke one of the rollback paths:

1. **Tighten pacing** (e.g., 5+ sec, retry).
2. **Per-category browser session reset** — launch fresh browser instance per category. Slower but works around per-session escalation.
3. **Defer Farfetch KR** — set `disabled: true` on the new `farfetch-kr` SiteConfig entry, abandon the engine activation, escalate to project owner. The engine module itself can remain in place as scaffolding.
4. **Reduce `categoryUrls` to the safest minimal set** (Men + Women top only — 2 URLs) and ship with reduced catalog coverage.

**THE operator SHALL NOT** introduce a fingerprint-evasion library or otherwise circumvent the project HARD rules to compensate for an insufficient `channel:"chrome"` pass rate.

Source: research.md §1.3 (multi-nav 5/6 baseline), §4 (escalation risk register); bias-prevention (recon CANNOT substitute for Run-phase verification).

### REQ-008 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (AFTER REQ-007 passes, BEFORE any non-dry-run crawl against `farfetch-kr`), **THE operator SHALL** open `https://www.farfetch.com/kr/terms-and-conditions/` in a real Playwright browser session, wait for the SPA to hydrate (body length > 50 KB), capture the rendered Korean ToS body text via `page.evaluate(() => document.body.innerText)`, scan for keywords (Korean: `크롤러`, `크롤링`, `자동화`, `자동화 도구`, `자동 수집`, `데이터 수집`, `봇`, `로봇`, `로봇 배제`, `프로그램`, `소프트웨어 이용`, `스크래핑`, `스크래퍼`; English-as-loanword: `crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `agent`, `automated access`, `data mining`, `screen scraping`, `AI training`, `machine learning`), identify all clauses referencing automation, IP rights, or content use, and embed the verbatim relevant Korean clauses as a comment block at the top of `src/lib/farfetch-engine.ts` for permanent audit record.

The block **SHALL** include: (a) the verbatim Korean clause text for each relevant clause, (b) the capture date and operator name, (c) the source URL, (d) a verdict label (one of: PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS), (e) the SPEC-006 cross-reference, (f) a one-line summary of the residual-risk conditions (kiko.ai-internal-use only; halt-on-cease-and-desist; re-verify on ToS publication-date change OR Farfetch communication OR > 90 days elapsed). The original Korean text **MUST NOT** be paraphrased, summarized, or translated — verbatim quoting is the audit-evidence contract.

If the captured text contains ANY clause that unambiguously forbids automated catalog access (e.g., naming "크롤러", "자동 수집", "no scraping" verbatim — analogous to SPEC-004 (29CM) which named "크롤러(Crawler)" verbatim in 제11조 §2.9호 and was OWNER-OVERRIDDEN), **THE operator SHALL**: (1) set `disabled: true` on the `farfetch-kr` SiteConfig, (2) abandon the engine activation, (3) escalate to project owner with the verbatim forbidding clause and a recommendation for owner-override decision (analogous to SPEC-004 OWNER OVERRIDE pattern) OR for a B2B partner-API conversation with Farfetch.

If the captured text contains ambiguous clauses (e.g., IP rights clauses analogous to ZARA KR §15 / ZARA US §17), **THE operator SHALL** classify the verdict as AMBIGUOUS-ACCEPTED-BY-OWNER and proceed under the standard kiko.ai-internal-use conditions, OR escalate to project owner if the residual risk is qualitatively higher than ZARA KR §15.

Source: research.md §1.2 (ToS URL discovered); SPEC-003 §Residual ToS Risk; SPEC-004 REQ-008 (live capture + OWNER OVERRIDE pattern); SPEC-005 REQ-008 (bilingual scan); project HARD rule #1.

### REQ-009 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (AFTER REQ-007 passes), **THE operator SHALL** download `https://www.farfetch.com/sitemap.xml` (and any sub-sitemaps it indexes — `sitemap-products.xml`, `sitemap-categories.xml`, etc.), extract approximately 30 candidate URLs covering Men + Women top + L2 (Clothing, Shoes, Bags, Accessories), and verify each URL by `page.goto`'ing in a Playwright session, confirming: (a) the page does NOT redirect to home/marketing, AND (b) the page renders >= 60 product cards via the locked selector within 30-second timeout, AND (c) the response status is either HTTP 2xx OR HTTP 4xx with >= 10 cards (per REQ-006 4xx-with-body extension).

The sitemap is the authoritative URL source; manual enumeration is NOT permitted (Farfetch's catalog taxonomy changes seasonally and sitemap is the canonical reflection).

If any URL in the candidate list fails verification, **THE operator SHALL** either: (1) replace the failed URL with a verified equivalent from the sitemap, OR (2) remove the failed URL with a code comment explaining the removal (e.g., "MEN-Watches l-watches-2 absent from current sitemap as of 2026-MM-DD"). The final committed `categoryUrls` list **SHALL** contain only verified URLs (>= 20 entries minimum, >= 8 Men + >= 8 Women).

Source: research.md §1.1 (robots.txt declares sitemap), §1.4 (sitemap-derived preferred over `?page=N` synthesis).

### REQ-010 [Ubiquitous]

**THE Farfetch engine characterization-test suite at `tests/farfetch-engine.test.ts`** **SHALL** load `tests/fixtures/farfetch-kr-products.fixture.json` (a real captured DOM extraction of approximately 50 to 100 products from one Farfetch KR category landing, captured during Run-phase PRESERVE) and **SHALL** run `parseProductsFromCards` against the fixture with `("https://www.farfetch.com/kr", "farfetch-kr")`. The suite **SHALL** assert that every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, and `price` fields, and that:
- every `imageUrl` matches the locked `FARFETCH_IMAGE_HOSTS` whitelist;
- every `productUrl` matches `FARFETCH_PRODUCT_URL_RE` (canonical `/{designer}/{slug}-item-{id}.aspx` pattern under `/kr/shopping/`);
- every `Product.sourceCurrency === "KRW"`;
- every `Product.priceFormatted` starts with `"₩"`;
- every `Product.price` is a positive KRW integer in sanity range (1,000 ≤ price ≤ 100,000,000);
- every `Product.platform === "farfetch-kr"`;
- every `Product.brand` is a non-empty string (designer name).

The suite **SHALL** also include unit tests for `isSafeFarfetchImageUrl` (whitelisted host accept, non-whitelisted reject), `isSafeFarfetchProductUrl` (canonical pattern accept, malformed reject), `detectChallengeIntercept` (DataDome/Cloudflare body detect, real product page pass), and `deriveGenderFromUrl` (men/women path → "men"/"women", unknown → ""). No new devDependency **SHALL** be added (`node:test` reused). The test suite **SHALL NOT** attempt to test the Playwright lifecycle (browser launch, navigation, DOM evaluation); that surface is smoke-tested only via live `--probe` invocation per REQ-004.

Source: SPEC-001 REQ-006 fixture pattern; SPEC-005 REQ-010 parameterized fixture pattern; SPEC-003/004 ToS-engine-specific assertions.

### REQ-011 [Unwanted Behavior]

**IF** any assertion in REQ-010's characterization suite fails, **THEN THE test runner SHALL** fail the entire suite with a non-zero exit code, and the CI gate / `pnpm test` invocation **SHALL** block any subsequent commit or production deployment.

Source: SPEC-002 REQ-008 (fixture parity is the binding mitigation).

## Files Affected

| File | Action | Est. LOC | Purpose |
|---|---|---|---|
| `src/lib/farfetch-engine.ts` | NEW | ~500 | Playwright + DOM-scrape engine. Top-of-file ToS comment block (verbatim Korean clauses captured at REQ-008). Public API: `crawlFarfetch`, `parseProductsFromCards`, `isSafeFarfetchImageUrl`, `isSafeFarfetchProductUrl`, `detectChallengeIntercept`, `deriveGenderFromUrl`, `pickFarfetchUserAgent`. |
| `src/lib/types.ts` | MODIFY | ~1 | Extend `PlatformType` union with `"farfetch"`. |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append new `farfetch-kr` SiteConfig entry: `key`, `name`, `type: "farfetch"`, `baseUrl: "https://www.farfetch.com/kr"`, `region: "KR"`, `sourceCurrency: "KRW"`, `crawlDelay: 3000`, hardcoded `categoryUrls` (~30 sitemap-verified URLs from REQ-009), `notes` documenting REQ-007/008/009 verified results. |
| `src/crawl.ts` | MODIFY | ~5 | New dispatch case for `type === "farfetch"` routing to `crawlFarfetch`. Probe handler extends to farfetch with `detectChallengeIntercept`. |
| `src/import-products.ts` | NO CHANGE | 0 | KRW-native cache; SPEC-002 hook is no-op. |
| `src/lib/fx.ts` | NO CHANGE | 0 | KRW-native, no FX entry needed. |
| `src/lib/robots-check.ts` | NO CHANGE | 0 | Region-agnostic, single global `robots.txt`. |
| `tests/fixtures/farfetch-kr-products.fixture.json` | NEW | ~150 | Frozen DOM extraction snapshot from one real Farfetch KR category page (~50-100 products), captured during Run-phase PRESERVE. |
| `tests/farfetch-engine.test.ts` | NEW | ~250 | Characterization tests. Parameterized fixture-based assertions per REQ-010. Unit tests for all helper functions. |
| `.moai/project/structure.md` | MODIFY | ~5 | Add `farfetch-kr` row to platform table (38 total). Document Farfetch DOM-scrape pattern in engine-layering subsection. |
| `package.json` | NO CHANGE | 0 | Playwright already in deps. `node:test` already configured. No new deps. |

Total estimated LOC delta: **~941** (NEW: 900; MODIFY: 41).

## Acceptance References

Detailed Given-When-Then acceptance scenarios are documented in `.moai/specs/SPEC-PLATFORM-EXPANSION-006/acceptance.md`. The acceptance suite contains 12 scenarios mapping to REQ-001 through REQ-011, with AC-9 (REQ-007 multi-nav stability), AC-10 (REQ-008 Korean ToS verification), and AC-11 (REQ-009 sitemap-derived URL-list verification) being the three HARD preconditions for engine activation.

## Risks

Three primary risks are tracked here for visibility throughout the Run phase. Mitigations are described in research.md §4 and will be implemented as part of the engine code or operator process.

- **DataDome / anti-bot escalation at scale (50+ navigations)** — Likelihood: Medium, Impact: High. Recon's 5/6 multi-nav success at 2.5-sec pacing is promising but does NOT extend to a full 30+ category crawl. Mitigation: REQ-007 makes 8+ multi-nav stability a HARD precondition with 3+ sec pacing. Rollback paths: tighter pacing, per-category browser reset, deferral, reduced URL set. NO fingerprint-evasion library as compensation.
- **Farfetch KR ToS contains anti-scraping clause naming "크롤러" verbatim (analogous to 29CM)** — Likelihood: Unknown, Impact: Critical (de-facto deferral). Mitigation: REQ-008 makes Run-phase Korean ToS verification with bilingual keyword scan a HARD precondition. Verbatim Korean clauses embedded as audit evidence. If FORBIDS, set `disabled: true` and escalate per HARD rule #1 (with OWNER OVERRIDE pattern available analogous to SPEC-004).
- **Card selector drifts after Farfetch seasonal redesign** — Likelihood: Medium, Impact: Medium. Mitigation: parameterized characterization fixture (REQ-010) catches drift on `pnpm test`. Selector chain has 3 fallback candidates per research.md §3.1. Refresh fixture per major season change OR when test failures surface.

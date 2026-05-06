# Acceptance Criteria: SPEC-PLATFORM-EXPANSION-005

This document defines Given-When-Then acceptance scenarios for SPEC-PLATFORM-EXPANSION-005 (ZARA US Storefront via Region-Parameterized Engine). Each scenario is mapped to one or more EARS requirements from `spec.md` and includes a concrete verification method.

This SPEC inherits acceptance scenarios from SPEC-PLATFORM-EXPANSION-001 for the rate-limit, dry-run, robots-check, abort-on-error, characterization-test, and `--rate=N` override behaviors; from SPEC-PLATFORM-EXPANSION-002 for the region-parameterization, FX-module, USD-at-import-time, and parameterized-fixture behaviors; from SPEC-PLATFORM-EXPANSION-003 for the Playwright lifecycle, `channel: "chrome"` Akamai bypass, XHR-interception, image-host whitelist, ToS clause embedding contract, and bm-verify-intercept detection. Those parent SPEC ACs are NOT re-stated here. The scenarios below are SPEC-005-specific deltas covering: (1) the ZARA engine region-parameterization refactor with KR behavior preserved bit-for-bit, (2) the new `zara-us` SiteConfig entry registration, (3) the parameterized characterization fixture (KR + US), (4) the Run-phase HARD precondition gates for Akamai bypass / ToS verification / live URL-list verification specific to US.

Verification methods used in this document:

- **Unit test against fixture**: Runs as part of the `node:test` suite (`pnpm test`). Uses the frozen `tests/fixtures/zara-products.fixture.json` (KR) and `tests/fixtures/zara-us-products.fixture.json` (US) as inputs. Deterministic, repeatable.
- **Integration test with `--probe`**: Runs `pnpm crawl --probe=zara-us` (or `--probe=zara-kr`) against the live ZARA site. Non-deterministic (depends on live Akamai posture). Run manually before production cut-in.
- **Live integration test**: Runs `pnpm crawl --site=zara-us` end-to-end against the live ZARA US site, writing `data/zara-us-products.json`. Run manually; non-deterministic.
- **Manual verification**: A one-time check by the operator inspecting command output, file existence, browser-displayed ToS clause, etc. Not part of automated CI.
- **Run-phase precondition gate**: A check performed during `/moai run` that BLOCKS the engine from being activated for US if the gate fails. AC-9, AC-10, AC-11 are precondition gates.

---

## AC-1: ZARA US platform registers and dispatches to the region-aware engine

**Maps to**: REQ-001, REQ-002

**Given**:

- The `zara-us` SiteConfig entry exists in `src/configs/platforms.ts` with `key: "zara-us"`, `name: "자라 (US)"`, `type: "zara"`, `baseUrl: "https://www.zara.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 2000`, and a non-empty hardcoded `categoryUrls: string[]` listing exactly 18 Women + Men L2 category landing-page URL paths from research.md §1.5 (10 Women: woman-new-in-l1180, woman-outerwear-l1184, woman-jackets-l1114, woman-knitwear-l1152, woman-shirts-l1217, woman-tshirts-l1362, woman-trousers-l1335, woman-jeans-l1119, woman-dresses-l1066, woman-skirts-l1299; 8 Men: man-new-in-l711, man-outerwear-l715, man-jackets-l640, man-knitwear-l681, man-shirts-l737, man-tshirts-l855, man-trousers-l838, man-jeans-l659).
- The existing `zara-kr` SiteConfig entry has been updated to set `region: "KR"` explicitly.
- `PlatformType` in `src/lib/types.ts:53` is unchanged from SPEC-003 (`"cafe24" | "shopify" | "uniqlo" | "zara" | "29cm"`).
- `SiteConfig.region?: "KR" | "US"` field's JSDoc has been expanded to bind to BOTH `type === "uniqlo"` AND `type === "zara"`. Schema unchanged.
- The `zara-us` SiteConfig entry does NOT include `apiCategoryPaths` (reserved for Uniqlo) or `apiCategoryCodes` (reserved for 29CM).

**When**:

- The user runs `pnpm crawl --site=zara-us` (or any invocation that loads the registered platforms).

**Then**:

- The `runCrawl` function in `src/crawl.ts` partitions the SiteConfig and routes the entry to `crawlZara` (the same engine entry function used for `zara-kr`). Neither `crawlShopify`, `crawlCafe24`, `crawlUniqlo`, nor `crawl29cm` is invoked for the `zara-us` key.
- The `crawlZara` function reads `config.region === "US"` and configures the Playwright context with `locale: "en-US"`, `timezoneId: "America/New_York"`. KR invocations continue to use `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`.
- The `pnpm crawl --list` output includes a row for `zara-us` with type `zara`. Total platform count is 37.

**Verification**:

- Manual verification via `pnpm crawl --list` showing the new `zara-us` row, the existing `zara-kr` row, and total count of 37.
- Unit test against fixture: assert that `getPlatformsByType("zara")` returns exactly two entries (`zara-kr` and `zara-us`); assert the `zara-us` entry's fields match REQ-001 spec; assert the `zara-kr` entry's `region` field equals `"KR"`.

---

## AC-2: parseProductsFromXhr emits Product[] from KR fixture (region preserved)

**Maps to**: REQ-002, REQ-010 (KR side)

**Given**:

- The frozen fixture at `tests/fixtures/zara-products.fixture.json` (the existing KR fixture from SPEC-003) contains the intercepted XHR JSON payload (~50-100 product entries) captured during SPEC-003 Run-phase from a real ZARA KR category landing page.
- The pure parse function `parseProductsFromXhr` is exported from `src/lib/zara-engine.ts` post-SPEC-005 refactor with region-aware signature (e.g., `parseProductsFromXhr(json, baseUrl, platformKey, region, sourceCurrency)`).

**When**:

- The user runs `pnpm test`. The `node:test` suite loads the fixture and invokes `parseProductsFromXhr` with `(fixture, "https://www.zara.com/kr/ko", "zara-kr", "KR", "KRW")`.

**Then**:

- The returned `Product[]` array is **bit-for-bit identical** to what SPEC-003's pre-refactor engine produced (asserted by the existing SPEC-003 test assertions, all of which continue to pass without modification).
- Every emitted `Product` has `priceFormatted` starting with `"₩"` (KR Korean Won symbol).
- Every emitted `Product` has `sourceCurrency: "KRW"`.
- Every emitted `Product` has `productUrl` starting with `https://www.zara.com/kr/ko/` and ending with `-p\d+\.html`.
- Every emitted `Product` has `price` as a positive KRW integer (sanity range 5,000 ≤ price ≤ 5,000,000).
- Every `imageUrl` matches `ZARA_IMAGE_HOSTS` whitelist (`static.zara.net`, `static-images.zara.net`).
- Every `Product.platform === "zara-kr"`.

**Verification**:

- Unit test against fixture: `pnpm test` runs the suite. Existing SPEC-003 assertions on the KR fixture pass without modification (regression check — refactor preserved KR behavior bit-for-bit).

---

## AC-3: parseProductsFromXhr emits Product[] from US fixture (USD-decimal, en-US format)

**Maps to**: REQ-002, REQ-003, REQ-010 (US side)

**Given**:

- The frozen fixture at `tests/fixtures/zara-us-products.fixture.json` contains the intercepted XHR JSON payload (~50-100 product entries) captured during the Run-phase PRESERVE step from a real ZARA US category landing page (e.g., `/us/en/woman-new-in-l1180.html`).
- The pure parse function `parseProductsFromXhr` is exported from `src/lib/zara-engine.ts`.

**When**:

- The user runs `pnpm test`. The `node:test` suite loads the fixture and invokes `parseProductsFromXhr` with `(fixture, "https://www.zara.com/us/en", "zara-us", "US", "USD")`.

**Then**:

- The returned `Product[]` array length matches the fixture's product count (no silent truncation, no defensive zero-result fallback).
- Every emitted `Product` has populated `name` (non-empty string), `imageUrl` (non-empty string), `productUrl` (starts with `https://www.zara.com/us/en/` AND ends with `-p\d+\.html`), and `price` (positive USD decimal value, sanity range 0.01 ≤ price ≤ 50,000).
- Every `imageUrl` value matches the shared `ZARA_IMAGE_HOSTS` whitelist (`static.zara.net`, `static-images.zara.net`) — region-agnostic.
- Every emitted `Product` has `sourceCurrency: "USD"` and `platform: "zara-us"`.
- Every emitted `Product` has `priceFormatted` starting with `"$"` (US dollar sign — NOT `"₩"`).
- Every emitted `Product` has a populated `gender` array (e.g., `["women"]` for URLs containing `/us/en/woman-...`, `["men"]` for `/us/en/man-...`) — derived from URL path by the region-agnostic `deriveGenderFromUrl` regex post-refactor.

**Verification**:

- Unit test against fixture: `pnpm test` runs the suite. All US-fixture assertions pass.

---

## AC-4: formatZaraPrice helper unit tests (region-aware)

**Maps to**: REQ-002, REQ-010

**Given**:

- The helper function `formatZaraPrice(price: number, region: "KR" | "US"): string` is exported from `src/lib/zara-engine.ts` post-SPEC-005 refactor.

**When**:

- The user runs `pnpm test`. The `node:test` suite invokes:
  - `formatZaraPrice(19900, "KR")` → expected `"₩19,900"` (or `"₩19900"` depending on `toLocaleString("ko-KR")` output — exact match against KR fixture's existing `priceFormatted` value).
  - `formatZaraPrice(29.9, "US")` → expected `"$29.90"` (using `price.toFixed(2)`).
  - `formatZaraPrice(0, "KR")` → expected `"₩0"` (edge case).
  - `formatZaraPrice(0, "US")` → expected `"$0.00"` (edge case).

**Then**:

- All four assertions pass.
- KR output starts with `"₩"`, US output starts with `"$"`.
- US output ALWAYS contains a decimal point (`.`) followed by exactly 2 digits.
- KR output NEVER contains a decimal point (KRW is integer-valued).

**Verification**:

- Unit test: `pnpm test` runs the helper assertions.

---

## AC-5: Live --probe succeeds against ZARA US (or fails gracefully)

**Maps to**: REQ-004

**Given**:

- The `zara-us` platform is registered.
- The Run-phase REQ-007 Akamai bypass verification has passed for US (AC-9, below).
- The Run-phase REQ-008 ToS verification has passed for US (AC-10, below).
- The Run-phase REQ-009 `categoryUrls` URL-list verification has passed (AC-11, below).
- The `data/zara-us-products.json` file does NOT exist before this scenario runs (precondition: delete the file if it exists, or run in a clean state).

**When**:

- The user runs `pnpm crawl --site=zara-us --dry-run` (or `pnpm crawl --probe=zara-us`).

**Then**:

- The crawler invokes `checkRobots(config.baseUrl)` from `src/lib/robots-check.ts`. The check returns `{allowed: true}` for ZARA US (region-agnostic `robots.txt` already verified for `https://www.zara.com/`).
- The crawler launches Playwright Chromium with `channel: "chrome"`, `headless: true`, and US-region context (UA from rotation list, `locale: "en-US"`, `timezoneId: "America/New_York"`, `viewport: {width: 1440, height: 900}`).
- The crawler navigates to the FIRST URL in `config.categoryUrls` (e.g., `https://www.zara.com/us/en/woman-new-in-l1180.html`) via `page.goto(url, {waitUntil: "domcontentloaded"})`.
- The crawler asserts the page HTML reaches real product DOM: HTML body length > 5,000 bytes AND `detectBmVerifyIntercept` returns `{isIntercept: false}`. If this assertion fails (Akamai intercept appeared), the probe exits with an error message identifying the platform key, the URL, and a count of bytes received.
- A sample product summary is printed to stdout, including at minimum the keys `name`, `price`, `productUrl`, `imageUrl` for the first product card extracted. The `price` value displays as a USD decimal (e.g., `29.9`) and the `productUrl` starts with `https://www.zara.com/us/en/`.
- The file `data/zara-us-products.json` is NOT created. Filesystem state of the `data/` directory is unchanged from before the invocation.
- Browser is closed in a `finally` block (verified by no orphaned Chromium process remaining after the command exits).

**Verification**:

- Integration test with `--probe`: Run the command in a clean state, capture stdout, assert success exit code AND `data/zara-us-products.json` does not exist after exit. Acceptable failure mode: if Akamai escalates and the probe exits with a clear error message, that is also a passing case (graceful failure is the design).

---

## AC-6: Live full crawl writes JSON cache file with USD-decimal prices

**Maps to**: REQ-003

**Given**:

- The `zara-us` platform is registered and AC-1 through AC-5 pass.
- The live ZARA US site is reachable (no global Akamai escalation in effect).

**When**:

- The user runs `pnpm crawl --site=zara-us` (no `--dry-run` flag).

**Then**:

- For each URL in `config.categoryUrls`:
  - Playwright navigates to the URL via `page.goto`.
  - The XHR `page.on("response")` listener captures the first JSON matching `/\/category\/\d+\/products\?ajax=true/` (region-agnostic).
  - The product-card selector chain resolves within 15 seconds.
  - Products are extracted via `parseProductsFromXhr` with `region: "US"` and `sourceCurrency: "USD"`.
  - 2 sec pacing applies between category iterations.
- After all categories are processed, the crawler writes `data/zara-us-products.json` containing the aggregated `Product[]` array.
- The file contains ≥100 products with non-null `name`, `price`, `productUrl`, `imageUrl` fields.
- Every product has `platform: "zara-us"` and `sourceCurrency: "USD"`.
- Every `Product.price` is a positive USD decimal (e.g., `29.9`, `49.95`) — NOT an integer KRW value.
- Every `Product.priceFormatted` starts with `"$"`.
- Every `Product.productUrl` starts with `https://www.zara.com/us/en/` and matches the region-aware productUrl regex.
- The `errors` array is empty for ≥80% of categories (residual ≤20% allowed for transient Akamai escalations or stale URLs; if >20%, AC-6 fails and the engine is treated as broken — see plan.md §7).

**Verification**:

- Live integration test: Run `pnpm crawl --site=zara-us`, hand-inspect `data/zara-us-products.json` for ≥100 products with populated required fields and USD-decimal prices.
- Live integration test: Inspect the printed stats summary at command exit; confirm `inStock` count > 0, `uniqueBrands` ≥ 1 (likely just `"ZARA"`), `errors.length` ≤ 0.2 × `categoryUrls.length`.

---

## AC-7: USD→KRW conversion at import time (post-SPEC-002 hook)

**Maps to**: REQ-003 (cache stores USD); inherited from SPEC-002 REQ-004

**Given**:

- `data/zara-us-products.json` has been produced by AC-6 with USD-decimal `price` values and `sourceCurrency: "USD"`.
- `src/lib/fx.ts` has `FX_TO_KRW.USD = 1430` populated (SPEC-002 baseline, no change).
- `src/import-products.ts` post-SPEC-002 has the `convertToKrw` hook that fires for any `Product.sourceCurrency !== "KRW"`.

**When**:

- The user runs `pnpm tsx src/import-products.ts` (or equivalent import command), pointing at the ZARA US cache file.

**Then**:

- For each product in the cache:
  - The import script reads `product.price` (USD decimal, e.g., `29.9`) and `product.sourceCurrency` (`"USD"`).
  - The import script invokes `convertToKrw(product.price, "USD")` from `src/lib/fx.ts`, which returns `Math.round(29.9 * 1430) === 42757` (or analogous for other prices).
  - The Supabase upsert payload has `price: 42757` (KRW integer), NOT `price: 29.9` (USD decimal).
  - If `product.originalPrice` is non-null, it receives the same conversion treatment.
  - The on-disk cache file `data/zara-us-products.json` is NOT modified — the `product.price` value remains `29.9` for the next conversion.
- The Supabase `products` table row for that ZARA US product has `price` stored as a KRW integer (consistent with all other platforms).

**Verification**:

- Live integration test: Run the import script; spot-check 5 Supabase rows from the ZARA US import to confirm `products.price` values are KRW integers in plausible ranges (e.g., for a $30 USD ZARA item, the KRW value should be ~42,900).
- Cache integrity check: After the import, re-read `data/zara-us-products.json` and confirm `product.price` values are still USD decimals (post-import file is unchanged). Pass condition: pre-import and post-import file MD5 hashes are identical.

---

## AC-8: ZARA engine respects --rate=N flag (region-agnostic)

**Maps to**: SPEC-001 REQ-007 (reused), SPEC-003 AC-8 (extended to US)

**Given**:

- The `zara-us` platform is registered with default `crawlDelay: 2000` (2 sec/page baseline).
- SPEC-001 introduced `parseRateFlag` which validates `--rate=N` against the rate-cap policy (1 ≤ N ≤ 5; integer).

**When**:

- The user runs `pnpm crawl --site=zara-us --rate=2`.

**Then**:

- The crawler computes per-request delay as `1000 / 2 = 500ms`.
- Note: ZARA US's actual elapsed time per category is dominated by Playwright browser overhead (page.goto + scroll + extract typically takes 5-15 seconds), so the `--rate=N` override has limited effect for ZARA US — the override sets the inter-category pacing floor, not the per-category execution time. This is a documented difference from Uniqlo (where the engine is fetch-bound and `--rate=N` directly controls request frequency). Mirrors SPEC-003 AC-8 verbatim for KR.
- If the user runs `--rate=10` (above rate-cap), the command is rejected at parse time with a clear error message and exit code 1. No browser is launched.

**Verification**:

- Manual verification: Run `pnpm crawl --site=zara-us --rate=2 --dry-run` and confirm the printed `crawlDelay` reflects 500ms.
- Unit test against fixture: Re-use the SPEC-001 `parseRateFlag` rejection tests for `--rate=10`, `--rate=0`, `--rate=-1`, `--rate=2.5`, `--rate=abc`. No ZARA-US-specific test addition.

---

## AC-9: Akamai bypass verification for US (Run-phase HARD precondition)

**Maps to**: REQ-007

**Given**:

- The Run phase ANALYZE step is in progress.
- No `zara-us` SiteConfig entry has been committed yet (or the entry exists with `disabled: true` placeholder).
- `src/lib/zara-engine.ts` may or may not be refactored at this point; the verification is engine-agnostic (operator scratch script).
- KR's pre-verification (SPEC-003 Run-phase 5/5 success) is documented but NOT considered authoritative for US per REQ-007.

**When**:

- The operator launches Playwright Chromium with `chromium.launch({ channel: "chrome", headless: true })`, creates a context with `locale: "en-US"`, `timezoneId: "America/New_York"`, `viewport: {width: 1440, height: 900}`, and a UA from the `ZARA_USER_AGENTS` rotation list, then navigates 5 sequential times (with 2 sec pacing between attempts) to `https://www.zara.com/us/en/woman-new-in-l1180.html` from a single Playwright session. The `page.on("response")` listener with `XHR_URL_RE = /\/category\/\d+\/products\?ajax=true/` is installed before each navigation.

**Then**:

- For each of the 5 attempts: the page DOM reaches a state where `document.querySelectorAll(".product-grid-product, [data-productid]").length >= 10` within a 30-second timeout, AND at least one XHR matching `XHR_URL_RE` is captured by `page.on("response")` within 15 seconds of `page.goto`.
- This must occur on at least 4 of the 5 sequential `page.goto` invocations (≥80% reliability).
- If reliability is below 80%, the operator MUST invoke a rollback path:
  - Rollback path 1: Tighten US-specific browser context (e.g., add explicit `Accept-Language: en-US,en;q=0.9` header, verify system Chrome resolves correctly, retry with same 5x probe).
  - Rollback path 2: Defer ZARA US — set `disabled: true` on the new `zara-us` SiteConfig entry (or do not commit the entry at all), abandon the engine activation, notify the project owner. The engine refactor remains in place because it does not change KR behavior.
  - Rollback path 3: Open a separate SPEC to introduce Xvfb-in-CI for `headless: false` mode. SPEC-005 is paused until the new SPEC is approved.
- The operator MUST NOT introduce a fingerprint-evasion library or otherwise circumvent project HARD rules to compensate for an insufficient `channel: "chrome"` pass rate.
- KR's verification CANNOT be substituted for US verification — Akamai posture is operator-tunable per region and Inditex configuration could differ.
- If reliability is at or above 80%, the engine is cleared for US activation.

**Verification**:

- Run-phase precondition gate: A scratch script (NOT committed; ephemeral) executes the 5 sequential `page.goto` calls and prints pass/fail per attempt (DOM check + XHR capture check). The operator inspects the output and decides to proceed or escalate.
- Manual verification: A short markdown note at the bottom of `src/lib/zara-engine.ts` (or in `.moai/specs/SPEC-PLATFORM-EXPANSION-005/run-notes.md` if created) documents the verification result: "ZARA US Akamai bypass verification 2026-MM-DD: 4/5 (or 5/5) passes. Engine cleared for US activation."

---

## AC-10: ZARA US ToS verification (Run-phase HARD precondition)

**Maps to**: REQ-008

**Given**:

- The Run phase ANALYZE step is in progress.
- AC-9 (Akamai bypass for US) has passed.
- `src/lib/zara-engine.ts` top-of-file ToS comment block currently contains only the KR Korean clauses from SPEC-003 v0.2.0; US English clauses have not been added yet.
- Plan-phase research.md §1.2 documented the canonical PDF as NOT discoverable (404 on `static.zara.net/static/pdfs/US/...`); the SPA shell at `/us/en/help-center/legal/terms-of-use` requires Playwright-driven hydration.

**When**:

- The operator opens `https://www.zara.com/us/en/help-center/legal/terms-of-use` in a real Playwright browser session (with `channel: "chrome"`, US context options). If the direct URL returns the 404 SPA shell, the operator falls back to navigating via the `/us/en` homepage footer link to the ToS page.
- The operator waits for the SPA to fully hydrate (e.g., wait for body length > 50KB, OR wait for a recognizable ToS heading like "Terms of Use" or "Conditions").
- The operator captures the rendered English ToS body text via `page.evaluate(() => document.body.innerText)`.
- The operator scans the text for keywords: `crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `agent`, `automated access`, `data mining`, `screen scraping`, `AI training`, `machine learning`.

**Then**:

- The operator identifies all clauses referencing automation, IP rights, content use, or related terms.
- The operator embeds the verbatim relevant English clauses as a comment block at the top of `src/lib/zara-engine.ts` (alongside the existing KR Korean clauses, NOT replacing them) for permanent audit record. The block contains:
  - Verbatim English clause text for each relevant clause (NO paraphrase, NO summary, NO translation).
  - Capture date and operator name (e.g., `2026-MM-DD by hansangho`).
  - Source URL (the actual landing page captured, since `/help-center/legal/terms-of-use` may return 404 and fallback was used).
  - Verdict label (one of: `PERMITS`, `AMBIGUOUS-ACCEPTED-BY-OWNER`, `AMBIGUOUS-REJECTED`, `FORBIDS`).
  - SPEC-005 cross-reference.
  - One-line summary of residual-risk conditions: portal.ai-internal-use only; halt-on-cease-and-desist; re-verify on ToS publication-date change OR Inditex USA, Inc. communication OR > 90 days elapsed.
- If the captured text contains ANY clause that unambiguously forbids automated catalog access, web scraping, or the use of crawler/bot/automation tools (e.g., a clause naming "no scraping," "no crawler," "no automated access," "no data harvesting"), the operator:
  - Sets `disabled: true` on the `zara-us` SiteConfig entry (or does not commit the entry with `disabled: false`).
  - Abandons the US engine activation. The engine refactor itself remains in place because it does not affect KR.
  - Escalates to project owner with the verbatim forbidding clause and a recommendation for a B2B partner-API conversation with Inditex USA, Inc.
- If the captured text contains ambiguous clauses (e.g., IP rights clauses that technically restrict content use without naming automation specifically — analogous to ZARA KR's §15), the operator classifies the verdict as AMBIGUOUS-ACCEPTED-BY-OWNER and proceeds, OR escalates to project owner if the residual risk is qualitatively higher than ZARA KR's §15.
- ZARA US ToS is **independent** of ZARA KR ToS — the KR pre-verification (SPEC-003 v0.2.0 §15 IP rights AMBIGUOUS-ACCEPTED-BY-OWNER) CANNOT substitute for US.

**Verification**:

- Run-phase precondition gate: A reader of `src/lib/zara-engine.ts` post-Run-phase can identify within 60 seconds: (a) the verbatim English US clauses are present alongside the existing Korean KR clauses, (b) capture date, operator, and source URL, (c) verdict label, (d) the residual-risk conditions.
- Verification of clause text: Re-fetching the source URL in a Playwright session and diffing against the embedded text yields zero textual differences for the quoted clauses.
- The `zara-us` SiteConfig entry has `disabled: false` (engine ships live for US, per AMBIGUOUS-ACCEPTED-BY-OWNER or PERMITS verdict) OR `disabled: true` (engine ships shelved for US, per FORBIDS or AMBIGUOUS-REJECTED verdict). Either disposition is acceptable for SPEC-005 completion as long as the verdict and disposition are aligned per REQ-008.

---

## AC-11: categoryUrls live verification for US (Run-phase HARD precondition)

**Maps to**: REQ-009

**Given**:

- The Run phase ANALYZE step is in progress.
- AC-9 (Akamai bypass for US) has passed.
- The proposed 18-entry US `categoryUrls` list from research.md §1.5 / spec.md REQ-001 is staged in `src/configs/platforms.ts` (or in a scratch SiteConfig).
- Research.md §1.5 documented 5+ verified KR-to-US L-code collisions (woman-coats-l1184 redirect, woman-jackets-l1185 not exist on US, woman-tshirts-l1180 collision, man-jackets-l717 not exist, man-jeans-l710 not exist).

**When**:

- The operator launches Playwright with `channel: "chrome"` + US context, and for each of the 18 URLs in the proposed `categoryUrls`:
  - Navigates via `page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000})`.
  - Asserts that the final URL (after any 301 redirect) is NOT `/us/en/` homepage and NOT a `/us/en/*-mkt*.html` marketing page.
  - Asserts that `document.querySelectorAll(".product-grid-product, [data-productid]").length >= 10` within 30 seconds.
  - Asserts that at least one XHR matching `XHR_URL_RE = /\/category\/\d+\/products\?ajax=true/` is captured by `page.on("response")` within 15 seconds.

**Then**:

- All 18 URLs pass all three assertions, OR each failed URL is documented with: (a) the failure mode (redirect target, selector count, no XHR), and (b) a replacement URL from `https://www.zara.com/sitemaps/sitemap-category-us-en.xml.gz` OR a removal decision with code comment in `src/configs/platforms.ts` (e.g., `// WOMAN-Sweatshirts l1320 absent from sitemap as of 2026-MM-DD — removed`).
- After replacements/removals, the final committed `categoryUrls` list contains only verified URLs (≥10 entries minimum, ≥4 Women + ≥4 Men).
- The list MUST NOT contain any URL that redirects to homepage / marketing OR returns < 10 product cards.

**Verification**:

- Run-phase precondition gate: A scratch script enumerates the 18 URLs and prints pass/fail per URL with assertion details. The operator inspects the output and either applies replacements or commits the list as-is.
- Manual verification: After the final list is committed, a manual `pnpm crawl --probe=zara-us` (which probes the FIRST URL only) succeeds.
- Documentation: Any URL replacement or removal is captured in a code comment adjacent to the affected entry in `src/configs/platforms.ts`, citing the verification date.

---

## AC-12: Parameterized characterization fixture pass (KR + US)

**Maps to**: REQ-010, REQ-011

**Given**:

- Both fixtures exist:
  - `tests/fixtures/zara-products.fixture.json` (KR, frozen by SPEC-003)
  - `tests/fixtures/zara-us-products.fixture.json` (US, frozen by Run-phase PRESERVE step of SPEC-005)
- The test file `tests/zara-engine.test.ts` has been parameterized to load both fixtures and run region-aware assertions.

**When**:

- The user runs `pnpm test`.

**Then**:

- The test runner loads both fixtures.
- Parameterized assertions run for both fixtures with appropriate `(baseUrl, region, sourceCurrency)` triples:
  - KR: `("https://www.zara.com/kr/ko", "KR", "KRW")`
  - US: `("https://www.zara.com/us/en", "US", "USD")`
- Shared assertions (both fixtures) pass:
  - Every `Product` has populated `name`, `imageUrl`, `productUrl`, `price`.
  - Every `imageUrl` matches `ZARA_IMAGE_HOSTS` whitelist.
  - Every `productUrl` matches the region-prefix regex `/^https:\/\/www\.zara\.com\/{region}\/{lang}\/[^"'\s]+-p\d+\.html$/`.
- KR-specific assertions pass: `priceFormatted` starts with `"₩"`; `sourceCurrency === "KRW"`; `price` is positive integer in 5,000–5,000,000 range.
- US-specific assertions pass: `priceFormatted` starts with `"$"`; `sourceCurrency === "USD"`; `price` is positive decimal in 0.01–50,000 range.
- Helper unit tests (AC-4) pass.
- Test suite exit code is 0.
- If any assertion fails on either fixture, the entire suite fails with exit code 1 (per REQ-011) and the CI gate / `pnpm test` invocation blocks any subsequent commit. The engine is NOT split into separate KR/US modules in response to a fixture failure (per REQ-011 verbatim).

**Verification**:

- Unit test against fixture: `pnpm test` runs the suite. All KR + US assertions pass.

---

## Definition of Done

This SPEC is considered complete when ALL of the following are true:

- All 12 acceptance criteria above (AC-1 through AC-12) pass their stated verification methods.
- All SPEC-001 AC-1 through AC-7 still pass (no regression to Uniqlo behavior).
- All SPEC-002 AC-1 through AC-8 still pass (no regression to Uniqlo region pattern, FX module, or import-time conversion).
- All SPEC-003 AC-1 through AC-10 still pass (no regression to ZARA KR behavior; the engine refactor preserved KR bit-for-bit).
- All SPEC-004 AC-1 through AC-10 still pass (no regression to 29CM KR behavior).
- `pnpm typecheck` (`tsc --noEmit`) reports zero errors.
- `pnpm test` (the existing `node:test` suite plus the parameterized `tests/zara-engine.test.ts`) reports zero failures across both KR and US fixtures.
- A live `pnpm crawl --probe=zara-us --dry-run` invocation succeeds, reaches real product DOM (NOT bm-verify intercept), and prints a valid sample product with USD-decimal price.
- A live `pnpm crawl --site=zara-us` invocation succeeds, writes `data/zara-us-products.json`, and the file contains ≥100 products with non-null required fields, USD-decimal `price`, and `sourceCurrency: "USD"`. `CrawlResult.errors.length` is ≤20% of `categoryUrls.length`.
- A live `pnpm tsx src/import-products.ts` invocation against the ZARA US cache file succeeds, and 5 spot-checked Supabase rows have `price` stored as KRW integers (USD * 1430 from `FX_TO_KRW`).
- A live `pnpm crawl --probe=zara-kr` regression check succeeds (KR engine still works post-refactor).
- `src/lib/zara-engine.ts` contains a top-of-file comment block with: (a) the verbatim Korean KR ToS clauses from SPEC-003 v0.2.0 (preserved), AND (b) the verbatim English US ToS clauses from REQ-008 / AC-10 (newly added), AND both regions' capture dates, operator names, source identifiers, and verdicts.
- `.moai/project/structure.md` is updated to reflect 37 platforms total and to document the ZARA region-parameterization sub-pattern in the engine-layering subsection (mirroring Uniqlo).
- The Run phase has not introduced any new production dependency or devDependency beyond what is in `tech.md` (Playwright is reused; `node:test` is reused; `FX_TO_KRW.USD = 1430` is reused).
- No fingerprint-evasion library has been introduced. No IP rotation, no proxy pool, no CAPTCHA-solving service, no authenticated scraping. Project HARD rules preserved.
- The `zara-us` SiteConfig entry is appropriately set: `disabled: false` if AC-9, AC-10, AC-11 all passed; `disabled: true` if AC-10 verdict was FORBIDS or if AC-9 / AC-11 failed AND the operator elected the deferral rollback path. Either disposition is acceptable for SPEC-005 completion as long as the engine refactor itself ships clean (KR behavior preserved bit-for-bit).
- The `zara-kr` SiteConfig entry has `region: "KR"` set explicitly.
- KR fixture (`tests/fixtures/zara-products.fixture.json`) is unchanged from SPEC-003 (no modification, no refresh).
- US fixture (`tests/fixtures/zara-us-products.fixture.json`) is committed and frozen.

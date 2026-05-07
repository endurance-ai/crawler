# Acceptance Criteria: SPEC-PLATFORM-EXPANSION-006

This document defines Given-When-Then acceptance scenarios for SPEC-PLATFORM-EXPANSION-006 (Farfetch KR luxury multi-brand crawler). Each scenario is mapped to one or more EARS requirements from `spec.md`.

This SPEC inherits acceptance scenarios from SPEC-001 (rate-limit, dry-run, robots-check, abort-on-error, characterization-test, `--rate=N` override), SPEC-003 (Playwright lifecycle, `channel:"chrome"` Akamai bypass, image-host whitelist, ToS verbatim contract), SPEC-004 (live ToS capture, OWNER OVERRIDE pattern), SPEC-005 (Run-phase HARD gate REQ-007/008/009 pattern). Parent SPEC ACs are NOT re-stated. The scenarios below are SPEC-006-specific deltas covering: (1) Farfetch DOM-scrape engine, (2) `farfetch-kr` SiteConfig registration, (3) characterization fixture, (4) Run-phase HARD precondition gates (multi-nav stability / Korean ToS / sitemap-derived URL list).

Verification methods used:

- **Unit test against fixture**: Runs as part of `pnpm test`. Uses frozen `tests/fixtures/farfetch-kr-products.fixture.json`. Deterministic.
- **Integration test with `--probe`**: Runs `pnpm crawl --probe=farfetch-kr` against live Farfetch KR. Non-deterministic.
- **Live integration test**: Runs `pnpm crawl --site=farfetch-kr` end-to-end, writing `data/farfetch-kr-products.json`. Non-deterministic.
- **Manual verification**: One-time operator inspection.
- **Run-phase precondition gate**: BLOCKS engine activation if gate fails. AC-9, AC-10, AC-11.

---

## AC-1: Farfetch KR platform registers and dispatches to the new engine

**Maps to**: REQ-001, REQ-002

**Given**:
- The `farfetch-kr` SiteConfig entry exists in `src/configs/platforms.ts` with `key: "farfetch-kr"`, `name: "파페치 (KR)"`, `type: "farfetch"`, `baseUrl: "https://www.farfetch.com/kr"`, `region: "KR"`, `sourceCurrency: "KRW"`, `crawlDelay: 3000`, and a non-empty hardcoded `categoryUrls: string[]` (≥20 entries, ≥8 Men + ≥8 Women, all from the verified sitemap-derived list per REQ-009).
- `PlatformType` in `src/lib/types.ts` includes `"farfetch"` in the union.
- The `farfetch-kr` SiteConfig entry does NOT include `apiCategoryPaths` (Uniqlo-only) or `apiCategoryCodes` (29CM-only).

**When**:
- The user runs `pnpm crawl --site=farfetch-kr` (or any invocation that loads the registered platforms).

**Then**:
- The `runCrawl` function in `src/crawl.ts` partitions the SiteConfig and routes the entry to `crawlFarfetch`. Neither `crawlShopify`, `crawlCafe24`, `crawlUniqlo`, `crawlZara`, nor `crawl29cm` is invoked for the `farfetch-kr` key.
- `crawlFarfetch` launches Playwright Chromium with `channel:"chrome"` and 5-UA rotation, server geo-routes KR locale automatically (no client locale override).
- The `pnpm crawl --list` output includes a row for `farfetch-kr` with type `farfetch`. Total platform count is 38.

**Verification**:
- Manual via `pnpm crawl --list`.
- Unit test: assert `getPlatformsByType("farfetch")` returns exactly one entry (`farfetch-kr`) with all fields matching REQ-001.

---

## AC-2: parseProductsFromCards emits Product[] from fixture

**Maps to**: REQ-002, REQ-010

**Given**:
- Frozen fixture at `tests/fixtures/farfetch-kr-products.fixture.json` contains the captured DOM extraction array (~50-100 cards) from one real Farfetch KR category landing.
- Pure parse function `parseProductsFromCards(cards, baseUrl, platformKey)` is exported from `src/lib/farfetch-engine.ts`.

**When**:
- The user runs `pnpm test`. Suite loads fixture and invokes `parseProductsFromCards(fixture, "https://www.farfetch.com/kr", "farfetch-kr")`.

**Then**:
- Returned `Product[]` array length matches fixture's card count (no silent truncation).
- Every emitted `Product` has populated `name` (non-empty string), `imageUrl` (non-empty), `productUrl` (matches canonical pattern), and `price` (positive KRW integer, sanity range 1,000 ≤ price ≤ 100,000,000).
- Every `imageUrl` matches the locked `FARFETCH_IMAGE_HOSTS` whitelist.
- Every `productUrl` matches `FARFETCH_PRODUCT_URL_RE` AND starts with `https://www.farfetch.com/kr/shopping/`.
- Every `Product` has `sourceCurrency: "KRW"`, `platform: "farfetch-kr"`, `priceFormatted` starting with `"₩"`, `brand` non-empty (designer name).
- Every `Product` has populated `gender` array derived via `deriveGenderFromUrl` from the URL.

**Verification**:
- Unit test: `pnpm test` runs the suite. All assertions pass.

---

## AC-3: deriveGenderFromUrl correctly classifies category URLs

**Maps to**: REQ-002

**Given**:
- `deriveGenderFromUrl(url)` is exported from `src/lib/farfetch-engine.ts`.

**When**:
- The user runs `pnpm test`. Suite invokes:
  - `deriveGenderFromUrl("https://www.farfetch.com/kr/shopping/men/clothing-2/items.aspx")` → expected `"men"`
  - `deriveGenderFromUrl("https://www.farfetch.com/kr/shopping/women/items.aspx")` → expected `"women"`
  - `deriveGenderFromUrl("https://www.farfetch.com/kr/shopping/kids/items.aspx")` → expected `"kids"`
  - `deriveGenderFromUrl("https://www.farfetch.com/kr/")` → expected `""`

**Then**:
- All four assertions pass.

**Verification**:
- Unit test: `pnpm test`.

---

## AC-4: isSafeFarfetchImageUrl whitelist + isSafeFarfetchProductUrl regex unit tests

**Maps to**: REQ-002, REQ-010

**Given**:
- `isSafeFarfetchImageUrl(src)` and `isSafeFarfetchProductUrl(url)` are exported from `src/lib/farfetch-engine.ts`.
- `FARFETCH_IMAGE_HOSTS` whitelist locked at PRESERVE step (e.g., `cdn-images.farfetch-contents.com`, `cdn.farfetch.com`).

**When**:
- The user runs `pnpm test`. Suite invokes positive + negative cases.

**Then**:
- `isSafeFarfetchImageUrl("https://cdn-images.farfetch-contents.com/path/to/img.jpg")` → `true` (whitelisted)
- `isSafeFarfetchImageUrl("https://evil.example.com/img.jpg")` → `false`
- `isSafeFarfetchImageUrl("http://cdn-images.farfetch-contents.com/img.jpg")` → `false` (http not https)
- `isSafeFarfetchImageUrl("")` → `false`
- `isSafeFarfetchProductUrl("https://www.farfetch.com/kr/shopping/loewe/puzzle-bag-leather-item-12345678.aspx")` → `true`
- `isSafeFarfetchProductUrl("https://www.farfetch.com/kr/shopping/some-product.aspx")` → `false` (no `-item-{id}`)
- `isSafeFarfetchProductUrl("https://www.farfetch.com/uk/shopping/...item-12345678.aspx")` → `false` (wrong region)
- `isSafeFarfetchProductUrl("https://evil.example.com/loewe/item-12345678.aspx")` → `false`

**Verification**:
- Unit test: `pnpm test`.

---

## AC-5: detectChallengeIntercept correctly identifies DataDome / Cloudflare body

**Maps to**: REQ-006

**Given**:
- `detectChallengeIntercept(html, title)` is exported from `src/lib/farfetch-engine.ts`.

**When**:
- The user runs `pnpm test`. Suite invokes positive + negative cases.

**Then**:
- DataDome body (HTML < 5,000 bytes + title `"Just a moment..."`) → `{isIntercept: true, reason: "challenge"}`.
- Cloudflare body (HTML < 5,000 bytes + title contains `"cf-mitigated"` or `"challenge"`) → `{isIntercept: true}`.
- Real product page (HTML >= 50,000 bytes + valid title) → `{isIntercept: false}`.
- Edge case: long body (>20,000 bytes) that mentions `"datadome"` in analytics scripts → `{isIntercept: false}` (length floor prevents false positive).

**Verification**:
- Unit test: `pnpm test`.

---

## AC-6: Live --probe succeeds against Farfetch KR (or fails gracefully)

**Maps to**: REQ-004

**Given**:
- The `farfetch-kr` platform is registered.
- AC-9, AC-10, AC-11 (Run-phase HARD gates) have all passed.
- `data/farfetch-kr-products.json` does NOT exist before the scenario runs.

**When**:
- The user runs `pnpm crawl --site=farfetch-kr --dry-run` (or `pnpm crawl --probe=farfetch-kr`).

**Then**:
- `checkRobots(config.baseUrl)` returns `{allowed: true}`.
- Playwright launches Chromium with `channel:"chrome"`, headless: true, minimal context options. Server geo-routes to KR locale.
- Navigates to FIRST URL in `config.categoryUrls` (e.g., `/kr/shopping/men/clothing-2/items.aspx`) with `waitUntil: "domcontentloaded"`.
- Asserts page DOM resolves >= 60 product cards via locked selector AND `detectChallengeIntercept` returns `{isIntercept: false}`. If assertion fails, probe exits with clear error message identifying platform key, URL, and observation.
- Sample product summary printed to stdout: at minimum `name`, `brand`, `price`, `productUrl`, `imageUrl` for the first card. `price` displays as KRW integer; `productUrl` starts with `https://www.farfetch.com/kr/shopping/`.
- File `data/farfetch-kr-products.json` is NOT created. Filesystem state of `data/` unchanged.
- Browser closed in `finally` block.

**Verification**:
- Integration test with `--probe`: run command in clean state, capture stdout, assert success exit code AND file absence. Acceptable failure mode: graceful exit with clear error message if Farfetch escalates.

---

## AC-7: Live full crawl writes JSON cache file with KRW-integer prices

**Maps to**: REQ-003

**Given**:
- The `farfetch-kr` platform is registered and AC-1 through AC-6 pass.
- Live Farfetch KR is reachable (no global anti-bot escalation).

**When**:
- The user runs `pnpm crawl --site=farfetch-kr` (no `--dry-run`).

**Then**:
- For each URL in `config.categoryUrls`:
  - Playwright navigates with `page.goto`.
  - Card selector resolves within 30 seconds.
  - Cards extracted via `extractCardsFromDom`, parsed via `parseProductsFromCards` with KR defaults.
  - 3 sec pacing applied between iterations.
- After all categories processed, the crawler writes `data/farfetch-kr-products.json` with the aggregated `Product[]` array.
- File contains >= 1,000 products (broad lower bound) with non-null `name`, `price`, `productUrl`, `imageUrl` fields.
- Every product has `platform: "farfetch-kr"` and `sourceCurrency: "KRW"`.
- Every `Product.price` is a positive KRW integer (1,000 ≤ price ≤ 100,000,000).
- Every `Product.priceFormatted` starts with `"₩"`.
- Every `Product.productUrl` starts with `https://www.farfetch.com/kr/shopping/` and matches the canonical regex.
- `errors` array length ≤ 20% of `categoryUrls.length`.

**Verification**:
- Live integration test: hand-inspect `data/farfetch-kr-products.json` for ≥1,000 products with populated required fields and KRW-integer prices.
- Inspect printed stats summary: `inStock` count > 0, `uniqueBrands` >= 50 (Farfetch carries 2,000+ designers; even a 30-URL crawl should yield 50+ unique designers in catalog), `errors.length` ≤ 0.2 × `categoryUrls.length`.

---

## AC-8: Farfetch engine respects --rate=N flag

**Maps to**: SPEC-001 REQ-007 (reused), SPEC-006 documented

**Given**:
- The `farfetch-kr` platform is registered with default `crawlDelay: 3000`.
- SPEC-001 introduced `parseRateFlag` (1 ≤ N ≤ 5; integer).

**When**:
- The user runs `pnpm crawl --site=farfetch-kr --rate=2`.

**Then**:
- Per-request delay computed as `1000 / 2 = 500ms`.
- Note: Farfetch's actual elapsed time per category is dominated by Playwright browser overhead (page.goto + DOM extraction typically 5-10 seconds), so `--rate=N` override has limited effect — the override sets the inter-category pacing floor, NOT the per-category execution time. Mirrors SPEC-003 AC-8 (ZARA) and SPEC-004 (29CM) verbatim. Documented difference from Uniqlo (fetch-bound).
- If user runs `--rate=10` (above rate-cap), command rejected at parse time with clear error message and exit code 1. No browser launched.

**Verification**:
- Manual: run `pnpm crawl --site=farfetch-kr --rate=2 --dry-run`, confirm printed `crawlDelay` reflects 500ms.
- Unit test: re-use SPEC-001 `parseRateFlag` rejection tests.

---

## AC-9: Multi-navigation stability verification (Run-phase HARD precondition)

**Maps to**: REQ-007

**Given**:
- Run phase ANALYZE step is in progress.
- No `farfetch-kr` SiteConfig entry has been committed yet (or entry exists with `disabled: true` placeholder).
- `src/lib/farfetch-engine.ts` may or may not be implemented; this verification is engine-agnostic (operator scratch script).
- Recon's 5/6 (2026-05-06) at 2.5-sec pacing is documented but NOT considered authoritative.

**When**:
- The operator launches Playwright Chromium with `chromium.launch({channel:"chrome", headless: true})`, creates a context with minimal options (UA from rotation list, viewport 1440x900; NO `locale` or `timezoneId` override — let server geo-route), and navigates 8 sequential URLs (with 3-sec pacing between attempts) drawn from the candidate sitemap-derived list (e.g., Men landing, Women landing, Men/Clothing, Men/Shoes, Men/Bags, Men/Accessories, Women/Clothing, Women/Shoes).

**Then**:
- For each of the 8 attempts: page DOM resolves `document.querySelectorAll(<locked-selector>).length >= 60` within 30-second timeout, AND `detectChallengeIntercept` returns `{isIntercept: false}`.
- This must occur on at least 7 of the 8 sequential `page.goto` invocations (≥87.5% reliability).
- For HTTP responses: 2xx is success; 4xx with cards >= 10 is also success (per REQ-006 4xx-with-body extension); 4xx with cards < 10 OR 5xx OR challenge-intercept body is failure.
- If reliability < 87.5%, operator MUST invoke a rollback path:
  - Tighten pacing (e.g., 5-sec, retry).
  - Per-category browser session reset (launch fresh browser instance per category).
  - Defer Farfetch KR — set `disabled: true`, escalate.
  - Reduce `categoryUrls` to safest minimal set (Men + Women top only — 2 URLs).
- Operator MUST NOT introduce fingerprint-evasion library.
- Recon's 5/6 baseline CANNOT substitute — Run-phase verification is independent and uses the locked refined selector + 3-sec pacing.

**Verification**:
- Run-phase precondition gate: scratch script (NOT committed) executes the 8 sequential `page.goto` calls and prints pass/fail per attempt. Operator inspects output and decides to proceed or escalate.
- Manual: short markdown note at bottom of `src/lib/farfetch-engine.ts` (or in `.moai/specs/SPEC-PLATFORM-EXPANSION-006/run-notes.md`) documents result: "Farfetch KR multi-nav verification 2026-MM-DD: N/8 passes. Engine cleared for Farfetch KR activation."

---

## AC-10: Farfetch KR ToS verification (Run-phase HARD precondition)

**Maps to**: REQ-008

**Given**:
- Run phase ANALYZE step is in progress.
- AC-9 (multi-nav stability) has passed.
- `src/lib/farfetch-engine.ts` top-of-file ToS comment block currently contains placeholder OR is empty; verbatim Korean clauses have not yet been added.
- Plan-phase research.md §1.2 documented ToS URL `https://www.farfetch.com/kr/terms-and-conditions/`.

**When**:
- Operator opens `https://www.farfetch.com/kr/terms-and-conditions/` in real Playwright session (`channel:"chrome"`, minimal context options letting server geo-route).
- Operator waits for SPA to fully hydrate (body length > 50 KB OR Korean ToS heading detected).
- Operator captures rendered Korean ToS body text via `page.evaluate(() => document.body.innerText)`.
- Operator scans text for keywords: Korean (`크롤러`, `크롤링`, `크롤 봇`, `자동화`, `자동화 도구`, `자동 수집`, `데이터 수집`, `봇`, `로봇`, `로봇 배제`, `프로그램`, `소프트웨어 이용`, `스크래핑`, `스크래퍼`); English-as-loanword (`crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `agent`, `automated access`, `data mining`, `screen scraping`, `AI training`, `machine learning`).

**Then**:
- Operator identifies all clauses referencing automation, IP rights, content use, or related terms.
- Operator embeds verbatim relevant Korean clauses as comment block at top of `src/lib/farfetch-engine.ts` for permanent audit record. Block contains:
  - Verbatim Korean clause text for each relevant clause (NO paraphrase, NO summary, NO translation).
  - Capture date and operator name (e.g., `2026-MM-DD by hansangho`).
  - Source URL.
  - Verdict label (one of: `PERMITS`, `AMBIGUOUS-ACCEPTED-BY-OWNER`, `AMBIGUOUS-REJECTED`, `FORBIDS`).
  - SPEC-006 cross-reference.
  - One-line summary of residual-risk conditions: portal.ai-internal-use only; halt-on-cease-and-desist; re-verify on ToS publication-date change OR Farfetch communication OR > 90 days elapsed.
- If captured text contains ANY clause that unambiguously forbids automated catalog access (e.g., naming "크롤러", "자동 수집", "자동화 도구", "no scraping" verbatim — analogous to SPEC-004 (29CM) which named "크롤러(Crawler)" verbatim in 제11조 §2.9호), operator:
  - Sets `disabled: true` on `farfetch-kr` SiteConfig.
  - Abandons engine activation.
  - Escalates to project owner with verbatim forbidding clause and recommendation:
    - OWNER OVERRIDE pattern (analogous to SPEC-004 OWNER OVERRIDE): if owner accepts residual risk under portal.ai-internal-use only + halt-on-C&D + 90-day re-verification, override allowed. Verdict label changes to `FORBIDS-OWNER-OVERRIDE`.
    - OR escalate for B2B partner-API conversation with Farfetch.
- If captured text contains ambiguous clauses (e.g., IP rights analogous to ZARA KR §15 / ZARA US §17), operator classifies as AMBIGUOUS-ACCEPTED-BY-OWNER and proceeds, OR escalates if residual risk is qualitatively higher.

**Verification**:
- Run-phase precondition gate: reader of `src/lib/farfetch-engine.ts` post-Run-phase can identify within 60 seconds: (a) verbatim Korean clauses present, (b) capture date / operator / source URL, (c) verdict label, (d) residual-risk conditions.
- Verbatim verification: re-fetching source URL in Playwright session and diffing against embedded text yields zero textual differences for quoted clauses.
- `farfetch-kr` SiteConfig has `disabled: false` (engine ships live, per AMBIGUOUS-ACCEPTED-BY-OWNER or PERMITS or FORBIDS-OWNER-OVERRIDE) OR `disabled: true` (engine ships shelved per FORBIDS without override OR AMBIGUOUS-REJECTED). Either disposition acceptable for SPEC-006 completion as long as verdict and disposition are aligned per REQ-008.

---

## AC-11: Sitemap-derived categoryUrls live verification (Run-phase HARD precondition)

**Maps to**: REQ-009

**Given**:
- Run phase ANALYZE step is in progress.
- AC-9 (multi-nav stability) has passed.
- Plan-phase research.md §1.1 confirmed `https://www.farfetch.com/sitemap.xml` declared in robots.txt as authoritative source.

**When**:
- Operator downloads `https://www.farfetch.com/sitemap.xml` (and any sub-sitemaps it indexes — e.g., `sitemap-products.xml`, `sitemap-categories.xml`).
- Operator parses XML, extracts ~30 candidate URLs covering Men + Women top + L2 (Clothing, Shoes, Bags, Accessories).
- Operator launches Playwright with `channel:"chrome"` + minimal context, and for each candidate URL:
  - Navigates via `page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000})`.
  - Asserts final URL (after any redirect) is NOT `/kr/` homepage and NOT a `/kr/*-mkt*` marketing page.
  - Asserts `document.querySelectorAll(<locked-selector>).length >= 60` within 30-second timeout.
  - Asserts response status is HTTP 2xx OR HTTP 4xx with cards >= 10 (per REQ-006 4xx-with-body extension).

**Then**:
- All ~30 URLs pass all three assertions, OR each failed URL is documented with: (a) failure mode (redirect target / selector count / status), and (b) replacement URL from sitemap OR removal decision with code comment in `src/configs/platforms.ts` (e.g., `// MEN-Watches l-watches-2 absent from sitemap as of 2026-MM-DD — removed`).
- Final committed `categoryUrls` list contains only verified URLs (>= 20 entries minimum, >= 8 Men + >= 8 Women).
- List MUST NOT contain any URL that redirects to home / marketing OR returns < 10 product cards even with 4xx status.

**Verification**:
- Run-phase precondition gate: scratch script enumerates candidate URLs and prints pass/fail per URL with assertion details. Operator inspects output and applies replacements OR commits list as-is.
- Manual: after final list committed, manual `pnpm crawl --probe=farfetch-kr` (probes FIRST URL only) succeeds.
- Documentation: any URL replacement or removal captured in code comment adjacent to affected entry in `src/configs/platforms.ts`, citing verification date.

---

## AC-12: Characterization fixture pass (REQ-010 + REQ-011)

**Maps to**: REQ-010, REQ-011

**Given**:
- Fixture exists: `tests/fixtures/farfetch-kr-products.fixture.json` (frozen by Run-phase PRESERVE step).
- Test file `tests/farfetch-engine.test.ts` loads fixture and runs assertions.

**When**:
- The user runs `pnpm test`.

**Then**:
- Test runner loads fixture.
- Assertions run: `parseProductsFromCards(fixture, "https://www.farfetch.com/kr", "farfetch-kr")` produces:
  - Every `Product` has populated `name`, `imageUrl`, `productUrl`, `price`.
  - Every `imageUrl` matches `FARFETCH_IMAGE_HOSTS` whitelist.
  - Every `productUrl` matches `FARFETCH_PRODUCT_URL_RE` (canonical `/{designer}/{slug}-item-{id}.aspx` pattern under `/kr/shopping/`).
  - Every `Product.sourceCurrency === "KRW"`.
  - Every `Product.priceFormatted` starts with `"₩"`.
  - Every `Product.price` is a positive KRW integer in sanity range (1,000 ≤ price ≤ 100,000,000).
  - Every `Product.platform === "farfetch-kr"`.
  - Every `Product.brand` is a non-empty string (designer name).
- Helper unit tests pass (AC-3 deriveGenderFromUrl, AC-4 isSafe* helpers, AC-5 detectChallengeIntercept).
- Test suite exit code is 0.
- If any assertion fails, the entire suite fails with exit code 1 (per REQ-011), CI blocks subsequent commit. Engine is NOT split into regional submodules in response to fixture failure.

**Verification**:
- Unit test against fixture: `pnpm test` runs the suite. All assertions pass.

---

## Definition of Done

This SPEC is considered complete when ALL of the following are true:

- All 12 acceptance criteria above (AC-1 through AC-12) pass their stated verification methods.
- All SPEC-001 AC-1 through AC-7 still pass (no regression to Uniqlo).
- All SPEC-002 AC-1 through AC-8 still pass (no regression to region pattern).
- All SPEC-003 AC-1 through AC-10 still pass (no regression to ZARA KR).
- All SPEC-004 AC-1 through AC-10 still pass (no regression to 29CM KR).
- All SPEC-005 AC-1 through AC-12 still pass (no regression to ZARA US / Shopify FX / global pricing).
- `pnpm typecheck` (`tsc --noEmit`) reports zero errors.
- `pnpm test` reports zero failures across all engine fixtures including new Farfetch KR fixture.
- A live `pnpm crawl --probe=farfetch-kr --dry-run` invocation succeeds, reaches real product DOM, prints valid sample with KRW-integer price.
- A live `pnpm crawl --site=farfetch-kr` invocation succeeds, writes `data/farfetch-kr-products.json` with >= 1,000 products, KRW-integer prices, `sourceCurrency: "KRW"`. `errors.length` ≤ 20% of `categoryUrls.length`.
- A live `pnpm tsx src/import-products.ts --site=farfetch-kr` invocation succeeds, 5 spot-checked Supabase rows have `price` stored as KRW integers, `source_currency: "KRW"`, `source_price` equals `price`.
- `src/lib/farfetch-engine.ts` contains a top-of-file comment block with: (a) verbatim Korean ToS clauses from REQ-008 / AC-10, (b) capture date / operator / source URL, (c) verdict label, (d) residual-risk conditions.
- `.moai/project/structure.md` updated to reflect 38 platforms total and document Farfetch DOM-scrape sub-pattern.
- Run phase has not introduced any new production dependency or devDependency.
- No fingerprint-evasion library has been introduced. No IP rotation, no proxy pool, no CAPTCHA solver, no authenticated scraping. Project HARD rules preserved.
- The `farfetch-kr` SiteConfig entry is appropriately set: `disabled: false` if AC-9, AC-10, AC-11 all passed (verdict PERMITS or AMBIGUOUS-ACCEPTED-BY-OWNER or FORBIDS-OWNER-OVERRIDE); `disabled: true` if AC-10 verdict was FORBIDS without override OR AC-9 / AC-11 failed AND operator elected deferral rollback path.

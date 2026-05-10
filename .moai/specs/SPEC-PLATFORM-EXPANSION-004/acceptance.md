# Acceptance Criteria: SPEC-PLATFORM-EXPANSION-004

This document defines Given-When-Then acceptance scenarios for SPEC-PLATFORM-EXPANSION-004 (29CM KR Playwright + XHR-Interception Engine). Each scenario is mapped to one or more EARS requirements from `spec.md` and includes a concrete verification method.

This SPEC inherits acceptance scenarios from SPEC-PLATFORM-EXPANSION-001 for the rate-limit, dry-run, robots-check, abort-on-error, characterization-test, and `--rate=N` override behaviors. SPEC-001's AC-1 through AC-7 are NOT re-stated here. The scenarios below are SPEC-004-specific deltas covering: (1) the new 29CM Playwright + XHR-interception engine class, (2) the Cloudflare-challenge-intercept handling (signature-based, distinct from ZARA's bm-verify), (3) the ToS verification HARD precondition (REQ-008, deferred to Run-phase real browser session — no canonical PDF was located at plan phase, unlike SPEC-003), (4) the Cloudflare-bypass + XHR-interception verification HARD precondition (REQ-007, ≥80% reliability of vanilla `headless: "new"` mode against the live 29CM KR category page), and (5) the new `apiCategoryCodes: number[]` SiteConfig field with engine-side URL construction at runtime.

Verification methods used in this document:

- **Unit test against fixture**: Runs as part of the `node:test` suite (`pnpm test`). Uses the frozen `tests/fixtures/29cm-products.fixture.json` as input. Deterministic, repeatable.
- **Integration test with `--probe`**: Runs `pnpm crawl --probe=29cm-kr` against the live 29CM KR site. Non-deterministic (depends on live Cloudflare posture + SPA hydration timing). Run manually before production cut-in.
- **Live integration test**: Runs `pnpm crawl --site=29cm-kr` end-to-end against the live 29CM KR site, writing `data/29cm-products.json`. Run manually; non-deterministic.
- **Manual verification**: A one-time check by the operator inspecting command output, file existence, browser-displayed ToS clause, etc. Not part of automated CI.
- **Run-phase precondition gate**: A check performed during `/moai run` that BLOCKS the engine from being implemented if the gate fails. AC-9 and AC-10 are precondition gates.

---

## AC-1: 29CM platform registers and dispatches to the new Playwright engine

**Maps to**: REQ-001, REQ-002

**Given**:

- The `29cm-kr` SiteConfig entry exists in `src/configs/platforms.ts` with `key: "29cm-kr"`, `name: "29CM (KR)"`, `type: "29cm"`, `baseUrl: "https://www.29cm.co.kr"`, `sourceCurrency: "KRW"`, `crawlDelay: 2000`, and a non-empty hardcoded `apiCategoryCodes: number[]` listing exactly 10 Women + Men L1 fashion category codes (`[268100100, 269100100, 270100100, 271100100, 305100100, 272100100, 273100100, 274100100, 275100100, 306100100]` — research.md §1.6).
- `PlatformType` in `src/lib/types.ts:53` is the union `"cafe24" | "shopify" | "uniqlo" | "zara" | "29cm"`.
- `SiteConfig` interface in `src/lib/types.ts` includes the new optional `apiCategoryCodes?: number[]` field with JSDoc explicitly binding it to `type === "29cm"`.
- The `29cm-kr` SiteConfig entry does NOT include `apiCategoryPaths` (reserved for Uniqlo), `categoryUrls` (reserved for ZARA), or `region` (reserved for Uniqlo region-parameterization).

**When**:

- The user runs `pnpm crawl --site=29cm-kr` (or any invocation that loads the registered platforms).

**Then**:

- The `runCrawl` function in `src/crawl.ts` partitions the SiteConfig and routes the entry to the new `crawl29cm` function in `src/lib/29cm-engine.ts`. None of `crawlShopify`, `crawlCafe24`, `crawlUniqlo`, or `crawlZara` is invoked for the `29cm-kr` key.
- The `pnpm crawl --list` output includes a row for `29cm-kr` with type `29cm`. Total platform count is 36.

**Verification**:

- Manual verification via `pnpm crawl --list` showing the new row and total count of 36.
- Unit test against fixture: assert that `getPlatformsByType("29cm")` returns exactly one entry and that entry's `key` is `"29cm-kr"`, `type` is `"29cm"`, `baseUrl` is `"https://www.29cm.co.kr"`, `sourceCurrency` is `"KRW"`, and `apiCategoryCodes` has length 10 with the exact code list above.

---

## AC-2: parseProductsFromXhr emits Product[] from frozen XHR fixture

**Maps to**: REQ-009 (primary path: XHR interception)

**Given**:

- The frozen fixture at `tests/fixtures/29cm-products.fixture.json` contains the intercepted XHR JSON payload (~50-100 product entries) captured during the Run-phase PRESERVE step from a real 29CM KR category landing page (e.g., `categoryLargeCode=268100100` / 여성의류).
- The pure parse function `parseProductsFromXhr(xhrJson: unknown, baseUrl: string, platformKey: string, gender: "women" | "men")` is exported from `src/lib/29cm-engine.ts`.

**When**:

- The user runs `pnpm test`. The `node:test` suite loads the fixture and invokes `parseProductsFromXhr` with `(fixture, "https://www.29cm.co.kr", "29cm-kr", "women")`.

**Then**:

- The returned `Product[]` array length matches the fixture's product count (no silent truncation, no defensive zero-result fallback).
- Every emitted `Product` has populated `name` (non-empty string), `imageUrl` (non-empty string), `productUrl` (starts with `https://www.29cm.co.kr/product/catalog/` AND ends in a numeric `itemNo`), and `price` (positive integer KRW value, sanity range 1,000 ≤ price ≤ 5,000,000).
- Every `imageUrl` value matches the 29CM image-host whitelist (initial hypothesis: `img.29cm.co.kr`, `asset.29cm.co.kr`; updated based on ANALYZE-step inspection of the live category page DOM).
- Every emitted `Product` has `sourceCurrency: "KRW"` and `platform: "29cm-kr"`.
- Every emitted `Product` has a populated `gender` array matching the gender argument passed to `parseProductsFromXhr` (e.g., `["women"]`).
- For products with discount pricing in the source XHR (`saleInfoV2.totalSellPrice` < `consumerPrice`), the emitted `Product.price` reflects the sale price, not the consumer price. (Defensive: read field with optional chaining; fall back to `consumerPrice` if `saleInfoV2` is absent.)

**Verification**:

- Unit test against fixture: `pnpm test` runs the suite. All assertions pass.

---

## AC-2b: parseProductsFromDom emits Product[] from synthetic HTML (DOM fallback)

**Maps to**: REQ-009 (fallback path: DOM scrape)

**Given**:

- The pure parse function `parseProductsFromDom(html: string, baseUrl: string, platformKey: string, gender: "women" | "men")` is exported from `src/lib/29cm-engine.ts`.
- A synthetic HTML body is constructed inside the test file containing 3-5 mock product cards using the candidate selector pattern (`<a href="/product/catalog/N">` with child elements for name/price/image — exact selectors verified during ANALYZE).

**When**:

- The user runs `pnpm test`. The suite invokes `parseProductsFromDom` with the synthetic HTML body.

**Then**:

- The returned `Product[]` array length matches the synthetic-card count (3-5).
- Every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, and `price`. Image-host whitelist enforced. `productUrl` starts with `https://www.29cm.co.kr/product/catalog/`.
- Selector fallback chain (4-6 fallbacks per field, mirroring ZARA's pattern) is exercised when the primary selector fails: a second sub-test passes a synthetic HTML where the primary `name` selector is absent and asserts the fallback selector recovers the name correctly.

**Verification**:

- Unit test against fixture: `pnpm test` runs the suite. All assertions pass.

---

## AC-3: Live --probe succeeds against 29CM KR (or fails gracefully)

**Maps to**: REQ-004

**Given**:

- The `29cm-kr` platform is registered.
- The Run-phase REQ-007 Cloudflare-bypass + XHR-interception verification has passed (AC-9, below).
- The Run-phase REQ-008 ToS verification has passed (AC-10, below).
- The `data/29cm-products.json` file does NOT exist before this scenario runs (precondition: delete the file if it exists, or run in a clean state).

**When**:

- The user runs `pnpm crawl --site=29cm-kr --dry-run` (or `pnpm crawl --probe=29cm-kr`).

**Then**:

- The crawler invokes `checkRobots(config.baseUrl)` from `src/lib/robots-check.ts`. The check returns `{allowed: true}` for 29CM KR (research.md §1.1).
- The crawler launches Playwright Chromium with `headless: "new"`, vanilla launch options (NOT `channel: "chrome"` by default), realistic context (UA from rotation list, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport: {width: 1440, height: 900}`).
- The crawler navigates to the URL constructed from the FIRST entry in `config.apiCategoryCodes` (default: `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100&sort=RECOMMENDED`) via `page.goto(url, {waitUntil: "domcontentloaded"})`.
- The `page.on("response")` listener is installed before navigation and captures the first `application/json` response from a `*-api.29cm.co.kr` host whose body matches the heuristic shape `{result, data: [...]}` or similar product-list shape.
- The crawler asserts the page HTML reaches real product DOM: HTML body length > 5,000 bytes AND `is29cmCloudflareChallenge(html)` returns `false`. If this assertion fails (Cloudflare challenge appeared), the probe exits with an error message identifying the platform key, the URL, and a count of bytes received.
- A sample product summary is printed to stdout, including at minimum the keys `name`, `price`, `productUrl`, and `imageUrl` for the first product extracted (preferentially from the captured XHR; fall back to DOM extraction if no XHR was captured within 15 sec).
- The file `data/29cm-products.json` is NOT created. Filesystem state of the `data/` directory is unchanged from before the invocation.
- Browser is closed in a `finally` block (verified by no orphaned Chromium process remaining after the command exits).

**Verification**:

- Integration test with `--probe`: Run the command in a clean state, capture stdout, assert success exit code AND `data/29cm-products.json` does not exist after exit. Acceptable failure mode: if Cloudflare escalates and the probe exits with a clear error message, that is also a passing case (graceful failure is the design).
- Unit test against fixture: A test that constructs a synthetic HTML body matching the Cloudflare challenge signature (HTML < 5KB containing `cf-mitigated`, `Just a moment`, or `cf-challenge-platform`) and asserts `is29cmCloudflareChallenge` returns `true`. Paired with a positive test passing real product DOM HTML (> 5KB, no challenge keywords) asserting the helper returns `false`.

---

## AC-4: Live full crawl writes JSON cache file with ≥100 products

**Maps to**: REQ-003

**Given**:

- The `29cm-kr` platform is registered and AC-1 through AC-3 pass.
- The live 29CM KR site is reachable (no global Cloudflare escalation in effect).

**When**:

- The user runs `pnpm crawl --site=29cm-kr` (no `--dry-run` flag).

**Then**:

- For each numeric code in `config.apiCategoryCodes`:
  - Engine constructs URL `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED`.
  - Playwright navigates to the URL via `page.goto`.
  - The `page.on("response")` listener captures the first matching XHR within 15 seconds, OR the DOM selector `[href^="/product/catalog/"]` resolves with ≥10 matches within 15 seconds. If neither occurs, this category counts toward abort-on-3.
  - The infinite-scroll loop runs until product count plateaus (no new products after 2 consecutive scrolls) OR the per-category cap (200) is reached.
  - Products are extracted via `parseProductsFromXhr` (preferred) or `parseProductsFromDom` (fallback) and mapped to `Product[]`.
  - Gender is derived from the L1 code mapping (codes 268-271 and 305 → `"women"`; codes 272-275 and 306 → `"men"`).
  - 2 sec pacing applies between category iterations.
- After all 10 categories are processed, the crawler writes `data/29cm-products.json` containing the aggregated `Product[]` array.
- The file contains ≥100 products with non-null `name`, `price`, `productUrl`, `imageUrl` fields.
- Every product has `platform: "29cm-kr"` and `sourceCurrency: "KRW"`.
- Every product has `gender` populated as `["women"]` or `["men"]` based on L1 derivation (no empty arrays, no mixed entries).
- The `errors` array is empty for ≥80% of categories (residual ≤20% allowed for transient Cloudflare escalations or stale codes; if >20%, AC-4 fails and the engine is treated as broken — see plan.md §7).

**Verification**:

- Live integration test: Run `pnpm crawl --site=29cm-kr`, hand-inspect `data/29cm-products.json` for ≥100 products with populated required fields and KRW prices.
- Live integration test: Inspect the printed stats summary at command exit; confirm `inStock` count > 0, `uniqueBrands` ≥ 10 (29CM is a select-shop with hundreds of brands, so even a 100-product sample should hit double digits), `errors.length` ≤ 0.2 × `apiCategoryCodes.length` (i.e., ≤ 2 errored categories out of 10).

---

## AC-5: robots-check delegation passes for 29CM KR

**Maps to**: REQ-005

**Given**:

- The live `https://www.29cm.co.kr/robots.txt` URL returns HTTP 200 with the wildcard `User-agent: *` group containing path-specific Disallow rules (`/embed/`, `/home/embed/`, `/my-page/`, `/order/`, `/auth/`, `/inbox/`, `/content/post/preview`) but explicitly `Allow: /` and NO blanket `Disallow: /` (verified verbatim in research.md §1.1).
- `src/lib/robots-check.ts` is unchanged from SPEC-001.

**When**:

- The user runs `pnpm crawl --site=29cm-kr` (with or without `--dry-run`).

**Then**:

- The crawler invokes `checkRobots(config.baseUrl)` BEFORE launching Playwright.
- The robots-check returns `{allowed: true}`.
- The crawler proceeds to launch Playwright and execute the engine.
- No spurious error is emitted; no `CrawlResult.errors` entry is added for robots-related reasons.
- The `Baiduspider` blanket-disallow at the top of 29CM's robots.txt does NOT affect our crawler (we send a Mozilla UA, not a Baiduspider UA — `parseRobotsBody` correctly scopes to `User-agent: *`).

**Verification**:

- Integration test with `--probe`: Run `pnpm crawl --site=29cm-kr --dry-run` against the live API; confirm no robots-related error in stdout/stderr.
- Unit test against fixture: A test that constructs a synthetic `robots.txt` body matching the live 29CM wildcard group (full-text quoted from research.md §1.1), passes it through `parseRobotsBody`, and asserts the result is `{allowed: true}`. Pair with the existing SPEC-001 negative test (synthetic Musinsa-pattern blanket-disallow → `{allowed: false}`) to confirm the check is still discriminating.

---

## AC-6: Abort on 3 consecutive errors per category

**Maps to**: REQ-006

**Given**:

- The Playwright `page.goto` is mocked (or simulated via test harness) to raise a timeout exception 3 times in a row when navigating to a specific category URL, then resolve normally on the 4th call.
- The `29cm-kr` SiteConfig has at least 2 entries in `apiCategoryCodes` so that the engine can demonstrate continuing past the failed category.

**When**:

- The crawler runs and reaches the failing category.

**Then**:

- After the 3rd consecutive failure on the category, the engine aborts that category (does not make a 4th `page.goto` call to that URL).
- "Consecutive" means without an intervening successful extraction (≥1 product card emitted via XHR or DOM fallback) on the same category.
- The aborted category contributes one entry to `CrawlResult.errors` containing the category code, error type (`page-goto-timeout` / `selector-not-found-and-no-xhr` / `cloudflare-challenge-intercept` / `page-evaluate-exception` / `xhr-json-parse-error`), the constructed request URL, and a timestamp.
- The engine continues with the next code in `apiCategoryCodes`. The successful subsequent code produces normal `Product` entries in `CrawlResult.products`.
- After all categories are processed, the partial result is written to `data/29cm-products.json` (when running outside dry-run). The `errors` array length is ≥1; the `products` array contains entries from non-failed categories.
- No infinite retry loop occurs. No IP rotation, no fingerprint evasion, no header spoofing. No retry-with-backoff delay beyond the configured `crawlDelay`.

**Verification**:

- Unit test against fixture: A test that mocks the engine's category-iteration helper (a unit-testable extraction function called from inside `crawl29cm`) to fail 3 times for one code and succeed for another. Asserts: exactly 3 calls to the failing URL, ≥1 call to the succeeding URL, `CrawlResult.errors.length === 1`, `CrawlResult.products.length ≥ 1`.

---

## AC-7: Cloudflare-challenge intercept detection short-circuits the engine

**Maps to**: REQ-006 (sub-clause: Cloudflare-challenge intercept counts as an error)

**Given**:

- A category URL is configured in `apiCategoryCodes`.
- The Playwright session is mocked (via `page.setContent` or via a fake-fetch wrapper) to return a synthetic HTML body matching the Cloudflare-challenge intercept signature: HTML body length < 5,000 bytes AND containing one of `cf-mitigated`, `Just a moment`, or `cf-challenge-platform`. (Note: at plan phase, no live Cloudflare challenge intercept was observed during 5 sequential probes — research.md §3.1 — so the Run-phase ANALYZE step should capture a synthetic example by intentionally triggering a high request rate against `*.29cm.co.kr` if needed, OR fabricate a minimal challenge HTML matching Cloudflare's documented intercept structure for the test.)

**When**:

- The engine attempts to extract products from this URL.

**Then**:

- The engine's `is29cmCloudflareChallenge` detector identifies the response as a challenge intercept (HTML body length < 5,000 bytes AND containing one of the three signature strings).
- This counts as a failure for the abort-on-3 counter.
- If the intercept persists for 3 consecutive `page.goto` retries (engine MUST NOT silently re-try without surfacing each as a counted failure), the category is aborted and an error entry is logged with type `cloudflare-challenge-intercept`.
- The engine does NOT attempt to "solve" the Cloudflare challenge or substitute a fingerprint-evasion library.

**Verification**:

- Unit test against fixture: A test that imports the `is29cmCloudflareChallenge` helper function from `29cm-engine.ts`, passes a synthetic ~2KB Cloudflare-challenge HTML string (committed to `tests/29cm-engine.test.ts` as a string constant during PRESERVE), and asserts the helper returns `true`.
- Unit test against fixture: A second test that passes a real product DOM HTML (HTML > 5KB, does not contain any of the three signature strings) and asserts the helper returns `false`.

---

## AC-8: 29CM engine respects --rate=N flag within rate-cap policy

**Maps to**: SPEC-001 REQ-007 (reused)

**Given**:

- The `29cm-kr` platform is registered with default `crawlDelay: 2000` (2 sec/category baseline).
- SPEC-001 introduced `parseRateFlag` which validates `--rate=N` against the rate-cap policy (1 ≤ N ≤ 5; integer).

**When**:

- The user runs `pnpm crawl --site=29cm-kr --rate=2`.

**Then**:

- The crawler computes per-request delay as `1000 / 2 = 500ms`.
- Note: 29CM's actual elapsed time per category is dominated by Playwright browser overhead (page.goto + scroll + XHR interception + extract typically takes 5-15 seconds), so the `--rate=N` override has limited effect for 29CM — the override sets the inter-category pacing floor, not the per-category execution time. This is identical to ZARA's behavior and a documented difference from Uniqlo (where the engine is fetch-bound and `--rate=N` directly controls request frequency).
- If the user runs `--rate=10` (above rate-cap), the command is rejected at parse time with a clear error message and exit code 1. No browser is launched.

**Verification**:

- Manual verification: Run `pnpm crawl --site=29cm-kr --rate=2 --dry-run` and confirm the printed `crawlDelay` reflects 500ms.
- Unit test against fixture: Re-use the SPEC-001 `parseRateFlag` rejection tests for `--rate=10`, `--rate=0`, `--rate=-1`, `--rate=2.5`, `--rate=abc`. No 29CM-specific test addition.

---

## AC-9: Cloudflare-bypass + XHR-interception verification (Run-phase HARD precondition)

**Maps to**: REQ-007

**Given**:

- The Run phase ANALYZE step is in progress.
- No production engine code has been written yet.
- `src/lib/29cm-engine.ts` does NOT exist (or exists as an empty placeholder).

**When**:

- The operator launches Playwright Chromium with `chromium.launch({headless: "new"})` (vanilla, no `channel: "chrome"`) and navigates 5 sequential times (with 2 sec pacing) to `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100` from a single Playwright session, with `page.on("response")` listener active capturing all responses.

**Then**:

- For each of the 5 sequential `page.goto` invocations, the operator records:
  - (1) HTML body length after `domcontentloaded` is > 5,000 bytes (NOT a Cloudflare challenge intercept), AND
  - (2) at least one `application/json` response from `*.29cm.co.kr` is captured by `page.on("response")` within 15 seconds, AND
  - (3) `document.querySelectorAll('[href^="/product/catalog/"]').length >= 10` within a 30-second timeout.
- All three conditions must be satisfied on at least 4 of the 5 sequential `page.goto` invocations (≥80% reliability).
- If reliability is below 80%, the operator MUST invoke a rollback path:
  - Rollback path 1: Upgrade to `channel: "chrome"` (1-LOC change to the launch options). Re-run the 5-attempt verification. If now ≥80%, proceed with `channel: "chrome"` and document the upgrade in a top-of-file comment in `src/lib/29cm-engine.ts`.
  - Rollback path 2: If `channel: "chrome"` is also below 80%, open a separate SPEC to introduce Xvfb-in-CI for `headless: false` mode. SPEC-004 is paused until the new SPEC is approved.
  - Rollback path 3: Defer SPEC-004 entirely. Set `disabled: true` on `29cm-kr` SiteConfig if it has been added. Notify the project owner.
- The operator MUST NOT introduce a fingerprint-evasion library (`puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` JA3, etc.) or otherwise circumvent project HARD rules to compensate for an insufficient pass rate.
- If reliability is at or above 80% with vanilla `headless: "new"`, the engine is cleared for implementation with the default launch options.

**Verification**:

- Run-phase precondition gate: A scratch script (NOT committed; ephemeral) executes the 5 sequential `page.goto` calls with `page.on("response")` listener, prints pass/fail per attempt with the three condition checks, and records which (if any) escalation path was invoked. The operator inspects the output and decides to proceed or escalate.
- Manual verification: A short markdown note at the bottom of `src/lib/29cm-engine.ts` (or in `.moai/specs/SPEC-PLATFORM-EXPANSION-004/run-notes.md` if created) documents the verification result: "Cloudflare-bypass + XHR-interception verification 2026-MM-DD: 4/5 (or 5/5) passes with `headless: 'new'`. Engine cleared for implementation." OR "5/5 passes with `channel: 'chrome'` after vanilla headless fell below 80% — escalation path 1 invoked, default launch options updated."

---

## AC-10: 29CM KR ToS verification (Run-phase HARD precondition — DEFERRED, NOT pre-satisfied)

**Maps to**: REQ-008

**Status**: DEFERRED to Run phase. Plan-phase static-asset CDN probes failed to locate a canonical 29CM ToS PDF (research.md §1.2: `asset.29cm.co.kr/terms.pdf`, `asset.29cm.co.kr/policy/agreement.pdf`, `asset.29cm.co.kr/agreement.pdf` all returned HTTP 403; `static.29cm.co.kr` DNS unresolvable; `apihub.29cm.co.kr/notice/?notice_type=AGREEMENT` returned an empty result set). The page at `https://www.29cm.co.kr/home/agreement` returns a 5KB Angular CSR shell that hydrates the actual ToS text after JS execution. SPEC-004 cannot benefit from the SPEC-003-style PDF shortcut. ToS verification is therefore performed in a real Playwright browser session during Run-phase ANALYZE.

**Given**:

- The Run phase ANALYZE step is in progress.
- AC-9 (REQ-007 Cloudflare-bypass verification) has passed — Playwright reaches real DOM in `headless: "new"` (or `channel: "chrome"` if escalated).
- No production engine code has been written yet (or `src/lib/29cm-engine.ts` exists only as an empty placeholder).

**When**:

- The operator opens `https://www.29cm.co.kr/home/agreement` in the same Playwright session (re-using the verified browser launch options from AC-9), waits up to 30 seconds for the Angular CSR shell to hydrate the rendered Korean ToS text (via `page.waitForFunction(() => document.body.innerText.length > 1000)` or a similar hydration-check predicate), and captures the full body text via `page.evaluate(() => document.body.innerText)`.

**Then**:

- The captured Korean ToS text is scanned for the following keywords (case-insensitive, substring match): 자동화, 크롤, 스크래, 봇, 로봇, 데이터 수집, 추출, agent, robot, scrape, crawl, automated, automation, AI 학습, 머신러닝.
- The operator identifies all clauses containing any of these keywords AND any IP-rights / content-use clauses (analogous to ZARA's §15) regardless of keyword match.
- The operator embeds the verbatim Korean clauses as a top-of-file comment block in `src/lib/29cm-engine.ts` in this format:
  ```ts
  /**
   * 29CM KR Terms of Service — verified by operator YYYY-MM-DD (operator-name).
   * Source: https://www.29cm.co.kr/home/agreement (Angular CSR; captured via Playwright session)
   * Capture method: page.evaluate(() => document.body.innerText) after CSR hydration
   *
   * §<N> (<short clause descriptor>):
   * <verbatim Korean clause text — NO paraphrasing, NO translation-only, NO summarization>
   *
   * [...repeat for each relevant clause...]
   *
   * Verdict: <one of: PERMITS | AMBIGUOUS-ACCEPTED-BY-OWNER | AMBIGUOUS-REJECTED | FORBIDS>
   * Conditions: kiko.ai-internal-use only; halt-on-cease-and-desist; re-verify on ToS text
   *             change OR 29CM/Musinsa direct communication OR > 90 days elapsed.
   * SPEC: SPEC-PLATFORM-EXPANSION-004 REQ-008
   */
  ```
- The operator classifies the verdict according to these rules:
  - **PERMITS**: No clause references automation, crawling, scraping, bots, robots, data extraction, or AI/ML training. (Unlikely outcome given typical Korean e-commerce ToS structure.)
  - **AMBIGUOUS-ACCEPTED-BY-OWNER**: Clauses exist that restrict content use generally (e.g., IP rights, copyright clauses) but no clause unambiguously names automated catalog access, web scraping, crawler/bot use, or AI/ML training as a prohibited behavior. Residual risk is qualitatively comparable to ZARA's §15 IP rights clause. Operator has authority to make this call autonomously and proceed.
  - **AMBIGUOUS-REJECTED**: Clauses exist that mention automation/scraping/bots/AI in concerning context but with ambiguous binding (e.g., "the company may restrict usage by automated means at its discretion"). Operator escalates to project owner before unblocking.
  - **FORBIDS**: At least one clause unambiguously forbids automated catalog access, web scraping, crawler/bot use, or AI/ML training (analogous to a verbatim `Disallow: /` in robots.txt — i.e., a clause that names the exact prohibited behavior with declarative force). Operator MUST: (1) set `disabled: true` on `29cm-kr` SiteConfig, (2) abandon engine implementation, (3) escalate to project owner with the verbatim forbidding clause and a recommendation for B2B partner-API conversation with 29CM/Musinsa.
- The original Korean text MUST NOT be paraphrased, translated-only, or summarized in this comment block — verbatim quoting is the audit-evidence contract.

**Verification**:

- Run-phase precondition gate: The operator's Playwright capture script prints the full extracted ToS text to stdout (or saves to `.moai/specs/SPEC-PLATFORM-EXPANSION-004/tos-capture-YYYY-MM-DD.txt` ephemeral note file). The operator inspects the text, identifies relevant clauses, classifies verdict, and embeds in engine source.
- Manual verification: A reader of `src/lib/29cm-engine.ts` can identify within 30 seconds: (a) the verbatim Korean clauses are present (multiple paragraphs of Korean text in a comment block), (b) capture date and operator name, (c) verdict label is one of the four enumerated values, (d) the residual-risk conditions are stated.
- Verdict-FORBIDS verification: If the operator classifies FORBIDS, the `29cm-kr` SiteConfig entry MUST have `disabled: true` and a `notes` field referencing the forbidding clause.
- Verdict-AMBIGUOUS-REJECTED verification: If the operator classifies AMBIGUOUS-REJECTED, work pauses pending project-owner review; the comment block is committed with the verdict but the `29cm-kr` SiteConfig also has `disabled: true` until owner approves.

**Re-verification triggers** (require post-Run-phase re-check):
- 29CM updates the rendered ToS text on `/home/agreement` (different from captured text — diff against `tos-capture-YYYY-MM-DD.txt` ephemeral note).
- 29CM or Musinsa issues direct communication (cease-and-desist, terms update notice, etc.).
- More than 90 calendar days elapsed since capture date and the most recent production crawl.

---

## Definition of Done

This SPEC is considered complete when ALL of the following are true:

- All 10 acceptance criteria above (AC-1 through AC-10) pass their stated verification methods.
- All SPEC-001 AC-1 through AC-7 still pass (no regression to Uniqlo behavior; PlatformType extension is additive only).
- All SPEC-002 AC-1 through AC-8 still pass (no regression to Uniqlo US or FX module behavior).
- All SPEC-003 AC-1 through AC-10 still pass (no regression to ZARA Playwright engine; new `apiCategoryCodes` field is additive to SiteConfig and does NOT collide with existing `categoryUrls`/`apiCategoryPaths`/`region`).
- `pnpm typecheck` (`tsc --noEmit`) reports zero errors.
- `pnpm test` (the existing `node:test` suite plus the new `tests/29cm-engine.test.ts` file) reports zero failures.
- A live `pnpm crawl --site=29cm-kr --dry-run` invocation succeeds, reaches real product DOM (NOT Cloudflare challenge intercept), and prints a valid sample product with KRW price.
- A live `pnpm crawl --site=29cm-kr` invocation succeeds, writes `data/29cm-products.json`, and the file contains ≥100 products with non-null required fields and `sourceCurrency: "KRW"`. `CrawlResult.errors.length` is ≤20% of `apiCategoryCodes.length` (i.e., ≤2 errored categories out of 10).
- `src/lib/29cm-engine.ts` contains a top-of-file comment block with the verbatim Korean-language ToS clauses, the capture date, the operator name, and the verdict label (REQ-008 / AC-10). The verdict is one of: PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER (with risk parity to ZARA §15 documented), AMBIGUOUS-REJECTED (engine shipped with `disabled: true` pending owner review), or FORBIDS (engine shipped with `disabled: true` and forbidding-clause referenced in SiteConfig `notes`).
- `.moai/project/structure.md` is updated to reflect 36 platforms total and to document the 29CM Cloudflare-passive Playwright + XHR-interception sub-pattern in the engine-layering subsection.
- The Run phase has not introduced any new production dependency or devDependency beyond what is in `tech.md` (Playwright `^1.58.2` is reused; `node:test` is reused).
- No fingerprint-evasion library has been introduced. No IP rotation, no proxy pool, no CAPTCHA-solving service, no authenticated scraping. Project HARD rules preserved.
- The `29cm-kr` SiteConfig entry is appropriately set: `disabled: false` if AC-10 verdict was PERMITS or AMBIGUOUS-ACCEPTED-BY-OWNER; `disabled: true` if AC-10 verdict was AMBIGUOUS-REJECTED or FORBIDS (engine ships shelved with audit evidence).
- If REQ-007 verification escalated to `channel: "chrome"`, the launch-option upgrade is documented in `src/lib/29cm-engine.ts` top-of-file comment block AND in the SiteConfig `notes` field.

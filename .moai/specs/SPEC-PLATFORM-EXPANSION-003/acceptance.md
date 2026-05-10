# Acceptance Criteria: SPEC-PLATFORM-EXPANSION-003

This document defines Given-When-Then acceptance scenarios for SPEC-PLATFORM-EXPANSION-003 (ZARA KR Playwright Engine). Each scenario is mapped to one or more EARS requirements from `spec.md` and includes a concrete verification method.

This SPEC inherits acceptance scenarios from SPEC-PLATFORM-EXPANSION-001 for the rate-limit, dry-run, robots-check, abort-on-error, characterization-test, and `--rate=N` override behaviors. SPEC-001's AC-1 through AC-7 are NOT re-stated here. The scenarios below are SPEC-003-specific deltas covering the new ZARA Playwright engine, the bm-verify-intercept handling, the ToS verification HARD precondition, and the Akamai bypass verification HARD precondition.

Verification methods used in this document:

- **Unit test against fixture**: Runs as part of the `node:test` suite (`pnpm test`). Uses the frozen `tests/fixtures/zara-kr-products.fixture.json` as input. Deterministic, repeatable.
- **Integration test with `--probe`**: Runs `pnpm crawl --probe=zara-kr` against the live ZARA KR site. Non-deterministic (depends on live Akamai posture). Run manually before production cut-in.
- **Live integration test**: Runs `pnpm crawl --site=zara-kr` end-to-end against the live ZARA KR site, writing `data/zara-kr-products.json`. Run manually; non-deterministic.
- **Manual verification**: A one-time check by the operator inspecting command output, file existence, browser-displayed ToS clause, etc. Not part of automated CI.
- **Run-phase precondition gate**: A check performed during `/moai run` that BLOCKS the engine from being implemented if the gate fails. AC-9 and AC-10 are precondition gates.

---

## AC-1: ZARA platform registers and dispatches to the new Playwright engine

**Maps to**: REQ-001, REQ-002

**Given**:

- The `zara-kr` SiteConfig entry exists in `src/configs/platforms.ts` with `key: "zara-kr"`, `name: "자라 (KR)"`, `type: "zara"`, `baseUrl: "https://www.zara.com/kr/ko"`, `sourceCurrency: "KRW"`, `crawlDelay: 2000`, and a non-empty hardcoded `categoryUrls: string[]` listing at minimum 8 Women + 8 Men L2 category landing-page URL paths (e.g., `/kr/ko/woman-new-in-l1180.html`, `/kr/ko/woman-coats-l1184.html`, `/kr/ko/man-new-in-l711.html`, etc.).
- `PlatformType` in `src/lib/types.ts:53` is the union `"cafe24" | "shopify" | "uniqlo" | "zara"`.
- `SiteConfig` interface in `src/lib/types.ts` includes the new optional `categoryUrls?: string[]` field with JSDoc explicitly binding it to `type === "zara"`.
- The `zara-kr` SiteConfig entry does NOT include `apiCategoryPaths` (reserved for Uniqlo) or `region` (reserved for Uniqlo region-parameterization).

**When**:

- The user runs `pnpm crawl --site=zara-kr` (or any invocation that loads the registered platforms).

**Then**:

- The `runCrawl` function in `src/crawl.ts` partitions the SiteConfig and routes the entry to the new `crawlZara` function in `src/lib/zara-engine.ts`. Neither `crawlShopify`, `crawlCafe24`, nor `crawlUniqlo` is invoked for the `zara-kr` key.
- The `pnpm crawl --list` output includes a row for `zara-kr` with type `zara`. Total platform count is 35.

**Verification**:

- Manual verification via `pnpm crawl --list` showing the new row and total count of 35.
- Unit test against fixture: assert that `getPlatformsByType("zara")` returns exactly one entry and that entry's `key` is `"zara-kr"`, `type` is `"zara"`, `baseUrl` is `"https://www.zara.com/kr/ko"`, `sourceCurrency` is `"KRW"`, and `categoryUrls` is a non-empty string array containing at least 8 Women + 8 Men URL paths.

---

## AC-2: parseProductsFromDom emits Product[] from frozen fixture

**Maps to**: REQ-009

**Given**:

- The frozen fixture at `tests/fixtures/zara-kr-products.fixture.json` contains an array of `RawZaraProduct` objects (~50-100 entries) captured during the Run-phase PRESERVE step from a real ZARA KR category landing page.
- The pure parse function `parseProductsFromDom(html: string, baseUrl: string, platformKey: string)` is exported from `src/lib/zara-engine.ts`.

**When**:

- The user runs `pnpm test`. The `node:test` suite loads the fixture, constructs a synthetic HTML body wrapping the fixture's product entries (each entry rendered into a `<div class="product-grid-product" data-productid="...">...</div>` block), and invokes `parseProductsFromDom` against the synthetic HTML.

**Then**:

- The returned `Product[]` array has length matching the fixture's product count (no silent truncation).
- Every emitted `Product` has populated `name` (non-empty string), `imageUrl` (non-empty string), `productUrl` (starts with `https://www.zara.com/kr/ko/` and ends with `.html`), and `price` (positive integer KRW value, sanity range 5,000 ≤ price ≤ 5,000,000).
- Every `imageUrl` value matches the ZARA image-host whitelist (`static.zara.net` or `static-images.zara.net`, verified during ANALYZE — list updated in fixture if the live DOM revealed additional hosts).
- Every emitted `Product` has `sourceCurrency: "KRW"` and `platform: "zara-kr"`.
- Every emitted `Product` has a populated `gender` array (e.g., `["women"]`, `["men"]`, derived from the URL path).

**Verification**:

- Unit test against fixture: `pnpm test` runs the suite. All assertions pass.

---

## AC-3: Live --probe succeeds against ZARA KR (or fails gracefully)

**Maps to**: REQ-004

**Given**:

- The `zara-kr` platform is registered.
- The Run-phase REQ-007 Akamai bypass verification has passed (AC-9, below).
- The Run-phase REQ-008 ToS verification has passed (AC-10, below).
- The `data/zara-kr-products.json` file does NOT exist before this scenario runs (precondition: delete the file if it exists, or run in a clean state).

**When**:

- The user runs `pnpm crawl --site=zara-kr --dry-run` (or `pnpm crawl --probe=zara-kr`).

**Then**:

- The crawler invokes `checkRobots(config.baseUrl)` from `src/lib/robots-check.ts`. The check returns `{allowed: true}` for ZARA KR.
- The crawler launches Playwright Chromium with `headless: "new"`, vanilla launch options, realistic context (UA from rotation list, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`, `viewport: {width: 1440, height: 900}`).
- The crawler navigates to the FIRST URL in `config.categoryUrls` via `page.goto(url, {waitUntil: "domcontentloaded"})`.
- The crawler asserts the page HTML reaches real product DOM: HTML body length > 5,000 bytes AND does NOT contain the literal string `bm-verify`. If this assertion fails (Akamai intercept appeared), the probe exits with an error message identifying the platform key, the URL, and a count of bytes received.
- A sample product summary is printed to stdout, including at minimum the keys `name`, `price`, `productUrl`, and `imageUrl` for the first product card extracted.
- The file `data/zara-kr-products.json` is NOT created. Filesystem state of the `data/` directory is unchanged from before the invocation.
- Browser is closed in a `finally` block (verified by no orphaned Chromium process remaining after the command exits).

**Verification**:

- Integration test with `--probe`: Run the command in a clean state, capture stdout, assert success exit code AND `data/zara-kr-products.json` does not exist after exit. Acceptable failure mode: if Akamai escalates and the probe exits with a clear error message, that is also a passing case (graceful failure is the design).
- Unit test against fixture: A test that constructs a synthetic HTML body matching the bm-verify intercept signature (HTML < 5KB containing "bm-verify") and asserts the engine's intercept-detection path correctly identifies it as an intercept (NOT real product DOM).

---

## AC-4: Live full crawl writes JSON cache file with ≥100 products

**Maps to**: REQ-003

**Given**:

- The `zara-kr` platform is registered and AC-1 through AC-3 pass.
- The live ZARA KR site is reachable (no global Akamai escalation in effect).

**When**:

- The user runs `pnpm crawl --site=zara-kr` (no `--dry-run` flag).

**Then**:

- For each URL in `config.categoryUrls`:
  - Playwright navigates to the URL via `page.goto`.
  - The product-card selector chain resolves within 15 seconds.
  - The infinite-scroll loop runs until product count plateaus (no new products after 2 consecutive scrolls) OR the per-category cap (200) is reached.
  - Products are extracted via `page.evaluate` and mapped to `Product[]`.
  - 2 sec pacing applies between category iterations.
- After all categories are processed, the crawler writes `data/zara-kr-products.json` containing the aggregated `Product[]` array.
- The file contains ≥100 products with non-null `name`, `price`, `productUrl`, `imageUrl` fields.
- Every product has `platform: "zara-kr"` and `sourceCurrency: "KRW"`.
- The `errors` array is empty for ≥80% of categories (residual ≤20% allowed for transient Akamai escalations or stale URLs; if >20%, AC-4 fails and the engine is treated as broken — see plan.md §7).

**Verification**:

- Live integration test: Run `pnpm crawl --site=zara-kr`, hand-inspect `data/zara-kr-products.json` for ≥100 products with populated required fields.
- Live integration test: Inspect the printed stats summary at command exit; confirm `inStock` count > 0, `uniqueBrands` ≥ 1, `errors.length` ≤ 0.2 × `categoryUrls.length`.

---

## AC-5: robots-check delegation passes for ZARA KR

**Maps to**: REQ-005

**Given**:

- The live `https://www.zara.com/robots.txt` URL returns HTTP 200 with the wildcard `User-agent: *` group containing path-specific Disallow rules but NO blanket `Disallow: /` (verified in research.md §1.1).
- `src/lib/robots-check.ts` is unchanged from SPEC-001.

**When**:

- The user runs `pnpm crawl --site=zara-kr` (with or without `--dry-run`).

**Then**:

- The crawler invokes `checkRobots(config.baseUrl)` BEFORE launching Playwright.
- The robots-check returns `{allowed: true}`.
- The crawler proceeds to launch Playwright and execute the engine.
- No spurious error is emitted; no `CrawlResult.errors` entry is added for robots-related reasons.

**Verification**:

- Integration test with `--probe`: Run `pnpm crawl --site=zara-kr --dry-run` against the live API; confirm no robots-related error in stdout/stderr.
- Unit test against fixture: A test that constructs a synthetic `robots.txt` body matching the live ZARA wildcard group (full-text quoted from research.md §1.1), passes it through `parseRobotsBody`, and asserts the result is `{allowed: true}`. Pair with the existing SPEC-001 negative test (synthetic Musinsa-pattern blanket-disallow → `{allowed: false}`) to confirm the check is still discriminating.

---

## AC-6: Abort on 3 consecutive errors per category

**Maps to**: REQ-006

**Given**:

- The Playwright `page.goto` is mocked (or simulated via test harness) to raise a timeout exception 3 times in a row when navigating to a specific category URL, then resolve normally on the 4th call.
- The `zara-kr` SiteConfig has at least 2 entries in `categoryUrls` so that the engine can demonstrate continuing past the failed category.

**When**:

- The crawler runs and reaches the failing category.

**Then**:

- After the 3rd consecutive failure on the category, the engine aborts that category (does not make a 4th `page.goto` call to that URL).
- "Consecutive" means without an intervening successful extraction (≥1 product card emitted) on the same URL.
- The aborted category contributes one entry to `CrawlResult.errors` containing the category URL, error type (timeout / selector-not-found / bm-verify-intercept / page-evaluate-exception), the request URL, and a timestamp.
- The engine continues with the next URL in `categoryUrls`. The successful subsequent URL produces normal `Product` entries in `CrawlResult.products`.
- After all categories are processed, the partial result is written to `data/zara-kr-products.json` (when running outside dry-run). The `errors` array length is ≥1; the `products` array contains entries from non-failed categories.
- No infinite retry loop occurs. No IP rotation, no fingerprint evasion, no header spoofing. No retry-with-backoff delay.

**Verification**:

- Unit test against fixture: A test that mocks the engine's category-iteration helper (a unit-testable extraction function called from inside `crawlZara`) to fail 3 times for one URL and succeed for another. Asserts: exactly 3 calls to the failing URL, ≥1 call to the succeeding URL, `CrawlResult.errors.length === 1`, `CrawlResult.products.length ≥ 1`.

---

## AC-7: bm-verify intercept detection short-circuits the engine

**Maps to**: REQ-006 (sub-clause: bm-verify intercept counts as an error)

**Given**:

- A category URL is configured in `categoryUrls`.
- The Playwright session is mocked (via `page.setContent` or via a fake-fetch wrapper) to return a synthetic HTML body matching the bm-verify intercept signature: HTML body length 2,141 bytes, body content begins with `<!DOCTYPE html><html><head> <meta charset="utf-8"> <meta name="viewport" content="width=device-width, ...> <meta http-equiv="refresh" content="5; URL='/kr/ko/woman-new-in-l1180.html?bm-verify=AAQAAAAN_____...'" />` (the exact intercept HTML captured in research.md §1.3).

**When**:

- The engine attempts to extract products from this URL.

**Then**:

- The engine's bm-verify intercept detector identifies the response as an intercept (HTML body length < 5,000 bytes AND containing the literal string `bm-verify`).
- This counts as a failure for the abort-on-3 counter.
- If the intercept persists for 3 consecutive `page.goto` retries (engine MUST NOT silently re-try without surfacing each as a counted failure), the category is aborted and an error entry is logged with type `bm-verify-intercept`.
- The engine does NOT attempt to "solve" the bm-verify challenge or substitute a fingerprint-evasion library.

**Verification**:

- Unit test against fixture: A test that imports the bm-verify-detector helper function from `zara-engine.ts`, passes the captured 2,141-byte intercept HTML string from a frozen sample (committed to `tests/zara-engine.test.ts` as a string constant during PRESERVE), and asserts the helper returns `{isIntercept: true, reason: "bm-verify"}`.
- Unit test against fixture: A second test that passes a real product DOM HTML (HTML > 5KB, does not contain "bm-verify") and asserts the helper returns `{isIntercept: false}`.

---

## AC-8: ZARA engine respects --rate=N flag within rate-cap policy

**Maps to**: SPEC-001 REQ-007 (reused)

**Given**:

- The `zara-kr` platform is registered with default `crawlDelay: 2000` (2 sec/page baseline).
- SPEC-001 introduced `parseRateFlag` in `src/lib/uniqlo-engine.ts` which validates `--rate=N` against the rate-cap policy (1 ≤ N ≤ 5; integer).

**When**:

- The user runs `pnpm crawl --site=zara-kr --rate=2`.

**Then**:

- The crawler computes per-request delay as `1000 / 2 = 500ms`.
- Note: ZARA's actual elapsed time per category is dominated by Playwright browser overhead (page.goto + scroll + extract typically takes 5-15 seconds), so the `--rate=N` override has limited effect for ZARA — the override sets the inter-category pacing floor, not the per-category execution time. This is a documented difference from Uniqlo (where the engine is fetch-bound and `--rate=N` directly controls request frequency).
- If the user runs `--rate=10` (above rate-cap), the command is rejected at parse time with a clear error message and exit code 1. No browser is launched.

**Verification**:

- Manual verification: Run `pnpm crawl --site=zara-kr --rate=2 --dry-run` and confirm the printed `crawlDelay` reflects 500ms.
- Unit test against fixture: Re-use the SPEC-001 `parseRateFlag` rejection tests for `--rate=10`, `--rate=0`, `--rate=-1`, `--rate=2.5`, `--rate=abc`. No ZARA-specific test addition.

---

## AC-9: Akamai bypass verification (Run-phase HARD precondition)

**Maps to**: REQ-007

**Given**:

- The Run phase ANALYZE step is in progress.
- No production engine code has been written yet.
- `src/lib/zara-engine.ts` does NOT exist (or exists as an empty placeholder).

**When**:

- The operator launches Playwright Chromium with `chromium.launch({headless: "new"})` and navigates 5 sequential times (with 2 sec pacing) to `https://www.zara.com/kr/ko/woman-new-in-l1180.html` from a single Playwright session.

**Then**:

- The page DOM reaches a state where `document.querySelectorAll(".product-grid-product, [data-productid]").length >= 10` within a 30-second timeout.
- This must occur on at least 4 of the 5 sequential `page.goto` invocations (≥80% reliability).
- If reliability is below 80%, the operator MUST invoke a rollback path:
  - Rollback path 1: Open a separate SPEC to introduce Xvfb-in-CI for `headless: false` mode. SPEC-003 is paused until the new SPEC is approved.
  - Rollback path 2: Defer SPEC-003 entirely. Set `disabled: true` on `zara-kr` SiteConfig if it has been added. Notify the project owner.
- The operator MUST NOT introduce a fingerprint-evasion library or otherwise circumvent project HARD rules to compensate for an insufficient `headless: "new"` pass rate.
- If reliability is at or above 80%, the engine is cleared for implementation.

**Verification**:

- Run-phase precondition gate: A scratch script (NOT committed; ephemeral) executes the 5 sequential `page.goto` calls and prints pass/fail per attempt. The operator inspects the output and decides to proceed or escalate.
- Manual verification: A short markdown note at the bottom of `src/lib/zara-engine.ts` (or in `.moai/specs/SPEC-PLATFORM-EXPANSION-003/run-notes.md` if created) documents the verification result: "Akamai bypass verification 2026-MM-DD: 4/5 (or 5/5) passes. Engine cleared for implementation."

---

## AC-10: ZARA KR ToS verification (PRE-SATISFIED at plan phase 2026-05-05)

**Maps to**: REQ-008 (amended v0.2.0)

**Status**: PRE-SATISFIED. Plan-phase verification was performed by project owner (hansangho) on 2026-05-05 by retrieving the canonical ZARA KR ToS PDF (2025-11-25 version) from `static.zara.net/static/pdfs/KR/` and scanning all 11 pages for automation/scraping keywords. Verbatim findings are recorded in research.md §1.2 (verified). Three relevant clauses (§2.1, §6-bullet-2, §15) were reviewed; no explicit anti-scraping clause exists. Verdict: **AMBIGUOUS-ACCEPTED-BY-OWNER**.

**Run-phase task** (narrowed from "verify ToS in browser" to "embed verified clauses"):

- `src/lib/zara-engine.ts` MUST contain a top-of-file comment block in this format:
  ```ts
  /**
   * ZARA KR Terms of Service — pre-verified by project owner 2026-05-05 (hansangho).
   * Source PDF: static.zara.net/static/pdfs/KR/terms-and-conditions/terms-and-conditions-ko_KR-20251125.pdf
   *
   * §2.1 (general use limit):
   * 이용자는 회사에 대한 정당한 요청이나 주문 목적으로만 웹사이트를 이용할 수 있습니다.
   *
   * §6 bullet 2 (automated purchasing — does NOT apply to read-only scraping):
   * 자동구매 소프트웨어 기타 유사한 도구를 사용하여 다중 주문, 반복 구매, 사재기를 하는 행위
   *
   * §15 (IP rights — primary residual risk):
   * 웹사이트 내의 모든 콘텐츠에 대한 저작권, 상표권 등 일체의 지적 재산권은 회사 또는 회사가
   * 권한을 부여한 자에게 귀속됩니다. 이용자는 회사 또는 회사가 권한을 부여한 자의 허락을 받아
   * 해당 콘텐츠를 사용할 수 있습니다. 그러나 이용자가 필요한 범위 내에서 자신의 주문내역
   * 또는 계약 내용을 복사하는 행위는 허용됩니다.
   *
   * Verdict: AMBIGUOUS-ACCEPTED-BY-OWNER
   * Conditions: kiko.ai-internal-use only; halt-on-cease-and-desist; re-verify on ToS PDF
   *             version change OR ITX Korea Limited communication OR > 90 days elapsed.
   * SPEC: SPEC-PLATFORM-EXPANSION-003 REQ-008 (amended v0.2.0)
   */
  ```

**Re-verification triggers** (require Run-phase or post-Run-phase re-check):
- ZARA publishes a new ToS PDF version on `static.zara.net/static/pdfs/KR/` (different from `terms-and-conditions-ko_KR-20251125.pdf`).
- ITX Korea Limited issues direct communication (cease-and-desist, terms update, etc.).
- More than 90 calendar days elapsed between 2026-05-05 and the first production crawl.

**Verification**:

- Manual verification: A reader of `src/lib/zara-engine.ts` can identify within 30 seconds: (a) the verbatim Korean clauses are present, (b) capture date 2026-05-05 and operator hansangho, (c) verdict AMBIGUOUS-ACCEPTED-BY-OWNER, (d) the residual-risk conditions.
- Verification of clause text: Re-fetching the source PDF from the URL and diffing against the embedded text yields zero differences for the three quoted clauses.
- The `zara-kr` SiteConfig entry has `disabled: false` (engine ships live, per owner acceptance).

---

## Definition of Done

This SPEC is considered complete when ALL of the following are true:

- All 10 acceptance criteria above (AC-1 through AC-10) pass their stated verification methods.
- All SPEC-001 AC-1 through AC-7 still pass (no regression to Uniqlo behavior; PlatformType extension is additive only).
- All SPEC-002 AC-1 through AC-8 still pass (no regression to Uniqlo US or FX module behavior).
- `pnpm typecheck` (`tsc --noEmit`) reports zero errors.
- `pnpm test` (the existing `node:test` suite plus the new `tests/zara-engine.test.ts` file) reports zero failures.
- A live `pnpm crawl --site=zara-kr --dry-run` invocation succeeds, reaches real product DOM (NOT bm-verify intercept), and prints a valid sample product with KRW price.
- A live `pnpm crawl --site=zara-kr` invocation succeeds, writes `data/zara-kr-products.json`, and the file contains ≥100 products with non-null required fields and `sourceCurrency: "KRW"`. `CrawlResult.errors.length` is ≤20% of `categoryUrls.length`.
- `src/lib/zara-engine.ts` contains a top-of-file comment block with the verbatim Korean-language ToS clause, the read-date, the operator name, and the verdict (REQ-008 / AC-10).
- `.moai/project/structure.md` is updated to reflect 35 platforms total and to document the ZARA Playwright pattern in the engine-layering subsection.
- The Run phase has not introduced any new production dependency or devDependency beyond what is in `tech.md` (Playwright is reused; `node:test` is reused).
- No fingerprint-evasion library has been introduced. No IP rotation, no proxy pool, no CAPTCHA-solving service, no authenticated scraping. Project HARD rules preserved.
- The `zara-kr` SiteConfig entry is appropriately set: `disabled: false` if the engine ships live, OR `disabled: true` if AC-10 verdict was "FORBIDS" and the engine ships shelved with audit evidence.

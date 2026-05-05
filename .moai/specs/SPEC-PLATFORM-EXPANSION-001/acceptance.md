# Acceptance Criteria: SPEC-PLATFORM-EXPANSION-001

This document defines Given-When-Then acceptance scenarios for SPEC-PLATFORM-EXPANSION-001 (Uniqlo Engine + Platform Onboarding Hardening). Each scenario is mapped to one or more EARS requirements from `spec.md` and includes a concrete verification method.

Verification methods used in this document:

- **Unit test against fixture**: Runs as part of the `node:test` suite (`pnpm test`). Uses the frozen `tests/fixtures/uniqlo-kr-products.fixture.json` as input. Deterministic, repeatable.
- **Integration test with `--probe`**: Runs the actual `pnpm crawl --probe=uniqlo-kr` command against the live Uniqlo API. Non-deterministic (depends on live API state). Run manually before production cut-in.
- **Manual verification**: A one-time check by the operator inspecting command output, file existence, or filesystem state. Not part of automated CI.

---

## AC-1: Uniqlo platform registers and dispatches to the new engine

**Maps to**: REQ-001

**Given**:

- The `uniqlo-kr` SiteConfig entry exists in `src/configs/platforms.ts` with `type: "uniqlo"`, `key: "uniqlo-kr"`, `baseUrl: "https://www.uniqlo.com/kr/ko"`, and a non-empty hardcoded `apiCategoryPaths: string[]` listing at minimum the WOMEN, MEN, and KIDS top-level path codes.
- `PlatformType` in `src/lib/types.ts` line 53 is the union `"cafe24" | "shopify" | "uniqlo"`.

**When**:

- The user runs `pnpm crawl --site=uniqlo-kr` (or any invocation that loads the registered platforms).

**Then**:

- The `runCrawl` function in `src/crawl.ts` partitions the SiteConfig and routes the entry to the new `crawlUniqlo` function in `src/lib/uniqlo-engine.ts`. Neither `crawlShopify` nor `crawlCafe24` is invoked for this platform key.
- The `pnpm crawl --list` output includes a row for `uniqlo-kr` with type `uniqlo`.

**Verification**:

- Manual verification via `pnpm crawl --list` showing the new row.
- Unit test against fixture: assert that `getPlatformsByType("uniqlo")` returns exactly one entry and that entry's `key` is `"uniqlo-kr"`.

---

## AC-2: Full crawl writes JSON cache with rate limiting and characterization-test parity

**Maps to**: REQ-002, REQ-006

**Given**:

- The Uniqlo API endpoint is reachable and returns JSON matching the documented shape (`{result:{items[], pagination, aggregations}}`) for at least one path in `apiCategoryPaths`.
- The frozen fixture at `tests/fixtures/uniqlo-kr-products.fixture.json` contains a real captured Uniqlo response of approximately 50 to 100 products from one category page.

**When**:

- The user runs `pnpm crawl --site=uniqlo-kr` (no `--dry-run` flag).
- Separately, the user runs `pnpm test` to execute the `node:test` characterization suite.

**Then**:

- Live run: The crawler iterates over every path in `apiCategoryPaths`, paginating each via the `offset` query parameter (incrementing by `limit=100`), terminates each path's loop when `pagination.count === 0` or `offset >= pagination.total`, paces requests at 1 per second (1000ms minimum interval verified by timing log), rotates through the 5-element User-Agent list (one UA per request, round-robin), and writes the aggregated result to `data/uniqlo-kr-products.json`.
- Characterization suite: Loads the frozen fixture, runs the engine's parse path against it, and asserts that the resulting `Product[]` array has length matching the fixture's expected product count, every element has populated `name`, `imageUrl`, `productUrl`, and `price` (KRW number) fields, and every `imageUrl` value matches the Uniqlo image-host whitelist (`image.uniqlo.com` or `asset.uniqlo.com` only). The assertion count must match the fixture's known product count exactly (no silent truncation).

**Verification**:

- Unit test against fixture: `pnpm test` runs the characterization suite. All assertions must pass. This is the primary automated verification for REQ-006.
- Integration test (manual, periodic): Run the live crawl once, hand-inspect `data/uniqlo-kr-products.json` for at least 100 products with non-null required fields, and confirm `errors` array is empty for all categories.
- Timing verification: The characterization suite includes a timing test that calls the rate-limited request helper 5 times and asserts elapsed time is `>= 4000ms` (4 intervals of 1000ms minimum).

---

## AC-3: Dry-run prints sample without writing to disk

**Maps to**: REQ-003

**Given**:

- The `uniqlo-kr` platform is registered and reachable.
- The `data/uniqlo-kr-products.json` file does NOT exist before this scenario runs (precondition: delete the file if it exists, or run in a clean state).

**When**:

- The user runs `pnpm crawl --site=uniqlo-kr --dry-run`.

**Then**:

- The crawler invokes the `probeSite` branch for `type === "uniqlo"`.
- Exactly one HTTP request is made to the Uniqlo API with `limit=1` (verified by network log or inline counter).
- A sample product summary is printed to stdout, including at minimum the keys `name`, `productCode`, `prices.base.value`, and `productUrl`.
- The file `data/uniqlo-kr-products.json` is NOT created. Filesystem state of the `data/` directory is unchanged from before the invocation.

**Verification**:

- Integration test with `--probe`: Run the command in a clean state, capture stdout, and assert `data/uniqlo-kr-products.json` does not exist after exit.
- Unit test against fixture: A test that mocks `fetch` to return the fixture and runs the probe handler can assert that no `fs.writeFile` call is made for the cache path. (Verified via spy / jest.fn-style assertion using `node:test`'s built-in mock module.)

---

## AC-4: robots.txt blanket-Disallow blocks the crawl with a clear error

**Maps to**: REQ-004

**Given**:

- A hypothetical platform exists in `src/configs/platforms.ts` whose `baseUrl` resolves to a `robots.txt` containing the verbatim sequence `User-agent: *\nDisallow: /` (the exact form Musinsa publishes per research.md §2.4 [^m1]).
- For the test, this scenario uses a mocked `fetch` that returns this canned `robots.txt` body for the relevant URL.

**When**:

- The user runs `pnpm crawl --site=<that-platform>` OR the platform-registration validator runs at startup.

**Then**:

- The `robots-check.ts` helper detects the blanket `Disallow: /` rule under the `User-agent: *` group.
- The crawler emits a clear error message including the platform `key`, the offending verbatim line from `robots.txt`, and a reference to project HARD rule #1.
- The crawler exits with a non-zero status code BEFORE any product fetch is attempted. No request to `/products.json`, `/api/...`, or any product URL is made.
- The check applies regardless of `type`. It is engine-agnostic.

**Verification**:

- Unit test against fixture: A test that constructs a synthetic `robots.txt` body matching the Musinsa pattern, passes it through `robots-check.ts`, and asserts the result is `{ allowed: false, blockingLine: "Disallow: /" }`.
- Unit test against fixture: A second test that runs `crawlUniqlo` with a mocked `robots.txt` returning the blanket-disallow form and asserts that no API request is made (verified via `fetch` mock call count).

---

## AC-5: 3 consecutive HTTP errors abort the category and surface in CrawlResult

**Maps to**: REQ-005

**Given**:

- The Uniqlo API is mocked (in the test harness) to return HTTP 503 for the first 3 requests to a specific category path, then HTTP 200 for any subsequent request.
- The `uniqlo-kr` SiteConfig has at least 2 paths in `apiCategoryPaths` so that the engine can demonstrate continuing past the failed category.

**When**:

- The crawler runs and reaches the failing category.

**Then**:

- After the 3rd consecutive 503 response, the engine aborts the failing category (does not make a 4th request to that path).
- "Consecutive" means without an intervening 2xx response on the same category path; non-consecutive errors interleaved with successes do not trigger abort.
- The aborted category contributes one entry to `CrawlResult.errors` containing the category path, the HTTP status (503), the request URL, and a timestamp.
- The engine continues with the next path in `apiCategoryPaths`. The successful subsequent path produces normal `Product` entries in `CrawlResult.products`.
- After all categories are processed, the partial result is written to `data/uniqlo-kr-products.json`. The `errors` array length is at least 1; the `products` array contains entries from the non-failed paths.
- No infinite retry loop occurs. No IP rotation or evasion technique is invoked.

**Verification**:

- Unit test against fixture: A test that uses `node:test`'s mock-fetch capability to canned-respond with 3 sequential 503s followed by a 200, runs the engine, and asserts exactly 3 fetch calls were made to the failing path and `CrawlResult.errors.length >= 1`.

---

## AC-6: --rate=N flag overrides default pacing within the rate-cap policy

**Maps to**: REQ-007

**Given**:

- The `uniqlo-kr` platform is registered with default `crawlDelay: 1000` (1 req/sec).
- The fetch handler in the test harness is instrumented to record the elapsed time between consecutive requests.

**When**:

- The user runs `pnpm crawl --site=uniqlo-kr --rate=2`.

**Then**:

- The crawler computes per-request delay as `1000 / 2 = 500ms`.
- Observed inter-request elapsed time is greater than or equal to 500ms (allowing a small jitter tolerance, e.g., +/-50ms in the test).
- The override applies for the duration of this invocation only. Re-running without `--rate` reverts to 1 req/sec.
- If the user runs `--rate=10` (above the rate-cap of N=5), the command is rejected at parse time with a clear error message and exit code 1. No fetch is attempted.

**Verification**:

- Unit test against fixture: A timing test that mocks `fetch`, sets `--rate=2`, makes 4 sequential requests, and asserts the total elapsed time is between 1500ms and 1700ms (3 intervals of approximately 500ms each).
- Unit test against fixture: A second test that passes `--rate=10` to the command parser and asserts the parse function returns an error containing the rate-cap policy reference.
- Verification also includes parse-rejection for `--rate=0`, `--rate=-1`, `--rate=2.5`, `--rate=abc`.

---

## AC-7: Empty category returns gracefully with no error

**Maps to**: REQ-002 edge case

**Given**:

- A category path is registered in `apiCategoryPaths` whose API response has `pagination.total: 0` and `items: []` (i.e., a hardcoded category that returned 0 products on this run, perhaps because the catalog was depleted or the category was renamed upstream).

**When**:

- The crawler reaches this category during a normal run.

**Then**:

- The engine logs the empty result (e.g., `info: category=<path> returned 0 products`) and continues to the next category without raising an error.
- The `CrawlResult.errors` array does not gain a new entry from this empty result. (Empty is not the same as failed.)
- The final `data/uniqlo-kr-products.json` file is written normally, containing products from the non-empty categories.
- The crawler does NOT abort the category iteration; it does NOT count the empty response toward the 3-consecutive-error threshold of REQ-005.

**Verification**:

- Unit test against fixture: A test that mocks the API to return `{result:{items:[], pagination:{total:0, offset:0, count:0}, aggregations:{}}}` for one path and verifies (a) the engine's loop terminates after one request, (b) `CrawlResult.errors.length` is unchanged, and (c) the engine proceeds to the next path.

---

## Definition of Done

This SPEC is considered complete when ALL of the following are true:

- All seven acceptance criteria above (AC-1 through AC-7) pass their stated verification methods.
- `pnpm typecheck` (`tsc --noEmit`) reports zero errors.
- `pnpm test` (the new `node:test` suite) reports zero failures.
- A live `pnpm crawl --probe=uniqlo-kr` invocation succeeds and prints a valid sample product.
- A live `pnpm crawl --site=uniqlo-kr` invocation succeeds, writes `data/uniqlo-kr-products.json`, and the file contains at least 100 products with non-null required fields.
- `.moai/project/structure.md` "Adding a New Platform" checklist is updated to include the `robots.txt` verification step.
- The Run phase has not introduced any new production dependency beyond what is in `tech.md`.
- ~~The 7-day soak window (from the first successful production run forward) has been initiated; this window's outcome gates whether SPEC-PLATFORM-002 can be opened.~~ **AMENDED 2026-05-05: soak gate removed by user direction. Follow-up SPECs may proceed once dry-run + characterization tests are green; see plan.md §2.4.**

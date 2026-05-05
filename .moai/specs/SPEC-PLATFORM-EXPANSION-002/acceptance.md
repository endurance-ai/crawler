# Acceptance Criteria: SPEC-PLATFORM-EXPANSION-002

This document defines Given-When-Then acceptance scenarios for SPEC-PLATFORM-EXPANSION-002 (Uniqlo US Engine Extension). Each scenario is mapped to one or more EARS requirements from `spec.md` and includes a concrete verification method.

This SPEC inherits acceptance scenarios from SPEC-PLATFORM-EXPANSION-001 for the rate-limit, dry-run, robots-check, abort-on-error, and `--rate=N` override behaviors. SPEC-001's AC-1 through AC-7 are NOT re-stated here. The scenarios below are SPEC-002-specific deltas covering the region-parameter refactor, FX module lift, USD→KRW import-time conversion, US SiteConfig registration, shared characterization fixtures, and the binding gate-override mitigation.

Verification methods used in this document:

- **Unit test against fixture**: Runs as part of the `node:test` suite (`pnpm test`). Uses frozen fixtures `tests/fixtures/uniqlo-kr-products.fixture.json` and `tests/fixtures/uniqlo-us-products.fixture.json` as inputs. Deterministic, repeatable.
- **Integration test with `--probe`**: Runs `pnpm crawl --site=uniqlo-us --probe` (dry-run) against the live Uniqlo US API. Non-deterministic (depends on live API state). Run manually before production cut-in.
- **Manual verification**: A one-time check by the operator inspecting command output, file existence, or filesystem state. Not part of automated CI.
- **Snapshot diff**: Capture outputs before a refactor step, capture after, diff numerically. Used for the FX module lift (REQ-005).

---

## AC-1: Uniqlo US platform registers and dispatches to the shared engine with region="US"

**Maps to**: REQ-001

**Given**:

- The `uniqlo-us` SiteConfig entry exists in `src/configs/platforms.ts` with `key: "uniqlo-us"`, `name: "유니클로 (US)"` (or equivalent), `type: "uniqlo"`, `baseUrl: "https://www.uniqlo.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 1000`, and a non-empty hardcoded `apiCategoryPaths: string[]` array containing at minimum the four US gender top-level codes (`"22210,,,"`, `"22211,,,"`, `"22212,,,"`, `"22213,,,"`).
- The `uniqlo-kr` SiteConfig entry exists with `region: "KR"` explicitly set.
- `PlatformType` in `src/lib/types.ts` line 53 remains the union `"cafe24" | "shopify" | "uniqlo"` (no new union member; SPEC-002 reuses `"uniqlo"`).
- `SiteConfig` interface in `src/lib/types.ts` includes the new optional `region?: "KR" | "US"` field.

**When**:

- The user runs `pnpm crawl --site=uniqlo-us` (or any invocation that loads the registered platforms).

**Then**:

- The `runCrawl` function in `src/crawl.ts` partitions the SiteConfig and routes both `uniqlo-kr` and `uniqlo-us` entries to the same `crawlUniqlo` function in `src/lib/uniqlo-engine.ts`. Neither `crawlShopify` nor `crawlCafe24` is invoked for the US key.
- The engine reads `config.region === "US"` and constructs the API URL `https://www.uniqlo.com/us/api/commerce/v5/en/products?...` (NOT the KR path).
- The `pnpm crawl --list` output includes a row for `uniqlo-us` with type `uniqlo` and region `US`.

**Verification**:

- Manual verification via `pnpm crawl --list` showing the new row.
- Unit test against fixture: assert that `getPlatformsByType("uniqlo")` returns exactly two entries (`uniqlo-kr` and `uniqlo-us`) and that each has the correct `region` field.
- Integration test with `--probe`: `pnpm crawl --site=uniqlo-us --dry-run` exits 0 and prints a sample product whose `prices.base.currency.code` is `"USD"` (confirms US API path was used, not KR).

---

## AC-2: Region parameter refactor preserves KR behavior bit-for-bit

**Maps to**: REQ-002

**Given**:

- The `tests/fixtures/uniqlo-kr-products.fixture.json` from SPEC-001 is unmodified.
- The KR-specific assertions from the SPEC-001 characterization-test suite are unmodified.
- The `uniqlo-kr` SiteConfig entry has been updated to add `region: "KR"` explicitly but is otherwise unchanged.

**When**:

- The user runs `pnpm test`.

**Then**:

- Every existing SPEC-001 KR assertion continues to pass without modification: every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, `price`; every `imageUrl` matches `image.uniqlo.com` or `asset.uniqlo.com`; the resulting `Product.sourceCurrency` is `"KRW"`; the `priceFormatted` field uses `ko-KR` locale formatting (e.g., `₩19,900`).
- The engine source code contains NO hardcoded `"kr/ko"`, `"KRW"`, or `"ko-KR"` literal strings; all three are functions of `config.region`.

**Verification**:

- Unit test against fixture: re-run the KR-only subset of `tests/uniqlo-engine.test.ts` post-refactor; all SPEC-001 assertions pass.
- Manual verification: grep `src/lib/uniqlo-engine.ts` for `"kr/ko"`, `"KRW"`, `"ko-KR"` — should match zero times after the refactor (matches inside JSDoc comments do not count).

---

## AC-3: Live US crawl writes USD-native cache file with shared engine

**Maps to**: REQ-003, REQ-007

**Given**:

- The Uniqlo US API endpoint is reachable and returns JSON matching the documented shape for at least one path in the US `apiCategoryPaths`.
- The frozen fixture at `tests/fixtures/uniqlo-us-products.fixture.json` contains a real captured Uniqlo US response of approximately 50 to 100 products from one US category page.

**When**:

- The user runs `pnpm crawl --site=uniqlo-us` (no `--dry-run` flag).
- Separately, the user runs `pnpm test` to execute the parameterized `node:test` characterization suite.

**Then**:

- Live run: The crawler iterates over every path in the US `apiCategoryPaths`, paginating each via the `offset` query parameter (incrementing by `limit=100`), terminates each path's loop when `pagination.count === 0` or `offset >= pagination.total`, paces requests at 1 per second, rotates through the shared 5-element User-Agent list, and writes the aggregated result to `data/uniqlo-us-products.json`.
- The cache file's `Product[]` entries have `sourceCurrency: "USD"`. The `price` field contains the **native USD decimal value** as returned by the API (e.g., `29.9` for $29.90), NOT a KRW-converted integer.
- Characterization suite: Loads BOTH fixtures (KR and US), runs the engine's parse path against each, and asserts that for each fixture every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, `price`, and that every `imageUrl` matches the shared Uniqlo image-host whitelist. For the US fixture specifically, the suite also asserts `Product.sourceCurrency === "USD"` and that `Product.price` is a positive decimal number.

**Verification**:

- Unit test against fixture: `pnpm test` runs the parameterized suite. All assertions on both fixtures must pass.
- Integration test (manual, periodic): Run `pnpm crawl --site=uniqlo-us` once, hand-inspect `data/uniqlo-us-products.json` for at least 100 products with non-null required fields, confirm `sourceCurrency: "USD"` on every entry, confirm `price` values are decimal floats (not integers), and confirm `errors` array is empty.
- Timing verification (inherited from SPEC-001 AC-2): the rate-limited request helper paces at >= 1000ms per request.

---

## AC-4: Import-time USD→KRW conversion produces integer KRW upsert payload

**Maps to**: REQ-004

**Given**:

- A cache file `data/uniqlo-us-products.json` exists containing at least 10 `Product` entries with `sourceCurrency: "USD"` and `price` values such as `29.9`, `19.9`, `49.9`.
- The shared FX module `src/lib/fx.ts` exports `FX_TO_KRW` containing `USD: 1430`.

**When**:

- The user runs `pnpm tsx src/import-products.ts` (or the equivalent import command).

**Then**:

- The import script reads each `Product` entry from the cache file.
- For every entry where `sourceCurrency === "USD"`, the upsert payload's `price` field is computed as `Math.round(product.price * 1430)` (e.g., `29.9 USD` → `42757 KRW`).
- The upsert payload's `original_price` field, if the source `Product.original_price` is non-null, is converted the same way.
- The cached on-disk `Product.price` value is unchanged (the conversion is in-memory only).
- The Supabase upsert succeeds and the resulting `products.price` row contains the KRW integer.
- For any product where `convertToKrw` returns `null` (unknown currency code), the import script emits a warning to stdout and skips the upsert for that single product. The remaining products continue to import.

**Verification**:

- Unit test against fixture: Construct a synthetic in-memory cache containing 5 USD products and 1 product with an unknown currency code (`sourceCurrency: "ZZZ"`). Run the upsert mapping branch of `import-products.ts` (mocking the Supabase client). Assert the upsert payload for USD products contains integer KRW prices matching `Math.round(price * 1430)`. Assert the unknown-currency product is skipped with a warning.
- Manual verification: After a live US import, run `select count(*), platform from products where platform = 'uniqlo-us' group by platform` against Supabase; count matches the cache file's product count minus skipped entries. Inspect 5 random rows; confirm `price` is an integer KRW value, not a USD decimal.

---

## AC-5: FX module lift preserves Shopify engine outputs numerically

**Maps to**: REQ-005

**Given**:

- A pre-lift snapshot is captured: `pnpm crawl --probe=<existing-shopify-USD-platform>` is run before the FX module lift, and the printed sample product's `priceKrw` (or equivalent computed KRW field) value is recorded.
- The FX module lift is then applied: `FX_TO_KRW`, `CURRENCY_SYMBOL`, `CURRENCY_TO_COUNTRY`, `convertToKrw` are moved verbatim from `src/lib/shopify-engine.ts:11-41` to `src/lib/fx.ts`. `shopify-engine.ts` re-imports them.

**When**:

- The user runs the same `pnpm crawl --probe=<existing-shopify-USD-platform>` post-lift.

**Then**:

- The post-lift sample product's `priceKrw` value is numerically identical to the pre-lift value (same `srcPrice * 1430` computation, same `Math.round`).
- A full re-run of `pnpm test` (which previously did not exercise the FX module directly but does exercise it transitively via Shopify-related tests if any exist) shows zero new failures.
- `tsc --noEmit` reports zero errors.

**Verification**:

- Snapshot diff: Capture pre-lift `pnpm crawl --probe=<shopify-USD-platform>` stdout into a temp file. Apply the lift. Re-run the same command, capture into another temp file. `diff` the two — expected: zero differences in numerical fields.
- Unit test against fixture (optional): Add a dedicated `tests/fx.test.ts` (small, ~20 LOC) that imports `convertToKrw` from `src/lib/fx.ts` and asserts `convertToKrw(29.9, "USD") === 42757`, `convertToKrw(19.9, "USD") === 28457`, `convertToKrw(100, "EUR") === 156000`, `convertToKrw(100, "GBP") === 175000`, `convertToKrw(100, "ZZZ") === null`.

---

## AC-6: US robots.txt blanket-Disallow check passes; verified known-good baseUrl documented

**Maps to**: REQ-006

**Given**:

- The Uniqlo US robots.txt at `https://www.uniqlo.com/robots.txt` `#US` block contains only narrow Disallow rules (`/us/en/cms`, `/us/en/size/*`, `/us/en/search`, `/us/en/news/search`, `/us/en/news/sp/search`, `/us/en/*?avoidNextModelRedirect=true`, `/us/en/*/reviews/new`) and does NOT contain a verbatim `Disallow: /` rule under `User-agent: *` — verified via the live fetch documented in research.md §1 [^u-us1].
- The documentary allowlist comment in `src/lib/robots-check.ts` lists `uniqlo.com/us/en` alongside `uniqlo.com/kr/ko` as a verified known-good baseUrl.

**When**:

- The user runs `pnpm crawl --site=uniqlo-us` (with or without `--dry-run`) at any point.

**Then**:

- The crawler invokes `robots-check.ts`, fetches `https://www.uniqlo.com/robots.txt`, and the blanket-disallow detector returns `{ allowed: true }`.
- The crawler proceeds to make the API request to `/us/api/commerce/v5/en/products`.
- No spurious error is emitted; no `CrawlResult.errors` entry is added for robots-related reasons.

**Verification**:

- Integration test with `--probe`: Run `pnpm crawl --site=uniqlo-us --dry-run` against the live API; confirm no robots-related error in stdout/stderr.
- Unit test against fixture: A test that constructs a synthetic `robots.txt` body matching the live US `#US` block (full-text quoted from research.md [^u-us1]), passes it through `robots-check.ts`, and asserts the result is `{ allowed: true }`. Pair with the existing SPEC-001 negative test (synthetic Musinsa-pattern blanket-disallow → `{ allowed: false }`) to confirm the check is still discriminating after any allowlist edit.

---

## AC-7: Shared characterization-test parity is binding (gate-override mitigation)

**Maps to**: REQ-007, REQ-008

**Given**:

- Both fixtures exist: `tests/fixtures/uniqlo-kr-products.fixture.json` (from SPEC-001) and `tests/fixtures/uniqlo-us-products.fixture.json` (new, captured for SPEC-002).
- The test suite at `tests/uniqlo-engine.test.ts` is parameterized: every shared assertion runs against both fixtures.

**When**:

- The user runs `pnpm test`.
- Separately, a hypothetical regression is introduced: a defensive null-check in the engine's image-URL parser is removed, causing one US-fixture product's `imageUrl` to be the literal string `"undefined"`.

**Then**:

- Healthy state: `pnpm test` exits 0 with all assertions passing on both fixtures.
- Regressed state: `pnpm test` exits non-zero. The failure message identifies the US fixture and the specific assertion that failed (e.g., `imageUrl matches whitelist`). The failure does NOT propose splitting the engine into separate KR/US modules; the contract per REQ-008 is "treat as shared-engine regression."
- The CI gate / pre-merge check blocks the merge until the regression is fixed.

**Verification**:

- Unit test against fixture: Run `pnpm test` on the shipped tree → exit 0.
- Negative test (simulated regression): Manually introduce a temporary regression in the engine source (e.g., comment out the image-host whitelist call), re-run `pnpm test`, confirm exit code is non-zero and the failure message identifies the US fixture by name. Restore the source after verification.
- Manual verification: Inspect the test file source to confirm the parameterization loop iterates over both fixture paths and that no fixture-specific bypass exists (no `if (region === "KR") skip(...)` patterns).

---

## AC-8: Gate override is documented; SPEC-002 ships without waiting for SPEC-001 soak

**Maps to**: spec.md HISTORY, Overview (Gate Override Justification subsection)

**Given**:

- SPEC-001 §2.4 defines a 7-day Uniqlo KR soak entry condition for any sibling SPEC.
- SPEC-002's HISTORY entry (v0.1.0) explicitly states that the gate is bypassed and lists the four user-confirmed decisions.
- SPEC-002's Overview contains a "Gate Override Justification" subsection citing the structural-sibling argument and the binding mitigation (REQ-007 + REQ-008).

**When**:

- The user (or a future auditor) reads SPEC-002.

**Then**:

- The reader can identify within 30 seconds that SPEC-002 ships in parallel with SPEC-001 rather than after its soak window.
- The reader can identify the explicit mitigation: shared characterization fixtures (KR + US) on every test run, with binding REQ-008 blocking deployment on either fixture's failure.
- The reader can identify that the override is **specific to SPEC-002** and does NOT propagate to ZARA / 29CM (which retain the original SPEC-001 entry condition).

**Verification**:

- Manual verification: A reader unfamiliar with the gate-override conversation reads `spec.md` HISTORY + Overview cold and identifies all three points above. If the document fails to make any of the three points clear, the document is amended before merge.

---

## Definition of Done

This SPEC is considered complete when ALL of the following are true:

- All eight acceptance criteria above (AC-1 through AC-8) pass their stated verification methods.
- All SPEC-001 AC-1 through AC-7 still pass (KR behavior is preserved bit-for-bit).
- `pnpm typecheck` (`tsc --noEmit`) reports zero errors.
- `pnpm test` (the parameterized `node:test` suite) reports zero failures across both KR and US fixtures.
- A live `pnpm crawl --site=uniqlo-us --dry-run` invocation succeeds and prints a valid US sample product with `prices.base.currency.code === "USD"`.
- A live `pnpm crawl --site=uniqlo-us` invocation succeeds, writes `data/uniqlo-us-products.json`, and the file contains at least 100 products with non-null required fields and `sourceCurrency: "USD"`.
- A live `pnpm tsx src/import-products.ts` invocation against the US cache succeeds; spot-checking 5 Supabase rows confirms integer KRW prices.
- A live `pnpm crawl --probe=<existing-shopify-USD-platform>` invocation produces numerically identical output before and after the FX module lift (REQ-005 / AC-5).
- `src/lib/uniqlo-engine.ts` contains zero hardcoded `"kr/ko"`, `"KRW"`, or `"ko-KR"` literals (region-parameter refactor verified).
- `.moai/project/structure.md` is updated to mention SPEC-002 in the platform table and document the per-region engine pattern.
- The Run phase has not introduced any new production dependency or devDependency beyond what is in `tech.md` (FX module lift is code reorganization, not a new dependency).
- The gate-override mitigation (shared characterization fixtures with binding REQ-008) is verifiably in place: both fixtures are loaded, the parameterization loop runs assertions on both, and a simulated regression on the US fixture causes test failure.

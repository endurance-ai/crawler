# SPEC-PLATFORM-EXPANSION-001 — Compact (Run-phase Reference)

Run-phase optimized extract of `spec.md` and `acceptance.md`. No narrative. Use this file as the primary reference during `/moai run`.

---

## Requirements

### REQ-001 [Ubiquitous]

THE crawler SHALL register Uniqlo KR as a platform with `key: "uniqlo-kr"`, `type: "uniqlo"`, `baseUrl: "https://www.uniqlo.com/kr/ko"` in `src/configs/platforms.ts`. The SiteConfig entry SHALL include a hardcoded `apiCategoryPaths: string[]` listing WOMEN, MEN, KIDS top-level path codes plus their direct sub-categories (outerwear, jackets, knitwear, T-shirts, shirts, pants, jeans, dresses, skirts, innerwear, lounge, accessories). The exact path codes will be enumerated in `src/configs/platforms.ts` `apiCategoryPaths` array — see §Files Affected. Sitemap-driven discovery is NOT used for v1.

### REQ-002 [Event-driven]

WHEN `pnpm crawl --site=uniqlo-kr` is invoked without `--dry-run`, THE crawler SHALL fetch from `https://www.uniqlo.com/kr/api/commerce/v5/ko/products` for each path in `apiCategoryPaths`, paginate by `offset` (incrementing by `limit=100`) until `pagination.count === 0` or `offset >= pagination.total`, and write the result to `data/uniqlo-kr-products.json`. Each request SHALL be paced at 1 req/sec (1000ms `crawlDelay` baseline) and SHALL rotate through 5 hardcoded realistic Mozilla User-Agent strings (one per request, round-robin).

### REQ-003 [Event-driven]

WHEN `pnpm crawl --site=uniqlo-kr --dry-run` is invoked, THE crawler SHALL invoke the probe handler — fetching the API with `limit=1` (one request only), parsing the JSON shape, printing a sample product summary to stdout — and SHALL NOT write `data/uniqlo-kr-products.json`. The dry-run SHALL NOT modify any file in `data/`.

### REQ-004 [State-driven]

WHILE registering a new platform OR starting a crawl, THE crawler SHALL fetch the target's `robots.txt` and SHALL refuse to proceed if the `User-agent: *` group contains a verbatim `Disallow: /` rule. The check applies to ALL platforms regardless of `type`. On block, emit a clear error message (platform key, blocking line, project HARD rule #1 reference) and exit non-zero before any product fetch.

### REQ-005 [Unwanted Behavior]

IF the Uniqlo API returns HTTP 4xx or 5xx for 3 consecutive page requests within a single category iteration, THEN THE crawler SHALL abort that category, append the error to `CrawlResult.errors` (category path, HTTP status, request URL, timestamp), and continue with the next category. Consecutive means without an intervening 2xx response on the same category path; non-consecutive errors interleaved with successes do not trigger abort. SHALL NOT retry indefinitely, SHALL NOT silently swallow, SHALL NOT rotate IP. After all categories processed, write partial result to `data/uniqlo-kr-products.json`.

### REQ-006 [Ubiquitous]

THE Uniqlo engine SHALL ship with a characterization-test suite using Node's built-in `node:test` runner, executed via `node --test --import tsx ./tests/*.test.ts` (added as `"test"` script in `package.json`). The suite SHALL load a frozen JSON fixture at `tests/fixtures/uniqlo-kr-products.fixture.json` and SHALL assert that the engine's parse path produces a `Product[]` with populated `name`, `imageUrl`, `productUrl`, `price`, and that every `imageUrl` matches the Uniqlo image-host whitelist. NO new devDependency.

### REQ-007 [Optional Feature]

WHERE the operator invokes the crawler with `--rate=N`, THE crawler SHALL override the SiteConfig `crawlDelay` for that invocation only, computing per-request delay as `1000 / N` ms. Values of N greater than 5 SHALL be rejected at command-parse time with a clear error message. Values of N ≤ 0 or non-integer N (e.g., 2.5, "abc") SHALL also be rejected at command-parse time with a clear error message. Default behavior (no flag) remains 1 req/sec per REQ-002.

---

## Acceptance Criteria

### AC-1 (REQ-001)

- **Given**: `uniqlo-kr` SiteConfig with `type: "uniqlo"` exists in `platforms.ts`; `PlatformType` extended to include `"uniqlo"`.
- **When**: User runs `pnpm crawl --site=uniqlo-kr`.
- **Then**: `runCrawl` dispatches to `crawlUniqlo`. Neither `crawlShopify` nor `crawlCafe24` is invoked. `pnpm crawl --list` shows the new row.
- **Verification**: Unit test (`getPlatformsByType("uniqlo")` returns 1 entry); manual `--list` check.

### AC-2 (REQ-002 + REQ-006)

- **Given**: Uniqlo API reachable; frozen fixture at `tests/fixtures/uniqlo-kr-products.fixture.json` with 50-100 products.
- **When**: User runs `pnpm crawl --site=uniqlo-kr` (live); separately `pnpm test`.
- **Then**: Live: iterates `apiCategoryPaths`, paginates `offset+=100`, terminates at `count===0` or `offset>=total`, paces at 1 req/sec, rotates 5-UA list, writes `data/uniqlo-kr-products.json`. Tests: parse path produces `Product[]` matching fixture count; every element has `name`, `imageUrl`, `productUrl`, `price`; every `imageUrl` matches whitelist.
- **Verification**: `pnpm test` (primary). Manual integration test against live API. Timing test asserts 5 calls take >= 4000ms.

### AC-3 (REQ-003)

- **Given**: `uniqlo-kr` registered; `data/uniqlo-kr-products.json` does not exist.
- **When**: User runs `pnpm crawl --site=uniqlo-kr --dry-run`.
- **Then**: Exactly one HTTP request with `limit=1`. Sample product printed to stdout (`name`, `productCode`, `prices.base.value`, `productUrl`). `data/uniqlo-kr-products.json` is NOT created.
- **Verification**: Integration test with `--probe`; unit test mocks `fetch` and asserts no `fs.writeFile` for cache path.

### AC-4 (REQ-004)

- **Given**: Mocked platform whose `robots.txt` contains `User-agent: *\nDisallow: /` (Musinsa pattern).
- **When**: User runs crawl OR registration validator runs.
- **Then**: `robots-check.ts` detects blanket `Disallow: /`. Error emitted (platform key, offending line, HARD rule #1 ref). Exit non-zero. NO API request made. Engine-agnostic check.
- **Verification**: Unit test on synthetic `robots.txt` body; unit test verifies zero `fetch` calls to API.

### AC-5 (REQ-005)

- **Given**: Mocked Uniqlo API returns HTTP 503 for first 3 requests to one category path, HTTP 200 thereafter; `apiCategoryPaths` has at least 2 paths.
- **When**: Crawler runs and reaches failing category.
- **Then**: After 3rd 503, engine aborts that category (no 4th request). `CrawlResult.errors` gains 1 entry (path, status 503, URL, timestamp). Next path proceeds normally. Partial result written. No infinite retry, no IP rotation.
- **Verification**: Unit test with mocked-fetch sequence; assert exactly 3 fetch calls to failing path; `errors.length >= 1`.

### AC-6 (REQ-007)

- **Given**: `uniqlo-kr` registered with default `crawlDelay: 1000`; fetch handler instrumented for timing.
- **When**: User runs `pnpm crawl --site=uniqlo-kr --rate=2`.
- **Then**: Per-request delay = `1000/2 = 500ms`. Observed inter-request elapsed >= 500ms (jitter tolerance +/-50ms). `--rate=10` is rejected at parse time (above N=5 cap) with non-zero exit.
- **Verification**: Timing test mocks `fetch`, makes 4 calls with `--rate=2`, asserts total elapsed in [1500ms, 1700ms]. Parser test asserts `--rate=10` returns rate-cap error.

### AC-7 (Edge case for REQ-002)

- **Given**: A category path returns `pagination.total: 0` and `items: []`.
- **When**: Crawler reaches this category.
- **Then**: Engine logs empty result, continues to next category. `CrawlResult.errors.length` unchanged (empty != failed). Empty does NOT count toward REQ-005 3-consecutive-error threshold. Final JSON written normally.
- **Verification**: Unit test mocks API for one path with empty response; asserts (a) loop terminates after 1 request, (b) `errors.length` unchanged, (c) engine proceeds to next path.

---

## Files to Modify

| File | Action | Est. LOC | Purpose |
|---|---|---|---|
| `src/lib/uniqlo-engine.ts` | NEW | ~200 | Fetch-pagination engine; JSON-to-Product mapper; image-host whitelist; UA rotation list; 1 req/sec pacing |
| `src/lib/types.ts` | MODIFY | ~6 | Extend `PlatformType` (line 53) with `"uniqlo"`; add optional `apiCategoryPaths?: string[]` to `SiteConfig` (97-134) |
| `src/lib/robots-check.ts` | NEW | ~50 | `robots.txt` fetch + `User-agent: *` blanket-Disallow detector. Used by REQ-004 |
| `src/crawl.ts` | MODIFY | ~45 | `runCrawl`: `uniqloSites` partition + `Promise.all(crawlUniqlo(c))` (~25 LOC). `probeSite`: `if (config.type === "uniqlo")` branch (~15 LOC). `--rate=N` flag parse (~5 LOC) |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `uniqlo-kr` SiteConfig. Hardcoded `apiCategoryPaths` (WOMEN/MEN/KIDS top-level + direct sub-categories). `crawlDelay: 1000` |
| `tests/fixtures/uniqlo-kr-products.fixture.json` | NEW | ~150 | Frozen real Uniqlo API snapshot (~50-100 products from one category page) |
| `tests/uniqlo-engine.test.ts` | NEW | ~120 | `node:test` suite. Fixture parse assertions; `--rate` timing test; abort-on-3-consecutive-errors test |
| `package.json` | MODIFY | ~3 | Add `"test": "node --test --import tsx ./tests/*.test.ts"`. NO new devDependencies |
| `.moai/project/structure.md` | MODIFY | ~10 | Add `robots.txt` verification as Step 1 of "Adding a New Platform" checklist |

Total est. LOC: ~614.

---

## Exclusions

The following are explicitly out of scope.

- **ZARA**: Akamai Bot Manager + no public API + ToS unverified. Deferred to a follow-up SPEC. **AMENDED 2026-05-05: 7-day soak gate removed; follow-up SPEC may proceed once SPEC-001 dry-run + characterization tests are green.**
- **29CM**: Robots.txt permissive but Next.js App Router with no public JSON API (RSC payload only). Deferred to a follow-up SPEC under the same relaxed entry conditions as ZARA above.
- **Musinsa**: `robots.txt` verbatim `User-agent: * / Disallow: /` (last updated 2025.10.24). Per project HARD rule #1, will NOT pursue via web crawling. B2B partner-API path is non-engineering track.
- **H&M**: `robots.txt` itself returns HTTP 403 from AkamaiGHost. Deferred indefinitely.
- **Inditex sub-brands**: Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home — share Akamai parent infra. Deferred-with-ZARA.
- **H&M Group sub-brands**: COS, Weekday, Monki, Arket — share AkamaiGHost active blocker. Deferred indefinitely.
- **Schema migration**: No kiko.ai Supabase change. Uniqlo fields map onto existing `products` table.
- **Cloudflare R2**: Already noted future in `product.md`. Not part of this SPEC.
- **Live FX rate API**: Uniqlo prices natively in KRW. Hardcoded FX in `shopify-engine.ts` unchanged.
- **Linter / formatter**: ESLint, Biome, Prettier — out of scope. `tsc --noEmit` remains the only static check.
- **Vitest**: Intentionally not introduced. `node:test` (built-in) is used.
- **IP rotation, residential proxies, CAPTCHA solving, headless browser fingerprint evasion, authenticated scraping**: Forbidden by project HARD rules; out of scope for this and future SPECs in this series.

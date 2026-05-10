---
id: SPEC-PLATFORM-EXPANSION-001
version: 0.1.0
status: draft
created_at: "2026-05-05"
updated_at: "2026-05-05"
author: hansangho
priority: high
issue_number: 0
labels: [crawler, platform, uniqlo, infrastructure]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-05 | v0.1.0 | Initial draft. Approved scope: Uniqlo (KR) only. ZARA / 29CM as 2순위 follow-up SPECs. Musinsa / H&M deferred. |

---

## Overview

This SPEC adds Uniqlo (KR storefront) as the 33rd registered platform in the crawler, introducing the first non-Cafe24, non-Shopify engine to the codebase. Uniqlo is the only platform of the five investigated (research.md §1) that combines a permissive `robots.txt` for product paths, a live JSON API (`/kr/api/commerce/v5/ko/products`) returning HTTP 200 to a plain `fetch` with a realistic Mozilla User-Agent, an Akamai Bot Manager configuration that does not actively block API traffic, and a manageable catalog scale of approximately 5,000 to 30,000 SKU. The work is structurally analogous to extending the existing Shopify engine: same fetch-pagination pattern, no Playwright invocation, no FX conversion (Uniqlo prices natively in KRW), and no Supabase schema migration.

Beyond shipping the Uniqlo engine itself, this SPEC formalizes a small set of new-platform onboarding hardening rules so subsequent platforms in the roadmap (29CM, ZARA) can follow a uniform, auditable process. Specifically, this SPEC makes `robots.txt` verification a mandatory step at platform-registration time and at every crawl start, makes the dry-run flow a first-class supported invocation, and pins a concrete rate-limit policy of 1 request per second with a 5-element User-Agent rotation list. These additions are scoped narrowly to what Uniqlo specifically needs and do not constitute a general framework rewrite. Per the project rule "incremental, validate one before the next," this SPEC implements only Uniqlo. ~~ZARA and 29CM follow-up SPECs will not be opened until Uniqlo passes its dry-run gate and runs successfully against production for 7 calendar days with zero crawl-aborts.~~ **AMENDED 2026-05-05: the 7-day soak gate has been removed by user direction. Follow-up SPECs may proceed once dry-run + characterization tests are green; see plan.md §2.4 for the relaxed entry conditions.**

## Goals

- Ship a working Uniqlo (KR) crawler that produces a `data/uniqlo-kr-products.json` cache file consumable by the existing `import-products.ts` Supabase upsert path with no schema changes.
- Introduce `"uniqlo"` as a new `PlatformType` in `src/lib/types.ts` without disturbing the two existing engines (Cafe24, Shopify).
- Make `robots.txt` blanket-disallow detection a HARD precondition at both registration time and crawl-start time, so platforms in the position of Musinsa (verbatim `User-agent: * / Disallow: /`) cannot be silently activated.
- Make characterization tests, backed by a frozen real-API fixture, the primary regression-detection mechanism for the new engine — without introducing a new test framework dependency.
- Establish a clean entry-condition contract for the 2순위 follow-up SPECs (29CM, ZARA) so that downstream platform onboarding does not start until Uniqlo has demonstrated production stability.

## Non-Goals / Exclusions

The following are explicitly out of scope for this SPEC. Items in this section MUST NOT be treated as "nice-to-have" or partially implemented; they are deferred either to follow-up SPECs (with documented entry conditions) or indefinitely.

- **ZARA**: Akamai Bot Manager active deployment, no public API, ToS unverified. Deferred to a follow-up SPEC. **AMENDED 2026-05-05: the original 7-day Uniqlo soak entry condition has been removed; the follow-up SPEC may be opened immediately once SPEC-001 dry-run + characterization tests are green (see plan.md §2.4).** The user has indicated willingness to attempt a Playwright-based engine for ZARA; that decision is captured but not implemented here.
- **29CM**: Robots.txt is permissive but the Next.js App Router architecture means there is no public JSON API; data ships via React Server Components payloads requiring either Playwright or RSC reverse-engineering. Deferred to a follow-up SPEC under the same relaxed entry conditions as ZARA above.
- **Musinsa**: Verbatim `robots.txt` line `User-agent: * / Disallow: /` with last-update date 2025.10.24. Per project HARD rule #1 ("Sites that explicitly forbid crawling → DEFER"), this SPEC will NOT pursue Musinsa via web crawling. Pursuing Musinsa requires a B2B partner-API conversation handled as a non-engineering track.
- **H&M**: `robots.txt` itself returns HTTP 403 from AkamaiGHost. Cannot read the bot policy without a real browser session. Deferred indefinitely. Re-evaluate only if upstream policy changes.
- **Inditex sub-brands**: Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home all share the Inditex / Akamai parent infrastructure and inherit ZARA's deferral rationale. They are deferred-with-ZARA and will be re-evaluated only if SPEC-PLATFORM-002 ships successfully.
- **H&M Group sub-brands**: COS, Weekday, Monki, Arket all share the H&M Group AkamaiGHost active-blocker configuration. They are deferred-indefinitely under the same rationale as H&M.
- **Schema migration**: No kiko.ai Supabase schema change. All Uniqlo response fields map onto existing `products` table columns. `productCode`, image arrays, color, gender, and category are already supported.
- **Cloudflare R2 image storage**: Already noted as future in `product.md` Out of Scope. Not part of this SPEC.
- **Live FX rate API**: Uniqlo prices natively in KRW so no FX conversion is invoked. The hardcoded FX table in `shopify-engine.ts` remains unchanged.
- **Linter / formatter introduction (ESLint, Biome, Prettier)**: Out of scope for this SPEC. `tsc --noEmit` remains the only static check.
- **Vitest framework introduction**: Intentionally avoided. Tests use Node's built-in `node:test` runner.
- **IP rotation, residential proxy networks, CAPTCHA solving, headless browser fingerprint evasion, authenticated scraping**: Forbidden by project HARD rules and out of scope for this and any future SPEC in this series.

## Requirements

The following requirements use EARS (Easy Approach to Requirements Syntax) format. All requirements are testable against either the live Uniqlo API or the frozen characterization fixture.

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register Uniqlo KR as a platform with `key: "uniqlo-kr"`, `type: "uniqlo"`, and `baseUrl: "https://www.uniqlo.com/kr/ko"` in `src/configs/platforms.ts`. The SiteConfig entry **SHALL** include a hardcoded `apiCategoryPaths: string[]` field listing the top-level Uniqlo categories (WOMEN, MEN, KIDS) and their direct sub-categories (outerwear, jackets, knitwear, T-shirts, shirts, pants, jeans, dresses, skirts, innerwear, lounge, accessories) as path codes consumable by the `/kr/api/commerce/v5/ko/products?path=` query parameter. The exact path codes will be enumerated in `src/configs/platforms.ts` `apiCategoryPaths` array — see §Files Affected. Sitemap-driven category discovery is explicitly NOT used for v1 of this engine.

Source: research.md §1 [^u2], §6; plan.md §8 Q1 (resolved: hardcoded).

### REQ-002 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=uniqlo-kr` without the `--dry-run` flag, **THE crawler SHALL** fetch products from `https://www.uniqlo.com/kr/api/commerce/v5/ko/products` for each path in `apiCategoryPaths`, paginate by `offset` (incrementing by `limit=100`) until either `pagination.count === 0` or `offset >= pagination.total`, and write the aggregated `Product[]` result to `data/uniqlo-kr-products.json`. Each request **SHALL** be paced at 1 request per second (1000 ms `crawlDelay` baseline) and **SHALL** rotate through a hardcoded list of 5 realistic Mozilla User-Agent strings (one UA per request, round-robin).

Source: research.md §1 [^u2], §6; plan.md §8 Q5 (resolved: 1 req/sec + 5-UA rotation).

### REQ-003 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=uniqlo-kr --dry-run`, **THE crawler SHALL** invoke the probe handler for the `"uniqlo"` engine type, fetching the API endpoint with `limit=1` (one request only), parsing the JSON shape, printing a sample product summary to stdout (key fields: `name`, `productCode`, `prices.base.value`, `productUrl`), and **SHALL NOT** write `data/uniqlo-kr-products.json` to disk. The dry-run **SHALL NOT** modify any file in the `data/` directory.

Source: research.md §6 (dry-run scenario 1); plan.md §3 REQ-003.

### REQ-004 [State-driven]

**WHILE** registering a new platform OR starting a crawl, **THE crawler SHALL** fetch the target site's `robots.txt` and **SHALL** refuse to proceed if the `User-agent: *` group contains a verbatim `Disallow: /` rule. The check **SHALL** apply to all platforms regardless of `type`, not only to `"uniqlo"`. On block, the crawler **SHALL** emit a clear error message identifying the platform key, the blocking line from `robots.txt`, and the project HARD rule #1 reference, and **SHALL** exit with a non-zero status before any product fetch is attempted.

Source: research.md §1, §2.4 (Musinsa is the canonical anti-example, robots.txt verbatim quoted in [^m1]); project HARD rule #1.

### REQ-005 [Unwanted Behavior]

**IF** the Uniqlo API returns HTTP 4xx or 5xx for 3 consecutive page requests within a single category iteration, **THEN THE crawler SHALL** abort that category, append the error to `CrawlResult.errors` (with category path, HTTP status, request URL, and timestamp), and continue with the next category in `apiCategoryPaths`. Consecutive means without an intervening 2xx response on the same category path; non-consecutive errors interleaved with successes do not trigger abort. The crawler **SHALL NOT** retry indefinitely, **SHALL NOT** silently swallow the error, and **SHALL NOT** rotate IP addresses or invoke any evasion technique. After all categories are processed, the crawler **SHALL** write the partial result to `data/uniqlo-kr-products.json` with the populated `errors` array so the operator can audit which categories failed.

Source: research.md §4 (Akamai escalation row); project HARD rule "rate limit + abort on block, no IP rotation"; mirrors abort-on-error pattern in `shopify-engine.ts`.

### REQ-006 [Ubiquitous]

**THE Uniqlo engine SHALL** ship with a characterization-test suite written using Node's built-in `node:test` runner, executed via `node --test --import tsx ./tests/*.test.ts` (added as the `test` script in `package.json`). The suite **SHALL** load a frozen JSON fixture at `tests/fixtures/uniqlo-kr-products.fixture.json` (a real captured Uniqlo API response of approximately 50 to 100 products from one category page) and **SHALL** assert that the engine's parse path against the fixture produces a `Product[]` array where every element has populated `name`, `imageUrl`, `productUrl`, and `price` fields, and where every `imageUrl` value matches the Uniqlo image-host whitelist (`image.uniqlo.com`, `asset.uniqlo.com`). No new devDependency **SHALL** be added; `node:test` is built into Node 22.

Source: plan.md §3 REQ-006, §6 (Technology Stack); plan.md §8 Q2 (resolved: node:test).

### REQ-007 [Optional Feature]

**WHERE** the operator invokes the crawler with the `--rate=N` flag (where N is a positive integer denoting requests per second), **THE crawler SHALL** override the SiteConfig-defined `crawlDelay` for the duration of that invocation only, computing the per-request delay as `1000 / N` milliseconds. The `--rate` flag **SHALL** be subject to a project-level rate-cap policy: values of N greater than 5 (i.e., faster than 5 requests per second per site) **SHALL** be rejected with a clear error message at command-parse time. Values of N ≤ 0 or non-integer N (e.g., 2.5, "abc") **SHALL** also be rejected at command-parse time with a clear error message. The default behavior (no `--rate` flag) remains 1 request per second as defined by REQ-002.

Source: plan.md §8 Q5 follow-up; provides operator escape hatch within rate-cap policy.

## Technical Approach

The Uniqlo engine is implemented as a new file `src/lib/uniqlo-engine.ts` that mirrors the structural pattern of `src/lib/shopify-engine.ts` (research.md §3.2). The engine exports a single entry function `crawlUniqlo(config: SiteConfig): Promise<CrawlResult>` that uses Node's built-in `fetch` (no Playwright, no browser invocation), iterates over the configured `apiCategoryPaths`, and for each path runs a `while` loop incrementing the `offset` query parameter by `limit=100` until either `pagination.count === 0` or `offset >= pagination.total` is reached. Each fetched JSON response is mapped from the documented Uniqlo schema (`{result:{items[], pagination, aggregations}}` per research.md §1 [^u2]) onto the existing `Product` interface in `src/lib/types.ts`. Image URLs are filtered through a Uniqlo-specific host whitelist (`image.uniqlo.com`, `asset.uniqlo.com`), defensively defaulting to `null` for any unexpected host. A 5-element User-Agent rotation list is held inline in the engine module, with a per-request rotating index. The 1-req/sec pacing is enforced by an `await new Promise(r => setTimeout(r, crawlDelay))` between requests, identical to the existing Shopify engine pattern.

The Run-phase methodology is DDD (ANALYZE-PRESERVE-IMPROVE) per `quality.development_mode: ddd` in `quality.yaml`, which is appropriate because the project has 0% existing test coverage. The PRESERVE step in this DDD adaptation is fixture creation rather than test-existing-code (the engine is greenfield); the fixture captures a frozen snapshot of the live Uniqlo API as of the SPEC date, and the characterization tests run the engine's parse path against this fixture to detect any future shape drift in the engine itself. The `robots-check.ts` helper is a small, focused module (~50 LOC) that fetches `<baseUrl>/robots.txt`, parses the `User-agent: *` group, and returns a structured `{ allowed: boolean, blockingLine?: string }` result consumed by both the registration validator and the per-crawl pre-flight check (REQ-004). The `--rate=N` operator override (REQ-007) is parsed in `src/crawl.ts` alongside the existing `--site` and `--dry-run` flags.

## Files Affected

User decisions confirmed: hardcoded `apiCategoryPaths` (Q1), `node:test` runner (Q2). No new devDependencies.

| File | Action | Est. LOC | Purpose |
|---|---|---|---|
| `src/lib/uniqlo-engine.ts` | NEW | ~200 | Fetch-pagination engine over `apiCategoryPaths`, JSON-to-Product mapper, image-host whitelist, UA rotation list, 1-req/sec pacing. |
| `src/lib/types.ts` | MODIFY | ~6 | Extend `PlatformType` (line 53) to add `"uniqlo"`; add optional `apiCategoryPaths?: string[]` to `SiteConfig` (lines 97-134). |
| `src/lib/robots-check.ts` | NEW | ~50 | `robots.txt` fetch + `User-agent: *` blanket-disallow detector. Used by REQ-004. |
| `src/crawl.ts` | MODIFY | ~45 | `runCrawl`: add `uniqloSites` partition + `Promise.all(crawlUniqlo(c))` branch (~25 LOC). `probeSite`: add `if (config.type === "uniqlo")` branch (~15 LOC). Parse `--rate=N` flag (~5 LOC). |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `uniqlo-kr` SiteConfig entry. Hardcoded `apiCategoryPaths` enumerates WOMEN, MEN, KIDS top-level codes plus direct sub-category codes. `crawlDelay: 1000`. |
| `tests/fixtures/uniqlo-kr-products.fixture.json` | NEW | ~150 | Frozen snapshot of a real Uniqlo API response (one category page, 50-100 products). Captured once via curl at SPEC date. |
| `tests/uniqlo-engine.test.ts` | NEW | ~120 | `node:test` suite. Asserts engine parse path against fixture produces `Product[]` with populated `name`, `imageUrl`, `productUrl`, `price`. Includes timing test for `--rate` override and abort-on-3-consecutive-errors test. |
| `package.json` | MODIFY | ~3 | Add `"test": "node --test --import tsx ./tests/*.test.ts"` script. No new devDependencies. |
| `.moai/project/structure.md` | MODIFY | ~10 | Add `robots.txt` verification as Step 1 of "Adding a New Platform" checklist. |

Total estimated LOC: ~614 (greenfield engine + dispatch wiring + tests + docs).

## Acceptance References

Detailed Given-When-Then acceptance scenarios are documented in `.moai/specs/SPEC-PLATFORM-EXPANSION-001/acceptance.md`. The acceptance suite contains seven scenarios covering all seven requirements (REQ-001 through REQ-007), of which AC-7 is an edge case for REQ-002. Each scenario includes a verification method note (unit test against fixture, integration test with `--probe`, or manual verification).

## Open Risks

Three risks carried forward from plan.md §7 are tracked here for visibility throughout the Run phase. Mitigations are described in plan.md and will be implemented as part of the engine code, not as separate SPECs.

- **Uniqlo API shape changes (undocumented v5 endpoint)** — Likelihood: Medium, Impact: Medium. The Uniqlo API at `/kr/api/commerce/v5/ko/products` is undocumented. Although the `v5` prefix suggests maturity, the endpoint could change without notice. Mitigation: the characterization fixture (REQ-006) detects any shape drift on every test run; the engine maps fields defensively (each field falls back to `null` if absent). Mitigation strategy is reactive, not preventive — accepted.
- **Akamai Bot Manager escalates anti-bot for the API path** — Likelihood: Low, Impact: High. Akamai is currently configured permissively for the API endpoint (research.md §1 [^u2]) but Akamai's policies can be tuned by the site operator at any time. Mitigation: 1-req/sec baseline, 5-element UA rotation list, REQ-005 abort-on-3-consecutive-errors. No IP rotation, no fingerprint randomization beyond UA. If Akamai blocks, the crawler fails loud and visible in `CrawlResult.errors`.
- **Uniqlo introduces `Disallow: /kr/api/` in robots.txt** — Likelihood: Low, Impact: High. Although REQ-004 only blocks on a blanket `Disallow: /`, a more targeted rule could appear that REQ-004 would not catch. Mitigation: the operator running the crawl is expected to occasionally inspect `robots.txt` changes manually. A future SPEC could extend `robots-check.ts` to evaluate path-specific rules against the actual fetch URLs; for v1 of this engine, that finer-grained check is out of scope.

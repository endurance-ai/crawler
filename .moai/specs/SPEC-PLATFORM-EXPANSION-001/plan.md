# Plan: SPEC-PLATFORM-EXPANSION-001 — Uniqlo Engine + Platform Onboarding Hardening

Status: draft
Author: manager-spec subagent
Date: 2026-05-05

## 1. Intent

This SPEC adds Uniqlo (KR storefront) as the 33rd registered platform in the crawler — the first non-Cafe24, non-Shopify engine to be introduced. Beyond shipping the Uniqlo engine, this SPEC also formalizes the "new-platform onboarding" protocol so that subsequent platforms in the roadmap (29CM, ZARA) can follow a uniform, auditable process. The protocol additions — robots.txt verification at registration time, dry-run validation, and rate-limit policy as a first-class config field — are scoped narrowly to what Uniqlo specifically needs; they are not a general framework rewrite. Per project rule "incremental, validate one before next," this SPEC implements only Uniqlo. ZARA and 29CM are listed as 2순위 candidates for separate follow-up SPECs after Uniqlo passes its dry-run gate and runs in production for a 7-day soak period.

## 2. Scope

### 2.1 In-Scope

- New file `src/lib/uniqlo-engine.ts` implementing fetch-based pagination against `https://www.uniqlo.com/kr/api/commerce/v5/ko/products` (research.md §1, §6, §2.5; endpoint shape confirmed live HTTP 200, [^u2]).
- `PlatformType` union extension from `"cafe24" | "shopify"` to `"cafe24" | "shopify" | "uniqlo"` in `src/lib/types.ts:53` (research.md §3.1, §6).
- New optional `SiteConfig` field `apiCategoryPaths?: string[]` to drive per-category path iteration against the Uniqlo API (research.md §6).
- New `SiteConfig` entry for `uniqlo-kr` in `src/configs/platforms.ts` (research.md §6 — single entry, ~15 LOC).
- Engine dispatch wiring in `src/crawl.ts:runCrawl` to route `type === "uniqlo"` to the new engine, parallel-fetched alongside Shopify (research.md §3.4, §6 — ~25 LOC).
- Probe handler in `src/crawl.ts:probeSite` for the `"uniqlo"` branch — confirms API endpoint returns 200 and parses JSON shape (research.md §6 — ~15 LOC).
- Image host whitelist for Uniqlo CDN (`image.uniqlo.com`, `asset.uniqlo.com`) — pattern mirrors `isSafeImageUrl` in `shopify-engine.ts:47-60`. Lives inside the new engine file (research.md §3.2, §6).
- robots.txt fetch helper that, at platform-registration time and again at each crawl start, refuses to register or run any platform whose `User-agent: *` group contains a blanket `Disallow: /` rule (research.md §1, §2.4 Musinsa case is the canonical anti-example). Lives in a new file `src/lib/robots-check.ts`.
- Characterization-test fixture: a frozen JSON snapshot of a real Uniqlo API response (one category page) under `tests/fixtures/uniqlo-kr-products.fixture.json`. Required by DDD methodology — see §9.
- Characterization tests: minimal node:test suite in `tests/uniqlo-engine.test.ts` that runs the engine's parse path against the fixture and asserts product field mapping. Adds `pnpm test` script.
- Update to `.moai/project/structure.md` Step 1 of the new-platform checklist to include the robots.txt verification step before any code is written.

### 2.2 Out-of-Scope (this SPEC)

- **ZARA** — Akamai Bot Manager + no public API + unverified ToS (research.md §2.1, §5.3). Listed as 2순위 candidate; user picked "Playwright 시도." Implementation lives in a separate follow-up SPEC (`SPEC-PLATFORM-002`) opened only after Uniqlo passes its dry-run gate and runs 7 days in production with no error spike. Entry conditions for SPEC-002 are documented in §8.
- **29CM** — listed as 2순위 in research.md §5.2. Same treatment as ZARA: separate follow-up SPEC, opened only after the Uniqlo soak period.
- **Musinsa** — robots.txt verbatim `User-agent: * / Disallow: /` (research.md §2.4, [^m1]). Per project HARD rule #1 ("Sites that explicitly forbid crawling → DEFER"), this SPEC will NOT pursue Musinsa via crawling. Documented as deferred — pursue B2B partner API discussion separately as a non-engineering track.
- **H&M** — robots.txt itself returns HTTP 403 from AkamaiGHost (research.md §2.2, [^h1]). Cannot read the bot policy without a real browser session. Documented as deferred indefinitely — re-evaluate only if upstream policy changes.
- Any kiko.ai Supabase schema migration. Research §6 confirms Uniqlo data maps onto existing `Product` columns with no new fields needed.
- Cloudflare R2 image storage integration (already noted as future in `product.md` "Out of Scope").
- Live FX rate API. Uniqlo prices in KRW natively, so no FX conversion is invoked (research.md §5.1 confirms KRW storefront).
- Linter / formatter introduction (ESLint, Biome, Prettier) — keep as project-level concern. tsc --noEmit remains the only static check.
- Vitest framework introduction. This SPEC uses node:test (built-in, zero dependency). See §8 Q2.

### 2.3 Out-of-Scope (any future SPEC in this series)

- IP rotation / residential proxy networks.
- CAPTCHA solving services or third-party CAPTCHA APIs.
- Headless browser fingerprint evasion libraries (e.g., puppeteer-extra-plugin-stealth).
- Any technique that violates a platform's robots.txt for `User-agent: *`.
- Authenticated scraping (login automation, session cookie hijack).
- **Inditex sub-brands deferred-with-ZARA**: Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home all share the Inditex / Akamai Bot Manager parent infrastructure. They are deferred under the same rationale as ZARA and will be re-evaluated only if SPEC-PLATFORM-002 (ZARA) ships successfully.
- **H&M Group sub-brands deferred-with-H&M**: COS, Weekday, Monki, Arket all share H&M Group's AkamaiGHost active-blocker configuration (research.md §2.2 [^h1]). Deferred indefinitely under the same rationale as H&M.

### 2.4 ZARA / 29CM Follow-up SPEC Entry Conditions

**AMENDED 2026-05-05 (post-SPEC-002): The 7-day soak gate has been removed by user direction.** Follow-up SPECs (ZARA, 29CM, additional Uniqlo regions, etc.) MAY be opened immediately once SPEC-001's dry-run probe passes and characterization tests are green. No production soak window is required.

Original gate (now removed for reference):
- ~~7 calendar days of zero crawl-aborts in production before opening SPEC-PLATFORM-002 / 003.~~
- ~~Soak-window restart on any failure.~~

Current entry conditions (relaxed):
1. SPEC-001 dry-run probe (REQ-003) succeeded against the live API.
2. Characterization-test fixture (REQ-006) is green.

The risks the soak gate originally guarded against (API drift, Akamai escalation, robots.txt change) are now caught by the always-on test suite (KR + US fixture parity per SPEC-002 REQ-008) and the runtime `robots-check.ts` pre-flight. Production drift, if it occurs, surfaces in the next crawl run rather than being preemptively blocked.

## 3. EARS Requirements (proposed — to be finalized in spec.md)

REQ-001 [Ubiquitous]: THE crawler SHALL register Uniqlo KR as a platform with `key: "uniqlo-kr"`, `type: "uniqlo"`, `baseUrl: "https://www.uniqlo.com/kr/ko"` in `src/configs/platforms.ts`. (research.md §6.)

REQ-002 [Event-driven]: WHEN `pnpm crawl --site=uniqlo-kr` is invoked without `--dry-run`, THE crawler SHALL fetch products from `https://www.uniqlo.com/kr/api/commerce/v5/ko/products` for each path in `apiCategoryPaths`, paginate by `offset` until `pagination.count === 0` or `offset >= pagination.total`, and write the aggregated result to `data/uniqlo-kr-products.json`. Each request SHALL be paced at 1 req/sec (1000 ms `crawlDelay` baseline) and SHALL rotate through a hardcoded list of 5 realistic Mozilla User-Agent strings (one UA per request, round-robin). (research.md §1 [^u2], §6.)

REQ-003 [Event-driven]: WHEN `pnpm crawl --site=uniqlo-kr --dry-run` is invoked, THE crawler SHALL invoke the probe handler — fetching the API endpoint with `limit=1`, parsing the JSON shape, printing a sample product summary to stdout — and SHALL NOT write `data/uniqlo-kr-products.json`. (research.md §6 dry-run scenario 1.)

REQ-004 [State-driven]: WHILE registering a new platform OR starting a crawl, THE crawler SHALL fetch the target's `robots.txt` and refuse to proceed if the `User-agent: *` group contains a verbatim `Disallow: /` rule. (research.md §2.4 Musinsa case is the canonical block trigger. Project HARD rule #1.)

REQ-005 [Unwanted Behavior]: IF the Uniqlo API returns HTTP 4xx or 5xx for 3 consecutive page requests within a single category iteration, THEN THE crawler SHALL abort that category, record the error in `CrawlResult.errors`, and continue with the next category — no silent failure, no infinite retry. Consecutive means without an intervening 2xx response on the same category path. (Project HARD rule "rate limit + abort on block, no IP rotation." `shopify-engine.ts` already follows the abort-on-error pattern; mirror it.)

REQ-006 [Ubiquitous]: THE Uniqlo engine SHALL ship with a characterization-test suite using Node's built-in `node:test` runner (no new devDependency), executed via `node --test --import tsx ./tests/*.test.ts` added as the `"test"` script in `package.json`. The suite SHALL load a frozen JSON fixture at `tests/fixtures/uniqlo-kr-products.fixture.json` and SHALL assert that the engine's parse path produces a `Product[]` with populated `name`, `imageUrl`, `productUrl`, and `price`, and that every `imageUrl` matches the Uniqlo image-host whitelist. (plan.md §6, §8 Q2.)

REQ-007 [Optional Feature]: WHERE the operator invokes the crawler with `--rate=N`, THE crawler SHALL override the SiteConfig `crawlDelay` for that invocation only, computing the per-request delay as `1000 / N` ms. Values of N greater than 5 SHALL be rejected at command-parse time. Values of N ≤ 0 or non-integer N SHALL also be rejected at command-parse time with a clear error message. Default behavior (no flag) remains 1 req/sec per REQ-002. (plan.md §8 Q5 follow-up.)

Notes:
- REQ-004 is the only "platform onboarding hardening" requirement that is structurally distinct; dry-run formalization (REQ-003) and rate-limit policy (REQ-002 + REQ-007) are first-class REQs because they each have independent acceptance criteria.
- REQs ship as REQ-001..007 with NO prefix in spec.md, acceptance.md, and spec-compact.md. The plan.md numbering and the SPEC numbering are identical.

## 4. Files to Modify

User decisions confirmed: hardcoded `apiCategoryPaths` (Q1), `node:test` runner (Q2). Test files use `.test.ts` extension.

| File | Action | Est. LOC | Reason |
|---|---|---|---|
| `src/lib/uniqlo-engine.ts` | NEW | ~200 | New engine: fetch-pagination loop over `apiCategoryPaths`, JSON-to-Product mapper, image-host whitelist (research.md §6); UA rotation list of 5 strings used per-request |
| `src/lib/types.ts` | MODIFY | ~6 | Extend `PlatformType` (line 53, +1 LOC) + add optional `apiCategoryPaths?: string[]` to `SiteConfig` (lines 97-134, +5 LOC) |
| `src/lib/robots-check.ts` | NEW | ~50 | robots.txt fetch + `User-agent: *` blanket-disallow detector. Used by REQ-004 |
| `src/crawl.ts` | MODIFY | ~45 | Add `uniqloSites` partition + `Promise.all(crawlUniqlo(c))` branch in `runCrawl` (~25 LOC); add `if (config.type === "uniqlo")` branch in `probeSite` (~15 LOC); parse `--rate=N` flag override (~5 LOC) |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `uniqlo-kr` SiteConfig entry. Hardcoded `apiCategoryPaths` includes top-level WOMEN/MEN/KIDS plus their published sub-categories; `crawlDelay: 1000` (1 req/sec baseline) |
| `tests/fixtures/uniqlo-kr-products.fixture.json` | NEW | ~150 | Frozen snapshot of one real Uniqlo API page, captured once via curl. Used as test input |
| `tests/uniqlo-engine.test.ts` | NEW | ~120 | node:test suite. Runs engine parse path against fixture; asserts ≥1 product, required fields populated, image URL passes whitelist; rate-limit timing test; UA rotation test; abort-on-3-consecutive-errors test |
| `package.json` | MODIFY | ~3 | Add `"test": "node --test --import tsx ./tests/*.test.ts"` script. No new devDependencies (node:test is built-in) |
| `.moai/project/structure.md` | MODIFY | ~10 | Add robots.txt verification as Step 1 of "Adding a New Platform" checklist |

Verification needed before Run phase:
- [x] Q1 resolved — `apiCategoryPaths` (hardcoded) is the chosen mechanism. WOMEN, MEN, KIDS top-level codes plus their direct sub-category codes (jackets, knitwear, T-shirts, pants, etc.) enumerated explicitly in `platforms.ts`.
- [x] Q2 resolved — `node:test` (built-in). Zero new devDependencies. Test files: `.test.ts` extension.
- [x] Q3 resolved — Originally 7 calendar days with zero crawl-aborts was the entry condition for follow-up SPECs. **AMENDED 2026-05-05: gate removed by user direction.** Follow-up SPECs may proceed immediately once dry-run + characterization tests are green. See §2.4.
- [x] Q4 resolved — Inditex sub-brands (Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home) and H&M Group sub-brands (COS, Weekday, Monki, Arket) are explicitly enumerated in §2.3.
- [x] Q5 resolved — rate limit is **1 req/sec (1000ms)** baseline per platform, with a 5-element UA rotation list. The `--rate=N` operator override is supported via REQ-007.
- [x] Confirmed: out-of-scope per research.md §3.5 (Uniqlo product IDs map to existing schema; null product_no fallback is acceptable per current import-products.ts behavior). Run-phase will verify via dry-run output diff against products schema before live import.

## 5. Reference Implementations (from research.md and existing code)

- Shopify engine for fetch-pagination pattern (research.md §3.2): `src/lib/shopify-engine.ts:98-280` (`crawlShopify` entry), `:11-16` (FX_TO_KRW — irrelevant for Uniqlo, KRW-native), `:34-41` (convertToKrw — same), `:44` (SAFE_HANDLE regex), `:47-60` (isSafeImageUrl host whitelist — directly model after this).
- Cafe24 engine for the broader engine surface (research.md §3.3): `src/lib/cafe24-engine.ts:398-590` — but Uniqlo does NOT borrow this; documented for context only since it is the alternative engine pattern.
- SiteConfig schema (research.md §3.1): `src/lib/types.ts:53` (PlatformType) and `:97-134` (SiteConfig interface). The `apiCategoryPaths?: string[]` field slots in alongside existing optional fields.
- Crawl dispatch (research.md §3.4): `src/crawl.ts:153-223` (`runCrawl`) — Shopify branch at `:162-176` is the structural template for the Uniqlo branch (no browser, full parallel via `Promise.all`).
- Probe dispatch (research.md §3.4): `src/crawl.ts:45-147` (`probeSite`) — Shopify branch at `:49-63` is the structural template for the Uniqlo probe (one fetch with limit=1, parse JSON, print sample).
- Supabase upsert mapping (research.md §3.5): `src/import-products.ts:148-212`. Out of scope for this SPEC, but the Uniqlo engine MUST produce `Product` objects whose fields the existing upsert path accepts unmodified.

## 6. Technology Stack

No new production dependencies required. Stack is unchanged from `tech.md`:

- Node.js >=22.0.0, TypeScript ^5.6.0, pnpm >=9.0.0
- Existing deps: `playwright`, `@supabase/supabase-js`, `tsx`, `dotenv-cli`
- Uniqlo engine uses Node's built-in `fetch` (same as `shopify-engine.ts`) — no Playwright invoked

New dev concern (not a dependency):
- Node's built-in `node:test` runner is used for characterization tests. Activated via `node --test --import tsx ./tests/*.test.ts` in the `pnpm test` script. Zero new packages added. Vitest is intentionally avoided for this SPEC; if test ergonomics become a pain point in a future SPEC, vitest can be re-evaluated then.

## 7. Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Uniqlo API shape changes (undocumented v5 endpoint) | Medium | Medium | Characterization fixture detects shape drift on any test run. The engine maps fields defensively (each field falls back to `null` if absent). Mitigation strategy is reactive, not preventive — accepted (research.md §4 risk row "undocumented endpoint could change") |
| Akamai Bot Manager escalates anti-bot for the API path | Low | High | `crawlDelay: 1000` ms baseline; REQ-005 aborts on 3 consecutive 4xx/5xx. 5-element UA rotation list, no IP rotation, no fingerprint randomization beyond UA. If Akamai blocks, the crawler fails loud (visible in `CrawlResult.errors`) rather than retrying silently |
| robots.txt policy change (Uniqlo introduces `Disallow: /kr/api/`) | Low | High | `robots-check.ts` runs at every crawl start (REQ-004). A policy change blocks the next crawl, surfaces in error output, and forces a re-evaluation before the next run |
| Missing test framework forces yak-shaving | Low | Low | Use built-in `node:test` — no new dependency, no config file. If this proves brittle, the next SPEC can introduce vitest deliberately |
| Schema mismatch with kiko.ai products table (e.g. `product_no` extraction returns null) | Low | Medium | Research.md §3.5 confirms `product_no` accepts null. Pre-flight: dry-run output is hand-inspected for one category before the first non-dry-run crawl. Treated as a Run-phase verification step, not a code change |
| `apiCategoryPaths` becomes stale (Uniqlo adds/removes categories) | Medium | Low | The empty `total=0` case is handled (REQ-002 termination condition). Stale entries waste a request but do not corrupt output. Sitemap-driven discovery (Q1) would mitigate this — deferred to follow-up SPEC if it becomes a real maintenance burden |
| New engine type sets a precedent that subsequent SPECs may misuse | Low | Medium | The `apiCategoryPaths` field is named conservatively (api-prefixed, narrow type). Any future API-based engine should add its own narrow field rather than reusing this one. Documented in §8 as an open design note |

## 8. Decision Log (Open Questions)

These items are flagged for user decision before /moai run begins:

- **Q1 — Category discovery mechanism**: Hardcoded `apiCategoryPaths: string[]` in the SiteConfig (simpler, more brittle, ~15 LOC), or sitemap-driven discovery parsing `https://www.uniqlo.com/kr/sitemap_kr-ko_l1l2_hreflang.xml` (research.md §1 [^u1] confirms publication; ~50 LOC, adapts to catalog changes). Recommendation: **hardcoded for v1**, sitemap-driven becomes a follow-up if the path list becomes a maintenance burden. Captured in research.md §7 as Open Question 4.
- **Q2 — Test framework**: `node:test` (built-in, zero dependency, slightly less ergonomic) or `vitest` (one new dependency, much better DX). Recommendation: **node:test for v1** to minimize this SPEC's footprint. Vitest can be introduced later as its own SPEC if test volume grows.
- **Q3 — ZARA / 29CM follow-up SPEC entry conditions**: Plan currently says "after Uniqlo passes dry-run AND runs 7 days in production with no error spike." Confirm that 7 days is the correct soak window (vs 3 days, 14 days, or "first 100 successful crawl runs" as alternative measures).
- **Q4 — Future-proofing the Inditex / H&M groups**: ZARA's parent (Inditex) also owns Bershka, Pull&Bear, Massimo Dutti, Stradivarius. H&M Group owns COS, Weekday, Monki. Should the deferred-platform list explicitly enumerate these so they don't get re-investigated by a future research pass? Recommendation: yes, add a single line to `product.md` Roadmap "Out of Scope" sub-table noting "Inditex sub-brands and H&M Group sub-brands inherit the same Akamai blocker — see SPEC-PLATFORM-EXPANSION-001 deferral rationale." Low-cost, prevents redundant future research.
- **Q5 — Akamai pacing for Uniqlo**: Default `crawlDelay` for Uniqlo. Research.md §7 Open Question 6 leaves this to user decision. Recommendation: **1 req/sec (1000 ms) baseline**, adjust empirically if probe runs successfully. Confirmed via Q5 verification (§4) and codified in REQ-002.

## 9. Methodology Note (DDD)

Project's `.moai/config/sections/quality.yaml` has `development_mode: ddd` (per the auto-config rule for projects with <10% test coverage; this project has 0%). The Run phase will follow ANALYZE-PRESERVE-IMPROVE:

- **ANALYZE**: Re-read research.md §3 (existing engine surface) and §6 (Uniqlo engine strategy). Map the JSON response shape from the live API to the `Product` schema field-by-field. Identify exactly which fields fall back to `null` vs which must be present.
- **PRESERVE**: Capture one live Uniqlo API response (one category page, ~50–100 products) into `tests/fixtures/uniqlo-kr-products.fixture.json`. Write characterization tests that run the engine's parse path against this fixture and assert the resulting `Product[]` array has expected count and field shape. The fixture is frozen — it captures the API as of the SPEC date.
- **IMPROVE**: Implement `uniqlo-engine.ts`, the dispatch wiring, and the robots-check helper. Tests must remain green throughout. The IMPROVE phase ends when the dry-run probe (REQ-003) succeeds against the live API and the characterization tests pass against the fixture.

This is a greenfield engine — there is no existing Uniqlo behavior to preserve. The "PRESERVE" step is therefore fixture creation rather than test-existing-code, which is the legitimate DDD adaptation for new components inside a brownfield project.

## 10. References

- Research artifact (read-first input for this plan): `.moai/specs/SPEC-PLATFORM-EXPANSION-001/research.md`
- Project product context: `.moai/project/product.md` (33-platform target, R2 deferred, no test infra)
- Project structure context: `.moai/project/structure.md` ("Adding a New Platform" checklist — to be amended by this SPEC)
- Project tech context: `.moai/project/tech.md` (no test framework, KRW FX hardcoded, Supabase write-only)
- Existing engine reference: `src/lib/shopify-engine.ts` (fetch-pagination pattern model)
- SiteConfig schema: `src/lib/types.ts:53`, `:97-134`
- Dispatch surface: `src/crawl.ts:45-147` (probeSite), `:153-223` (runCrawl)

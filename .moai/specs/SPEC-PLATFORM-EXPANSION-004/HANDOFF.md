# HANDOFF — SPEC-PLATFORM-EXPANSION-004 (29CM Crawler)

**Plan-phase completed**: 2026-05-06 by hansangho (research + spec drafted 2026-05-05; acceptance + handoff finalized 2026-05-06)
**Run-phase target**: separate Claude Code session, branch `feature/SPEC-PLATFORM-EXPANSION-004`

## How to resume

1. `cd /Users/hansangho/Desktop/kikoai/crawler`
2. `git checkout feature/SPEC-PLATFORM-EXPANSION-004` (already on it if continuing)
3. `/moai run SPEC-PLATFORM-EXPANSION-004`
4. Read order: spec.md → plan.md → acceptance.md → research.md
5. **Run-phase ANALYZE step is gated by two HARD preconditions** (acceptance.md AC-9 and AC-10). Do NOT write production engine code until both pass. The order is: AC-9 (Cloudflare-bypass + XHR-interception verification) → AC-10 (ToS verification in same Playwright session).

## Key decisions baked in

- **Engine path**: Path (c) Pure Playwright + XHR interception. Path (a) mobile-API discovery and Path (b) Next.js RSC reverse-engineering were both conclusively eliminated by research.md §2 probe evidence (search-api requires non-empty keyword; item-api/display-bff-api are auth-gated returning 500/404 from external clients; App Router RSC payloads ship navigation-only data; Pages Router `__NEXT_DATA__` ships sub-category nav only — products load client-side via React Query).
- **Browser launch**: Vanilla `chromium.launch({headless: "new"})` is the default. Cloudflare on 29CM is passive (research.md §3.1 confirmed 5/5 sequential plain-fetch HTTP 200 with no challenge), so unlike ZARA's `channel: "chrome"` Akamai workaround, 29CM does NOT need a real Chrome binary by default. `channel: "chrome"` is documented as a 1-LOC Run-phase escalation if REQ-007 verification falls below 80% reliability — pre-authorized, no SPEC amendment required.
- **Catalog scope**: Women + Men full fashion only — 10 hardcoded L1 category codes (`[268100100, 269100100, 270100100, 271100100, 305100100, 272100100, 273100100, 274100100, 275100100, 306100100]` from research.md §1.6). Lifestyle/design/books/kitchen/beauty/electronics explicitly out of scope.
- **New SiteConfig field**: `apiCategoryCodes?: number[]` — distinct from Uniqlo's `apiCategoryPaths: string[]`, ZARA's `categoryUrls: string[]`, and Uniqlo's `region`. Engine constructs URLs at runtime: `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED`. JSDoc must explicitly bind to `type === "29cm"` to prevent cross-engine contamination.
- **PlatformType**: New `"29cm"` literal (5th entry, joining `"cafe24" | "shopify" | "uniqlo" | "zara"`). NOT a generic `"playwright"` or `"cloudflare"` type. Future Cloudflare-passive Playwright SPECs should introduce their own narrow types.
- **ToS verification posture**: DEFERRED to Run-phase Playwright session — NO canonical 29CM ToS PDF was located at plan phase (asset.29cm.co.kr CDN probes returned HTTP 403, static.29cm.co.kr DNS unresolvable, apihub notice endpoint empty). This is the same situation SPEC-003 v0.1.0 faced before the project owner located the canonical ZARA PDF on `static.zara.net`. The Run-phase ANALYZE step MUST open `https://www.29cm.co.kr/home/agreement` in the same Playwright session, capture the rendered Korean ToS text via `page.evaluate(() => document.body.innerText)` after CSR hydration, and embed verbatim relevant clauses + verdict label as top-of-file comment block in `src/lib/29cm-engine.ts`. See acceptance.md AC-10 for the full verdict classification rules.
- **Soak gate removed**: SPEC-001 §2.4 amendment dated 2026-05-05 removes the 7-day Uniqlo KR soak entry condition. SPEC-004 may proceed immediately without a production soak window. Risks the soak originally guarded against (API drift, anti-bot escalation, robots.txt change) are caught by always-on test suite + runtime robots-check + abort-on-3-errors fail-loud behavior.

## Reference SPECs to mimic

- **SPEC-001 (Uniqlo KR)**: rate limit pacing baseline mechanic, dry-run flow, robots-check pre-flight, abort-on-3-consecutive-errors mechanic, characterization-test fixture pattern (`node:test` runner + frozen JSON fixture), `--rate=N` operator override with rate-cap policy. SPEC-004 inherits all of these via the engine-agnostic `src/lib/robots-check.ts` and the `parseRateFlag` helper. None re-stated in SPEC-004.
- **SPEC-002 (Uniqlo US)**: Region parameterization pattern. NOT applicable to 29CM — 29CM is KR-only platform; no `region` field used. FX module lift to `src/lib/fx.ts` also irrelevant — 29CM is KRW-native, no FX conversion at engine OR import time.
- **SPEC-003 (ZARA KR)**: Primary structural template. Reuse the entire Playwright + XHR-interception architecture: browser/context/page lifecycle owned internally by the engine, `page.on("response")` AJAX-interception listener installed at context start, 5-element UA rotation list (one UA per crawl run), image-host whitelist function, `parseProductsFromDom` pure parse function with selector fallback chain, abort-on-3-consecutive-errors counter mechanic, top-of-file comment block holding verbatim Korean ToS clause + capture metadata. **Three deltas from ZARA**: (1) vanilla `headless: "new"` instead of `channel: "chrome"` (Cloudflare passive vs Akamai active), (2) Cloudflare-challenge detector (`is29cmCloudflareChallenge`) instead of bm-verify detector — different HTML signature (`cf-mitigated` / `Just a moment` / `cf-challenge-platform` instead of `bm-verify`), (3) numeric `apiCategoryCodes: number[]` consumed via runtime URL construction instead of pre-built `categoryUrls: string[]`.

## Existing infra (verify present before run)

- `src/lib/robots-check.ts` (SPEC-001) — engine-agnostic; reuse unchanged
- `src/lib/fx.ts` (SPEC-002) — KRW=1 entry exists; not invoked for 29CM (KRW-native)
- `src/lib/uniqlo-engine.ts` (SPEC-001/002) — reference for UA rotation list, abort-on-3 counter mechanic, pure parse function pattern
- `src/lib/zara-engine.ts` (SPEC-003) — primary structural reference; ~280 LOC; reuse pattern wholesale with three deltas listed above
- `src/lib/cafe24-engine.ts` — reference for `var` constraint inside `page.evaluate` (`tsx __name` transformation breaks `let`/`const` inside browser-context closures)
- `src/lib/shopify-engine.ts` — reference for fetch-based image-host whitelist contract
- `playwright ^1.58.2` in `package.json` — already installed for Cafe24 + ZARA engines; reuse for 29CM
- `node:test` + `tsx` + `dotenv-cli` — test runner already wired in package.json scripts (`pnpm test` invokes `node --test --import tsx ./tests/*.test.ts`)
- 35 platforms registered in `src/configs/platforms.ts` (22 Cafe24 + 10 Shopify + 2 Uniqlo + 1 ZARA). 29CM is the 36th.

## HARD rules (do not violate)

- **No new dependencies**: Playwright already at `^1.58.2`. No `puppeteer-extra-plugin-stealth`, no `playwright-stealth`, no `undici` JA3, no Vitest, no ESLint, no Biome, no Prettier. `tsc --noEmit` is the only static check. `node:test` is the only test runner.
- **No fingerprint evasion**: Project HARD rules forbid stealth plugins, JA3 fingerprinting libraries, header spoofing beyond standard browser UA. Engine MUST work with vanilla Playwright + realistic UA + locale + viewport + timezone, OR with `channel: "chrome"` if escalation required, OR not at all.
- **No IP rotation, residential proxy, CAPTCHA solving, authenticated scraping**: Inherited HARD prohibitions from SPEC-001 §2.3 and SPEC-003 §2.3.
- **No mobile-app reverse-engineering**: Forbidden by project HARD rules (SPEC-003 §2.5 precedent).
- **No Xvfb-in-CI without separate SPEC**: If vanilla `headless: "new"` AND `channel: "chrome"` both fail REQ-007, introducing Xvfb requires a separate SPEC. SPEC-004's rollback path beyond `channel: "chrome"` is deferral, not workaround.
- **No Musinsa graduation**: 29CM is owned by Musinsa (acquired 2021), but Musinsa.com remains deferred per project HARD rule #1 (verbatim `Disallow: /` for `User-agent: *` in Musinsa robots.txt). 29CM's permissive robots.txt does NOT carry over. SPEC-004 is NOT a precedent for Musinsa graduation.
- **ToS clause verbatim embed REQUIRED in `src/lib/29cm-engine.ts`**: If any Korean clause references automation/crawling/scraping/IP-rights, the verbatim Korean text MUST be embedded as top-of-file comment block. NO paraphrasing, NO translation-only, NO summarization. Verbatim quoting is the audit-evidence contract. See acceptance.md AC-10 for verdict classification rules and full comment-block format.
- **TypeScript identifier note**: TS identifiers can't start with a digit. The PlatformType union string literal `"29cm"` is fine (string literal types). The filename `29cm-engine.ts` is fine. But code identifiers must use a safe form like `crawl29cm`, `parseProductsFromXhr`, `is29cmCloudflareChallenge`, `TWENTYNINECM_USER_AGENTS`. Do NOT write `function 29cm() {}`.

## Outstanding clarifications (anything blocking run)

- **None blocking**. All 10 plan-phase decisions (D1-D10 in plan.md §8) are pre-resolved. Two Run-phase HARD preconditions (AC-9 Cloudflare-bypass verification + AC-10 ToS verification) gate the engine — these are expected work, not blockers.
- 8 low-priority Run-phase clarifications are tracked in plan.md §8 (C1-C8): exact XHR endpoint URL identification, XHR response shape, UA rotation per request vs per context, image-host whitelist verification, DOM selector fallback chain composition, Cloudflare-challenge signature heuristic refinement, per-category product cap tuning, gender-derivation correctness against potential "unisex" L1 codes. None block the start of Run phase; all are resolved during ANALYZE.

## Live probe results from plan phase

- **robots.txt status**: HTTP 200, **PERMISSIVE** for `User-agent: *` (research.md §1.1). Wildcard group has explicit `Allow: /` with selective Disallow for `/embed/`, `/home/embed/`, `/my-page/`, `/order/`, `/auth/`, `/inbox/`, `/content/post/preview`. Product detail URLs (`/product/catalog/{id}`) and category landing URLs (`/store/category/list?categoryLargeCode=...`) are NOT disallowed. Only `Baiduspider` has blanket `Disallow: /` (does not affect Mozilla UA). `src/lib/robots-check.ts` blanket-disallow detector returns `{allowed: true}`.
- **API endpoint probe**: NO public full-catalog API exists (research.md §2.8 conclusion). `apihub.29cm.co.kr/item/category/?category1_code=N` returns HTTP 200 but navigation-tree only (no products). `search-api.29cm.co.kr/api/v4/products?keyword=X` returns rich JSON but requires non-empty keyword and silently caps ~48 items. `item-api.29cm.co.kr/api/v1/items?categoryLargeCode=N` returns HTTP 500 (auth-gated). `display-bff-api.29cm.co.kr/...` returns HTTP 404 on all probed paths (auth-gated). Next.js RSC payloads ship navigation-only data. Conclusion: only Path (c) — Playwright + XHR interception with browser-acquired session cookies — can drive full Women+Men catalog browsing.
- **ToS verdict**: **UNVERIFIED at plan phase**. `https://www.29cm.co.kr/home/agreement` returns 5KB Angular CSR shell that hydrates ToS text via JS after page load (not in static curl-fetched HTML). All canonical PDF probes failed (asset.29cm.co.kr returned HTTP 403; static.29cm.co.kr DNS unresolvable; apihub notice endpoint empty). Run-phase ANALYZE MUST open `/home/agreement` in same Playwright session as REQ-007 verification, capture rendered Korean ToS text via `page.evaluate(() => document.body.innerText)`, scan for keywords (자동화, 크롤, 스크래, 봇, 로봇, 데이터 수집, 추출, agent, robot, scrape, crawl, automated, automation, AI 학습, 머신러닝), embed verbatim relevant clauses + verdict in `src/lib/29cm-engine.ts` top-of-file comment block per acceptance.md AC-10.
- **Cloudflare/Akamai detection**: **Cloudflare PASSIVE** (research.md §3.1). 5 sequential plain-fetch GET requests to `/`, `/store/category/list?categoryLargeCode=268100100`, and `https://search-api.29cm.co.kr/api/v4/products?keyword=shirt` all returned HTTP 200 with full content (146 KB / 916 KB / 44 KB respectively). Every response sets `__cf_bm` cookie + `cf-ray` header but NO JS challenge, NO `cf-mitigated`, NO 5-second redirect, NO rate-limit escalation observed. Posture is dramatically more permissive than ZARA's Akamai (which actively returns a 2,141-byte bm-verify intercept on every request). Vanilla `chromium.launch({headless: "new"})` is the default; `channel: "chrome"` documented as 1-LOC Run-phase escalation if REQ-007 reveals unexpected escalation.

## File layout summary (LOC delta estimate)

| File | Action | Est. LOC |
|---|---|---|
| `src/lib/29cm-engine.ts` | NEW | ~300 |
| `src/lib/types.ts` | MODIFY | ~5 |
| `src/configs/platforms.ts` | MODIFY | ~30 |
| `src/crawl.ts` | MODIFY | ~50 |
| `tests/fixtures/29cm-products.fixture.json` | NEW | ~150 |
| `tests/29cm-engine.test.ts` | NEW | ~150 |
| `.moai/project/structure.md` | MODIFY | ~10 |
| `package.json` | NO CHANGE | 0 |
| **Total** | | **~695** |

## Run-phase entry checklist

1. [ ] Branch confirmed: `feature/SPEC-PLATFORM-EXPANSION-004`
2. [ ] Read spec.md → plan.md → acceptance.md → research.md (in that order)
3. [ ] Verify existing infra present (run `ls src/lib/{robots-check,zara-engine,uniqlo-engine}.ts`; confirm `playwright` in package.json deps)
4. [ ] AC-9 ANALYZE: write ephemeral scratch script, run 5 sequential `page.goto` probes against `categoryLargeCode=268100100`, record results, decide vanilla vs `channel: "chrome"` vs escalate
5. [ ] AC-10 ANALYZE: in same Playwright session, navigate to `/home/agreement`, capture Korean ToS text, classify verdict, prepare verbatim comment block
6. [ ] PRESERVE: capture intercepted XHR JSON to `tests/fixtures/29cm-products.fixture.json`; capture synthetic Cloudflare-challenge HTML for detector test
7. [ ] IMPROVE: implement engine + types + config + dispatch + tests, in that order
8. [ ] Verify: `pnpm typecheck && pnpm test` zero failures; `pnpm crawl --probe=29cm-kr` reaches real DOM; `pnpm crawl --site=29cm-kr` writes ≥100 products

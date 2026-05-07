# Plan: SPEC-PLATFORM-EXPANSION-006 — Farfetch (KR) luxury multi-brand crawler

Status: draft
Author: hansangho
Date: 2026-05-06

## 1. Intent

Add Farfetch KR storefront (`farfetch.com/kr/`) as the 38th registered platform — first non-self-branded multi-brand luxury editorial in the project. Engine architecture is a hybrid of ZARA's Playwright lifecycle (`channel:"chrome"`, 5-UA rotation, abort-on-3, robots-check, top-of-file ToS comment) and Cafe24's DOM-scrape extraction (no XHR-interception — Farfetch SSRs product cards in initial HTML). KRW-native cache via Farfetch's IP-based geo-routing. Run phase is gated by three HARD preconditions: REQ-007 (8+ multi-nav stability — recon 5/6 at 2.5 sec pacing is promising but not authoritative), REQ-008 (Korean ToS captured live with bilingual keyword scan; URL discovered at `/kr/terms-and-conditions/`), REQ-009 (sitemap-derived `categoryUrls` URL-list verification; sitemap.xml is the authoritative source per Farfetch's robots.txt declaration).

## 2. Scope

### 2.1 In-Scope

- New module `src/lib/farfetch-engine.ts` (~500 LOC) implementing Playwright `channel:"chrome"` + DOM-scrape extraction. Top-of-file ToS comment block AMENDED at Run-phase REQ-008 with verbatim Korean ToS clauses.
- `src/lib/types.ts` (~1 LOC): extend `PlatformType` union with `"farfetch"`.
- `src/configs/platforms.ts` (~30 LOC): append `farfetch-kr` SiteConfig entry with sitemap-verified `categoryUrls` (~30 URLs from Run-phase REQ-009), KRW-native, 3-sec pacing.
- `src/crawl.ts` (~5 LOC): new dispatch case for `type === "farfetch"` routing to `crawlFarfetch`. Probe handler extends to farfetch.
- New characterization fixture `tests/fixtures/farfetch-kr-products.fixture.json` (~150 LOC) — frozen DOM extraction from one real Farfetch KR category landing.
- New `tests/farfetch-engine.test.ts` (~250 LOC) — characterization tests parameterized to fixture, unit tests for all helpers.
- robots-check pre-flight at every Farfetch KR crawl start (REQ-005, reused from SPEC-001 REQ-004).
- `.moai/project/structure.md` (~5 LOC) — add `farfetch-kr` row to platform table (38 total), document Farfetch DOM-scrape pattern.

### 2.2 Out-of-Scope (this SPEC)

- Farfetch regions other than KR (en-US, en-UK, en-EU, en-JP, en-CN, fr-FR) — separate SPECs each.
- Farfetch Kids, Beauty, Home, Watches & Fine Jewelry — deferred.
- Farfetch sub-brands (Browns, Stadium Goods) — separate platforms.
- Engine region-parameterization — KR-only initial; future SPEC may region-param mirroring SPEC-002.
- Per-designer crawl (`/kr/shopping/designers/{slug}`) — deferred (2000+ URLs, multi-nav stability untested at that scale).
- Scroll-based infinite-scroll harvesting — deferred (sitemap-derived URL enumeration is initial strategy).
- Mobile-app reverse-engineering, fingerprint-evasion libraries, Xvfb-in-CI, IP rotation, residential proxies, CAPTCHA solving services, authenticated scraping — all forbidden by project HARD rules.
- Schema migration — None.
- Live FX rate API — N/A (KRW-native).
- Linter/formatter introduction — Inherited.
- Vitest framework — Inherited (`node:test`).

### 2.3 Out-of-Scope (any future SPEC in this series)

Inherited verbatim from SPEC-001 §2.3, SPEC-002 §2.3, SPEC-003 §2.3, SPEC-004 §2.3, SPEC-005 §2.3:

- IP rotation / residential proxy networks
- CAPTCHA solving services
- Headless browser fingerprint evasion libraries
- Any technique that violates a platform's robots.txt for `User-agent: *`
- Authenticated scraping (login automation, session cookie hijack)

### 2.4 Soak-Gate Status

The 7-day soak gate originally defined in SPEC-001 §2.4 was removed by user direction 2026-05-05. SPEC-006 may proceed immediately once REQ-007/008/009 are green.

## 3. EARS Requirements (proposed — finalized in spec.md)

REQ-001 [Ubiquitous]: THE crawler SHALL register `farfetch-kr` SiteConfig with `key: "farfetch-kr"`, `type: "farfetch"`, `baseUrl: "https://www.farfetch.com/kr"`, `region: "KR"`, `sourceCurrency: "KRW"`, `crawlDelay: 3000`, sitemap-derived ~30-entry `categoryUrls`. PlatformType extended with `"farfetch"`.

REQ-002 [Ubiquitous]: THE Farfetch engine SHALL be implemented as new `src/lib/farfetch-engine.ts` using Playwright `channel:"chrome"` + DOM-scrape (NOT XHR-interception). Minimal context options (let server geo-route to KR locale). 5-UA rotation per context.

REQ-003 [Event-driven]: WHEN `pnpm crawl --site=farfetch-kr` runs without `--dry-run`, THE crawler SHALL invoke `crawlFarfetch`, iterate `categoryUrls` with 3-sec pacing, walk SSR'd product card DOM via `page.evaluate`, write `data/farfetch-kr-products.json` with KRW-native prices.

REQ-004 [Event-driven]: WHEN `pnpm crawl --site=farfetch-kr --dry-run` runs, THE crawler SHALL invoke probe handler against FIRST `categoryUrls` URL, assert ≥60 cards, print sample, NOT write JSON.

REQ-005 [State-driven]: WHILE starting any Farfetch KR crawl, THE crawler SHALL invoke `checkRobots`. (SPEC-001 REQ-004 reused; research.md §1.1.)

REQ-006 [Unwanted Behavior]: IF 3 consecutive errors per category (timeout / selector-fail / challenge-intercept / exception), THEN engine SHALL abort that category. **EXTENSION**: HTTP 4xx + cards >= 10 is NOT an error (Farfetch pagination quirk per research.md §1.4).

REQ-007 [State-driven]: WHILE Run-phase ANALYZE in progress (BEFORE non-dry-run crawl), THE operator SHALL verify `chromium.launch({channel:"chrome"})` reliably handles 8 sequential nav within single session (≥7 of 8 reach DOM with cards >= 60, 0 challenge keywords). Recon 5/6 baseline NOT authoritative. If <87.5%, rollback paths: tighter pacing / per-category reset / deferral / reduced URL set. NO fingerprint evasion. (research.md §1.3, §4.)

REQ-008 [State-driven]: WHILE Run-phase ANALYZE in progress (AFTER REQ-007), THE operator SHALL open `https://www.farfetch.com/kr/terms-and-conditions/` in Playwright, capture rendered Korean ToS body, scan bilingual keywords (Korean: `크롤러`/`크롤링`/`자동화`/`봇`/`로봇`/`스크래핑` etc.; English-as-loanword: `crawl`/`crawler`/`scrape`/`bot`/`automated` etc.), embed verbatim Korean clauses in `farfetch-engine.ts` top-of-file, classify verdict (PERMITS/AMBIGUOUS-ACCEPTED-BY-OWNER/AMBIGUOUS-REJECTED/FORBIDS). If FORBIDS, set `disabled: true`, escalate. OWNER OVERRIDE pattern per SPEC-004. (research.md §1.2.)

REQ-009 [State-driven]: WHILE Run-phase ANALYZE in progress, THE operator SHALL download `sitemap.xml`, extract ~30 candidate URLs (Men + Women + L2 Clothing/Shoes/Bags/Accessories), live-verify each (cards >= 60 OR 4xx+cards>=10 per REQ-006). Failed URLs replaced from sitemap OR removed with comment. Final list >=20 entries (>=8 Men + >=8 Women). (research.md §1.4.)

REQ-010 [Ubiquitous]: THE characterization-test suite SHALL load `farfetch-kr-products.fixture.json`, run `parseProductsFromCards`, assert all products populated + image hosts whitelisted + productUrl regex match + KRW sanity range + `priceFormatted` "₩" prefix. Helper unit tests for `isSafeFarfetchImageUrl`, `isSafeFarfetchProductUrl`, `detectChallengeIntercept`, `deriveGenderFromUrl`. (SPEC-005 REQ-010 pattern.)

REQ-011 [Unwanted Behavior]: IF any assertion fails, THEN test runner SHALL fail with non-zero exit code, blocking CI. (SPEC-002 REQ-008.)

Inherited (not re-stated): SPEC-001 rate-limit pacing, `--rate=N` operator override, abort-on-3 mechanic, characterization fixture conventions; SPEC-003 Playwright lifecycle (`channel:"chrome"`, browser owned by engine, `finally` close), 5-UA rotation, top-of-file ToS comment contract, image-host whitelist; SPEC-004 live ToS Playwright capture pattern + OWNER OVERRIDE; SPEC-005 Run-phase HARD gate REQ-007/008/009 pattern.

## 4. Files to Modify

| File | Action | Est. LOC | Reason |
|---|---|---|---|
| `src/lib/farfetch-engine.ts` | NEW | ~500 | Playwright + DOM-scrape engine. Top-of-file ToS comment block AMENDED at Run-phase REQ-008 with verbatim Korean clauses. Public API: `crawlFarfetch`, `parseProductsFromCards`, `isSafeFarfetchImageUrl`, `isSafeFarfetchProductUrl`, `detectChallengeIntercept`, `deriveGenderFromUrl`, `pickFarfetchUserAgent`. Lifecycle wrapper borrowed from ZARA's `crawlOneCategory` shape; XHR-interception replaced with `extractCardsFromDom` + `parseProductsFromCards`. Defensive null-handling per Cafe24 pattern. |
| `src/lib/types.ts` | MODIFY | ~1 | Extend `PlatformType` union: add `"farfetch"`. No other schema change. |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `farfetch-kr` SiteConfig: `key/name/type/baseUrl/region/sourceCurrency/crawlDelay`, hardcoded ~30-URL `categoryUrls` (sitemap-verified at REQ-009), `notes` documenting REQ-007/008/009 verified results. |
| `src/crawl.ts` | MODIFY | ~5 | Dispatch case for `type === "farfetch"`, probe handler extension. |
| `src/import-products.ts` | NO CHANGE | 0 | KRW-native; SPEC-002 hook no-op. |
| `src/lib/fx.ts` | NO CHANGE | 0 | KRW-native. |
| `src/lib/robots-check.ts` | NO CHANGE | 0 | Region-agnostic global `robots.txt`. |
| `tests/fixtures/farfetch-kr-products.fixture.json` | NEW | ~150 | Frozen DOM extraction (~50-100 products) from one real category page, captured during Run-phase PRESERVE. |
| `tests/farfetch-engine.test.ts` | NEW | ~250 | Characterization + unit tests per REQ-010. |
| `.moai/project/structure.md` | MODIFY | ~5 | Platform count 37→38. Document Farfetch DOM-scrape pattern. |
| `package.json` | NO CHANGE | 0 | No new deps. |

Total estimated LOC delta: **~941**.

Verification needed before Run phase:

- [x] Region scope resolved — KR only.
- [x] Catalog scope resolved — Men + Women full fashion + L2 Clothing/Shoes/Bags/Accessories.
- [x] Engine architecture resolved — new `farfetch-engine.ts`, NOT extension of ZARA. (research.md §2.3.)
- [x] Currency resolved — KRW-native via geo-routing.
- [x] Anti-bot strategy — `channel:"chrome"`, 3-sec pacing, 5-UA rotation, robots-check.
- [x] Sitemap declared by Farfetch — `https://www.farfetch.com/sitemap.xml`. (research.md §1.1.)
- [x] ToS URL discovered — `https://www.farfetch.com/kr/terms-and-conditions/`. (research.md §1.2.)
- [x] Multi-nav baseline 5/6 at 2.5 sec — promising but not authoritative.
- [ ] **Pending Run-phase REQ-007**: 8+ multi-nav stability ≥87.5% at 3 sec pacing.
- [ ] **Pending Run-phase REQ-008**: Korean ToS live capture, verdict classification, verbatim embedding.
- [ ] **Pending Run-phase REQ-009**: Sitemap-derived ~30-URL list verified live.
- [ ] **Pending Run-phase ANALYZE**: card selector locked (`[data-component*="ProductCard"]` or `a[href*="-item-"]` candidates per research.md §3.1).
- [ ] **Pending Run-phase ANALYZE**: image-host whitelist locked (`cdn-images.farfetch-contents.com` / `cdn.farfetch.com` per §3.2).
- [ ] **Pending Run-phase ANALYZE**: productUrl regex locked (`^https:\/\/www\.farfetch\.com\/kr\/shopping\/[^"'\s]+-item-\d+\.aspx$` hypothesis per §3.3).

## 5. Reference Implementations

- **ZARA engine** (`src/lib/zara-engine.ts`): primary structural reference. Borrow `crawlOneCategory` Playwright lifecycle wrapper, `crawlZara` entry function shape, abort-on-3 mechanic, image-host whitelist contract, 5-UA rotation, top-of-file ToS comment block. Replace XHR-interception with DOM evaluation.
- **Cafe24 engine** (`src/lib/cafe24-engine.ts`): DOM-scrape pattern reference. Borrow `page.evaluate` walking pattern. Adapt to Farfetch's React-based DOM (different from Cafe24's traditional server-rendered).
- **29CM engine** (`src/lib/29cm-engine.ts`): live ToS Playwright capture pattern (REQ-008). 29CM's ToS named "크롤러" verbatim and required OWNER OVERRIDE — Farfetch may need same path.
- **SPEC-005 ZARA US** (`.moai/specs/SPEC-PLATFORM-EXPANSION-005/`): Run-phase HARD gate pattern (REQ-007/008/009). Mirror exact shape: pre-condition probes, ToS verbatim embedding, sitemap-derived URL verification, parameterized fixture testing, post-Run-phase frontmatter status update.
- **Crawl dispatch** (`src/crawl.ts`): existing branches for `type === "zara"`, `type === "29cm"` are templates for the new `type === "farfetch"` branch.
- **Robots-check** (`src/lib/robots-check.ts`): region-agnostic by design. No change.
- **SiteConfig schema** (`src/lib/types.ts:53`): `PlatformType` union extension only. `region`, `sourceCurrency`, `crawlDelay`, `categoryUrls` all reused.

## 6. Technology Stack

No new production dependencies. No new devDependencies. Stack unchanged from `.moai/project/tech.md`:

- Node.js >= 22.0.0, TypeScript ^5.6.0, pnpm >= 9.0.0
- Existing deps: `playwright` (^1.58.2 — already used by Cafe24, ZARA, 29CM; reused for Farfetch), `@supabase/supabase-js`, `tsx`, `dotenv-cli`
- Test runner: `node:test` (built-in, inherited)

The Farfetch engine uses `chromium.launch({channel:"chrome", headless: true})` (mirrors ZARA/29CM pattern). Real Chrome required because anti-bot vendors (DataDome, Akamai, Cloudflare) typically detect bundled Playwright Chromium via TLS/header fingerprint. `channel:"chrome"` swaps in the host's installed Chrome binary — vanilla Playwright option, NOT a stealth plugin, conforms to project HARD rules.

**Pacing note**: Farfetch uses 3-sec pacing (vs ZARA's 2 sec). The 50% slower cadence is empirically justified by Farfetch being a luxury multi-brand editorial with potentially higher anti-bot monitoring. Run-phase REQ-007 verification at 3 sec is the gating signal.

## 7. Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DataDome / anti-bot escalation at scale (50+ navigations, full ~30 categoryUrls × multi-page) | Medium | High | REQ-007 8+ multi-nav HARD precondition at 3-sec pacing. Rollback paths: tighter pacing, per-category browser reset, deferral, reduced URL set. NO fingerprint evasion. (research.md §4.) |
| Farfetch KR ToS contains anti-scraping clause naming "크롤러" verbatim (analogous to 29CM) | Unknown | Critical (de-facto deferral) | REQ-008 Run-phase Korean ToS live capture with bilingual keyword scan. Verbatim Korean clauses embedded as audit evidence. If FORBIDS, `disabled: true` + OWNER OVERRIDE pattern (SPEC-004 precedent). |
| HTTP 400 pagination quirk breaks engine's status-based abort | Already observed (research.md §1.4) | Medium | REQ-006 explicitly extends abort criteria: 4xx + cards >= 10 is NOT an error. Engine reads DOM count BEFORE checking status. |
| Card selector drifts after Farfetch seasonal redesign (luxury sites redesign 1-2x/year) | Medium | Medium | Parameterized characterization fixture (REQ-010) catches drift on `pnpm test`. Selector chain has 3 fallback candidates per research.md §3.1. Refresh fixture per major season change OR when test failures surface. |
| KR locale instability (server ABA-tests English fallback for KR users) | Low | Low | Engine asserts Hangul presence in product names. Drift caught by characterization fixture. |
| Farfetch issues C&D communication | Low | Critical | `disabled: true` toggle ready. KR engine independent of future US/UK SPECs. Halt-on-C&D is project HARD rule #1. |
| Sitemap.xml drift — categoryUrls become stale between crawls | Medium | Low | 90-day refresh cadence (mirrors ZARA ToS re-verify cadence). Refresh on first failure. |
| Image-host whitelist insufficient (3rd-party CDN — Cloudinary, ImageKit, Fastly) | Low | Low | PRESERVE step inspects 50+ live `<img src>`. Document additions to whitelist with comment. |
| 4xx pagination → 5xx escalation at scale | Low | High | If sustained 5xx surfaces, switch to sitemap-only URL list (no `?page=N` synthesis). REQ-009 already prefers sitemap. |
| Playwright lifecycle is not unit-tested → regressions go undetected until live `--probe` | Medium | Medium | Acknowledged inherited risk. Engine's pure parse function is testable against frozen fixtures; lifecycle is smoke-tested only via live `--probe` per REQ-004. Operator process: run `pnpm crawl --probe=farfetch-kr` after any change to lifecycle code. Captured in acceptance.md AC-7. |
| Designer-level URL is later required for catalog completeness — sitemap may not cover all designer pages | Low | Low | Out of scope here. Future SPEC adds `/kr/shopping/designers/{slug}` enumeration if needed. |

## 8. Decision Log (Pre-Resolved)

These items are pre-resolved by user spawn prompt and research-driven engine recommendation; no user decision required at /moai run time:

- **D1 — Region scope**: Farfetch KR only. Other regions out of scope.
- **D2 — Catalog scope**: Men + Women top + L2 (Clothing, Shoes, Bags, Accessories). Kids/Beauty/Home/Watches&Jewelry deferred.
- **D3 — Engine architecture**: New `src/lib/farfetch-engine.ts`. Hybrid Playwright lifecycle (ZARA-borrowed) + DOM-scrape extraction (Cafe24-borrowed). NOT region-parameterized.
- **D4 — Soak gate**: Removed by user direction 2026-05-05.
- **D5 — Currency / FX**: KRW-native via Farfetch geo-routing. No engine-time conversion. No import-time conversion (SPEC-002 hook is no-op for KRW).
- **D6 — `PlatformType` extension**: Add `"farfetch"` to union (1 LOC).
- **D7 — Anti-bot bypass**: `chromium.launch({channel:"chrome", headless: true})` — same as ZARA/29CM. 5-UA rotation, 3-sec pacing.
- **D8 — `categoryUrls`**: ~30 URLs sitemap-derived at Run-phase REQ-009. Hardcoded after live verification.
- **D9 — Test framework**: `node:test` reused. Characterization fixture per SPEC-005 pattern.
- **D10 — Ship-shelved-on-FORBIDS**: If REQ-008 verdict is FORBIDS, ship with `disabled: true`. OWNER OVERRIDE pattern (SPEC-004) available.

Open clarifications that may surface during /moai run (low-priority, non-blocking):

- **C1 — UA rotation per request vs per context**: Same constraint as ZARA (Playwright context UA set once). One UA per crawl run, picked from rotation list at `crawlFarfetch` entry.
- **C2 — Image-host whitelist re-verification**: Hypothesis `cdn-images.farfetch-contents.com`. Run-phase ANALYZE step inspects actual `<img src>` values.
- **C3 — Card selector lock**: Three candidates per research.md §3.1. Run-phase ANALYZE locks the primary.
- **C4 — Challenge-intercept signature**: Hypothesis `body length < 5,000 + title contains "Just a moment|challenge|datadome|cf-mitigated"`. Re-confirm at Run-phase IMPROVE.
- **C5 — Per-category product cap**: Initial cap 200 products per category landing (mirrors ZARA). Operator can tune via SiteConfig later.
- **C6 — `priceFormatted` KR formatter**: `₩{price.toLocaleString("ko-KR")}` (mirrors ZARA KR pattern).
- **C7 — Pagination ceiling**: Initial cap 50 pages per category URL. Run-phase IMPROVE may tune based on observed Farfetch pagination depth.
- **C8 — Korean keyword vocabulary**: Standard list expanded with `자동 수집`, `자동화 도구`, `봇 차단`, `프로그램`, `소프트웨어 이용`. Re-verification triggers per ToS clause embedding contract.

## 9. Methodology Note (DDD)

Project's `.moai/config/sections/quality.yaml` has `development_mode: ddd` (auto-config rule for projects with limited test coverage). Run phase follows ANALYZE-PRESERVE-IMPROVE:

- **ANALYZE**:
  1. **Multi-nav stability verification for Farfetch KR** (REQ-007): scratch script with `chromium.launch({channel:"chrome", headless: true})`, navigate 8 sequential URLs (e.g., Men/Women top + 4 L2 Clothing/Shoes/Bags/Accessories per gender) at 3-sec pacing, verify ≥7 of 8 reach DOM with cards ≥60 via locked selector. If <87.5%, escalate per rollback path.
  2. **ToS verification for Farfetch KR** (REQ-008): in same Playwright session, navigate to `https://www.farfetch.com/kr/terms-and-conditions/`. Wait for SPA hydration (body length > 50 KB OR body contains identifiable Korean ToS heading). Capture full Korean body via `page.evaluate(() => document.body.innerText)`. Scan for bilingual keyword list (Korean: `크롤러`/`크롤링`/`자동화`/`자동화 도구`/`자동 수집`/`데이터 수집`/`봇`/`로봇`/`로봇 배제`/`프로그램`/`소프트웨어 이용`/`스크래핑`/`스크래퍼`; English-loanword: `crawl`/`crawler`/`crawling`/`scrape`/`scraping`/`scraper`/`robot`/`bot`/`automated`/`automation`/`data harvest`/`data extraction`/`agent`/`automated access`/`data mining`/`screen scraping`/`AI training`/`machine learning`). Identify all relevant clauses. Classify verdict (PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS). Embed verbatim Korean clauses + verdict + capture metadata as comment block at top of `src/lib/farfetch-engine.ts`. If FORBIDS, set `disabled: true` on `farfetch-kr` SiteConfig and escalate (OWNER OVERRIDE pattern per SPEC-004 available).
  3. **`categoryUrls` URL-list verification** (REQ-009): download `https://www.farfetch.com/sitemap.xml` (and any sub-sitemaps it indexes). Extract candidate URLs covering Men + Women top + L2 (Clothing, Shoes, Bags, Accessories). Live-verify each: confirm no redirect to home/marketing AND ≥60 cards via locked selector AND (HTTP 2xx OR 4xx with cards ≥10 per REQ-006). Failed URLs replaced from sitemap OR removed with code comment.
  4. **Card selector lock**: in same Playwright session, inspect live Men/Clothing landing DOM. Test the three candidate selectors (`[data-component*="ProductCard"]`, `[data-testid*="product"]`, `a[href*="-item-"]`). Lock the primary that yields ≥60 unique cards on a single landing.
  5. **Image-host whitelist lock**: extract 50+ live `<img src>` values. Lock the host(s) into `FARFETCH_IMAGE_HOSTS` Set.
  6. **productUrl regex lock**: verify hypothesis `^https:\/\/www\.farfetch\.com\/kr\/shopping\/[^"'\s]+-item-\d+\.aspx$` against 50+ extracted URLs. Lock the regex.

- **PRESERVE**:
  1. Capture one live Farfetch KR category landing's DOM extraction into `tests/fixtures/farfetch-kr-products.fixture.json` (e.g., from `/kr/shopping/men/clothing-2/items.aspx`) as the regression baseline. ~50-100 products. Frozen.
  2. Run characterization tests against the fixture; confirm `parseProductsFromCards` produces the expected `Product[]` shape per REQ-010.

- **IMPROVE**:
  1. Implement `src/lib/farfetch-engine.ts`: top-of-file ToS comment block with verbatim Korean clauses (REQ-008 capture), `FARFETCH_USER_AGENTS`, `FARFETCH_IMAGE_HOSTS`, `isSafeFarfetchImageUrl`, `FARFETCH_PRODUCT_URL_RE`, `isSafeFarfetchProductUrl`, `detectChallengeIntercept`, `RawFarfetchCard` interface, `extractCardsFromDom`, `parseProductsFromCards`, `crawlOneCategory`, `deriveGenderFromUrl`, `crawlFarfetch`. Borrow lifecycle shape from `src/lib/zara-engine.ts:crawlZara` and `:crawlOneCategory`.
  2. Implement `src/lib/types.ts`: extend `PlatformType` with `"farfetch"`.
  3. Implement `src/configs/platforms.ts`: append `farfetch-kr` SiteConfig with verified `categoryUrls`.
  4. Implement `src/crawl.ts`: dispatch case for `type === "farfetch"`, probe handler extension.
  5. Implement `tests/farfetch-engine.test.ts`: characterization tests + helper unit tests per REQ-010.
  6. Run `pnpm typecheck` — zero errors.
  7. Run `pnpm test` — fixture passes; all unit tests pass.
  8. Run `pnpm crawl --probe=farfetch-kr`; sample product summary prints with KRW pricing; challenge intercept asserted bypassed.
  9. Run `pnpm crawl --site=farfetch-kr`; check `data/farfetch-kr-products.json` has ≥1000 products (broad lower bound) with non-null required fields, KRW-integer prices, `productUrl` starting with `https://www.farfetch.com/kr/shopping/`, `errors.length` ≤ 20% of `categoryUrls.length`.
  10. Run `pnpm tsx src/import-products.ts --site=farfetch-kr`; spot-check 5 Supabase rows; verify KRW prices stored as integers; `source_currency: "KRW"`, `source_price` equals `price` (KRW-native).

This is a **brownfield enhancement** (the project has Cafe24, Shopify, Uniqlo, ZARA, 29CM engines — Farfetch is a structural cross-product of ZARA's lifecycle and Cafe24's DOM-scrape, no novel architecture). DDD is the appropriate methodology because: (a) the fixture is the binding regression artifact (catches selector drift, image-host changes, ToS-comment-block placement); (b) the engine refactor MUST demonstrate compliance with the established Playwright lifecycle pattern before live activation; (c) project-level test coverage for Playwright lifecycle is intentionally low (smoke-test only), so TDD-style "test before code" doesn't apply naturally to lifecycle changes — characterization-first is the right discipline.

## 10. References

- Research artifact: `.moai/specs/SPEC-PLATFORM-EXPANSION-006/research.md`
- Sibling SPECs:
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-001/{spec,plan,research,acceptance}.md` (Uniqlo KR baseline)
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-002/{spec,plan,research,acceptance}.md` (region-parameterization, FX module, USD-at-import-time)
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-003/{spec,plan,research,acceptance}.md` (ZARA KR Playwright lifecycle, `channel:"chrome"`, ToS contract, image-host whitelist, abort-on-3, 5-UA rotation)
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-004/{spec,plan,research,acceptance}.md` (29CM KR live ToS Playwright capture, OWNER OVERRIDE pattern)
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-005/{spec,plan,research,acceptance}.md` (ZARA US Run-phase HARD gate REQ-007/008/009 pattern; primary structural template)
- Project product context: `.moai/project/product.md` (37 platforms post-SPEC-005 → 38 post-SPEC-006)
- Project structure context: `.moai/project/structure.md`
- Project tech context: `.moai/project/tech.md`
- Existing engine references:
  - `src/lib/zara-engine.ts` — Playwright lifecycle template
  - `src/lib/cafe24-engine.ts` — DOM-scrape pattern
  - `src/lib/29cm-engine.ts` — live ToS Playwright capture pattern
- SiteConfig schema: `src/lib/types.ts` (`PlatformType` extension only)
- Dispatch surface: `src/crawl.ts` (new `type === "farfetch"` branch)
- Live recon artifacts (2026-05-06): 6 `page.goto` probes, footer ToS link extraction, robots.txt + sitemap.xml declared

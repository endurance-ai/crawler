# Plan: SPEC-PLATFORM-EXPANSION-005 — ZARA (US) Storefront via Region-Parameterized Engine

Status: draft
Author: manager-spec subagent
Date: 2026-05-06

## 1. Intent

Add ZARA US storefront (`zara.com/us/en`) as the 36th registered platform in the crawler — second ZARA region after KR (SPEC-003), structural cross-product of the SPEC-002 region-parameterization pattern (Uniqlo KR + US shared engine) and the SPEC-003 ZARA Playwright + XHR-interception engine. The implementation refactors `src/lib/zara-engine.ts` from a KR-only module into a region-parameterized shared module driven by the existing `region: "KR" | "US"` field on `SiteConfig` (added by SPEC-002 for Uniqlo, expanded here to bind to ZARA without schema change). KR behavior is preserved bit-for-bit; the new `zara-us` SiteConfig entry activates the US storefront; the `src/import-products.ts` USD→KRW import-time hook (post-SPEC-002) fires automatically for the new USD-source cache file. The Run phase is gated by three HARD preconditions: REQ-007 (Akamai bypass 5x reliability against US — KR's verification CANNOT be substituted), REQ-008 (US English ToS captured live in a real Playwright session — canonical PDF was NOT discoverable at plan phase), REQ-009 (live verification of the 18 hardcoded `categoryUrls` US L2 landings — research.md §1.5 documents 5+ KR-to-US L-code collisions, so naive transfer is impossible). If any of these fail, the engine refactor remains in place but the `zara-us` SiteConfig ships shelved (`disabled: true`) and KR continues unaffected. This SPEC executes immediately — the SPEC-001 7-day soak gate was removed by user direction on 2026-05-05.

## 2. Scope

### 2.1 In-Scope

- Refactor `src/lib/zara-engine.ts` (~150 LOC delta) from KR-only to region-parameterized. Replace hardcoded literals (`"kr/ko"`, `"KRW"`, `"ko-KR"`, `"Asia/Seoul"`, `"₩"`) with region-derived helpers/inline switches. Add `formatZaraPrice(price, region)` helper. Generalize `deriveGenderFromUrl` regex to be region-agnostic. Build `productUrl` validator from `config.baseUrl` (or `config.region`) at engine entry. Thread `region` and `sourceCurrency` through `parseProductsFromXhr`. Inline Playwright context locale + timezone derivation. KR behavior preserved bit-for-bit.
- Top-of-file ToS comment block in `src/lib/zara-engine.ts` AMENDED to include verbatim English US ToS clauses captured in Run-phase REQ-008, alongside (NOT replacing) the existing KR Korean clauses from SPEC-003 v0.2.0.
- `src/lib/types.ts` (~3 LOC): expand `region?: "KR" | "US"` field's JSDoc (line 138) to bind to both `type === "uniqlo"` AND `type === "zara"`. No schema change — field already exists.
- `src/configs/platforms.ts` (~30 LOC): update existing `zara-kr` entry to set `region: "KR"` explicitly. Append new `zara-us` SiteConfig entry with `region: "US"`, `sourceCurrency: "USD"`, hardcoded `categoryUrls` (18 verified US L2 landings from research.md §1.5), `crawlDelay: 2000`, US-specific notes.
- New characterization fixture `tests/fixtures/zara-us-products.fixture.json` (~150 LOC) — frozen XHR JSON snapshot captured ONCE during Run-phase PRESERVE step from one real ZARA US category landing page.
- Modify existing `tests/zara-engine.test.ts` (~40 LOC delta) to parameterize tests by region. Add region-specific assertions per REQ-010 (KR fixture: KRW prefix, ko-KR locale; US fixture: USD prefix, en-US locale). Add unit tests for `formatZaraPrice(price, region)`.
- robots-check pre-flight at every ZARA US crawl start (REQ-005, reused from SPEC-001 REQ-004 — no code change to `src/lib/robots-check.ts`; `robots.txt` is region-agnostic, single global file).
- Update to `.moai/project/structure.md` — add `zara-us` row to platform table (now 37 entries); document ZARA region-parameterization sub-pattern in engine-layering subsection.

### 2.2 Out-of-Scope (this SPEC)

- **ZARA regions other than US** — ES, EU, UK, JP, AU, MX, CA, CL, BR, AR, etc. Each region requires its own SPEC. The engine architecture is structurally extensible (per research.md §4.5), but each region is its own approval gate.
- **Inditex sub-brands** — Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home all share Inditex parent infrastructure but remain deferred per SPEC-001 §2.3. SPEC-005 expands the engine to handle 2 ZARA regions but does NOT auto-graduate any sub-brand.
- **ZARA Kids and Baby sections** — Out of scope per inheritance from SPEC-003 §Non-Goals. Only Women + Men URL hierarchies are crawled.
- **`src/crawl.ts` modification** — The existing dispatch branch routing `type === "zara"` to `crawlZara` is region-agnostic. Both `zara-kr` and `zara-us` SiteConfig entries are picked up automatically. **0 LOC delta.**
- **`src/import-products.ts` modification** — The post-SPEC-002 import-time hook `convertToKrw` fires for `Product.sourceCurrency: "USD"` automatically. ZARA US benefits without modification. **0 LOC delta.**
- **`src/lib/fx.ts` modification** — `FX_TO_KRW.USD = 1430` already populated by SPEC-002. **0 LOC delta.**
- **Engine module rename** — `src/lib/zara-engine.ts` retains its name (NOT renamed to `zara-shared-engine.ts`). Mirrors SPEC-002 which kept `uniqlo-engine.ts` after region-parameterization.
- **`PlatformType` extension** — Already includes `"zara"` from SPEC-003. **0 LOC delta in types.ts for PlatformType.**
- **New SiteConfig field** — `region` and `categoryUrls` both already exist on `SiteConfig`. **0 LOC schema change.**
- **Mobile-app reverse-engineering** — Forbidden by project HARD rules. Not pursued.
- **Fingerprint-evasion libraries** — Forbidden by project HARD rules.
- **Xvfb-in-CI for `headless: false` mode** — If `channel: "chrome"` proves insufficient for US (REQ-007 fails), introducing Xvfb is a separate SPEC. SPEC-005's rollback path is deferral or US-context tightening, not Xvfb workaround.
- **IP rotation, residential proxy networks, CAPTCHA solving services, authenticated scraping** — Inherited HARD prohibitions from SPEC-001/002/003.
- **Schema migration** — No kiko.ai Supabase schema change. ZARA US fields map onto existing `Product` columns. No `price_usd` or `original_price_usd` column added.
- **Live FX rate API** — Hardcoded `USD: 1430` in `src/lib/fx.ts` remains POC-grade. Out-of-scope.
- **FX table extension** — `USD: 1430` already populated. No new currency entries.
- **Linter / formatter introduction** — Inherited from SPEC-001/002/003. `tsc --noEmit` is the only static check.
- **Vitest framework introduction** — Inherited from SPEC-001/002/003. `node:test` is the runner.
- **Other deferred platforms** (Musinsa, H&M, COS, Weekday, Monki, Arket) — Status unchanged.

### 2.3 Out-of-Scope (any future SPEC in this series)

Inherited verbatim from SPEC-001 §2.3, SPEC-002 §2.3, SPEC-003 §2.3, SPEC-004 §2.3:

- IP rotation / residential proxy networks
- CAPTCHA solving services or third-party CAPTCHA APIs
- Headless browser fingerprint evasion libraries
- Any technique that violates a platform's robots.txt for `User-agent: *`
- Authenticated scraping (login automation, session cookie hijack, token replay)
- Inditex sub-brands deferred-with-ZARA (Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home)
- H&M Group sub-brands deferred-with-H&M (COS, Weekday, Monki, Arket)
- Musinsa.com (separate `Disallow: /` blocker, parent of 29CM)

### 2.4 Soak-Gate Status

The 7-day Uniqlo KR soak entry condition originally defined in SPEC-001 §2.4 was **removed by user direction on 2026-05-05**. SPEC-005 may proceed immediately once REQ-007 (Akamai bypass for US), REQ-008 (US ToS verification), and REQ-009 (live `categoryUrls` verification) are green. No production soak window is required.

The risks the soak gate originally guarded against (API drift, anti-bot escalation, robots.txt change) are now caught by the always-on test suite (parameterized KR + US fixtures per REQ-010), the runtime `robots-check.ts` pre-flight (REQ-005), and the engine's abort-on-3-errors fail-loud behavior (REQ-006). Production drift, if it occurs, surfaces in the next crawl run rather than being preemptively blocked.

## 3. EARS Requirements (proposed — finalized in spec.md)

REQ-001 [Ubiquitous]: THE crawler SHALL register `zara-us` SiteConfig with `key: "zara-us"`, `type: "zara"`, `baseUrl: "https://www.zara.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 2000`, hardcoded 18-entry US `categoryUrls` from research.md §1.5. Update `zara-kr` to set `region: "KR"` explicitly. PlatformType and SiteConfig schema unchanged. (research.md §1.5, §3.2.)

REQ-002 [Ubiquitous]: THE ZARA engine SHALL be region-parameterized via the existing `region: "KR" | "US"` field on SiteConfig. Engine SHALL derive Playwright locale, timezone, priceFormatted, productUrl regex, sourceCurrency from region. KR behavior preserved bit-for-bit. No hardcoded `"kr/ko"`/`"KRW"`/`"ko-KR"`/`"Asia/Seoul"`/`"₩"` literal after refactor. (research.md §3.2; SPEC-002 REQ-002 precedent.)

REQ-003 [Event-driven]: WHEN `pnpm crawl --site=zara-us` runs without `--dry-run`, THE crawler SHALL invoke `crawlZara` (same engine entry as KR, region-aware), iterate `categoryUrls`, intercept XHR per category, write `data/zara-us-products.json` with USD-decimal prices and `sourceCurrency: "USD"`. Pacing 2 sec/page. (research.md §1.4, §2.2.)

REQ-004 [Event-driven]: WHEN `pnpm crawl --site=zara-us --dry-run` runs, THE crawler SHALL invoke probe handler against FIRST `categoryUrls` URL, assert real product DOM (not bm-verify intercept), print sample, NOT write JSON. (SPEC-003 REQ-004 reused.)

REQ-005 [State-driven]: WHILE starting any ZARA US crawl, THE crawler SHALL invoke `checkRobots`. (SPEC-001 REQ-004 reused; research.md §1.1 — `robots.txt` region-agnostic.)

REQ-006 [Unwanted Behavior]: IF 3 consecutive errors per category, THEN engine SHALL abort that category, append error entry, continue to next URL. (SPEC-003 REQ-006 reused, region-agnostic.)

REQ-007 [State-driven]: WHILE Run-phase ANALYZE in progress (BEFORE non-dry-run crawl against US), THE operator SHALL verify `chromium.launch({channel:"chrome"})` mode reliably bypasses Akamai bm-verify against `https://www.zara.com/us/en/woman-new-in-l1180.html` (≥4 of 5 sequential page.goto reach real product DOM AND ≥1 XHR captured per attempt). KR pre-verification CANNOT substitute. If <80%, rollback paths: US-context tightening / deferral / Xvfb separate SPEC. NO fingerprint evasion. (research.md §1.3, §4.3.)

REQ-008 [State-driven]: WHILE Run-phase ANALYZE in progress (AFTER REQ-007 passes, BEFORE non-dry-run crawl), THE operator SHALL open `https://www.zara.com/us/en/help-center/legal/terms-of-use` (or homepage footer fallback) in real Playwright session, capture rendered English ToS body, scan for automation/scraping keywords, embed verbatim English clauses in `src/lib/zara-engine.ts` top-of-file comment block (alongside KR Korean clauses, NOT replacing), classify verdict (PERMITS/AMBIGUOUS-ACCEPTED-BY-OWNER/AMBIGUOUS-REJECTED/FORBIDS). If FORBIDS, set `disabled: true` on `zara-us`, abandon US activation, escalate. (research.md §1.2; project HARD rule #1; SPEC-003 v0.1.0 + SPEC-004 patterns.)

REQ-009 [State-driven]: WHILE Run-phase ANALYZE in progress, THE operator SHALL verify each of 18 `categoryUrls` URLs by `page.goto` and confirming no redirect to homepage/mkt page AND ≥10 product card matches AND ≥1 XHR captured. KR L-codes do NOT transfer naively (research.md §1.5 documents 5+ collisions). Failed URLs replaced from `sitemap-category-us-en.xml.gz` OR removed with comment. (research.md §1.5.)

REQ-010 [Ubiquitous]: THE characterization-test suite SHALL load both `zara-products.fixture.json` (KR) and `zara-us-products.fixture.json` (US), run `parseProductsFromXhr` against both with appropriate region, assert all required fields populated, image hosts whitelisted, productUrl prefix matches region, price/priceFormatted matches region (KRW integer + ₩ for KR; USD decimal + $ for US). Unit tests for `formatZaraPrice(price, region)`. (SPEC-002 REQ-007 parameterized fixture pattern.)

REQ-011 [Unwanted Behavior]: IF any assertion fails on either fixture, THEN test runner SHALL fail with non-zero exit code. Failure on either fixture treated as shared-engine regression. Engine NOT split into separate KR/US modules. (SPEC-002 REQ-008.)

Inherited from SPEC-001 (not re-stated): rate-limit pacing baseline mechanic (REQ-002), `--rate=N` operator override (REQ-007), abort-on-3 mechanic (REQ-005), characterization-test runner conventions (REQ-006).

Inherited from SPEC-002 (not re-stated): region-parameterization narrow surface (locale + sourceCurrency + price-formatter only), USD-at-import-time conversion via `convertToKrw` (REQ-004), shared FX module (REQ-005).

Inherited from SPEC-003 (not re-stated): Playwright lifecycle pattern (Chromium with `channel: "chrome"`, browser owned by engine, `finally` close), XHR interception (`page.on("response")` matching `XHR_URL_RE`), bm-verify intercept detection, ToS clause embedding contract, image-host whitelist + `isSafeZaraImageUrl`, product URL whitelist regex, `harvestRawProducts` walker, infinite-scroll loop with selector wait, abort-on-3 broadened to Playwright failure modes.

## 4. Files to Modify

User decisions confirmed by orchestrator spawn prompt: ZARA US only (region scope), Women + Men full fashion catalog, region-parameterize the existing engine (SPEC-002 Uniqlo pattern), USD-at-import-time via existing FX module, `FX_TO_KRW.USD = 1430` reused, channel:"chrome" Akamai bypass (KR pattern, US verification required), soak gate removed.

| File | Action | Est. LOC | Reason |
|---|---|---|---|
| `src/lib/zara-engine.ts` | MODIFY | ~150 | Region-parameterize. Top-of-file ToS comment AMENDED with English US clauses (post-REQ-008 capture) alongside KR Korean clauses. Replace hardcoded `ZARA_PRODUCT_URL_RE` (line 90) with builder from `config.baseUrl` or region. Add `formatZaraPrice(price, region)` helper. Generalize `deriveGenderFromUrl` regex (lines 401-406) to region-agnostic `\/(?:[a-z]{2})\/(?:[a-z]{2})\/(woman|women|man|men|kids|kid)/`. Thread `region` + `sourceCurrency` through `parseProductsFromXhr` (lines 244-290) — replace hardcoded `priceFormatted: \`₩...\`` and `sourceCurrency: "KRW"`. In `crawlZara` (lines 417-526), inline `region === "US" ? {locale: "en-US", timezoneId: "America/New_York"} : {locale: "ko-KR", timezoneId: "Asia/Seoul"}` at `browser.newContext` (lines 474-479). Default region to `"KR"` if `config.region` absent (backward compat). |
| `src/lib/types.ts` | MODIFY | ~3 | Expand `region?: "KR" \| "US"` JSDoc (line 138) to bind to BOTH `type === "uniqlo"` AND `type === "zara"`. No schema change. |
| `src/configs/platforms.ts` | MODIFY | ~30 | Update `zara-kr` entry (line 866-895): add explicit `region: "KR"` (~1 LOC). Append `zara-us` SiteConfig entry (~25 LOC): `key: "zara-us"`, `name: "자라 (US)"`, `type: "zara"`, `baseUrl: "https://www.zara.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 2000`, hardcoded `categoryUrls` (18 verified entries from research.md §1.5), US-specific `notes`. |
| `src/crawl.ts` | NO CHANGE | 0 | Dispatch + probe branches for `type === "zara"` are region-agnostic. Both KR + US picked up automatically. |
| `src/import-products.ts` | NO CHANGE | 0 | Post-SPEC-002 hook: `convertToKrw` fires for `sourceCurrency: "USD"` automatically. |
| `src/lib/fx.ts` | NO CHANGE | 0 | `FX_TO_KRW.USD = 1430` already populated. |
| `src/lib/robots-check.ts` | NO CHANGE | 0 | Region-agnostic, single global `robots.txt`. |
| `tests/fixtures/zara-us-products.fixture.json` | NEW | ~150 | Frozen XHR JSON capture from one real ZARA US category page (~50-100 products), captured during Run-phase PRESERVE via Playwright XHR-interception (debug `console.log(json)` in `page.on("response")` listener). Committed. |
| `tests/zara-engine.test.ts` | MODIFY | ~40 | Parameterize tests by region: load both KR + US fixtures, run parameterized assertions per REQ-010 (US-fixture-specific assertions for USD-decimal price, `"$"` priceFormatted prefix, `"USD"` sourceCurrency, `/us/en/` productUrl prefix). Add unit tests for `formatZaraPrice(price, region)`. |
| `.moai/project/structure.md` | MODIFY | ~5 | Add `zara-us` row to platform table (now 37 entries). Document ZARA region-parameterization sub-pattern in engine-layering subsection (mirrors Uniqlo region pattern from SPEC-002). |
| `package.json` | NO CHANGE | 0 | Playwright `^1.58.2` already in deps. node:test already configured. No new deps. |

Total estimated LOC delta: **~378**.

Verification needed before Run phase:

- [x] Region scope resolved — US only (other ZARA regions out of scope).
- [x] Catalog scope resolved — Women + Men L2 (10 + 8 = 18 URLs), Kids/Baby out of scope (mirrors SPEC-003).
- [x] Engine architecture resolved — region-parameterize existing `zara-engine.ts` (SPEC-002 Uniqlo pattern). NOT separate `zara-us-engine.ts`. (research.md §4.2.)
- [x] FX strategy resolved — USD-at-import-time via `src/import-products.ts` post-SPEC-002 hook + `src/lib/fx.ts` `FX_TO_KRW.USD = 1430` (already populated; no extension).
- [x] Soak gate resolved — removed by user direction 2026-05-05.
- [x] Akamai posture parity hypothesis confirmed at plan phase — US returns identical 2,229–2,240-byte bm-verify intercept body as KR (research.md §1.3); `channel: "chrome"` is the starting hypothesis.
- [x] Schema impact resolved — none. All US fields fit existing `Product` columns.
- [x] PlatformType extension resolved — already `"zara"` from SPEC-003. No change.
- [x] Test framework resolved — `node:test` reused (no new dep).
- [x] `categoryUrls` US list — 18 entries verified via `sitemap-category-us-en.xml.gz` 2026-05-06 (research.md §1.5); 5+ KR-to-US L-code collisions documented and excluded.
- [x] `robots.txt` resolved — region-agnostic, single global file, no `Disallow: /` for any region (research.md §1.1).
- [ ] **Pending Run-phase REQ-007**: Akamai bypass reliability ≥ 80% with `channel: "chrome"` against US — must verify before activating engine for US (KR verification CANNOT substitute).
- [ ] **Pending Run-phase REQ-008**: ZARA US English ToS — must capture in real Playwright session (canonical PDF NOT discoverable at plan phase), classify verdict, embed verbatim clauses alongside KR clauses.
- [ ] **Pending Run-phase REQ-009**: 18 `categoryUrls` URL-list live verification — KR L-codes do not transfer naively, US sitemap was the source but live re-verification is HARD precondition.
- [ ] **Pending Run-phase ANALYZE**: image-host whitelist re-verified for US (research hypothesizes `static.zara.net` covers both regions; live inspection required).
- [ ] **Pending Run-phase ANALYZE**: XHR endpoint pattern re-verified for US (research hypothesizes `/us/en/category/{id}/products?ajax=true` matches the existing region-agnostic `XHR_URL_RE`; live inspection required).

## 5. Reference Implementations (from research.md and existing code)

- **Uniqlo engine post-SPEC-002** (`src/lib/uniqlo-engine.ts`): the canonical reference for region-parameterization pattern applied to ZARA. SPEC-005 mirrors:
  - Region parameter source: `config.region` field on `SiteConfig` (already exists, JSDoc to expand to bind to ZARA).
  - Engine reads `config.region` and threads it through helpers that compute baseUrl-prefixed paths, locale, source currency.
  - KR behavior preserved bit-for-bit via fixture-based characterization tests (parameterized by region).
  - Default region to `"KR"` if `config.region` is absent (backward compat).
- **ZARA engine post-SPEC-003** (`src/lib/zara-engine.ts`, ~553 LOC): the structural template for the entire engine class. SPEC-005 reuses wholesale:
  - Top-of-file ToS comment block contract (lines 1-21) — AMEND to add US English clauses alongside KR Korean clauses.
  - `ZARA_USER_AGENTS` rotation list (lines 55-65) — region-agnostic, no change.
  - `ZARA_IMAGE_HOSTS` whitelist + `isSafeZaraImageUrl` (lines 77-86) — region-agnostic, no change.
  - `detectBmVerifyIntercept` (lines 105-115) — region-agnostic, no change.
  - `harvestRawProducts` walker (lines 208-230) — shape-agnostic, no change.
  - `crawlOneCategory` Playwright lifecycle wrapper (lines 317-399) — region-agnostic, no change. Uses region-agnostic `XHR_URL_RE = /\/category\/\d+\/products\?ajax=true/`.
  - `crawlZara` entry (lines 417-526) — region-aware via inline switch at `browser.newContext`. KR path preserved.
  - `parseProductsFromXhr` (lines 244-290) — refactor to thread `region` + `sourceCurrency` parameters; replace hardcoded `priceFormatted` and `sourceCurrency`.
  - `ZARA_PRODUCT_URL_RE` (line 90) and `isSafeZaraProductUrl` (lines 92-94) — refactor to be region-aware (build regex from `config.baseUrl` at engine entry).
  - `deriveGenderFromUrl` (lines 401-406) — generalize regex to be region-agnostic.
- **SPEC-002 region pattern application to Uniqlo** (`.moai/specs/SPEC-PLATFORM-EXPANSION-002/`): plan + spec + acceptance documents are the structural template for SPEC-005. Same scope shape (refactor existing module + add new SiteConfig entry + new fixture + parameterize tests), same risk register pattern (gate-skip risk → fixture parity mitigation), same EARS requirement count (~9-11), same Files Affected table layout. SPEC-005 deviates in two places:
  1. SPEC-002's `import-products.ts` modification (~15 LOC for `convertToKrw` hook) is **0 LOC** for SPEC-005 — the hook is already in place from SPEC-002 and fires for any non-KRW source.
  2. SPEC-002's `src/lib/fx.ts` NEW (~30 LOC for FX table lift) is **0 LOC** for SPEC-005 — file already exists.
- **SPEC-003 ZARA engine architecture** (`.moai/specs/SPEC-PLATFORM-EXPANSION-003/`): the source of the engine's lifecycle, XHR-interception strategy, ToS embedding contract, abort-on-3 mechanic. All inherited verbatim — SPEC-005 does NOT redefine any of these, only adds a region dimension.
- **SPEC-004 29CM Run-phase ToS pattern** (`.moai/specs/SPEC-PLATFORM-EXPANSION-004/`): reference for Run-phase Playwright ToS capture when canonical PDF is not discoverable. SPEC-005 REQ-008 mirrors SPEC-004 REQ-008's structure — capture rendered text via `page.evaluate(() => document.body.innerText)`, scan keywords, embed verbatim, classify verdict.
- **SiteConfig schema** (`src/lib/types.ts`): the existing fields (`region` from SPEC-002 line 138, `categoryUrls` from SPEC-003 line 147, `sourceCurrency` from before) all reused. Only JSDoc on `region` is amended to bind to ZARA in addition to Uniqlo.
- **Crawl dispatch** (`src/crawl.ts`): the existing `type === "zara"` branch is region-agnostic. Both `zara-kr` and `zara-us` SiteConfig entries are picked up automatically without dispatch code change.
- **Probe dispatch** (`src/crawl.ts:probeSite` ZARA branch): region-agnostic — uses `config.categoryUrls` + `config.baseUrl`. The bm-verify intercept assertion via `detectBmVerifyIntercept` is region-agnostic. No change for SPEC-005.
- **robots-check helper** (`src/lib/robots-check.ts`): region-agnostic by design. The `https://www.zara.com/robots.txt` file is a single global file (research.md §1.1) — verified 2026-05-06 to be identical to SPEC-003 §1.1 capture. No change.
- **Test runner conventions** (`tests/zara-engine.test.ts` from SPEC-003 + `tests/uniqlo-engine.test.ts` from SPEC-002): the parameterized fixture pattern from Uniqlo (load both region fixtures, parameterize assertions) applied to ZARA's test file (which currently loads only KR fixture).

## 6. Technology Stack

No new production dependencies. No new devDependencies. Stack is unchanged from `tech.md`:

- Node.js >=22.0.0, TypeScript ^5.6.0, pnpm >=9.0.0
- Existing deps: `playwright` (^1.58.2 — used by Cafe24, ZARA, 29CM; reused for ZARA US), `@supabase/supabase-js`, `tsx`, `dotenv-cli`
- Test runner: `node:test` (built-in, inherited from SPEC-001/002/003/004)

The ZARA engine is region-parameterized (no new internal-only constant beyond what already exists). Image-host whitelist is region-agnostic — no change. UA rotation list is region-agnostic — no change.

**Region-parameterization narrowness note**: the region surface is intentionally narrow — locale, timezone, priceFormatted, productUrl regex, sourceCurrency. This minimizes the cross-region bug surface, mirroring the SPEC-002 Uniqlo precedent. If a future SPEC adds a third ZARA region (ES, EU, etc.), only this narrow surface needs extension.

**Browser-launch mode note**: ZARA engine uses `chromium.launch({ channel: "chrome", headless: true })` for both regions (inherited from SPEC-003 — bundled Chromium hard-403'd by Akamai's TLS/header fingerprint check, real Chrome required). The `channel: "chrome"` configuration is region-agnostic — same launch options for both KR and US contexts. Only the `browser.newContext({ locale, timezoneId })` differs per region.

## 7. Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Akamai posture diverges between KR and US (US is more aggressive than KR) | Low | High | REQ-007 makes a 5x sequential probe against US a HARD precondition. KR's verification CANNOT substitute. If US reliability < 80% with `channel: "chrome"`, rollback paths in research.md §4.3 (US-context tightening, deferral, or Xvfb separate SPEC). NO fingerprint-evasion library. Accepted residual risk. |
| ZARA US ToS contains an unambiguous anti-scraping clause (different from KR which had no such clause) | Unknown (canonical PDF not discoverable at plan phase) | Critical (de-facto deferral) | REQ-008 makes Run-phase ToS verification in a real Playwright session a HARD precondition. Verbatim English clauses embedded as audit evidence. If FORBIDS, set `disabled: true` on `zara-us` SiteConfig and escalate per HARD rule #1. The engine refactor remains in place because it does not affect KR. |
| `categoryUrls` US list contains stale L-codes despite sitemap verification | Medium | Low | Research.md §1.5 documented 5+ KR-to-US collisions and the proposed US list excludes those, using sitemap-derived L-codes. REQ-009 makes a live 18-URL verification a HARD precondition during Run-phase ANALYZE. Stale URLs surface as 301-redirects to homepage or marketing pages; replace from `sitemap-category-us-en.xml.gz` OR remove with comment. |
| DOM/XHR shape diverges between KR and US (despite expected shape parity) | Low | Medium | Parameterized characterization fixtures (KR + US) run on every test invocation per REQ-010-011. Drift surfaces on either fixture immediately. `harvestRawProducts` walker is shape-agnostic — defensive against schema changes. |
| L-code namespace collision (e.g., l1180 means different things in KR vs US — confirmed in research.md §1.5) | High (already observed) | Medium | Engine's productUrl regex MUST be region-aware (REQ-002) — a US `productUrl` with KR L-code does NOT validate (and vice versa). Test coverage in `tests/zara-engine.test.ts` parameterized by region, asserts URL prefix `https://www.zara.com/{region}/{locale}/`. Collision detected at parse time, not crawl time. |
| US `priceFormatted` emits non-USD format if locale derivation fails | Low | Low | Helper `formatZaraPrice(price, region)` is unit-tested against both region inputs (REQ-010). Fixture-based test asserts US `priceFormatted` starts with `"$"`, KR starts with `"₩"`. Mismatch caught immediately. |
| Akamai introduces a new fingerprint signal that breaks `channel: "chrome"` for US (but not KR) | Low | High | Fail-loud, no evasion-library workaround. If US-only failure mode emerges, set `disabled: true` on `zara-us`, escalate. KR engine unaffected because `channel: "chrome"` was empirically verified at SPEC-003 Run-phase against KR. |
| robots.txt policy change introduces region-specific Disallow (e.g., `Disallow: /us/en/woman-*-l*\.html`) | Low | High | Same mechanism as SPEC-003: blanket-disallow detector runs at every crawl start (REQ-005). Targeted Disallow rules NOT caught by current detector — gap inherited as accepted residual risk. |
| US Playwright session naturally inherits IP geolocation that conflicts with US locale (KR-presenting IP serves KR-content despite `/us/en` URL) | Low | Low | Operator concern (run from US-presenting IP). REQ-007 probe runs from same IP as production crawls, surfacing geo-mismatch immediately. Mitigation: if probe captures KR-pricing in USD response, the test fixture reveals the geo-misroute and operator switches IP. |
| Shared-engine bug surfaces in US production before KR has accumulated soak evidence to expose it | Medium | Medium | SPEC-002 precedent — parameterized fixtures (KR + US) on every test run. Engine `region` parameter touches narrow surface. Rollback: revert SPEC-005 SiteConfig entry; engine refactor itself remains in place because it does not change KR behavior. |
| Playwright lifecycle is not unit-tested → regressions go undetected until live `--probe` | Medium | Medium | Acknowledged inherited risk from SPEC-003. The engine's pure parse function is testable against frozen fixtures; the Playwright lifecycle (browser launch, navigation, scroll, XHR interception) is smoke-tested only via live `--probe` invocation. Operator process: run `pnpm crawl --probe=zara-us` after any change to `zara-engine.ts` lifecycle code. Captured in acceptance.md AC-7. |
| ZARA seasonal redesign (1-2x/year) changes DOM selectors AND slugs simultaneously | Medium | Medium | Selector chain inside `page.evaluate` is robust (region-agnostic primary `.product-grid-product, [data-productid]`). Slug/L-code drift caught by REQ-009 live verification on any subsequent fixture refresh. Operator refresh cadence: review fixture once per major season change OR when test failures surface. |

## 8. Decision Log (Pre-Resolved)

These items are pre-resolved by orchestrator spawn prompt and the research-driven engine recommendation; no user decision required at /moai run time:

- **D1 — Region scope**: ZARA US only. Other ZARA regions (ES, EU, UK, JP, AU, etc.) out of scope. Each region requires its own SPEC.
- **D2 — Catalog scope**: Women + Men L2 fashion only (18 URLs). Kids/Baby out of scope (mirrors SPEC-003 KR scope).
- **D3 — Engine architecture**: Region-parameterize existing `src/lib/zara-engine.ts` (SPEC-002 Uniqlo pattern). NOT separate `zara-us-engine.ts`. NOT new module. KR behavior preserved bit-for-bit.
- **D4 — Soak gate**: Removed by user direction 2026-05-05. SPEC-005 proceeds in parallel with SPEC-003/004 production.
- **D5 — Region parameter source**: Existing `region: "KR" | "US"` field on `SiteConfig` (added by SPEC-002 for Uniqlo). JSDoc expanded to bind to ZARA. No schema change.
- **D6 — `PlatformType`**: Already `"zara"` from SPEC-003. No change. ZARA US uses `type: "zara"` and `region: "US"` together.
- **D7 — Currency / FX strategy**: ZARA US is USD-native. Cache stores native USD decimal. `convertToKrw(price, "USD")` fires at import time via the post-SPEC-002 hook in `src/import-products.ts`. `FX_TO_KRW.USD = 1430` already populated in `src/lib/fx.ts` — no extension.
- **D8 — Akamai bypass**: `chromium.launch({ channel: "chrome" })` (SPEC-003 KR pattern) is the starting hypothesis for US. REQ-007 verification gates US activation. KR pre-verification CANNOT substitute.
- **D9 — `categoryUrls`**: 18 hardcoded URLs from `sitemap-category-us-en.xml.gz` 2026-05-06 (research.md §1.5). KR L-codes do NOT transfer naively (5+ collisions documented). Live verification HARD precondition (REQ-009).
- **D10 — Test framework**: `node:test` reused (no new dep). Parameterized fixtures (KR + US) pattern from SPEC-002 applied to ZARA.

Open clarifications that may surface during /moai run (low-priority, non-blocking):

- **C1 — UA rotation per request vs per context**: Same constraint as KR (Playwright context UA set once per `browser.newContext`). One UA per crawl run, picked from rotation list at `crawlZara` entry, set on the context once. Re-evaluate if Akamai escalation patterns suggest UA-rotation is needed for US.
- **C2 — Image-host whitelist re-verification for US**: Research hypothesizes `static.zara.net` covers US (Inditex CDN is global). Run-phase ANALYZE step MUST inspect actual `<img src>` values on a live US category page and update the whitelist if needed.
- **C3 — XHR endpoint URL pattern verification for US**: Research hypothesizes `/us/en/category/{id}/products?ajax=true` matches the existing region-agnostic `XHR_URL_RE`. Run-phase ANALYZE step MUST verify by inspecting `page.on("response")` on a live US category page.
- **C4 — Bm-verify intercept signature reliability for US**: Initial heuristic from SPEC-003 (`HTML body length < 5000 bytes AND containing "bm-verify"`) verified against KR. US §1.3 probes confirm 2,229–2,240-byte intercept body matches the heuristic — same detector applies. Re-confirm at Run-phase IMPROVE.
- **C5 — Per-category product cap**: Initial cap 200 products per category (inherited from SPEC-003). Operator can tune via SiteConfig later.
- **C6 — `priceFormatted` US formatter**: Initial choice `\`$${price.toFixed(2)}\`` (e.g., `"$29.90"`). Run-phase IMPROVE may upgrade to `Intl.NumberFormat("en-US", {style: "currency", currency: "USD"})` if locale-aware grouping (e.g., `"$1,234.56"`) is preferred.
- **C7 — Timezone US**: Initial choice `"America/New_York"` (Eastern, ZARA US headquarters in NJ). Could alternatively use `"America/Los_Angeles"` if Akamai posture differs. Run-phase IMPROVE may tune if 5x probe fails.
- **C8 — `notes` field US wording**: Re-verification triggers (per ToS clause embedding contract): ZARA US ToS publication-date change OR Inditex USA, Inc. communication OR > 90 days elapsed since plan-phase verification. Mirrors SPEC-003 v0.2.0 conditions.

## 9. Methodology Note (DDD)

Project's `.moai/config/sections/quality.yaml` has `development_mode: ddd` (auto-config rule for projects with limited test coverage). The Run phase will follow ANALYZE-PRESERVE-IMPROVE:

- **ANALYZE**:
  1. **Akamai bypass verification for US** (REQ-007): launch Playwright in a scratch script with `chromium.launch({ channel: "chrome", headless: true })`, navigate 5 sequential times to `https://www.zara.com/us/en/woman-new-in-l1180.html` with US context options (`locale: "en-US"`, `timezoneId: "America/New_York"`, viewport 1440x900). Verify ≥4 of 5 attempts: HTML > 5KB (NOT bm-verify intercept), ≥10 `.product-grid-product` matches, ≥1 XHR matching `/\/category\/\d+\/products\?ajax=true/`. If <80%, escalate per rollback path. If pass, proceed.
  2. **ToS verification for US** (REQ-008): in same Playwright session, navigate to `https://www.zara.com/us/en/help-center/legal/terms-of-use` (or homepage footer fallback). Wait for SPA hydration (e.g., wait for body length > 50KB). Capture full English ToS body via `page.evaluate(() => document.body.innerText)`. Scan for keywords (`crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `agent`, `automated access`, `data mining`, `screen scraping`, `AI training`, `machine learning`). Identify all relevant clauses. Classify verdict (PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS). Embed verbatim English text + verdict + capture metadata as comment block at top of `src/lib/zara-engine.ts` (alongside KR clauses, NOT replacing). If FORBIDS, set `disabled: true` on `zara-us` SiteConfig and escalate.
  3. **`categoryUrls` URL-list verification for US** (REQ-009): in same Playwright session, navigate to each of 18 hardcoded URLs from research.md §1.5. For each: confirm no redirect to `/us/en/` homepage or `/us/en/*-mkt*.html`, ≥10 `.product-grid-product` matches, ≥1 XHR captured. Failed URLs replaced from `sitemap-category-us-en.xml.gz` OR removed with code comment.
  4. **DOM + XHR shape inspection**: in same Playwright session, inspect live US category page DOM. Verify candidate selectors match KR. Note image-host actual values (verify hypothesis `static.zara.net`). Note bm-verify intercept body size + signature (re-confirm SPEC-003 detector applies).
  5. **Engine refactor scope verification**: re-read `src/lib/zara-engine.ts` post-SPEC-003. Confirm the 5 hardcoded literals identified in research.md §3.2 are the complete refactor surface.

- **PRESERVE**:
  1. Capture one live ZARA US category page's intercepted XHR JSON into `tests/fixtures/zara-us-products.fixture.json` (e.g., from `/us/en/woman-new-in-l1180.html`) as the regression baseline. Use a debug `console.log(JSON.stringify(json))` line in `crawlOneCategory`'s `page.on("response")` listener (lines 327-337) to print the JSON, copy from stdout to fixture file. The fixture is FROZEN at this point.
  2. Run existing characterization tests against the KR fixture; confirm `parseProductsFromXhr` produces the expected `Product[]` shape unchanged (post-refactor regression check). KR fixture MUST pass without assertion change.

- **IMPROVE**:
  1. Refactor `src/lib/zara-engine.ts`: replace hardcoded literals with region-derived helpers/inline switches per research.md §3.2. KR behavior preserved bit-for-bit (verified by step PRESERVE.2 already passing).
  2. Implement `src/lib/types.ts` JSDoc expansion for `region` field.
  3. Implement `src/configs/platforms.ts`: update `zara-kr` to set `region: "KR"` explicitly; append `zara-us` SiteConfig entry with verified `categoryUrls`.
  4. Amend top-of-file ToS comment block in `src/lib/zara-engine.ts` to include verbatim English US ToS clauses from REQ-008 alongside existing KR Korean clauses.
  5. Implement parameterized fixtures in `tests/zara-engine.test.ts`: load both KR + US fixtures, region-aware assertions per REQ-010.
  6. Run `pnpm typecheck` — zero errors.
  7. Run `pnpm test` — both KR + US fixtures pass; zero failures.
  8. Run `pnpm crawl --probe=zara-us` against the live API; sample product summary prints with USD pricing; bm-verify intercept asserted to be bypassed.
  9. Run `pnpm crawl --site=zara-us`; check `data/zara-us-products.json` has ≥100 products with non-null required fields, USD-decimal `price`, `sourceCurrency: "USD"`, `productUrl` starting with `https://www.zara.com/us/en/`.
  10. Run `pnpm import:products`; spot-check 5 Supabase rows; verify Supabase `products.price` column receives KRW-converted values (USD * 1430), confirming the post-SPEC-002 `convertToKrw` hook fired correctly.
  11. Re-run `pnpm crawl --probe=zara-kr` (KR regression check); confirm KR still works post-refactor.
  12. Re-run `pnpm crawl --site=zara-kr` against a clean state; diff `data/zara-products.json` (or equivalent KR cache name) before/after refactor; confirm zero numeric drift in product fields.

This is a **brownfield enhancement** (the project has ZARA KR engine + Uniqlo region pattern + 29CM Playwright engine — SPEC-005 is the cross-product, no novel architecture). DDD is the appropriate methodology because: (a) the fixtures are the binding regression artifacts (KR fixture catches refactor regressions; US fixture is the new baseline); (b) the engine refactor MUST demonstrate KR behavior preserved bit-for-bit before US activation; (c) project-level test coverage for Playwright lifecycle is intentionally low (smoke-test only), so TDD-style "test before code" doesn't apply naturally to lifecycle changes — characterization-first is the right discipline.

## 10. References

- Research artifact: `.moai/specs/SPEC-PLATFORM-EXPANSION-005/research.md` (full probe results in §1-§3, engine recommendation in §4, risk register in §5, sources in §6)
- Sibling SPECs:
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-001/{spec,plan,research,acceptance}.md` (Uniqlo KR baseline, robots-check pattern, abort-on-3-errors mechanic, fixture pattern, `--rate=N` flag)
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-002/{spec,plan,research,acceptance}.md` (region-parameterization pattern — primary architectural reference for SPEC-005; FX module lift to `src/lib/fx.ts` — reused unchanged; USD-at-import-time hook in `src/import-products.ts` — reused unchanged)
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-003/{spec,plan,research,acceptance}.md` (ZARA KR Playwright engine — primary engine architecture reference; `channel: "chrome"` Akamai bypass; XHR-interception strategy; ToS clause embedding contract; 5-UA rotation; image-host whitelist; bm-verify-intercept detector; abort-on-3 broadened to Playwright failure modes)
  - `.moai/specs/SPEC-PLATFORM-EXPANSION-004/{spec,plan,research,acceptance}.md` (29CM KR Playwright engine — Run-phase Playwright ToS capture pattern reused for SPEC-005 REQ-008)
- Project product context: `.moai/project/product.md` (32-platform original target → 36 post-SPEC-004 → 37 post-SPEC-005)
- Project structure context: `.moai/project/structure.md` ("Adding a New Platform" checklist amended by SPEC-001 to include robots-check; SPEC-003 added ZARA Playwright pattern; SPEC-005 adds ZARA region-parameterization sub-pattern note)
- Project tech context: `.moai/project/tech.md` (Playwright `^1.58.2` already in deps, `node:test` runner already configured, `FX_TO_KRW.USD = 1430` already populated)
- Existing engine references:
  - `src/lib/zara-engine.ts` — refactor target (~553 LOC, KR-only post-SPEC-003); region-parameterize per research.md §3.2.
  - `src/lib/uniqlo-engine.ts` — region-parameterization template (post-SPEC-002 baseline).
  - `src/lib/fx.ts` — `FX_TO_KRW.USD = 1430` (no change).
  - `src/lib/robots-check.ts` — region-agnostic, no change.
- SiteConfig schema: `src/lib/types.ts:53` (`PlatformType`, no change), `:121` (`sourceCurrency` already supports `"USD"`), `:138` (`region?: "KR" | "US"` — JSDoc expansion target), `:147` (`categoryUrls?: string[]` — no schema change)
- Dispatch surface: `src/crawl.ts` (region-agnostic `type === "zara"` partition + probe branch; both `zara-kr` and `zara-us` picked up automatically; **no change**)
- Import surface: `src/import-products.ts` (post-SPEC-002 `convertToKrw` hook fires for `sourceCurrency: "USD"`; **no change**)
- Test surface: `tests/zara-engine.test.ts` + `tests/fixtures/zara-products.fixture.json` (KR-only; parameterize template); `tests/uniqlo-engine.test.ts` (region-parameterized fixture pattern reference from SPEC-002).
- Live probe artifacts (2026-05-06): `https://www.zara.com/robots.txt` (1320 bytes, region-agnostic), `https://www.zara.com/sitemaps/sitemap-category-us-en.xml.gz` (16,238 bytes, source of US `categoryUrls`), 18+ live `page.goto` probes confirming US category landings.

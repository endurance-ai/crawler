---
id: SPEC-PLATFORM-EXPANSION-005
version: 1.0.0
status: shipped
created_at: "2026-05-06"
updated_at: "2026-05-06"
shipped_at: "2026-05-06"
author: hansangho
priority: high
issue_number: 0
pr_number: 5
labels: [crawler, platform, zara, zara-us, playwright, region-parameterization, infrastructure]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-06 | v1.0.0 | Run phase completed and shipped via PR #5 (commit fedaee8). All three HARD preconditions cleared 2026-05-06: **REQ-007** Akamai bypass 5/5 (100%) with `chromium.launch({channel:"chrome"})` against `zara.com/us/en/woman-new-in-l1180.html`; **REQ-008** US English ToS captured from canonical PDF located via SPA homepage footer (`static.zara.net/static/pdfs/US/terms-and-conditions/terms-and-conditions-en_US-20250829.pdf`, last modified 2025-08-26) — verdict **AMBIGUOUS-ACCEPTED-BY-OWNER** (no automation keyword present in 24-page scan; §17 IP rights structurally analogous to ZARA KR §15 with slightly more explicit "may not download or save a copy of any of the Materials" wording). Verbatim §3 + §17 English clauses embedded at top of `src/lib/zara-engine.ts` alongside KR Korean clauses; **REQ-009** live URL verification 17/18 PASS — `man-outerwear-l715` removed from `categoryUrls` because page renders cards but does NOT fire `/us/en/category/{id}/products?ajax=true` AJAX endpoint (engine XHR-interception cannot harvest). Run-phase IMPROVE finding: ZARA US `price` field encodes USD as **integer cents** (raw 14900 = $149.00), distinct from KR which is integer KRW; engine adds `normalizeZaraPrice(rawPrice, region)` helper to bridge. P1 review fixes: `buildZaraProductUrlPattern` slug regex tightened to URL-safe charset `[A-Za-z0-9%.\-]+` (path-traversal hardening); `import-products.ts` `source_price` sanitized; dedup last-wins replaced with non-null-prefer merge (`sale_price`/`gender`/`color`/etc.); legacy Shopify KRW-format cache auto-rejected at import time. Schema migration 036 (companion PR `app#36`) added `products.source_currency` + `products.source_price` columns for global pricing display; admin UI shows USD-first / KRW-fallback via `formatProductPrice` helper. zara-us SiteConfig active (`disabled` removed); 17 categoryUrls (10 Women + 7 Men). Tests: 70/70 (KR 11 bit-for-bit preserved + US 8 new helper units + parameterized fixture). |
| 2026-05-06 | v0.1.0 | Initial draft. Adds ZARA US storefront (`zara.com/us/en`) as the 36th registered platform — second ZARA region after KR (SPEC-003), structural cross-product of SPEC-002 region pattern (Uniqlo KR + US shared engine) and SPEC-003 ZARA engine. Five user-confirmed decisions baked in: (1) **region scope** — ZARA US only (`zara.com/us/en`); other regions (ES, EU, UK, JP, AU, etc.) are NOT in scope and require their own SPEC; (2) **catalog scope** — Women + Men full fashion catalog (18 L2 landings verified via `sitemap-category-us-en.xml.gz` 2026-05-06); Kids/Baby out of scope (mirrors SPEC-003); (3) **engine architecture** — region-parameterize the existing `src/lib/zara-engine.ts` per SPEC-002 Uniqlo precedent; one engine module handles both KR and US; do NOT create `zara-us-engine.ts`; (4) **currency** — USD-native cache, USD→KRW conversion at import time via existing `src/lib/fx.ts` (`FX_TO_KRW.USD = 1430` already populated by SPEC-002); no engine-time conversion; no live FX API; (5) **soak gate** — removed by user direction 2026-05-05; SPEC-005 proceeds in parallel with SPEC-003/004 production. Three Run-phase HARD preconditions encoded as REQ-007 (Akamai bypass 5x reliability against US — KR's verification CANNOT be substituted for US), REQ-008 (US English ToS captured live in Playwright; canonical PDF NOT discoverable at plan phase per research.md §1.2), and REQ-009 (live `categoryUrls` URL-list verification — KR L-codes do NOT transfer naively; research.md §1.5 documents 5+ verified collisions). |

---

## Overview

This SPEC adds ZARA US storefront (`zara.com/us/en`) as the 36th registered platform in the crawler, paired with the ZARA KR engine introduced in SPEC-PLATFORM-EXPANSION-003. The US storefront shares ZARA's React SPA codebase, the same Akamai Bot Manager deployment, the same global Inditex CDN (`static.zara.net`), and the same XHR endpoint pattern (`/{region}/{lang}/category/{id}/products?ajax=true`) as KR — making it a structural near-clone of KR. The three genuine differences (region-prefixed baseUrl, en-US locale + America/New_York timezone, USD currency) are addressed without invalidating the shared-engine approach. The implementation refactors `src/lib/zara-engine.ts` from a KR-only module into a region-parameterized shared module driven by the existing `region: "KR" | "US"` field on `SiteConfig` (added by SPEC-002 for Uniqlo and reused here without schema change).

This SPEC follows the **SPEC-002 Uniqlo region pattern verbatim**: one engine module accepts a region parameter that drives baseUrl path, locale, timezone, source currency, and price formatter. KR behavior is preserved bit-for-bit. The cache file `data/zara-us-products.json` stores `price` natively in USD (decimal). All other infrastructure introduced in SPEC-001/002/003 — `robots-check.ts`, `--dry-run` flow, abort-on-3-consecutive-errors, characterization-test fixture pattern, Playwright + XHR-interception lifecycle, `channel: "chrome"` Akamai bypass, image-host whitelist, ToS clause embedding contract, `--rate=N` operator override — is reused as-is. Approximately ~150 LOC of `zara-engine.ts` is refactored to be region-aware (locale, timezone, priceFormatted, productUrl regex, sourceCurrency derivation); the remaining ~400 LOC carries over unchanged. No new file in `src/lib/` is created.

### Engine-Path Justification

The user's spawn prompt explicitly fixed the engine architecture: region-parameterize the existing `zara-engine.ts` mirroring the SPEC-002 Uniqlo pattern. Research validates this choice empirically (research.md §1.3, §2.5, §4.2):

- **§1.3 Akamai posture**: Live curl probes 2026-05-06 against US category landing pages return the **same** 2,229–2,240-byte bm-verify intercept HTML body that KR returns (SPEC-003 §1.3 captured 2,141–2,240 bytes for KR equivalents). Same Bot Manager deployment, same JS challenge response, same `_abck`/`bm_sz` cookie ecosystem.
- **§2.5 Image hosts**: Inditex CDN is global; `static.zara.net` covers both regions. The existing `ZARA_IMAGE_HOSTS` whitelist is region-agnostic.
- **§4.2 Engine recommendation**: Path (a) region-parameterize is selected over Path (b) separate `zara-us-engine.ts` (would duplicate ~270 LOC, drift risk) and Path (c) defer (soak gate already removed by user direction 2026-05-05).

**Caveat**: Akamai posture is operator-tunable per region — Inditex configuration could differ between KR and US storefronts. SPEC-005 Run phase MUST perform a 5x sequential probe against `https://www.zara.com/us/en/woman-new-in-l1180.html` with `chromium.launch({ channel: "chrome" })` to confirm before engine code is shipped (REQ-007). KR's pre-verification (SPEC-003 Run-phase 5/5 success) is **NOT** authoritative for US.

### Residual ToS Risk (UNVERIFIED at plan phase — DEFERRED to Run-phase)

ZARA US's English-language ToS could **not** be pre-verified at plan phase. Research.md §1.2 documents the discoverability failure:

- `static.zara.net/static/pdfs/US/terms-and-conditions/...` candidate paths return HTTP 404 (canonical KR-style PDF location does NOT exist for US).
- `static.zara.net/static/pdfs/US/` directory listing returns HTTP 403.
- `https://www.zara.com/us/en/help-center/legal/terms-of-use` returns HTTP 404 with a 319-KB Akamai-fronted SPA shell — ToS text hydrates client-side after JS execution and is not curl-reachable.

This is the same situation SPEC-003 (ZARA KR) faced at v0.1.0 before the project owner located the canonical KR PDF, and the same situation SPEC-004 (29CM KR) faced at v0.1.0 before its Run-phase Playwright capture. SPEC-005 cannot benefit from a plan-phase shortcut because no canonical US PDF was located. Therefore:

- ToS verification is **DEFERRED to Run-phase Playwright session** (REQ-008 below).
- The Run-phase ANALYZE step MUST open `https://www.zara.com/us/en/help-center/legal/terms-of-use` (or fall back to navigating via the `/us/en` homepage footer link) in a real Playwright session AFTER REQ-007 Akamai-bypass verification passes, capture the rendered English ToS body text via `page.evaluate(() => document.body.innerText)`, scan for keywords (`crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `agent`, `automated access`, `data mining`, `screen scraping`, `AI training`, `machine learning`), and embed verbatim relevant English clauses as a top-of-file comment block in `src/lib/zara-engine.ts` (alongside the existing KR clauses) for permanent audit record.
- If a clause unambiguously forbids automated catalog access (e.g., a clause naming "no scraping," "no crawler," "no automated access," "no data harvesting"), the engine ships **shelved** — `disabled: true` on the new `zara-us` SiteConfig entry — and the operator escalates to project owner per HARD rule #1.
- If clauses are ambiguous (analogous to ZARA KR §15 IP rights), the operator records the verdict (PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS) and proceeds accordingly.
- kiko.ai-internal-use only is the assumed scope. Public re-distribution of ZARA US product data is NOT covered and would require separate legal review.
- If ZARA Inditex USA, Inc. (the US Inditex subsidiary) issues a cease-and-desist communication, the operator MUST set `disabled: true` immediately, halt production crawls, and re-evaluate per project HARD rule #1.

ZARA US ToS is **independent** of ZARA KR ToS — different jurisdiction (US contract law, likely New York or Delaware per Inditex's US incorporation, vs Korean), different regulatory context (FTC/state AG vs KFTC), potentially different anti-automation language. The KR pre-verification (SPEC-003 v0.2.0 §15 IP rights AMBIGUOUS-ACCEPTED-BY-OWNER) CANNOT substitute for US verification.

The Run-phase agent has explicit authority to make the AMBIGUOUS-ACCEPTED-BY-OWNER call IF the captured English ToS contains no unambiguous prohibition AND the residual risk profile is comparable to ZARA KR's §15. Otherwise the agent MUST report findings and request explicit project-owner review before unblocking the engine.

---

## Goals

- Ship a working ZARA US crawler that produces a `data/zara-us-products.json` cache file with USD-native `price` values, consumable by the existing `src/import-products.ts` Supabase upsert path (USD→KRW via `convertToKrw` already wired by SPEC-002 — no `import-products.ts` change required).
- Refactor `src/lib/zara-engine.ts` from a KR-only module into a region-parameterized shared module driven by the existing `region: "KR" | "US"` field on `SiteConfig`. KR behavior is preserved bit-for-bit (existing fixture-based tests must pass without assertion change).
- Reuse the entire SPEC-003 engine architecture wholesale: Playwright Chromium with `channel: "chrome"` Akamai bypass, XHR interception of `/category/{id}/products?ajax=true`, infinite-scroll, abort-on-3-consecutive-errors, image-host whitelist, 5-element UA rotation, top-of-file ToS comment block contract.
- Reuse SPEC-002 region-parameterization pattern verbatim: one engine module, narrow region surface (locale, timezone, priceFormatted, productUrl regex, sourceCurrency), parameterized characterization fixture (KR + US run on every test invocation).
- Reuse SPEC-002 USD-at-import-time conversion path (`src/lib/fx.ts` + `src/import-products.ts` hook) — no engine-time FX, no FX table extension, no live FX API.
- Introduce a new SiteConfig entry `zara-us` with `region: "US"`, `sourceCurrency: "USD"`, hardcoded US-specific `categoryUrls` (18 L2 landings verified via `sitemap-category-us-en.xml.gz` 2026-05-06).
- Update the existing `zara-kr` SiteConfig entry to set `region: "KR"` explicitly (was implicit/absent post-SPEC-003).
- Establish the precedent that ZARA region expansion is a "one engine, multiple regions" architecture extensible to future regions (ES, EU, UK, JP, AU) without engine class duplication.
- Make Run-phase Akamai bypass verification (REQ-007), Run-phase US ToS verification (REQ-008), and Run-phase live `categoryUrls` URL-list verification (REQ-009) HARD preconditions for the engine graduating from `status: draft` to live production.

## Non-Goals / Exclusions

The following are explicitly out of scope for this SPEC. Items in this section MUST NOT be treated as "nice-to-have" or partially implemented; they are deferred to follow-up SPECs (with documented entry conditions) or indefinitely.

- **ZARA regions other than US** — ES, EU, UK, JP, AU, MX, CA, CL, BR, AR, etc. Each region has its own SPA category-slug rotation, its own L-code namespace, its own ToS jurisdiction. Each requires its own SPEC, its own probe, and its own ToS verification. The engine architecture introduced here is structurally extensible to any ZARA region (per §4.5 of research.md), but each region is its own approval gate.
- **Inditex sub-brands** — Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home all share Inditex's parent Akamai infrastructure. They remain deferred per SPEC-001 §2.3 and SPEC-003 §2.3. SPEC-005 expands the engine to handle 2 ZARA regions but does NOT auto-graduate any sub-brand.
- **ZARA Kids and Baby sections** — Out of scope per inheritance from SPEC-003 §Non-Goals. Only Women + Men URL hierarchies are crawled.
- **Mobile-app reverse-engineering** — Forbidden by project HARD rules (research.md §2.5 of SPEC-003). Not pursued.
- **Fingerprint-evasion libraries** (`puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` JA3, etc.) — Forbidden by project HARD rules.
- **Xvfb-in-CI for `headless: false` mode** — If `channel: "chrome"` proves insufficient for US (REQ-007 fails), introducing Xvfb is a separate SPEC. SPEC-005's rollback path on REQ-007 failure is deferral or US-context tightening, not Xvfb workaround.
- **IP rotation, residential proxy networks, CAPTCHA solving services, authenticated scraping** — Inherited HARD prohibitions from SPEC-001/002/003.
- **Schema migration** — No kiko.ai Supabase schema change. ZARA US fields (name, price, image URL, product URL, color names, sizes, gender) all map onto existing `Product` columns. Per orchestrator decision, no `price_usd` or `original_price_usd` column is added; the cache stores USD natively but Supabase only sees post-conversion KRW.
- **Live FX rate API** — The hardcoded `FX_TO_KRW.USD = 1430` in `src/lib/fx.ts` (post-SPEC-002 lift) remains POC-grade. Live FX rate API is project-level out-of-scope.
- **FX table extension** — `USD: 1430` is already populated. No new currency entries are added by this SPEC.
- **Linter / formatter introduction** — Inherited from SPEC-001/002/003. `tsc --noEmit` remains the only static check.
- **Vitest framework introduction** — Inherited from SPEC-001/002/003. `node:test` remains the runner.
- **Other deferred platforms** (Musinsa, H&M, COS, Weekday, Monki, Arket) — Status unchanged from prior SPECs.
- **Engine module rename** — `src/lib/zara-engine.ts` retains its name (NOT renamed to `zara-shared-engine.ts` or similar). Mirrors SPEC-002 which kept `uniqlo-engine.ts` after region-parameterization.

## Architecture Impact

### Region-parameter refactor of `src/lib/zara-engine.ts`

The existing module hardcodes the following KR-specific values (current line numbers post-SPEC-003 baseline):

- Line 90: `ZARA_PRODUCT_URL_RE = /^https:\/\/www\.zara\.com\/kr\/ko\/[^"'\s]+-p\d+\.html$/` (KR-only regex)
- Lines 274-285: `parseProductsFromXhr` emits `priceFormatted: \`₩${raw.price.toLocaleString("ko-KR")}\`` and `sourceCurrency: "KRW"` (both hardcoded)
- Lines 401-406: `deriveGenderFromUrl` matches `/\/kr\/ko\/(woman|women)/`, `/\/kr\/ko\/(man|men)/`, `/\/kr\/ko\/(kids|kid)/` (KR path-only)
- Lines 474-479: `browser.newContext({ userAgent: ua, locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: ... })` (KR-only locale + timezone)

These are refactored to be driven by a region parameter resolved from `SiteConfig`:

- `productUrl` regex: build at engine entry from `config.baseUrl` (extract `/{region}/{lang}/` segment) OR from `config.region` directly. Helper `buildProductUrlValidator(baseUrl: string): (url: string) => boolean` exposed for unit testing.
- `priceFormatted`: helper `formatZaraPrice(price: number, region: "KR" | "US"): string` — KR returns `\`₩${price.toLocaleString("ko-KR")}\``, US returns `\`$${price.toFixed(2)}\``. Unit-tested against both inputs.
- `sourceCurrency`: stop hardcoding inside `parseProductsFromXhr`; the engine reads from `config.sourceCurrency` and threads it through to the parse function (`parseProductsFromXhr(json, baseUrl, platformKey, region, sourceCurrency)`).
- `deriveGenderFromUrl`: generalize the regex to `/\/(?:[a-z]{2})\/(?:[a-z]{2})\/(woman|women|man|men|kids|kid)/` — region-agnostic, matches both `/kr/ko/` and `/us/en/` paths.
- Playwright context: inline `region === "US" ? {locale: "en-US", timezoneId: "America/New_York"} : {locale: "ko-KR", timezoneId: "Asia/Seoul"}` at context creation.

The region parameter source: the existing `region?: "KR" | "US"` field on `SiteConfig` (currently used by Uniqlo only — JSDoc to expand). Engine reads `config.region` and defaults to `"KR"` for backward compatibility if the field is absent. The `zara-kr` SiteConfig entry from SPEC-003 is updated to set `region: "KR"` explicitly; the new `zara-us` entry sets `region: "US"`.

KR behavior MUST be preserved bit-for-bit: identical XHR endpoint pattern, identical Playwright context options for KR, identical priceFormatted output for KR, identical sourceCurrency `"KRW"` for KR, identical productUrl regex match outcomes for KR, identical fixture-based test outcomes for KR.

### `src/lib/types.ts` — `region` JSDoc expansion

The existing `region?: "KR" | "US"` field at line 138 (added by SPEC-002) currently has JSDoc binding it to `type === "uniqlo"`. The JSDoc is **expanded** (not redefined) to also bind to `type === "zara"`. No schema change — the field already exists. ~3 LOC delta.

### `src/configs/platforms.ts` — new `zara-us` SiteConfig entry, updated `zara-kr` entry

Update existing `zara-kr` entry (lines 865-895): add explicit `region: "KR"` field (was absent; engine defaults to KR if missing, but explicit is safer). ~1 LOC.

Append new `zara-us` SiteConfig entry:
- `key: "zara-us"`, `name: "자라 (US)"`, `type: "zara"`, `baseUrl: "https://www.zara.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 2000`
- `categoryUrls: string[]` — hardcoded list of 18 Women + Men L2 category landing-page URLs from research.md §1.5 (verified via `sitemap-category-us-en.xml.gz` 2026-05-06, with KR L-codes that collide explicitly excluded). Initial enumeration covers: WOMAN-New In, WOMAN-Outerwear, WOMAN-Jackets, WOMAN-Knitwear, WOMAN-Shirts, WOMAN-T-Shirts, WOMAN-Trousers, WOMAN-Jeans, WOMAN-Dresses, WOMAN-Skirts (10 entries); MAN-New In, MAN-Outerwear, MAN-Jackets, MAN-Knitwear, MAN-Shirts, MAN-T-Shirts, MAN-Trousers, MAN-Jeans (8 entries).
- `notes: "ZARA US Playwright engine — region=US shared with zara-kr. Akamai bypass via channel:'chrome' (real Chrome required, KR-pattern). XHR-interception strategy: /us/en/category/{id}/products?ajax=true. USD-native cache; convertToKrw applied at import time (SPEC-002 hook). 2 sec/page, 5-UA rotation (one UA per browser context). robots-check enforced (region-agnostic robots.txt). ToS verification deferred to Run-phase REQ-008 — canonical PDF NOT discoverable at plan phase."`

### `src/crawl.ts` — NO CHANGE

The dispatch branch routing `type === "zara"` to `crawlZara` is region-agnostic. Both `zara-kr` and `zara-us` SiteConfig entries are picked up automatically by the existing partition. The probe handler for `"zara"` is also region-agnostic — it iterates over `config.categoryUrls` and uses `config.baseUrl` for the bm-verify-intercept assertion. **0 LOC delta.**

### `src/import-products.ts` — NO CHANGE

The post-SPEC-002 import-time hook detects `Product.sourceCurrency !== "KRW"` and applies `convertToKrw(price, sourceCurrency)` from `src/lib/fx.ts` before the Supabase upsert. ZARA US cache files have `sourceCurrency: "USD"` (set by the refactored engine), so the hook fires automatically. **0 LOC delta.**

### `src/lib/fx.ts` — NO CHANGE

`FX_TO_KRW.USD = 1430` already populated by SPEC-002. **0 LOC delta.**

### Test surface

- `tests/fixtures/zara-us-products.fixture.json` — frozen XHR JSON snapshot from one real ZARA US category landing page, captured ONCE during the Run-phase PRESERVE step (analogous to `tests/fixtures/zara-products.fixture.json` for KR). ~50–100 products, e.g., from `categoryLargeCode` for `/us/en/woman-new-in-l1180.html`. ~150 LOC.
- `tests/zara-engine.test.ts` — parameterize the existing KR-only test suite by region. For both fixtures (KR + US), assert: every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, `price`; every `imageUrl` matches `ZARA_IMAGE_HOSTS` whitelist; every `productUrl` starts with `https://www.zara.com/{region}/{locale}/`; every `price` is positive (KRW integer for KR, USD decimal for US). US-fixture-specific assertions: `Product.sourceCurrency === "USD"`, `Product.priceFormatted` starts with `"$"`, `Product.price` is decimal in sanity range `0.01 ≤ price ≤ 50000`. Add unit tests for `formatZaraPrice(price, region)` against both region inputs. ~40 LOC delta.

This is **NOT a new test pattern** — SPEC-002 already established parameterized fixture tests for Uniqlo KR + US. SPEC-005 reuses the same shape.

### `src/import-products.ts` — no change

Inherited from SPEC-002. ZARA US `sourceCurrency: "USD"` triggers the existing `convertToKrw` hook. No code change required for SPEC-005.

---

## Requirements

The following requirements use EARS (Easy Approach to Requirements Syntax) format. SPEC-005 inherits and reuses requirements from SPEC-001 (rate-limit pacing, dry-run flow, robots-check pre-flight, abort-on-3-consecutive-errors, characterization-test fixture pattern, `--rate=N` operator override), SPEC-002 (region-parameterization pattern, FX module, USD-at-import-time conversion, parameterized characterization fixtures), and SPEC-003 (Playwright + XHR-interception lifecycle, `channel: "chrome"` Akamai bypass, image-host whitelist, ToS clause embedding contract, abort-on-3 broadened to Playwright failure modes) — those are not re-stated. The requirements below are SPEC-005-specific deltas.

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register ZARA US as a platform with `key: "zara-us"`, `name: "자라 (US)"`, `type: "zara"`, `baseUrl: "https://www.zara.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 2000`, and a non-empty hardcoded `categoryUrls: string[]` field listing 18 Women + Men L2 category landing-page URLs from research.md §1.5 (10 Women: woman-new-in-l1180, woman-outerwear-l1184, woman-jackets-l1114, woman-knitwear-l1152, woman-shirts-l1217, woman-tshirts-l1362, woman-trousers-l1335, woman-jeans-l1119, woman-dresses-l1066, woman-skirts-l1299; 8 Men: man-new-in-l711, man-outerwear-l715, man-jackets-l640, man-knitwear-l681, man-shirts-l737, man-tshirts-l855, man-trousers-l838, man-jeans-l659). The existing `zara-kr` SiteConfig entry **SHALL** be updated to set `region: "KR"` explicitly. The SiteConfig schema and `PlatformType` union **SHALL NOT** be changed — both fields (`region`, `categoryUrls`) already exist on `SiteConfig`.

Source: research.md §1.5 (sitemap-verified URL list), §3.2 (refactor scope); architecture impact subsection above.

### REQ-002 [Ubiquitous]

**THE ZARA engine SHALL** be region-parameterized via the existing `region: "KR" | "US"` field on `SiteConfig`. The engine **SHALL** derive the Playwright context locale (`"ko-KR"` for KR, `"en-US"` for US), the Playwright context timezone (`"Asia/Seoul"` for KR, `"America/New_York"` for US), the `priceFormatted` helper output (`\`₩${price.toLocaleString("ko-KR")}\`` for KR, `\`$${price.toFixed(2)}\`` for US), the productUrl validator regex (region-prefixed with `\/{region}\/{lang}\/`), and the emitted `Product.sourceCurrency` (from `config.sourceCurrency`) from this region parameter. KR behavior **SHALL** be preserved bit-for-bit: the existing `tests/fixtures/zara-products.fixture.json` characterization tests continue to pass without any assertion change. The engine **SHALL NOT** contain any hardcoded `"kr/ko"`, `"KRW"`, `"ko-KR"`, `"Asia/Seoul"`, or `"₩"` literal after the refactor (these become functions of `region`).

Source: research.md §3.2 (refactor scope, line-by-line); SPEC-002 REQ-002 region-parameterization precedent.

### REQ-003 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=zara-us` without the `--dry-run` flag, **THE crawler SHALL** invoke `crawlZara(config)` (the same engine entry function used for KR), which **SHALL** iterate over each URL in `config.categoryUrls`, performing for each URL: (1) `page.goto(url)` with `waitUntil: "domcontentloaded"`, (2) install `page.on("response")` listener with `XHR_URL_RE = /\/category\/\d+\/products\?ajax=true/` (region-agnostic — matches both `/kr/ko/category/...` and `/us/en/category/...`), (3) wait for either the first product-list XHR to be intercepted OR the product-card selector chain to resolve, (4) execute infinite-scroll loop until product count plateaus or per-category cap reached, (5) extract products via `parseProductsFromXhr` with region-aware `priceFormatted` and `sourceCurrency`, (6) apply ZARA image-host whitelist (region-agnostic — `static.zara.net`, `static-images.zara.net`). The aggregated `Product[]` result **SHALL** be written to `data/zara-us-products.json` with `price` stored as the native USD decimal value (no conversion at engine time) and `sourceCurrency: "USD"`. Pacing and UA rotation behavior **SHALL** be identical to KR (REQ-003 from SPEC-003 reused).

Source: research.md §1.4 (XHR pattern), §2.2 (USD currency, engine-time vs import-time); SPEC-003 REQ-003 reused.

### REQ-004 [Event-driven]

**WHEN** a user invokes `pnpm crawl --site=zara-us --dry-run` (or `--probe=zara-us`), **THE crawler SHALL** invoke the probe handler for the `"zara"` engine type (the existing branch in `src/crawl.ts:probeSite`, region-agnostic), launching Playwright Chromium with `channel: "chrome"` and the US-region context options (UA from rotation list, `locale: "en-US"`, `timezoneId: "America/New_York"`, `viewport: {width: 1440, height: 900}`), navigating to the FIRST URL in `config.categoryUrls`, asserting the page HTML contains real product DOM (NOT the bm-verify intercept shell), printing a sample product summary to stdout (key fields: `name`, `price`, `productUrl`, `imageUrl`), and **SHALL NOT** write `data/zara-us-products.json`. The dry-run **SHALL NOT** modify any file in the `data/` directory. Browser **SHALL** be closed in a `finally` block.

Source: SPEC-003 REQ-004 reused; research.md §1.3 (US bm-verify intercept signature identical to KR — same detector applies).

### REQ-005 [State-driven]

**WHILE** a ZARA US crawl is starting (whether `--dry-run` or full crawl), **THE crawler SHALL** invoke `checkRobots(config.baseUrl)` from `src/lib/robots-check.ts` (introduced by SPEC-001 REQ-004) and **SHALL** refuse to proceed if the returned result is `{allowed: false}`. The check **SHALL** run before any Playwright browser is launched. Behavior, error message format, and exit code are identical to SPEC-001 REQ-004 — this REQ exists in SPEC-005 only to make ZARA US's coverage by the existing engine-agnostic check explicit. The `robots.txt` file is region-agnostic (single global file), already verified for ZARA in SPEC-003 REQ-005 — the check returns `{allowed: true}` for `https://www.zara.com/us/en` because the wildcard group has no blanket `Disallow: /`.

Source: research.md §1.1 (region-agnostic `robots.txt`); SPEC-001 REQ-004 reused.

### REQ-006 [Unwanted Behavior]

**IF** `crawlZara` (running for `zara-us`) encounters 3 consecutive errors within a single category iteration — where "error" is defined per SPEC-003 REQ-006: (a) `page.goto` timeout, (b) `page.waitForSelector` selector-not-found timeout, (c) the page HTML matching the bm-verify intercept signature (HTML body length < 5,000 bytes AND containing the literal string `bm-verify`), or (d) a thrown exception during XHR response handling — **THEN THE engine SHALL** abort that category, append a structured error entry to `CrawlResult.errors` (containing category URL, error type, timestamp, and a brief descriptor), and continue with the next URL in `config.categoryUrls`. Behavior is identical to SPEC-003 REQ-006 — this REQ exists in SPEC-005 only to make ZARA US's coverage by the existing engine-internal mechanic explicit. The engine **SHALL NOT** retry indefinitely, **SHALL NOT** silently swallow errors, **SHALL NOT** rotate IP addresses, **SHALL NOT** invoke any fingerprint-evasion technique, and **SHALL NOT** introduce any retry-with-backoff delay beyond the configured `crawlDelay`.

Source: SPEC-003 REQ-006 reused (engine-internal mechanic, region-agnostic).

### REQ-007 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (BEFORE the new `zara-us` SiteConfig entry is committed and BEFORE non-dry-run crawls are run against US), **THE operator SHALL** verify that `chromium.launch({ channel: "chrome", headless: true })` mode reliably bypasses the Akamai bm-verify intercept against `https://www.zara.com/us/en/woman-new-in-l1180.html` (or any single ZARA US category landing page from the verified §1.5 list). Reliability is defined as: at least 4 of 5 sequential `page.goto` invocations from a single Playwright session reach real product DOM (HTML contains `.product-grid-product` or `[data-productid]` selectors with ≥10 matching elements) within a 30-second timeout, AND at least one `application/json` XHR matching `XHR_URL_RE` (`/\/category\/\d+\/products\?ajax=true/`) is captured by `page.on("response")` within 15 seconds of `page.goto`.

KR's pre-verification (SPEC-003 Run-phase 5/5 success) **CANNOT** be substituted for US verification — Akamai posture is operator-tunable per region and Inditex configuration could differ. The verification MUST be performed against US specifically.

If reliability is below 80% (4 of 5), **THE operator SHALL** invoke one of the rollback paths in research.md §4.3:

1. **Tighten US-specific browser context** (e.g., explicit `Accept-Language: en-US,en;q=0.9` header, verify system Chrome resolves correctly, retry).
2. **Defer ZARA US** — set `disabled: true` on the new `zara-us` SiteConfig entry, abandon the engine activation, escalate to project owner. The engine refactor itself remains in place because it does not change KR behavior.
3. **Introduce Xvfb-in-CI for `headless: false` mode** — separate SPEC, requires CI image change.

**THE operator SHALL NOT** introduce a fingerprint-evasion library or otherwise circumvent the project HARD rules to compensate for an insufficient `channel: "chrome"` pass rate.

Source: research.md §1.3 (US Akamai posture identical to KR — strong empirical evidence for parity, but not authoritative), §4.3 (rollback paths); SPEC-003 REQ-007 pattern; bias-prevention mechanism (KR verification CANNOT be substituted for US).

### REQ-008 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (AFTER REQ-007 passes, BEFORE any non-dry-run crawl against `zara-us`), **THE operator SHALL** open `https://www.zara.com/us/en/help-center/legal/terms-of-use` (or fall back to navigating via the `/us/en` homepage footer link if direct URL returns the 404 SPA shell) in a real Playwright browser session, wait for the SPA to hydrate, capture the rendered English ToS body text via `page.evaluate(() => document.body.innerText)`, scan for keywords (`crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `agent`, `automated access`, `data mining`, `screen scraping`, `AI training`, `machine learning`), identify all clauses referencing automation, IP rights, or content use, and embed the verbatim relevant English clauses as a comment block at the top of `src/lib/zara-engine.ts` (alongside the existing KR Korean clauses from SPEC-003 v0.2.0, NOT replacing them) for permanent audit record.

The block **SHALL** include: (a) the verbatim English clause text for each relevant clause, (b) the capture date and operator name, (c) the source URL (the actual landing page captured, since `/help-center/legal/terms-of-use` returns 404), (d) a verdict label (one of: PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS), (e) the SPEC-005 cross-reference, (f) a one-line summary of the residual-risk conditions (kiko.ai-internal-use only; halt-on-cease-and-desist; re-verify on ToS publication-date change OR Inditex USA, Inc. communication OR > 90 days elapsed). The original English text **MUST NOT** be paraphrased, summarized, or translated — verbatim quoting is the audit-evidence contract. ZARA US ToS is **independent** of ZARA KR ToS — the KR pre-verification (SPEC-003 v0.2.0 §15 IP rights AMBIGUOUS-ACCEPTED-BY-OWNER) CANNOT substitute for US.

If the captured text contains ANY clause that unambiguously forbids automated catalog access, web scraping, or the use of crawler/bot/automation tools (e.g., a clause naming "no scraping," "no crawler," "no automated access," "no data harvesting"), **THE operator SHALL**: (1) set `disabled: true` on the `zara-us` SiteConfig, (2) abandon the engine activation for US (the engine refactor remains in place; KR continues shipping unaffected), (3) escalate to project owner with the verbatim forbidding clause and a recommendation for a B2B partner-API conversation with Inditex USA. The operator **SHALL NOT** ship `zara-us` with `disabled: false` if the verdict is FORBIDS.

If the captured text contains ambiguous clauses (e.g., IP rights clauses that technically restrict content use without naming automation specifically — analogous to ZARA KR's §15), **THE operator SHALL** classify the verdict as AMBIGUOUS-ACCEPTED-BY-OWNER and proceed, OR escalate to project owner if the residual risk is qualitatively higher than ZARA KR's §15.

Source: research.md §1.2 (ToS unverified at plan phase, canonical PDF NOT discoverable); SPEC-003 §Residual ToS Risk (v0.1.0 pattern, before pre-amendment shortcut); SPEC-004 REQ-008 (Run-phase Playwright capture pattern); project HARD rule #1.

### REQ-009 [State-driven]

**WHILE** the Run-phase ANALYZE step is in progress (AFTER REQ-007 passes), **THE operator SHALL** verify each of the 18 hardcoded URLs in the new `zara-us` SiteConfig's `categoryUrls` field by `page.goto`'ing each URL in a Playwright session and confirming: (a) the page does NOT redirect to `/us/en/` homepage or to a `/us/en/woman-mkt*.html` / `/us/en/man-mkt*.html` marketing page, AND (b) the page renders ≥10 `.product-grid-product` or `[data-productid]` matches within a 30-second timeout, AND (c) at least one XHR matching `XHR_URL_RE` is intercepted within 15 seconds of `page.goto`. Research.md §1.5 documents 5+ verified KR-to-US L-code collisions and slug renames (woman-coats-l1184 redirect, woman-jackets-l1185 not exist on US, woman-tshirts-l1180 collision, man-jackets-l717 not exist, man-jeans-l710 not exist) — **the URL list MUST NOT be assumed to transfer naively from KR**.

If any URL in the list fails verification, **THE operator SHALL** either: (1) replace the failed URL with a verified equivalent from `https://www.zara.com/sitemaps/sitemap-category-us-en.xml.gz`, OR (2) remove the failed URL from the list with a code comment explaining the removal (e.g., "WOMAN-Sweatshirts l1320 absent from sitemap as of 2026-MM-DD").

Source: research.md §1.5 (sitemap-verified URL list with KR-to-US collision documentation); architecture impact subsection above.

### REQ-010 [Ubiquitous]

**THE ZARA engine characterization-test suite at `tests/zara-engine.test.ts`** **SHALL** load both `tests/fixtures/zara-products.fixture.json` (existing, from SPEC-003 — KR XHR capture) and a new `tests/fixtures/zara-us-products.fixture.json` (a real captured ZARA US XHR JSON of approximately 50 to 100 products from one US category landing page, captured during Run-phase PRESERVE) and **SHALL** run `parseProductsFromXhr` against both fixtures with the appropriate region parameter. For both fixtures, the suite **SHALL** assert that every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, and `price` fields, and that every `imageUrl` matches the shared `ZARA_IMAGE_HOSTS` whitelist (`static.zara.net`, `static-images.zara.net`). Region-specific assertions: KR fixture asserts every `productUrl` starts with `https://www.zara.com/kr/ko/`, every `priceFormatted` starts with `"₩"`, every `Product.sourceCurrency === "KRW"`, every `Product.price` is a positive KRW integer (5,000 ≤ price ≤ 5,000,000); US fixture asserts every `productUrl` starts with `https://www.zara.com/us/en/`, every `priceFormatted` starts with `"$"`, every `Product.sourceCurrency === "USD"`, every `Product.price` is a positive USD decimal (0.01 ≤ price ≤ 50,000). The suite **SHALL** also include unit tests for the `formatZaraPrice(price, region)` helper against both region inputs. No new devDependency **SHALL** be added (`node:test` reused). The test suite **SHALL NOT** attempt to test the Playwright lifecycle (browser launch, navigation, scroll); that surface is smoke-tested only via live `--probe` invocation per REQ-004.

Source: SPEC-001 REQ-006 fixture pattern; SPEC-002 REQ-007 parameterized fixture pattern; SPEC-003 REQ-009 ZARA-specific assertions.

### REQ-011 [Unwanted Behavior]

**IF** any assertion in REQ-010's parameterized characterization suite fails on either the KR fixture OR the US fixture, **THEN THE test runner SHALL** fail the entire suite with a non-zero exit code, and the CI gate / `pnpm test` invocation **SHALL** block any subsequent commit or production deployment. Failure on either fixture **SHALL** be treated as a shared-engine regression regardless of which region triggered it; the engine is NOT to be split into separate KR/US modules in response to a fixture failure.

Source: SPEC-002 REQ-008 (fixture parity is the binding mitigation for the gate-skip risk).

## Files Affected

| File | Action | Est. LOC | Purpose |
|---|---|---|---|
| `src/lib/zara-engine.ts` | MODIFY | ~150 | Region-parameterize: replace hardcoded `"kr/ko"` / `"KRW"` / `"ko-KR"` / `"Asia/Seoul"` / `"₩"` literals with region-derived values. Add `formatZaraPrice(price, region)` helper. Generalize `deriveGenderFromUrl` regex. Build `productUrl` validator from `config.baseUrl` at engine entry. Thread `region` and `sourceCurrency` through `parseProductsFromXhr`. Inline `region === "US" ? {...} : {...}` for Playwright context locale + timezone. Top-of-file comment block AMENDED to include English US ToS clauses (post Run-phase REQ-008 capture) alongside existing KR Korean clauses. KR behavior preserved bit-for-bit. |
| `src/lib/types.ts` | MODIFY | ~3 | Expand `region?: "KR" \| "US"` JSDoc (line 138) to bind to BOTH `type === "uniqlo"` AND `type === "zara"`. No schema change — field already exists. |
| `src/configs/platforms.ts` | MODIFY | ~30 | Update existing `zara-kr` entry: add explicit `region: "KR"`. Append new `zara-us` SiteConfig entry: `region: "US"`, `sourceCurrency: "USD"`, hardcoded `categoryUrls` (18 verified US L2 landings from research.md §1.5), `crawlDelay: 2000`, `notes` documenting US-specific behavior. |
| `src/crawl.ts` | NO CHANGE | 0 | Dispatch branch routing `type === "zara"` to `crawlZara` is region-agnostic. Both `zara-kr` and `zara-us` SiteConfig entries are picked up automatically. |
| `src/import-products.ts` | NO CHANGE | 0 | Post-SPEC-002 hook: `convertToKrw` fires for `Product.sourceCurrency: "USD"` automatically. ZARA US benefits without modification. |
| `src/lib/fx.ts` | NO CHANGE | 0 | `FX_TO_KRW.USD = 1430` already populated. |
| `src/lib/robots-check.ts` | NO CHANGE | 0 | Region-agnostic blanket-disallow detector. Single global `robots.txt` covers both regions. |
| `tests/fixtures/zara-us-products.fixture.json` | NEW | ~150 | Frozen `RawZaraProduct[]` snapshot from one real ZARA US category page (~50-100 products), captured ONCE during Run-phase PRESERVE step via Playwright XHR-interception, frozen, committed. |
| `tests/zara-engine.test.ts` | MODIFY | ~40 | Parameterize existing tests by region (load both KR + US fixtures, run parameterized assertions). Add region-specific assertions per REQ-010. Add unit tests for `formatZaraPrice(price, region)`. |
| `.moai/project/structure.md` | MODIFY | ~5 | Add `zara-us` row to platform table (now 37 entries: 22 Cafe24 + 10 Shopify + 2 Uniqlo + 1 ZARA-KR + 1 ZARA-US + 1 29CM). Document the ZARA region-parameterization sub-pattern in the engine-layering subsection (mirrors Uniqlo region pattern). |
| `package.json` | NO CHANGE | 0 | Playwright `^1.58.2` already in dependencies. `node:test` already configured. No new deps. |

Total estimated LOC delta: **~378**.

## Acceptance References

Detailed Given-When-Then acceptance scenarios are documented in `.moai/specs/SPEC-PLATFORM-EXPANSION-005/acceptance.md`. The acceptance suite contains 10 scenarios mapping to REQ-001 through REQ-011, with AC-9 (REQ-007 Akamai bypass verification for US), AC-10 (REQ-008 ToS verification for US), and AC-11 (REQ-009 live URL-list verification) being the three HARD preconditions for engine activation.

## Risks

Three risks are tracked here for visibility throughout the Run phase. Mitigations are described in research.md §5 and will be implemented as part of the engine code or operator process.

- **Akamai posture diverges between KR and US (US is more aggressive than KR)** — Likelihood: Low, Impact: High. Mitigation: REQ-007 makes a 5x sequential probe against US a HARD precondition. KR's verification CANNOT substitute. If US reliability < 80% with `channel: "chrome"`, rollback paths in research.md §4.3 (US-context tightening, deferral, or Xvfb separate SPEC). NO fingerprint-evasion library as compensation. Accepted residual risk.
- **ZARA US ToS contains an unambiguous anti-scraping clause (different from KR which had no such clause)** — Likelihood: Unknown (canonical PDF not discoverable at plan phase), Impact: Critical (de-facto deferral). Mitigation: REQ-008 makes Run-phase ToS verification in a real Playwright session a HARD precondition. Verbatim English clauses embedded as audit evidence. If FORBIDS, set `disabled: true` on `zara-us` SiteConfig and escalate per HARD rule #1. The engine refactor remains in place because it does not affect KR.
- **`categoryUrls` US list contains stale L-codes or typos despite sitemap verification** — Likelihood: Medium, Impact: Low. Research.md §1.5 documented 5+ KR-to-US collisions; the proposed US list excludes those and uses sitemap-derived L-codes. Mitigation: REQ-009 makes a live 18-URL verification a HARD precondition during Run-phase ANALYZE. Stale URLs surface immediately as 301-redirects to homepage or marketing pages. The empty-category graceful-handling pattern from SPEC-001 REQ-002 carries over: if a URL fails verification, operator either replaces from sitemap or removes with comment.

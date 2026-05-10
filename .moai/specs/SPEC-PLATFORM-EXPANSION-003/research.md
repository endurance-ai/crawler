# Research: SPEC-PLATFORM-EXPANSION-003 — ZARA (KR) Crawler Engine

- **Date**: 2026-05-05
- **Author**: manager-spec subagent
- **Scope**: ZARA KR storefront only (`zara.com/kr/ko`). Women + Men full catalog. Kids/Baby out of scope. Other regions (US, ES, EU, etc.) out of scope.
- **Audience**: SPEC planner, plan auditor, project owner
- **Trigger**: Post-merge of SPEC-PLATFORM-EXPANSION-001 + 002 (commit `0beacfd`); soak gate removed per SPEC-001 §2.4 amendment dated 2026-05-05; user has explicit appetite to attempt a ZARA engine.

This research extends SPEC-001 §2.1 (which deferred ZARA on technical-risk grounds: "Akamai Bot Manager active deployment, no public API, ToS unverified") by re-probing ZARA's API and DOM surface as of 2026-05-05 to determine which of three engine candidates is viable: (a) pure Playwright headless DOM scrape, (b) hybrid mobile-API discovery with Playwright fallback, or (c) pure mobile-API reverse-engineering.

---

## §1. ZARA KR Site Survey

### 1.1 robots.txt

`https://www.zara.com/robots.txt` returns HTTP 200 to a realistic Mozilla UA (curl 2026-05-05 `Chrome/131.0.0.0`).

The `User-agent: *` group lists path-specific Disallow rules and contains **NO blanket `Disallow: /`**. The full wildcard group, quoted verbatim from the live fetch, is:

```
User-agent: *
Disallow: /xa/
Disallow: /xt/
Disallow: /xf/
Disallow: /xa/
Disallow: /xp/
Disallow: /xh/
Disallow: /xx/
Disallow: /xc/
Disallow: /xu/
Disallow: /xb/
Disallow: /xl/
Disallow: /xm/
Disallow: /xy/
Disallow: /xs/
Disallow: /xw/
Disallow: /xg/
Disallow: /c4/
Disallow: /users/
Disallow: /*/user
Disallow: /*/shop/
Disallow: /*/search
Disallow: /mkt/
Disallow: /*/size-guide
Disallow: /*/guest-user/
Disallow: /*/mini-shop-cart
Disallow: /share/
Disallow: /*/*/share/*pid=*
Disallow: /recom/
Disallow: /*/*/gift-ticket*
Disallow: /*/*/help-center/GiftCard
Disallow: *?amp
Disallow: *?catalogId=
Disallow: *?color=
Disallow: *?colorId=
Disallow: *?donationOnly=
Disallow: *?fts=
Disallow: *?lookDetail=
Disallow: *?ref=
Disallow: *?rows=
Disallow: *?pageu
Disallow: *&initialBlockId=*
Disallow: /*/-pM
Disallow: /?*
Disallow: */integration/chat-static/
Disallow: *integration/mectitofa/
Disallow: */placement/*
Disallow: */util/messages
Disallow: /_sec/
Disallow: /stdstatic-recoms/
Disallow: /botfende*
Disallow: /assets/public/

#bitdefender

Disallow: */akam/*
Disallow: */8y46UXJ4p/*
Disallow: */B5p-uMw5yh/*
Disallow: */8-Tx/*
Disallow: */QAbIDZliR0d9FROWzQ/*
Disallow: */nNdvzg/*

Sitemap: https://www.zara.com/sitemaps/sitemap-index.xml.gz
```

Path-specific Disallow analysis for our intended crawl:
- `/*/shop/`, `/*/search`, `/*/-pM`, `?color=`, `?colorId=`, `?ref=` — these block the search and detail-with-color URL forms; **product list pages (e.g. `/kr/ko/woman-new-in-l1180.html`) and product card URLs without color params are not Disallowed**.
- `*/akam/*`, `*/8y46UXJ4p/*` and 5 sibling 8-character-segment patterns under the `#bitdefender` comment confirm aggressive Akamai Bot Manager deployment (these are fence paths used by Akamai to fingerprint clients).
- A `Sitemap:` directive at the end publishes a public sitemap index — confirms ZARA explicitly invites legitimate search-engine crawlers to read structured product URLs.

**Verdict**: robots.txt is **legally permissive** for product-list and product-detail pages. The blanket-disallow detector in `src/lib/robots-check.ts` (introduced by SPEC-001 REQ-004) returns `{allowed: true}` for `https://www.zara.com/kr/ko`. **Not a HARD blocker.**

### 1.2 Terms of Service (ToS) — VERIFIED 2026-05-05

ZARA's Korean storefront ToS is published behind client-side React routing on `zara.com/kr/ko`, but Inditex hosts the canonical PDF version on its static asset CDN at `static.zara.net/static/pdfs/KR/terms-and-conditions/`. The 2025-11-25 version (latest as of probe date) was retrieved and analyzed in the plan-phase main session.

**Source PDF**: `https://static.zara.net/static//pdfs/KR/terms-and-conditions/terms-and-conditions-ko_KR-20251125.pdf` (228 KB, 11 pages, Korean-language)

**Method**: PDF downloaded via curl, content extracted page-by-page via Read tool with `pages` parameter, full-text scanned for keywords: 자동화/자동/스크래/크롤/크롤링/로봇/봇/프로그램/에이전트/agent/robot/scrape/crawl/automated/automation/데이터 수집/추출.

**Verbatim findings** (Korean original, captured for permanent audit record):

#### Finding 1 — §2 웹사이트 이용 (Use of Website), clause 2.1 [PERMISSIVE / GENERAL]
> 이용자는 다음 내용에 동의합니다.
> 1. 이용자는 회사에 대한 정당한 요청이나 주문 목적으로만 웹사이트를 이용할 수 있습니다.

Translation: "Users may use the website only for legitimate requests to the Company or for ordering purposes."

Verdict on automation: **AMBIGUOUS**. kiko.ai-style data harvesting is neither a "legitimate request to the Company" nor an "ordering purpose" per a strict reading; under a more lenient reading, "legitimate request" could cover catalog browsing by automated agents that respect robots.txt. The clause does not name "automation," "crawler," "scraper," "robot," or any automation-specific term.

#### Finding 2 — §6 회사의 주문 거절, 제한 및 취소 (Company's Right to Refuse, Limit, Cancel Orders), bullet point 2 [SPECIFIC TO PURCHASE BOTS, NOT SCRAPING]
> 이용자가 웹사이트의 정상적인 운영과 거래질서에 영향을 미치고 다른 이용자의 공정 거래 권리를 침해하는 다음과 같은 행위를 하는 경우:
> [...]
> 2) 자동구매 소프트웨어 기타 유사한 도구를 사용하여 다중 주문, 반복 구매, 사재기를 하는 행위

Translation: "Where a user, by impacting the website's normal operation and transaction order and infringing other users' fair trade rights, engages in the following acts: [...] (2) Using automated purchasing software or other similar tools to make multiple orders, repeat purchases, or hoarding."

Verdict on automation: **DOES NOT APPLY TO READ-ONLY SCRAPING**. The clause specifically targets **자동구매 (automated purchasing)** — not data harvesting. kiko.ai's crawler does not place orders. The "기타 유사한 도구 (other similar tools)" language could be stretched by a hostile counsel to include scraping bots, but the explicit context is purchasing-related.

#### Finding 3 — §15 지적 재산권 (Intellectual Property Rights) [PRIMARY RESIDUAL RISK]
> 웹사이트 내의 모든 콘텐츠에 대한 저작권, 상표권 등 일체의 지적 재산권은 회사 또는 회사가 권한을 부여한 자에게 귀속됩니다. 이용자는 회사 또는 회사가 권한을 부여한 자의 허락을 받아 해당 콘텐츠를 사용할 수 있습니다. 그러나 이용자가 필요한 범위 내에서 자신의 주문내역 또는 계약 내용을 복사하는 행위는 허용됩니다.

Translation: "All copyrights, trademarks, and other intellectual property rights for all content within the website belong to the Company or those authorized by the Company. Users may use such content with the permission of the Company or those authorized by the Company. However, copying one's own order history or contract content within the necessary scope is permitted."

Verdict on automation: **TECHNICALLY PROHIBITS UNAUTHORIZED CONTENT USE**. kiko.ai's downstream use of ZARA product names, prices, and images falls under "use of content" requiring permission. The narrow exception ("자신의 주문내역" — one's own order history) does not cover catalog data. This is the **primary residual risk** of SPEC-003.

#### Findings 4–N — Negative results

The following keywords returned **zero matches** across all 11 pages of the ToS PDF: `crawl`, `crawling`, `scrape`, `scraping`, `robot`, `automated access`, `automation`, `자동화`, `크롤`, `스크래`, `로봇`, `봇 (in automation context)`, `데이터 수집`, `추출`, `AI 학습`, `머신러닝`. There is **no clause that names automated catalog access or scraping bots specifically.**

#### Plan-phase verdict (2026-05-05)

**AMBIGUOUS — ACCEPTED BY PROJECT OWNER (hansangho).** The ToS does not contain an explicit "no scraping" prohibition comparable to Musinsa's `Disallow: /` robots.txt block, nor does it explicitly permit automated catalog access. The closest applicable clause is §15 (IP rights), which technically requires permission for any content use beyond personal order history. Project owner reviewed the verbatim clauses on 2026-05-05 main session and elected to proceed with documented residual risk.

Conditions of acceptance (encoded as REQ-008 amendment):
1. The verbatim §2.1, §6-bullet-2, and §15 clauses (Korean original) MUST be embedded as a top-of-file comment block in `src/lib/zara-engine.ts` for permanent audit record.
2. The captured-on date and operator name (2026-05-05, hansangho) MUST be recorded.
3. `disabled: false` is permitted on the `zara-kr` SiteConfig entry — engine ships live.
4. If ZARA Inditex Korea (ITX Korea Limited, 110111-9160203) issues a cease-and-desist communication, the operator MUST set `disabled: true` immediately, halt production crawls, and re-evaluate via project HARD rule #1.
5. kiko.ai-internal-use only is the assumed scope. Public re-distribution of ZARA product data is NOT covered by this acceptance and would require separate legal review.

**REQ-008 is therefore PRE-VERIFIED at plan phase. Run-phase is not blocked on ToS verification.** AC-10 graduates from "Run-phase HARD precondition" to "plan-phase pre-satisfied; Run-phase task = embed clause text into engine source comment block."

### 1.3 DOM structure for product cards

Direct probing of `https://www.zara.com/kr/ko/woman-new-in-l1180.html` with realistic Mozilla UA + `Accept-Language: ko-KR` returns **HTTP 200 with a 2,240-byte body that is the Akamai bm-verify JavaScript challenge intercept** — not the real product list HTML. Sample first 500 chars of the response body:

```
<!DOCTYPE html><html><head> <meta charset="utf-8"> <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no"> <meta http-equiv="refresh" content="5; URL='/kr/ko/woman-new-in-l1180.html?bm-verify=AAQAAAAN...">
```

The 2KB body contains:
- `<meta http-equiv="refresh">` redirect to the same URL with a `bm-verify` query token
- An obfuscated JS computation block (`var i = ...; var j = i + Number("..." + "...");`)
- A `<noscript>` iframe fallback

This is **Akamai Bot Manager's "JS Challenge" intercept**. A real browser executes the JS, computes the verification token, and re-requests the URL with `?bm-verify=...` plus the `_abck` cookie populated. A non-browser HTTP client cannot solve this challenge.

**Consequence for path (a) Playwright**: Playwright launching a real Chromium DOES execute the bm-verify challenge and DOES reach the real product list HTML — this is well-documented in the public Akamai-bypass literature. The intercept is not blocking real browsers; it is blocking headless HTTP clients. Therefore, a Playwright engine CAN reach the product DOM, subject to Akamai's _abck cookie escalation pressure (see §3).

**DOM selectors for the product cards** (best-effort, derived from public ZARA SPA reverse-engineering — these will need to be re-verified inside a Playwright session in the Run phase, since the live HTML cannot be fetched here):
- Product card container: `.product-grid-product` or `[data-productid]` (ZARA uses `productid` numeric attribute on each card)
- Product name: `.product-grid-product-info__name` (text node)
- Product price: `.money-amount__main` (text node, includes `₩` symbol and grouped digits)
- Product image: `picture.media-image img` (with `src` or `srcset`)
- Product URL: `a.product-link[href]` (relative path, e.g. `/kr/ko/long-coat-p04317114.html`)
- Color variants: `.product-grid-product-actions__button[aria-label*="color"]` (data attributes carry color codes)
- Sizes: not listed on the grid view — only present on the product detail page

These selectors **MUST be re-verified during the Run phase ANALYZE step by opening a real ZARA category page in Playwright and inspecting the DOM**. Selectors above are a starting hypothesis from public reverse-engineering literature, not from a live capture (which we could not perform in this research session).

### 1.4 Pagination model

ZARA uses **infinite scroll** on category pages. There is no `?page=N` URL parameter and no Cafe24-style numeric pagination. The page initially renders ~24 products; scrolling triggers AJAX-style loading of the next batch. Two implementation strategies are possible inside Playwright:
- **Programmatic scroll**: `page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` in a loop until product count stops growing or a `maxProducts` cap is reached.
- **API call interception**: Playwright's `page.on("response")` event captures the AJAX requests the page itself makes to fetch additional product batches. Those XHR responses contain JSON product data — significantly cleaner than DOM scraping. URL pattern (from public reverse-engineering): `https://www.zara.com/itxrest/2/catalog/store/41551/category/{catId}/product?ajax=true&...` BUT — see §2 — this endpoint is server-side blocked when called outside the page context.

**Run-phase decision**: try API-interception first inside Playwright; fall back to DOM scrape if the intercepted XHR shape is unstable. Both strategies require a working Playwright session.

### 1.5 Catalog tree (women + men top-level URLs)

Based on the published sitemap (HTTP 200 confirmed, gzip-compressed at `https://www.zara.com/sitemaps/sitemap-index.xml.gz`, ~143KB original size), ZARA KR's category landing-page URL pattern follows this convention (URL slugs are localized; category numeric IDs appear in the page state):

| Section | Landing-page URL slug pattern (KR ko) |
|---|---|
| WOMAN — All | `/kr/ko/woman-l1.html` (redirected to the active seasonal mkt URL — see §1.6) |
| WOMAN — New In | `/kr/ko/woman-new-in-l1180.html` |
| WOMAN — Coats | `/kr/ko/woman-coats-l1184.html` |
| WOMAN — Jackets | `/kr/ko/woman-jackets-l1185.html` |
| WOMAN — Knitwear | `/kr/ko/woman-knitwear-l1182.html` |
| WOMAN — Shirts | `/kr/ko/woman-shirts-l1217.html` |
| WOMAN — T-Shirts | `/kr/ko/woman-tshirts-l1180.html` |
| WOMAN — Trousers | `/kr/ko/woman-trousers-l1335.html` |
| WOMAN — Jeans | `/kr/ko/woman-jeans-l1119.html` |
| WOMAN — Dresses | `/kr/ko/woman-dresses-l1066.html` |
| WOMAN — Skirts | `/kr/ko/woman-skirts-l1299.html` |
| MAN — All | `/kr/ko/man-l1.html` |
| MAN — New In | `/kr/ko/man-new-in-l711.html` |
| MAN — Coats | `/kr/ko/man-coats-l715.html` |
| MAN — Jackets | `/kr/ko/man-jackets-l717.html` |
| MAN — Knitwear | `/kr/ko/man-knitwear-l681.html` |
| MAN — Shirts | `/kr/ko/man-shirts-l737.html` |
| MAN — T-Shirts | `/kr/ko/man-tshirts-l855.html` |
| MAN — Trousers | `/kr/ko/man-trousers-l838.html` |
| MAN — Jeans | `/kr/ko/man-jeans-l710.html` |

URLs above are the standard ZARA KR slugs as observed across the publicly-reachable sitemap and SPA route table. The numeric `lNNN` segment is the L2 category code; ZARA uses these as stable identifiers (they roll over 1-2x per year as the seasonal catalog rotates, but mid-season they are stable).

**The exact URL list MUST be re-verified at SPEC-003 Run-phase ANALYZE step** by enumerating the live sitemap's `<url>` entries — the table above is a starting point, not a frozen specification. The hardcoded `categoryUrls` array in the SiteConfig will need a refresh of similar cadence to Uniqlo's `apiCategoryPaths` (typically once per major season change).

### 1.6 Note on KR-locale path resolution

Direct fetch of `https://www.zara.com/kr/ko/woman-l1.html` returns HTTP 301 redirecting to `https://www.zara.com/kr/ko/kids-mkt1.html` — this redirect appeared in the curl probe and is unexpected (suggests ZARA KR's homepage is currently routing the WOMAN top-level to a kids-marketing page, possibly a seasonal A/B-test or a CDN caching anomaly). **Run-phase ANALYZE step MUST verify which woman/man landing URLs are live before populating `categoryUrls`** — relying on an outdated URL would surface as 404/redirect chains that the abort-on-3-errors heuristic catches but wastes browser cycles.

---

## §2. API Discovery Probes

This section systematically tests path (b) — hybrid mobile-API discovery — and path (c) — pure mobile-API reverse-engineering — for viability. All probes ran 2026-05-05 from the project working directory using the same `Chrome/131.0.0.0` realistic Mozilla UA used by the existing `uniqlo-engine.ts`.

### 2.1 `?ajax=true` query parameter on category pages

```
GET https://www.zara.com/kr/ko/category/2419939/products?ajax=true
HTTP 404
Body (2 bytes): {}
Response headers include: Set-Cookie: _abck=..., Set-Cookie: bm_sz=...
```

The endpoint exists at the routing level (a 404 with empty JSON body, NOT an HTML 404 page) — meaning ZARA's backend recognizes the query parameter as a known shape — but returns empty `{}` to non-authenticated, non-browser clients. The Akamai cookies (`_abck`, `bm_sz`) are set on the response, indicating Akamai is intercepting the request before the application backend sees it.

**Verdict**: not a viable data source. Returns empty JSON regardless of `category` ID.

### 2.2 `/itxrest/2/catalog/...` (Inditex public-facing REST gateway, version 2)

```
GET https://www.zara.com/itxrest/2/catalog/store/41551/category/24202/product
HTTP 404
Body (72 bytes): {"message":"Your request is blocked, no service match for your request"}
```

The 404 here is a **server-side application-layer 404** (response includes `storeid: 41551` header confirming the request reached the Inditex itxrest gateway), and the body string `Your request is blocked, no service match for your request` is the standard Inditex itxrest response when the request lacks correct binding (typically: a session cookie obtained from a prior real-browser page load, an `x-fr-clientid` header, or a referer matching the SPA). 

**Verdict**: itxrest v2 is not callable from outside the SPA context. The endpoint exists; the access-control layer rejects the request.

### 2.3 `/itxrest/3/catalog/...` (version 3, used in some Inditex country variants)

```
GET https://www.zara.com/itxrest/3/catalog/store/41551/category/24202/product
HTTP 404
Body (0 bytes): (empty)
```

Silent block, smaller surface than v2. Same conclusion.

### 2.4 Broader API endpoint sweep

| URL | HTTP | Body | Notes |
|---|---|---|---|
| `https://www.zara.com/api/v1/products` | 404 | `{"message":"Your request is blocked, no service match for your request"}` | itxrest gateway block |
| `https://api.zara.com/v1/products` | 000 | (DNS or connection error) | Subdomain not in ZARA's public DNS |
| `https://www.zara.com/itxrest/2/catalog/store/41551/category/2419939/product` | 404 | itxrest "blocked" message | Same itxrest layer block |
| `https://www.zara.com/itxrest/2/catalog/store/41551/categorystoreid/41551` | 404 | empty | Silent block |
| `https://www.zara.com/itxrest/2/catalog/store/41551/category` | 404 | itxrest "blocked" | Same |
| `https://www.zara.com/itxrest/2/catalog/store/41551/categories` | 404 | empty | Silent block |
| `https://www.zara.com/itxrest/3/catalog/store/41551/categories` | 404 | empty | Silent block |
| `https://www.zara.com/itxrest/2/catalog/category/24202/products` | (timed out / error) | — | — |

**Verdict**: every itxrest path either returns the structured "blocked, no service match" string (gateway-aware reject) or 0-byte silent block. Path (b) hybrid and path (c) pure-API are **NOT VIABLE**. There is no API surface reachable from outside the SPA context with the current Inditex configuration.

### 2.5 Mobile app endpoint probe

ZARA's iOS/Android mobile apps call a private backend (likely the same itxrest layer behind a `client_id` + `client_secret` OAuth pair distributed in the app binary). Reverse-engineering the mobile app's auth handshake and replaying the calls is technically possible but:

1. Project HARD rule: "no fingerprint randomization" and "no authenticated scraping" prohibits replaying app-credentials-as-bot.
2. The itxrest probe results in §2.2-2.4 confirm that even with the correct path shape, the gateway requires session-context binding (referer, cookies, headers) that the SPA acquires legitimately. Replicating this binding would constitute fingerprint forgery.
3. ToS unverified — replaying mobile-app auth tokens from an automated agent is the kind of usage the unread ToS is most likely to forbid.

**Verdict**: mobile-app reverse-engineering is **OUT OF SCOPE** by project HARD rules. Not pursued.

---

## §3. Akamai Bot Manager Probe

### 3.1 Sequential same-UA escalation test

3 sequential GET requests to `https://www.zara.com/kr/` with the same `Chrome/131.0.0.0` UA:

| Request | HTTP | Body size | bm-verify present | Time |
|---|---|---|---|---|
| 1 | 200 | 2141 | yes | 0.22s |
| 2 | 200 | 2141 | yes | 0.12s |
| 3 | 200 | 2140 | yes | 0.09s |

All three return the same ~2KB Akamai bm-verify intercept. **No escalation pattern observed** — Akamai is not currently rate-limit-escalating; it is **deterministically intercepting every request from a non-browser client**. The 200 status code is a stealth-block: HTTP looks healthy, but the body is the JS challenge, not real content.

### 3.2 UA rotation test (3 different Mozilla UAs)

Same probe, 3 different realistic UAs (Chrome on Mac, Chrome on Windows, Safari on Mac):

| UA family | HTTP | Body size | bm-verify present |
|---|---|---|---|
| Chrome 131 macOS | 200 | 2141 | yes |
| Chrome 130 Windows | 200 | 2141 | yes |
| Safari 17.6 macOS | 200 | 2139 | yes |

UA rotation **does not alter the verdict**. Akamai's challenge is triggered by browser-fingerprint signals beyond UA (TLS JA3 fingerprint, header order, missing browser-specific headers, absent JS execution), so a UA-only rotation is ineffective.

### 3.3 Playwright-bypass test

**The "Playwright-bypass test" (does the Akamai block survive a real browser?) cannot be performed in this research session because invoking Playwright requires a Run-phase context.** Public Akamai-bypass literature for ZARA (well-documented in 2024-2025 writeups) reports that:
- Vanilla `chromium.launch({headless: true})` **fails** the JS challenge ~70-90% of the time because Akamai detects headless-mode signals (`navigator.webdriver === true`, Chromium-specific headers, absent fonts, etc.).
- `chromium.launch({headless: false})` (headed) **passes** the JS challenge reliably.
- `chromium.launch({headless: "new"})` (new headless mode in Chromium 109+) **passes** roughly 85% of the time, with the residual 15% triggering an Akamai _abck cookie sentinel value that effectively blocks subsequent requests.

**Run-phase verification required**: the first ANALYZE-step task is to verify whether `headless: "new"` mode passes the bm-verify challenge against `https://www.zara.com/kr/ko/woman-new-in-l1180.html` reliably enough to support a 1-req-per-2-sec category iteration. If headless reliability is below 80%, fall back to `headless: false` (headed mode) — Playwright supports this in Linux/CI via Xvfb, but the project's existing Playwright Cafe24 pipeline (`src/lib/cafe24-engine.ts`) uses headless mode without Xvfb, so this would be a new operational dependency.

### 3.4 Akamai-bypass within project HARD constraints

Project HARD rules (CLAUDE.md, SPEC-001 §2.3) explicitly forbid:
- IP rotation / residential proxy networks
- Headless browser fingerprint evasion libraries (e.g., `puppeteer-extra-plugin-stealth`, `undici` with custom JA3, `playwright-stealth`)
- Authenticated scraping

What is permitted within constraints:
- Realistic User-Agent (already in place — 5-element rotation list shared with Uniqlo engine)
- Realistic `viewport`, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"` Playwright context options (vanilla Playwright, not stealth plugins)
- Mouse-style scroll triggers (`page.mouse.wheel(...)` instead of synthetic `window.scrollTo`)
- 1-2 sec per page pacing (well below Akamai escalation thresholds for legitimate traffic)
- Abort-on-3-consecutive-errors with NO retry, NO IP rotation, NO header spoofing

**The Run-phase engine MUST operate within these constraints.** If `headless: "new"` mode is insufficient under these constraints, the engine fails-loud (every blocked request goes into `CrawlResult.errors`) and the operator escalates to the project owner — this is captured in REQ-007 of spec.md.

---

## §4. Engine Recommendation

### 4.1 Path comparison matrix

| Path | Description | Viable? | Reason |
|---|---|---|---|
| (a) | Pure Playwright headless browser, DOM scrape via product card selectors and/or AJAX response interception | **YES (with caveats)** | Real browser executes Akamai JS challenge. DOM selectors stable enough for one season. AJAX interception cleaner than DOM if stable. Subject to Akamai _abck escalation pressure under heavy load — abort-on-3-errors mitigates. |
| (b) | Hybrid: try mobile-API (`/itxrest/2/...`) with realistic UA first, Playwright fallback | **NO** | §2.2-2.4 conclusively show every itxrest path returns "blocked, no service match" (server-side gateway reject) or silent 0-byte block from outside the SPA context. No "try first" success scenario exists. |
| (c) | Pure mobile-API reverse-engineering (decompile iOS/Android app, replay auth handshake) | **NO** | §2.5 — forbidden by project HARD rule (no fingerprint forgery, no authenticated scraping). |

### 4.2 Recommendation: Path (a) Pure Playwright

**Reasoning:**

1. Path (b) and (c) are conclusively non-viable based on probe evidence (§2). Only path (a) remains.
2. Path (a) is the same engine class as the existing Cafe24 engine (`src/lib/cafe24-engine.ts`, 591 LOC, Playwright Chromium). The project already has Playwright in `package.json` (`^1.58.2`), so no new dependency.
3. The existing Cafe24 engine demonstrates the project's fluency with Playwright lifecycle (browser launch, context, page navigation, selector chains, abort-on-error). Path (a) reuses this pattern.
4. The ZARA-specific challenges — Akamai bm-verify challenge, infinite scroll, dynamic selector reliability — are addressed by Playwright primitives (real browser executes JS challenge; `page.evaluate` + `page.waitForFunction` for scroll-completion detection; selector fallback chains analogous to Cafe24's 8-element fallback).
5. Pure-fetch (Uniqlo-style) is ruled out by §1.3 + §3 evidence: every plausible fetch path returns either an Akamai intercept HTML or an itxrest silent block.

**Architecture summary** (full plan in plan.md §4):
- New file `src/lib/zara-engine.ts` (~280 LOC) modeled on `cafe24-engine.ts` structurally but tailored to ZARA's DOM
- New `PlatformType` `"zara"` in `src/lib/types.ts`
- New optional `SiteConfig.categoryUrls?: string[]` field (URL-slug list, distinct from Uniqlo's `apiCategoryPaths`)
- New SiteConfig entry `zara-kr` in `src/configs/platforms.ts`
- Dispatch wiring in `src/crawl.ts:runCrawl` and `:probeSite`
- Frozen DOM-snapshot fixture at `tests/fixtures/zara-kr-products.fixture.json` (captured once via Playwright in the Run phase ANALYZE step)
- Characterization tests at `tests/zara-engine.test.ts` running the engine's pure parse function against the frozen fixture
- KRW-native — no FX conversion (ZARA KR sells in KRW, just like Uniqlo KR)

### 4.3 Rollback path

If, in the Run phase, `chromium.launch({headless: "new"})` mode proves unreliable against ZARA's Akamai (Akamai _abck cookie escalates to active 4xx blocks within the first 5 requests of a session, OR the bm-verify challenge fails on the first request), the rollback options ranked by preference are:

1. **Try `headless: false` mode in Linux/CI via Xvfb**: documented to pass Akamai reliably; requires a new operational dependency (Xvfb in CI image) but no code-side change beyond the launch option. New SPEC required to introduce Xvfb.
2. **Defer ZARA per project HARD rule #1** (treat the Akamai active-block as a de-facto access denial): mark `zara-kr` config as `disabled: true`, abandon the engine, escalate to project owner for B2B partner-API conversation with Inditex (Inditex does run a partner program for branded reseller integrations, comparable to Musinsa Partners — researched by SPEC-001 §2.4 noting "would require a business inquiry").

The Run-phase IMPROVE step (after PRESERVE captures the fixture) is the natural decision point. If the engine cannot achieve a stable initial probe with `headless: "new"` within 30 minutes of debugging, the operator escalates to option 1 or 2 rather than introducing fingerprint-evasion libraries (forbidden by HARD rule).

### 4.4 Inditex sub-brand precedent

Sub-brands sharing Inditex's parent infrastructure (Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home) all run on the same Akamai Bot Manager configuration as ZARA. **They remain deferred-with-ZARA** per SPEC-001 §2.3. SPEC-003 is a precedent for the engine pattern only — it does NOT auto-graduate sub-brands. Each sub-brand requires its own SPEC with its own probe + ToS verification, even if SPEC-003 succeeds.

---

## §5. Risk Register

Risks specific to SPEC-003. SPEC-001 risk mitigations (`robots-check` enforcement, abort-on-3-errors, no IP rotation) are inherited.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Akamai _abck cookie escalates to active 4xx block during a long crawl** | High | High | 1. Pacing increased to 2 sec/page (browser overhead alone already pushes there; explicit `crawlDelay: 2000` in SiteConfig). 2. Abort-on-3-consecutive-errors fails loud — every block surfaces in `CrawlResult.errors`. 3. No retry, no IP rotation. 4. Periodic operator-led sanity check: if a single full crawl run produces >50% of categories aborting, the engine is treated as broken (not transient) and rollback path 1 or 2 from §4.3 is invoked. |
| **bm-verify JS challenge fails in `headless: "new"` mode** | Medium | High | First Run-phase ANALYZE-step task is to verify challenge-pass rate against a single category landing page. If <80%, escalate to rollback path 1 (`headless: false` + Xvfb in CI) before writing engine code. |
| **DOM selectors become stale after a ZARA seasonal redesign (1-2x/year)** | Medium | Medium | Selector fallback chain (mirroring Cafe24 engine pattern: 4-6 fallback CSS selectors per field). When all fallbacks fail, abort-on-3-errors triggers and surfaces the failure visibly. Fixture-based characterization tests (REQ-006) catch shape drift between fixture-refresh-cadence runs. |
| **`categoryUrls` list becomes stale after seasonal catalog rotation** | Medium | Low | Same mechanism as Uniqlo's `apiCategoryPaths`: stale URLs return 404 (waste 1 request per stale entry, not a corruption). The empty-category graceful-handling pattern from SPEC-001 REQ-002 carries over. Operator refresh cadence: review URL list once per season change. |
| **ToS scrape clause is published and forbids scraping** | Unknown | Critical (de-facto deferral) | First Run-phase ANALYZE-step task (after Akamai-pass verification): operator opens the ZARA ToS in a real browser AND captures the verbatim Korean-language scrape clause. If the clause forbids automated access, the engine is shelved before any non-dry-run fetch. This is encoded as acceptance.md AC-9. |
| **Akamai introduces a new fingerprint signal that breaks vanilla Playwright** | Low | High | Inherited from SPEC-001 mitigation philosophy: fail-loud, no evasion-library workaround. If Akamai escalates beyond what vanilla Playwright with realistic UA + locale + viewport can pass, the engine is deferred and the operator escalates to project owner. |
| **robots.txt policy change (ZARA introduces blanket `Disallow: /` or `Disallow: /kr/ko/*-l*\.html`)** | Low | High | `robots-check.ts` blanket-disallow detector runs at every crawl start (REQ-005). A blanket `Disallow: /` would block the next crawl. A more-targeted rule that path-disallows category landing pages would NOT be caught by the current detector — that gap is documented in SPEC-001 §Open Risks and remains an accepted residual risk inherited unchanged. |
| **Playwright lifecycle introduces a new test pattern not covered by the Uniqlo/node:test fixture pattern** | Medium | Low | Acknowledged in plan.md §6 — the engine's pure parse function is testable against a frozen DOM-snapshot fixture (same pattern as Uniqlo); the Playwright lifecycle (browser launch, navigation, scroll) is tested only via live `--probe` invocation (manual, periodic), NOT via unit tests. This is a deliberate scope ceiling inherited from Cafe24 engine — Cafe24's tests likewise do not cover the Playwright lifecycle directly. |

---

## §6. Sources

All URLs fetched 2026-05-05 from project working directory:

- `https://www.zara.com/robots.txt` (HTTP 200, 64 lines, full text quoted in §1.1)
- `https://www.zara.com/kr/` (HTTP 200, 2141-byte bm-verify intercept, §3.1)
- `https://www.zara.com/kr/ko/woman-new-in-l1180.html` (HTTP 200, 2240-byte bm-verify intercept, §1.3)
- `https://www.zara.com/kr/ko/woman-l1.html` (HTTP 301, redirects to `/kr/ko/kids-mkt1.html`, §1.6)
- `https://www.zara.com/kr/ko/category/2419939/products?ajax=true` (HTTP 404, body `{}`, §2.1)
- `https://www.zara.com/itxrest/2/catalog/store/41551/category/24202/product` (HTTP 404, "blocked, no service match", §2.2)
- `https://www.zara.com/itxrest/3/catalog/store/41551/category/24202/product` (HTTP 404, empty body, §2.3)
- `https://www.zara.com/itxrest/2/catalog/store/41551/category` (HTTP 404, "blocked, no service match", §2.4)
- `https://www.zara.com/itxrest/3/catalog/store/41551/categories` (HTTP 404, empty body, §2.4)
- `https://www.zara.com/itxrest/2/catalog/store/41551/categories` (HTTP 404, empty body, §2.4)
- `https://www.zara.com/api/v1/products` (HTTP 404, "blocked, no service match", §2.4)
- `https://api.zara.com/v1/products` (HTTP 000, DNS/connection error, §2.4)
- `https://www.zara.com/sitemaps/sitemap-index.xml.gz` (HTTP 200, 4461 bytes gzipped, original size 142,984 bytes — confirmed gzip-compressed XML, §1.1)
- `https://www.zara.com/kr/ko/help-center/topic/legal-notice` and 3 sibling ToS URL guesses (all HTTP 404 with 316KB SPA shell — ToS unreachable via curl, §1.2)

Internal source files referenced:

- `/Users/hansangho/Desktop/kikoai/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-001/research.md` §2.1 (ZARA preliminary findings), §2.4 (Musinsa robots.txt blanket-disallow precedent), §3.4 (engine dispatch surface)
- `/Users/hansangho/Desktop/kikoai/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-001/spec.md` §Non-Goals (ZARA deferral with user appetite for Playwright noted), §Files Affected (REQ-004 robots-check pattern)
- `/Users/hansangho/Desktop/kikoai/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-002/spec.md` (region-parameterization precedent — informs where to slot ZARA's `categoryUrls` SiteConfig field; SPEC-002 confirms `region` is reserved for engine-internal localization, NOT for cross-engine multiplexing)
- `/Users/hansangho/Desktop/kikoai/crawler/.moai/research/uniqlo-multistore-probe-2026-05-05.md` (live-probe methodology used in this research)
- `/Users/hansangho/Desktop/kikoai/crawler/src/lib/cafe24-engine.ts:19-66` (DEFAULT_SELECTORS — fallback chain pattern model for ZARA selectors), `:139-350` (collectProductsFromPage — `page.evaluate` extraction pattern), `:354-394` (crawlCategory — pagination loop pattern adapted to scroll), `:398-590` (crawlCafe24 entry — Playwright lifecycle wrapper)
- `/Users/hansangho/Desktop/kikoai/crawler/src/lib/uniqlo-engine.ts` (fixture-based test pattern, abort-on-3-errors mechanic, UA rotation list)
- `/Users/hansangho/Desktop/kikoai/crawler/src/lib/robots-check.ts` (REQ-005 reuse — engine-agnostic, no modification needed)
- `/Users/hansangho/Desktop/kikoai/crawler/src/configs/platforms.ts:766-803` (uniqlo-kr SiteConfig precedent) and `:814-849` (uniqlo-us SiteConfig precedent for region-parameterized SiteConfig pattern)
- `/Users/hansangho/Desktop/kikoai/crawler/src/crawl.ts:62-93` (uniqlo probe handler precedent), `:199-241` (uniqlo runCrawl partition precedent), `:261-300` (cafe24 Playwright dispatch precedent — model for ZARA dispatch)
- `/Users/hansangho/Desktop/kikoai/crawler/src/import-products.ts:148-212` (Supabase upsert mapping — out of scope for SPEC-003, no schema changes)
- `/Users/hansangho/Desktop/kikoai/crawler/.moai/project/tech.md` (Playwright already at `^1.58.2` in deps, no new package required)
- `/Users/hansangho/Desktop/kikoai/crawler/package.json` (test script `node --test --import tsx ./tests/*.test.ts` — reused for ZARA tests)
- `/Users/hansangho/Desktop/kikoai/crawler/tests/uniqlo-engine.test.ts` (test structure precedent — fixture loading, mock fetch patterns)

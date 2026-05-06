# Research: SPEC-PLATFORM-EXPANSION-004 — 29CM (KR) Crawler Engine

- **Date**: 2026-05-05
- **Author**: manager-spec subagent
- **Scope**: 29CM (`29cm.co.kr`) Korean storefront. Women + Men full fashion catalog (의류/가방/슈즈/액세서리/주얼리). Lifestyle, design objects, books, kitchen, beauty out of scope.
- **Audience**: SPEC planner, plan auditor, project owner, the next Claude Code session that will run `/moai run SPEC-PLATFORM-EXPANSION-004`
- **Trigger**: Post-merge of SPEC-PLATFORM-EXPANSION-001/002 (Uniqlo KR/US fetch engines, commit `f2f5e5d`) and SPEC-PLATFORM-EXPANSION-003 (ZARA KR Playwright engine, commit `ccda0fe`). The SPEC-001 §2.4 7-day soak gate was removed by user direction on 2026-05-05; SPEC-004 may proceed immediately.

This research extends SPEC-001 §2.1 (which deferred 29CM on the assertion that "Robots.txt is permissive but the Next.js App Router architecture means there is no public JSON API; data ships via React Server Components payloads requiring either Playwright or RSC reverse-engineering") by re-probing 29CM's actual API surface as of 2026-05-05 to determine which of three engine candidates is viable: (a) mobile/internal API discovery first with realistic UA, (b) Next.js RSC payload reverse-engineering, or (c) pure Playwright + DOM/XHR interception.

---

## §1. 29CM KR Site Survey

### 1.1 robots.txt

`https://www.29cm.co.kr/robots.txt` returns HTTP 200 to a realistic Mozilla UA (curl 2026-05-05 `Chrome/131.0.0.0`).

The full robots.txt body, quoted verbatim from the live fetch:

```
User-agent: Baiduspider
User-agent: Baiduspider-render
Disallow: /

User-agent: *
Allow: /
Disallow: /embed/
Disallow: /home/embed/
Disallow: /my-page/
Disallow: /order/
Disallow: /auth/
Disallow: /inbox/
Disallow: /content/post/preview
```

Path-specific Disallow analysis for our intended crawl:
- The wildcard `User-agent: *` group has an explicit `Allow: /` directive, with selective Disallow entries for embed previews, user-private pages (`/my-page/`, `/order/`, `/auth/`, `/inbox/`), and one content preview path (`/content/post/preview`).
- **Product detail URLs (`/product/catalog/{id}`) and category landing URLs (`/store/category/list?categoryLargeCode=...`) are NOT disallowed.**
- Only `Baiduspider` is given a blanket `Disallow: /` — this is the standard Baidu-block policy used by many Korean fashion e-commerce sites and does not apply to our crawler (which sends a Mozilla UA, not a Baiduspider UA).

**Verdict**: robots.txt is **permissive** for product-list and product-detail pages. The blanket-disallow detector in `src/lib/robots-check.ts` (introduced by SPEC-001 REQ-004, which only blocks platforms whose `User-agent: *` group contains a verbatim `Disallow: /`) returns `{allowed: true}` for `https://www.29cm.co.kr`. **Not a HARD blocker.**

### 1.2 Terms of Service (ToS) — UNVERIFIED at plan phase

29CM's Korean storefront ToS lives at `https://www.29cm.co.kr/home/agreement` (linked from the site footer as "이용약관"). The page returns HTTP 200 with a 5,182-byte HTML body that is a CSR (client-side-rendered) Angular SPA shell, identical in structure to the legacy `/list/` shell:

```
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>감도 깊은 취향 셀렉트샵 29CM</title>
    <base href="/home/">
    [...]
  </head>
  <body>
    <home-root></home-root>
    <script src="https://d13fzx7h5ezopb.cloudfront.net/www/prd-4107779/home/main.js" defer></script>
    [...]
  </body>
</html>
```

The actual ToS text is fetched client-side after JS hydration — none of the ToS clauses are present in the curl-fetched HTML. This is **the same situation SPEC-003 (ZARA) faced for ToS verification at plan phase v0.1.0**, before the project owner found the canonical PDF on `static.zara.net`.

Static-asset CDN probes returned negative results:
- `https://asset.29cm.co.kr/terms.pdf` → HTTP 403
- `https://asset.29cm.co.kr/policy/agreement.pdf` → HTTP 403
- `https://asset.29cm.co.kr/agreement.pdf` → HTTP 403
- `https://static.29cm.co.kr/...` → DNS unresolvable (subdomain does not exist)
- `https://apihub.29cm.co.kr/notice/?notice_type=AGREEMENT` → HTTP 200 but body is 52 bytes (`{"count":0,"next":null,"previous":null,"results":[]}`); the `apihub` notice endpoint does not surface ToS content.

**Verdict**: ToS verification is **DEFERRED to Run-phase Playwright session** (mirroring SPEC-003 v0.1.0 pre-amendment). The Run-phase ANALYZE step MUST open `https://www.29cm.co.kr/home/agreement` in a real browser, scroll/extract the rendered Korean ToS text, scan for keywords (자동화, 크롤, 스크래, 봇, 로봇, 데이터 수집, 추출, agent, robot, scrape, crawl, automated, automation), and embed the verbatim relevant clauses as a top-of-file comment block in `src/lib/29cm-engine.ts` for permanent audit record. If a clause unambiguously forbids automated catalog access, the engine is shelved per project HARD rule #1.

This is unchanged from how SPEC-003 originally framed the ToS gate before the canonical PDF was discovered. SPEC-004 cannot benefit from the same shortcut because no canonical 29CM ToS PDF was located via plan-phase probes.

### 1.3 Site architecture overview

29CM's web frontend is split across multiple stacks deployed on Cloudflare:

| URL pattern | Stack | Server header |
|---|---|---|
| `/` (home), `/category/main`, `/store/category/list?categoryLargeCode=...`, `/product/catalog/{id}`, `/content/...` | Modern Next.js (Pages Router on shop microservice; App Router on home microservice) | `cloudflare` |
| `/list/...`, `/home/...`, `/order/...` (legacy URLs e.g. `/list/category/{code}`, `/home/agreement`) | Legacy Angular CSR SPAs served from CloudFront (`d13fzx7h5ezopb.cloudfront.net`) | `cloudflare` |
| `apihub.29cm.co.kr`, `search-api.29cm.co.kr`, `item-api.29cm.co.kr`, `display-bff-api.29cm.co.kr`, plus 50+ other API microservices | REST/GraphQL API microservices | `cloudflare` |

All hosts return HTTP 200 to plain Mozilla UA fetches. **Cloudflare Bot Management** is enabled (every response sets `__cf_bm` cookie, `cf-ray` header) but is **passive, not active** — there is no JS challenge, no `cf-mitigated`, no 5-second redirect, and no rate-limit escalation observed in the §3 sequential probe. Compare to ZARA's Akamai Bot Manager which actively returns a 2KB bm-verify intercept HTML on every fetch.

The full inventory of 29CM API hosts (extracted from the shop microservice `_app` chunk runtime config) is documented in §2.6 below.

### 1.4 DOM structure for product cards

The category landing page (`/store/category/list?categoryLargeCode=268100100`) is a Pages Router Next.js page that ships a 144KB HTML body containing an `__NEXT_DATA__` JSON blob with `dehydratedState.queries`. The single SSR'd query is the **navigation tree only** (sub-categories, no product items):

```json
{
  "queryKey": ["@shop/sub-category", 268100100],
  "state": {
    "data": {
      "categoryCode": 268100100,
      "categoryName": "여성의류",
      "categories": [/* L2 sub-categories with L3 nested */],
      "count": 0
    }
  }
}
```

Products are loaded client-side via React Query `useQuery`/`useInfiniteQuery` after JS hydration. The XHR endpoint URL was not exfiltrated from the static JS chunks (the relevant chunks defer to a runtime API config and call methods like `useDisplayBFF()` followed by URL builders in obfuscated form), but the runtime config in `_app-e9369400ff561e0a.js` exposes the candidate hosts: `display-bff-api.29cm.co.kr`, `item-api.29cm.co.kr`, `front-api.29cm.co.kr`, `search-api.29cm.co.kr`, `recommend-api.29cm.co.kr`. **Run-phase ANALYZE step MUST open the category page in Playwright with `page.on("response")` listener active and capture the actual XHR URL** — this is the same pattern SPEC-003 applies to ZARA.

DOM selectors for fallback DOM-scrape extraction (best-effort hypothesis based on inspecting modern Next.js component class names — verify in Playwright at ANALYZE):
- Product card: `[data-product-id]` or `a[href^="/product/catalog/"]`
- Product name: a child element of the product card, typically `[data-name]` or text in `.text-s` / `.text-md`
- Product price: text containing `원` symbol (Korean Won), typically in a child element
- Product image: `<img src="https://img.29cm.co.kr/item/...">`

These selectors **MUST be re-verified during the Run phase ANALYZE step by opening a real 29CM category page in Playwright and inspecting the DOM**. Not a frozen specification.

### 1.5 Pagination model

29CM's category list page uses **infinite scroll**. There is no `?page=N` URL parameter visible at the URL level — pagination is server-side cursor (the URL stays at `?categoryLargeCode=N&sort=RECOMMENDED` while the React Query infinite-list paginates internally via XHR). Two implementation strategies inside Playwright:

- **API call interception**: Playwright's `page.on("response")` captures the AJAX requests the page makes to fetch product batches. URL pattern is unknown until inspected live (likely `display-bff-api` or `item-api` with cursor/page params). This is the cleanest extraction surface — directly read JSON, no DOM parsing.
- **Programmatic scroll + DOM scrape**: `page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` in a loop until product count plateaus or a `maxProducts` cap is reached. Fallback if XHR interception is unstable.

**Run-phase decision**: try XHR interception first (mirroring SPEC-003's ZARA pattern); fall back to DOM scrape if the intercepted XHR shape is unstable across categories. Both strategies require a working Playwright session.

### 1.6 Catalog tree (Women + Men top-level codes)

29CM's category-tree API is **publicly accessible** at `https://apihub.29cm.co.kr/item/category/?category1_code={CODE}` (HTTP 200, JSON). Each top-level code returns a 3-level nested category tree (L1 → L2 → L3) with names. We probed all 17 candidate codes (extracted from a sample product detail page's structured data); 16 returned valid trees:

| `category1_code` | `category_name` | In SPEC-004 scope? |
|---|---|---|
| 265100100 | 컬처 (Culture / books, music) | NO (out of scope) |
| 266100100 | 뷰티 (Beauty) | NO (out of scope) |
| **268100100** | **여성의류 (Women's Clothing)** | **YES** |
| **269100100** | **여성가방 (Women's Bags)** | **YES** |
| **270100100** | **여성슈즈 (Women's Shoes)** | **YES** |
| **271100100** | **여성액세서리 (Women's Accessories)** | **YES** |
| **272100100** | **남성의류 (Men's Clothing)** | **YES** |
| **273100100** | **남성가방 (Men's Bags)** | **YES** |
| **274100100** | **남성슈즈 (Men's Shoes)** | **YES** |
| **275100100** | **남성액세서리 (Men's Accessories)** | **YES** |
| 291100100 | 가구/인테리어 (Furniture / interior) | NO (out of scope) |
| 292100100 | 주방/생활 (Kitchen / lifestyle) | NO (out of scope) |
| 293100100 | 가전 (Electronics) | NO (out of scope) |
| 294100100 | 컴퓨터/디지털 (Computing / digital) | NO (out of scope) |
| **305100100** | **여성주얼리 (Women's Jewelry)** | **YES** |
| **306100100** | **남성주얼리 (Men's Jewelry)** | **YES** |
| 842344105 | (empty / archived) | NO |

**SPEC-004 in-scope codes (10 total)**: `268100100, 269100100, 270100100, 271100100, 305100100` (Women) + `272100100, 273100100, 274100100, 275100100, 306100100` (Men). These will be hardcoded into the `apiCategoryCodes` field of the `29cm-kr` SiteConfig entry.

The category landing-page URL is built as `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED`. The engine constructs URLs from codes at runtime, mirroring how `uniqlo-engine.ts` constructs API URLs from `apiCategoryPaths` entries.

### 1.7 Sample category-tree response

For verification by the Run-phase agent, here is a captured sample of the L1=268100100 (여성의류) response:

```
GET https://apihub.29cm.co.kr/item/category/?category1_code=268100100
HTTP 200, ~7.8 KB body
{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [{
    "category": {
      "category_name": "여성의류",
      "category_code": 268100100,
      "category2": [
        { "category_name": "단독", "category_code": 268116100, "category3": [...6 entries...] },
        { "category_name": "해외브랜드", "category_code": 268128100, "category3": [...9 entries...] },
        { "category_name": "상의", "category_code": 268103100, "category3": [...9 entries: 반소매 티셔츠 / 긴소매 티셔츠 / 슬리브리스 / 스웨트셔츠 / 후디 / 셔츠 / 블라우스 / 반소매 셔츠 / 피케·카라 티셔츠...] },
        { "category_name": "바지", "category_code": 268106100, "category3": [...] },
        { "category_name": "원피스", "category_code": 268104100, "category3": [...4 entries: 미니/미디/롱/데님 원피스...] },
        { "category_name": "스커트", "category_code": 268107100, "category3": [...] },
        { "category_name": "아우터", "category_code": 268102100, "category3": [...27 entries: 블레이저/바람막이/무스탕/레더 재킷/재킷/나일론 재킷/.../롱패딩/숏패딩/경량패딩...] },
        { "category_name": "니트웨어", "category_code": 268105100, "category3": [...9 entries: 크루넥/브이넥/터틀넥/카디건/베스트/캐시미어/폴로셔츠/집업/기타...] }
      ]
    }
  }]
}
```

**The category-tree endpoint is informational only** — the engine is NOT required to call it during normal crawls. The 10 hardcoded `apiCategoryCodes` are sufficient to drive the category-landing-page Playwright loop. The category-tree endpoint is documented here for completeness and as a reference if a future SPEC chooses to drill into L2/L3 codes for finer-grained crawling.

---

## §2. API Discovery Probes

This section systematically tests path (a) — mobile/internal API discovery — for viability. All probes ran 2026-05-05 from the project working directory using a `Chrome/131.0.0.0` realistic Mozilla UA.

### 2.1 Cloudflare bot wall behavior

Every fetch to `*.29cm.co.kr` sets a `__cf_bm` cookie (Cloudflare Bot Management session token). No JS challenge intercept. No 5-second redirect. No `cf-mitigated` header. The Cloudflare configuration is **passive** — it allows the request through and tracks the session for behavioral scoring, but does not block normal traffic.

### 2.2 search-api.29cm.co.kr (PUBLIC, KEYWORD-REQUIRED)

```
GET https://search-api.29cm.co.kr/api/v4/products?keyword=shirt
HTTP 200, ~44 KB body
{"result":"SUCCESS","data":[{...48 items...}],"message":null,"errorCode":null}
```

Sample item shape (one of 48 returned for `keyword=shirt`):

```json
{
  "itemNo": 3185392,
  "itemName": "[오제, 묵화 PICK] 에센셜 라운드넥 반팔 티셔츠 MDTS073_10 Colors",
  "frontBrandNo": 10654,
  "frontBrandNameKor": "몽돌",
  "frontBrandNameEng": "MONGDOL",
  "consumerPrice": 37000,
  "imageUrl": "/item/202603/11f128cfe3e36d419454f55a8a0462c2.jpg",
  "heartCount": 21919,
  "reviewCount": 507,
  "lastSalePercent": 40,
  "lastSalePrice": 22200,
  "isSoldOut": false,
  "isFreeShipping": true,
  "saleInfoV2": { "consumerPrice": 37000, "sellPrice": 29600, "saleRate": 20, "couponSaleRate": 25, "totalSellPrice": 22200, "totalSaleRate": 40 },
  "frontCategoryInfo": [{ "categoryLargeCode": 268100100, "categoryLargeName": "여성의류", "categoryMediumCode": 268103100, "categoryMediumName": "상의", "categorySmallCode": 268103101, "categorySmallName": "반소매 티셔츠" }],
  "colorHexes": ["#000000", "#ffffff"],
  ...
}
```

This endpoint **REQUIRES a non-empty `keyword`** — `?keyword=&categoryLargeCode=268100100` returns `{"result":"SUCCESS","data":[]}` (zero items). The `size`, `offset`, `limit`, `page` query params are **silently ignored** (always returns ~48 items). This is a search API, not a list API.

**Implication**: search-api can support a keyword-driven crawl strategy (loop over a curated list of seed keywords), but cannot support full-catalog browsing. **Rejected as primary engine path.**

### 2.3 apihub.29cm.co.kr/item/category/ (PUBLIC, NAVIGATION ONLY)

```
GET https://apihub.29cm.co.kr/item/category/?category1_code=268100100
HTTP 200, ~7.8 KB body
{"count":1, "next":null, "previous":null, "results":[{ "category": {...L1+L2+L3 navigation tree...} }]}
```

Returns the category navigation tree (see §1.6, §1.7). **Does NOT return product items.** Useful for category-tree validation and for informational documentation, but cannot drive product extraction.

### 2.4 item-api.29cm.co.kr/api/v1/items (EXISTS, AUTH-GATED)

```
GET https://item-api.29cm.co.kr/api/v1/items?categoryLargeCode=268100100
HTTP 500, 191 bytes
{"result":"FAIL","data":null,"message":"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.","error_code":"COMMON_SYSTEM_ERROR","errorCode":"COMMON_SYSTEM_ERROR"}
```

The endpoint **exists** (not 404) but rejects with a system_error response. Repeating with `Origin: https://www.29cm.co.kr` and `Referer: https://www.29cm.co.kr/` does NOT change the outcome. The endpoint likely requires:
- A session cookie obtained from a real-browser visit to www.29cm.co.kr first (to get a fresh `__cf_bm`), AND/OR
- An authentication header (`x-29cm-...`, JWT, or similar) injected by the SPA's `_app` middleware.

Without those, the endpoint is unreachable from a non-browser HTTP client. **Run-phase ANALYZE step is encouraged to inspect actual headers via Playwright XHR interception** to determine whether the endpoint is callable with browser-acquired cookies, or whether it requires additional auth.

### 2.5 display-bff-api.29cm.co.kr (PROBE INCONCLUSIVE)

```
GET https://display-bff-api.29cm.co.kr/   → HTTP 404
GET https://display-bff-api.29cm.co.kr/api/v1/items?categoryLargeCode=268100100   → HTTP 404
GET https://display-bff-api.29cm.co.kr/items/?categoryLargeCode=268100100   → HTTP 404
```

The `display-bff-api` host is referenced extensively in the shop microservice `_app` chunk runtime config but no path probed externally returns a 200 with content. Like `item-api`, this endpoint is likely auth-gated and only callable from within an authenticated SPA session.

### 2.6 Full API host inventory (extracted from shop microservice `_app-e9369400ff561e0a.js`)

The shop microservice runtime config exposes 50+ API hosts. Confirmed via grep on the deobfuscated `_app` chunk:

```
activation-api, apihub, asset, auth-api, auth, bff-api, booking-item-api, cache, claim-api,
cms, commerce-api, content-api, content, cs-customer-bff, cs-support-api, curator-api,
customer-service-api, customer-service, dataplatform-collector, display-bff-api, event,
flag, front-api, gift-api, heart-api, home, img, inbox-api, interaction-collector-api,
item-api, logistics-api, mileage-api, moment-trigger-api, mother, onboarding-api, order-api,
order, partner-api, partner, payment-api, post, product, promotion-api, recommend-api,
review-api, search-api, search, shop, survey-api, ticket, user-api, user-auth-api,
waiting-queue-api, web-log, widget-api, www
```

The relevant subset for catalog browsing is: `apihub` (public navigation API), `search-api` (keyword search, public), `item-api` (auth-gated), `display-bff-api` (auth-gated), `front-api` (probably auth-gated, untested), `recommend-api` (probably auth-gated, untested). The others handle order/payment/auth/CS/CMS concerns and are not relevant.

### 2.7 Next.js RSC payload reverse-engineering (NEGATIVE)

The modern Next.js App Router on `www.29cm.co.kr` was probed for path (b) viability:

```
GET https://www.29cm.co.kr/category/main with header `RSC: 1`
HTTP 200, 51 KB body
[Streamed RSC chunks — 26 of them]

After parsing all 26 self.__next_f.push chunks and concatenating:
  Combined: 90 KB
  itemNo / itemName / productNo / frontBrandNo references: 0
  /product/catalog/ references: 0
  categoryLargeCode references: 0
```

The `/category/main` page is a navigation-only page (top-level category browsing UI); its RSC payload contains no product data.

```
GET https://www.29cm.co.kr/   (home) with header `RSC: 1`
HTTP 200, 200 KB body
After parsing 25 chunks and combined into 186 KB string:
  itemNo / itemName / productNo references: 0
  But unique JSON keys present include: 'frontBrand', 'heartCount', 'reviewCount', 'images',
  'nameKor', 'nameEng', 'sale', 'relatedProducts', 'results', 'imageBadges', 'imageBadges',
  'isSoldOut', 'isBannerTitleHidden'
```

The home RSC payload contains some product-shaped data via `frontBrand`, `heartCount`, `reviewCount` keys — but these come from curated banner/feed components (`bannerImageList`, `relatedProducts`), not full-catalog browsing. The home page's RSC stream is inadequate as a primary data source for SPEC-004's "full Women + Men catalog" goal.

The `/store/category/list?categoryLargeCode=...` page is a Pages Router page that uses `__NEXT_DATA__` (not streaming RSC) and serves only navigation queries (see §1.4). The product list is loaded client-side via React Query.

Path (b) Next.js RSC reverse-engineering is therefore **NOT VIABLE** as a primary engine path. It can be used as a supplementary signal (the home page's curated picks could augment the engine output if needed in a future SPEC), but it cannot drive a full catalog crawl.

### 2.8 Conclusion of API discovery

| Endpoint | Status | Viable for full catalog crawl? |
|---|---|---|
| `apihub.29cm.co.kr/item/category/?category1_code=N` | HTTP 200, public, navigation only | NO (no product items) |
| `search-api.29cm.co.kr/api/v4/products?keyword=N` | HTTP 200, public, keyword search | NO (keyword required, no full-list browsing) |
| `item-api.29cm.co.kr/api/v1/items?...` | HTTP 500 from external client | UNKNOWN (auth-gated; viable only via Playwright session cookies) |
| `display-bff-api.29cm.co.kr/...` | HTTP 404 on all probed paths | UNKNOWN (auth-gated) |
| Next.js RSC payloads (App Router pages) | HTTP 200, navigation only | NO (no full catalog data in RSC) |
| `/store/category/list` Pages Router `__NEXT_DATA__` | HTTP 200, navigation only | NO (no products in initial HTML) |

**No path-(a) external API call returns full-catalog product data without authenticating against the SPA first.** The internal endpoint that the SPA uses (likely `display-bff-api` or `item-api` with cookies) is not reachable from a non-browser client.

This forces SPEC-004 toward path (c) — **Pure Playwright with XHR interception** — mirroring the SPEC-003 ZARA pattern.

---

## §3. Cloudflare Bot Manager Probe

### 3.1 Sequential same-UA test

5 sequential GET requests to `https://www.29cm.co.kr/` with the same `Chrome/131.0.0.0` UA:

| Request | HTTP | Body size | bm-verify or challenge? | Time |
|---|---|---|---|---|
| 1 | 200 | 916 KB | NO | 0.31s |
| 2 | 200 | 925 KB | NO | 0.29s |
| 3 | 200 | 925 KB | NO | 0.26s |
| 4 | 200 | 920 KB | NO | 0.29s |
| 5 | 200 | 920 KB | NO | 0.30s |

All 5 returned full HTML content. **No escalation observed.** Compare to ZARA's Akamai which returned a 2,141-byte bm-verify intercept on every request.

5 sequential GET requests to `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100`:

| Request | HTTP | Body size (after redirect) | Notes |
|---|---|---|---|
| 1 | 200 | 146 KB | OK |
| 2 | 200 | 146 KB | OK |
| 3 | 200 | 146 KB | OK |
| 4 | 200 | 146 KB | OK |
| 5 | 200 | 146 KB | OK |

5 sequential GET requests to `https://search-api.29cm.co.kr/api/v4/products?keyword=shirt`:

| Request | HTTP | Body size | Notes |
|---|---|---|---|
| 1 | 200 | 44 KB | OK |
| 2 | 200 | 44 KB | OK |
| 3 | 200 | 44 KB | OK |
| 4 | 200 | 44 KB | OK |
| 5 | 200 | 44 KB | OK |

**No escalation, no rate-limit, no JS challenge.** Cloudflare's posture for 29CM is: passive bot tracking via `__cf_bm` cookie, no active blocking of normal traffic. This is dramatically more permissive than ZARA's Akamai (active bm-verify on every request) and Inditex's itxrest gateway (server-side reject with `"Your request is blocked, no service match"`).

### 3.2 Implication for engine architecture

Because Cloudflare on 29CM is passive, the engine does NOT need to use Playwright's `channel: "chrome"` (real Google Chrome binary, the workaround SPEC-003 ZARA engine uses to defeat Akamai's bundled-Chromium fingerprint signal). Vanilla `chromium.launch({headless: "new"})` should be sufficient. This is a lower-complexity, lower-risk Playwright configuration than ZARA's.

If a future regression appears (Cloudflare tightens its rules), the engine can be upgraded to `channel: "chrome"` cheaply (single launch-options change). Document this as a fallback in the Run-phase ANALYZE notes but do NOT pre-implement.

### 3.3 Within project HARD constraints

Project HARD rules (CLAUDE.md, SPEC-001 §2.3, SPEC-003 §2.3) explicitly forbid:
- IP rotation / residential proxy networks
- Headless browser fingerprint evasion libraries (`puppeteer-extra-plugin-stealth`, `playwright-stealth`, `undici` with custom JA3)
- Authenticated scraping (login automation, session cookie hijack)
- CAPTCHA solving services

What is permitted within constraints:
- Realistic User-Agent (5-element rotation list shared with Uniqlo/ZARA engines)
- Realistic `viewport`, `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"` Playwright context options
- Sequential XHR interception via `page.on("response")`
- 1-2 sec per category pacing
- Abort-on-3-consecutive-errors with NO retry, NO IP rotation, NO header spoofing
- `channel: "chrome"` IF AND ONLY IF vanilla `headless: "new"` proves unreliable in Run-phase verification (default: vanilla)

The Run-phase engine MUST operate within these constraints. If 29CM's Cloudflare posture changes and active blocking returns, the engine fails-loud (every blocked request goes into `CrawlResult.errors`) and the operator escalates to the project owner.

---

## §4. Engine Recommendation

### 4.1 Path comparison matrix

| Path | Description | Viable? | Reason |
|---|---|---|---|
| (a) | Mobile-API discovery first with realistic UA | **NO** | §2.2-2.6 conclusively show that no public API endpoint returns full-catalog product data. `search-api` is keyword-required (rejecting `keyword=&categoryLargeCode=N`); `item-api` rejects with HTTP 500 from external clients (auth-gated); `display-bff-api` returns 404 on probed paths (also auth-gated). The category-tree endpoint at `apihub` returns navigation only, not products. |
| (b) | Next.js RSC payload reverse-engineering | **NO** | §2.7 shows RSC payloads on the modern App Router pages contain navigation-only data (sub-categories) plus a small number of curated home-page banner picks. The category landing pages use Pages Router `__NEXT_DATA__` with no products in the initial HTML — products are loaded client-side after hydration. There is no static RSC route that surfaces a full category's products. |
| (c) | Pure Playwright + XHR interception | **YES (recommended)** | §3.1 confirms Cloudflare on 29CM is passive — vanilla Playwright `headless: "new"` reaches the category page without challenge. Page hydration triggers XHRs to internal APIs (likely `display-bff-api` or `item-api`) that return rich JSON. `page.on("response")` intercepts those XHRs and gives the engine direct access to the products without DOM scraping. Fallback: programmatic scroll + DOM scrape of `[href^="/product/catalog/"]` + sibling text nodes if XHR shape is unstable. |

### 4.2 Recommendation: Path (c) Pure Playwright with XHR interception

**Reasoning:**

1. Path (a) and (b) are conclusively non-viable based on the §2 probe evidence.
2. Path (c) is the same engine class as the existing ZARA engine (`src/lib/zara-engine.ts`, ~280 LOC, Playwright Chromium with XHR interception). The project already has Playwright in `package.json` (`^1.58.2`), so no new dependency.
3. The existing ZARA engine demonstrates the project's fluency with: Playwright lifecycle, browser/context/page management, `page.on("response")` AJAX interception, selector fallback chains, abort-on-error, image-host whitelist, and ToS clause embedded as a top-of-file comment block. **SPEC-004 reuses this pattern wholesale.**
4. Cloudflare on 29CM is passive (§3.1) — this means SPEC-004 needs LESS Playwright complexity than ZARA: vanilla `headless: "new"` should suffice; no `channel: "chrome"` needed. This makes the engine slightly simpler than ZARA's (no Akamai-bypass dance), but architecturally identical.
5. KRW-native — no FX conversion (29CM sells in KRW, just like Uniqlo KR and ZARA KR).
6. URL pattern is uniform: `https://www.29cm.co.kr/store/category/list?categoryLargeCode={CODE}&sort=RECOMMENDED` for each of 10 hardcoded codes (Women + Men fashion). The engine constructs the URL from the code at runtime, similar to how Uniqlo's engine constructs API URLs from `apiCategoryPaths` entries.

**Architecture summary** (full plan in plan.md §4):
- New file `src/lib/29cm-engine.ts` (~300 LOC) modeled structurally on `zara-engine.ts` with Cloudflare-aware error detection (no bm-verify equivalent; instead detect Cloudflare challenge via `cf-mitigated` header or empty body) instead of Akamai-aware
- New `PlatformType` `"29cm"` in `src/lib/types.ts`
- New optional `SiteConfig.apiCategoryCodes?: number[]` field (numeric codes, distinct from Uniqlo's `apiCategoryPaths: string[]` and ZARA's `categoryUrls: string[]`). The engine builds URLs from these codes at runtime.
- New SiteConfig entry `29cm-kr` in `src/configs/platforms.ts` with hardcoded 10 category codes (Women + Men)
- Dispatch wiring in `src/crawl.ts:runCrawl` and `:probeSite`
- Frozen XHR-snapshot fixture at `tests/fixtures/29cm-products.fixture.json` (captured once via Playwright in the Run phase ANALYZE step)
- Characterization tests at `tests/29cm-engine.test.ts` running the engine's pure parse function against the frozen fixture
- KRW-native — no FX conversion

### 4.3 Choice between vanilla `headless: "new"` and `channel: "chrome"`

ZARA's SPEC-003 engine uses `channel: "chrome"` because Akamai's bm-verify challenge fingerprints bundled Chromium and rejects it. Cloudflare on 29CM does NOT do this (§3.1 confirmed by 5 sequential plain-fetch HTTP 200 results). Therefore SPEC-004 starts with vanilla `headless: "new"`.

Run-phase ANALYZE-step verification: navigate 5 times in a Playwright session to `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100`. Each navigation MUST reach a state where (a) the page contains > 5 KB of HTML, (b) the URL settles at the canonical category-list URL (no Cloudflare challenge redirect), (c) at least one XHR response with `application/json` content-type is intercepted within 15 seconds. If reliability is below 80% (4 of 5), upgrade to `channel: "chrome"`. If still below 80% with `channel: "chrome"`, escalate to the same rollback paths as SPEC-003 §4.3 (Xvfb separate SPEC, or defer entirely).

### 4.4 Rollback paths

If, in the Run phase, vanilla `chromium.launch({headless: "new"})` proves insufficient against 29CM's Cloudflare:

1. **Try `channel: "chrome"`** (SPEC-003 ZARA-style): documented to be more browser-fingerprint-faithful; requires a real Chrome binary in the runtime image but no code-side complexity beyond the launch options. Single LOC change.
2. **Try `headless: false` + Xvfb in CI**: documented to pass active bot walls reliably; requires a new operational dependency (Xvfb in CI image) but no code-side change beyond the launch option. Separate SPEC required.
3. **Defer 29CM per project HARD rule #1**: treat the Cloudflare active-block as a de-facto access denial; mark `29cm-kr` config as `disabled: true`, abandon the engine, escalate to project owner for a B2B partner-API conversation with 29CM (29CM is owned by Musinsa as of 2021, and Musinsa has a partner program — the same B2B path SPEC-001 §Non-Goals identifies for Musinsa itself).

The Run-phase IMPROVE step (after PRESERVE captures the fixture) is the natural decision point.

### 4.5 Sub-brand / sister-platform precedent

29CM is a fashion select-shop, not a sub-brand parent. There are no sub-brands sharing 29CM's infrastructure. However, 29CM is owned by **Musinsa** (acquired 2021). Musinsa itself remains deferred per project HARD rule #1 (verbatim `Disallow: /` for `User-agent: *`, see SPEC-001 §Non-Goals). SPEC-004 is **not a precedent for Musinsa graduation** — Musinsa's robots.txt remains the blocker, and 29CM's permissive robots.txt does NOT carry over to Musinsa.com.

If 29CM and Musinsa change parent corporate policy in the future, that is a separate research and SPEC effort. SPEC-004 does not auto-graduate Musinsa under any condition.

---

## §5. Risk Register

Risks specific to SPEC-004. SPEC-001 risk mitigations (`robots-check` enforcement, abort-on-3-errors, no IP rotation, 5-UA rotation) and SPEC-003 risk mitigations (Playwright lifecycle pattern, ToS clause embedding, fixture-based characterization tests) are inherited.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Cloudflare tightens posture and active-blocks vanilla Playwright** | Low | High | 1. Pacing 2 sec/category (browser overhead alone exceeds 1000 ms; explicit `crawlDelay: 2000` in SiteConfig). 2. Abort-on-3-consecutive-errors fails loud — every block surfaces in `CrawlResult.errors`. 3. No retry, no IP rotation. 4. If a single full crawl run produces >50% of categories aborting, treat as broken (not transient) and invoke rollback path 1 (`channel: "chrome"`) or 2 (Xvfb separate SPEC) from §4.4. |
| **The internal XHR endpoint requires auth that vanilla Playwright doesn't acquire** | Low | High | Plain visit to the page in Playwright should set the `__cf_bm` cookie + any session cookies. Run-phase ANALYZE step inspects `page.on("request")` to confirm what headers the XHR carries; if anything beyond cookies is required (e.g., a JWT injected by the SPA), the engine relies on the SPA's natural injection (Playwright executes the SPA's JS). If even that fails, fallback path: programmatic scroll + DOM extraction of `[href^="/product/catalog/"]` cards. |
| **DOM selectors become stale after a 29CM seasonal redesign (1-2x/year)** | Medium | Medium | Selector fallback chain inside `page.evaluate` (4-6 fallbacks per field, mirroring ZARA's pattern). When all fallbacks fail on a category, abort-on-3-errors triggers and surfaces the failure visibly. Fixture-based characterization tests catch shape drift between fixture-refresh-cadence runs. |
| **Top-level `apiCategoryCodes` list becomes stale after 29CM reorganizes its taxonomy** | Low | Low | Stale codes return 404 or empty (waste 1 page-navigation per stale entry, not a corruption). The empty-category graceful-handling pattern from SPEC-001 REQ-002 carries over. Operator refresh cadence: review code list once per year via the apihub category-tree probe. |
| **ToS clause forbids automated catalog access** | Unknown (unverified at plan phase) | Critical (de-facto deferral) | Run-phase ANALYZE step (REQ-008-equivalent) opens `/home/agreement` in Playwright, captures the rendered ToS text, scans for keywords, embeds verbatim relevant clauses as comment block. If any clause unambiguously forbids, set `disabled: true`, abandon engine, escalate per HARD rule #1. Same pattern as SPEC-003 v0.1.0 (pre-amendment). |
| **`/home/agreement` ToS page fails to render in Playwright (rare CSR edge case)** | Low | Medium | Run-phase ANALYZE step has a 30-second timeout per attempt; on render failure, retry once. If retries fail, fallback: capture the home page footer link to the ToS PDF (if present) and try a direct fetch. If still fails, escalate to operator for manual ToS retrieval (open in real browser, copy-paste). The engine MUST NOT ship without a verified ToS clause. |
| **search-api or apihub endpoints change shape during a long crawl run** | Low | Low | The engine does NOT use search-api or apihub for product data (only for the optional category-tree probe at startup). If those endpoints break, the engine still functions via the Playwright XHR interception path. |
| **Cloudflare cookie expires mid-crawl, mid-XHR returns 403** | Low | Medium | Cookie lifetime is 30 minutes (`expires=2026-05-05 11:43:01` observed in §3.1 probe). A full Women+Men crawl with 10 categories at 2 sec/category + ~10 sec/category for scroll/XHR ≈ 2 minutes. Well within cookie lifetime. If a long-running crawl hits expiration, abort-on-3-errors triggers naturally and the next run starts fresh. |
| **`channel: "chrome"` runtime requires a real Chrome binary that isn't installed** | Low | Medium | Engine starts vanilla. If REQ-007 verification escalates to channel:"chrome", the operator install Chrome via `npx playwright install chrome` (already supported by Playwright's CLI). This is a runtime concern, not a SPEC concern. |
| **Playwright lifecycle is not unit-tested → regressions go undetected until live `--probe`** | Medium | Medium | Acknowledged: the engine's pure parse function is testable against a frozen XHR fixture (same pattern as ZARA); the Playwright lifecycle (browser launch, navigation, scroll, XHR interception) is smoke-tested only via live `--probe` invocation. Operator process: run `pnpm crawl --probe=29cm-kr` after any change to lifecycle code. Captured in acceptance.md AC-7. |

---

## §6. Sources

All URLs fetched 2026-05-05 from project working directory (`/Users/hansangho/Desktop/portal/crawler`):

External probes:
- `https://www.29cm.co.kr/robots.txt` (HTTP 200, full text §1.1)
- `https://www.29cm.co.kr/` (HTTP 200, 916KB Next.js App Router HTML, §3.1)
- `https://www.29cm.co.kr/category/main` (HTTP 200, 134KB navigation page, §1.4)
- `https://www.29cm.co.kr/store/category/list?categoryLargeCode=268100100` (HTTP 307 redirect → HTTP 200 with `&sort=RECOMMENDED&defaultSort=RECOMMENDED`, 144KB Pages Router HTML, §1.4)
- `https://www.29cm.co.kr/product/catalog/2134675` (HTTP 200, 308KB product detail HTML; used to extract structured-data category codes, §1.6)
- `https://www.29cm.co.kr/home/agreement` (HTTP 200, 5KB Angular CSR shell, §1.2)
- `https://www.29cm.co.kr/list/category/268100100` (HTTP 200, 4KB Angular CSR shell)
- `https://search-api.29cm.co.kr/api/v4/products?keyword=shirt` (HTTP 200, ~44KB, full product JSON, §2.2)
- `https://search-api.29cm.co.kr/api/v4/products?keyword=&categoryLargeCode=268100100` (HTTP 200, 64 bytes, empty data array — keyword required, §2.2)
- `https://search-api.29cm.co.kr/api/v4/categories` (HTTP 404, §2.2)
- `https://apihub.29cm.co.kr/item/category/?category1_code=268100100` and 16 sibling code probes (HTTP 200, full category-tree JSON, §1.6 §2.3)
- `https://apihub.29cm.co.kr/notice/?notice_type=AGREEMENT` (HTTP 200, 52 bytes, empty results, §1.2)
- `https://item-api.29cm.co.kr/api/v1/items?categoryLargeCode=268100100` (HTTP 500 with COMMON_SYSTEM_ERROR, §2.4)
- `https://display-bff-api.29cm.co.kr/items/?categoryLargeCode=268100100` and 5 sibling probes (HTTP 404 on all, §2.5)
- 5 sequential probes to `/`, `/store/category/list`, `https://search-api.29cm.co.kr/api/v4/products?keyword=shirt` (all HTTP 200 with no escalation, §3.1)

Static asset / bundle inspection:
- `https://d13fzx7h5ezopb.cloudfront.net/www/prd-4107779/list/main.js` (672 KB legacy Angular SPA bundle for /list/, §1.3)
- `https://d13fzx7h5ezopb.cloudfront.net/www/prd-4107779/home/main.js` (733 KB legacy Angular SPA bundle for /home/, §1.2)
- `https://cdn-resource-microservice.29cm.co.kr/shop/v1/_next/static/chunks/_app-e9369400ff561e0a.js` (2.85 MB modern Next.js Pages Router bundle for shop microservice; full API host inventory extracted, §2.6)
- `https://cdn-resource-microservice.29cm.co.kr/shop/v1/_next/static/chunks/pages/category/list-5b92a4d59f0b0983.js` (16 KB category-list page chunk, no inline API URLs — confirms client-side query lib indirection)
- `https://cdn-resource-microservice.29cm.co.kr/shop/v1/_next/static/chunks/707-76fefd68b9bb6306.js` (73 KB chunk; contains `/item/category/` and `/api/v4/campaigns/head-banners` references, §2.6)
- `https://cdn-resource-microservice.29cm.co.kr/shop/v1/_next/static/chunks/7889-f822c5c321c23ba2.js` (15 KB chunk; contains `getCategoryGroup` and `getCategoryList` methods)
- `https://cdn-resource-microservice.29cm.co.kr/shop/v1/_next/static/chunks/6111-03de1476d4d5a12a.js` (65 KB chunk; contains `categoryLargeCode` URL builder, §1.4)

Internal source files referenced:
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-001/spec.md` §Non-Goals (29CM deferral with user appetite for hybrid path noted)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-001/research.md` §1, §2.4, §3.4 (robots-check pattern; abort-on-3-errors mechanic; engine dispatch surface)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-002/spec.md` (region-parameterization pattern; FX module lift to `src/lib/fx.ts` — out of scope for SPEC-004 since 29CM is KRW-native)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-003/spec.md` (Playwright + XHR interception pattern; ToS clause embedding precedent; abort-on-3 broadened to Playwright failure modes)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-003/research.md` §1.2, §3, §4 (ToS verification methodology; Playwright-bypass test framework; rollback paths)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-003/plan.md` §4-§6 (file modification table template; reference implementations; tech stack inheritance)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/zara-engine.ts` (Playwright + XHR interception template — full pattern reused)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/uniqlo-engine.ts` (5-element UA rotation list, image-host whitelist, abort-on-3 mechanic, pure parse function pattern)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/robots-check.ts` (REQ-005 reuse — engine-agnostic, no modification needed)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/types.ts:53` (PlatformType union, currently `"cafe24" | "shopify" | "uniqlo" | "zara"` per SPEC-003)
- `/Users/hansangho/Desktop/portal/crawler/src/configs/platforms.ts` (SiteConfig entries; `apiCategoryPaths` and `categoryUrls` field precedents)
- `/Users/hansangho/Desktop/portal/crawler/src/crawl.ts` (dispatch + probe wiring template)
- `/Users/hansangho/Desktop/portal/crawler/.moai/project/structure.md` (platform table — currently 35 platforms; SPEC-004 grows to 36)
- `/Users/hansangho/Desktop/portal/crawler/.moai/project/product.md` (32-platform original target → 36 post-SPEC-004)
- `/Users/hansangho/Desktop/portal/crawler/.moai/project/tech.md` (Playwright `^1.58.2` already in deps, `node:test` runner already configured by SPEC-001)
- `/Users/hansangho/Desktop/portal/crawler/package.json` (test script `node --test --import tsx ./tests/*.test.ts` — reused for 29CM tests)

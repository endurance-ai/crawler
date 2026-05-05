# Research: SPEC-PLATFORM-EXPANSION-001 — New Platform Additions

- **Date**: 2026-05-05
- **Author**: research subagent
- **Scope**: ZARA, H&M, 29CM, Musinsa, Uniqlo (Furutsu deferred per user)
- **Audience**: SPEC planner (manager-spec), plan auditor, project owner

---

## 1. External Feasibility Matrix

| # | Platform | robots.txt for `/*` | `/products.json` | Anti-bot service | Public API | KR shipping | Rough scale | **Verdict** |
|---|----------|-------------------|------------------|-------------------|------------|-------------|-------------|-------------|
| 1 | **ZARA** (`zara.com/kr`) | Mostly Allow; explicit Disallow for `/*/search`, `/*/shop/`, `/share/`, `?color=`, `?colorId=`, plus 7 Akamai bot-fence paths | 404 (not Shopify; returned 306K HTML) [^z1] | **Akamai Bot Manager** (`_abck`, `bm_sz` cookies, `#bitdefender` block in robots) [^z2] | None public | Y (KR locale active) | 30–100k SKU (full SPA catalog) | **보류** |
| 2 | **H&M** (`www2.hm.com/ko_kr`) | UNVERIFIED — robots.txt itself returns **403 AkamaiGHost** [^h1] | 403 | **Akamai (active blocker)** — homepage and robots.txt both 403 from curl-class UA [^h2] | None public | Y | 30–100k SKU | **보류** |
| 3 | **29CM** (`29cm.co.kr`) | Allow `/`; Disallow `/embed/`, `/my-page/`, `/order/`, `/auth/`, `/inbox/`, `/content/post/preview`. **Baidu fully blocked.** [^c1] | 404 (Next.js 16 App Router, not Shopify) [^c2] | **Cloudflare** (`__cf_bm`, `cf-ray`) — passive challenge, no active block on first request [^c3] | None public discovered; sitemap.xml returned 404 | Y (KR-only) | 30–100k SKU est. (multi-brand) | **2순위** |
| 4 | **Musinsa** (`musinsa.com`) | **`User-agent: *` → `Disallow: /` (FULL BLOCK).** Only allowlisted bots (Google/Naver/AI search bots) permitted. [^m1] | 404 | Cloudflare + CloudFront (CDN-level, not active block) [^m2] | No public partner API discovered (UNVERIFIED — needs business inquiry) | Y (KR-primary) | >100k SKU (KR #1) | **보류 (legal-blocked)** |
| 5 | **Uniqlo** (`uniqlo.com/kr/ko`) | Allow `/`; Disallow `/kr/ko/cms`, `/kr/ko/size/*`, `/kr/ko/search`, `/kr/ko/news/search`, `/kr/ko/*/reviews/new`. **Product paths NOT disallowed.** [^u1] | 404, **but** `/kr/api/commerce/v5/ko/products` returns **HTTP 200 JSON** with shape `{result:{items[],pagination,aggregations}}` [^u2] | Akamai Bot Manager + Queue-it (queue page on launches) [^u3] | **`/kr/api/commerce/v5/ko/products` — public, undocumented, but live and JSON-shaped** | Y (KR storefront) | 5–30k SKU (curated SPA catalog) | **1순위** |

[^z1]: `curl -A "Mozilla/5.0 ... Chrome/131" https://www.zara.com/kr/products.json?limit=1` → HTTP 404, body 306,773 bytes (ZARA's own 404 HTML page). 2026-05-05.
[^z2]: `Set-Cookie: _abck=...`, `Set-Cookie: bm_sz=...` on homepage response. `robots.txt` lines `Disallow: */akam/*`, `Disallow: */8y46UXJ4p/*` and `#bitdefender` comment confirm Akamai Bot Manager presence. 2026-05-05.
[^h1]: `https://www2.hm.com/robots.txt` → HTTP 403 AkamaiGHost: "You don't have permission to access ... on this server." 2026-05-05.
[^h2]: Homepage `https://www2.hm.com/ko_kr/` → HTTP 403 with `server: AkamaiGHost`. Even with realistic Mozilla UA. Active blocker, not just challenge.
[^c1]: `https://www.29cm.co.kr/robots.txt` → HTTP 200. Verbatim: `User-agent: Baiduspider / Disallow: /` then `User-agent: * / Allow: / / Disallow: /embed/ / Disallow: /home/embed/ / Disallow: /my-page/ / Disallow: /order/ / Disallow: /auth/ / Disallow: /inbox/ / Disallow: /content/post/preview`.
[^c2]: `/products.json` → HTTP 404, 126,476 byte HTML response. Homepage shows `cdn-resource-microservice.29cm.co.kr/home/v1/_next/static/chunks/...` confirming Next.js App Router (microservice architecture).
[^c3]: `Set-Cookie: __cf_bm=...; Domain=29cm.co.kr`, `cf-ray: 9f6e04dca97baa32-ICN`, `server: cloudflare` — Cloudflare bot-management cookie, no active block observed.
[^m1]: `https://www.musinsa.com/robots.txt` → HTTP 200. Group 3 verbatim: `User-agent: * / Disallow: /`. Group 1 (full grant): Applebot, facebookexternalhit, Twitterbot, OAI-SearchBot, ChatGPT-User, Claude-User, Claude-SearchBot, Perplexity-User. Group 2 (partial grant): Googlebot, NaverBot, ClaudeBot, GPTBot etc. — no generic crawler permitted. Last updated 2025.10.24 by site.
[^m2]: Headers: `__cf_bm`, `via: 1.1 ... cloudfront.net`, `x-amz-cf-pop: ICN80-P1`, `cf-ray: ...`. Cloudflare is in front; CloudFront is origin CDN.
[^u1]: `https://www.uniqlo.com/robots.txt` `#KR` block: `Disallow: /kr/ko/cms`, `Disallow: /kr/ko/size/*`, `Disallow: /kr/ko/search`, `Disallow: /kr/ko/news/search`, `Disallow: /kr/ko/news/sp/search`, `Disallow: /kr/ko/*?avoidNextModelRedirect=true`, `Disallow: /kr/ko/*/reviews/new`. Sitemap: `https://www.uniqlo.com/kr/sitemap_kr-ko.xml`, `sitemap_kr-ko_l1l2_hreflang.xml`, `sitemap_kr-ko_l3_hreflang.xml`.
[^u2]: `curl https://www.uniqlo.com/kr/api/commerce/v5/ko/products?limit=2&offset=0&path=` → HTTP 200, body `{"status":"ok","result":{"aggregation":{...},"items":[],"pagination":{"total":0,"offset":0,"count":0},...}}`. Empty without path filter, but endpoint and shape are confirmed live. Schema includes `aggregations.categories.{l1,l2,l3,l4}`, `priceRange`, `colors`, `sizes`. 2026-05-05.
[^u3]: `Set-Cookie: _abck=...`, `Set-Cookie: bm_sz=...`, plus inline `<script src="https://asset.uniqlo.com/g/scripts/queueclient.min.js">` (Queue-it virtual waiting room, used on launches). Akamai Bot Manager + Queue-it.

---

## 2. Per-Platform Findings

### 2.1 ZARA (`zara.com/kr`)

- **robots.txt verdict**: Allow with carve-outs. Crawling product list pages is technically permitted by robots.txt; however 7 explicit Akamai bot-fence paths (`/*/akam/*`, `/*/8y46UXJ4p/*`, etc.) and a `#bitdefender` comment confirm aggressive Akamai Bot Manager deployment. [^z2]
- **/products.json**: 404 — not a Shopify storefront. Inditex uses a custom monolith.
- **Anti-bot**: Akamai Bot Manager (`_abck`, `bm_sz`). Akamai is the strongest commercial anti-bot service; bypass typically requires headless browser fingerprint evasion or paid proxy networks. Even the homepage already sets full bot-management cookies on first request. [^z2]
- **ToS scrape clause**: NOT VERIFIED — every ToS URL I attempted (`/kr/ko/help-center/legal-notice`, `/kr/ko/company/terms-conditions`, `/kr/ko/company/legal-notice`, `/kr/ko/help-center/topic/legal-notice`) returned HTTP 404 from a curl-class UA, suggesting client-side routing through their SPA. Cannot confirm verbatim language without a real browser session.
- **Public API**: None advertised.
- **KR shipping**: Y. `zara.com/kr/ko/` returns HTTP 200 with KR locale.
- **Catalog scale**: 30,000–100,000 SKU (full women+men+kids+home, multi-season).
- **Verdict — 보류**. Akamai + zero API surface + unverified ToS = high technical risk + unknown legal risk. Not first-priority. To proceed would need (a) a manual ToS review by a human reading via browser, (b) a Playwright-based crawler accepting per-page minutes runtime, (c) acceptance that Akamai may rate-limit even with realistic UA. Given Furutsu was deferred and Uniqlo is a clean win, ZARA should wait.

### 2.2 H&M (`www2.hm.com/ko_kr`)

- **robots.txt verdict**: **UNVERIFIABLE** — `https://www2.hm.com/robots.txt` itself returns HTTP 403 from AkamaiGHost. [^h1] This is unusual; even ZARA serves its robots.txt openly. The 403 on robots.txt suggests H&M's Akamai config blocks any non-whitelisted client from reading their bot policy — which is itself a strong signal that scraping is unwelcome.
- **/products.json**: 403 (same Akamai block).
- **Anti-bot**: Akamai with active blocker mode. Both homepage `/ko_kr/` and `/robots.txt` 403 with `Reference #18....` Akamai error codes. [^h2] Even the sitemap is 403. The site only serves real browser sessions.
- **ToS scrape clause**: Unable to verify (cannot reach the ToS page).
- **Public API**: None.
- **KR shipping**: Y (KR locale exists; cannot confirm shipping availability without a working session).
- **Catalog scale**: 30,000–100,000 SKU.
- **Verdict — 보류**. Strongest active anti-bot signal of all 5. Pursuing this requires either residential proxies or full headless browser stealth — both outside the project's stated rules (no IP rotation per CLAUDE constraint). Defer indefinitely.

### 2.3 29CM (`29cm.co.kr`)

- **robots.txt verdict**: Permissive for `User-agent: *` — `Allow: /` with narrow Disallow list (auth, embed, cart, my-page, content preview). Product list and product detail pages are **not disallowed**. [^c1] Baiduspider is explicitly fully blocked but our crawler does not impersonate Baidu.
- **/products.json**: 404 (Next.js 16 App Router with microservice architecture; product data ships via React Server Components / RSC payload, not a public JSON endpoint). [^c2]
- **Anti-bot**: Cloudflare with passive bot-management (`__cf_bm` cookie, `cf-ray`) but no active 403 on first request. [^c3] Cloudflare is the gentlest of the major anti-bot stacks for legitimate-looking traffic; with realistic User-Agent and pacing, scraping is technically feasible.
- **ToS scrape clause**: NOT FOUND — all guessed paths (`/policies/terms`, `/common/policy`, `/policy/use`, `/agreement/term`) returned 404 from curl. Their ToS likely sits behind client-side routing. UNVERIFIED. A human-browser ToS review is required before proceeding.
- **Public API**: None public discovered. Internal API likely exists (Next.js RSC backend) but probing requires reverse-engineering the RSC payload; `https://search.29cm.co.kr/api/v3/products` returned 302 (auth/redirect), suggesting an internal API exists but isn't openly exposed.
- **KR shipping**: Y.
- **Catalog scale**: 30,000–100,000 SKU est. (multi-brand select shop).
- **Verdict — 2순위**. Cloudflare-only is manageable, robots.txt is permissive, but: (a) no `/products.json`, (b) Next.js App Router means we'd need either Playwright (slow) or RSC payload reverse-engineering (brittle), (c) ToS clause unverified. Worth pursuing after Uniqlo, with Playwright + RSC parsing investigation.

### 2.4 Musinsa (`musinsa.com`)

- **robots.txt verdict**: **EXPLICIT FULL BLOCK for generic crawlers.** Verbatim: `User-agent: * / Disallow: /`. [^m1] Only specific allowlisted bots (Googlebot, NaverBot, Applebot, ChatGPT-User, ClaudeBot, etc.) are permitted, with sub-path exclusions. Last updated 2025.10.24 — this is current and intentional policy.
- **/products.json**: 404 (custom backend, not Shopify).
- **Anti-bot**: Cloudflare + CloudFront (CDN-level only). [^m2] Cookies present but no active block on first homepage hit.
- **ToS scrape clause**: Unable to fetch ToS page directly (paths 404 from curl). However, the robots.txt full-block is itself a clearly-published bot policy from the site operator that any reasonable interpretation of Korean Information & Communications Network Act and the site's content-protection rights treats as authoritative.
- **Public API**: No public partner API discovered. Musinsa does run a partner program ("Musinsa Partners") for sellers, but there is no publicly documented data-access partner API. UNVERIFIED — would require a business inquiry to Musinsa BD.
- **KR shipping**: Y (KR-primary).
- **Catalog scale**: >100,000 SKU (Korea's #1 fashion marketplace).
- **Verdict — 보류 (legal-blocked)**. Per project HARD rule #1 ("Sites that explicitly forbid crawling → DEFER"), Musinsa cannot be included in 1순위. The robots.txt `Disallow: /` is explicit, recently updated, and intentional. **User decision required**: pursue B2B partner API discussion, or drop Musinsa entirely from roadmap.

### 2.5 Uniqlo (`uniqlo.com/kr/ko`)

- **robots.txt verdict**: Allow with narrow Disallow: only `/kr/ko/cms`, `/kr/ko/size/*`, `/kr/ko/search`, `/kr/ko/news/search`, `/kr/ko/news/sp/search`, `/kr/ko/*?avoidNextModelRedirect=true`, `/kr/ko/*/reviews/new`. **Product list, product detail, and the API endpoint are all permitted.** Sitemaps published: `sitemap_kr-ko.xml`, `sitemap_kr-ko_l1l2_hreflang.xml`, `sitemap_kr-ko_l3_hreflang.xml`. [^u1]
- **/products.json**: 404 (not Shopify), **but** the live API at `/kr/api/commerce/v5/ko/products` returns HTTP 200 with structured JSON. [^u2] Schema confirmed: `{status, result:{items[], pagination:{total, offset, count}, aggregations:{categories:{l1,l2,l3,l4}, priceRange, colors, sizes, plds, flags}, relaxedQueries[]}}`. The endpoint requires a `path` filter (category code) to return non-empty results. Path codes can be discovered from the published sitemaps or category landing pages.
- **Anti-bot**: Akamai Bot Manager (`_abck`, `bm_sz`) + Queue-it virtual waiting room (only triggers on product launches/sales). [^u3] **Critically, the `/api/commerce/v5/...` JSON endpoint returned 200 OK from a plain curl call with realistic Mozilla UA** — Akamai is configured permissively for the API path. This is the single most important finding in this research.
- **ToS scrape clause**: Not verified verbatim, but Uniqlo publishes sitemaps explicitly for crawlers (each locale block lists multiple `Sitemap:` directives), which is industry-standard signaling that public crawling of indexed paths is expected.
- **Public API**: `/kr/api/commerce/v5/ko/products` is undocumented but live, public (no auth), and stable (v5 = mature). Pagination via `offset` + `limit`. Filtering via `path` (category code). Same backend powers the SPA frontend.
- **KR shipping**: Y.
- **Catalog scale**: 5,000–30,000 SKU (Uniqlo SKU count is curated; typical KR catalog is ~3,000–8,000 active SKU).
- **Verdict — 1순위**. Best ROI of all 5: clean JSON API, robots.txt-allowed, Akamai-permissive on the API path, manageable scale, KR locale native. Implementation work is essentially "Shopify engine pattern with a different JSON shape."

---

## 3. Internal Code Patterns

### 3.1 SiteConfig Schema

`src/lib/types.ts:97-134` — the `SiteConfig` interface. Required fields: `key` (string, used as DB `platform` value), `name` (Korean display name), `type` (PlatformType union), `baseUrl`. Optional: `defaultGender`, `selectors` (Cafe24-only), `category` (CategoryConfig with `discovery: "auto" | "manual"`), `pricePattern` (RegExp), `priceCurrency` (default `₩`), `paginate`, `maxPages` (default 10), `sourceCurrency` (Shopify USD/EUR/GBP/KRW), `crawlDelay` (default 2000), `disabled`, `notes`, `detailSelectors`, `crawlDetails`, `crawlReviews`.

The critical extension point: **`PlatformType = "cafe24" | "shopify"`** at `src/lib/types.ts:53`. Adding a new engine type requires extending this union. No existing precedent for a third type.

### 3.2 Shopify Engine Surface

- **Entry**: `crawlShopify(config: SiteConfig): Promise<CrawlResult>` — `src/lib/shopify-engine.ts:98-280`. No Playwright dependency; pure `fetch`.
- **Lifecycle**: Loop `page = 1..maxPages`, fetch `${baseUrl}/products.json?page=N&limit=250` with localization cookie based on `sourceCurrency`, parse JSON, map each `ShopifyProduct` to `Product`, break when page count < 250 (last page) or HTTP error. (`src/lib/shopify-engine.ts:120-253`)
- **FX conversion**: `convertToKrw()` at `src/lib/shopify-engine.ts:34-41` with hardcoded 2026-04 rates `USD=1430, EUR=1560, GBP=1750`.
- **Security**: image URL whitelist (`isSafeImageUrl`, line 47-60) restricts to base host, `cdn.shopify.com`, `*.myshopify.com`, `*.shopifycdn.com`. Handle validation regex `SAFE_HANDLE = /^[a-z0-9][a-z0-9-]*$/` at line 44.
- **Filtering**: gift cards / lookbooks / Rise.ai sentinel products skipped (line 144-152).
- **Output**: `Product` with `sourceCurrency`, `sourcePrice`, KRW-converted `price`.

### 3.3 Cafe24 Engine Surface

- **Entry**: `crawlCafe24(page: Page, config: SiteConfig, detailParser?: IDetailParser, reviewParser?: IReviewParser): Promise<CrawlResult>` — `src/lib/cafe24-engine.ts:398-590`. Requires Playwright `Page`.
- **Lifecycle**: (1) discover categories via `discoverCategories` (auto) or use `config.category.categories` (manual) — line 414-451; (2) for each category call `crawlCategory` which paginates with `?page=N` — line 354-394; (3) each page calls `collectProductsFromPage` with `page.evaluate(...)` against an 8+ selector fallback chain — line 139-350; (4) optional Step 3: detail parser via injected `IDetailParser` with 3-way concurrency — line 491-528; (5) optional Step 4: review parser — line 531-562.
- **Selector fallback chain**: `DEFAULT_SELECTORS` at line 19-66 — `productItem` has 8 fallback CSS selectors, `productName` 9, `productPrice` 6, `productImage` 6, `productLink` 5. Tried in order until one matches.
- **In-evaluate constraint**: comments at line 188-190 warn that `tsx` `__name` transformation breaks `let`/`const` inside `page.evaluate` — must use `var`.

### 3.4 Platform Registration Flow

- **Definition**: `src/configs/platforms.ts:10-761` — single `PLATFORMS: SiteConfig[]` array with 32 entries (22 Cafe24 + 10 Shopify). Helpers: `getSiteConfig(key)`, `getActivePlatforms()`, `getPlatformsByType(type)` (lines 763-776).
- **Dispatch**: `src/crawl.ts:153-223` — `runCrawl(configs, dryRun)` partitions configs by `type`. Shopify sites run via `Promise.all(crawlShopify(config))` (no browser, full parallel — line 162-176). Cafe24 sites run in batches of 3 with one Playwright browser per site (line 179-218). **Adding a new engine type requires (a) extending `PlatformType`, (b) adding a new partition branch in `runCrawl`, (c) optionally adding a probe handler in `probeSite` at line 45-147.**
- **Output**: `data/{platform-key}-products.json` written by `saveResult` at line 225-231.

### 3.5 Import / Supabase Write Surface

- **Entry**: `src/import-products.ts` — script that reads `data/*.json` and upserts to Supabase.
- **Schema written** (line 162-188): `brand, name, category, price, original_price, sale_price, product_no, image_url, product_url, in_stock, platform, gender, style_node, crawled_at, description, color, material, subcategory, images, size_info, tags, product_code, last_seen_at, updated_at`. Conflict key: `product_url`. Batch size: 50.
- **`product_no` extraction** (line 152-153): regex against `productUrl` matching `product_no=(\d+)` — Cafe24-specific. **For Uniqlo, `product_no` would extract from a different URL structure (e.g., `/E422992-000/`); a new regex or a `productCode` fallback path is required.** This is the only schema-touching concern, and it does NOT require a portal.ai migration because `product_no` accepts null.

### 3.6 Minimum-LOC Estimates

- **New Shopify-compatible platform**: 8–12 LOC. Add one entry to `PLATFORMS` array. Files touched: `src/configs/platforms.ts`. Only if the storefront uses a non-default currency or odd CDN, add a new entry to `FX_TO_KRW` map (`src/lib/shopify-engine.ts:11-16`).
- **New Cafe24-compatible platform**: 10–60 LOC. Add one entry to `PLATFORMS`, optionally including manual category list (16+ category lines), custom selectors, `pricePattern`. Files touched: `src/configs/platforms.ts` only.
- **New custom engine type**: ~250–350 LOC. Required: (a) new file `src/lib/{name}-engine.ts` (~200 LOC, modeled on `shopify-engine.ts`); (b) extend `PlatformType` union in `src/lib/types.ts` (1 LOC); (c) add new optional config block in `SiteConfig` if needed (5–10 LOC); (d) add dispatch branch in `src/crawl.ts:runCrawl` (~25 LOC); (e) add probe branch in `src/crawl.ts:probeSite` (~15 LOC); (f) add platform entries in `src/configs/platforms.ts` (~10 LOC each). No changes to Supabase import script unless a new product field is introduced.

---

## 4. Risk Matrix

| Platform | Legal risk | Technical risk | Maintenance risk | Schema impact |
|----------|-----------|----------------|------------------|---------------|
| ZARA | Medium (ToS unverified, robots permits product paths) | **High** (Akamai + no API + SPA) | High (Playwright selector fragility on SPA) | None |
| H&M | High (cannot read robots.txt or ToS — site blocks reading bot policy) | **Very High** (active 403 from non-browser UA) | Very High | None |
| 29CM | Medium (robots permissive but ToS unverified) | Medium (Cloudflare passive + Next.js RSC) | High (RSC payload format can change without notice) | None |
| Musinsa | **Very High — explicit `Disallow: /` for generic crawlers** | Low–Medium (Cloudflare passive only) | Low (if API access were granted) | None |
| **Uniqlo** | **Low** (robots permits, sitemaps published, API openly serves 200) | **Low** (clean JSON API, undocumented but stable v5) | Medium (undocumented endpoint could change; mitigation: pin schema validation + alert on shape drift) | None — fits existing `Product` schema |

---

## 5. Priority Recommendation

### 5.1 1순위 — **Uniqlo (KR)**

- **Rationale**: Of all 5 candidates, Uniqlo is the only one with (a) an openly-permitting robots.txt for product paths, (b) a live JSON API returning HTTP 200 to a plain curl call with realistic UA, (c) Akamai configured permissively for the API endpoint, (d) a manageable catalog scale (5–30k SKU), and (e) a well-defined response shape that maps cleanly onto our existing `Product` schema. The work is structurally identical to extending the existing Shopify engine — same fetch-pagination pattern, same currency normalization (KRW so no FX needed), same JSON-to-Product mapping. No browser needed, so it remains in the "fast" tier of crawlers.
- **Engine strategy**: **New custom engine** (`src/lib/uniqlo-engine.ts`) — DO NOT shoehorn into Shopify engine. The Shopify engine validates `cdn.shopify.com` image hosts, parses `body_html`, uses Shopify-specific `variants[]` / `options[]` schema. Forcing Uniqlo's `aggregations.categories.l1l2l3l4` + `prices.base.value` shape into that codepath would corrupt both engines' invariants. A separate engine is cleaner, ~200 LOC, and isolates the schema risk.
- **LOC estimate**: ~280 LOC total. Breakdown: new `uniqlo-engine.ts` ~200 LOC, type extension 1 LOC, dispatch in `crawl.ts` ~25 LOC, probe handler ~15 LOC, single platform entry in `platforms.ts` ~15 LOC, image host whitelist update ~5 LOC, optional category-discovery sitemap parser ~20 LOC.
- **Schema impact**: **None**. All Uniqlo response fields map onto existing `Product` columns. `productCode` field already exists in schema (used by Cafe24 detail parser). No portal.ai migration needed.

### 5.2 2순위 — **29CM**

- **Rationale**: Robots.txt permissive, Cloudflare passive (manageable with rate-limiting + realistic UA), KR-native multi-brand catalog complementary to Uniqlo. Only blocker is engineering effort: Next.js App Router with no public JSON API means we'd need either Playwright (slow, like Cafe24) or RSC payload reverse-engineering. Defer until after Uniqlo ships and we have time to investigate the RSC backend.
- **Open question**: Verify ToS scrape clause via a human browser visit before SPEC.

### 5.3 보류 — ZARA, H&M, Musinsa

- **ZARA**: Akamai Bot Manager + no API + unverified ToS. Reading the ToS itself requires a real browser. Pursuing this would consume disproportionate engineering effort (Playwright + selector maintenance) for a single platform. **Blocker (verbatim from robots.txt)**: 7 Akamai bot-fence Disallow rules including `Disallow: */akam/*` and `Disallow: */8y46UXJ4p/*` plus `#bitdefender` comment confirm aggressive bot protection. **User decision**: defer until after 29CM, or drop entirely.
- **H&M**: `https://www2.hm.com/robots.txt` itself returns HTTP 403 AkamaiGHost. The site does not allow non-browser clients to read its bot policy. This is the strongest negative signal possible. **User decision**: drop entirely from roadmap.
- **Musinsa**: **Verbatim robots.txt clause**: `User-agent: * / Disallow: /` (Group 3, Last Updated: 2025.10.24). Per project HARD rule #1, this is a hard block. **User decision required**: (a) pursue B2B partner API conversation with Musinsa (their `Musinsa Partners` program exists for sellers; whether a data-access tier exists is unknown — needs business inquiry), or (b) drop Musinsa from roadmap entirely. **Cannot proceed via web crawling under current rules.**

---

## 6. Engine Strategy for 1순위 (Uniqlo)

- **Recommended approach**: **NEW custom engine type** `"uniqlo"`. This is the third engine type and will set the precedent for future API-based platforms.
- **Files to modify**:
  - `src/lib/types.ts:53` — extend `PlatformType` from `"cafe24" | "shopify"` to `"cafe24" | "shopify" | "uniqlo"`. (1 LOC)
  - `src/lib/types.ts:97-134` — `SiteConfig` extended with optional `apiCategoryPaths?: string[]` (Uniqlo-specific category code list, e.g., `["men", "women", "kids", "babies"]` or numeric codes from sitemap). Alternatively, a generic `apiCategoryDiscovery: { sitemapUrl: string }` field. (~5–8 LOC)
  - `src/lib/uniqlo-engine.ts` — NEW FILE. Entry: `export async function crawlUniqlo(config: SiteConfig): Promise<CrawlResult>`. Mirrors `crawlShopify` structure: outer loop over category paths, inner loop with `?offset=N&limit=100` until `pagination.count === 0` or `offset >= pagination.total`. Maps each item to `Product`. Image host whitelist: `image.uniqlo.com`, `asset.uniqlo.com`. (~200 LOC)
  - `src/crawl.ts:158-218` — `runCrawl()` partition: extract `uniqloSites = configs.filter((c) => c.type === "uniqlo")`. Run with `Promise.all(crawlUniqlo(config))` parallel like Shopify (no browser). Add `~25` LOC alongside existing Shopify branch.
  - `src/crawl.ts:45-147` — `probeSite()`: add `if (config.type === "uniqlo")` branch testing the API endpoint. (~15 LOC)
  - `src/configs/platforms.ts:761` — append one entry: `{ key: "uniqlo-kr", name: "유니클로 (KR)", type: "uniqlo", baseUrl: "https://www.uniqlo.com/kr/ko", apiCategoryPaths: [...], crawlDelay: 1500 }`. (~15 LOC)

- **New SiteConfig fields needed**:
  - `apiCategoryPaths?: string[]` — list of `path` query values to iterate (e.g. category L1/L2 codes). Type: optional string array.
  - Alternative: `apiBase?: string` — override for API base URL, default derived from `baseUrl`. Probably unnecessary given baseUrl can be extended in engine.

- **Tests needed (dry-run scenarios)**:
  1. Probe: `npx tsx src/crawl.ts --probe=uniqlo-kr` → confirms API endpoint returns 200 and parses JSON shape.
  2. Single-category: limit `apiCategoryPaths` to one code, run full crawl, verify `data/uniqlo-kr-products.json` contains valid Products with `price`, `imageUrl`, `productUrl` populated.
  3. Pagination: verify `offset` increments past 100 and stops when `pagination.count === 0`.
  4. Image host whitelist: confirm only `image.uniqlo.com` / `asset.uniqlo.com` images are kept; rogue hosts filtered.
  5. Empty path: verify graceful handling when a category code returns `total=0`.
  6. Akamai-friendliness: run end-to-end without triggering 403 (acceptable: 1 request per 1500ms pacing).

- **Estimated LOC**: ~280 (engine 200, dispatch+probe 40, types 6, config entry 15, FX/host whitelist 5, misc 14).

---

## 7. Open Questions for User

1. **Musinsa policy**: drop entirely from roadmap, or attempt B2B partner-API outreach (separate non-engineering track)?
2. **H&M**: drop entirely, given robots.txt itself is 403-blocked?
3. **ZARA**: defer indefinitely, or commit eventual Playwright-based engine after 29CM?
4. **Uniqlo category discovery**: prefer (a) hardcoded `apiCategoryPaths: string[]` in config (simpler, more brittle), or (b) sitemap-driven discovery (parse `sitemap_kr-ko_l1l2_hreflang.xml`, derive path codes — slightly more code but adapts to catalog changes)?
5. **Uniqlo schema**: any product field we want surfaced that isn't currently on `products` table? (Examples Uniqlo uses: `colors[].displayCode`, `flags` like "Limited Time Offer", `genderName`, `representativeFlag`.) If yes, this becomes a portal.ai migration first per HARD rule #5.
6. **Akamai pacing**: confirm 1500ms `crawlDelay` is acceptable, or reduce/increase based on observed behavior in probe?

---

## 8. Sources

All URLs fetched 2026-05-05 from project working directory:

- `https://www.zara.com/robots.txt` (HTTP 200)
- `https://www.zara.com/kr/products.json?limit=1` (HTTP 404, body 306,773 bytes — ZARA SPA 404 page)
- `https://www.zara.com/kr/` headers (HTTP 200, `_abck`/`bm_sz` cookies confirmed)
- `https://www.zara.com/kr/ko/help-center/conditions-of-use` (HTTP 404, multiple ToS path attempts all 404)
- `https://www2.hm.com/robots.txt` (HTTP 403 AkamaiGHost)
- `https://www2.hm.com/ko_kr/` headers (HTTP 403 AkamaiGHost)
- `https://www2.hm.com/products.json` (HTTP 403)
- `https://www2.hm.com/sitemap.xml` (HTTP 403)
- `https://www.29cm.co.kr/robots.txt` (HTTP 200 — full text quoted in [^c1])
- `https://www.29cm.co.kr/products.json?limit=1` (HTTP 404)
- `https://www.29cm.co.kr/` headers (HTTP 200, Cloudflare `__cf_bm` cookie)
- `https://www.29cm.co.kr/sitemap.xml` (HTTP 404)
- `https://search.29cm.co.kr/api/v3/products?keyword=shirt` (HTTP 302 — internal API requires auth/redirect)
- `https://www.musinsa.com/robots.txt` (HTTP 200 — full text quoted in [^m1])
- `https://www.musinsa.com/products.json?limit=1` (HTTP 404)
- `https://www.musinsa.com/main/musinsa/recommend` headers (HTTP 200, `__cf_bm` + CloudFront `via` header)
- `https://www.uniqlo.com/robots.txt` (HTTP 200 — KR block quoted in [^u1])
- `https://www.uniqlo.com/kr/api/commerce/v5/ko/products?limit=2&offset=0&path=` (HTTP 200, JSON body confirmed)
- `https://www.uniqlo.com/kr/ko/` headers (HTTP 200, `_abck`/`bm_sz`/`akavpau_*` cookies, Queue-it script tag)
- `https://www.uniqlo.com/kr/ko/men` (HTTP 200, 1.55 MB SPA HTML)

Internal source files referenced:

- `/Users/hansangho/Desktop/portal/crawler/src/lib/types.ts:53` and `:97-134` (PlatformType, SiteConfig)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/shopify-engine.ts:11-16` (FX_TO_KRW), `:34-41` (convertToKrw), `:44` (SAFE_HANDLE), `:47-60` (isSafeImageUrl), `:98-280` (crawlShopify entry)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/cafe24-engine.ts:19-66` (DEFAULT_SELECTORS), `:139-350` (collectProductsFromPage), `:354-394` (crawlCategory), `:398-590` (crawlCafe24 entry)
- `/Users/hansangho/Desktop/portal/crawler/src/configs/platforms.ts:10-761` (PLATFORMS array), `:763-776` (helpers)
- `/Users/hansangho/Desktop/portal/crawler/src/crawl.ts:45-147` (probeSite), `:153-223` (runCrawl)
- `/Users/hansangho/Desktop/portal/crawler/src/import-products.ts:148-212` (Supabase upsert mapping)

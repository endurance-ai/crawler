# Research: SPEC-PLATFORM-EXPANSION-005 — ZARA (US) Storefront via Region-Parameterized Engine

- **Date**: 2026-05-06
- **Author**: manager-spec subagent
- **Scope**: ZARA US storefront only (`zara.com/us/en`). Women + Men full fashion catalog. Kids/Baby out of scope. Other regions (ES, EU, UK, JP, AU, etc.) out of scope.
- **Audience**: SPEC planner, plan auditor, project owner
- **Trigger**: Post-merge of SPEC-PLATFORM-EXPANSION-003 (ZARA KR, commit `68a448a` — engine production-shipped) and SPEC-PLATFORM-EXPANSION-004 (29CM KR, commit `c55adc1` — second Playwright engine, validating the XHR-interception precedent). User direction 2026-05-06 to extend ZARA coverage to US storefront using the region-parameterization pattern established by SPEC-PLATFORM-EXPANSION-002 (Uniqlo KR + US sharing one engine).

This research extends SPEC-003 (ZARA KR) to the US storefront. SPEC-003 established the entire ZARA engine — Playwright with `channel: "chrome"`, XHR interception of `/category/{id}/products?ajax=true`, infinite-scroll, abort-on-3, image-host whitelist, 5-UA rotation, ToS clause embedding contract. SPEC-002 (Uniqlo KR + US) established the **region-parameterization pattern**: one engine module accepts a `region: "KR" | "US"` parameter that drives baseUrl, locale, source currency, and category-set. SPEC-005 is the structural cross-product — apply SPEC-002's region pattern to SPEC-003's engine.

The question this research answers is whether ZARA US is structurally similar enough to ZARA KR for a shared-engine approach to work — same Akamai posture, same DOM/XHR shape, same image hosts, same ToS-clause discoverability, same robots.txt coverage — or whether the differences (storefront slug rotations, en-US locale, USD currency, separate ToS PDF) are large enough to require a separate engine module.

---

## §1. ZARA US Site Survey

### 1.1 robots.txt — REGION-AGNOSTIC, ALREADY VERIFIED

`https://www.zara.com/robots.txt` is a **single global file** shared across all regions. Re-fetched 2026-05-06 with realistic Mozilla UA: HTTP 200, 1320 bytes, 64 lines. The full `User-agent: *` group is **identical** to the version captured in SPEC-003 research.md §1.1 — no US-specific Disallow rules, no `/us/` path block, no per-region differentiation.

Path-specific Disallow analysis for our intended US crawl (full text already quoted in SPEC-003 research.md §1.1, not reproduced here):
- `/*/shop/`, `/*/search`, `/*/-pM`, `?color=`, `?colorId=`, `?ref=` — block search and detail-with-color URL forms; **product list pages (e.g. `/us/en/woman-new-in-l1180.html`) and product card URLs without color params are not Disallowed**.
- `*/akam/*`, `*/8y46UXJ4p/*` and 5 sibling 8-character-segment patterns under the `#bitdefender` comment confirm aggressive Akamai Bot Manager deployment (region-agnostic).
- `Sitemap: https://www.zara.com/sitemaps/sitemap-index.xml.gz` — same sitemap index, which now confirmed (§1.5 below) contains a dedicated `sitemap-category-us-en.xml.gz` partition with all US Woman + Man L2 landing URLs.

**Verdict**: robots.txt is **legally permissive for `zara.com/us/en` product-list and product-detail pages**. The blanket-disallow detector in `src/lib/robots-check.ts` returns `{allowed: true}` for `https://www.zara.com/us/en` — because the check is content-based and the file is region-agnostic, the existing implementation needs no change. **Not a HARD blocker.**

### 1.2 Terms of Service (ToS) — UNVERIFIED at plan phase, DEFERRED to Run-phase

ZARA KR's ToS was successfully pre-verified at plan phase via the canonical PDF at `static.zara.net/static/pdfs/KR/terms-and-conditions/terms-and-conditions-ko_KR-20251125.pdf` (SPEC-003 research.md §1.2). SPEC-005 attempted the equivalent shortcut for US but **could not locate a canonical PDF**:

| Candidate URL | HTTP | Bytes | Verdict |
|---|---|---|---|
| `https://static.zara.net/static/pdfs/US/terms-and-conditions/terms-and-conditions-en_US.pdf` | 404 | 548 | Not found |
| `https://static.zara.net/static//pdfs/US/terms-and-conditions/terms-and-conditions-en_US.pdf` | 404 | 548 | Not found (KR-style double-slash variant) |
| `https://static.zara.net/static/pdfs/US/terms-and-conditions/terms-and-conditions-en_US-20251125.pdf` | 404 | 548 | Not found (datestamped variant) |
| `https://static.zara.net/static/pdfs/US/` | 403 | 548 | Directory listing forbidden |
| `https://www.zara.com/us/en/help-center/legal/terms-of-use` | 404 (HTML 319KB SPA shell) | 319732 | Akamai-fronted SPA shell; ToS text is hydrated client-side after JS |

Plan-phase verdict: **ToS at canonical PDF location is NOT discoverable from external clients**. The `static.zara.net/static/pdfs/US/` directory may exist with a different sub-path (Inditex's per-region PDF naming is not publicly documented), or US ToS may be SPA-only (rendered after client-side JS). The `/help-center/legal/terms-of-use` URL responds with 404 (Akamai's standard behavior — the SPA shell is the only response on first GET, ToS text hydrates after JS executes).

**Run-phase task** (deferred — same posture as SPEC-004 v0.1.0 before its Run-phase resolution):

- Open `https://www.zara.com/us/en/help-center/legal/terms-of-use` (or fallback: navigate via `/us/en` homepage footer link to ToS) in a real Playwright session AFTER REQ-007 Akamai-bypass verification passes.
- Capture the rendered English ToS body text via `page.evaluate(() => document.body.innerText)` once the SPA hydrates.
- Scan for keywords: `crawl`, `crawler`, `crawling`, `scrape`, `scraping`, `scraper`, `robot`, `bot`, `automated`, `automation`, `data harvest`, `data extraction`, `agent`, `automated access`, `data mining`, `screen scraping`, `AI training`, `machine learning`.
- Identify all clauses referencing automation, IP rights, or content use. Embed verbatim English clauses as a top-of-file comment block in `src/lib/zara-engine.ts` (alongside the existing KR clauses) for permanent audit record.
- Classify verdict (PERMITS, AMBIGUOUS-ACCEPTED-BY-OWNER, AMBIGUOUS-REJECTED, FORBIDS).
- If ZARA US ToS contains an unambiguous prohibition (e.g., a verbatim "no scraping" or "no automated access" clause), the engine ships **shelved** — `disabled: true` on the new `zara-us` SiteConfig — and the operator escalates per HARD rule #1.
- If ambiguous (analogous to ZARA KR §15 IP rights), operator has authority to classify AMBIGUOUS-ACCEPTED-BY-OWNER following the precedent in SPEC-003 v0.2.0.

ZARA US ToS is **independent** of ZARA KR ToS — different jurisdiction (US contract law vs Korean), different regulatory context (FTC/state AG vs KFTC), potentially different anti-automation language. The KR pre-verification CANNOT be substituted for US verification. This is encoded as a HARD precondition (REQ-008 below).

The Run-phase agent has explicit authority to make the AMBIGUOUS-ACCEPTED-BY-OWNER call IF the captured ToS text contains no unambiguous prohibition AND the residual risk is comparable to ZARA KR's §15 IP rights clause. Otherwise the agent MUST report findings and request explicit project-owner review before unblocking the engine.

### 1.3 Akamai Bot Manager Posture (KR vs US)

Direct probing of `https://www.zara.com/us/en/woman-new-in-l1180.html` 2026-05-06 with realistic Mozilla UA returns **HTTP 200 with a 2,240-byte body that is the Akamai bm-verify JavaScript challenge intercept** — structurally identical to KR (SPEC-003 research.md §1.3 captured 2,240 bytes for the equivalent KR URL). Spot probes:

| URL | HTTP | Bytes | bm-verify present? |
|---|---|---|---|
| `https://www.zara.com/us/en/woman-new-in-l1180.html` | 200 | 2240 | YES |
| `https://www.zara.com/us/en/man-new-in-l711.html` | 200 | 2229 | YES |
| `https://www.zara.com/us/en/woman-shirts-l1217.html` | 200 | 2238 | YES |

The intercept body shape is identical to KR — `<meta http-equiv="refresh" content="5; URL='/us/en/...?bm-verify=...">` redirect token + obfuscated JS computation block + `<noscript>` iframe fallback. **Akamai is configured uniformly across the `zara.com` parent domain**: same Bot Manager deployment, same JS challenge response, same `_abck` / `bm_sz` cookie ecosystem.

This is **strong empirical evidence** that the SPEC-003 KR Akamai-bypass strategy will transfer to US:

- Vanilla bundled Chromium hard-403'd by Akamai's TLS/header fingerprint check (verified empirically 2026-05-05 against KR per SPEC-003 engine docstring).
- `chromium.launch({ channel: "chrome" })` swaps in the system's installed Chrome binary, which presents the exact TLS/JA3/ALPN/header fingerprint of a normal Chrome user. SPEC-003 Run phase verified 5/5 reliability against KR with `channel: "chrome"`.

**However**, Akamai posture is operator-tunable per region — Inditex configuration could differ between KR and US storefronts (e.g., different rate-limit thresholds, different bot-detection profiles for US vs KR traffic patterns). Treating the KR verification as authoritative for US would violate the empirical-verification discipline established by SPEC-003 REQ-007 and SPEC-004 REQ-007.

**Verdict**: KR-pattern (`channel: "chrome"` with vanilla launch options) is the **starting hypothesis** for US, but a Run-phase 5x sequential probe MUST be performed against `https://www.zara.com/us/en/woman-new-in-l1180.html` to confirm before engine code is shipped. This is encoded as REQ-007 below.

### 1.4 DOM structure and AJAX endpoint

The bm-verify intercept blocks direct curl-class inspection of the live US category page DOM. However, the SPEC-003 Run phase already extensively verified ZARA's React SPA pattern against KR:

- AJAX endpoint pattern: `https://www.zara.com/{region}/{lang}/category/{categoryId}/products?ajax=true` (where `{region}/{lang}` is `kr/ko` for KR, `us/en` for US — region is part of the URL path).
- Response shape: `{productGroups: [{elements: [{commercialComponents: [{...productNode}, ...]}]}]}` (verified for KR; the `harvestRawProducts` walker in `zara-engine.ts:208-230` is shape-agnostic and traverses the JSON tree to harvest leaf objects matching `id+name+price+seo.keyword`).
- Product node fields: `id`, `name`, `price` (KRW integer for KR; **USD decimal for US** — see §2.2), `section`, `sectionName`, `familyName`, `subfamilyName`, `seo.keyword`, `seo.seoProductId`, `availability`, `availableColors[].colorName`, `detail.colors[0].xmedia[0]` (image metadata), `_gender` engine-attached annotation.
- DOM selectors (used for selector-presence wait, NOT for product extraction): `.product-grid-product, [data-productid]` — region-agnostic ZARA SPA selectors.

**Hypothesis**: ZARA US uses the same SPA codebase as ZARA KR with locale + currency swapped at render time. The XHR endpoint pattern, response shape, product node schema, and DOM selectors are expected to be **identical** for US, with the URL path region-prefix being the only structural difference.

**Run-phase ANALYZE step MUST verify**:
1. The XHR pattern `/us/en/category/{id}/products?ajax=true` matches what the SPA fires (the engine's current `XHR_URL_RE = /\/category\/\d+\/products\?ajax=true/` is region-agnostic and SHOULD match — to be verified live).
2. The response shape is identical to KR (the `harvestRawProducts` walker is shape-agnostic so this should work without changes — to be verified live).
3. `prices.base.currency.code` returns `"USD"` and `price` field is decimal float (e.g., `29.9`) instead of integer KRW (e.g., `19900`). This is the **engine's primary structural difference** to address (see §2.2).
4. The image-host whitelist `static.zara.net` covers US image URLs (Inditex CDN is global; expected identical — to be verified live).

### 1.5 Catalog tree (women + men L2 landing URLs) — VERIFIED via sitemap

The `https://www.zara.com/sitemaps/sitemap-category-us-en.xml.gz` sitemap (HTTP 200, 16,238 bytes gzipped) was downloaded and decompressed 2026-05-06 to enumerate the canonical Woman + Man L2 landing-page URLs for US. Filtered for top-level fashion categories matching the SPEC-003 KR scope:

| Section | KR URL (SPEC-003) | US URL (this SPEC) | L-code mapping |
|---|---|---|---|
| WOMAN — New In | `/kr/ko/woman-new-in-l1180.html` | `/us/en/woman-new-in-l1180.html` | identical |
| WOMAN — Coats | `/kr/ko/woman-coats-l1184.html` | `/us/en/woman-outerwear-l1184.html` | **same L-code, different slug** ("coats" → "outerwear") |
| WOMAN — Jackets | `/kr/ko/woman-jackets-l1185.html` | `/us/en/woman-jackets-l1114.html` | **different L-code** (l1185 → l1114) |
| WOMAN — Knitwear | `/kr/ko/woman-knitwear-l1182.html` | `/us/en/woman-knitwear-l1152.html` | **different L-code** (l1182 → l1152) |
| WOMAN — Shirts | `/kr/ko/woman-shirts-l1217.html` | `/us/en/woman-shirts-l1217.html` | identical |
| WOMAN — T-Shirts | `/kr/ko/woman-tshirts-l1180.html` | `/us/en/woman-tshirts-l1362.html` | **different L-code** (l1180 → l1362) |
| WOMAN — Trousers | `/kr/ko/woman-trousers-l1335.html` | `/us/en/woman-trousers-l1335.html` | identical |
| WOMAN — Jeans | `/kr/ko/woman-jeans-l1119.html` | `/us/en/woman-jeans-l1119.html` | identical |
| WOMAN — Dresses | `/kr/ko/woman-dresses-l1066.html` | `/us/en/woman-dresses-l1066.html` | identical |
| WOMAN — Skirts | `/kr/ko/woman-skirts-l1299.html` | `/us/en/woman-skirts-l1299.html` | identical |
| WOMAN — Tops | (not in KR scope) | `/us/en/woman-tops-l1322.html` | US-only entry observed |
| WOMAN — Sweatshirts | (not in KR scope) | `/us/en/woman-sweatshirts-l1320.html` | US-only entry observed |
| WOMAN — Blazers | (not in KR scope) | `/us/en/woman-blazers-l1055.html` | US-only entry observed |
| MAN — New In | `/kr/ko/man-new-in-l711.html` | `/us/en/man-new-in-l711.html` | identical |
| MAN — Coats | `/kr/ko/man-coats-l715.html` | `/us/en/man-outerwear-l715.html` | **same L-code, different slug** ("coats" → "outerwear") |
| MAN — Jackets | `/kr/ko/man-jackets-l717.html` | `/us/en/man-jackets-l640.html` | **different L-code** (l717 → l640) |
| MAN — Knitwear | `/kr/ko/man-knitwear-l681.html` | `/us/en/man-knitwear-l681.html` | identical |
| MAN — Shirts | `/kr/ko/man-shirts-l737.html` | `/us/en/man-shirts-l737.html` | identical |
| MAN — T-Shirts | `/kr/ko/man-tshirts-l855.html` | `/us/en/man-tshirts-l855.html` | identical |
| MAN — Trousers | `/kr/ko/man-trousers-l838.html` | `/us/en/man-trousers-l838.html` | identical |
| MAN — Jeans | `/kr/ko/man-jeans-l710.html` | `/us/en/man-jeans-l659.html` | **different L-code** (l710 → l659) |
| MAN — Sweatshirts | (not in KR scope) | `/us/en/man-sweatshirts-l821.html` | US-only entry observed |
| MAN — Blazers | (not in KR scope) | `/us/en/man-blazers-l608.html` | US-only entry observed |

**Key finding — naive KR-to-US URL substitution does NOT work**. Live curl probe results 2026-05-06 with KR L-codes pasted into `/us/en/`:

- `/us/en/woman-coats-l1184.html` → HTTP 301 → `/us/en/woman-outerwear-l1184.html` (slug rename, same code)
- `/us/en/woman-jackets-l1185.html` → HTTP 301 → `/us/en/` (homepage redirect — KR L-code does not exist on US)
- `/us/en/woman-tshirts-l1180.html` → HTTP 301 → `/us/en/woman-new-in-l1180.html` (collision — l1180 means different things in each region)
- `/us/en/man-jackets-l717.html` → HTTP 301 → `/us/en/` (KR-only L-code)
- `/us/en/man-jeans-l710.html` → HTTP 301 → `/us/en/` (KR-only L-code)

**Verdict**: ZARA US has its own L-code namespace, partially overlapping with KR. The slug-localization differences (`coats` → `outerwear`) AND the L-code differences require a US-specific `categoryUrls` list. The list above (verified via sitemap 2026-05-06) is the canonical source.

**Initial US `categoryUrls` enumeration** (10 Woman + 8 Man = 18 entries, mirroring SPEC-003 KR scope where possible):

```
"https://www.zara.com/us/en/woman-new-in-l1180.html",
"https://www.zara.com/us/en/woman-outerwear-l1184.html",
"https://www.zara.com/us/en/woman-jackets-l1114.html",
"https://www.zara.com/us/en/woman-knitwear-l1152.html",
"https://www.zara.com/us/en/woman-shirts-l1217.html",
"https://www.zara.com/us/en/woman-tshirts-l1362.html",
"https://www.zara.com/us/en/woman-trousers-l1335.html",
"https://www.zara.com/us/en/woman-jeans-l1119.html",
"https://www.zara.com/us/en/woman-dresses-l1066.html",
"https://www.zara.com/us/en/woman-skirts-l1299.html",
"https://www.zara.com/us/en/man-new-in-l711.html",
"https://www.zara.com/us/en/man-outerwear-l715.html",
"https://www.zara.com/us/en/man-jackets-l640.html",
"https://www.zara.com/us/en/man-knitwear-l681.html",
"https://www.zara.com/us/en/man-shirts-l737.html",
"https://www.zara.com/us/en/man-tshirts-l855.html",
"https://www.zara.com/us/en/man-trousers-l838.html",
"https://www.zara.com/us/en/man-jeans-l659.html",
```

**Run-phase verification** (SPEC-005 ANALYZE step):
1. Each of the 18 URLs MUST be `page.goto`'d in a Playwright session and confirmed to render real product DOM (≥10 `.product-grid-product` matches, NOT a redirect chain to mkt or homepage).
2. URL-list refresh cadence: same as SPEC-003 (review once per major season change OR when test failures surface).

The `woman-l1.html` redirect anomaly observed in SPEC-003 research.md §1.6 (KR woman-l1 redirected to kids-mkt1) was NOT re-tested for US in this plan-phase research — Run-phase ANALYZE should spot-check that none of the 18 US URLs above redirect to kids/mkt/homepage.

---

## §2. Per-Region Differences (the actual delta)

This section documents the structural differences between ZARA KR and ZARA US that the engine MUST handle. Following the SPEC-002 (Uniqlo KR + US) precedent, differences are scoped narrowly so the region parameter touches only baseUrl path, locale, source currency, price formatter, and `categoryUrls` — the lifecycle, XHR-interception, parse logic, image-host whitelist, abort-on-3 mechanic, and ToS-clause-embedding contract all carry over unchanged.

### 2.1 Region-prefixed baseUrl

KR: `https://www.zara.com/kr/ko`
US: `https://www.zara.com/us/en`

The `baseUrl` is already a `SiteConfig` field — engine reads it from `config.baseUrl`. The engine's `buildProductUrl` helper at `zara-engine.ts:187-191` already accepts `baseUrl` as a parameter and constructs `${baseUrl}/${seo.keyword}-p${seo.seoProductId}.html`. No engine code change needed for this dimension — region-aware via existing `config.baseUrl`.

### 2.2 USD currency (engine-time vs import-time conversion)

ZARA US prices in USD natively. The SPA's product node `prices.base.currency.code` returns `"USD"` and `prices.base.value` returns a decimal float (e.g., `29.9` for $29.90), mirroring the Uniqlo US case. ZARA KR returns `"KRW"` and integer values (e.g., `19900`).

Following the SPEC-002 (Uniqlo KR + US) precedent, conversion happens at **import time** in `src/import-products.ts`, NOT at engine time:

- `data/zara-us-products.json` stores `Product.price` as the raw USD decimal value (NO conversion at engine time).
- `data/zara-us-products.json` stores `Product.sourceCurrency` as `"USD"`.
- `src/import-products.ts` (post-SPEC-002 baseline) already detects `sourceCurrency !== "KRW"` and applies `convertToKrw(price, "USD")` from `src/lib/fx.ts` before the Supabase upsert — this is the existing infrastructure introduced by SPEC-002 REQ-004. **No change to `import-products.ts` is required for SPEC-005**: the `convertToKrw` hook fires for any non-KRW source currency, regardless of platform.
- `FX_TO_KRW.USD = 1430` is already populated in `src/lib/fx.ts` (lifted by SPEC-002 from `shopify-engine.ts`). **No FX table extension required.**
- `priceFormatted` field on emitted `Product`: KR uses `"₩${price.toLocaleString("ko-KR")}"`, US should use `"$${price.toFixed(2)}"` (or `Intl.NumberFormat("en-US", {style: "currency", currency: "USD"})`). This is the only engine-side display-formatter change for US.

### 2.3 Locale + timezone

KR: `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"`
US: `locale: "en-US"`, `timezoneId: "America/New_York"` (Eastern; ZARA US headquarters is in NJ — closest realistic browser locale-timezone pairing)

These are Playwright context options. Engine reads from a region-derived map (small inline switch) rather than per-config fields — keeps the SiteConfig surface narrow.

### 2.4 productUrl regex

KR: `/^https:\/\/www\.zara\.com\/kr\/ko\/[^"'\s]+-p\d+\.html$/`
US: `/^https:\/\/www\.zara\.com\/us\/en\/[^"'\s]+-p\d+\.html$/`

The engine's `ZARA_PRODUCT_URL_RE` constant at `zara-engine.ts:90` is currently hardcoded for KR. Refactor: build the regex from a region parameter (or from `config.baseUrl`) at engine entry.

### 2.5 Image hosts — IDENTICAL across regions

KR: `static.zara.net`, `static-images.zara.net`
US: `static.zara.net`, `static-images.zara.net` (Inditex CDN is global — verified by inspection of US sitemap which references the same `static.zara.net/photos2/` paths)

**No change required**. The existing `ZARA_IMAGE_HOSTS` whitelist at `zara-engine.ts:77` covers both regions. To be re-verified during Run-phase ANALYZE by inspecting actual `<img src>` values on a live US category page.

### 2.6 Akamai Bot Manager Posture (KR vs US)

Both regions share the same Akamai Bot Manager deployment under the `zara.com` parent domain. Cookie names (`_abck`, `bm_sz`, `bm_s`, `bm_so`, `bm_ss`) are identical. The §1.3 probes confirmed:

- Plain curl with realistic Mozilla UA → HTTP 200 with full Akamai bm-verify intercept (2,229–2,240 bytes) on first request — **identical posture to KR** as captured in SPEC-003 §1.3 + §3.1.
- No active 4xx, no challenge HTML other than the bm-verify shell, no Queue-it script tag.

**Risk parity holds**: both regions face the same upside (Akamai-trusted real Chrome bypasses the JS challenge in 5/5 sequential attempts per SPEC-003 Run-phase verification) and the same downside (Akamai policy is operator-tunable per region — could change without notice).

**Verification protocol**: SPEC-005 Run-phase ANALYZE step MUST perform a 5x sequential `page.goto` probe against `https://www.zara.com/us/en/woman-new-in-l1180.html` with `chromium.launch({ channel: "chrome" })` and confirm ≥80% reach real product DOM (≥10 `.product-grid-product` matches, NOT bm-verify intercept). KR's pre-verification CANNOT be substituted for US verification — encoded as REQ-007 HARD precondition.

### 2.7 ToS — INDEPENDENT across regions (REQ-008)

ZARA KR ToS was pre-verified at plan phase 2026-05-05 via canonical PDF. ZARA US ToS canonical PDF is **not discoverable** (§1.2 above). REQ-008 defers verification to Run-phase Playwright session — see §1.2 for the full Run-phase task description.

ZARA US ToS is governed by US contract law (likely New York or Delaware jurisdiction per Inditex's US incorporation — to be confirmed by Run-phase agent during ToS capture). The KR §15 IP rights clause precedent does NOT carry over — US contract terminology and case law are different. Run-phase agent has authority to classify AMBIGUOUS-ACCEPTED-BY-OWNER ONLY if the captured English ToS contains no clauses unambiguously prohibiting automation/scraping AND the residual risk profile is comparable to ZARA KR's §15.

---

## §3. Internal Code Patterns (delta vs SPEC-003)

### 3.1 SPEC-003 baseline state (what ships post-merge)

After SPEC-003 ships (commit `68a448a`), the codebase contains:

- `src/lib/zara-engine.ts` (~553 LOC) — single engine, hardcoded for KR:
  - Top-of-file ToS comment block: KR Korean clauses §2.1, §6 bullet 2, §15 (per REQ-008 v0.2.0)
  - `ZARA_USER_AGENTS` 5-element rotation list
  - `ZARA_IMAGE_HOSTS = new Set(["static.zara.net", "static-images.zara.net"])` — region-agnostic, no change
  - `ZARA_PRODUCT_URL_RE = /^https:\/\/www\.zara\.com\/kr\/ko\/[^"'\s]+-p\d+\.html$/` — **HARDCODED FOR KR**
  - `detectBmVerifyIntercept` — region-agnostic, no change
  - `harvestRawProducts` walker — shape-agnostic, no change
  - `parseProductsFromXhr`:
    - `priceFormatted: \`₩${raw.price.toLocaleString("ko-KR")}\`` — **HARDCODED FOR KR**
    - `sourceCurrency: "KRW"` — **HARDCODED FOR KR**
  - `crawlOneCategory` — `XHR_URL_RE = /\/category\/\d+\/products\?ajax=true/` is region-agnostic
  - `crawlZara` entry:
    - `chromium.launch({ headless: true, channel: "chrome" })` — region-agnostic, no change
    - `browser.newContext({ userAgent: ua, locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: ...})` — **HARDCODED FOR KR locale + timezone**
    - `deriveGenderFromUrl` regex `/\/kr\/ko\/(woman|women)/` — **HARDCODED FOR KR path**
- `src/lib/types.ts:53` — `PlatformType = "cafe24" | "shopify" | "uniqlo" | "zara" | "29cm"`
- `src/lib/types.ts:138` — `region?: "KR" | "US"` field already exists (added by SPEC-002 for Uniqlo). JSDoc says "Uniqlo-specific" — to be **expanded** (not redefined) to include ZARA.
- `src/lib/types.ts:147` — `categoryUrls?: string[]` field already exists (added by SPEC-003 for ZARA).
- `src/configs/platforms.ts:865-895` — single `zara-kr` SiteConfig entry, hardcoded with KR `categoryUrls`, `sourceCurrency: "KRW"`, no `region` field.
- `src/lib/robots-check.ts` — region-agnostic blanket `Disallow: /` detector, no change needed.
- `src/import-products.ts` — post-SPEC-002 has `convertToKrw` at upsert time for non-KRW sourceCurrency; ZARA US (USD-source) automatically benefits.
- `src/crawl.ts` — dispatch branch routing `type === "zara"` to `crawlZara`. The branch is region-agnostic (one engine handles all `type === "zara"` SiteConfigs — the new `zara-us` entry will be picked up automatically).
- `tests/zara-engine.test.ts` + `tests/fixtures/zara-products.fixture.json` — KR-only characterization suite.

### 3.2 Region-parameter refactor scope

Per SPEC-002 precedent (Uniqlo region pattern), the following KR-only assumptions in `zara-engine.ts` are refactored to be region-driven. The `region` parameter source is `config.region` (the field already exists on `SiteConfig` — currently used by Uniqlo only, to be **also** consumed by ZARA per SPEC-005). The `zara-kr` SiteConfig is updated to set `region: "KR"` explicitly; the new `zara-us` entry sets `region: "US"`. The engine defaults to `"KR"` for backward compat if `region` is absent.

| Engine field | KR (current) | US (new) | Refactor strategy |
|---|---|---|---|
| Playwright context `locale` | `"ko-KR"` | `"en-US"` | Inline `region === "US" ? "en-US" : "ko-KR"` at context creation |
| Playwright context `timezoneId` | `"Asia/Seoul"` | `"America/New_York"` | Same inline pattern |
| `priceFormatted` | `\`₩${price.toLocaleString("ko-KR")}\`` | `\`$${price.toFixed(2)}\`` (or `Intl.NumberFormat("en-US",...)`) | Helper `formatPrice(price, region)` |
| `sourceCurrency` (emitted Product) | hardcoded `"KRW"` | derive from `config.sourceCurrency` (`"USD"` for US) | Stop hardcoding, read from config |
| `ZARA_PRODUCT_URL_RE` | `/\/kr\/ko\/.../` | `/\/us\/en\/.../` | Build regex from `config.baseUrl` at entry, OR pass `region` to `isSafeZaraProductUrl` |
| `deriveGenderFromUrl` regex | `/\/kr\/ko\/(woman|women)/` | `/\/us\/en\/(woman|women)/` | Generalize to `/\/(?:[a-z]{2})\/(?:[a-z]{2})\/(woman|women)/` (region-agnostic) |
| `categoryUrls` | KR list (18 entries, SPEC-003) | US list (18 entries, §1.5 above) | Per-config — already a SiteConfig field, no engine change |
| `baseUrl` | `https://www.zara.com/kr/ko` | `https://www.zara.com/us/en` | Per-config — already a SiteConfig field, no engine change |

KR behavior MUST be preserved bit-for-bit: identical Playwright context options, identical priceFormatted output, identical sourceCurrency `"KRW"`, identical productUrl regex match outcomes, identical fixture-based test outcomes.

### 3.3 Where USD→KRW conversion happens

Per SPEC-002 user decision (orchestrator spawn prompt §3 of SPEC-002), conversion happens at **import time** in `import-products.ts`. SPEC-005 inherits this decision verbatim — ZARA US storefront uses the same conversion path that Uniqlo US already uses:

- `data/zara-us-products.json` stores `Product.price` as raw USD decimal (no conversion).
- `data/zara-us-products.json` stores `Product.sourceCurrency` as `"USD"`.
- `src/import-products.ts` (post-SPEC-002) detects `sourceCurrency: "USD"` and applies `convertToKrw(price, "USD")` from the shared FX module before the Supabase upsert. No code change required for SPEC-005 — the import-side hook fires for any non-KRW source currency, regardless of platform.
- The Supabase `products.price` column receives KRW (consistent with all other platforms).
- `FX_TO_KRW.USD = 1430` is already populated. **No FX table extension required.**

### 3.4 Shared characterization test suite (parameterized by region)

Per SPEC-002 precedent, the existing `tests/zara-engine.test.ts` is extended to run against **both** the KR fixture (`tests/fixtures/zara-products.fixture.json`) and a new US fixture (`tests/fixtures/zara-us-products.fixture.json`). This is the primary mitigation for the gate-skip risk — any drift in the shared parse path surfaces on either fixture immediately.

- Existing fixture: `tests/fixtures/zara-products.fixture.json` (real KR XHR capture, frozen by SPEC-003)
- New fixture: `tests/fixtures/zara-us-products.fixture.json` (real US XHR capture, ~50–100 products from one US category page, captured ONCE during Run-phase PRESERVE step)
- Existing tests are parameterized by region. For both fixtures, the suite asserts:
  - Every emitted `Product` has populated `name`, `imageUrl`, `productUrl`, `price`.
  - Every `imageUrl` matches the shared `ZARA_IMAGE_HOSTS` whitelist.
  - Every `productUrl` starts with `https://www.zara.com/{region}/{locale}/` (region-aware).
  - Every `price` is positive (KRW integer for KR fixture, USD decimal for US fixture).
- US-fixture-specific assertions: `Product.sourceCurrency === "USD"`, `Product.priceFormatted` starts with `"$"` (NOT `"₩"`), `Product.price` is a positive decimal in sanity range `0.01 ≤ price ≤ 50000` (USD).

---

## §4. Engine Recommendation

### 4.1 Path comparison matrix

| Path | Description | Viable? | Reason |
|---|---|---|---|
| (a) | Region-parameterize the existing `zara-engine.ts` (SPEC-002 Uniqlo pattern applied to ZARA) | **YES** | Engine pattern transfers cleanly. KR/US share Akamai posture, DOM/XHR shape, image hosts, lifecycle, ToS-clause-embedding contract. Only baseUrl, locale, timezone, priceFormatted, productUrl regex, categoryUrls differ — narrow surface. |
| (b) | Create separate `src/lib/zara-us-engine.ts` (parallel to KR) | **NO** | Code duplication; ~270 LOC of `zara-engine.ts` would be copy-pasted. Drift risk: parse logic could diverge between KR and US copies, masking shared-engine bugs. Violates SPEC-002 precedent that established region-parameterization as the project pattern. |
| (c) | Defer ZARA US until ZARA KR has soaked in production for N days | **NO** | Soak gate was removed by user direction 2026-05-05 (SPEC-001 §2.4 amendment). ZARA KR (SPEC-003) is already merged and shipping. Per SPEC-002 precedent, parallel KR+US development is acceptable when region pattern is applied. |

### 4.2 Recommendation: Path (a) Region-Parameterize

**Reasoning:**

1. **SPEC-002 precedent**: Uniqlo KR + US share `src/lib/uniqlo-engine.ts` with `region: "KR" | "US"` parameter. The pattern is established, tested, and shipping. Applying the same pattern to ZARA is the minimal-divergence choice.
2. **Empirical similarity**: §1.3 confirmed Akamai posture is identical between KR and US. §2.5 confirmed image hosts are identical. §1.4 hypothesizes (Run-phase verifies) DOM/XHR shape is identical. The differences (§2.1-2.4) are narrow and well-bounded.
3. **No new code architecture**: Engine remains a single module. SiteConfig already has `region` field (from SPEC-002) and `categoryUrls` field (from SPEC-003) — both are reused without schema change.
4. **Test coverage parity**: Parameterized characterization fixture (KR + US) catches shared-engine drift on either region immediately, mirroring SPEC-002 §3.4.
5. **No FX table extension**: SPEC-002 already populated `USD: 1430` in `src/lib/fx.ts`. No new FX work.
6. **No new PlatformType**: `"zara"` already exists in the union (added by SPEC-003). The new SiteConfig entry uses `type: "zara"` and is picked up by the existing dispatch branch in `crawl.ts` automatically.

**Architecture summary** (full plan in plan.md §4):

- Modify `src/lib/zara-engine.ts` (~150 LOC delta) — add region-aware locale, timezone, priceFormatted, productUrl regex, sourceCurrency derivation. KR behavior preserved bit-for-bit.
- Modify `src/lib/types.ts` (~3 LOC) — extend the `region?: "KR" | "US"` field's JSDoc to also bind to `type === "zara"` (no schema change — field already exists).
- Modify `src/configs/platforms.ts` (~30 LOC) — append `zara-us` SiteConfig entry; update `zara-kr` to set `region: "KR"` explicitly.
- Modify `src/crawl.ts` (~0 LOC) — no change. Dispatch branch routes all `type === "zara"` SiteConfigs to `crawlZara`; new `zara-us` entry picked up automatically.
- Modify `src/import-products.ts` (~0 LOC) — no change. Post-SPEC-002 hook handles USD-source automatically.
- New file `tests/fixtures/zara-us-products.fixture.json` (~150 LOC) — frozen XHR capture from one US category page.
- Modify `tests/zara-engine.test.ts` (~40 LOC) — parameterize tests by region, add US-specific assertions.
- Modify `.moai/project/structure.md` (~5 LOC) — add `zara-us` row to platform table (now 37 entries).

### 4.3 Rollback path

If the Run-phase REQ-007 Akamai bypass verification fails for US (despite KR's 5/5 success), rollback options ranked by preference:

1. **Tighten US-specific browser context**: e.g., add explicit `Accept-Language: en-US,en;q=0.9` header, verify `chromium.launch({ channel: "chrome" })` resolves the system Chrome on the operator's machine, retry. No code-architecture change.
2. **Defer ZARA US per project HARD rule #1** (treat the Akamai active-block as a de-facto access denial): set `disabled: true` on the new `zara-us` SiteConfig entry, abandon the engine activation, escalate to project owner. The engine refactor itself remains in place because it does not change KR behavior — KR continues shipping unaffected.
3. **Introduce Xvfb-in-CI for `headless: false` mode**: separate SPEC, requires CI image change. Same posture as SPEC-003 §4.3 rollback path 1.

The Run-phase IMPROVE step (after PRESERVE captures the US fixture) is the natural decision point.

### 4.4 Inditex sub-brand precedent

Sub-brands sharing Inditex's parent infrastructure (Bershka, Pull&Bear, Massimo Dutti, Stradivarius, Oysho, Zara Home) all run on the same Akamai Bot Manager configuration as ZARA. **They remain deferred** per SPEC-001 §2.3 and SPEC-003 §2.3. SPEC-005 expands the engine architecture to handle 2 ZARA regions but does NOT auto-graduate any sub-brand. Each sub-brand requires its own SPEC with its own probe + ToS verification, even if SPEC-005 ships successfully.

### 4.5 ZARA region expansion precedent

SPEC-005 establishes the precedent for "one engine, multiple regions" applied to ZARA. Future SPECs adding ZARA ES, EU, UK, JP, AU, etc. would follow the same shape:

1. Verify region-specific Akamai posture (run 5x sequential probe).
2. Verify region-specific ToS (capture verbatim clause in real Playwright session).
3. Verify region-specific `categoryUrls` from `sitemap-category-{region}-{lang}.xml.gz`.
4. Add new SiteConfig entry with `type: "zara"`, `region: "{REGION_CODE}"`, region-specific `categoryUrls`, region-specific `sourceCurrency` (if non-KRW/USD, requires extending `FX_TO_KRW` map).
5. Refactor engine's locale/timezone/priceFormatted helpers to handle the new region (additive).

This SPEC sets the architecture but does NOT pre-authorize sub-region SPECs — each region is its own approval gate.

---

## §5. Risk Register

Risks specific to SPEC-005. SPEC-001 risk mitigations (`robots-check` enforcement, abort-on-3-errors, no IP rotation), SPEC-002 mitigations (FX module, parameterized fixtures), and SPEC-003 mitigations (Playwright lifecycle, ToS clause embedding, Akamai bypass) are all inherited.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Akamai posture diverges between KR and US (US is more aggressive)** | Low | High | REQ-007 makes a 5x sequential probe against US a HARD precondition. KR's verification CANNOT be substituted for US. If US reliability < 80% with `channel: "chrome"`, rollback path 1-3 in §4.3. NO fingerprint-evasion library as compensation. |
| **ZARA US ToS contains an unambiguous anti-scraping clause (different from KR which had no such clause)** | Unknown | Critical (de-facto deferral) | REQ-008 makes Run-phase ToS capture in a real Playwright session a HARD precondition. Verbatim English clauses embedded as audit evidence. If FORBIDS, set `disabled: true` on `zara-us` SiteConfig and escalate per HARD rule #1. The engine refactor remains in place because it does not affect KR. |
| **DOM/XHR shape diverges between KR and US (despite expected shape parity)** | Low | Medium | Parameterized characterization fixtures (KR + US) run on every test invocation. Drift surfaces on either fixture immediately. `harvestRawProducts` walker is shape-agnostic and defensive (skips nodes that don't match `id+name+price+seo.keyword`). |
| **`categoryUrls` US list becomes stale after seasonal catalog rotation** | Medium | Low | Same mechanism as KR: stale URLs return 301 redirect to homepage or 404 (waste 1 request, not corruption). Empty-category graceful-handling pattern carries over. Operator refresh cadence: review URL list once per major season change OR when test failures surface. The `sitemap-category-us-en.xml.gz` (§1.5) is the canonical refresh source. |
| **L-code namespace collision (e.g., l1180 means different things in KR vs US)** | High (already observed) | Medium | Engine's productUrl regex MUST be region-aware (§3.2) — a US `productUrl` with KR L-code should NOT validate (and vice versa). Test coverage in `tests/zara-engine.test.ts` parameterized by region, asserts URL prefix `https://www.zara.com/{region}/{locale}/`. Collision is detected at parse time, not crawl time. |
| **US `priceFormatted` emits non-USD format if locale derivation fails** | Low | Low | Helper `formatPrice(price, region)` is unit-tested against both region inputs. Fixture-based test asserts US `priceFormatted` starts with `"$"`, KR starts with `"₩"`. Mismatch caught immediately. |
| **Akamai introduces a new fingerprint signal that breaks `channel: "chrome"` for US (but not KR)** | Low | High | Fail-loud, no evasion-library workaround. If the US-only failure mode emerges, set `disabled: true` on `zara-us`, escalate. KR engine unaffected because `channel: "chrome"` was empirically verified at SPEC-003 Run-phase against KR. |
| **robots.txt policy change introduces region-specific Disallow (e.g., `Disallow: /us/en/woman-*-l*\.html`)** | Low | High | Same mechanism as SPEC-003: blanket-disallow detector runs at every crawl start (REQ-005). Targeted Disallow rules NOT caught by current detector — gap inherited as accepted residual risk. |
| **US Playwright session naturally inherits IP geolocation that conflicts with US locale** | Low | Low | Operator runs the crawler from a US-presenting IP (residential or VPN). If KR-presenting IP is used, ZARA may serve KR-content despite `/us/en` URL. Out of scope — operator concern. Mitigation: REQ-007 probe is run from the same IP that production crawls use, surfacing geo-mismatch immediately. |
| **Shared-engine bug surfaces in US production before KR has accumulated soak evidence to expose it** | Medium | Medium | SPEC-002 precedent — parameterized characterization fixtures (KR + US) on every test run. Engine `region` parameter touches narrow surface (locale, timezone, priceFormatted, productUrl regex, sourceCurrency). Rollback: revert SPEC-005 SiteConfig entry; engine refactor itself remains in place because it does not change KR behavior. |

---

## §6. Sources

All URLs fetched 2026-05-06 from project working directory:

- `https://www.zara.com/robots.txt` (HTTP 200, 1320 bytes, 64 lines — region-agnostic, identical to SPEC-003 §1.1)
- `https://www.zara.com/us/en/woman-new-in-l1180.html` (HTTP 200, 2240-byte bm-verify intercept — equivalent to KR posture)
- `https://www.zara.com/us/en/man-new-in-l711.html` (HTTP 200, 2229-byte bm-verify intercept)
- `https://www.zara.com/us/en/woman-shirts-l1217.html` (HTTP 200, 2238-byte bm-verify intercept)
- `https://www.zara.com/us/en/woman-coats-l1184.html` (HTTP 301 → `/us/en/woman-outerwear-l1184.html` — slug rename)
- `https://www.zara.com/us/en/woman-jackets-l1185.html` (HTTP 301 → `/us/en/` — KR L-code does not exist on US)
- `https://www.zara.com/us/en/woman-tshirts-l1180.html` (HTTP 301 → `/us/en/woman-new-in-l1180.html` — L-code collision)
- `https://www.zara.com/us/en/man-jackets-l717.html` (HTTP 301 → `/us/en/` — KR-only L-code)
- `https://www.zara.com/us/en/man-jeans-l710.html` (HTTP 301 → `/us/en/` — KR-only L-code)
- `https://www.zara.com/us/en/woman-knitwear-l1182.html` (HTTP 301 → `/us/en/woman-mkt1000.html` — KR-only L-code)
- `https://www.zara.com/us/en/woman-knitwear-l1152.html` (HTTP 200 — verified US L-code)
- `https://www.zara.com/us/en/woman-trousers-l1335.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/us/en/woman-jeans-l1119.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/us/en/woman-dresses-l1066.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/us/en/woman-skirts-l1299.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/us/en/man-knitwear-l681.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/us/en/man-shirts-l737.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/us/en/man-tshirts-l855.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/us/en/man-trousers-l838.html` (HTTP 200 — verified US L-code, identical to KR)
- `https://www.zara.com/sitemaps/sitemap-index.xml.gz` (HTTP 200, 4461 bytes gzipped — confirms `sitemap-category-us-en.xml.gz` partition exists)
- `https://www.zara.com/sitemaps/sitemap-category-us-en.xml.gz` (HTTP 200, 16,238 bytes gzipped — extracted full Woman + Man L2 landing-URL list, §1.5 table)
- `https://static.zara.net/static/pdfs/US/terms-and-conditions/terms-and-conditions-en_US.pdf` (HTTP 404 — canonical PDF NOT discoverable, ToS deferred to Run-phase)
- `https://static.zara.net/static//pdfs/US/terms-and-conditions/terms-and-conditions-en_US.pdf` (HTTP 404)
- `https://static.zara.net/static/pdfs/US/terms-and-conditions/terms-and-conditions-en_US-20251125.pdf` (HTTP 404)
- `https://static.zara.net/static/pdfs/US/` (HTTP 403 — directory listing forbidden)
- `https://www.zara.com/us/en/help-center/legal/terms-of-use` (HTTP 404, 319,732-byte SPA shell — ToS hydrated client-side after JS, deferred to Run-phase Playwright capture)

Internal source files referenced:

- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-001/research.md` §2.1 (ZARA preliminary findings deferred), §3.4 (engine dispatch surface)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-002/research.md` §1, §2 (region-parameterization pattern: Uniqlo KR + US sharing one engine), §3 (FX module lift, USD-at-import-time conversion, parameterized fixture pattern)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-002/spec.md` §Architecture Impact (region refactor scope, FX table lift, USD→KRW import-time conversion — all reused unchanged for SPEC-005)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-003/research.md` §1.1 (ZARA `robots.txt` full text — confirmed identical 2026-05-06), §1.3 (DOM selectors), §1.4 (XHR pattern + infinite scroll), §3 (Akamai bypass with `channel: "chrome"`), §4 (engine recommendation), §5 (risk register inherited)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-003/spec.md` §Architecture Impact (engine architecture inherited verbatim — Playwright lifecycle, XHR interception, abort-on-3, image-host whitelist, ToS clause embedding contract)
- `/Users/hansangho/Desktop/portal/crawler/.moai/specs/SPEC-PLATFORM-EXPANSION-004/spec.md` §Architecture Impact (second Playwright engine — validates the precedent that the SPEC-003 pattern transfers cleanly)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/zara-engine.ts` — current KR-only engine, ~553 LOC, refactor target
  - Lines 1-21: top-of-file ToS comment block (KR-only — to be amended with US clauses post-Run-phase REQ-008 capture)
  - Lines 55-65: `ZARA_USER_AGENTS` rotation list (region-agnostic, no change)
  - Lines 77-86: `ZARA_IMAGE_HOSTS` whitelist + `isSafeZaraImageUrl` (region-agnostic, no change)
  - Line 90: `ZARA_PRODUCT_URL_RE` (HARDCODED FOR KR — refactor target)
  - Lines 105-115: `detectBmVerifyIntercept` (region-agnostic, no change)
  - Lines 208-230: `harvestRawProducts` walker (shape-agnostic, no change)
  - Lines 244-290: `parseProductsFromXhr` (HARDCODED `priceFormatted` + `sourceCurrency` for KR — refactor target)
  - Line 302: `XHR_URL_RE` (region-agnostic, no change)
  - Lines 401-406: `deriveGenderFromUrl` (HARDCODED `/kr/ko/` regex — refactor target)
  - Lines 417-526: `crawlZara` entry (HARDCODED `locale: "ko-KR"`, `timezoneId: "Asia/Seoul"` — refactor target)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/uniqlo-engine.ts` — region-parameterization reference (post-SPEC-002 baseline; same refactor pattern applies to ZARA)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/fx.ts` — `FX_TO_KRW.USD = 1430` already populated (lifted by SPEC-002, no change for SPEC-005)
- `/Users/hansangho/Desktop/portal/crawler/src/lib/types.ts:53` (`PlatformType`, no change), `:121` (`sourceCurrency` already supports `"USD"`), `:138` (`region?: "KR" | "US"` already exists from SPEC-002 — JSDoc to expand to bind to ZARA), `:147` (`categoryUrls?: string[]` already exists from SPEC-003)
- `/Users/hansangho/Desktop/portal/crawler/src/configs/platforms.ts:865-895` (`zara-kr` entry from SPEC-003 to be paired with new `zara-us` entry), `:805-849` (uniqlo-us SiteConfig structural template — same pattern applies to zara-us)
- `/Users/hansangho/Desktop/portal/crawler/src/crawl.ts` (Cafe24/Uniqlo/ZARA dispatch — region-agnostic for ZARA, no change)
- `/Users/hansangho/Desktop/portal/crawler/src/import-products.ts` (post-SPEC-002 has `convertToKrw` USD-source hook — applies to zara-us automatically)
- `/Users/hansangho/Desktop/portal/crawler/tests/zara-engine.test.ts` + `tests/fixtures/zara-products.fixture.json` (KR-only test, parameterize template)
- `/Users/hansangho/Desktop/portal/crawler/tests/uniqlo-engine.test.ts` (region-parameterized test reference from SPEC-002 — same pattern applies to ZARA)
- `/Users/hansangho/Desktop/portal/crawler/.moai/project/tech.md` (Playwright already at `^1.58.2`, `node:test` runner, no new deps required)
- `/Users/hansangho/Desktop/portal/crawler/package.json` (test script and runner already configured)

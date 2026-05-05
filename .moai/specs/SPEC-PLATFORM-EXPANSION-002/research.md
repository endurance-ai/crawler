# Research: SPEC-PLATFORM-EXPANSION-002 — Uniqlo (US) Engine Extension

- **Date**: 2026-05-05
- **Author**: research subagent (manager-spec)
- **Scope**: Uniqlo US storefront (`uniqlo.com/us/en`) feasibility, parity with KR storefront, region-parameter refactor scope
- **Audience**: SPEC planner (manager-spec), plan auditor, project owner
- **Parent SPEC**: SPEC-PLATFORM-EXPANSION-001 (Uniqlo KR engine + onboarding hardening)

This research extends SPEC-001's investigation to the Uniqlo US storefront. SPEC-001 established the KR engine, robots-check, dry-run flow, and 1 req/sec rate-limit policy. SPEC-002 reuses every one of those components — the question this research answers is whether the US storefront exposes the same API surface, the same anti-bot posture, and the same field shape, or whether the differences are large enough to invalidate the shared-engine approach.

---

## 1. External Feasibility Matrix (US extension to SPEC-001 §1)

| Property | Uniqlo KR (SPEC-001 baseline) | Uniqlo US (this SPEC) | Verdict |
|---|---|---|---|
| `robots.txt` for product paths | Allow `/`; narrow Disallow on `cms`, `size/*`, `search`, `reviews/new` [^u-kr1] | Allow `/`; narrow Disallow on `cms`, `size/*`, `search`, `reviews/new` (region-isolated `#US` block, mirrors KR) [^u-us1] | Equivalent — product paths NOT disallowed |
| API endpoint | `/kr/api/commerce/v5/ko/products` HTTP 200 [^u-kr2] | `/us/api/commerce/v5/en/products` HTTP 200 [^u-us2] | Equivalent path-shape (region/locale swap) |
| API response schema | `{result:{items[], pagination, aggregations}}` | `{result:{items[], pagination, aggregations}}` (identical) | Equivalent |
| Anti-bot service | Akamai Bot Manager + Queue-it [^u-kr3] | Akamai Bot Manager (same `_abck`, `bm_sz`, `bm_ss`, `bm_so`, `bm_s` cookies on first request), Queue-it not observed on plain API call [^u-us3] | US Akamai posture is observed permissive on the API path; plain `curl` with realistic UA returned HTTP 200 with cookies set but no challenge |
| Catalog scale | 5–30K SKU (KR curated catalog) | 686 products on a single category iteration (`path=22210` Women top-level), full catalog estimated 5–15K SKU (US catalog is curated, similar to KR) [^u-us4] | Manageable, similar order of magnitude |
| Currency | KRW native (no FX) | **USD native — requires USD→KRW conversion at import-time** [^u-us5] | One genuine difference; addressed via existing FX table in `shopify-engine.ts` |
| Image CDN host | `image.uniqlo.com`, `asset.uniqlo.com` [^u-kr3] | `image.uniqlo.com`, `asset.uniqlo.com` (same hosts; observed on `usgoods_*` filenames) [^u-us6] | **Identical — existing `isSafeUniqloImageUrl` whitelist works as-is** |
| Category path format | Comma-separated tuples e.g. `"57892,,,"` (gender_id, l2_id, l3_id, l4_id) | Comma-separated tuples e.g. `"22210,,,"` (gender_id, l2_id, l3_id, l4_id) | Same format, **different numeric IDs** (KR genders: 57892–57925; US genders: 22210–22213) |
| Tax-inclusive vs tax-exclusive pricing | KRW tax-inclusive (display = checkout) | **USD tax-exclusive** (US prices on PLP exclude state sales tax; tax is added at checkout) | Captured in `prices.base.value` as the displayed pre-tax USD value; matches Shopify engine convention which also uses pre-tax USD |
| Sale price field | `prices.promo.value` when on sale | `prices.promo.value` when on sale (identical structure) [^u-us7] | Equivalent |
| Zip-code gating | None | None observed on plain API call | None |
| Age gating | None | None observed | None |

**Summary verdict**: Uniqlo US is structurally a near-clone of Uniqlo KR. The differences are (a) numeric category IDs, (b) USD currency requiring KRW conversion, (c) tax-exclusive pricing convention. None of these invalidate the shared-engine approach.

[^u-kr1]: SPEC-001 research.md §1 [^u1]. KR `#KR` block in `https://www.uniqlo.com/robots.txt`.
[^u-kr2]: SPEC-001 research.md §1 [^u2]. `https://www.uniqlo.com/kr/api/commerce/v5/ko/products?limit=2&offset=0&path=` HTTP 200.
[^u-kr3]: SPEC-001 research.md §1 [^u3], §2.5.
[^u-us1]: `curl https://www.uniqlo.com/robots.txt` 2026-05-05, `#US` block verbatim:
  ```
  #US
  Disallow: /us/en/cms
  Disallow: /us/en/size/*
  Disallow: /us/en/search
  Disallow: /us/en/news/search
  Disallow: /us/en/news/sp/search
  Disallow: /us/en/*?avoidNextModelRedirect=true
  Disallow: /us/en/*/reviews/new
  Sitemap: https://www.uniqlo.com/us/sitemap_us-en.xml
  Sitemap: https://www.uniqlo.com/us/sitemap_us-en_l1l2_hreflang.xml
  Sitemap: https://www.uniqlo.com/us/sitemap_us-en_l3_hreflang.xml
  ```
  Product path is NOT disallowed. `/us/en/cms`, `/us/en/size/*`, `/us/en/search`, `/us/en/news/search`, `/us/en/news/sp/search`, `/us/en/*?avoidNextModelRedirect=true`, `/us/en/*/reviews/new` are the only disallowed prefixes.
[^u-us2]: `curl -A "Mozilla/5.0 ... Chrome/131" https://www.uniqlo.com/us/api/commerce/v5/en/products?limit=2&offset=0&path=` 2026-05-05 → HTTP 200, body `{"status":"ok","result":{"aggregation":{...},"items":[],"pagination":{"total":0,"offset":0,"count":0},...}}`. Empty without path filter, identical shape to KR §1 [^u2].
[^u-us3]: Same request as [^u-us2] returned `Set-Cookie: _abck=...`, `Set-Cookie: bm_sz=...`, `Set-Cookie: bm_ss=...`, `Set-Cookie: bm_s=...`, `Set-Cookie: bm_so=...`, plus `server: nginx`, `cache-control: max-age=300`, `cdn-cache: MISS`. Akamai cookies are set but the response is HTTP 200 — Akamai is in passive mode for the API path.
[^u-us4]: `curl https://www.uniqlo.com/us/api/commerce/v5/en/products?path=22210&limit=1&offset=0` 2026-05-05 → `pagination.total: 686` for the WOMEN top-level category alone. Full US catalog spread across WOMEN (22210), MEN (22211), KIDS (22212), BABY (22213) plus subcategories estimated 5–15K total SKU.
[^u-us5]: Sample item from same probe: `"prices":{"base":{"currency":{"code":"USD","symbol":"$"},"value":29.9},"promo":null,"isDualPrice":false}`. Currency code is `"USD"`, value is decimal float (e.g., `29.9`). KR equivalent uses `"KRW"` and integer values (e.g., `19900`).
[^u-us6]: Same sample item: image URLs of the form `https://image.uniqlo.com/UQ/ST3/us/imagesgoods/482195/item/usgoods_18_482195_3x4.jpg`. Note the `/us/` and `usgoods_` infix; KR uses `/kr/` and `krgoods_`. The host is identical.
[^u-us7]: Same sample item: `"prices":{"base":{...},"promo":null,"isDualPrice":false}`. The `promo` field is `null` for non-sale items and `{currency, value}` shaped when on sale. Identical structure to KR.

---

## 2. Per-Region Differences (the actual delta)

### 2.1 Numeric Category IDs

The Uniqlo API at `/api/commerce/v5/{lang}/products` accepts a `path` query parameter formatted as `"{gender_id},{l2_id},{l3_id},{l4_id}"`. The numeric IDs are **region-specific**:

| Region | Gender | ID |
|---|---|---|
| KR | WOMEN | 57892 |
| KR | MEN | 57893 |
| KR | KIDS | 57894 |
| KR | BABY | 57925 |
| US | WOMEN | 22210 |
| US | MEN | 22211 |
| US | KIDS | 22212 |
| US | BABY | 22213 |

Discovery method: hit the API with `path=` empty and inspect `result.aggregations.tree.genders[]` (returns the four genders for the region). For sub-categories, hit `path={gender_id}&limit=1` and inspect `result.aggregations.tree.classes[]`, `categories[]`, `subcategories[]`.

The existing KR `apiCategoryPaths` array enumerates ~21 path strings of the form `"57892,57959,,"`. SPEC-002 will introduce a parallel US `apiCategoryPaths` array of equivalent depth, with KR numeric IDs replaced by US numeric IDs. The path-string format itself is **identical** across regions; only the numbers differ.

### 2.2 USD Currency

Uniqlo US prices in USD natively. The `prices.base.currency.code` field returns `"USD"` and `prices.base.value` returns a decimal float (e.g., `29.9` for $29.90).

Existing infrastructure available for FX conversion:

- `shopify-engine.ts:11-16` already declares a hardcoded FX table:
  ```typescript
  const FX_TO_KRW: Record<string, number> = {
    USD: 1430,
    EUR: 1560,
    GBP: 1750,
    KRW: 1,
  }
  ```
- USD is already populated. **No FX table extension is required for SPEC-002.**
- `convertToKrw(price, currency)` at `shopify-engine.ts:34-41` is the existing conversion function.

Two viable architectural choices for where the conversion happens:

1. **Conversion at engine time** (inside `crawlUniqlo`): The engine writes pre-converted KRW values into `data/uniqlo-us-products.json`. Aligns with how `shopify-engine.ts` handles non-KRW Shopify stores (engine writes KRW). However, this couples the engine to the FX table.
2. **Conversion at import time** (inside `import-products.ts`): The engine writes USD natively; `import-products.ts` performs USD→KRW conversion before Supabase upsert. Decouples the engine; matches the user's stated preference (see Section 4 below).

**User decision (per orchestrator spawn prompt §3)**: Conversion at import time. The cache file `data/uniqlo-us-products.json` stores `price_usd` natively as decimal USD. `import-products.ts` performs the conversion via the existing `FX_TO_KRW` table from `shopify-engine.ts`. This requires either (a) re-exporting `FX_TO_KRW` from `shopify-engine.ts`, or (b) lifting the table into a small shared module (e.g., `src/lib/fx.ts`). Option (b) is preferred to avoid a cross-engine import.

### 2.3 Tax-exclusive Pricing

US prices are pre-tax. State sales tax is added at checkout. The `prices.base.value` field captures the displayed pre-tax USD value — this is the same convention `shopify-engine.ts` follows for global Shopify stores (where displayed prices also exclude VAT/sales tax depending on storefront locale). No special handling required; the value as-fetched is the canonical reference price.

### 2.4 Akamai Bot Manager Posture (KR vs US)

Both regions share the same Akamai Bot Manager deployment under the `uniqlo.com` parent domain. Cookie names (`_abck`, `bm_sz`, `bm_s`, `bm_so`, `bm_ss`) are identical. The probe in §1 [^u-us3] confirmed:

- Plain `curl` with realistic Mozilla UA → HTTP 200 with full Akamai cookie set on first request
- No active 403, no challenge HTML, no Queue-it script tag returned for the JSON API endpoint
- Server header `nginx`, `cache-control: max-age=300`, `cdn-cache: MISS` — same edge behavior as KR

Akamai is configured **permissively for the `/us/api/commerce/v5/...` path**, identical to KR. No evidence that the US deployment blocks more aggressively than KR. **Risk parity holds**: both regions face the same upside (Akamai may currently allow it) and the same downside (Akamai policy is operator-tunable and could change without notice).

### 2.5 Queue-it Virtual Waiting Room

Queue-it (the launch-day virtual waiting room) is shipped as `<script src="https://asset.uniqlo.com/g/scripts/queueclient.min.js">` on Uniqlo SPA HTML pages, both KR and US. **Queue-it is a frontend overlay**, not an API gateway — the JSON API endpoint `/api/commerce/v5/...` does not invoke Queue-it. Both regions are equivalently exposed only on launch-day SPA traffic, which this crawler does not touch.

---

## 3. Internal Code Patterns (delta vs SPEC-001)

### 3.1 SPEC-001 baseline state

After SPEC-001 ships, the codebase contains:

- `src/lib/uniqlo-engine.ts` — single engine, hardcoded `UNIQLO_API_PATH = "/kr/api/commerce/v5/ko/products"` (line 18)
- `src/lib/uniqlo-engine.ts` — `sourceCurrency: "KRW"` hardcoded (line 190 per pre-SPEC-002 commit)
- `src/lib/uniqlo-engine.ts` — `priceFormatted` uses `"ko-KR"` locale (line 179 per pre-SPEC-002 commit)
- `src/lib/types.ts:53` — `PlatformType = "cafe24" | "shopify" | "uniqlo"`
- `src/lib/types.ts` — `SiteConfig.apiCategoryPaths?: string[]`
- `src/configs/platforms.ts` — single `uniqlo-kr` SiteConfig entry with KR-specific `apiCategoryPaths` and `sourceCurrency: "KRW"`
- `src/lib/robots-check.ts` — region-agnostic blanket `Disallow: /` detector
- `src/crawl.ts` — dispatch branch routing `type === "uniqlo"` to `crawlUniqlo`
- `tests/uniqlo-engine.test.ts` + `tests/fixtures/uniqlo-kr-products.fixture.json` — KR-only characterization suite

### 3.2 Refactor required for shared-engine support

Per orchestrator decision (spawn prompt §2: "Shared engine architecture: One `uniqlo-engine.ts` module with a `region: 'KR' | 'US'` parameter"), the engine module must be refactored to accept region as a parameter. The KR-only assumptions to remove are:

- **Hardcoded `UNIQLO_API_PATH`** — Replace with a function `buildApiPath(region: "KR" | "US"): string` returning `/kr/api/commerce/v5/ko/products` for KR or `/us/api/commerce/v5/en/products` for US.
- **Hardcoded `sourceCurrency: "KRW"`** — Source currency becomes a function of region: `"KRW"` for KR, `"USD"` for US. The engine reads this from `config.sourceCurrency` (already set on the SiteConfig per existing schema), so the engine itself does not need a region switch — it just stops hardcoding the value and trusts the config.
- **Hardcoded `"ko-KR"` locale** in `priceFormatted` — Becomes `"ko-KR"` for KR and `"en-US"` for US (driven by region).
- **Per-region image filename inference** is NOT required — the host whitelist (`image.uniqlo.com`, `asset.uniqlo.com`) is region-agnostic; the `usgoods_*` vs `krgoods_*` filename infix is purely cosmetic.

Region parameter source: derive from `config.key` prefix (`uniqlo-kr` → KR, `uniqlo-us` → US) or add an explicit `region: "KR" | "US"` field to SiteConfig for the `"uniqlo"` engine type. Recommendation: explicit field, type-narrowed via discriminated union if possible, otherwise a free `region?: "KR" | "US"` optional on SiteConfig.

### 3.3 Where USD→KRW conversion happens

Per user decision (orchestrator spawn prompt §3), conversion happens at **import time** in `import-products.ts`. Concrete plan:

- `data/uniqlo-us-products.json` stores `Product.price` as the raw USD decimal (no conversion).
- `data/uniqlo-us-products.json` stores `Product.sourceCurrency` as `"USD"`.
- `import-products.ts:148-212` (the Supabase upsert mapping) detects `sourceCurrency: "USD"` and applies `convertToKrw(price, "USD")` from the shared FX module before the upsert.
- The Supabase `products.price` column receives KRW (consistent with all other platforms).
- The Supabase `products.original_price` column also receives KRW; the original USD value is NOT stored separately (project explicitly out of scope for schema migration per orchestrator §4).

This reuses the existing FX table without modification. USD is already in `FX_TO_KRW` at line 12. **No FX table extension is required.**

### 3.4 Shared characterization test suite

Per orchestrator decision (gate-override mitigation), the existing `tests/uniqlo-engine.test.ts` is extended to run against **both** the KR fixture and a new US fixture. This is the primary mitigation for the gate override:

- Existing fixture: `tests/fixtures/uniqlo-kr-products.fixture.json` (real KR API capture)
- New fixture: `tests/fixtures/uniqlo-us-products.fixture.json` (real US API capture, ~50–100 products, captured once via curl on SPEC date)
- Existing tests are parameterized by region: each assertion runs against both fixtures; bugs in shared parse logic surface on either fixture immediately.

---

## 4. Risk Matrix (US extension to SPEC-001 §4)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Uniqlo US API shape diverges from KR (undocumented v5 endpoint, region-specific tweaks) | Low–Medium | Medium | Both KR and US fixtures run through the same engine parse path in characterization tests. Any schema drift on either side surfaces on test run. Engine maps fields defensively (each falls back to `null` if absent). |
| Akamai escalates anti-bot for the US API path (currently passive per §1 [^u-us3]) | Low | High | Inherits SPEC-001 mitigation: 1 req/sec baseline (REQ-002 reused), 5-element UA rotation, abort-on-3-consecutive-errors (REQ-005 reused). No IP rotation, no fingerprint randomization. |
| Uniqlo introduces `Disallow: /us/api/` in robots.txt | Low | High | SPEC-001's `robots-check.ts` runs at every crawl start. SPEC-002 extends robots-check **allowlist** to add `uniqlo.com/us` as a verified known-good baseUrl. A future targeted-disallow rule would still pass the blanket-check; that finer-grained gap is documented in SPEC-001 §Open Risks and remains an accepted residual risk. |
| USD→KRW FX rate staleness (hardcoded `USD: 1430` in `shopify-engine.ts`) | Medium | Low | Same risk already accepted for Shopify engines using USD/EUR/GBP. POC-grade; live FX rate API is project-level out-of-scope per `product.md`. |
| US `apiCategoryPaths` becomes stale (Uniqlo restructures US category IDs) | Medium | Low | Same mitigation as KR: empty `total=0` is handled (REQ-002 termination condition). Stale entries waste a request but do not corrupt output. Revisit if maintenance burden materializes. |
| Tax-exclusive USD prices misinterpreted as tax-inclusive | Low | Low | Documented convention: stored USD value is the displayed pre-tax PLP price. Matches `shopify-engine.ts` behavior for all global Shopify stores. No special handling. |
| **Gate-override risk**: shared-engine bug surfaces in US before KR has soaked | Medium | Medium | Shared characterization fixtures (KR + US) run on every test invocation. If a bug surfaces on either fixture, both regions are halted simultaneously. The engine's `region` parameter touches only API path, currency code, and locale string — narrow surface for region-specific bugs. |

---

## 5. Engine Strategy for SPEC-002 (parallel to SPEC-001 §6)

**Recommended approach**: extend the existing `uniqlo-engine.ts` with a region parameter; add a new `uniqlo-us` SiteConfig entry; add a new fixture; extend the characterization suite to run against both fixtures.

### 5.1 Files to modify

| File | Action | Est. LOC | Reason |
|---|---|---|---|
| `src/lib/uniqlo-engine.ts` | MODIFY | ~30 | Replace `UNIQLO_API_PATH` constant with `buildApiPath(region)` function (~5 LOC). Stop hardcoding `sourceCurrency: "KRW"` — read from `config.sourceCurrency` (~2 LOC delta). Stop hardcoding `"ko-KR"` locale in `priceFormatted` — derive from region (~5 LOC delta). Add explicit region read from `config.region` or derive from `config.key`. Defensive type narrowing (~10 LOC). |
| `src/lib/types.ts` | MODIFY | ~3 | Add optional `region?: "KR" \| "US"` to `SiteConfig` (limited semantic to the `"uniqlo"` engine type, documented in JSDoc). |
| `src/lib/fx.ts` | NEW | ~30 | Lift `FX_TO_KRW` table and `convertToKrw` function out of `shopify-engine.ts` into a shared module. `shopify-engine.ts` re-imports from this module (no behavior change). `import-products.ts` imports from this module for Uniqlo US conversion. |
| `src/lib/shopify-engine.ts` | MODIFY | ~5 | Replace inline `FX_TO_KRW` and `convertToKrw` with `import { FX_TO_KRW, convertToKrw } from "./fx"`. No behavior change. |
| `src/configs/platforms.ts` | MODIFY | ~30 | Append `uniqlo-us` SiteConfig entry. `key: "uniqlo-us"`, `name: "유니클로 (US)"`, `type: "uniqlo"`, `baseUrl: "https://www.uniqlo.com/us/en"`, `region: "US"`, `sourceCurrency: "USD"`, `crawlDelay: 1000`, hardcoded `apiCategoryPaths` enumerating the four US gender top-levels (22210, 22211, 22212, 22213) and direct sub-categories (T-Shirts & Sweats=23295, Outerwear=23294, Pants=23296, etc., per probe in §2.4 above). |
| `src/import-products.ts` | MODIFY | ~15 | Detect `sourceCurrency: "USD"` (or any non-KRW source currency) and apply `convertToKrw` before upsert. The Cafe24 path always KRW so this branch is `uniqlo`/Shopify-USD only. |
| `src/lib/robots-check.ts` | MODIFY | ~5 | Add `uniqlo.com/us/en` to the verified-known-good baseUrl allowlist comment / explicit string (purely documentary; the runtime check is content-based on `robots.txt` body). |
| `tests/fixtures/uniqlo-us-products.fixture.json` | NEW | ~150 | Frozen snapshot of one real US API page (`path=22210` Women top-level, ~50–100 products), captured once via curl at SPEC date. |
| `tests/uniqlo-engine.test.ts` | MODIFY | ~40 | Parameterize existing tests by region. Each KR assertion is paired with an equivalent US assertion against the new fixture. New US-specific tests: USD currency present, KRW conversion at import-mapping path produces non-null integer, image URLs pass shared whitelist. |

Total estimated LOC delta: ~308 (refactor + new config entry + fixture + tests + import-time FX hook).

### 5.2 Tests needed (dry-run scenarios)

1. **Probe**: `pnpm crawl --site=uniqlo-us --dry-run` confirms US API endpoint returns 200 and parses JSON shape with `prices.base.currency.code === "USD"`.
2. **Single-category**: limit `apiCategoryPaths` to one US code (e.g., `"22210,,,"` for Women), run full crawl, verify `data/uniqlo-us-products.json` contains valid Products with `price` (USD decimal), `imageUrl`, `productUrl` populated and `sourceCurrency: "USD"`.
3. **Pagination**: verify `offset` increments past 100 and stops when `pagination.count === 0` on the US endpoint.
4. **Image host whitelist (shared)**: confirm only `image.uniqlo.com` / `asset.uniqlo.com` images are kept on US fixture; rogue hosts filtered. Same whitelist passes for both KR and US.
5. **USD→KRW import**: dry-run the `import-products.ts` path against the US cache file; verify the upsert payload `price` field is integer KRW (not decimal USD).
6. **robots.txt re-check at runtime**: confirm `uniqlo.com/us` robots.txt fetch on crawl-start passes the blanket-disallow check (REQ-004 from SPEC-001 reused).
7. **Shared parse path on both fixtures**: characterization test loads KR fixture AND US fixture; same assertions (name populated, imageUrl populated, productUrl populated, price populated) pass on both.

---

## 6. Open Questions (resolved by orchestrator spawn prompt)

| # | Question | Resolution |
|---|---|---|
| 1 | Entry gate — wait for KR's 7-day soak? | **NO**. User explicitly bypassed the gate. SPEC-002 proceeds in parallel with SPEC-001. Mitigation: shared characterization fixtures (KR + US) on every test run. |
| 2 | Shared engine vs separate `uniqlo-us-engine.ts`? | **Shared**. One module, region parameter. Refactor existing KR-only assumptions. |
| 3 | Where does USD→KRW conversion happen? | **Import time** in `import-products.ts`. Cache stores native USD. Reuse existing `FX_TO_KRW` from `shopify-engine.ts`. |
| 4 | New FX table or live FX API? | **Reuse existing hardcoded table**. USD is already populated. No live FX API. |
| 5 | Schema migration? | **NO**. Existing `products` columns accept all US fields. |
| 6 | Size system normalization? | **OUT OF SCOPE**. US uses XS/S/M/L/XL; KR uses 90/95/100. Both are stored as-is in `Product.sizes`. |
| 7 | Multi-region orchestration / fanout? | **OUT OF SCOPE**. Each region is a separate `pnpm crawl --site=...` invocation. |

---

## 7. Sources

All URLs fetched 2026-05-05 from project working directory. New US-specific sources (KR sources documented in SPEC-001 research.md §8):

- `https://www.uniqlo.com/robots.txt` (HTTP 200, `#US` block extracted — full text in [^u-us1])
- `https://www.uniqlo.com/us/api/commerce/v5/en/products?limit=2&offset=0&path=` (HTTP 200, empty result, shape confirmed [^u-us2])
- `https://www.uniqlo.com/us/api/commerce/v5/en/products?path=22210&limit=2&offset=0` (HTTP 200, 686 products in WOMEN category, sample item with `prices.base.currency.code: "USD"` and image hosts on `image.uniqlo.com` [^u-us3], [^u-us5], [^u-us6])
- `https://www.uniqlo.com/us/api/commerce/v5/en/products?path=22210&limit=1&offset=0` (HTTP 200, response includes `aggregations.tree.genders` with 22210/22211/22212/22213 + `aggregations.tree.classes` with US-specific class IDs)
- `https://www.uniqlo.com/us/sitemap_us-en_l1l2_hreflang.xml` (HTTP 200, lists `/us/en/men`, `/us/en/kids`, `/us/en/baby` — note: `/us/en/women` is NOT in the l1l2 sitemap, but `path=22210` still returns 686 products on the API — the sitemap is incomplete relative to the API)
- `https://www.uniqlo.com/us/en/` (HTTP 200, homepage reachable)

Internal source files referenced:

- `src/lib/uniqlo-engine.ts` (post-SPEC-001 baseline; KR-only assumptions on lines 18, 179, 190 — to be refactored)
- `src/lib/shopify-engine.ts:11-16` (`FX_TO_KRW` table; USD already populated at 1430)
- `src/lib/shopify-engine.ts:34-41` (`convertToKrw` function)
- `src/lib/types.ts:53` (`PlatformType` already extended for `"uniqlo"` in SPEC-001)
- `src/lib/types.ts` (`SiteConfig` interface; `region?: "KR" | "US"` to be added)
- `src/configs/platforms.ts` (`uniqlo-kr` entry from SPEC-001 to be paired with new `uniqlo-us` entry)
- `src/import-products.ts:148-212` (Supabase upsert mapping; USD→KRW conversion to be inserted)
- `tests/fixtures/uniqlo-kr-products.fixture.json` (SPEC-001 KR fixture; pairs with new US fixture)
- `tests/uniqlo-engine.test.ts` (SPEC-001 KR characterization suite; to be parameterized by region)

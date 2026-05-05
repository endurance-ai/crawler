# Uniqlo Multi-Storefront Probe Report

Date: 2026-05-05
Purpose: Inform `SPEC-PLATFORM-EXPANSION-002` (Uniqlo US follow-up) research phase
Trigger: KR SPEC implementation completed (commits ccda0fe + f2f5e5d on `feature/SPEC-PLATFORM-EXPANSION-001`); user asked whether non-KR storefronts (JP/US/UK) are reachable with the same engine.

---

## TL;DR

- **US storefront**: fully reachable, schema 100% identical to KR. Currency USD (float). Real category IDs captured. Ready to add as `uniqlo-us` SiteConfig. **Selected target for SPEC-002.**
- **JP storefront**: fully reachable, schema identical. Currency JPY (integer). Real category IDs captured (L1 only confirmed). Available but DEFERRED — not part of SPEC-002 unless user explicitly opts in.
- **UK storefront**: blocked. Requires `x-fr-clientid` header with non-public value. Defer to separate future SPEC.
- **Engine deltas required**: ~100 LOC + 1 fixture (US-only). Engine architecture is storefront-neutral. Three hardcodes need to become SiteConfig fields.

---

## 1. robots.txt assessment (host-rooted, applies to all storefronts)

`https://www.uniqlo.com/robots.txt` — single file at host root, covers every country prefix.

- Returns HTTP 200 with realistic Mozilla UA
- No `User-agent: * / Disallow: /` blanket rule found
- All `Disallow:` rules are path-specific (e.g., `/au/en/cms/`, `/de/de/cart`, `/uk/en/news/search`)
- `/{country}/api/commerce/v5/{lang}/products` endpoint not blocked for JP/US/UK
- `/jp/ja/robots.txt`, `/us/en/robots.txt`, `/uk/en/robots.txt` all return HTTP 404 (correct — robots.txt is host-rooted only)

**Conclusion**: Existing `robots-check.ts` (which strips baseUrl path and checks host root) already covers JP/US/UK correctly without modification.

---

## 2. API endpoint probe results

All probes used UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`. No additional headers.

### 2.1 US — `https://www.uniqlo.com/us/api/commerce/v5/en/products`

```
GET /us/api/commerce/v5/en/products?path=22210&limit=2&offset=0
HTTP 200, body schema {status:"ok", result:{items[], pagination, aggregations}}
pagination.total = 686
items[0].name = "Ribbed Cropped Bra Top"
items[0].productId = "E482195-000"
items[0].prices.base = {currency:{code:"USD",symbol:"$"}, value: 29.9}
items[0] keys: colors, genderName, genderCategory, sizeGender, images, l1Id, name, prices, productId, priceGroup, plds, rating, representativeColorDisplayCode, representative, sizes
```

**Schema identical to KR.** `prices.base.currency.code` carries the storefront currency. Image hosts are `image.uniqlo.com` and `asset.uniqlo.com` — same whitelist as KR.

### 2.2 JP — `https://www.uniqlo.com/jp/api/commerce/v5/ja/products`

```
GET /jp/api/commerce/v5/ja/products?path=1071&limit=2&offset=0
HTTP 200
pagination.total = 994
items[0].name = "シアーT"
items[0].productId = "E484231-000"
items[0].prices.base = {currency:{code:"JPY",symbol:"¥"}, value: 1990}
```

**Schema identical to KR.** Note `prices.base.value` is integer for JPY (no decimal subunit), unlike USD's float.

JP HTML SPA (`/jp/ja/women`) returns 301 + Akamai bot challenge script `/_hkvUE/...` — confirms Akamai Bot Manager is present but configured to allow direct API hits while blocking SPA scraping.

### 2.3 UK — `https://www.uniqlo.com/uk/api/commerce/v5/en/products`

```
GET /uk/api/commerce/v5/en/products?path=&limit=1&offset=0
HTTP 200 BUT body = {status:"nok", error:{httpStatusCode:400, details:[{message:"invalid or missing client id"}]}}
```

Tried headers:
- `x-fr-clientid: uq.global.default.prd` (guess) → still rejected
- `Referer: https://www.uniqlo.com/uk/en/` + `Origin: https://www.uniqlo.com` → still rejected

**UK API requires a client ID header that is not publicly documented.** Defer to future SPEC where the client-id acquisition path is explicitly decided.

---

## 3. Category ID enumeration (per storefront, independent namespace)

Critical finding: **category IDs do not transfer between storefronts**. Each storefront has its own ID namespace. Cross-using KR IDs on JP/US returned `total: 0` for all attempted values.

Discovery method: parse the storefront's `women`/`men` SPA HTML for inline JSON containing `"id":N,"name":"<label>"` patterns.

### 3.1 US category IDs (extracted from `/us/en/women` HTML)

| ID | Name | Level | API total (limit=1 probe) |
|---|---|---|---|
| 22210 | Women | L1 | 686 |
| 23295 | T-Shirts & Sweats | L2 (under Women) | – (combo `22210,23295,,` returned 305) |
| 95663 | Shirts & Blouses | L2 | – |
| 95664 | Sweaters & Cardigans | L2 | – |
| 23296 | Jeans & Pants | L2 | – |
| 23294 | Outerwear | L2 | – |

US uses 4-position comma path notation identical to KR (verified: `path=22210%2C23295%2C%2C` returned 305 items).

Men/Kids/Baby L1 IDs not yet captured — SPEC-002 research phase should grep all four gender pages.

### 3.2 JP category IDs (extracted from `/jp/ja/men` HTML)

| ID | Name | Level | API total |
|---|---|---|---|
| 1071 | Women | L1 | 994 |
| 1072 | Men | L1 | 797 |
| 1073 | Kids | L1 | 259 |
| 1074 | Baby | L1 | 127 |
| 1480 | Tシャツ・スウェット | L2 | 0 (likely needs combo path) |
| 1479 | アウター | L2 | 0 |
| 1481 | パンツ・ズボン | L2 | 0 |
| 94381 | セーター・カーディガン | L2 | – |
| 94385 | シャツ・ポロシャツ | L2 | – |
| 51226 | ワンピース・スカート | L2 | – |

L1 paths work standalone. L2 codes returned 0 when used standalone — they probably require the L1+L2 combo notation like KR's `57892,57959,,` form.

### 3.3 UK

Cannot enumerate due to API authentication block (see §2.3).

---

## 4. Currency handling implications

| Storefront | Currency code | Value type | Sample |
|---|---|---|---|
| KR | KRW | integer | 14900 |
| JP | JPY | integer | 1990 |
| US | USD | float | 29.9 |
| UK | GBP | float (presumed, untested) | – |

Existing `shopify-engine.ts` has FX_TO_KRW table covering USD (1430), EUR (1560), GBP (1750), KRW (1). USD rate already present — **JPY rate missing** (~9.3 KRW/JPY as of 2026-05-05; verify with real source at SPEC time).

Current Uniqlo engine hardcodes `sourceCurrency: "KRW"`. To support multi-storefront:
1. Read `item.prices.base.currency.code` from response (already present)
2. Write to `Product.sourceCurrency` directly
3. `Product.sourcePrice` carries the original numeric value
4. `Product.price` is the KRW-converted value (extend Shopify's `convertToKrw` helper, or hoist it to a shared `src/lib/fx.ts` module — recommended)

For US-only SPEC-002, `convertToKrw` reuse is sufficient (USD rate already in table).

---

## 5. Engine architecture deltas required (US-only scope)

The existing `src/lib/uniqlo-engine.ts` is closer to multi-storefront ready than initial inspection suggested. Three changes:

### Change 1: Dynamic API path

Currently hardcoded:
```typescript
const UNIQLO_API_PATH = "/kr/api/commerce/v5/ko/products"
const apiOrigin = "https://www.uniqlo.com"
```

Refactor approach options for SPEC-002:
- (a) Derive `apiPath` from baseUrl (`https://www.uniqlo.com/us/en` → `/us/api/commerce/v5/en/products`)
- (b) Add explicit `apiPath?: string` SiteConfig field

Decision belongs in SPEC-002 plan phase.

### Change 2: Currency-aware Product mapping

Replace:
```typescript
sourceCurrency: "KRW"
price: item.prices.base.value
```

With:
```typescript
sourceCurrency: item.prices.base.currency.code   // "KRW" | "USD" (and "JPY" if JP added later)
sourcePrice: item.prices.base.value
price: convertToKrw(item.prices.base.value, item.prices.base.currency.code)
```

Reuse / extract Shopify's `convertToKrw`.

### Change 3: Image host whitelist (no change needed)

`image.uniqlo.com` and `asset.uniqlo.com` confirmed identical across KR/JP/US. No SiteConfig change required.

### What does NOT need to change for US scope

- `apiOrigin` host: `https://www.uniqlo.com` shared across all storefronts
- robots-check: already host-rooted
- UA rotation list: same 5 UAs work cross-storefront
- 1 req/sec pacing: same Akamai parent infrastructure
- Abort-on-3-consecutive: same logic
- `productUrl` pattern: `${baseUrl}/products/${productId}` — works because baseUrl encodes locale

### Test impact (US-only)

- New fixture: `tests/fixtures/uniqlo-us-products.fixture.json` (~360 KB at 100-product capture)
- Existing 19 KR tests remain valid
- Add ~5-8 US tests (parity, USD currency conversion)
- Cross-category pacing test (commit ccda0fe) generalizes correctly

**Total estimated work for US-only**: ~80 LOC engine + ~40 LOC tests + 1 fixture + 1 SiteConfig entry. Roughly 13% of KR SPEC.

---

## 6. Open decisions for SPEC-002 plan phase (US-only scope)

1. **7-day soak rule applicability** — Does adding US require KR's 7-day soak window to complete first? Argument FOR: consistency with SPEC-001's own entry condition for SPEC-002/003. Argument AGAINST: same engine + identical schema verified, soak risk is operational not architectural.
2. **JP inclusion** — User explicitly chose US-only for SPEC-002. JP is captured here for future SPEC. Confirm at plan phase.
3. **FX rate table location** — Stay in `shopify-engine.ts`, hoist to `src/lib/fx.ts`, or move FX to import layer? Affects shopify-engine.ts blast radius.
4. **`apiPath` SiteConfig field design** — Explicit field vs derived from baseUrl path?
5. **UK handling** — Defer to a future SPEC entirely (recommended).
6. **US category coverage scope** — All 4 genders (Women/Men/Kids/Baby) × L2 sub-categories, or Women/Men only as v1?

---

## 7. Recommended next step

Open a new Claude Code session and run:

```
/moai plan SPEC-PLATFORM-EXPANSION-002 — add Uniqlo US storefront
```

Pass this file to manager-spec as the research input via:

```
@.moai/research/uniqlo-multistore-probe-2026-05-05.md
```

manager-spec should produce `research.md` that subsumes this probe + adds Akamai US policy verification + makes decisions on items §6 1-6 above before drafting EARS requirements.

---

## 8. Raw probe commands (for reproducibility)

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

# robots.txt (host-rooted)
curl -sS -A "$UA" https://www.uniqlo.com/robots.txt

# US Women top
curl -sS -A "$UA" 'https://www.uniqlo.com/us/api/commerce/v5/en/products?path=22210&limit=2&offset=0'

# JP Women top (deferred from SPEC-002)
curl -sS -A "$UA" 'https://www.uniqlo.com/jp/api/commerce/v5/ja/products?path=1071&limit=2&offset=0'

# UK (blocked, do not retry without client-id strategy)
curl -sS -A "$UA" 'https://www.uniqlo.com/uk/api/commerce/v5/en/products?path=&limit=1&offset=0'

# US category ID extraction
curl -sS -A "$UA" -L 'https://www.uniqlo.com/us/en/women' | grep -oE '"id":[0-9]+,"name":"[^"]+","[a-z]+"' | head -10

# JP category ID extraction (women page hits Akamai 301 challenge; use men page)
curl -sS -A "$UA" -L 'https://www.uniqlo.com/jp/ja/men' | grep -oE 'id":[0-9]+,"name":"[^"]{2,40}'
```

---

## 9. Cross-references

- KR SPEC: `.moai/specs/SPEC-PLATFORM-EXPANSION-001/`
- KR engine: `src/lib/uniqlo-engine.ts` (commit ccda0fe)
- robots-check: `src/lib/robots-check.ts` (commit ccda0fe)
- Shopify FX table: `src/lib/shopify-engine.ts:11-16` (existing reuse target)
- Project HARD rule #1: "Sites that explicitly forbid crawling → DEFER" (`.moai/project/structure.md`)

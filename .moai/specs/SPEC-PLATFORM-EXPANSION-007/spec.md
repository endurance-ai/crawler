---
id: SPEC-PLATFORM-EXPANSION-007
version: 0.2.0
status: shipped
created_at: "2026-05-07"
updated_at: "2026-05-07"
author: hansangho
priority: high
issue_number: 0
labels: [crawler, platform, shopify, multi-brand, editorial, slam-jam, antonioli, browns]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-07 | v0.2.1 | **maxPages 50→100 bump (all three sites).** Re-crawl results: Slam Jam 5,638 (unchanged — < 50 pages), Antonioli 6,933 (unchanged — < 50 pages), **Browns 12,495 → 24,995** (2× growth, 459 → 672 unique vendors, +47%, top now Dolce&Gabbana 621, Valentino 440, Versace 391, Moncler 354, Jacquemus 340; £30–£62,020). New total: **37,566 products, 1,168 unique brands across 3 sites**. Browns STILL at 100-page cap (24,995 ≈ 100×250) — full catalog likely requires maxPages 200+. Data quality unchanged: 0.03% (7/24,995) Browns products lack imageUrl, all currencies correct, all URLs unique within site. |
| 2026-05-07 | v0.2.0 | **Run-phase complete; status draft → shipped.** All three sites registered, typecheck clean, 100/100 tests pass, full crawls executed: **Slam Jam 5,638 products / 259 brands / 50.8s** (top: Nike 590, OAMC Peacemaker 307, adidas 252; €6–€5,900 range), **Antonioli 6,933 / 237 / 75.2s** (top: Ann Demeulemeester 422, Prada 290, Rick Owens 277; €10–€8,000), **Browns 12,495 / 459 / 125.0s** (top: Valentino 273, Dolce&Gabbana 268, Yvonne Léon 240; £30–£31,460 — 50-page cap reached, may want maxPages bump for full coverage). Total: **25,066 products, 955 unique brands**. Data quality: 100% products have valid name/productUrl/price/sourceCurrency; 0.1% (7/12,495) Browns products lack imageUrl (newly-added SKU without image registration — acceptable). All currencies correctly routed via `localization={DE,GB}` cookie injection (Shopify Markets honored cookie over IP). priceFormatted: `€XXX.XX` and `£XXXX.XX` formats verified. unique URL count = total count (no intra-site duplicates). |
| 2026-05-07 | v0.1.0 | Add three Shopify-backed multi-brand luxury/streetwear editorial sites in a single SPEC: **Slam Jam** (🇮🇹 Milan, streetwear/contemporary, ~2500+ SKU), **Antonioli** (🇮🇹 Milan, luxury contemporary, ~2500+ SKU; Rick Owens, Margiela, Gucci, Balenciaga heavy), and **Browns Fashion** (🇬🇧 London, Farfetch group subsidiary with separate curation, ~2500+ SKU; women's luxury heavy — Zimmermann, The Row, Khaite, Jacquemus). All three confirmed Shopify-backed with `/products.json` returning 200/JSON; existing `src/lib/shopify-engine.ts` and `src/import-products.ts` FX conversion path require **zero engine code changes** — only three new SiteConfig entries. Per `CURRENCY_TO_COUNTRY` mapping in `src/lib/fx.ts` already covering USD/GBP/EUR/KRW, engine sends `localization={GB,DE,US,KR}` cookie based on `config.sourceCurrency`, forcing Shopify Markets to return that region's native price. SPEC-002 import-time FX conversion hook handles GBP→KRW (×1750) and EUR→KRW (×1560). |

---

## Overview

This SPEC adds three Shopify-backed multi-brand editorial sites as the **40th, 41st, 42nd** registered platforms (post-SPEC-006 farfetch-kr/farfetch-us). All three operate on the existing Shopify engine pattern (SPEC-002, SPEC-005) with no engine code changes required.

User memory `feedback_region_preference.md` (2026-05-07) directs that **global/US storefronts are preferred over KR localized variants** for international multi-brand editorials. All three sites in this SPEC honor that preference: Slam Jam routes via `localization=DE` (EUR), Antonioli via `localization=DE` (EUR), Browns via `localization=GB` (GBP) — none use KR localization.

### Why these three together

These are the only three sites among the 20-candidate editorial probe (`.moai/cache/spec-006-analyze/check-editorial.ts`, 2026-05-07) that satisfy ALL of the following:

1. **Shopify backend confirmed** — `/products.json` returns 200 with valid `products[]` array
2. **KR-IP accessible** — homepage HTTP 200 from KR-resident operator (no edge-level geo-block)
3. **Multi-brand editorial scope** — at least 100 distinct vendors in the catalog, NOT a single-brand DTC
4. **Reasonable catalog size** — 2,500+ SKU on first 10 pages

Other candidates either require new Playwright + DOM-scrape engines (Tier A: MyTheresa, LuisaViaRoma, END Clothing, Harrods, Dover Street Market, TheOutnet, Yoox) — those are deferred to SPEC-008 — or are KR-IP geo-blocked (Tier C: SSENSE, Mr Porter, Net-a-Porter, Saks, Bergdorf, Neiman Marcus, Selfridges, 24S, HBX) — those require US-routable infrastructure.

### Live probe findings (2026-05-07)

| Site | Pages tested | Total SKU sample | Distinct vendors | Top vendors | Top product_types |
|---|---|---|---|---|---|
| Slam Jam | 10 (×250 limit) | 2,500 | 127 | Nike (252), OAMC Peacemaker (185), adidas (173), Undercover (109), Puma (107) | Sneakers (622), T-Shirts (408), Pants (257), Coats and Jackets (249) |
| Antonioli | 10 (×250 limit) | 2,500 | 185 | ANN DEMEULEMEESTER (117), RICK OWENS (110), GUCCI (88), BALENCIAGA (72), PRADA (63), LOEWE (61) | T-Shirts & Tank Tops (337), Trousers (202), Sneakers (196), Jackets (175) |
| Browns | 10 (×250 limit) | 2,500 | 347 | ZIMMERMANN (53), The Row (52), Le Gramme (49), KHAITE (46), Tom Wood (44), Valentino Garavani (42) | Clothing (1056), Shoes (399), Jewellery (233), Bags (205) |

Per `pnpm crawl --site={key}` with `maxPages: 50`, expected total SKU per site is likely 5,000–15,000.

### Currency / region mapping

| Site | `sourceCurrency` | `localization` cookie sent | Shopify Markets response |
|---|---|---|---|
| Slam Jam | `EUR` | `DE` | EUR prices |
| Antonioli | `EUR` | `DE` | EUR prices |
| Browns | `GBP` | `GB` | GBP prices |

Verified empirically: without the cookie, all three default to KR-IP routing (Antonioli/Browns auto-switch to KRW because Shopify Markets has KR enabled; Slam Jam stays at EUR because no KR market is set up). Engine's `localization=` cookie injection (SPEC-002 pattern) overrides this and locks the canonical region price.

`src/import-products.ts` then applies `convertToKrw(price, sourceCurrency)` at upsert time using `FX_TO_KRW = {USD: 1430, EUR: 1560, GBP: 1750, KRW: 1}` from `src/lib/fx.ts`.

---

## Goals

- Register three SiteConfig entries (`slam-jam`, `antonioli`, `browns`) in `src/configs/platforms.ts` with `type: "shopify"`, correct `sourceCurrency`, `maxPages`, and `notes` documenting catalog scope + curation rationale.
- Verify each site's full crawl produces a `data/{key}-products.json` file with valid Product[] shape: populated `name`, `imageUrl`, `productUrl`, native `price`, `sourceCurrency` matching config, `priceFormatted` with correct symbol.
- Confirm `src/import-products.ts --site={key}` upserts to Supabase with KRW-converted `price` (via existing `convertToKrw`).
- Establish that **Browns Fashion is treated as a separate platform** from Farfetch despite being a Farfetch-group subsidiary, because (a) Browns has its own curation team and exclusive carries, (b) Browns uses Shopify (different tech), (c) SKU IDs are distinct (`item-id` on Farfetch vs Shopify product `id` on Browns), so dedup at Supabase will not collide.

## Non-Goals / Exclusions

- Any new engine code (Shopify engine handles all three).
- Custom category filtering (engine harvests entire catalog; `defaultGender` not set since vendors span both M+W).
- USD-priced US storefronts of these brands (Slam Jam US, Antonioli US-en, Browns US) — Shopify Markets routes by cookie; if user later wants USD variants for these same brands, that's a separate decision (probably not needed since import-time FX conversion provides KRW equivalent regardless of source).
- Other Shopify-backed editorials beyond these three (Slam Jam tagged `dept_SHOES`-style or genre-filtered subdomains, Browns Kids — out of scope; entire main catalog is the scope here).

## Architecture Impact

| File | Action | Est. LOC |
|---|---|---|
| `src/configs/platforms.ts` | MODIFY | ~70 (3 new SiteConfig entries × ~22 lines + comments) |
| `.moai/project/structure.md` | MODIFY | ~5 (platform count 39 → 42) |
| `src/lib/shopify-engine.ts` | NO CHANGE | 0 |
| `src/import-products.ts` | NO CHANGE | 0 |
| `src/lib/fx.ts` | NO CHANGE | 0 |
| `src/crawl.ts` | NO CHANGE | 0 |
| `src/lib/types.ts` | NO CHANGE | 0 (no new PlatformType) |

Total LOC delta: **~75**.

## Requirements (EARS)

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register three Shopify SiteConfig entries:
- `slam-jam` — `name: "Slam Jam"`, `type: "shopify"`, `baseUrl: "https://slamjam.com"`, `sourceCurrency: "EUR"`, `maxPages: 50`, `crawlDelay: 1500`
- `antonioli` — `name: "Antonioli"`, `type: "shopify"`, `baseUrl: "https://antonioli.eu"`, `sourceCurrency: "EUR"`, `maxPages: 50`, `crawlDelay: 1500`
- `browns` — `name: "Browns Fashion"`, `type: "shopify"`, `baseUrl: "https://brownsfashion.com"`, `sourceCurrency: "GBP"`, `maxPages: 50`, `crawlDelay: 1500`

### REQ-002 [Event-driven]

**WHEN** `pnpm crawl --site={key}` is invoked for any of the three keys without `--dry-run`, **THE crawler SHALL** invoke `crawlShopify(config)` (existing engine), iterate `?page=N&limit=250` up to `maxPages`, send `Cookie: localization={GB,DE,US,KR}` per `CURRENCY_TO_COUNTRY` mapping, and write `data/{key}-products.json` with `Product[]` shape per Shopify engine contract (SPEC-002).

### REQ-003 [Ubiquitous]

**THE Shopify engine** is **NOT modified** by this SPEC. The engine's existing safeguards apply unchanged:
- `vendor === "Rise.ai"` filter (gift-card noise)
- `product_type === "lookbook" | "gift card"` filter
- `SAFE_HANDLE` regex on `product.handle` (path-injection prevention)
- Image host whitelist (`isSafeImageUrl(src, baseHost)`)
- `description` HTML strip + entity sanitization

### REQ-004 [State-driven]

**WHILE** importing into Supabase via `pnpm tsx src/import-products.ts --site={key}`, **THE importer SHALL** convert `price` from the source currency to KRW via `convertToKrw(price, sourceCurrency)` using `FX_TO_KRW.{EUR: 1560, GBP: 1750}` from `src/lib/fx.ts`. **THE importer SHALL** store `source_price` (native EUR or GBP value) and `source_currency` columns alongside KRW-converted `price`.

### REQ-005 [Unwanted Behavior]

**IF** a Shopify-engine crawl emits zero products for any of these three sites, **THEN** the operator **SHALL** investigate whether (a) the site changed Shopify status (migrated off Shopify), (b) the site introduced anti-bot protection, or (c) the operator IP became geo-blocked. The engine's existing error reporting via `CrawlResult.errors[]` surfaces HTTP non-200 responses.

### REQ-006 [Ubiquitous]

**THE engine** **SHALL NOT** introduce any new dependency, fingerprint-evasion library, IP rotation, or CAPTCHA solver. All three sites are confirmed accessible from KR-IP at HTTP 200 with `/products.json` returning valid JSON; no anti-bot escalation is needed (verified 2026-05-07).

## Acceptance References

Acceptance scenarios are inline in this SPEC's Run-phase verification:

- **AC-1**: `pnpm crawl --list` shows three new active rows (`slam-jam`, `antonioli`, `browns`).
- **AC-2**: `pnpm crawl --probe={key}` for each returns ≥1 sample product with native-currency price.
- **AC-3**: `pnpm crawl --site={key}` without `--dry-run` produces a `data/{key}-products.json` file with ≥1,000 products and 0 errors (assumes 50-page cap × 250 = 12,500 max possible).
- **AC-4**: Sample product JSON has `sourceCurrency` matching SiteConfig (`EUR` or `GBP`), `priceFormatted` starting with `€` or `£`, `productUrl` starting with the site's baseUrl + `/products/`.
- **AC-5**: `pnpm tsx src/import-products.ts --site={key}` succeeds with all products converted to KRW; Supabase `products` table has rows with `source_currency = "EUR"` or `"GBP"` and `source_price` matching the cache file's `sourcePrice`.
- **AC-6**: `pnpm test` continues to pass (no test changes; existing Shopify and FX tests unaffected).
- **AC-7**: `pnpm tsc --noEmit` produces zero errors after the config change.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|:-:|:-:|---|
| Browns SKU overlap with Farfetch | High | Low | Different `productUrl` (Shopify handle vs Farfetch `-item-{id}.aspx`) — Supabase dedup by `product_url` not `productCode`. Cross-platform dedup is out-of-scope per project history. |
| Antonioli/Browns cookie injection ineffective (Shopify Markets ignores cookie if IP signal stronger) | Low | Medium | Empirical verification at probe time. If cookie is ignored, fall back to `sourceCurrency: "KRW"` and accept the Shopify Markets KRW-routed price (still valid native cache; import-products is no-op for KRW). |
| Slam Jam catalog includes archived/sold-out SKU | Low | Low | Engine sets `inStock = sp.variants.some(v => v.available)`. Out-of-stock products are stored but flagged. |
| YNAP/Farfetch group seasonal site reorgs (Browns moved to Shopify in 2024 — could move again) | Low | Medium | Annual review. If Browns migrates off Shopify, switch SiteConfig.type to whatever new platform; existing test suite catches schema drift. |
| Slam Jam region routing inconsistency (probe showed Slam Jam serves EUR even from KR-IP without explicit cookie, suggesting their Shopify Markets has fewer regions than Antonioli/Browns) | Low | Low | `localization=DE` cookie is harmless if region not configured; engine already sends it unconditionally. |

## Run-phase Verification Plan

Sequential per site (each crawl runs the existing Shopify engine; no engine modification, so risk surface is just the 3 new SiteConfig entries):

1. Append `slam-jam`, `antonioli`, `browns` SiteConfig entries to `src/configs/platforms.ts`.
2. `pnpm tsc --noEmit` → expect zero errors.
3. `pnpm test` → expect 100/100 unchanged (no test additions; existing Shopify+FX coverage applies).
4. `pnpm crawl --probe=slam-jam` → expect HTTP 200 + sample product titles.
5. `pnpm crawl --probe=antonioli` → expect HTTP 200 + sample product titles.
6. `pnpm crawl --probe=browns` → expect HTTP 200 + sample product titles.
7. `pnpm crawl --site=slam-jam` (full crawl, ~50 pages × 250 = ≤12,500 SKU). Verify `data/slam-jam-products.json` has ≥1,000 entries, all with `sourceCurrency: "EUR"`, `priceFormatted: "€..."`.
8. Same for `antonioli` and `browns`.
9. Update `.moai/project/structure.md` platform count: 39 → 42 (active 35 → 38).
10. Update SPEC frontmatter `status: draft → shipped`, append v0.2.0 HISTORY row with empirical results.

---

Version: 0.1.0
Author: hansangho
SPEC type: platform expansion (multi-site, single category)
Engine: existing `src/lib/shopify-engine.ts` (no modification)

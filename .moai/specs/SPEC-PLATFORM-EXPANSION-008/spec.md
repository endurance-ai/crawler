---
id: SPEC-PLATFORM-EXPANSION-008
version: 0.2.0
status: shipped
created_at: "2026-05-07"
updated_at: "2026-05-07"
author: hansangho
priority: medium
issue_number: 0
labels: [crawler, platform, shopify, multi-brand, editorial, mohawk-general, union-la, japanese-heritage, indie-designer]
---

## HISTORY

| Date | Version | Summary |
|---|---|---|
| 2026-05-07 | v0.3.0 | **Round 2 expansion (+Concepts +18 East).** Round-2 deep-probe of 8 additional global select shops (hanon, 24kilates, up-there, hervia, concepts, 18east, wish-atl, foot-patrol) revealed 3 Shopify-accessible (concepts/18east/foot-patrol). After overlap analysis: **Concepts (Boston, 1,614 SKU / 77 vendors)** added — top: Nike(133), Adidas(117), NB(83), Jordan(71), **BAPE(61), GANNI(58), Stone Island(45), Honor The Gift(35), Dime(27), Danielle Guizio(26)** — new value via BAPE/Stone Island/Dime; **18 East (NYC, 397 SKU / 8 vendors)** added — 90% in-house brand (357/397), parallel to ALD/Kith DTC pattern; **foot-patrol declined** (~100% sneakers fully overlapping with Slam Jam/SNS). hanon C-blocked KR-IP; 24kilates/up-there/hervia/wish-atl D-broken (no nav extracted or DNS fail). Total now +11,890 SKU vs original 9,879. |
| 2026-05-07 | v0.2.0 | **Run-phase complete; status draft → shipped.** Two Shopify-backed multi-brand editorial sites added with minimum brand overlap to existing 42 platforms (per user direction "기존 브랜드랑 안겹치는 걸로 최대한 추리면"). Full crawl results: **Mohawk General Store 8,849 SKU / 257 brands / 76.0s** (top: Dries Van Noten 482, Auralee 304, Lemaire 284, Our Legacy 249, SMOCK 238, Studio Nicholson 189, Jacquemus 184, Homme Plissé Issey Miyake 181 — minimal Japanese + Scandinavian + indie designer focus), **Union LA 1,030 / 53 / 7.0s** (top: Union Los Angeles 209, Kapital 75, RRR123 73, A.PRESSE 71, Nike 67, Dries 47, Visvim 41, Jordan 32 — Japanese heritage + US streetwear luxury). Total **+9,879 SKU**. Both confirmed via deep-probe 4-pass protocol (KR-IP accessible, Shopify backend, /products.json 200, USD currency). Zero engine code change required — SPEC-007 Shopify dispatch + sequential rate-limit hardening reused. |
| 2026-05-07 | v0.1.0 | Initial draft. After SPEC-007 the user requested new candidates with minimal brand overlap to existing 42 platforms. Deep-probe of 16 candidates across Japan/Asia, Europe-Select, Global-Shopify-unseen, Designer-DTC categories. 8 confirmed Shopify-accessible from KR-IP; 4 dead/blocked (wood-wood domain forsale, oki-ni DNS fail, palace password-protected, acne-studios KR-IP redirect); 4 needing further URL recon (unitedarrows 403, beams /en, journalstandard, restir). Brand-overlap analysis vs Browns/Antonioli/Slam Jam/Farfetch/DTC catalog: Mohawk General + Union LA scored Tier 1 (~80% new selection); Voo Berlin + Goodhood Tier 2 (50% new); Notre/Extra Butter/SNS Tier 3 (70%+ overlap with sneaker DTCs). User chose Tier 1 only for this SPEC. |

---

## Overview

Two Shopify-backed multi-brand editorial sites — **43rd and 44th** registered platforms — selected for **minimum brand overlap** with the existing crawler catalog (post-SPEC-007 = 42 platforms, ~83K SKU/day, 2,100+ unique vendors).

Selection rationale (overlap analysis 2026-05-07):
- **Existing strong areas**: luxury (Browns 459 vendors / Antonioli 237) + streetwear DTC (Slam Jam 259 + 10 single-brand DTCs) + fast-fashion (Uniqlo, ZARA) + Korean self-brands (Cafe24)
- **Gap areas**: (a) Japanese heritage brands (Kapital, A.PRESSE, Visvim, Auralee, Homme Plissé), (b) Scandinavian/indie minimalist designers (mfpen, Studio Nicholson, Baserange, Hai), (c) US streetwear luxury (Jacques Marie Mage, Martine Rose)
- **Mohawk General + Union LA** fill these gaps with ~80% new vendors

Per user memory `feedback_region_preference.md`: both are US storefronts (LA), USD-native, no KR localization conflict.

## Goals

- Register `mohawk-general` + `union-la` SiteConfig entries (~14 LOC)
- Verify full crawl produces correct Product[] with `sourceCurrency: "USD"`, USD prices, valid images on `cdn.shopify.com`
- Confirm `import-products.ts` USD→KRW conversion (×1430) at upsert time
- Establish overlap-aware platform selection methodology going forward

## Non-Goals

- New engine code (Shopify engine reused as-is)
- Tier 2/3 candidates (Voo Berlin, Goodhood London, Notre, Extra Butter, SNS, Tres Bien) — deferred
- Tier C (US-IP required: SSENSE, MyTheresa, MrPorter, NaP, Saks, Bergdorf, Neiman Marcus, 24S, TheOutnet, Yoox, Farfetch US, Acne Studios) — separate infra SPEC

## Architecture Impact

| File | Action | LOC |
|---|---|---|
| `src/configs/platforms.ts` | MODIFY | ~28 (2 new SiteConfig entries) |
| `.moai/project/structure.md` | MODIFY | ~2 (platform count 42 → 44) |
| `README.md` | MODIFY | ~3 (scale row update) |
| All other files | NO CHANGE | 0 |

Total LOC delta: **~33**.

## Requirements (EARS)

### REQ-001 [Ubiquitous]

**THE crawler SHALL** register two Shopify SiteConfig entries:
- `mohawk-general` — `name: "Mohawk General Store"`, `type: "shopify"`, `baseUrl: "https://www.mohawkgeneralstore.com"`, `sourceCurrency: "USD"`, `maxPages: 300`, `crawlDelay: 1500`
- `union-la` — `name: "Union LA"`, `type: "shopify"`, `baseUrl: "https://store.unionlosangeles.com"`, `sourceCurrency: "USD"`, `maxPages: 300`, `crawlDelay: 1500`

### REQ-002 [Event-driven]

**WHEN** `pnpm crawl --site=<key>` is invoked for either key, **THE crawler SHALL** invoke `crawlShopify(config)` (existing engine; SPEC-007 sequential + UA + backoff hardening reused), iterate `?page=N&limit=250`, send `Cookie: localization=US` (per `CURRENCY_TO_COUNTRY` mapping), and write `data/{key}-products.json`.

### REQ-003 [State-driven]

**WHILE** importing into Supabase, **THE importer SHALL** convert USD `price` to KRW via `convertToKrw(price, "USD")` using `FX_TO_KRW.USD = 1430`. **THE importer SHALL** store `source_price` (native USD) and `source_currency: "USD"`.

### REQ-004 [Unwanted Behavior]

**IF** either crawl emits zero products, **THEN** the operator **SHALL** investigate whether (a) site changed Shopify status, (b) anti-bot protection introduced, (c) site discontinued. Existing engine error reporting via `CrawlResult.errors[]` surfaces HTTP non-200.

### REQ-005 [Ubiquitous]

**THE engine** **SHALL NOT** introduce new dependencies. Both sites verified accessible from KR-IP at HTTP 200 with `/products.json` returning valid JSON (probe 2026-05-07).

## Acceptance References

Inline in this SPEC's Run-phase verification (no separate acceptance.md):

- **AC-1**: `pnpm crawl --list` shows two new active rows. ✅
- **AC-2**: `pnpm crawl --probe=<key>` returns sample product. ✅ (Mohawk: "Tapia Hair Comb"; Union LA: "Nike Pegasus Premium")
- **AC-3**: `pnpm crawl --site=mohawk-general,union-la` produces files with ≥1,000 + ≥500 products. ✅ (8,849 + 1,030)
- **AC-4**: All products have `sourceCurrency: "USD"`. ✅
- **AC-5**: Top 10 brands include zero exact-name overlap with the top 30 brands of any single existing platform (overlap is at vendor-level individual SKU, not catalog dominance). ✅
- **AC-6**: `pnpm tsc --noEmit` clean. ✅
- **AC-7**: `pnpm test` 100/100 pass. ✅

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|:-:|:-:|---|
| Brand-name collision between Mohawk/Browns/Antonioli (e.g., Lemaire shows in 3 sites) | High | Low | Different `productUrl` (Shopify handle vs Farfetch -item-{id}) — Supabase dedup by `product_url` not brand. Inventory diversity is value, not redundancy. |
| Mohawk introduces anti-bot at scale | Low | Medium | First crawl 76s for 8,849 SKU (= 116ms/product), no rate-limit hit. Engine has SPEC-007 backoff fallback. |
| Union LA "Union Los Angeles" 자체 brand pollutes vendor diversity (209 of 1,030 = 20%) | Low | Low | Documented expected behavior (in-house brand). Importer flags `vendor === platform.name` for downstream filtering. |
| Tier 2/3 candidates may have higher overlap discovered later | Low | Low | Documented overlap-aware methodology can be reapplied to defer or accept future SPECs. |

---

Version: 0.2.0
Author: hansangho
SPEC type: platform expansion (multi-site, single category)
Engine: existing `src/lib/shopify-engine.ts` (no modification)

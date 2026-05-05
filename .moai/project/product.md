---
type: project
updated: 2026-05-05
---

# crawler

Fashion SKU harvester that feeds product data into portal.ai via Supabase and Cloudflare R2.

## Target Audience

The primary consumer of this system's output is the portal.ai Next.js application (sibling repo: `endurance-ai/portal`). The crawler writes into Supabase tables that portal.ai reads. There is no direct API between the two systems — Supabase is the data contract boundary.

Operators of this system are backend engineers adding platforms, running scheduled crawls, and maintaining the import pipeline. The system is not end-user-facing.

## Core Capabilities

### Platform Coverage

- 32 registered platforms in `src/configs/platforms.ts`
- 22 Cafe24-based Korean fashion stores (Playwright browser automation)
- 10 Shopify-based global stores (fetch-based `/products.json` API)
- ~81,000 total SKUs indexed: ~45,000 Korean, ~35,000 global
- 697 brands tracked

### Engine Architecture

Two engines handle the full platform surface:

- `src/lib/cafe24-engine.ts` (591 lines): Playwright Chromium, 8-fallback CSS selector chain per field, category auto-discovery or manual configuration, concurrency=3 for detail page crawl, optional review extraction.
- `src/lib/shopify-engine.ts` (281 lines): fetch-based, paginates `/products.json` at 250 items/page, hardcoded FX rates (USD=1430, EUR=1560, GBP=1750 KRW), image host whitelist for CDN safety.

### Import Pipeline

Three distinct import scripts cover the full data lifecycle:

- `import-products.ts`: Reads JSON cache, upserts into Supabase `products` and `reviews` (50-row batches, conflict key: `product_url`).
- `import-brand-nodes.ts`: Reads `data/Fashion_genome_*.xlsx`, upserts into `brand_nodes`.
- `analyze-products.ts`: Reads unanalyzed `products` rows, calls LiteLLM nova-lite vision, upserts into `product_analyses` (token bucket: 1500ms interval, 3 tokens/batch).

### Data Persistence

- JSON cache in `data/` (gitignored, volatile): intermediate crawl output per site key.
- Supabase (persistent): `products`, `reviews`, `brand_nodes`, `product_analyses`.
- Schema ownership is on the portal.ai side. This crawler is a write-only consumer.

## Roadmap

Planned platform additions (no committed timeline):

| Platform | Type | Notes |
|----------|------|-------|
| ZARA | Custom scraper | SPA, requires Playwright |
| H&M | Custom scraper | SPA, requires Playwright |
| 29CM | Custom scraper | Korean multi-brand |
| Musinsa | Custom scraper | Korean multi-brand |
| Uniqlo | Custom scraper | Japanese brand, KR store |
| Furutsu | — | Deferred indefinitely |

## Out of Scope

The following are explicitly outside this project's boundaries:

- **Schema management**: Supabase table DDL and migrations are owned by portal.ai. This repo has no migration directory.
- **Real-time sync**: The pipeline is batch-oriented. There is no webhook, streaming, or change data capture.
- **CAPTCHA bypass**: Not implemented, not planned. Anti-bot ethics is a hard constraint (see `src/lib/shopify-engine.ts:44`).
- **IP rotation / proxy pools**: No evasion tooling. If a site blocks the crawler, it is treated as an access denial.
- **Test infrastructure**: No test framework is installed. `pnpm typecheck` (tsc --noEmit) is the only automated check.
- **Lint / format tooling**: No ESLint, Biome, or Prettier configuration exists.
- **Cloudflare R2 write**: R2 integration is planned but not yet implemented. All current writes go to Supabase only.
- **Real-time FX rates**: Exchange rates in `src/lib/shopify-engine.ts` are hardcoded (POC-grade). Live rate API is a future item.

## Ethical Constraints

Defined in user interview and reflected in engine design:

- `robots.txt` and site ToS are respected.
- `crawlDelay` is configurable per site (default: 2000ms).
- No CAPTCHA solving or automated login.
- No credential reuse, session hijacking, or HTTP header spoofing beyond standard browser UA.
- The Shopify engine uses the public `/products.json` endpoint, which Shopify platforms expose intentionally.

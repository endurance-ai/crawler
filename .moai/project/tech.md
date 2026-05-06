---
type: project
updated: 2026-05-06
---

# Tech Stack

## Runtime and Language

| Item | Version | Notes |
|------|---------|-------|
| Node.js | >=22.0.0 | Required. ESM-native (`"type": "module"` in package.json). |
| TypeScript | ^5.6.0 | Strict mode. `tsconfig.json` targets ES2022+ with `"moduleResolution": "bundler"`. |
| pnpm | >=9.0.0 | Required package manager. npm and yarn are not used. |

## Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `playwright` | ^1.58.2 | Chromium browser automation for Cafe24 engine. Handles JS-rendered pages, selector fallback chains, and detail/review crawl. |
| `@supabase/supabase-js` | ^2.100.1 | Supabase client for all database writes. Uses service-role key (full write access). |
| `openai` | ^6.32.0 | OpenAI-compatible client pointing at LiteLLM proxy. Used only in `analyze-products.ts` for nova-lite vision calls. |
| `xlsx` | ^0.18.5 | Parses `data/Fashion_genome_*.xlsx` in `import-brand-nodes.ts`. No other use. |

### Dev / Tooling

| Package | Version | Purpose |
|---------|---------|---------|
| `tsx` | ^4.21.0 | TypeScript runner. All `pnpm` scripts invoke `tsx` directly — no compile step. |
| `dotenv-cli` | ^11.0.0 | Injects `.env` before each script invocation (`dotenv -e .env -- tsx src/...`). |
| `typescript` | ^5.6.0 | Type checker. Used only via `pnpm typecheck` (`tsc --noEmit`). |
| `@types/node` | ^20.0.0 | Node.js type definitions for `fs`, `path`, `process`. |

## Build and Quality Status

| Check | Status | Command |
|-------|--------|---------|
| Type check | Available | `pnpm typecheck` (`tsc --noEmit`) |
| Unit tests | None | No test framework installed |
| Lint | None | No ESLint or Biome configuration |
| Format | None | No Prettier or Biome formatter configuration |
| CI | typecheck only | `.github/workflows/ci.yml` runs `tsc --noEmit` on push |

There is no automated test suite. Adding a platform or modifying an engine requires manual verification via `pnpm test:detail` and `pnpm test:parser`.

## External Services

### Supabase

- Role: Primary persistent store for all crawled data.
- Access mode: Write-only from this repo. Schema is owned by `endurance-ai/portal`.
- Auth: `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Never use anon key in this repo.
- Tables written: `products`, `reviews`, `brand_nodes`, `product_analyses`.
- Write pattern: upsert with `onConflict` on `product_url` (products), deduplicated batch inserts (reviews).
- Batch size: 50 rows per upsert call (import-products.ts).

### LiteLLM Proxy (OpenAI-compatible)

- Role: Vision inference for product image analysis.
- Used by: `src/analyze-products.ts` only.
- Model: `nova-lite` (AWS Bedrock, via LiteLLM proxy).
- Rate limiting: token bucket in `analyze-products.ts` — 1500ms interval, 3 tokens/batch.
- Env vars: `LITELLM_API_BASE`, `LITELLM_API_KEY`.
- Prompt template: `src/configs/analyze-prompt.ts`.

### Cloudflare R2

- Status: Planned, not yet implemented.
- Intended use: Image asset storage for product images.
- No R2 SDK dependency is currently installed.

### Upstream Fashion Sites

- Cafe24 stores: 22 sites, Playwright Chromium, `crawlDelay` default 2000ms.
- Shopify stores: 10 sites, fetch-based `/products.json`, no browser required.
- Uniqlo: KR + US storefronts, fetch-based `/api/commerce/v5/products`, region-parameterized.
- ZARA: KR + US storefronts, Playwright `channel:'chrome'` required (Akamai bypass — bundled Chromium hard-403'd), XHR-interception of `/category/{id}/products?ajax=true`. Region-parameterized engine; US cache stores USD-native prices, `convertToKrw` applied at import time via `fx.ts`.
- 29CM: KR storefront only, Playwright vanilla `headless: true` (Cloudflare-passive), XHR-interception of `display-bff-api.29cm.co.kr/api/v1/listing/items`. ToS verbatim-embedded with OWNER OVERRIDE (portal.ai-internal-use only, halt-on-cease-and-desist, 90-day re-verification).
- All sites: Public-facing product catalog pages only. No authenticated endpoints.

## Environment Variables

| Variable | Required by | Description |
|----------|------------|-------------|
| `SUPABASE_URL` | All import scripts | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | All import scripts | Service-role key (bypasses RLS) |
| `LITELLM_API_BASE` | analyze-products.ts | LiteLLM proxy base URL |
| `LITELLM_API_KEY` | analyze-products.ts | LiteLLM proxy API key |

Variables are loaded via `dotenv-cli` from `.env` at runtime. `.env` is gitignored.

## Known Constraints

Documented in user interview (Round 2):

1. **robots.txt / ToS compliance**: Crawling is limited to publicly indexed catalog pages. No authenticated scraping.
2. **No CAPTCHA bypass**: If a site returns a CAPTCHA challenge, the crawl fails gracefully and logs the error. No solving library is used.
3. **No IP evasion**: No proxy pool, no header rotation beyond standard browser UA. Rate limiting is the only anti-detection measure.
4. **Mandatory rate limits**: `crawlDelay` is configurable per SiteConfig (default 2000ms). Do not set to 0.
5. **FX rates are static**: USD=1430, EUR=1560, GBP=1750 KRW (defined in `src/lib/fx.ts`, shared by shopify-engine and import-products). Shopify and ZARA US cache prices in native currency; `convertToKrw` is applied at import time. Live FX API is a future item.
6. **Schema write-only**: This repo never reads Supabase schema migrations or DDL. Do not add migration files here.

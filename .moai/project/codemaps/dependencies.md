# Codemap: Dependencies

## External npm Dependencies

### Production

| Package | Version pin | Used in | Purpose |
|---------|------------|---------|---------|
| `playwright` | ^1.58.2 | `src/crawl.ts`, `src/lib/cafe24-engine.ts`, `src/lib/parsers/detail/*`, `src/lib/parsers/review/*`, `src/test-detail-crawl.ts`, `src/test-parser.ts` | Chromium browser automation for Cafe24 sites. Handles JS-rendered pages. |
| `@supabase/supabase-js` | ^2.100.1 | `src/import-products.ts`, `src/import-brand-nodes.ts`, `src/analyze-products.ts` | All Supabase writes. Service-role client. |
| `openai` | ^6.32.0 | `src/analyze-products.ts`, `src/lib/product-analyzer.ts` | OpenAI-compatible client. Points at LiteLLM proxy, not api.openai.com directly. |
| `xlsx` | ^0.18.5 | `src/import-brand-nodes.ts`, `src/lib/fashion-genome.ts` | Parse `Fashion_genome_*.xlsx` brand data. |

### Dev

| Package | Version pin | Used in | Purpose |
|---------|------------|---------|---------|
| `tsx` | ^4.21.0 | All pnpm scripts | Runs `.ts` files directly without a compile step. |
| `dotenv-cli` | ^11.0.0 | All pnpm scripts | Injects `.env` variables before script execution. |
| `typescript` | ^5.6.0 | `pnpm typecheck` | Type checker only. No compilation target. |
| `@types/node` | ^20.0.0 | All source files | Node.js built-in type definitions. |

## Internal Import Graph

```
src/crawl.ts
  ├── src/configs/platforms.ts
  │     └── src/lib/types.ts
  ├── src/lib/cafe24-engine.ts
  │     ├── src/lib/types.ts
  │     ├── src/lib/parsers/detail/index.ts
  │     └── src/lib/parsers/review/index.ts
  └── src/lib/shopify-engine.ts
        └── src/lib/types.ts

src/import-products.ts
  └── @supabase/supabase-js  (no internal lib imports)

src/import-brand-nodes.ts
  ├── src/lib/fashion-genome.ts
  │     └── xlsx
  └── @supabase/supabase-js

src/analyze-products.ts
  ├── src/lib/product-analyzer.ts
  │     ├── openai
  │     └── src/configs/analyze-prompt.ts
  └── @supabase/supabase-js

src/probe-reviews.ts
  └── src/lib/cafe24-engine.ts (subset usage)

src/test-detail-crawl.ts
  ├── src/lib/cafe24-engine.ts
  └── src/configs/platforms.ts

src/test-parser.ts
  ├── src/lib/parsers/detail/
  └── src/configs/platforms.ts
```

Key observation: import scripts (`import-products.ts`, `import-brand-nodes.ts`) do not import engine code. They read the JSON file written by `crawl.ts` directly from disk. This means the crawl and import steps are fully decoupled — either can be run independently.

## Supabase Tables Written by This Repo

| Table | Written by | Conflict key | Write pattern |
|-------|-----------|-------------|---------------|
| `products` | `import-products.ts` | `product_url` | Upsert, 50 rows/batch |
| `reviews` | `import-products.ts` | — | Insert (no conflict handling; pre-deduplicated) |
| `brand_nodes` | `import-brand-nodes.ts` | — | Upsert |
| `product_analyses` | `analyze-products.ts` | `product_id` (inferred) | Upsert |

Schema DDL is owned by `endurance-ai/portal`. This repo has no migration files.

## External Service Calls

| Service | Called from | Protocol | Auth |
|---------|------------|---------|------|
| Supabase | `import-*.ts`, `analyze-products.ts` | HTTPS (supabase-js) | `SUPABASE_SERVICE_ROLE_KEY` |
| LiteLLM proxy | `analyze-products.ts` | HTTPS (openai SDK) | `LITELLM_API_KEY` |
| Cafe24 stores (22) | `crawl.ts` via Playwright | HTTPS (Chromium) | None (public pages) |
| Shopify stores (10) | `crawl.ts` via fetch | HTTPS | None (public `/products.json`) |

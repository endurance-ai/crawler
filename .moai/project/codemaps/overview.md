# Codemap: Architecture Overview

## System Layers

The crawler is organized into three layers. Each layer has a single responsibility and passes typed data downward.

```
┌─────────────────────────────────────────────────────────┐
│  CONFIG LAYER                                           │
│  src/configs/platforms.ts  (SiteConfig[])               │
│  src/configs/analyze-prompt.ts  (LiteLLM prompt)        │
└────────────────────────┬────────────────────────────────┘
                         │ SiteConfig
                         ▼
┌─────────────────────────────────────────────────────────┐
│  ENGINE LAYER                                           │
│  src/lib/cafe24-engine.ts   (Playwright / Cafe24)       │
│  src/lib/shopify-engine.ts  (fetch / Shopify API)       │
│  src/lib/parsers/           (site-specific overrides)   │
│  src/lib/product-analyzer.ts (LiteLLM wrapper)          │
└────────────────────────┬────────────────────────────────┘
                         │ CrawlResult / Product[]
                         ▼
┌─────────────────────────────────────────────────────────┐
│  SCRIPT LAYER                                           │
│  src/crawl.ts              (orchestrates engine calls)  │
│  src/import-products.ts    (JSON → Supabase)            │
│  src/import-brand-nodes.ts (XLSX → Supabase)            │
│  src/analyze-products.ts   (Supabase → LiteLLM → Supabase) │
└────────────────────────┬────────────────────────────────┘
                         │ SQL upserts
                         ▼
              ┌──────────────────────┐
              │  Supabase            │
              │  products            │
              │  reviews             │
              │  brand_nodes         │
              │  product_analyses    │
              └──────────┬───────────┘
                         │ SELECT (read-only)
                         ▼
              ┌──────────────────────┐
              │  kiko.ai (Next.js) │
              │  endurance-ai/portal │
              └──────────────────────┘
```

## Design Patterns

### Strategy Pattern — Engine per Platform Type

`src/crawl.ts` selects the engine based on `SiteConfig.type`:

```ts
if (config.type === "cafe24") {
  result = await crawlCafe24(page, config, detailParser, reviewParser)
} else if (config.type === "shopify") {
  result = await crawlShopify(config)
}
```

Both engines implement the same output contract: `CrawlResult`. The script layer does not need to know which engine ran.

New platform types (e.g., SPA-specific scrapers for ZARA, H&M) follow this same pattern: add a new engine module, add a new branch in `crawl.ts`, and register sites in `platforms.ts`.

### CLI Orchestration — Each Script is an Independent Executable

There is no daemon or shared runtime. Each `src/*.ts` script is a standalone Node.js process invoked with `pnpm <command>`. Scripts communicate through the filesystem (`data/`) and Supabase, not through inter-process messaging.

This makes each script independently debuggable and replaceable without affecting others.

## System Boundary

```
[ Upstream fashion sites ]
        │  HTTP/Playwright
        ▼
[ crawler (this repo) ]
        │  Supabase upserts (service-role)
        ▼
[ Supabase ]
        │  SELECT (anon or service-role from kiko.ai)
        ▼
[ kiko.ai Next.js app ]
        │  Rendered to end users
        ▼
[ Browser / User ]
```

This repo sits entirely within the left half of the diagram. It has no inbound HTTP surface and exposes no API. The only external writes are to Supabase. The only external reads are from upstream fashion sites.

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Separate engines for Cafe24 vs Shopify | The two platform types have fundamentally different access patterns: browser rendering vs JSON API. A single engine would require complex branching throughout. |
| JSON file as intermediate cache | Decouples crawling (network-dependent, slow) from importing (Supabase-dependent, fast). Allows re-import without re-crawling. |
| No framework | Scripts are glue code. A framework adds indirection without benefit at this scale. |
| Write-only Supabase access | Schema migrations and DDL are the kiko.ai repo's responsibility. Strict separation prevents schema drift caused by the crawler. |
| Hardcoded FX rates | Real-time FX APIs add latency and an external dependency. Rates are updated manually on a quarterly cadence until a live API is justified by volume. |

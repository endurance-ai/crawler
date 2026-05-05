# Codemap: Data Flow

## Full Pipeline Sequence

```mermaid
sequenceDiagram
    participant CF as configs/platforms.ts
    participant CL as crawl.ts
    participant C24 as cafe24-engine.ts
    participant SH as shopify-engine.ts
    participant FS as data/{key}-products.json
    participant IP as import-products.ts
    participant IB as import-brand-nodes.ts
    participant AN as analyze-products.ts
    participant LM as LiteLLM (nova-lite)
    participant SB as Supabase

    note over CF,SB: Stage 1 — Crawl

    CL->>CF: load PLATFORMS array
    CF-->>CL: SiteConfig[]
    CL->>CL: filter by --site / --all / --type
    alt type === "cafe24"
        CL->>C24: crawlCafe24(page, config, detailParser?, reviewParser?)
        C24->>C24: discover or read categories
        C24->>C24: paginate product list pages (up to maxPages)
        C24->>C24: extract items via fallback selector chain
        opt crawlDetails: true
            C24->>C24: concurrency=3 detail page fetches
        end
        opt crawlReviews: true
            C24->>C24: review parser per product
        end
        C24-->>CL: CrawlResult { products[], stats, errors[] }
    else type === "shopify"
        CL->>SH: crawlShopify(config)
        SH->>SH: GET /products.json?page=N (250/page, until empty)
        SH->>SH: convert currency to KRW via FX_TO_KRW
        SH->>SH: validate image URLs against CDN allowlist
        SH-->>CL: CrawlResult { products[], stats, errors[] }
    end
    CL->>FS: write JSON (Product[])

    note over FS,SB: Stage 2a — Import Products

    IP->>FS: read data/{key}-products.json
    IP->>SB: upsert products (50-row batches, onConflict=product_url)
    IP->>SB: insert reviews (per-product embedded array)

    note over IB,SB: Stage 2b — Import Brand Nodes (independent)

    IB->>IB: read data/Fashion_genome_*.xlsx
    IB->>SB: upsert brand_nodes

    note over AN,SB: Stage 3 — Analyze Products

    AN->>SB: select products without product_analyses entry
    loop token bucket (1500ms interval, 3 tokens/batch)
        AN->>LM: POST image URL + analyze-prompt
        LM-->>AN: structured JSON (category, style, color, material, gender)
        AN->>SB: upsert product_analyses
    end
```

## Data Volatility

| Data store | Volatility | Notes |
|-----------|-----------|-------|
| `data/{key}-products.json` | Volatile | Gitignored. Overwritten on each crawl run. Safe to delete — re-run `pnpm crawl` to regenerate. |
| Supabase `products` | Persistent | Upserted on conflict key `product_url`. Running import twice is idempotent for existing URLs. New URLs are inserted. |
| Supabase `reviews` | Persistent | Inserted without conflict handling. Duplicate runs may create duplicate review rows. |
| Supabase `brand_nodes` | Persistent | Upserted. Source data is the manually maintained XLSX file. |
| Supabase `product_analyses` | Persistent | Upserted. Re-running analyze-products.ts will re-analyze only products with no existing analysis entry. |

## Stage Independence

Each stage can be run independently:

- `pnpm crawl` — requires only the upstream site being reachable. No Supabase.
- `pnpm import:products` — requires `data/{key}-products.json` to exist. Requires Supabase. Does not require a browser.
- `pnpm import:brand-nodes` — requires `data/Fashion_genome_*.xlsx` to exist. Requires Supabase. No crawl needed.
- `pnpm analyze:products` — requires Supabase `products` rows to exist. Requires LiteLLM proxy. No crawl or JSON file needed.

This independence means failures in one stage do not require restarting the entire pipeline.

## Supabase as Data Contract

```
crawler (this repo)
  │
  │  WRITE ONLY
  │  products, reviews, brand_nodes, product_analyses
  ▼
Supabase
  │
  │  READ ONLY
  │  portal.ai queries product data for user-facing display
  ▼
portal.ai (endurance-ai/portal)
```

The crawler never reads from Supabase except in `analyze-products.ts`, which reads `products` rows to find unanalyzed items. It does not read schema, migrations, or any table it does not also write to.

## Error Handling Pattern

- Engine errors (network, selector, parse): collected in `CrawlResult.errors[]`, logged, and do not abort the crawl. A failed product is skipped.
- Import errors (Supabase upsert failures): logged per batch. A failed batch is logged and the script continues with the next batch.
- Analyze errors (LiteLLM call failures): logged per product. The product is skipped and the token bucket continues.

There is no retry mechanism or dead-letter queue. Failed items are re-attempted on the next full pipeline run.

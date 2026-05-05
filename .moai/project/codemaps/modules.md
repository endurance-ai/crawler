# Codemap: Module Reference

## src/lib/cafe24-engine.ts

**Lines**: 591  
**Purpose**: Browser-based crawler for Cafe24-platform Korean fashion stores.

### Responsibilities

1. Category discovery: either reads `SiteConfig.category.categories` directly (manual mode) or scrapes `<a href="...cate_no=N">` links from the site navigation (auto mode).
2. Product list collection: navigates each category page, extracts product items using an 8-fallback CSS selector chain per field (name, price, image, link).
3. Pagination: increments `?page=N` up to `SiteConfig.maxPages` (default 10) until an empty page is detected.
4. Detail page crawl (optional): when `crawlDetails: true`, spawns up to 3 concurrent Playwright pages to visit individual product URLs and extract description, color, material, and images.
5. Review extraction (optional): when `crawlReviews: true` and `crawlDetails: true`, delegates to a site-specific `IReviewParser` if registered.

### Public Surface

```ts
// src/lib/cafe24-engine.ts
export async function crawlCafe24(
  page: Page,            // Playwright page (browser managed by crawl.ts)
  config: SiteConfig,
  detailParser?: IDetailParser,   // optional, loaded via getDetailParser(key)
  reviewParser?: IReviewParser,   // optional, loaded via getReviewParser(key)
): Promise<CrawlResult>
```

### Fallback Selector Chain

Defined at `src/lib/cafe24-engine.ts:19-66`. For each field (productItem, productName, productPrice, productImage, productLink), the engine tries selectors in order and uses the first match. A `selectors` override in `SiteConfig` prepends a site-specific selector to the chain.

### Concurrency

Detail page crawl uses `Promise.allSettled` with a concurrency limit of 3 (configurable via internal constant). List-page navigation is sequential.

---

## src/lib/shopify-engine.ts

**Lines**: 281  
**Purpose**: Fetch-based crawler for Shopify-platform global fashion stores.

### Responsibilities

1. Fetches `/products.json?page=N&limit=250` until an empty product array is returned.
2. Applies a country-code cookie (`_shopify_country`) derived from `SiteConfig.sourceCurrency` to force the store to return prices in the expected currency (prevents geo-IP-based KRW conversion for non-KRW stores).
3. Converts source currency to KRW using hardcoded FX rates (`src/lib/shopify-engine.ts:11-16`).
4. Validates image URLs against an allowlist: `cdn.shopify.com`, `*.myshopify.com`, `*.shopifycdn.com`, or the store's own domain (`src/lib/shopify-engine.ts:47-58`).
5. Validates product handles against `SAFE_HANDLE = /^[a-z0-9][a-z0-9-]*$/` to prevent path injection.

### Public Surface

```ts
// src/lib/shopify-engine.ts
export async function crawlShopify(
  config: SiteConfig,
): Promise<CrawlResult>
```

No Playwright dependency. All network calls use Node.js native `fetch`.

### FX Rates (as of 2026-04)

```ts
const FX_TO_KRW: Record<string, number> = {
  USD: 1430,
  EUR: 1560,
  GBP: 1750,
  KRW: 1,
}
```

These are POC-grade hardcoded values. Update manually when rates diverge significantly.

---

## src/lib/parsers/detail/

**Purpose**: Site-specific detail page parsers, loaded by `getDetailParser(siteKey)`.

### Interface

```ts
// Inferred from engine usage
interface IDetailParser {
  parse(page: Page, product: Partial<Product>): Promise<Partial<Product>>
}
```

Parsers are optional. If no parser is registered for a site key, the engine uses default Cafe24 selectors for description and images. Add a new file per site when the default selectors are insufficient.

---

## src/lib/parsers/review/

**Purpose**: Site-specific review parsers, loaded by `getReviewParser(siteKey)`.

### Interface

```ts
interface IReviewParser {
  parse(page: Page): Promise<Product["reviews"]>
}
```

Reviews include structured body measurement data (height, weight, usual size, purchased size, body type) extracted by `src/lib/body-info-extractor.ts`.

---

## src/configs/platforms.ts

**Purpose**: Single source of truth for all registered crawl targets.

Exports:
- `PLATFORMS: SiteConfig[]` — all 32 platform entries.
- `getActivePlatforms()` — filters out disabled entries.
- `getPlatformsByType(type)` — filters by `"cafe24"` or `"shopify"`.
- `getSiteConfig(key)` — returns a single config by key.

### SiteConfig Schema (complete)

```ts
interface SiteConfig {
  key: string                        // unique ID, used as platform field in Supabase
  name: string                       // display name
  type: "cafe24" | "shopify"
  baseUrl: string
  defaultGender?: string[]
  selectors?: Cafe24Selectors        // overrides fallback chain per field
  detailSelectors?: Cafe24DetailSelectors
  category?: {
    discovery: "auto" | "manual"
    categories?: { name: string; cateNo: number; gender?: string[] }[]
    discoveryUrl?: string
    discoverySelector?: string
    ignorePatterns?: string[]
  }
  pricePattern?: RegExp              // default: /[\d,]+/
  priceCurrency?: string             // default: "₩"
  paginate?: boolean
  maxPages?: number                  // default: 10
  sourceCurrency?: "USD" | "EUR" | "GBP" | "KRW"  // Shopify only
  crawlDelay?: number                // ms between requests, default: 2000
  crawlDetails?: boolean             // default: false
  crawlReviews?: boolean             // default: false; requires crawlDetails: true
  disabled?: boolean
  notes?: string
}
```

Source: `src/lib/types.ts:97-134`.

---

## src/configs/analyze-prompt.ts

**Purpose**: Exports the system prompt used by `analyze-products.ts` when calling the LiteLLM nova-lite vision endpoint.

The prompt instructs the model to extract structured attributes (category, style, color, material, gender) from product images. Output format is JSON, parsed and written to `product_analyses` in Supabase.

---

## src/lib/types.ts

**Purpose**: Canonical TypeScript type definitions shared across all modules.

Key types:
- `Product`: Full product data model including optional detail and review fields. Source: `src/lib/types.ts:7-48`.
- `SiteConfig`: Platform configuration. Source: `src/lib/types.ts:97-134`.
- `CrawlResult`: Engine output contract. Source: `src/lib/types.ts:138-150`.
- `Cafe24Selectors`, `Cafe24DetailSelectors`, `CategoryConfig`: Supporting types.

---

## src/lib/product-analyzer.ts

**Purpose**: Wraps OpenAI-compatible API calls for image analysis. Receives a `Product` (with `imageUrl`), sends the image to nova-lite, and returns a structured analysis object. Called in a rate-limited loop by `analyze-products.ts`.

---

## src/lib/fashion-genome.ts

**Purpose**: Parses `data/Fashion_genome_*.xlsx` files using the `xlsx` package. Extracts brand node records and maps them to the `brand_nodes` Supabase table schema.

---

## Adding a New Platform — Engine Abstraction Guide

When the new platform does not fit Cafe24 or Shopify patterns (e.g., ZARA SPA, H&M custom API):

1. Create `src/lib/{platform}-engine.ts`.
2. Export `crawl{Platform}(config: SiteConfig): Promise<CrawlResult>`.
3. Add a new `PlatformType` value in `src/lib/types.ts:53`.
4. Add a branch in `src/crawl.ts` to call the new engine.
5. Register SiteConfig entries in `src/configs/platforms.ts` with the new `type` value.
6. Document any new `SiteConfig` fields needed by the engine in `src/lib/types.ts`.

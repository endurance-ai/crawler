---
type: project
updated: 2026-05-05
---

# Project Structure

## Directory Tree

```
crawler/
├── src/                          # All source code
│   ├── crawl.ts                  # CLI entry: runs crawl for one or more platforms
│   ├── import-products.ts        # CLI entry: JSON cache → Supabase products + reviews
│   ├── import-attributes.ts      # CLI entry: attribute enrichment (supplementary)
│   ├── import-brand-nodes.ts     # CLI entry: XLSX → Supabase brand_nodes
│   ├── probe-reviews.ts          # CLI entry: review structure probe (diagnostic)
│   ├── analyze-products.ts       # CLI entry: products → LiteLLM → product_analyses
│   ├── test-detail-crawl.ts      # Dev utility: run detail crawl on a single product URL
│   ├── test-parser.ts            # Dev utility: test parser output against a live page
│   ├── configs/
│   │   ├── platforms.ts          # Array of 36 SiteConfig entries (platform registry; +Uniqlo KR/US, +ZARA KR, +29CM KR)
│   │   └── analyze-prompt.ts     # LiteLLM system prompt for image analysis
│   └── lib/
│       ├── types.ts              # Shared TypeScript interfaces (Product, SiteConfig, CrawlResult)
│       ├── cafe24-engine.ts      # Cafe24 Playwright engine (591 lines)
│       ├── shopify-engine.ts     # Shopify fetch engine (now imports FX from ./fx)
│       ├── uniqlo-engine.ts      # Uniqlo fetch engine (region-parameterized: KR + US)
│       ├── zara-engine.ts        # ZARA KR Playwright engine (channel:'chrome' + XHR-interception, SPEC-003)
│       ├── 29cm-engine.ts        # 29CM KR Playwright engine (vanilla headless + XHR-interception, Cloudflare-passive, SPEC-004)
│       ├── fx.ts                 # Shared FX_TO_KRW table + convertToKrw (lifted from shopify-engine)
│       ├── robots-check.ts       # robots.txt blanket-Disallow detector (engine-agnostic)
│       ├── product-analyzer.ts   # LiteLLM analysis wrapper
│       ├── fashion-genome.ts     # XLSX parsing utilities for brand_nodes
│       ├── body-info-extractor.ts# Body measurement extraction from review text
│       ├── enums/
│       │   ├── product-enums.ts  # Category, gender, and material enum values
│       │   └── season-pattern.ts # Season keyword matching patterns
│       └── parsers/
│           ├── detail/           # Per-site detail page parsers (Cafe24 sites)
│           └── review/           # Per-site review parsers (Cafe24 sites)
├── data/                         # Gitignored. JSON crawl cache per site key.
│   └── {key}-products.json       # e.g. data/obscura-products.json
├── .github/
│   └── workflows/
│       └── ci.yml                # typecheck only (tsc --noEmit)
├── package.json
├── tsconfig.json
├── .env                          # Gitignored. SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, etc.
└── README.md
```

## Entry-Point Script Table

| Script | pnpm command | Flags / Input | Output | Supabase write target |
|--------|-------------|--------------|--------|----------------------|
| `src/crawl.ts` | `pnpm crawl` | `--site=KEY`, `--all`, `--type=cafe24\|shopify`, `--list`, `--probe=KEY`, `--dry-run` | `data/{key}-products.json` | None (writes JSON only) |
| `src/import-products.ts` | `pnpm import:products` | `--site=KEY` (optional) | Console log | `products`, `reviews` |
| `src/import-attributes.ts` | `pnpm import:attributes` | — | Console log | Supplementary attributes |
| `src/import-brand-nodes.ts` | `pnpm import:brand-nodes` | Reads `data/Fashion_genome_*.xlsx` | Console log | `brand_nodes` |
| `src/probe-reviews.ts` | `pnpm probe:reviews` | `--site=KEY` | Console log (diagnostic) | None |
| `src/analyze-products.ts` | `pnpm analyze:products` | Reads unanalyzed rows from Supabase | Console log | `product_analyses` |
| `src/test-detail-crawl.ts` | `pnpm test:detail` | Hard-coded or CLI URL | Console log | None |
| `src/test-parser.ts` | `pnpm test:parser` | Hard-coded or CLI URL | Console log | None |

## Engine Layering

```
configs/platforms.ts
  └─ SiteConfig[] (36 entries, type: "cafe24" | "shopify" | "uniqlo" | "zara" | "29cm")
        │
        ▼
src/crawl.ts  (engine selection)
  ├─ type === "cafe24"  →  lib/cafe24-engine.ts crawlCafe24()  (Playwright, framework selector chains)
  ├─ type === "shopify" →  lib/shopify-engine.ts crawlShopify() (fetch /products.json)
  ├─ type === "uniqlo"  →  lib/uniqlo-engine.ts crawlUniqlo()   (fetch /api/commerce/v5)
  │                            (region: "KR" | "US" drives API path,
  │                             source currency, and locale; SPEC-002)
  ├─ type === "zara"    →  lib/zara-engine.ts crawlZara()       (Playwright channel:"chrome" required;
  │                            bundled Chromium hard-403'd by Akamai. Engine intercepts the
  │                            /kr/ko/category/{id}/products?ajax=true XHR JSON inside the
  │                            browser session and parses the embedded product shape; SPEC-003)
  └─ type === "29cm"    →  lib/29cm-engine.ts crawl29cm()       (Playwright vanilla headless;
                               Cloudflare-passive (no JS challenge). Engine intercepts the
                               display-bff-api.29cm.co.kr/api/v1/listing/items XHR JSON
                               and parses the embedded product shape. apiCategoryCodes:
                               numeric L1 codes → URL constructed at runtime; SPEC-004)
        │
        ▼
CrawlResult { platform, products[], stats, errors[] }
        │
        ▼
data/{key}-products.json  (volatile cache)
        │
        ▼
import-products.ts  →  Supabase: products, reviews
import-brand-nodes.ts →  Supabase: brand_nodes
analyze-products.ts  →  Supabase: product_analyses
```

## Architectural Pattern

Script-style CLI with engine-based platform abstraction. No framework. Each entry point is independent and orchestrates discovery → crawl → parse → upsert.

There is no shared HTTP server, daemon, or message queue. Scripts are run manually or via a scheduler external to this repo. State between runs is held in Supabase (persistent) and `data/` JSON files (volatile, gitignored).

## Adding a New Platform — Step-by-Step Checklist

Follow this checklist when adding a new Cafe24 or Shopify site. The next session working on new-platform integration should follow these steps literally.

### Step 1: Verify robots.txt (HARD precondition)

Before writing any code, fetch the target site's `robots.txt` and confirm the `User-agent: *` group does NOT contain a verbatim `Disallow: /` rule:

```
curl -A 'Mozilla/5.0 ... Chrome/131.0.0.0' https://<target-host>/robots.txt
```

If the wildcard group contains `Disallow: /`, the platform MUST be deferred. Per project HARD rule #1 ("Sites that explicitly forbid crawling → DEFER"), pursuing such a platform via web crawling is forbidden — escalate to the project owner for a B2B partner-API conversation instead. The crawler enforces this check programmatically at every crawl start (`src/lib/robots-check.ts`), but performing it manually at platform-registration time prevents wasted onboarding effort.

### Step 2: Identify the platform type

- Open the target site in a browser.
- If the URL pattern contains `/product/list.html?cate_no=` or the page source references `cafe24.com`, it is Cafe24.
- If `GET https://{store}/products.json` returns valid JSON, it is Shopify.
- For any other platform, a new engine must be built before proceeding.

### Step 3: Determine category discovery mode

For Cafe24:
- Try `auto` mode first: inspect the site nav for `<a href="...cate_no=NNN">` links.
- If the nav structure is clean and consistent, set `discovery: "auto"` with `discoverySelector` if the default `a[href*="cate_no="]` does not work.
- If the nav is JS-rendered or ambiguous, use `discovery: "manual"` and enumerate `cateNo` values by visiting each category page URL manually.

For Shopify:
- Category discovery is not applicable. Shopify engine paginates all products from `/products.json`.
- Set `sourceCurrency` to the store's pricing currency if not KRW.

### Step 4: Add a SiteConfig entry

Open `src/configs/platforms.ts` and append a new object to the `PLATFORMS` array:

```ts
{
  key: "my-site",            // unique, lowercase, hyphenated
  name: "My Site",           // display name
  type: "cafe24",            // or "shopify"
  baseUrl: "https://my-site.com",
  paginate: true,
  maxPages: 10,              // tune based on catalog size
  category: {
    discovery: "manual",     // or "auto"
    categories: [
      { name: "Outer", cateNo: 123, gender: ["women"] },
    ],
  },
  crawlDelay: 2000,          // do not set below 1000
}
```

For Shopify, omit `category` and add `sourceCurrency` if non-KRW.

### Step 5: Run a probe

```
pnpm crawl --probe=my-site
```

This loads the page without collecting products. Verify that the site is reachable and that the category links resolve.

### Step 6: Run a dry-run

```
pnpm crawl --dry-run --site=my-site
```

Confirms category discovery output without fetching product pages.

### Step 7: Run a real crawl on a single page

```
pnpm crawl --site=my-site
```

Check `data/my-site-products.json`. Confirm:
- `products` array is non-empty.
- `name`, `price`, `imageUrl`, `productUrl` are populated.
- `errors` array is empty or has acceptable failures.

### Step 8: If selectors fail, add overrides

If product items, names, or prices are not extracted, add a `selectors` override in the SiteConfig:

```ts
selectors: {
  productItem: "ul.my-product-list > li",
  productName: ".my-name span",
  productPrice: ".my-price .sale",
}
```

The Cafe24 engine will use these in place of the fallback chain (`src/lib/cafe24-engine.ts:19-66`).

### Step 9: (Optional) Add a detail parser

If `crawlDetails: true` is set on the config, the engine calls `getDetailParser(config.key)` from `src/lib/parsers/detail/`. Add a parser file there for site-specific detail page extraction.

### Step 10: Import to Supabase

```
pnpm import:products --site=my-site
```

Confirm rows appear in Supabase `products` table with the correct `platform` value (matches `key`).

### Step 11: Commit the SiteConfig addition

The only file that needs to change for a new Cafe24/Shopify platform with standard behavior is `src/configs/platforms.ts`. New engines (ZARA, H&M, etc.) also require a new file in `src/lib/`.

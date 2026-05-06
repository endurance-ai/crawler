# crawler

> kiko.ai fashion SKU crawler. Cafe24 (Playwright) + Shopify (JSON) harvester writing into Supabase + R2.

`portal/app` (Next.js) consumes this data via Supabase. No direct API between the two — DB is the contract.

```
[Crawler / EC2 batch]                    [Supabase + R2]                   [Vercel / Next.js]
─────────────────────                    ────────────────                  ──────────────────
Cafe24 engine (Playwright)         →     products / brands / images   →    kiko.ai
Shopify engine (/products.json)          R2 bucket (image binaries)        search & recommendation
configs/platforms.ts (32 sites)
```

## Quickstart

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
# fill in Supabase + R2 keys

pnpm tsx src/cli.ts crawl --platform=<key> --dry-run
pnpm tsx src/cli.ts crawl --platform=<key>
```

## Validate

```bash
pnpm typecheck
pnpm lint
```

## Deploy

EC2 (c6i.large Spot recommended) + systemd timer / cron. See `docs/operations.md` (TBA).

## Layout

```
src/
├── cli.ts                     # entrypoint
└── commands/                  # crawl, import-products, probe-reviews, ...

engines/
├── cafe24/                    # Playwright engine + per-site parsers
│   ├── index.ts
│   └── parsers/{detail,review}/
└── shopify/                   # /products.json fetcher
    └── index.ts

configs/
├── platforms.ts               # PLATFORMS: SiteConfig[] — one entry = one site
└── analyze-prompt.ts

lib/
├── types.ts
├── database.types.ts          # supabase gen types output
├── body-info-extractor.ts
└── product-analyzer.ts

output/                        # gitignored (per-run cache)
```

## Scale

| Metric | Value (at separation) |
|--------|----------------------|
| Platforms | 32 (22 Cafe24 KR + 10 Shopify global) |
| SKUs | ~81,000 (45k KR + 35k global) |
| Brands | 697 |

Roadmap: ZARA, H&M, 29CM, Musinsa, Uniqlo, Furutsu.

## Core stack

| Area | Choice |
|------|--------|
| Runtime | Node.js + tsx (no transpile) |
| Browser automation | Playwright ^1.58 |
| HTTP fetch | native fetch (Shopify) |
| DB write | @supabase/supabase-js (service role) |
| Image storage | Cloudflare R2 (S3-compatible SDK) |
| Language | TypeScript |
| Lint / format | ESLint / Prettier (TBA) |

## Adding a new platform

1. Append a `SiteConfig` object to `configs/platforms.ts`
2. Cafe24: try defaults first → override `selectors` if needed
3. Shopify: only host is required
4. `pnpm tsx src/cli.ts crawl --platform=<key> --dry-run` to verify

## Related projects

| Project | Path | Role |
|---------|------|------|
| kiko.ai | endurance-ai/kiko.ai-app | Next.js search & recommendation web (consumer) |
| ai-server | endurance-ai/ai-server | FastAPI search server (FashionSigLIP + pgvector) |

## Notes

- Public repo — never commit `.env`. Only `.env.example` is tracked.
- DB schema is owned by `endurance-ai/kiko.ai-app` (`supabase/migrations/`).
- Ported from `endurance-ai/kiko.ai-app @ 5e3e7a0` on 2026-05-05.

# crawler

> kiko.ai fashion SKU crawler. Multi-engine harvester (Cafe24 / Shopify / Uniqlo API / ZARA / 29CM / Farfetch) writing into Supabase + R2.

`portal/app` (Next.js) consumes this data via Supabase. No direct API between the two — DB is the contract.

```
[Crawler / EC2 batch]                       [Supabase + R2]                   [Vercel / Next.js]
─────────────────────                       ────────────────                  ──────────────────
Cafe24 (Playwright)              →          products / brands / images   →    kiko.ai
Shopify (/products.json)                    R2 bucket (image binaries)        search & recommendation
Uniqlo (commerce v5 API)
ZARA (channel:'chrome' + XHR)
29CM (Playwright + XHR)
Farfetch (channel:'chrome' + DOM-scrape)
configs/platforms.ts (42 sites)
```

## Quickstart

```bash
pnpm install
pnpm exec playwright install chrome   # real Chrome required for ZARA/Farfetch (Akamai bypass)
cp .env.example .env
# fill in Supabase + R2 keys

pnpm crawl --list                                              # registered platforms
pnpm crawl --probe=<key>                                       # smoke probe a single site
pnpm crawl --site=<key>                                        # crawl one
pnpm crawl --all --exclude-type=cafe24                         # daily cron (global only)
pnpm crawl --type=shopify,uniqlo,zara,29cm,farfetch            # by type
pnpm tsx src/import-products.ts                                # upsert data/ → Supabase
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

| Metric | Value (2026-05-07) |
|--------|--------------------|
| Platforms | 44 (20 Cafe24 KR + 15 Shopify global + 2 Uniqlo + 2 ZARA + 1 29CM + 1 Farfetch KR + 3 disabled) |
| SKUs (cron, Cafe24 제외) | ~93,500 / day |
| Unique brands | 2,300+ |

| SPEC | Status | Description |
|------|--------|-------------|
| SPEC-001~002 | shipped | Uniqlo KR + region-parameterized engine + FX module |
| SPEC-003 | shipped | ZARA KR Playwright + XHR-interception |
| SPEC-004 | shipped | 29CM KR (OWNER OVERRIDE re: ToS 제11조) |
| SPEC-005 | shipped | ZARA US region extension |
| SPEC-006 | shipped | Farfetch KR + farfetch-engine.ts (DOM-scrape) |
| SPEC-007 | shipped | Slam Jam + Antonioli + Browns (Shopify multi-brand editorials) |
| SPEC-008 | shipped | Mohawk General + Union LA (Japanese heritage + indie minimal designer focus) |

Roadmap (US-routable infra 후): Farfetch US, MyTheresa, SSENSE, Mr Porter, Net-a-Porter, Saks, Bergdorf, Neiman Marcus, 24S — all KR-IP geo-blocked at edge.

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

1. Append a `SiteConfig` object to `src/configs/platforms.ts`
2. Cafe24: try defaults first → override `selectors` if needed
3. Shopify: only `baseUrl` + `sourceCurrency` required
4. New engine type? Author SPEC under `.moai/specs/SPEC-PLATFORM-EXPANSION-NNN/` + new `src/lib/<type>-engine.ts`
5. `pnpm crawl --probe=<key>` to verify

## Related projects

| Project | Path | Role |
|---------|------|------|
| kiko.ai | endurance-ai/kiko.ai-app | Next.js search & recommendation web (consumer) |
| ai-server | endurance-ai/ai-server | FastAPI search server (FashionSigLIP + pgvector) |

## Notes

- Public repo — never commit `.env`. Only `.env.example` is tracked.
- DB schema is owned by `endurance-ai/kiko.ai-app` (`supabase/migrations/`).
- Ported from `endurance-ai/kiko.ai-app @ 5e3e7a0` on 2026-05-05.

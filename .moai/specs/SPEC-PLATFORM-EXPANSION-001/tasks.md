# Task Decomposition

SPEC: SPEC-PLATFORM-EXPANSION-001 — Uniqlo (KR) engine + onboarding hardening
Methodology: DDD (ANALYZE-PRESERVE-IMPROVE)
Mode: Standard (9 files / 2 domains)
Harness: standard

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | ANALYZE: Re-read research.md §3 + §6, map Uniqlo `/kr/api/commerce/v5/ko/products` JSON shape onto `Product` interface field-by-field; document fallback (`null`) policy per field | REQ-002, REQ-006 | – | (none — analysis only) | pending |
| T-002 | Extend `PlatformType` union to include `"uniqlo"` and add optional `apiCategoryPaths?: string[]` to `SiteConfig` | REQ-001 | T-001 | src/lib/types.ts | pending |
| T-003 | Implement `robots-check.ts` helper: fetch `<baseUrl>/robots.txt`, parse `User-agent: *` group, return `{allowed, blockingLine?}`; engine-agnostic, used by both registration validator and per-crawl pre-flight | REQ-004 | T-001 | src/lib/robots-check.ts | pending |
| T-004 | PRESERVE: Capture live Uniqlo API page via `curl` (one category, ~50–100 products) and freeze as `tests/fixtures/uniqlo-kr-products.fixture.json` | REQ-006 | T-001 | tests/fixtures/uniqlo-kr-products.fixture.json | pending |
| T-005 | Implement `uniqlo-engine.ts`: `crawlUniqlo(config)`, fetch-pagination loop, JSON→Product mapper, image-host whitelist (`image.uniqlo.com`, `asset.uniqlo.com`), 5-element UA rotation, 1 req/sec pacing, abort-on-3-consecutive-errors per category (REQ-005) | REQ-002, REQ-005 | T-002, T-004 | src/lib/uniqlo-engine.ts | pending |
| T-006 | Append `uniqlo-kr` SiteConfig in `platforms.ts` with hardcoded `apiCategoryPaths` (WOMEN/MEN/KIDS top-level + sub-category codes), `crawlDelay: 1000` | REQ-001 | T-002 | src/configs/platforms.ts | pending |
| T-007 | Wire dispatch in `crawl.ts`: `runCrawl` Uniqlo branch (`Promise.all` parallel with Shopify), `probeSite` Uniqlo branch (limit=1, no file write), `--rate=N` flag parser with cap (N>5 / N≤0 / non-integer rejected at parse time), invoke `robots-check` pre-flight before any product fetch | REQ-001, REQ-003, REQ-004, REQ-007 | T-002, T-003, T-005 | src/crawl.ts | pending |
| T-008 | Write `node:test` characterization suite: parse-against-fixture assertions (name/imageUrl/productUrl/price populated, image-host whitelist), pacing timing test, UA rotation test, abort-on-3-consecutive-errors test, --rate parse-rejection tests, robots-check unit tests, dry-run-no-write test | REQ-006, REQ-002, REQ-004, REQ-005, REQ-007 | T-003, T-005, T-007 | tests/uniqlo-engine.test.ts | pending |
| T-009 | Update `package.json`: replace `"test"` script with `sh -c 'node --test --import tsx ./tests/*.test.ts'` (preserve harness flag-absorption pattern from commit 91e6ca6); typecheck script unchanged | REQ-006 | T-008 | package.json | pending |
| T-010 | Update `.moai/project/structure.md` "Adding a New Platform" checklist to add Step 1 = `robots.txt` blanket-Disallow verification | REQ-004 | T-007 | .moai/project/structure.md | pending |
| T-011 | Verification: `pnpm typecheck` zero errors, `pnpm test` zero failures | DoD | T-009 | – | pending |

## Drift Guard Baseline

Planned new files: 4 (uniqlo-engine.ts, robots-check.ts, fixture.json, test.ts)
Planned modified files: 5 (types.ts, platforms.ts, crawl.ts, package.json, structure.md)
Total: 9 files (matches plan.md §4)

## Acceptance Criteria Mapping (Phase 1.6 Failing Checklist)

| AC | Maps to | Tasks |
|----|---------|-------|
| AC-1 | REQ-001 | T-002, T-006, T-007 |
| AC-2 | REQ-002, REQ-006 | T-005, T-008 |
| AC-3 | REQ-003 | T-007, T-008 |
| AC-4 | REQ-004 | T-003, T-007, T-008 |
| AC-5 | REQ-005 | T-005, T-008 |
| AC-6 | REQ-007 | T-007, T-008 |
| AC-7 | REQ-002 (edge) | T-005, T-008 |

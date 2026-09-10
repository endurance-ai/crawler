# Adding a New Crawl Platform

> SPEC: SPEC-ARCH-CRAWLER-001 (REQ-CRAWLER-003 / 004 / 006). This guide is
> the onboarding path for crawl site #33+. The architecture exists so a new
> platform is **"supply a strategy + a selector-registry entry"**, not
> "copy-paste a whole parser module".

## TL;DR

```bash
# dry-run: prints the skeleton, writes nothing
npm run scaffold:platform -- <key> --name "Display Name"

# opt-in: also writes ONE stub file under src/lib/parsers/scaffold/
npm run scaffold:platform -- <key> --name "Display Name" --write
```

`<key>` must be lowercase, start with a letter, and may contain digits and
`-` (e.g. `acmestore`, `acme-store`). A digit-leading site like `8division`
needs a letter-leading key (`eightdivision`).

The scaffold **never edits an existing source file** and **never implements
a real site** — it produces a skeleton and prints the exact snippets you
paste into the live files. That paste step is the deliberate human gate.

## The moving parts (Phase 2 / Phase 3 architecture)

| File | Role |
|---|---|
| `src/lib/parsers/detail/selector-registry.ts` | `DETAIL_REGISTRY`: per-site selectors + wait recipe + strategy id. All Cafe24-family sites collapsed here (REQ-CRAWLER-003). |
| `src/lib/parsers/field-extractors/strategies.ts` | `STRATEGIES`: the per-strategy extraction algorithms the registry-driven parser dispatches into. |
| `src/lib/parsers/field-extractors/` | Shared extraction primitives (`material`, `productCode`) — the single source of extraction logic. Color and description extraction were removed in favor of VLM-derived `product_features`. |
| `src/lib/parsers/detail/registry-detail-parser.ts` | The ONE `IDetailParser` impl. `getDetailParser(key)` returns site-keyed subclasses of it. |
| `src/lib/parsers/detail/index.ts` | `getDetailParser()` routing + registry-backed shims (the named `*DetailParser` classes). |
| `src/lib/parsers/parser-strategy.ts` | `Parser<I,O>` strategy interface + `ParserRegistry` DI container + `defaultParserRegistry` (REQ-CRAWLER-004 extension point). |
| `tools/scaffold-platform.ts` | This guide's generator (REQ-CRAWLER-006). |

## Workflow

### 0. Decide the platform shape

- **Cafe24-family detail site** (selectors only differ from an existing
  site) → you usually only need a `DETAIL_REGISTRY` entry + a `detail/index.ts`
  shim. Prefer reusing `strategy: "base"` if it matches the BaseDetailParser
  family; otherwise add a new `StrategyId` + a strategy body in
  `field-extractors/strategies.ts`.
- **Genuinely custom parsing** (beyond declarative selectors) → add a
  `Parser` strategy and register it on `defaultParserRegistry`
  (REQ-CRAWLER-004). Route through the shared `field-extractors/` primitives
  — do not duplicate extraction logic.

### 1. Generate the skeleton

```bash
npm run scaffold:platform -- acmestore --name "Acme Store"
```

Review the printed skeleton. When ready, add `--write` to drop the stub at
`src/lib/parsers/scaffold/acmestore-platform.scaffold.ts`. The stub mirrors
the real `Parser<I, Promise<DetailData>>`, `RegistryEntry`, and `DetailData`
shapes so it typechecks immediately (`npm run typecheck`).

### 2. Add the selector-registry entry

Paste the printed entry into the `DETAIL_REGISTRY` object literal in
`src/lib/parsers/detail/selector-registry.ts` and fill in the real
selectors / wait recipe. If a new extraction algorithm is required, add the
key to the `StrategyId` union and a strategy body in
`src/lib/parsers/field-extractors/strategies.ts`.

### 3. Wire the parser

- Cafe24-family: paste the registry-backed shim + `DETAIL_PARSERS` entry
  into `src/lib/parsers/detail/index.ts`.
- Custom strategy: import the strategy in
  `src/lib/parsers/parser-strategy.ts` and append
  `.register("acmestore", () => new AcmestoreParserStrategy())` to the
  `defaultParserRegistry` chain.

### 4. Characterization test FIRST (DDD PRESERVE gate)

Before completing the implementation, capture the platform's actual parse
output as a golden snapshot, mirroring
`tests/detail-parsers.characterization.test.ts` (fixture HTML/JSON → parse
result golden). This is the safety net that proves later changes preserve
behavior — it is required by the SPEC's
"Characterization-tests-precede-refactor" gate.

### 5. Verify

```bash
npm test          # full suite stays green (existing goldens unchanged)
npm run typecheck # exit 0 (the new stub + wiring must typecheck)
```

## Guardrails

### Catalog identity contract

Every crawler output can be wrapped with `envelopeFromProduct(product, config)`
to produce the shared `CrawledProductEnvelope`. The envelope keeps the source
listing intact while carrying optional identifier evidence and color/size
variants for the central catalog matcher. Existing engines use one `default`
variant; Shopify-like engines should emit one entry per source variant.

Configure the meaning of `productCode` with `identifierProfile` on the platform
config. Use `model_id` only when the code is a verified brand-level model
identifier; use `source_item_id` for opaque merchant/platform IDs. Unknown
codes remain evidence only and must not drive automatic merges.

After the additive catalog migration is deployed, run the idempotent bridge for
legacy rows before enabling matching:

```bash
pnpm sync:catalog -- --dry-run
pnpm sync:catalog -- --platform=uniqlo
```

The bridge creates singleton catalog products/variants and offers keyed by
`platform + sourceProductKey + sourceVariantKey`. A later matcher may merge
those singletons without rewriting or deleting the original `products` rows.

For a verified domestic official-shop/retailer pair, first inspect the
pair-scoped decision and then apply the same command without `--dry-run`:

```bash
pnpm match:catalog-pair -- --source-product-id=<official-id> --candidate-product-id=<retailer-id> --dry-run
pnpm match:catalog-pair -- --source-product-id=<official-id> --candidate-product-id=<retailer-id>
```

This path requires the same brand, normalized name, canonical category and VLM
color across different shops, plus both a shared high-entropy source product
token and near-identical image embeddings. Title/color/category alone remains
review-only. Bulk cross-shop matching stays disabled until its labeled
precision gate is approved.

After representative-image selection and embedding have completed, run the
incremental matcher for the crawled platform:

```bash
pnpm match:catalog-cross-shop -- --platform=<platform-key>
pnpm match:catalog-cross-shop -- --platform=<platform-key> --apply
```

The required order is `crawl -> import -> representative image selection ->
embedding -> catalog matching`. If either side has no
`image_selection_version` or `image_selected_at`, the pair is counted as
`pendingImageSelection` and is neither rejected nor merged. Regenerate the
embedding after representative-image changes and rerun this idempotent stage.

- The validation gate (`src/lib/core/product-validator.ts`, REQ-CRAWLER-001)
  freezes the **current** output shape. A new platform must emit products
  that pass `ProductSchema` unchanged — it does not introduce new fields.
  `category` is **mandatory** (`z.string().min(1)` + DB `NOT NULL`, migration
  091). Products missing it are dropped at the gate (`validation_reject`), not
  loaded. Color is not part of crawler output; VLM-derived
  `product_features.feature_metadata.primary_color` is the single source. See
  [`onboard-new-brand.md`](./onboard-new-brand.md) for the full
  crawl → import → embed pipeline and what each step must verify.
- Behavior preservation is HARD: a new platform adds a new code path; it
  must not alter any of the existing sites' goldens.
- The scaffold tool is inert by design: dry-run by default, one
  clearly-namespaced stub file under `src/lib/parsers/scaffold/` on
  `--write`, and it refuses to overwrite an existing stub.

## Manual invocation (no npm script)

The `npm run scaffold:platform` entry is a thin wrapper. The tool also runs
directly:

```bash
tsx tools/scaffold-platform.ts <key> --name "Display Name" [--write]
```

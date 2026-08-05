#!/bin/bash
# Bulk brand onboarding driver: crawl -> classify/finalize -> import -> guardrail,
# chunked and resumable. Replaces the ad-hoc scratchpad drivers used for the
# 2026-07 full-volume onboarding (see docs/bulk-onboarding.md for the full flow).
#
# Usage:
#   tools/onboard-batch.sh --configs path/to/brands.json [options]
#
# Options:
#   --configs <path>     JSON array of SiteConfig-like {key,...} entries (required)
#   --engine  <name>      chromium (default) | lightpanda — Cafe24 crawl engine
#   --chunk-size <n>      brands per chunk (default 20)
#   --start <n>           first chunk index to run (default 0)
#   --end <n>             last chunk index to run, inclusive (default = last chunk)
#   --out-root <dir>      crawl output root (default poc-runs; gitignored)
#   --product-limit <n>   per-brand crawl cap (default 2000). Brands with more
#                          products than this are silently truncated — raise it
#                          for full-catalog re-collection.
#   --pool-limit <n>      candidate pool cap (default 2000)
#   --import-flags "<..>" flags passed to import-products.ts
#                          (default "--no-new-brands --in-stock-only").
#                          Re-collecting existing rows wants neither: the former
#                          drops products whose brand is not yet in brand_nodes,
#                          the latter skips out-of-stock rows so they keep
#                          whatever data they already had.
#   --variants <name>     existing (default) | hybrid — product-extraction-poc.ts
#                          variant to crawl AND the one onboard-classify.ts reads
#                          back out of products.jsonl (kept in lockstep — see
#                          ONBOARD_VARIANT below). hybrid = llm-scraper fills
#                          category/subcategory only; existing = deterministic
#                          only. hybrid does NOT add a second page visit: cafe24
#                          (chromium) classifies inline via crawlCafe24's
#                          enrichDetailPage hook on the page already open, and
#                          shopify's existing crawler never opens a detail page
#                          at all (pure /products.json), so runHybridVariant's
#                          goto is the only visit. Color/description/gender are
#                          NOT LLM-filled — color comes from VLM
#                          (product_features), gender from the crawler's
#                          resolveProductGenderWithSource, description is dropped.
#
# Each chunk: crawl (--variants, detail) -> onboard-classify.ts (QC + LLM
# category/subcategory classify, reading the same variant back
# via ONBOARD_VARIANT) -> import-products.ts (upsert) -> reclassify-categories.ts
# --only-invalid (guardrail: fixes any row that still has a non-canonical
# category, regardless of cause — cheap, always safe to run).
#
# Resumable: if out-root/chunk-N/products.jsonl already exists, crawl is skipped
# for that chunk (so a killed run can restart with the same --start).
set -euo pipefail

ENGINE="chromium"
CHUNK_SIZE=20
START=0
END=""
OUT_ROOT="poc-runs"
CONFIGS=""
VARIANTS="existing"
PRODUCT_LIMIT=2000
POOL_LIMIT=2000
IMPORT_FLAGS="--no-new-brands --in-stock-only"

while [ $# -gt 0 ]; do
  case "$1" in
    --configs) CONFIGS="$2"; shift 2 ;;
    --engine) ENGINE="$2"; shift 2 ;;
    --chunk-size) CHUNK_SIZE="$2"; shift 2 ;;
    --start) START="$2"; shift 2 ;;
    --end) END="$2"; shift 2 ;;
    --out-root) OUT_ROOT="$2"; shift 2 ;;
    --variants) VARIANTS="$2"; shift 2 ;;
    --product-limit) PRODUCT_LIMIT="$2"; shift 2 ;;
    --pool-limit) POOL_LIMIT="$2"; shift 2 ;;
    --import-flags) IMPORT_FLAGS="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ "$VARIANTS" != "existing" ] && [ "$VARIANTS" != "hybrid" ]; then
  echo "error: --variants must be existing or hybrid (got: $VARIANTS)" >&2
  exit 1
fi

if [ -z "$CONFIGS" ]; then
  echo "error: --configs <path.json> is required" >&2
  exit 1
fi
if [ ! -f "$CONFIGS" ]; then
  echo "error: configs file not found: $CONFIGS" >&2
  exit 1
fi
if [ "$ENGINE" != "chromium" ] && [ "$ENGINE" != "lightpanda" ]; then
  echo "error: --engine must be chromium or lightpanda (got: $ENGINE)" >&2
  exit 1
fi
if [ "$ENGINE" = "lightpanda" ] && [ ! -x "bin/lightpanda" ]; then
  echo "error: bin/lightpanda not found or not executable. Run scripts/install-lightpanda.sh first." >&2
  exit 1
fi

PNPM="corepack pnpm@10.33.2 exec dotenv -e .env.local --"
TMP_DIR="$OUT_ROOT/_chunks"
TALLY="$OUT_ROOT/onboard-tally.csv"

# Defensive: these directories are always required and must never be assumed
# to pre-exist (a fresh worktree checkout won't have them — this exact gap
# caused a silent 0-row crawl failure during the 2026-07 lightpanda migration).
mkdir -p "$OUT_ROOT" "$TMP_DIR" data

NCHUNKS=$(node -e "console.log(Math.ceil(require(require('path').resolve(process.argv[1])).length / $CHUNK_SIZE))" "$CONFIGS")
if [ -z "$END" ]; then END=$((NCHUNKS - 1)); fi
if [ ! -f "$TALLY" ]; then echo "chunk,engine,brands_pass,products_crawled,import_ok,db_net,invalid_found,invalid_fixed" > "$TALLY"; fi

echo "onboard-batch: chunks $START..$END of $NCHUNKS · engine=$ENGINE · configs=$CONFIGS"

DB_COUNT() {
  $PNPM node -e 'const{createClient}=require("@supabase/supabase-js");createClient(process.env.DB_URL,process.env.DB_TOKEN).from("products").select("*",{count:"exact",head:true}).then(({count})=>console.log(count)).catch(()=>console.log(0))' 2>/dev/null | tail -1
}

for c in $(seq "$START" "$END"); do
  echo "===== CHUNK $c ($ENGINE) ====="
  CHUNK_JSON="$TMP_DIR/chunk-$c.json"
  PASSKEYS_JSON="$TMP_DIR/chunk-$c-passkeys.json"

  node -e '
    const fs = require("fs")
    const all = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const size = +process.argv[2], c = +process.argv[3]
    fs.writeFileSync(process.argv[4], JSON.stringify(all.slice(c * size, (c + 1) * size), null, 2))
  ' "$CONFIGS" "$CHUNK_SIZE" "$c" "$CHUNK_JSON"
  KEYS=$(node -e 'console.log(require(require("path").resolve(process.argv[1])).map(x => x.key).join(","))' "$CHUNK_JSON")

  # hybrid always crawls existing+hybrid together — hybrid is built ON TOP of the
  # existing pool (see runHybridVariant), not a standalone replacement for it.
  CRAWL_VARIANTS="existing"
  if [ "$VARIANTS" = "hybrid" ]; then CRAWL_VARIANTS="existing,hybrid"; fi

  if [ -s "$OUT_ROOT/chunk-$c/products.jsonl" ]; then
    echo "chunk $c crawl SKIPPED (existing $(wc -l < "$OUT_ROOT/chunk-$c/products.jsonl") rows)"
  else
    CRAWLER_CAFE24_ENGINE="$ENGINE" POC_UNSAFE_SCALE=1 POC_EXTRA_BRANDS="$CHUNK_JSON" \
      $PNPM tsx tools/product-extraction-poc.ts \
      --brands="$KEYS" --variants="$CRAWL_VARIANTS" --limit="$PRODUCT_LIMIT" --pool-limit="$POOL_LIMIT" \
      --out-root="$OUT_ROOT" --run-id="chunk-$c" > "$OUT_ROOT/chunk-$c.log" 2>&1
  fi
  ROWS=$(wc -l < "$OUT_ROOT/chunk-$c/products.jsonl" 2>/dev/null || echo 0)
  echo "chunk $c crawl done: $ROWS rows"

  # ONBOARD_VARIANT tells onboard-classify.ts which variant's rows to read back
  # out of products.jsonl — kept in lockstep with $VARIANTS (not $CRAWL_VARIANTS,
  # which always includes "existing" as the hybrid base and would otherwise win
  # a naive first-match).
  ONBOARD_VARIANT="$VARIANTS" $PNPM tsx tools/onboard-classify.ts "$OUT_ROOT/chunk-$c" "$CHUNK_JSON" "$PASSKEYS_JSON" > "$OUT_ROOT/chunk-$c-finalize.log" 2>&1
  PASS=$(node -e 'try{console.log(require(require("path").resolve(process.argv[1])).length)}catch(e){console.log(0)}' "$PASSKEYS_JSON")

  BEFORE=$(DB_COUNT)
  : > "$OUT_ROOT/import-chunk-$c.log"
  OK=0
  for KEY in $(node -e 'try{require(require("path").resolve(process.argv[1])).forEach(k=>console.log(k))}catch(e){}' "$PASSKEYS_JSON"); do
    R=$($PNPM tsx src/import-products.ts --site="$KEY" $IMPORT_FLAGS 2>&1 | grep -oE "[0-9]+개 성공" | grep -oE "[0-9]+" | tail -1)
    OK=$((OK + ${R:-0}))
    echo "$KEY -> ${R:-0}" >> "$OUT_ROOT/import-chunk-$c.log"
  done
  AFTER=$(DB_COUNT)
  NET=$((AFTER - BEFORE))

  # Guardrail: fix any row left with a non-canonical category, regardless of
  # cause (stale cache upsert, LLM output drift, etc). Idempotent and cheap —
  # only touches rows actually out of taxonomy.
  GUARD_LOG="$OUT_ROOT/guardrail-chunk-$c.log"
  $PNPM tsx tools/reclassify-categories.ts --only-invalid > "$GUARD_LOG" 2>&1 || true
  INVALID_FOUND=$(grep -oE "processed=[0-9]+" "$GUARD_LOG" | head -1 | grep -oE "[0-9]+" || echo 0)
  INVALID_FIXED=$(grep -oE "changed=[0-9]+" "$GUARD_LOG" | head -1 | grep -oE "[0-9]+" || echo 0)

  echo "$c,$ENGINE,$PASS,$ROWS,$OK,$NET,$INVALID_FOUND,$INVALID_FIXED" >> "$TALLY"
  echo "CHUNK $c DONE: pass=$PASS crawled=$ROWS import=$OK net=$NET guardrail(found=$INVALID_FOUND fixed=$INVALID_FIXED) (DB $AFTER)"
done

echo "ALL CHUNKS DONE ($START..$END)"

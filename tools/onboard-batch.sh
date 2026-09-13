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
#                          (default "--no-new-brands"). Drops products whose
#                          brand is not yet in brand_nodes; re-collecting
#                          existing rows wants this removed too.
#
# Out-of-stock products ARE collected (2026-08-19). The crawl always passes
# --include-out-of-stock and the import default no longer carries
# --in-stock-only, matching tools/recollect-batch.sh.
#
# Why: out-of-stock is filtered at the CRAWL layer (cafe24-engine.ts, right
# after dedupe and BEFORE the detail crawl), not just at import — so the old
# default never even opened those detail pages and they were absent from
# products.jsonl entirely. `in_stock=false` is the exposure switch
# (sql/096_recollect_cohort_suppress.sql): search and curation already hide
# those rows, and import upserts the whole row on product_url conflict, so a
# restock is recovered by a cheap listing refresh instead of a fresh detail
# crawl. Filtering here would recreate exactly the hole recollect-batch.sh
# was written to avoid.
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
# Each chunk: crawl (--variants, detail) -> onboard-classify.ts (deterministic QC
# and category/color recovery, reading the same variant back via ONBOARD_VARIANT)
# -> import-products.ts (verified pricing/Qwen preparation, then conditional save)
# -> reclassify-categories.ts --only-invalid (canonical taxonomy guardrail).
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
IMPORT_FLAGS="--no-new-brands"

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
    *) echo "unknown arg: $1" >&2; exit 2 ;;
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

  CRAWL_INPUT_HASH=$(node tools/pipeline-artifact.mjs input-hash "$CHUNK_JSON" "$ENGINE" "$VARIANTS" "$PRODUCT_LIMIT" "$POOL_LIMIT" true)
  CRAWL_STAMP="$TMP_DIR/chunk-$c-artifact.json"
  if [ -s "$OUT_ROOT/chunk-$c/products.jsonl" ] && node tools/pipeline-artifact.mjs check "$CRAWL_STAMP" "$OUT_ROOT/chunk-$c/products.jsonl" "$CRAWL_INPUT_HASH"; then
    echo "chunk $c crawl SKIPPED (existing $(wc -l < "$OUT_ROOT/chunk-$c/products.jsonl") rows)"
  else
    if [ -f "$OUT_ROOT/chunk-$c/products.jsonl" ]; then
      mv "$OUT_ROOT/chunk-$c/products.jsonl" "$OUT_ROOT/chunk-$c/products.previous-$$.jsonl"
    fi
    CRAWLER_CAFE24_ENGINE="$ENGINE" POC_UNSAFE_SCALE=1 POC_EXTRA_BRANDS="$CHUNK_JSON" \
      $PNPM tsx tools/product-extraction-poc.ts \
      --brands="$KEYS" --variants="$CRAWL_VARIANTS" --limit="$PRODUCT_LIMIT" --pool-limit="$POOL_LIMIT" \
      --include-out-of-stock --out-root="$OUT_ROOT" --run-id="chunk-$c" > "$OUT_ROOT/chunk-$c.log" 2>&1
    node tools/pipeline-artifact.mjs record "$CRAWL_STAMP" "$OUT_ROOT/chunk-$c/products.jsonl" "$CRAWL_INPUT_HASH"
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
  REPORT="$TMP_DIR/chunk-$c-report.json"
  # Every child gets a fresh report path. QC passkeys select inputs only;
  # completion comes from both child exit codes and validated import reports.
  IMPORT_CODE=0
  $PNPM tsx tools/run-pipeline-import.ts --keys-file="$PASSKEYS_JSON" \
    --expected-configs="$CHUNK_JSON" --report="$REPORT" -- $IMPORT_FLAGS \
    > "$OUT_ROOT/import-chunk-$c.log" 2>&1 || IMPORT_CODE=$?
  if [ ! -s "$REPORT" ]; then
    echo "chunk $c import report missing — $OUT_ROOT/import-chunk-$c.log" >&2
    exit 1
  fi
  OK=$(node --import tsx tools/pipeline-report.ts count "$REPORT" applied)
  if [ "$IMPORT_CODE" -ne 0 ]; then
    echo "chunk $c incomplete imports — $REPORT" >&2
    exit 1
  fi
  AFTER=$(DB_COUNT)
  NET=$((AFTER - BEFORE))
  PIPELINE_KEYS=$(node -e 'try{console.log(require(require("path").resolve(process.argv[1])).join(","))}catch(e){console.log("")}' "$PASSKEYS_JSON")

  # Guardrail: fix any row left with a non-canonical category, regardless of
  # cause (stale cache upsert, LLM output drift, etc). Idempotent and cheap —
  # only touches rows actually out of taxonomy.
  GUARD_LOG="$OUT_ROOT/guardrail-chunk-$c.log"
  if [ -n "$PIPELINE_KEYS" ]; then
    if ! $PNPM tsx tools/reclassify-categories.ts --only-invalid --platform="$PIPELINE_KEYS" > "$GUARD_LOG" 2>&1; then
      echo "chunk $c guardrail failed; Qwen/tunnel or DB error — $GUARD_LOG" >&2
      node --import tsx tools/pipeline-report.ts fail "$REPORT" guardrail
      exit 1
    fi
  else
    echo "processed=0 planned=0 changed=0 conflicted=0 failed=0" > "$GUARD_LOG"
  fi
  INVALID_FOUND=$(grep -oE "processed=[0-9]+" "$GUARD_LOG" | head -1 | grep -oE "[0-9]+" || echo 0)
  INVALID_FIXED=$(grep -oE "changed=[0-9]+" "$GUARD_LOG" | head -1 | grep -oE "[0-9]+" || echo 0)

  # Product writes enqueue durable catalog jobs in Postgres. Drain exactly the
  # platforms accepted by this chunk after every import, so local onboarding
  # reaches representative image -> features -> embedding -> matching without
  # a separate operator command.
  if [ -n "$PIPELINE_KEYS" ]; then
    $PNPM catalog:pipeline -- --drain --platforms="$PIPELINE_KEYS"
  fi

  echo "$c,$ENGINE,$PASS,$ROWS,$OK,$NET,$INVALID_FOUND,$INVALID_FIXED" >> "$TALLY"
  echo "CHUNK $c DONE: pass=$PASS crawled=$ROWS import=$OK net=$NET guardrail(found=$INVALID_FOUND fixed=$INVALID_FIXED) (DB $AFTER)"
done

echo "ALL CHUNKS DONE ($START..$END)"

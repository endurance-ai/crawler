# Product image CV canary

This canary measures the local representative-image selector without updating
`products`. A manifest freezes candidate URLs so Linux CV and Apple Vision see
the same inputs.

## Create manifests

Run this once from `crawler/` on a host with database access:

```bash
pnpm canary:product-images sample \
  --out=../local-output/linux-cv-canary/manifest-300.json \
  --limit=300 \
  --pool-limit=3000 \
  --platform-types=cafe24,shopify,imweb
```

Sampling is deterministic and round-robins over platform type, category, and
candidate-image-count strata. The query is read-only.

## Run Linux performance canaries

Run after refresh and Qwen candidate workers have stopped to establish the
standalone baseline. Use the same 200-product manifest for every run:

```bash
export TESSDATA_PREFIX="$PWD"
for concurrency in 1 2 4; do
  pnpm canary:product-images run \
    --manifest=../local-output/linux-cv-canary/manifest-200.json \
    --out=../local-output/linux-cv-canary/canary-c${concurrency}.json \
    --concurrency=${concurrency} \
    --ocr-workers=2
done
```

Each result contains wall and CPU time, peak process RSS, peak system load,
per-product duration, and per-image download, metadata, preprocessing, YOLO,
foreground, aesthetics, and OCR timings. It also records every candidate and
selection error. No selection is written to the database.

Start production with product concurrency 1-2 and two OCR workers. If
throughput is insufficient, first gate OCR to text/utility-suspect candidates
and repeat the measurements.

## Compare Linux CV with Apple Vision

Copy the same 300-product manifest to the Mac, then run:

```bash
pnpm canary:product-images run \
  --manifest=../local-output/linux-cv-canary/manifest-300.json \
  --out=../local-output/linux-cv-canary/canary-quality-300-apple.json \
  --concurrency=2
```

Generate the initial comparison and review UI:

```bash
pnpm canary:product-images compare \
  --linux=../local-output/linux-cv-canary/canary-quality-300-linux.json \
  --apple=../local-output/linux-cv-canary/canary-quality-300-apple.json \
  --out=../local-output/linux-cv-canary/comparison.json
```

Open `comparison.html`, classify differences, download `reviews.json`, and
rerun `compare` with `--reviews=reviews.json`. Severe labels are
`severe_utility` and `severe_broken`; the automatic-apply gate is strictly less
than 1% severe selections. `wrong_non_model` is tracked separately so it does
not silently become a broken/banner error.

For a single-run before/selected gallery:

```bash
pnpm canary:product-images report \
  --run=../local-output/linux-cv-canary/canary-quality-300-linux.json \
  --out=../local-output/linux-cv-canary/canary-quality-300-linux.html
```

The canary does not install a scheduler or enable production writes. Production
adoption remains a separate decision after the Apple comparison and manual
review pass.

## Run embedding after representative selection

Once the quality gate is approved, use the combined entrypoint. It selects only
products without a `product_embeddings` row, applies the existing optimistic
selection RPC, and then embeds the resulting `products.image_url` values:

```bash
LIMIT=200 \
IMAGE_SELECTION_CONCURRENCY=2 \
bash ./scripts/run-image-selection-before-embedding.sh
```

The embedding script also supports the same preflight directly when
`AUTO_SELECT_REPRESENTATIVE_IMAGES=true` and `CRAWLER_DIR` are set. If the
preflight fails, embedding stops before any vector write.

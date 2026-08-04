#!/usr/bin/env bash
set -uo pipefail

restore_refresh() {
  systemctl --user disable kiko-product-images.service >/dev/null 2>&1 || true
  systemctl --user enable --now kiko-refresh.timer >/dev/null 2>&1 || true
}
trap restore_refresh EXIT

# The currently running refresh may start its OnSuccess candidate pass a few
# seconds after becoming inactive. Require a full minute of idle time before
# claiming the crawler host.
idle_checks=0
unit_is_busy() {
  local state
  state="$(systemctl --user show "$1" -p ActiveState --value 2>/dev/null || true)"
  [[ "$state" == "active" || "$state" == "activating" || "$state" == "reloading" ]]
}
while (( idle_checks < 4 )); do
  if unit_is_busy kiko-refresh.service || unit_is_busy kiko-refresh-candidates.service; then
    idle_checks=0
  else
    idle_checks=$((idle_checks + 1))
  fi
  sleep 15
done

# concurrency 8 (was 3). Per-request latency is the whole cost here, not CPU.
#
# Measured on the host 2026-08-04, mid-pass at concurrency 3: load 0.91 of 12
# cores, 2GB of 62GB used, swap 0, the backfill itself drawing ~0.6 of a core
# across node plus four chrome-headless. The checkpoint says 70,405 products in
# 42.9h — 1,640/h, i.e. roughly 6.5s of wall clock per product spread over three
# slots. Nothing on this box is saturated; the slots are waiting on the network.
#
# The engine barely moves that number: cafe24 1,559/h through a Playwright page
# visit vs shopify 1,799/h through a plain product-JSON fetch. A fetch has no
# business being that slow, and `resolvectl statistics` explains it — 715,440
# cache misses against 137,468 hits with a live cache of 11 entries. Every visit
# pays a fresh DNS round trip. **Fixing the resolver is the larger lever than
# anything in this file**; raising concurrency only buys more slots to wait in.
#
# refresh fell back from 8 to 4 over dropped DNS queries, but that verdict does
# not transfer: there a failed visit leaves the completeness guard on while
# applyUpdates keeps running, so stock accuracy degrades. Here a failed row is
# never written to the checkpoint, the attempt loop retries it, and writes go
# through the `merge_product_images` union RPC, which never removes an image.
#
# One process for the whole catalogue, not one per platform key. This is
# housekeeping, not speed — the per-key pnpm/tsx/chromium startup measured 7-8s
# against ~19 minutes of work per key, 0.4h of 42.9h total. It is worth doing
# because the cost grows: every key re-parses the whole checkpoint file, which
# reaches one line per product (~158k) by the end. `--all` keeps the identical
# per-platform grouping and robots check inside the tool.
status=1
for attempt in 1 2 3; do
  echo "product image backfill attempt ${attempt}/3"
  corepack pnpm repair:product-images -- \
    --apply \
    --all \
    --concurrency=8 \
    --checkpoint=data/product-image-backfill/full.jsonl
  status=$?
  if (( status == 0 )); then
    break
  fi
  sleep 60
done

exit "$status"

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

# One process for the whole catalogue, not one per platform key.
#
# The per-key loop paid its startup cost 398 times: a chromium launch, a robots
# fetch, and a full re-parse of the checkpoint file — which grows to one line
# per product (~158k at completion), so the last keys re-read the entire file to
# learn they have nothing to skip. Keys of a handful of products spent more time
# starting than visiting (measured 2026-08-04: `htav`, 3 products, 0.3 min).
# `--all` keeps the identical per-platform grouping and robots check inside the
# tool; only the process boundary disappears.
#
# concurrency 8 (was 3). The host is nowhere near its limit — peak RSS 4.5GB of
# 62GB, load 1.6 of 12 cores, swap 0, measured 2026-08-02 while listing refresh
# ran at concurrency 8, which is the heavier job. refresh had to fall back to 4
# because DNS queries were being dropped, but that verdict does not transfer:
# there a failed visit leaves the completeness guard on while applyUpdates keeps
# running, so stock accuracy degrades. Here a failed row is simply not written to
# the checkpoint and gets retried by the attempt loop, and writes go through the
# `merge_product_images` union RPC, which never removes an existing image.
#
# Throughput is engine-bound, so watch cafe24: shopify reads product JSON over
# fetch (10,244 rows/h measured) while cafe24 opens the page in Playwright
# (2,481 rows/h) and is the bulk of the remaining work.
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

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

status=1
for attempt in 1 2 3; do
  echo "product image backfill attempt ${attempt}/3"
  status=0
  mapfile -t platforms < <(corepack pnpm exec tsx src/repair-product-images.ts --list-sites)
  for platform in "${platforms[@]}"; do
    corepack pnpm repair:product-images -- \
      --apply \
      --site="$platform" \
      --concurrency=3 \
      --checkpoint=data/product-image-backfill/full.jsonl
    platform_status=$?
    if (( platform_status != 0 )); then
      status=$platform_status
    fi
  done
  if (( status == 0 )); then
    break
  fi
  sleep 60
done

exit "$status"

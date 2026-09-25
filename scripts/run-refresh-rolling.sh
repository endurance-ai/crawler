#!/usr/bin/env bash
# Hourly bounded refresh: a short source listing pass followed by oldest-product checks.
set -euo pipefail
cd "$(dirname "$0")/.."

exec 9>/tmp/kiko-refresh-rolling.lock
if ! flock -n 9; then
  echo "rolling refresh skipped: previous run still holds the lock"
  exit 0
fi

PNPM=${PNPM:-pnpm}
read -r -a pnpm_command <<< "$PNPM"
run_started_at=$(date --iso-8601=seconds)
listing_deadline=$(date -d '+15 minutes' --iso-8601=seconds)
zara_deadline=$(date -d '+25 minutes' --iso-8601=seconds)
detail_deadline=$(date -d '+50 minutes' --iso-8601=seconds)
retry_state_file=${REFRESH_ROLLING_RETRY_STATE_FILE:-/home/kjk/.local/state/kiko-refresh/rolling-retries.json}
detail_limit=${REFRESH_ROLLING_DETAIL_LIMIT:-5000}
zara_detail_limit=${REFRESH_ROLLING_ZARA_LIMIT:-180}
phase_failures=0

echo "rolling refresh start: started_at=$run_started_at detail_limit=$detail_limit detail_deadline=$detail_deadline"

run_detail_phase() {
  local label=$1
  shift
  if ! "$@"; then
    phase_failures=$((phase_failures + 1))
    echo "rolling $label detail phase reported failures; continuing ($phase_failures)" >&2
  fi
}

# The source worklist is ordered by oldest last_attempted_at. Listing pages
# confirm many products per request and retain each engine's resumable cursor.
if ! "${pnpm_command[@]}" refresh -- \
  --existing-only \
  --type=cafe24,shopify,imweb,uniqlo,farfetch,sixshop,structured \
  --limit=20 \
  --budget-minutes=15 \
  --source-slice-minutes=5 \
  --concurrency=2 \
  --deadline-at="$listing_deadline"; then
  phase_failures=$((phase_failures + 1))
  echo "rolling listing phase reported failures; continuing with detail coverage" >&2
fi

common_detail_args=(
  --rolling
  --since="$run_started_at"
  --shopify-source-concurrency=1
  --zara-source-concurrency=1
  --priority=oldest
  --retry-state-file="$retry_state_file"
)

CRAWLER_ZARA_HEADED=${CRAWLER_ZARA_HEADED:-1}
export CRAWLER_ZARA_HEADED
if [ "$CRAWLER_ZARA_HEADED" = "1" ] && [ -z "${DISPLAY:-}" ]; then
  run_detail_phase zara xvfb-run -a "${pnpm_command[@]}" refresh:fallback -- \
    "${common_detail_args[@]}" --type=zara --limit="$zara_detail_limit" \
    --concurrency=2 --deadline-at="$zara_deadline"
else
  run_detail_phase zara "${pnpm_command[@]}" refresh:fallback -- \
    "${common_detail_args[@]}" --type=zara --limit="$zara_detail_limit" \
    --concurrency=2 --deadline-at="$zara_deadline"
fi

run_detail_phase general "${pnpm_command[@]}" refresh:fallback -- \
  "${common_detail_args[@]}" --type=cafe24,shopify,imweb,sixshop \
  --limit="$detail_limit" --concurrency=8 --deadline-at="$detail_deadline"

echo "rolling refresh complete: ended_at=$(date --iso-8601=seconds) phase_failures=$phase_failures"
if [ "$phase_failures" -gt 0 ]; then exit 1; fi

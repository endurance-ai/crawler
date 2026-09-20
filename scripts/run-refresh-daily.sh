#!/usr/bin/env bash
# One nightly manifest with bounded phases and source-level retry.
set -euo pipefail
cd "$(dirname "$0")/.."

. "$(dirname "$0")/lib-batch-prep.sh"
batch_prep

PNPM=${PNPM:-pnpm}
read -r -a pnpm_command <<< "$PNPM"
CRAWLER_ZARA_HEADED=${CRAWLER_ZARA_HEADED:-1}
export CRAWLER_ZARA_HEADED
if [ "$CRAWLER_ZARA_HEADED" = "1" ] && [ -z "${DISPLAY:-}" ]; then
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "xvfb-run is required for headed Zara refresh" >&2
    exit 1
  fi
fi
now_epoch=$(date +%s)
today_kst=$(TZ=Asia/Seoul date +%F)
if [ "$(TZ=Asia/Seoul date +%H)" -ge 12 ]; then
  scheduled_for="$today_kst"
else
  scheduled_for=$(TZ=Asia/Seoul date -d 'yesterday' +%F)
fi
scheduled_for=${REFRESH_SCHEDULED_FOR:-$scheduled_for}
start_epoch=$(TZ=Asia/Seoul date -d "$scheduled_for 12:00" +%s)
if [ -n "${REFRESH_DEADLINE_AT:-}" ]; then
  deadline_at=$REFRESH_DEADLINE_AT
  deadline_epoch=$(date -d "$deadline_at" +%s)
else
  deadline_epoch=$((start_epoch + 16 * 60 * 60 + 15 * 60))
  deadline_at=$(TZ=Asia/Seoul date -d "@$deadline_epoch" --iso-8601=seconds)
fi
if [ -n "${REFRESH_CAFE24_DEADLINE_AT:-}" ]; then
  cafe24_deadline=$REFRESH_CAFE24_DEADLINE_AT
else
  cafe24_deadline_epoch=$((start_epoch + 13 * 60 * 60))
  cafe24_deadline=$(TZ=Asia/Seoul date -d "@$cafe24_deadline_epoch" --iso-8601=seconds)
fi
fallback_start_epoch=$((start_epoch + 13 * 60 * 60 + 15 * 60))
fallback_start=$(TZ=Asia/Seoul date -d "@$fallback_start_epoch" --iso-8601=seconds)
coverage_start=$(TZ=Asia/Seoul date -d "@$now_epoch" --iso-8601=seconds)
batch_id=""
batch_finalized=0
phase_failures=0
zara_fallback_pid=""
shopify_fallback_pid=""
shoplcdc_fallback_pid=""

finalize_on_exit() {
  local rc=$?
  local finalize_rc=0
  trap - EXIT
  local background_pid
  for background_pid in "$zara_fallback_pid" "$shopify_fallback_pid" "$shoplcdc_fallback_pid"; do
    if [ -n "$background_pid" ] && kill -0 "$background_pid" 2>/dev/null; then
      kill "$background_pid" 2>/dev/null || true
      wait "$background_pid" 2>/dev/null || true
    fi
  done
  if [ -n "$batch_id" ] && [ "$batch_finalized" -eq 0 ]; then
    set +e
    "${pnpm_command[@]}" refresh:batch -- --finalize --id="$batch_id"
    finalize_rc=$?
    set -e
    if [ "$rc" -eq 0 ] && [ "$finalize_rc" -ne 0 ]; then rc=$finalize_rc; fi
  fi
  exit "$rc"
}
trap finalize_on_exit EXIT

run_refresh_phase() {
  local needs_zara=1
  local arg types
  local -a prefix=()
  for arg in "$@"; do
    if [[ "$arg" == --type=* ]]; then
      types=",${arg#--type=},"
      if [[ "$types" != *,zara,* ]]; then needs_zara=0; fi
    fi
  done
  if [ "$needs_zara" -eq 1 ] && [ "$CRAWLER_ZARA_HEADED" = "1" ] && [ -z "${DISPLAY:-}" ]; then
    prefix=(xvfb-run -a)
  fi
  if ! "${prefix[@]}" "${pnpm_command[@]}" refresh -- "$@"; then
    phase_failures=$((phase_failures + 1))
    echo "refresh phase completed with recorded exceptions; continuing ($phase_failures)" >&2
  fi
}

run_fallback_phase() {
  if ! "${pnpm_command[@]}" refresh:fallback -- "$@"; then
    phase_failures=$((phase_failures + 1))
    echo "refresh detail fallback completed with recorded exceptions; continuing ($phase_failures)" >&2
  fi
}

start_zara_fallback_phase() {
  if [ "$CRAWLER_ZARA_HEADED" = "1" ] && [ -z "${DISPLAY:-}" ]; then
    xvfb-run -a "${pnpm_command[@]}" refresh:fallback -- "$@" &
  else
    "${pnpm_command[@]}" refresh:fallback -- "$@" &
  fi
  zara_fallback_pid=$!
}

wait_zara_fallback_phase() {
  if [ -z "$zara_fallback_pid" ]; then return; fi
  if ! wait "$zara_fallback_pid"; then
    phase_failures=$((phase_failures + 1))
    echo "Zara detail fallback completed with recorded exceptions; continuing ($phase_failures)" >&2
  fi
  zara_fallback_pid=""
}

start_shopify_fallback_phase() {
  "${pnpm_command[@]}" refresh:fallback -- "$@" &
  shopify_fallback_pid=$!
}

wait_shopify_fallback_phase() {
  if [ -z "$shopify_fallback_pid" ]; then return; fi
  if ! wait "$shopify_fallback_pid"; then
    phase_failures=$((phase_failures + 1))
    echo "Shopify detail fallback completed with recorded exceptions; continuing ($phase_failures)" >&2
  fi
  shopify_fallback_pid=""
}

start_shoplcdc_fallback_phase() {
  "${pnpm_command[@]}" refresh:fallback -- "$@" &
  shoplcdc_fallback_pid=$!
}

wait_shoplcdc_fallback_phase() {
  if [ -z "$shoplcdc_fallback_pid" ]; then return; fi
  if ! wait "$shoplcdc_fallback_pid"; then
    phase_failures=$((phase_failures + 1))
    echo "ShopLCDC detail fallback completed with recorded exceptions; continuing ($phase_failures)" >&2
  fi
  shoplcdc_fallback_pid=""
}

batch_output=$("${pnpm_command[@]}" --silent refresh:batch -- --start --scheduled-for="$scheduled_for" --deadline-at="$deadline_at")
batch_id=${batch_output##*$'\n'}
if [[ ! "$batch_id" =~ ^[0-9]+$ ]]; then
  echo "invalid refresh batch id: $batch_output" >&2
  exit 1
fi
echo "refresh batch $batch_id scheduled_for=$scheduled_for deadline=$deadline_at"

# Zara uses one headed browser and one persistent context. Run it serially so
# KR and US do not challenge the same egress IP at the same time.
zara_deadline_epoch=$((now_epoch + 45 * 60))
if [ "$zara_deadline_epoch" -gt "$deadline_epoch" ]; then zara_deadline_epoch=$deadline_epoch; fi
zara_deadline=$(TZ=Asia/Seoul date -d "@$zara_deadline_epoch" --iso-8601=seconds)
run_refresh_phase \
  --batch-id="$batch_id" --only-pending --ignore-backoff --existing-only --type=zara \
  --budget-minutes=45 --source-slice-minutes=25 --concurrency=1 \
  --deadline-at="$zara_deadline"

# Fast API/structured sources get the remainder of the first 75 minutes.
fast_deadline_epoch=$((now_epoch + 75 * 60))
if [ "$fast_deadline_epoch" -gt "$deadline_epoch" ]; then fast_deadline_epoch=$deadline_epoch; fi
fast_deadline=$(TZ=Asia/Seoul date -d "@$fast_deadline_epoch" --iso-8601=seconds)
run_refresh_phase \
  --batch-id="$batch_id" --only-pending --ignore-backoff --existing-only \
  --type=shopify,imweb,uniqlo,farfetch,sixshop,structured \
  --budget-minutes=75 --source-slice-minutes=10 --concurrency=8 \
  --deadline-at="$fast_deadline"

# Retry transient fast-engine failures while their Retry-After window is still
# useful. Waiting until the 03:30 drain left only 15 minutes for large Shopify
# sources and made Cafe24 consume the whole middle of the night first.
fast_retry_deadline_epoch=$((start_epoch + 2 * 60 * 60))
if [ "$fast_retry_deadline_epoch" -gt "$deadline_epoch" ]; then fast_retry_deadline_epoch=$deadline_epoch; fi
fast_retry_deadline=$(TZ=Asia/Seoul date -d "@$fast_retry_deadline_epoch" --iso-8601=seconds)
run_refresh_phase \
  --batch-id="$batch_id" --only-pending --ignore-backoff --existing-only --max-attempts=2 \
  --type=shopify,imweb,uniqlo,farfetch,sixshop,structured \
  --budget-minutes=45 --source-slice-minutes=10 --concurrency=8 \
  --deadline-at="$fast_retry_deadline"

# Give a blocked or interrupted Zara source one serial retry before Cafe24
# consumes the long overnight window.
zara_retry_deadline_epoch=$((start_epoch + 2 * 60 * 60 + 45 * 60))
if [ "$zara_retry_deadline_epoch" -gt "$deadline_epoch" ]; then zara_retry_deadline_epoch=$deadline_epoch; fi
zara_retry_deadline=$(TZ=Asia/Seoul date -d "@$zara_retry_deadline_epoch" --iso-8601=seconds)
run_refresh_phase \
  --batch-id="$batch_id" --only-pending --ignore-backoff --existing-only --max-attempts=2 \
  --type=zara --budget-minutes=45 --source-slice-minutes=25 --concurrency=1 \
  --deadline-at="$zara_retry_deadline"

# Zara's current listing covers restocked and currently sold-out products, but
# discontinued URLs need detail checks as well. Refresh KR and US serially per
# source in parallel with the long Cafe24 phase, then reconcile their combined
# listing/detail coverage before batch finalization.
start_zara_fallback_phase \
  --batch-id="$batch_id" --since="$coverage_start" --type=zara \
  --concurrency=2 --zara-source-concurrency=1 --priority=oldest --reconcile-min-coverage=1 \
  --deadline-at="$fallback_start"

# Shopify detail APIs are cheap but source-rate-limited. One lane per source,
# paced by each config's crawlDelay, can run beside Cafe24 without shortening
# its browser-heavy listing window.
start_shopify_fallback_phase \
  --batch-id="$batch_id" --since="$coverage_start" --type=shopify \
  --concurrency=8 --shopify-source-concurrency=1 --priority=oldest --reconcile-min-coverage=1 \
  --deadline-at="$fallback_start"

# ShopLCDC currently exposes no products through its Cafe24 category listings,
# while its historical detail URLs remain live. Refresh every existing URL --
# including rows currently marked out of stock -- so restocks are observable.
# A dedicated serial lane finishes comfortably inside the long Cafe24 window
# without applying the broken listing's 0% overlap as a stock signal.
start_shoplcdc_fallback_phase \
  --batch-id="$batch_id" --since="$coverage_start" --type=cafe24 --site=shoplcdc \
  --concurrency=1 --priority=oldest --reconcile-min-coverage=1 \
  --deadline-at="$fallback_start"

# Cafe24 is the dominant workload; give it the longest contiguous window.
run_refresh_phase \
  --batch-id="$batch_id" --only-pending --ignore-backoff --existing-only --type=cafe24 \
  --budget-minutes=600 --source-slice-minutes=20 --concurrency=8 \
  --deadline-at="$cafe24_deadline"

# Drain partial/transient sources before the detail fallback window.
run_refresh_phase \
  --batch-id="$batch_id" --only-pending --ignore-backoff --existing-only --max-attempts=2 \
  --type=cafe24,shopify,imweb,uniqlo,farfetch,sixshop,structured \
  --budget-minutes=600 --source-slice-minutes=10 --concurrency=8 \
  --deadline-at="$fallback_start"

wait_zara_fallback_phase
wait_shopify_fallback_phase
wait_shoplcdc_fallback_phase

# Use the final three hours to confirm every existing product missing from the
# listing pass, including rows that were already out of stock.
run_fallback_phase \
  --batch-id="$batch_id" --since="$coverage_start" --type=cafe24,shopify,imweb,sixshop \
  --concurrency=8 --priority=oldest --reconcile-min-coverage=1 \
  --deadline-at="$deadline_at"

"${pnpm_command[@]}" refresh:batch -- --finalize --id="$batch_id"
batch_finalized=1
if [ "$phase_failures" -gt 0 ]; then
  echo "refresh batch completed with $phase_failures recorded phase failure(s); final batch status is authoritative" >&2
fi

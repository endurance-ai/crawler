#!/usr/bin/env bash
# One nightly manifest with bounded phases and source-level retry.
set -euo pipefail
cd "$(dirname "$0")/.."

. "$(dirname "$0")/lib-batch-prep.sh"
batch_prep

PNPM=${PNPM:-pnpm}
now_epoch=$(date +%s)
today_kst=$(TZ=Asia/Seoul date +%F)
if [ "$(TZ=Asia/Seoul date +%H)" -ge 12 ]; then
  scheduled_for="$today_kst"
else
  scheduled_for=$(TZ=Asia/Seoul date -d 'yesterday' +%F)
fi
deadline_at=$(TZ=Asia/Seoul date -d 'tomorrow 04:15' --iso-8601=seconds)
batch_id=$($PNPM refresh:batch -- --start --deadline-at="$deadline_at")
echo "refresh batch $batch_id scheduled_for=$scheduled_for deadline=$deadline_at"

# Fast API/structured sources get the first 75 minutes.
fast_deadline=$(TZ=Asia/Seoul date -d '75 minutes' --iso-8601=seconds)
$PNPM refresh -- \
  --batch-id="$batch_id" --only-pending --ignore-backoff \
  --type=shopify,imweb,uniqlo,zara,farfetch,sixshop,structured \
  --budget-minutes=75 --source-slice-minutes=20 --concurrency=3 \
  --deadline-at="$fast_deadline"

# Cafe24 is the dominant workload; give it the longest contiguous window.
cafe24_deadline=$(TZ=Asia/Seoul date -d 'tomorrow 03:30' --iso-8601=seconds)
$PNPM refresh -- \
  --batch-id="$batch_id" --only-pending --ignore-backoff --type=cafe24 \
  --budget-minutes=480 --source-slice-minutes=20 --concurrency=9 \
  --deadline-at="$cafe24_deadline"

# Drain partial/transient sources until the hard batch deadline.
$PNPM refresh -- \
  --batch-id="$batch_id" --only-pending --ignore-backoff --max-attempts=2 \
  --budget-minutes=45 --source-slice-minutes=10 --concurrency=6 \
  --deadline-at="$deadline_at"

$PNPM refresh:batch -- --finalize --id="$batch_id"

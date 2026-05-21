#!/usr/bin/env bash
# 5분 간격 progress logger — /goal 실행 중 별도 터미널에서 띄워둠
# 사용: bash tools/enrichment_progress_logger.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
M="$REPO/data/brand-enrichment/manifest.jsonl"
RQ="$REPO/data/brand-enrichment/review_queue.jsonl"
TARGET=2899
LOG="$REPO/data/brand-enrichment/progress.log"

mkdir -p "$(dirname "$M")"
touch "$M" "$RQ"

while true; do
  TS="$(date '+%Y-%m-%d %H:%M:%S')"
  N=$(wc -l < "$M" | tr -d ' ')
  OK=$(grep -c '"status": "ok"' "$M" 2>/dev/null || echo 0)
  REVIEW=$(grep -c '"status": "review"' "$M" 2>/dev/null || echo 0)
  NODATA=$(grep -c '"status": "no_data"' "$M" 2>/dev/null || echo 0)
  ERR=$(grep -c '"status": "error"' "$M" 2>/dev/null || echo 0)
  PCT=$(awk -v n="$N" -v t="$TARGET" 'BEGIN{printf "%.1f", (n/t)*100}')
  RECENT=$(tail -3 "$M" 2>/dev/null | python3 -c "import sys,json; [print(json.loads(l).get('brand_name','?')) for l in sys.stdin]" 2>/dev/null | tr '\n' ',' | sed 's/,$//')
  LINE="[$TS] processed=$N/$TARGET ($PCT%) ok=$OK review=$REVIEW no_data=$NODATA error=$ERR recent=$RECENT"
  echo "$LINE"
  echo "$LINE" >> "$LOG"
  sleep 300
done

#!/bin/bash
# 2026-06 코호트 재수집 드라이버 — 키 단위, 스테이지 마커 기반 재개.
#
# 옛 추출 로직(2026-06-22 전후)으로 만들어진 브랜드를 현재 로직으로 처음부터
# 다시 수집한다. 경로는 crawl -> (게이트) -> import+Qwen -> guardrail 이며,
# 각 스테이지는 마커 파일로 재개된다.
#
# Usage:
#   tools/recollect-batch.sh --keys browns,kith [options]
#   tools/recollect-batch.sh --keys-file batch-0.txt --run-id run-2026-07-28
#
# Options:
#   --keys <a,b,c>        대상 platform key (콤마 구분)
#   --keys-file <path>    키를 줄 단위로 담은 파일 (--keys 대신)
#   --run-id <name>       산출물 디렉터리 이름 (기본: recollect-YYYYMMDD-HHMM)
#   --out-root <dir>      산출물 루트 (기본: data/recollect)
#   --engine <name>       cafe24 엔진: chromium (기본) | lightpanda
#   --force-stage <a,b>   해당 스테이지 마커를 무시하고 재실행 (crawl,import,embed)
#   --skip-embeddings     임베딩 스냅샷/무효화 스테이지 생략
#   --apply-embeddings    임베딩 무효화를 실제로 적용 (기본은 dry-run)
#   --dry-run             무엇을 할지만 출력
#
# 왜 onboard-batch.sh 가 아니라 별도 드라이버인가:
#   1. product-extraction-poc.ts 의 clonePocConfig 가 maxPages 를 1로 클램프해서
#      shopify 브랜드가 250개에서 잘린다 (browns 는 11,455개다).
#   2. onboard-classify.ts 의 payload 에 images/tags/sizeInfo/productCode 가 없어
#      기존 행에 upsert 하면 그 컬럼들이 NULL 로 덮인다.
#   3. poc 는 cafe24/shopify 만 지원한다 (zara/uniqlo 4키 12,432행이 대상 밖).
#   src/crawl.ts 경로는 셋 다 해당 없다.
#
# 종료 코드: 0 = 정상, 1 = 게이트/스테이지 실패, 2 = 사용법/파일 설정 오류.
set -uo pipefail

KEYS=""
KEYS_FILE=""
RUN_ID=""
OUT_ROOT="data/recollect"
ENGINE="chromium"
FORCE_STAGE=""
SKIP_EMBEDDINGS=0
APPLY_EMBEDDINGS=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --keys) KEYS="$2"; shift 2 ;;
    --keys-file) KEYS_FILE="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --out-root) OUT_ROOT="$2"; shift 2 ;;
    --engine) ENGINE="$2"; shift 2 ;;
    --force-stage) FORCE_STAGE="$2"; shift 2 ;;
    --skip-embeddings) SKIP_EMBEDDINGS=1; shift ;;
    --apply-embeddings) APPLY_EMBEDDINGS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -n "$KEYS_FILE" ]; then
  [ -f "$KEYS_FILE" ] || { echo "error: keys-file not found: $KEYS_FILE" >&2; exit 1; }
  KEYS=$(grep -v '^[[:space:]]*#' "$KEYS_FILE" | tr '\n' ',' | sed 's/,,*/,/g; s/^,//; s/,$//')
fi
[ -n "$KEYS" ] || { echo "error: --keys or --keys-file is required" >&2; exit 1; }
[ "$ENGINE" = "chromium" ] || [ "$ENGINE" = "lightpanda" ] || {
  echo "error: --engine must be chromium or lightpanda" >&2; exit 1; }

[ -n "$RUN_ID" ] || RUN_ID="recollect-$(date +%Y%m%d-%H%M)"
RUN_DIR="$OUT_ROOT/$RUN_ID"
TALLY="$RUN_DIR/tally.csv"
PNPM="corepack pnpm exec dotenv -e .env -e .env.local --"

mkdir -p "$RUN_DIR" data
[ -f "$TALLY" ] || echo "key,before_rows,crawled_rows,qwen_success,import_ok,after_rows,color_noncanon_before,color_noncanon_after,result" > "$TALLY"

# 캠페인 도중 분류 로직이 바뀌면 배치 0과 배치 8의 결과를 비교할 수 없다.
# 시작 시점 커밋을 남겨 두고, 나중에 결과를 볼 때 대조할 수 있게 한다.
MANIFEST="$RUN_DIR/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  cat > "$MANIFEST" <<EOF
{
  "runId": "$RUN_ID",
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commit": "$(git rev-parse HEAD 2>/dev/null || echo unknown)",
  "branch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)",
  "engine": "$ENGINE",
  "keys": "$KEYS"
}
EOF
fi

forced() { case ",$FORCE_STAGE," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
have()   { [ -f "$1" ] && ! forced "$2"; }

log() { echo "[$(date +%H:%M:%S)] $*"; }

# recollect-metrics 산출 JSON 에서 지표 하나를 뽑는다.
read_metric() {
  node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.metrics[process.argv[2]])}catch(e){console.log("")}' "$1" "$2"
}

# 크롤 산출 JSON 의 행 수.
count_rows() {
  node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)}catch(e){console.log(0)}' "$1"
}

FAILED_KEYS=""
STOP_CAMPAIGN=0

for KEY in $(echo "$KEYS" | tr ',' ' '); do
  [ "$STOP_CAMPAIGN" -eq 1 ] && break

  KEY_DIR="$RUN_DIR/$KEY"
  mkdir -p "$KEY_DIR"
  PRODUCTS_FILE="data/$KEY-products.json"
  BEFORE_JSON="$KEY_DIR/before.json"
  AFTER_JSON="$KEY_DIR/after.json"
  IMAGES_BEFORE="$KEY_DIR/images-before.jsonl"
  BATCH_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  echo ""
  echo "═══════════ $KEY ═══════════"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "dry-run: crawl -> gate -> import+Qwen -> guardrail -> verify -> embeddings"
    continue
  fi

  # ── 1. preflight: 기준 지표 + 이미지 스냅샷 + 옛 산출물 격리 ──
  if [ ! -f "$BEFORE_JSON" ]; then
    log "1/7 preflight — 기준 지표"
    $PNPM tsx tools/recollect-metrics.ts --platform="$KEY" --out="$BEFORE_JSON" > "$KEY_DIR/before.log" 2>&1 || {
      log "  ✖ 기준 지표 실패 — $KEY_DIR/before.log"; FAILED_KEYS="$FAILED_KEYS $KEY"; continue; }
    tail -14 "$KEY_DIR/before.log"
  else
    log "1/7 preflight — 기준 지표 재사용"
  fi

  if [ "$SKIP_EMBEDDINGS" -eq 0 ] && [ ! -f "$IMAGES_BEFORE" ]; then
    $PNPM tsx tools/invalidate-changed-embeddings.ts --platform="$KEY" --snapshot="$IMAGES_BEFORE" \
      > "$KEY_DIR/images-before.log" 2>&1 || {
      log "  ✖ 이미지 스냅샷 실패 — $KEY_DIR/images-before.log"; FAILED_KEYS="$FAILED_KEYS $KEY"; continue; }
  fi

  # writeProductsFile 은 상품이 0개면 파일을 아예 안 쓴다 (src/crawl.ts). 옛 파일이
  # 남아 있으면 크롤이 실패해도 그 파일이 그대로 재보강·재적재되고 import 는 성공을
  # 보고한다 — 캠페인에서 가장 위험한 조용한 no-op 이라 먼저 치운다.
  if [ -f "$PRODUCTS_FILE" ] && ! have "$KEY_DIR/crawl.done" crawl; then
    mv "$PRODUCTS_FILE" "$KEY_DIR/prev-products.json"
    log "  옛 산출물 격리 → $KEY_DIR/prev-products.json"
  fi
  if ! have "$KEY_DIR/crawl.done" crawl; then
    # New crawl invalidates downstream completion, including forced-only crawl.
    rm -f "$KEY_DIR/import.done" "$KEY_DIR/import-report.json" "$KEY_DIR/import-artifact.json" "$KEY_DIR/embed.done"
  fi

  # ── 2. crawl ──
  if have "$KEY_DIR/crawl.done" crawl; then
    log "2/7 crawl — 스킵 (마커 존재)"
  else
    log "2/7 crawl — pnpm crawl --site=$KEY --detail --include-out-of-stock"
    CRAWL_START=$(date +%s)
    # CRAWLER_QC_NORMALIZATION_ENABLED=false: 크롤 시점의 규칙 기반 QC 게이트를
    # 끈다. 단일 카테고리 config(category.gender=["men"] 같은)를 쓰는 사이트는
    # 상품명이 순수 스타일 코드("101","137CS")뿐이라 카테고리 텍스트 매칭이
    # 안 되고, 크롤 시점 게이트가 "category_noncanonical_dropped" 로 전량
    # 걸러버린다 — import 후 Qwen 보강이 손쓸 기회조차 없이 파일이 통째로 안 써진다
    # (2026-07-28 배치 1 실측: bastong 4823개 전량 드롭). import-products.ts
    # 가 :541-542 에서 같은 게이트를 독립적으로 다시 돌리므로(이번엔 env var
    # 없이, 기본 활성 상태), 비canonical category를 먼저 other로 안전하게
    # 저장한 뒤 Qwen이 조건부 보강한다. gender 는 이 플래그와 무관하게 항상 켜져
    # 있는 별도 스키마 검증(gender: min(1))이 계속 막으므로 세탁 위험 없음.
    CRAWLER_CAFE24_ENGINE="$ENGINE" CRAWLER_QC_NORMALIZATION_ENABLED=false $PNPM tsx src/crawl.ts \
      --site="$KEY" --detail --include-out-of-stock > "$KEY_DIR/crawl.log" 2>&1
    CRAWL_CODE=$?
    if [ "$CRAWL_CODE" -ne 0 ]; then
      log "  ✖ crawl 종료코드 $CRAWL_CODE — $KEY_DIR/crawl.log"
      FAILED_KEYS="$FAILED_KEYS $KEY"; continue
    fi

    # ── 3. gate-crawl: 새로 쓰인 파일인가 ──
    if [ ! -f "$PRODUCTS_FILE" ]; then
      log "  ✖ 산출 파일 없음 — 크롤이 0개를 반환했다 (writeProductsFile 이 안 씀)"
      FAILED_KEYS="$FAILED_KEYS $KEY"; continue
    fi
    FILE_MTIME=$(date -r "$PRODUCTS_FILE" +%s 2>/dev/null || stat -c %Y "$PRODUCTS_FILE")
    if [ "$FILE_MTIME" -lt "$CRAWL_START" ]; then
      log "  ✖ 산출 파일이 이번 크롤로 갱신되지 않았다 (mtime < 크롤 시작) — 조용한 no-op"
      FAILED_KEYS="$FAILED_KEYS $KEY"; continue
    fi
    touch "$KEY_DIR/crawl.done"
  fi
  CRAWLED_ROWS=$(count_rows "$PRODUCTS_FILE")
  log "  크롤 ${CRAWLED_ROWS}행"

  # ── 4. gate: import 직전 차단 게이트 ──
  # 여기를 넘기면 upsert 는 되돌릴 수 없다.
  log "3/7 gate — import 전 차단 게이트"
  $PNPM tsx tools/recollect-metrics.ts \
    --file="$PRODUCTS_FILE" --site="$KEY" --before="$BEFORE_JSON" --out="$KEY_DIR/gate.json" \
    > "$KEY_DIR/gate.log" 2>&1
  GATE_CODE=$?
  tail -20 "$KEY_DIR/gate.log"
  if [ "$GATE_CODE" -eq 3 ]; then
    log "  🛑 게이트 실패 — import 하지 않고 이 키를 건너뛴다 (기존 데이터 보존)"
    FAILED_KEYS="$FAILED_KEYS $KEY"; continue
  elif [ "$GATE_CODE" -ne 0 ]; then
    log "  ✖ 게이트 오류 (코드 $GATE_CODE) — $KEY_DIR/gate.log"
    FAILED_KEYS="$FAILED_KEYS $KEY"; continue
  fi

  # ── 5. verified Qwen preparation + conditional import ──
  # --in-stock-only 를 쓰지 않는다: --include-out-of-stock 으로 품절을 일부러
  #   가져왔는데 여기서 걸러내면 방금 만든 구멍을 그대로 재생산한다.
  # --no-new-brands 도 쓰지 않는다: 코호트의 brand_nodes 커버리지 99.9%는 6/22
  #   import 가 이 플래그 없이 만든 결과라, 빼는 쪽이 원래 동작이다.
  IMPORT_REPORT="$KEY_DIR/import-report.json"
  if have "$KEY_DIR/import.done" import && node tools/pipeline-artifact.mjs check "$KEY_DIR/import-artifact.json" "$PRODUCTS_FILE" "$KEY" && node --import tsx tools/pipeline-report.ts check "$IMPORT_REPORT" "$KEY"; then
    log "4/7 import+Qwen — 스킵 (완료 report 검증됨)"
  else
    log "4/7 import+Qwen — pnpm import:products --site=$KEY"
    rm -f "$IMPORT_REPORT" "$KEY_DIR/import.done"
    $PNPM tsx src/import-products.ts --site="$KEY" --report="$IMPORT_REPORT" > "$KEY_DIR/import.log" 2>&1
    if [ $? -ne 0 ]; then
      log "  ✖ import 실패 — $KEY_DIR/import.log"
      FAILED_KEYS="$FAILED_KEYS $KEY"; continue
    fi
    if ! node --import tsx tools/pipeline-report.ts check "$IMPORT_REPORT" "$KEY"; then
      log "  ✖ import 완료 report 없음/실패 — $IMPORT_REPORT"
      FAILED_KEYS="$FAILED_KEYS $KEY"; continue
    fi
    # Import may add verified normalization checkpoints to this same file.
    node tools/pipeline-artifact.mjs record "$KEY_DIR/import-artifact.json" "$PRODUCTS_FILE" "$KEY" || {
      log "  ✖ import artifact 기록 실패"; FAILED_KEYS="$FAILED_KEYS $KEY"; continue; }
    touch "$KEY_DIR/import.done"
  fi
  IMPORT_OK=$(node --import tsx tools/pipeline-report.ts count "$IMPORT_REPORT" applied)
  QWEN_SUCCESS=$(node --import tsx tools/pipeline-report.ts count "$IMPORT_REPORT" normalization_succeeded)
  log "  적재 ${IMPORT_OK}건"

  # ── 6. gate-import: QC 통과율 붕괴는 캠페인 전체 중단 신호 ──
  if [ "$(node --import tsx tools/pipeline-report.ts count "$IMPORT_REPORT" qc_failed)" -gt 0 ]; then
    log "  🛑 QC 통과율이 MIN_QC_PASS_RATE 미만 — 공유 회귀 의심, 캠페인 전체 중단"
    FAILED_KEYS="$FAILED_KEYS $KEY"; STOP_CAMPAIGN=1; continue
  fi

  # ── 7. guardrail + verify ──
  log "5/7 guardrail — 비canonical category 정리"
  if ! $PNPM tsx tools/reclassify-categories.ts --only-invalid --platform="$KEY" > "$KEY_DIR/guardrail.log" 2>&1; then
    log "  ❌ guardrail 실패(Qwen/SSH tunnel 또는 DB 오류) — 완료 마커를 만들지 않음"
    FAILED_KEYS="$FAILED_KEYS $KEY"; continue
  fi

  log "6/7 verify — 사후 지표"
  if ! $PNPM tsx tools/recollect-metrics.ts \
    --platform="$KEY" --before="$BEFORE_JSON" --untouched-since="$BATCH_START" --out="$AFTER_JSON" \
    > "$KEY_DIR/after.log" 2>&1; then
    log "  ✖ 사후 검증 실패 — $KEY_DIR/after.log"
    FAILED_KEYS="$FAILED_KEYS $KEY"; continue
  fi
  tail -26 "$KEY_DIR/after.log"
  $PNPM tsx tools/check-onboard-anomalies.ts --platforms="$KEY" > "$KEY_DIR/anomalies.log" 2>&1 || {
    log "  ⚠️  이상치 리포트가 발견 사항을 보고했다 — $KEY_DIR/anomalies.log"; }

  # ── 8. 임베딩 무효화 ──
  if [ "$SKIP_EMBEDDINGS" -eq 0 ]; then
    if have "$KEY_DIR/embed.done" embed; then
      log "7/7 embeddings — 스킵 (마커 존재)"
    else
      log "7/7 embeddings — 대표 이미지 변경분 무효화"
      APPLY_FLAG=""
      [ "$APPLY_EMBEDDINGS" -eq 1 ] && APPLY_FLAG="--apply"
      # shellcheck disable=SC2086
      $PNPM tsx tools/invalidate-changed-embeddings.ts \
        --platform="$KEY" --before="$IMAGES_BEFORE" --out="$KEY_DIR/embeddings.json" $APPLY_FLAG \
        > "$KEY_DIR/embeddings.log" 2>&1
      EMBED_CODE=$?
      tail -10 "$KEY_DIR/embeddings.log"
      if [ "$EMBED_CODE" -eq 3 ]; then
        log "  ⚠️  변경 비율이 경보 임계 초과 — 적용 보류, 샘플 확인 필요"
        if [ "$APPLY_EMBEDDINGS" -eq 1 ]; then FAILED_KEYS="$FAILED_KEYS $KEY"; continue; fi
      elif [ "$EMBED_CODE" -ne 0 ]; then
        log "  ✖ 임베딩 무효화 실패 — $KEY_DIR/embeddings.log"
        if [ "$APPLY_EMBEDDINGS" -eq 1 ]; then FAILED_KEYS="$FAILED_KEYS $KEY"; continue; fi
      else
        [ "$APPLY_EMBEDDINGS" -eq 1 ] && touch "$KEY_DIR/embed.done"
      fi
    fi
  fi

  # ── tally ──
  BEFORE_ROWS=$(read_metric "$BEFORE_JSON" rows)
  AFTER_ROWS=$(read_metric "$AFTER_JSON" rows)
  CB=$(read_metric "$BEFORE_JSON" colorNonCanonical)
  CA=$(read_metric "$AFTER_JSON" colorNonCanonical)
  echo "$KEY,$BEFORE_ROWS,$CRAWLED_ROWS,$QWEN_SUCCESS,$IMPORT_OK,$AFTER_ROWS,$CB,$CA,ok" >> "$TALLY"
  log "✅ $KEY 완료 — 비canonical color $CB → $CA"
done

echo ""
echo "═══════════ 요약 ═══════════"
column -s, -t "$TALLY" 2>/dev/null || cat "$TALLY"
if [ -n "$FAILED_KEYS" ]; then
  echo ""
  echo "실패/건너뜀:$FAILED_KEYS"
  echo "재실행하면 완료된 스테이지는 건너뛰고 이어서 돈다."
fi
[ "$STOP_CAMPAIGN" -eq 1 ] && { echo "🛑 캠페인 중단 — 원인을 해결하기 전에는 다음 배치를 돌리지 말 것"; exit 1; }
[ -n "$FAILED_KEYS" ] && exit 1
exit 0

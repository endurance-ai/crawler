#!/bin/bash
# 매일 한 번: brand_nodes 중 아직 수집 안 된(homepage_url 있고, status='tech_detected')
# 브랜드를 최신 status_updated_at 순으로 N개 뽑아 hybrid variant로 온보딩한다.
#
# 파이프라인:
#   1. brand-crawl detect  — status가 아직 없거나(NULL→'not_started') 'not_started'인
#      브랜드 중 homepage_url이 있는 것들을 플랫폼(cafe24/shopify) 감지해서
#      'tech_detected'(또는 감지 실패 시 'blocked')로 승격. 이걸 안 돌리면 신규
#      브랜드가 tech_detected 풀에 절대 안 들어와서 계속 같은 후보만 돈다.
#   2. generate-platform-configs.ts — tech_detected 후보를 platforms.generated.ts에
#      반영 (brand 필드/통화 감지 등 안전장치 포함, 2026-07-21에 이미 검증됨).
#   3. select-onboard-batch.ts — status_updated_at 최신순으로 N개를 골라
#      onboard-batch.sh용 --configs JSON을 만든다 (반드시 getSiteConfig()의 완전한
#      config를 그대로 씀 — stub 절대 금지, 2026-07-21 사고 참조).
#   4. onboard-batch.sh --variants hybrid — 크롤 + canonical DB import + local Qwen
#      category/subcategory 보강 + guardrail. 색상·설명은 2026-07-29 에 빠졌고
#      (색상은 VLM 단일 출처), 성별은 Qwen 이 아니라 크롤 단계가 결의한다.
#   5. check-onboard-anomalies.ts — 오늘 처리한 브랜드들만 대상으로 가격/브랜드/성별
#      이상 패턴을 검사해 리포트. 색상 체크는 VLM 이관으로 제거됐다. 원인 조사·코드
#      수정은 여기서 자동으로 하지 않는다(오판 위험) — 이상 발견 시 그 리포트를
#      다음 Claude 세션에 붙여넣어 조사를 요청하는 흐름을 상정한다 (2026-07-22 확정).
#
# 범위: KR-origin은 기존처럼 통과하고, 해외 브랜드는 detect 단계가 한국 locale/
# Shopify Market에서 실제 variant KRW 가격을 검증한 경우에만 config 후보가 된다.
# price_only/unsupported/inconclusive는 자동 온보딩하지 않는다.
#
# Usage:
#   tools/daily-onboard.sh [--limit N] [--detect-limit N] [--out-root DIR]
#
# Options:
#   --limit N        오늘 hybrid로 온보딩할 브랜드 수 (기본 5)
#   --detect-limit N detect 단계에서 확인할 미탐지 브랜드 수 (기본: --limit과 동일)
#   --out-root DIR   크롤 산출물 루트 (기본 poc-runs/daily-<YYYY-MM-DD>)
set -euo pipefail

LIMIT=5
DETECT_LIMIT=""
OUT_ROOT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --detect-limit) DETECT_LIMIT="$2"; shift 2 ;;
    --out-root) OUT_ROOT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$DETECT_LIMIT" ]; then DETECT_LIMIT="$LIMIT"; fi
# 날짜만 쓰면 같은 날 두 번째 실행이 --out-root를 재사용해서, onboard-batch.sh의
# "products.jsonl 있으면 크롤 스킵" 재개 로직이 오작동한다 — 직전 실행이 고른
# (다른) 브랜드의 크롤 결과를 그대로 재사용해버려서, 이번에 새로 선정된 브랜드는
# 실제로 크롤된 적 없이 0건으로 끝난다 (2026-07-23 실측: en-5267/dadakarada/
# temporahaus/noscouleurs가 이 버그로 전부 0건, 겹쳤던 deeperthanblue만 재적재됨).
# 초 단위까지 넣어 실행마다 고유 경로를 쓴다 — 같은 실행이 중간에 죽었다가 같은
# --out-root로 재시작되는 정상적인 재개 케이스는 여전히 지원된다.
if [ -z "$OUT_ROOT" ]; then OUT_ROOT="poc-runs/daily-$(date +%Y-%m-%d-%H%M%S)"; fi

PNPM="corepack pnpm@10.33.2 exec dotenv -e .env.local --"
mkdir -p "$OUT_ROOT"

echo "===== 1/5 detect: 미탐지 브랜드 KR-market eligibility 확인 최대 ${DETECT_LIMIT}개 ====="
$PNPM tsx src/brand-crawl.ts detect --status=not_started --url=present \
  --eligibility-status=unchecked --limit="$DETECT_LIMIT" \
  || echo "  (detect 단계 실패/0건 — 계속 진행)"

# migration 103 이전부터 tech_detected/qc_failed였던 비KR 브랜드는 eligibility만
# unchecked로 남는다. 이 풀도 하루 DETECT_LIMIT개씩 순차 판정해야 기존 해외 후보가
# 새 모델에 실제로 유입된다. 위 not_started 실행에서 막 처리된 행은 더 이상
# unchecked가 아니므로 같은 실행에서 중복 probe되지 않는다.
$PNPM tsx src/brand-crawl.ts detect --url=present \
  --status=tech_detected,qc_failed --eligibility-status=unchecked \
  --limit="$DETECT_LIMIT" --preserve-status \
  || echo "  (기존 unchecked eligibility 확인 실패/0건 — 계속 진행)"

# DNS/timeout/bot 등은 미지원으로 확정하지 않는다. 하루가 지난 retryable/inconclusive
# 건만 별도 재확인해 같은 brand_node를 매 실행마다 반복하지 않는다. not_started는
# 성공 시 tech_detected로 승격해야 하므로 preserve 없이, 진행 중/완료 상태는 preserve로
# 재확인한다.
$PNPM tsx src/brand-crawl.ts detect --url=present \
  --status=not_started --eligibility-status=retryable_error,inconclusive \
  --eligibility-stale-days=1 --limit="$DETECT_LIMIT" \
  || echo "  (신규 eligibility 재확인 실패/0건 — 계속 진행)"

$PNPM tsx src/brand-crawl.ts detect --url=present \
  --status=tech_detected,qc_failed,crawled,imported,embedded,active,blocked \
  --eligibility-status=retryable_error,inconclusive --eligibility-stale-days=1 \
  --limit="$DETECT_LIMIT" --preserve-status \
  || echo "  (기존 상태 eligibility 재확인 실패/0건 — 계속 진행)"

echo "===== 2/5 generate-platform-configs: tech_detected 후보를 platforms.generated.ts에 반영 ====="
$PNPM tsx tools/generate-platform-configs.ts

echo "===== 3/5 select: status_updated_at 최신순 ${LIMIT}개 선정 ====="
SELECTED_JSON="$OUT_ROOT/selected-configs.json"
$PNPM tsx tools/select-onboard-batch.ts --limit="$LIMIT" --out="$SELECTED_JSON"

COUNT=$(node -e 'try{console.log(require(require("path").resolve(process.argv[1])).length)}catch(e){console.log(0)}' "$SELECTED_JSON")
if [ "$COUNT" = "0" ]; then
  echo "선정된 브랜드가 없어 종료합니다 (tech_detected 후보 소진 또는 config 누락)."
  exit 0
fi

echo "===== 4/5 onboard-batch (hybrid): ${COUNT}개 브랜드 크롤+LLM분류+import+guardrail ====="
bash tools/onboard-batch.sh --configs "$SELECTED_JSON" --chunk-size "$LIMIT" --variants hybrid --out-root "$OUT_ROOT"

echo "===== 5/5 anomaly check: 오늘 처리한 ${COUNT}개 브랜드 가격/브랜드/성별 이상 검사 ====="
SELECTED_KEYS=$(node -e 'console.log(require(require("path").resolve(process.argv[1])).map(c => c.key).join(","))' "$SELECTED_JSON")
$PNPM tsx tools/check-onboard-anomalies.ts --platforms="$SELECTED_KEYS" | tee "$OUT_ROOT/anomaly-report.log" \
  || echo "  ⚠️  이상치 발견 — $OUT_ROOT/anomaly-report.log 참고, 다음 세션에서 원인 조사 요청할 것"

echo "===== 완료 ====="
echo "결과: $OUT_ROOT/onboard-tally.csv"
echo "이상치 리포트: $OUT_ROOT/anomaly-report.log"

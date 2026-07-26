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
#   4. onboard-batch.sh --variants hybrid — 크롤 + LLM 카테고리/색상/설명 보강 +
#      import + guardrail까지 한 번에.
#   5. check-onboard-anomalies.ts — 오늘 처리한 브랜드들만 대상으로 가격/브랜드/색상/
#      성별 이상 패턴을 검사해 리포트. 원인 조사·코드 수정은 여기서 자동으로 하지
#      않는다(오판 위험) — 이상 발견 시 그 리포트를 다음 Claude 세션에 붙여넣어
#      조사를 요청하는 흐름을 상정한다 (2026-07-22 확정).
#
# 범위 제약: generate-platform-configs.ts가 wiki->>origin_country='KR' 브랜드만
# 다뤄서, 해외 브랜드는 tech_detected여도 config가 안 생겨 select 단계에서 계속
# 스킵된다. KR 후보가 소진되면 select-onboard-batch.ts가 "선정 브랜드 없음"을
# 경고한다 — 그때는 스코프를 넓힐지 사용자에게 먼저 확인할 것.
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

echo "===== 1/5 detect: 미탐지 KR 브랜드(homepage_url 있음) 최대 ${DETECT_LIMIT}개 ====="
# --country=KR: generate-platform-configs.ts가 origin_country='KR'만 config로
# 만들 수 있으므로, 애초에 KR 아닌 브랜드는 detect도 안 한다 — detect 낭비 방지 +
# "config 없음"으로 매번 스킵 리포트에 잡히는 노이즈 방지 (2026-07-23).
$PNPM tsx src/brand-crawl.ts detect --status=not_started --url=present --country=KR --limit="$DETECT_LIMIT" \
  || echo "  (detect 단계 실패/0건 — 계속 진행)"

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

echo "===== 5/5 anomaly check: 오늘 처리한 ${COUNT}개 브랜드 가격/브랜드/색상/성별 이상 검사 ====="
SELECTED_KEYS=$(node -e 'console.log(require(require("path").resolve(process.argv[1])).map(c => c.key).join(","))' "$SELECTED_JSON")
$PNPM tsx tools/check-onboard-anomalies.ts --platforms="$SELECTED_KEYS" | tee "$OUT_ROOT/anomaly-report.log" \
  || echo "  ⚠️  이상치 발견 — $OUT_ROOT/anomaly-report.log 참고, 다음 세션에서 원인 조사 요청할 것"

echo "===== 완료 ====="
echo "결과: $OUT_ROOT/onboard-tally.csv"
echo "이상치 리포트: $OUT_ROOT/anomaly-report.log"

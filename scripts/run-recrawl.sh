#!/usr/bin/env bash
# 온보딩급 재수집 wrapper — 상세 크롤 + LLM 재분류를 포함한다 (recrawl-batch.ts).
#
# ⚠️ 일상적인 재고/가격 갱신에는 쓰지 않는다 — 그 용도는 run-refresh.sh 다.
# 이 경로는 카테고리/색상을 다시 만들어야 할 때(온보딩, 재분류)만 쓴다.
# 2026-07-19 실측: 10개 브랜드 청크에 82분, 청크당 LLM $0.014.
#
# Usage: scripts/run-recrawl.sh [--budget-minutes=240 ...]
set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib-batch-prep.sh
. "$(dirname "$0")/lib-batch-prep.sh"

batch_prep

echo "── 재수집 러너"
$PNPM recrawl -- "$@"
exit $?

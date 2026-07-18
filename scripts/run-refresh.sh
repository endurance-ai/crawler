#!/usr/bin/env bash
# 리스트-only 재고/가격 갱신 wrapper — systemd(kiko-refresh.service)가 호출한다.
#
# 상세 크롤도 LLM 도 돌지 않는다. 온보딩급 재수집이 필요할 때는 run-recrawl.sh
# (recrawl-batch.ts) 를 쓴다 — 둘의 차이는 src/refresh-listing.ts 헤더 참조.
#
# Usage: scripts/run-refresh.sh [--budget-minutes=240 ...]
set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib-batch-prep.sh
. "$(dirname "$0")/lib-batch-prep.sh"

batch_prep

echo "── 갱신 러너"
$PNPM refresh -- "$@"
exit $?

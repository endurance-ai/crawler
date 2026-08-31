#!/usr/bin/env bash
# 목록 중심 재고/가격 갱신 wrapper — systemd(kiko-refresh.service)가 호출한다.
# Cafe24 상세 방문은 목록에 현재가 자체가 없는 상품의 가격 복구에만 제한한다.
# 온보딩급 전체 상세 재수집은 run-recrawl.sh(recrawl-batch.ts)를 사용한다.
#
# Usage: scripts/run-refresh.sh [--budget-minutes=600 --source-slice-minutes=10 ...]
set -uo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib-batch-prep.sh
. "$(dirname "$0")/lib-batch-prep.sh"

batch_prep

echo "── 갱신 러너"
$PNPM refresh -- "$@"
exit $?

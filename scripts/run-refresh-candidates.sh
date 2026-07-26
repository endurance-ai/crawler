#!/usr/bin/env bash
# 신규상품 후보 LLM worker. listing refresh와 별도 프로세스로 실행되며,
# 기존 brand_nodes에 정확히 매칭된 후보만 상품으로 적재한다.
#
# Usage: scripts/run-refresh-candidates.sh [--limit=50 ...]
set -uo pipefail
cd "$(dirname "$0")/.."

PNPM="corepack pnpm"

echo "── 신규상품 LLM worker"
$PNPM refresh:candidates -- "$@"
exit $?

#!/usr/bin/env bash
# 재수집 배치 wrapper — systemd(kiko-recrawl.service)가 호출한다.
#
#   1. git pull        — 로컬 온보딩으로 커밋된 신규 config/엔진 코드 반영 (best-effort)
#   2. pnpm install    — lockfile 변경 시 의존성 동기화 (no-op 이면 수 초)
#   3. config codegen  — DB 의 tech_detected 브랜드를 platforms.generated.ts 로 반영 (best-effort)
#   4. recrawl runner  — 큐 기반 재수집 (src/recrawl-batch.ts). 인자는 그대로 전달.
#
# 1~3 은 실패해도 러너를 막지 않는다 — 어제 코드/설정으로라도 재수집이 도는 것이
# 하루를 건너뛰는 것보다 낫다. 실패는 로그로 남는다.
#
# Usage: scripts/run-recrawl.sh [--budget-minutes=240 ...]
set -uo pipefail
cd "$(dirname "$0")/.."

PNPM="corepack pnpm"

echo "── [1/4] git pull"
git pull --ff-only || echo "⚠️ git pull 실패 — 기존 체크아웃으로 진행"

echo "── [2/4] pnpm install"
$PNPM install --frozen-lockfile || echo "⚠️ pnpm install 실패 — 기존 node_modules 로 진행"

echo "── [3/4] platform config codegen"
$PNPM exec dotenv -e .env.local -- tsx tools/generate-platform-configs.ts \
  || echo "⚠️ config codegen 실패 — 기존 platforms.generated.ts 로 진행"

echo "── [4/4] recrawl runner"
$PNPM recrawl -- "$@"
exit $?

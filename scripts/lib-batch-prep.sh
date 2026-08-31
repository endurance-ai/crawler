#!/usr/bin/env bash
# 배치 러너 공통 준비 단계 — run-recrawl.sh / run-refresh.sh 가 source 한다.
#
#   1. git pull       — 로컬 온보딩으로 커밋된 신규 config/엔진 코드 반영
#   2. pnpm install   — lockfile 변경 시 의존성 동기화 (no-op 이면 수 초)
#   3. config codegen — DB 의 tech_detected 브랜드를 platforms.generated.ts 로 반영
#
# 셋 다 실패해도 러너를 막지 않는다 — 어제 코드/설정으로라도 도는 것이 하루를
# 건너뛰는 것보다 낫다. 실패는 로그로 남는다.

PNPM="corepack pnpm"

batch_prep() {
  if [[ "${BATCH_SKIP_UPDATE:-false}" == "true" ]]; then
    echo "── [prep 1/3] git pull 생략 (고정 런타임)"
    echo "── [prep 2/3] pnpm install 생략 (배포 시 설치)"
  else
    echo "── [prep 1/3] git pull"
    # codegen 산출물(platforms.generated.ts)은 매 런마다 재생성되므로 체크아웃이
    # 항상 dirty 해진다 — 그대로 두면 --ff-only 가 막혀 서버가 코드 갱신을 영영
    # 못 받는다 (실측 2026-07-19: 첫 런 이후 pull 이 조용히 실패하고 있었다).
    # 어차피 prep 3/3 에서 다시 만드므로 버리고 당긴다.
    git checkout -- src/configs/platforms.generated.ts 2>/dev/null || true
    git pull --ff-only || echo "⚠️ git pull 실패 — 기존 체크아웃으로 진행"

    echo "── [prep 2/3] pnpm install"
    $PNPM install --frozen-lockfile || echo "⚠️ pnpm install 실패 — 기존 node_modules 로 진행"
  fi

  echo "── [prep 3/3] platform config codegen"
  $PNPM exec dotenv -e .env.local -- tsx tools/generate-platform-configs.ts \
    || echo "⚠️ config codegen 실패 — 기존 platforms.generated.ts 로 진행"
}

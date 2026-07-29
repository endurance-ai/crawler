-- 069_cleanup_platform_as_brand.sql
-- 플랫폼명이 브랜드로 잘못 적재된 오염 데이터 격리/정리 (8division 외 편집샵)
--
-- 배경:
--   초기/직접 크롤(Path A)이 멀티브랜드 편집샵의 브랜드를 플랫폼명(config.name)으로
--   폴백해 products.brand="8디비전" 등으로 적재했고, import 가 이를 brand_nodes 에
--   자동 INSERT 해 "플랫폼=브랜드" 오염 노드가 생겼다. 엔진/임포트 가드는 코드에서
--   구조적으로 막았고(이 PR), 이 스크립트는 이미 쌓인 오염 데이터를 정리한다.
--
-- 정책: 격리 후 재처리
--   1) 오염 products 삭제 → 온보딩 파이프라인(Path B: 게이트 OFF → LLM 브랜드/카테고리
--      분류 → import --no-new-brands)으로 재수집하면 실제 KR 브랜드만 재적재된다.
--   2) 잘못 만든 platform-as-brand brand_nodes 행 삭제(자식 테이블 CASCADE/RESTRICT
--      선처리).
--
-- 실행 방법:
--   - 반드시 PART A(감사, 읽기전용)를 먼저 실행해 대상 id/건수를 확인한다.
--   - 확인 후 PART B(트랜잭션)를 실행한다. 예기치 못한 FK RESTRICT 가 있으면 트랜잭션
--     전체가 롤백되므로 데이터는 안전하다.
--   - 대상 플랫폼을 넓히려면 아래 IN 목록에 편집샵 키/표시명을 추가한다.
--
-- 배포 위치:
--   - crawler 리포 계획용. 실제 실행은 app DB(psql / Supabase SQL editor)에서 수행.
--
-- Author: platform-as-brand cleanup (2026-07-26)

-- ══════════════════════════════════════════════════════════════════════════
-- PART A — 감사 (읽기전용). 먼저 실행해 대상과 영향 범위를 확인할 것.
-- ══════════════════════════════════════════════════════════════════════════

-- A-1) 정리 대상 platform-as-brand 노드 + 매달린 상품 수
--      (알려진 편집샵: 8division / visualaid. 필요 시 추가)
SELECT bn.id,
       bn.brand_name,
       bn.source_platforms,
       (SELECT count(*) FROM products p WHERE p.brand_node_id = bn.id) AS product_cnt
FROM brand_nodes bn
WHERE bn.brand_name IN ('8division', '8디비전', 'visualaid', 'VISUAL AID')
ORDER BY product_cnt DESC;

-- A-2) 진단: brand_name 이 자기 소스 플랫폼 키와 동일한 노드(platform-as-brand 강한 신호).
--      A-1 목록 밖에 또 다른 오염 편집샵이 있는지 넓게 훑는다.
SELECT bn.id, bn.brand_name, bn.source_platforms,
       (SELECT count(*) FROM products p WHERE p.brand_node_id = bn.id) AS product_cnt
FROM brand_nodes bn
WHERE bn.brand_name = ANY (bn.source_platforms)
ORDER BY product_cnt DESC;

-- A-3) 실제 삭제될 오염 products 건수 미리보기 (platform 기준 재크롤 대상)
SELECT platform, count(*) AS product_cnt
FROM products
WHERE platform IN ('8division', 'visualaid')
GROUP BY platform;

-- A-4) RESTRICT 자식(refresh candidates)이 대상 노드를 매칭 타깃으로 들고 있는지 확인
SELECT prc.matched_brand_node_id, count(*) AS candidate_cnt
FROM product_refresh_candidates prc
WHERE prc.matched_brand_node_id IN (
  SELECT id FROM brand_nodes WHERE brand_name IN ('8division', '8디비전', 'visualaid', 'VISUAL AID')
)
GROUP BY prc.matched_brand_node_id;

-- ══════════════════════════════════════════════════════════════════════════
-- PART B — 정리 (트랜잭션). PART A 검토 후 실행.
--   FK 처리 순서:
--     - products.brand_node_id           : ON DELETE SET NULL (자동)
--     - product_refresh_candidates.matched_brand_node_id : ON DELETE RESTRICT → 선삭제
--     - brand_similar/attribute_proposals/review_queue/embeddings/umap : CASCADE (자동)
--     - product_crawl_status/runs (brand_node_id) : 큐 정리 위해 선삭제
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 정리 대상 노드 id 를 임시로 고정 (편집샵 목록을 넓히려면 여기만 수정)
CREATE TEMP TABLE _polluted_brand_nodes ON COMMIT DROP AS
SELECT id, brand_name
FROM brand_nodes
WHERE brand_name IN ('8division', '8디비전', 'visualaid', 'VISUAL AID');

-- 1) 오염 products 삭제 (재크롤로 재생성). platform 기준으로 확실히 제거.
DELETE FROM products
WHERE platform IN ('8division', 'visualaid');

-- 2) RESTRICT 자식: 대상 노드를 매칭 타깃으로 가진 refresh candidate 제거
DELETE FROM product_refresh_candidates
WHERE matched_brand_node_id IN (SELECT id FROM _polluted_brand_nodes);

-- 3) 크롤 상태 큐(brand_node_id 기준) 정리 — runs → status 순
DELETE FROM product_crawl_runs
WHERE brand_node_id IN (SELECT id FROM _polluted_brand_nodes);

DELETE FROM product_crawl_status
WHERE brand_node_id IN (SELECT id FROM _polluted_brand_nodes);

-- 4) platform-as-brand 노드 삭제 (similar/proposals/review_queue/embeddings/umap CASCADE)
DELETE FROM brand_nodes
WHERE id IN (SELECT id FROM _polluted_brand_nodes);

-- 삭제 결과 확인 후 커밋. 문제가 보이면 ROLLBACK.
-- COMMIT;
ROLLBACK;

-- ── 재처리 (정리 커밋 후, 크롤러 리포에서 실행) ────────────────────────────
--   온보딩 파이프라인으로 8division 재수집 → 실제 KR 브랜드만 재적재:
--     ONBOARD_VARIANT=existing bash tools/onboard-batch.sh <8division 포함 config>
--   (직접 크롤 `crawl --site=8division` 은 multiBrand 가드로 제외됨 — 온보딩 경유 필수)

-- 096_recollect_cohort_suppress.sql
-- 2026-06 코호트(26개 platform key, 60,634행) 재수집 캠페인 — 사전 in_stock 차단 런북
--
-- 배경:
--   2026-06-22 전후 옛 추출 로직으로 수집된 26개 platform key 를 현재 hybrid/LLM
--   로직으로 재수집한다 (tools/recollect-batch.sh + tools/recollect-batches/batch-*.txt).
--   재수집이 끝날 때까지 이 저품질 데이터가 검색/큐레이션에 노출되지 않아야 한다.
--
-- 왜 in_stock 플립만으로 되는가 (선행 조건 필수):
--   원래는 kiko-refresh.timer(15분 주기)가 "리스트에 살아있는데 DB 는 false" 인
--   상품을 "재입고"로 되돌려(src/lib/listing-refresh.ts:177-180) 사전 플립이 몇 시간
--   안에 무효화됐다. AWS 서버의 refresh/recrawl 배치를 정지하기로 하면서(전용 배치
--   서버로 이전 예정) 이 제약이 사라졌다 — 타이머가 없으면 플립이 유지된다.
--
--   *** 이 SQL 실행 전 dev-app EC2 에서 kiko-refresh.timer / kiko-recrawl.timer 를
--   *** disable + stop 하고, daily-onboard.sh cron 도 정지했는지 반드시 확인한다.
--   *** (tools/recollect-batches/README.md "캠페인 중 주의사항" 참조)
--
-- 복구 메커니즘:
--   키별 재수집 → import-products.ts 가 product_url 충돌 시 전체 행 upsert
--   (ignoreDuplicates: false) → in_stock 이 크롤 실측값으로 갱신된다. 재수집이 곧
--   복구다. 크롤 산출물에 안 나온 행(단종)은 아무도 안 건드리므로 false 로 남는다 —
--   별도 soft-delete sweep 이 필요 없다.
--
-- 실행 위치: dev-app EC2, Postgres 16 (SPEC-INFRA-MIGRATE-001 P6 이후 자체호스팅,
--            2026-05-10 Supabase 컷오버). ai-server/sql/README.md 옵션 2 절차 참조
--            (`sudo -u postgres psql -d kikoai -f <이 파일>`). 수동 psql 은 신중히 —
--            search_products_v6 같은 public 함수와 달리 이 SQL 은 데이터 전용이라
--            CI 자동 적용 대상이 아니고 이 방식이 유일한 경로다.

-- ── 0. 코호트 정의 확인 ──────────────────────────────────────
-- 26개 키, batch-*.txt 와 반드시 일치해야 한다.
SELECT platform, count(*) FROM products
WHERE created_at::date = DATE '2026-06-24'
GROUP BY platform ORDER BY platform;

-- ── 1. 롤백용 스냅샷 (반드시 플립보다 먼저) ───────────────────
-- 플립하면 "원래 품절이던 행"과 "우리가 숨긴 행"을 구분할 수 없다.
-- 게이트 실패로 재수집이 안 된 키를 되돌릴 때 이 스냅샷이 필요하다.
CREATE TABLE products_instock_snapshot_20260729 AS
SELECT id, platform, in_stock
FROM products
WHERE created_at::date = DATE '2026-06-24';

-- 건수 확인 — 60,634 이어야 한다 (tools/recollect-batches/README.md 기준)
SELECT count(*), count(*) FILTER (WHERE in_stock) AS was_in_stock
FROM products_instock_snapshot_20260729;

-- ── 2. 플립 ────────────────────────────────────────────────
UPDATE products
SET in_stock = false, updated_at = now()
WHERE created_at::date = DATE '2026-06-24'
  AND in_stock = true;

-- ── 3. 플립 직후 검증 ──────────────────────────────────────
-- 코호트 전부 숨겨졌는지 (0 이어야 한다)
SELECT count(*) FROM products
WHERE created_at::date = DATE '2026-06-24' AND in_stock;

-- 나머지 343개 키는 영향 없어야 한다 (플립 전후 동일 값)
SELECT count(*) FROM products
WHERE created_at::date <> DATE '2026-06-24' AND in_stock;

-- ── 4. 타이머가 정말 죽었는지 (플립 30분+ 후 재실행) ──────────
-- 이 캠페인의 존재 이유 — 0 이 유지돼야 한다. 0 이 아니면 refresh/recrawl 이
-- 어딘가에서 아직 돌고 있다는 뜻이므로 즉시 원인을 찾는다.
SELECT count(*) FROM products
WHERE created_at::date = DATE '2026-06-24' AND in_stock;

-- ── 5. 배치별 복구 상태 확인 (재수집 진행에 따라 반복 실행) ────
SELECT platform,
       count(*) AS total,
       count(*) FILTER (WHERE in_stock) AS restored,
       count(*) FILTER (WHERE NOT in_stock) AS still_hidden
FROM products
WHERE created_at::date = DATE '2026-06-24'
GROUP BY platform ORDER BY still_hidden DESC;
-- still_hidden = 단종 + import 필터 탈락(color 없음/gender 빈 값/price 실패/brand 미해결,
-- import-products.ts:595-606) 의 합. 특정 키에서 비정상적으로 크면
-- data/recollect/<run-id>/<key>/import.log 의 스킵 사유를 확인한다.

-- ── 6. 롤백 (게이트 실패 등으로 특정 키를 원상복구) ────────────
-- UPDATE products p
-- SET in_stock = s.in_stock, updated_at = now()
-- FROM products_instock_snapshot_20260729 s
-- WHERE p.id = s.id AND s.platform = '<key>';

-- ── 7. 전체 롤백 ───────────────────────────────────────────
-- UPDATE products p
-- SET in_stock = s.in_stock, updated_at = now()
-- FROM products_instock_snapshot_20260729 s
-- WHERE p.id = s.id;

-- ── 8. 캠페인 완료 후 정리 ─────────────────────────────────
-- 전체 26개 키 복구 확인(§5 의 still_hidden 이 단종/필터 탈락만 남았음을 확인) 후:
-- DROP TABLE products_instock_snapshot_20260729;

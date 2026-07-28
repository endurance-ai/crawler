-- 092_products_price_gender_notnull.sql
-- products.price / gender 필수 제약 강제 + 기존 위반 행 정리 런북
--
-- 배경:
--   - products(약 110,444행)에서 price / gender 는 필수 필드여야 하나 위반 데이터 잔존.
--   - price: SQL NULL 2,397행, 그중 2,396행은 복구 원천 전무(source/original/sale 모두 null).
--   - gender: SQL NULL 0행이지만 빈 배열 '{}' 15,554행(text[] 이라 NOT NULL 로는 못 막음).
--   - 빈 gender 행은 전부 스테일(단종·가드 도입 이전 유입) 행 → 재크롤로는 복구 불가
--     (재임포트 upsert 는 라이브 상품만 갱신, 단종 상품은 안 건드림 — khakipoint 검증 확인).
--   - 재발 방지: 크롤러 write-path(src/import-products.ts)에 price 적재 가드 추가 완료
--     (gender.length===0 / color 없음과 동일한 "적재 제외" 패턴). 빈 gender 신규 유입은
--     기존 가드(라인 503 + validator gender.min(1))로 이미 차단됨.
--
-- 실행 위치: Supabase SQL editor 수동 실행 (DDL 마이그레이션은 kiko.ai-app repo 소관,
--            이 파일은 crawler repo 이력용 런북).

-- ── 0. [적용 완료] gender_scope 백필 ──────────────────────────
-- 아래 UPDATE 는 crawler repo 스크립트로 이미 실행됨(브랜드 단위, 13,942행 복구,
-- empty_gender 15,554 → 1,612, errors=0). SQL 등가물은 다음과 같다(재현/기록용):
--
-- UPDATE products p
-- SET    gender = b.gender_scope
-- FROM   brand_nodes b
-- WHERE  p.brand_node_id = b.id
--   AND  cardinality(p.gender) = 0
--   AND  cardinality(b.gender_scope) > 0;

-- ── 1. 삭제 직전 카운트 재확인 ────────────────────────────────
-- 기대값: null_price=2397, empty_gender=1612 (gender_scope 없는 브랜드 216 + brand_node 없음 1396)
SELECT count(*) FILTER (WHERE price IS NULL)           AS null_price,
       count(*) FILTER (WHERE cardinality(gender) = 0) AS empty_gender
FROM products;

-- ── 2. 위반 행 삭제 + 제약 적용 (한 트랜잭션 권장) ─────────────
-- DELETE 가 예상보다 많으면 ROLLBACK 할 수 있도록 트랜잭션으로 감싼다.
BEGIN;

  DELETE FROM products WHERE price IS NULL;              -- 복구 불가 null price (~2,397)
  DELETE FROM products WHERE cardinality(gender) = 0;    -- gender_scope 없는 잔여 (~1,612)

  -- gender NOT NULL 단독은 빈 배열('{}')을 막지 못하므로 CHECK 가 핵심.
  ALTER TABLE products ALTER COLUMN price  SET NOT NULL;
  ALTER TABLE products ALTER COLUMN gender SET NOT NULL;   -- 이미 걸려 있으면 no-op
  ALTER TABLE products ADD CONSTRAINT products_gender_nonempty
    CHECK (cardinality(gender) > 0);

COMMIT;

-- ── 3. 사후 검증 ─────────────────────────────────────────────
-- 아래 두 카운트가 모두 0 이어야 한다.
SELECT count(*) FILTER (WHERE price IS NULL)           AS null_price_after,
       count(*) FILTER (WHERE cardinality(gender) = 0) AS empty_gender_after
FROM products;

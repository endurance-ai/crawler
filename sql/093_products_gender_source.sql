-- 093_products_gender_source.sql (런북 사본)
--
-- 실행 위치: kiko.ai-app repo 의 마이그레이션 절차
--            (database/migrations/093_products_gender_source.sql 이 원본).
--            이 파일은 crawler repo 이력용 사본이다 — sql/092_* 와 동일한 관례.
--
-- 이 마이그레이션이 필요한 이유와 크롤러 쪽 대응:
--
--   products.gender 는 검색 RPC 에서 `p.gender && ARRAY[p_gender,'unisex']` 로
--   쓰여 unisex 상품이 남성·여성 양쪽 결과에 항상 노출된다. 크롤러는 상품에서
--   성별을 못 뽑으면 brand_nodes.gender_scope 를 그대로 복사했고, 스코프가
--   ['unisex'] 인 브랜드에서 "모름"이 "unisex" 로 세탁됐다.
--
--   크롤러 수정 (커밋 "fix(gender): stop laundering unknown gender into unisex"):
--     - src/lib/product-gender.ts — 브랜드 폴백을 단일 성별 스코프로 제한,
--       URL/텍스트 추론을 폴백보다 앞에 배치, kids 가드 추가
--     - src/import-products.ts — gender_source 를 payload 에 기록
--
--   data/ 캐시 85개 플랫폼 34,874건 dry-run 계측 결과:
--     구규칙 34,874 → 신규칙 30,780 (적재 제외 4,094, 11.7%)
--     제외분의 구규칙 값: ["unisex"] 4,016건(98.1%), ["women"] 78건(1.9%)
--   → 제외 물량이 곧 근거 없이 unisex 로 적재되던 오염분이다.
--
-- 적용 순서: 이 마이그레이션 → 크롤러 배포 → `pnpm repair:product-gender`
--            (dry-run → 검토 → apply). 자세한 절차는 아래 "운영 절차" 참고.

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS gender_source text;

-- NOT VALID + 별도 VALIDATE: 그냥 ADD CONSTRAINT 하면 약 110k 행을
-- ACCESS EXCLUSIVE 락 아래 전수 스캔한다.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_gender_source_chk;
ALTER TABLE products ADD CONSTRAINT products_gender_source_chk
  CHECK (gender_source IS NULL OR gender_source IN (
    'engine', 'url', 'text', 'config_default', 'brand_scope',
    'legacy_backfill', 'repair_url', 'repair_text', 'repair_brand_scope',
    'unverified_legacy'
  )) NOT VALID;

COMMIT;

ALTER TABLE products VALIDATE CONSTRAINT products_gender_source_chk;

-- ── 사후 검증 ────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'products' AND column_name = 'gender_source';   -- text / YES

SELECT conname, convalidated
FROM   pg_constraint
WHERE  conname = 'products_gender_source_chk';                      -- convalidated = t


-- ═══════════════════════════════════════════════════════════════════
-- 운영 절차 (이 마이그레이션 적용 후)
-- ═══════════════════════════════════════════════════════════════════

-- ── Phase 0. 오염 규모 측정 (읽기 전용) ──────────────────────
SELECT count(*)                                                       AS total,
       count(*) FILTER (WHERE 'unisex' = ANY(gender))                 AS any_unisex,
       count(*) FILTER (WHERE gender = ARRAY['unisex']::text[])       AS unisex_only
FROM   products;

SELECT platform, count(*)
FROM   products WHERE 'unisex' = ANY(gender)
GROUP  BY 1 ORDER BY 2 DESC;

-- 세탁 시그니처: unisex-only 상품을 브랜드 스코프별로 집계.
-- gender_scope 가 ['unisex'] 인 브랜드에 몰려 있으면 그 물량이 곧 세탁분이다.
SELECT b.gender_scope, count(*)
FROM   products p JOIN brand_nodes b ON b.id = p.brand_node_id
WHERE  p.gender = ARRAY['unisex']::text[]
GROUP  BY 1 ORDER BY 2 DESC;

-- DELETE 를 택할 경우 파괴되는 것 (product_embeddings / product_reviews 는
-- products.id 에 ON DELETE CASCADE 로 물려 있다). 삭제 결정 전 반드시 확인.
SELECT count(DISTINCT p.id)          AS products,
       count(DISTINCT pe.product_id) AS embeddings_lost,
       count(pr.id)                  AS reviews_lost
FROM   products p
LEFT   JOIN product_embeddings pe ON pe.product_id = p.id
LEFT   JOIN product_reviews    pr ON pr.product_id = p.id
WHERE  p.gender = ARRAY['unisex']::text[];

-- ── Phase 1. 교정 (crawler CLI, UPDATE only) ────────────────
--   pnpm repair:product-gender --plan=./data/repair/gender-YYYY-MM-DD.json
--   (분포/샘플 검토 + confirmed_* 샘플 URL 20건 육안 확인)
--   pnpm repair:product-gender --apply=./data/repair/gender-YYYY-MM-DD.json --platform=<소형>
--   pnpm repair:product-gender --apply=./data/repair/gender-YYYY-MM-DD.json
--   ※ import:products 와 동시 실행 금지.

-- ── Phase 2. 교정 결과 검증 ─────────────────────────────────
SELECT gender_source, gender, count(*)
FROM   products
WHERE  gender_source LIKE 'repair%' OR gender_source = 'unverified_legacy'
GROUP  BY 1,2 ORDER BY 3 DESC;

-- 출처 미상 unisex 잔량 → 0 으로 수렴해야 한다.
SELECT count(*) FROM products
WHERE  gender = ARRAY['unisex']::text[] AND gender_source IS NULL;

-- ── Phase 3. unverified 잔여분 ──────────────────────────────
-- 재크롤 → 재임포트(upsert onConflict=product_url 이라 기존 id 유지 →
-- 임베딩·리뷰 보존)로 복구되는지 먼저 확인하고, 끝내 갱신되지 않는 행만
-- 별도 런북(094)에서 삭제한다.
SELECT platform,
       count(*)                                                        AS unverified,
       count(*) FILTER (WHERE last_seen_at > now() - interval '30 days') AS recently_seen
FROM   products WHERE gender_source = 'unverified_legacy'
GROUP  BY 1 ORDER BY 2 DESC;

-- ── Phase 4. 위생 ───────────────────────────────────────────
-- 대량 UPDATE 후 gender GIN 인덱스 + 행 버전 bloat 정리
-- VACUUM (ANALYZE) products;

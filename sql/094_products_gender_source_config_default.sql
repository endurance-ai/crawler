-- 094_products_gender_source_config_default.sql (런북 사본)
--
-- 원본: kiko.ai-app/database/migrations/094_products_gender_source_config_default.sql
-- 실행: postgres 권한 필요 (planner_user / ai_user 모두 ALTER 불가)
--
-- 왜 093 직후에 또 필요한가:
--   093 적용 후, 사이트 전역 SiteConfig.defaultGender 를 카테고리 유래 성별과
--   구분해야 한다는 것이 yearsago 분석에서 드러났다.
--
--   yearsago 는 카테고리가 교차한다 — 고유 상품 1,005개가 3,213행으로 잡히고,
--   여성 라인 59개는 "Years Ago Women" 과 "상의"/"아우터" 양쪽에 모두 걸린다.
--   두 값이 같은 우선순위면 import 의 dedup merge 가 union 해 ['men','women'] 이
--   되고, 검색 RPC 의 `p.gender && ARRAY[p_gender,'unisex']` 에서 남녀 양쪽에
--   노출된다 — 093 이 막으려던 세탁과 같은 증상이다.
--
--   → 전역 기본값을 'config_default' 로 따로 기록하고 결의 우선순위를
--     engine > url > text > config_default > brand_scope 로 둔다.
--
-- 검증 (재크롤 전 시뮬레이션, crawler 캐시 기준):
--   yearsago 고유 상품 997개 → ["men"](config_default) 938 / ["women"](engine) 59
--   ['men','women'] union 0건.

BEGIN;

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
SELECT pg_get_constraintdef(oid) LIKE '%config_default%' AS has_config_default,
       convalidated
FROM   pg_constraint
WHERE  conname = 'products_gender_source_chk';        -- 기대: t, t

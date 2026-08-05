-- runbook: 성별 확정 불가 상품 정리 (2026-08-05)
--
-- ── 1부: 다중값 3,796행 — **완료** ────────────────────────────────────────
--
-- `repair:product-gender --scope=multi-gender` 가 16,468행 중 12,672행을 단일값으로
-- 확정하고 3,796행을 남겼다. 그 잔여분은 SQL 이 아니라
-- `tools/resolve-multi-gender-residual.ts` 로 처리했다 (2026-08-05 실행):
--
--   A. 1,063행 → gender=['unisex'], gender_source='repair_text'
--      name/category/subcategory/tags/url 에 men·women 토큰이 **모두** 있는 행.
--      편집샵이 같은 상품을 Men·Women 부서 양쪽에 등록한 것이다 (browns 565,
--      concepts 196, bodega 114, mohawk-general 104 …). 스노부츠·벨트·선글라스·
--      양말 같은 실제 공용 품목이고, 사이트가 양쪽에서 판다고 명시한 근거가 있다.
--   B. 2,733행 → 삭제
--      성별 토큰이 아예 없는 행 (slam-jam 1,429, union-la 1,038 …). 태그가
--      브랜드·색·컬렉션뿐이라 재크롤해도 같은 결과다. kids 가드 행 포함.
--
-- 왜 SQL 이 아니라 스크립트였나: A 와 B 를 가르는 술어가 `tags` 배열 안의 토큰
-- 검사라 PostgREST/SQL 한 줄로 표현하기 어렵고, 매니페스트를 같은 실행에서
-- 남겨야 복구 근거가 정확해지기 때문이다.
--
-- 결과 (실측):
--   다중값 3,796 → **0**
--   전체 상품 158,560 → 155,827
--   exactly {men} 36,785 / {women} 72,837 / {unisex} 46,205 — 합이 전체와 일치
--   → migration 105 (`cardinality(gender) = 1`) 의 VALIDATE 가 통과 가능하다
--
-- 매니페스트: data/repair/gender-multi-residual-2026-08-05.json
--   삭제 2,733행의 전체 컬럼이 들어 있다. products 삭제는 product_embeddings /
--   product_features 로 CASCADE 되므로 복구하려면 재크롤 + 재임베딩이 필요하다 —
--   이 파일이 유일한 복구 근거다.
--
--
-- ── 2부: `unverified_legacy` 25,031행 — **미결** ──────────────────────────
--
-- 값은 전부 `['unisex']` 인데 근거가 없다. gender-repair.ts 가 근거를 못 찾은 행에
-- `after: null` 로 출처만 찍은 결과이고, 그 `['unisex']` 는 한 번도 검증된 적이
-- 없다. 검색 RPC 가 unisex 를 남녀 양쪽에 노출하므로 현재 검색 누수의 최대
-- 단일 원인이다 (근거 없이 양성 노출되는 행: 25,819 — 그 대부분이 이 버킷).
--
-- **105 를 막지는 않는다** (단일값이므로 CHECK 을 통과한다). 그래서 이 정리는
-- 105 적용과 독립적으로 진행할 수 있다.
--
-- ⚠️ 재크롤로 대부분 못 고친다. classifyGenderRepair 를 DB 텍스트에 돌리면
--    22,134행이 여전히 미해결이고 그중 22,117행은 사이트 기본값도 없다. 값을
--    만들 수 있는 경로는 셋뿐이다:
--      (i)  현재 엔진이 뽑지만 구 크롤 캐시엔 없던 카테고리 성별 / shopify 태그
--      (ii) src/configs/gender-defaults.ts 보강 (그 파일 헤더의 [HARD] 규칙 준수)
--      (iii) 1부 A 와 같은 "양쪽 부서 등록" 판정
--    → 60개 사이트를 전량 재크롤하기 전에 상위 3개(unaffected-2757 1,530 /
--      kith 1,194 / etcseoul 1,115)로 수율을 먼저 재라.
--      `import:products --dry-run` 의 `🚻 gender 해결: n/m` 로그가 그 수치다.
--
-- 재크롤 후에도 남는 행을 지울 때 이 아래를 쓴다. ID 목록은 비워 뒀다 — 대상이
-- 재크롤 수율에 따라 달라지므로 미리 고정할 수 없다.
--
-- repair 스크립트는 DELETE 를 하지 않는다 (src/repair-product-gender.ts 헤더).
-- 다만 2026-08-05 실측으로 크롤러 role 에 DELETE 권한 자체는 있음을 확인했다 —
-- 그 헤더의 "권한이 없다" 는 서술은 낡았다. 권한이 있어도 CASCADE 때문에
-- 관리자 검토를 거치는 절차는 그대로 둔다.

BEGIN;

-- 사전 확인 — 기록해 두고 사후 확인과 대조한다.
--   SELECT count(*) FROM products WHERE gender_source = 'unverified_legacy';
--   -- 2026-08-05 기준 25,031

-- ⚠️ manifest 에서 뽑은 ID 를 붙여 넣는다. 빈 목록이면 아무 행도 지우지 않는다
--    (안전한 기본값 — 실수로 전량 삭제되지 않는다).
DELETE FROM products
WHERE gender_source = 'unverified_legacy'
  AND id IN (
    -- <manifest 의 id 목록>
  );

-- 기대: DELETE <manifest 행 수>
-- 수가 다르면 ROLLBACK 하고 manifest 를 다시 만든다 (그 사이 재임포트가 일부를
-- 고쳤다는 뜻이다).
COMMIT;

-- ── 사후 확인 ─────────────────────────────────────────────────────────────
--
-- 다중값은 이미 0 이어야 한다 (1부 완료):
--   SELECT count(*) FROM products WHERE cardinality(gender) <> 1;
--
-- 검색 누수 지표 — 근거 없이 남녀 양쪽에 노출되는 행:
--   SELECT count(*) FROM products
--   WHERE (gender && ARRAY['unisex'] OR cardinality(gender) > 1)
--     AND (gender_source IS NULL
--          OR gender_source IN ('unverified_legacy','repair_brand_scope'));
--   -- 2026-08-05 기준선 40,966 → 1부 완료 후 25,819

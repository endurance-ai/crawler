-- runbook: 성별 확정 불가 상품 삭제 (2026-08-05)
--
-- 목적: migration 105 (`cardinality(gender) = 1`) 의 VALIDATE 를 막는 잔여 행과,
--       근거 없이 남녀 양쪽 검색에 노출되는 행을 제거한다.
--
-- ⚠️ **이 파일은 ID 목록이 비어 있다.** 아래 3단계를 먼저 실행해 manifest 를
--    만들고, 거기서 나온 ID 를 붙여 넣은 뒤에 실행한다. 대상 행이 WP1 apply 와
--    재크롤 결과에 따라 달라지므로 미리 고정할 수 없다.
--    (2026-08-03 런북은 ID 를 고정했다 — 그때는 대상이 이미 확정돼 있었다.)
--
-- ── 왜 삭제인가 ───────────────────────────────────────────────────────────
--
-- 검색 RPC 는 `p.gender && ARRAY[p_gender,'unisex']` 다. 성별을 확정하지 못한
-- 상품을 unisex 로 채우면 여성복이 남성 검색 결과로 샌다. 다중값 `['men','women']`
-- 도 결과가 같다 — "남녀공용 확인됨"이 아니라 "판정 실패"인데 검색에서 구별되지
-- 않는다. 근거가 없으면 적재하지 않는다는 것이 이 프로젝트의 규율이므로,
-- 이미 적재된 것도 같은 기준으로 제거한다.
--
-- repair 스크립트는 DELETE 를 하지 않는다 (src/repair-product-gender.ts 헤더):
--   · 크롤러 DB role 에 DELETE 권한이 없어 런 도중 permission error 로 부분
--     상태가 남는다
--   · products 는 product_embeddings / product_features / product_reviews 가
--     ON DELETE CASCADE 로 물려 있어 임베딩(halfvec 768)과 리뷰가 영구 소실된다
-- 그래서 이 파일은 관리자가 검토 후 직접 실행한다.
--
-- ── 선행 절차 ─────────────────────────────────────────────────────────────
--
-- 1) 다중값 교정을 먼저 끝낸다. 실측(2026-08-05) 16,468행 중 12,672행은
--    재판정만으로 단일값이 되므로 삭제 대상이 아니다.
--
--      pnpm repair:product-gender --scope=multi-gender \
--        --plan=data/repair/gender-multi-2026-08-05.json
--      # confirmed_* 샘플 URL 을 실제 사이트에서 육안 확인 (특히 browns 8,757행)
--      pnpm repair:product-gender --apply=data/repair/gender-multi-2026-08-05.json
--
-- 2) 남은 대상을 재크롤 + 재임포트로 한 번 더 회수한다. import 는 성별 미확인
--    상품을 스킵하므로, 재임포트로 고쳐지지 않은 행이 여기 삭제 대상이 된다.
--    (재크롤이 값을 만들 수 있는 경로는 엔진 카테고리 성별 / shopify 태그 /
--     src/configs/gender-defaults.ts 보강 셋뿐이다 — DB 텍스트로는 못 푼다)
--
-- 3) manifest 생성. 삭제 전 복구 정보를 남긴다:
--
--      SELECT id, platform, brand, name, product_url, gender, gender_source,
--             in_stock, last_seen_at
--      FROM products
--      WHERE cardinality(gender) <> 1
--         OR gender_source = 'unverified_legacy'
--      ORDER BY platform, id;
--
--    → data/repair/gender-unresolved-delete-manifest.json 으로 저장한다.
--
-- ── 대상 정의 ─────────────────────────────────────────────────────────────
--
--   (a) cardinality(gender) <> 1        — 105 VALIDATE 를 직접 막는다
--   (b) gender_source = 'unverified_legacy' — 값은 ['unisex'] 인데 근거가 없다.
--       gender-repair.ts 가 `after: null` 로 출처만 찍은 행이고, 값 자체는
--       한 번도 검증된 적이 없다. 105 는 이 행들을 막지 않으므로 (a) 와 달리
--       마이그레이션 차단 요인은 아니지만, 검색 누수의 최대 단일 원인이다.
--   (c) kids — 성인 카탈로그에 아동복이 섞인 행. kids 가드가 성인 성별 부여를
--       의도적으로 막으므로 재크롤해도 영원히 미확인으로 남는다.
--       (a)/(b) 안에 포함돼 있고, repair plan 의 `kids` 버킷으로 식별한다.
--
-- (b) 를 이번 회차에서 함께 지울지는 재크롤 회수율을 보고 결정한다. 회수율이
-- 높으면 (a) 만 지우고 (b) 는 다음 회차로 미룬다 — 2만 행대 삭제는 검색 모수
-- 자체를 줄이므로 되돌릴 수 없는 결정이다.
--
-- ── 실행 순서 (전체) ──────────────────────────────────────────────────────
--   크롤러 코드 배포 → WP1 repair apply → 재크롤/재임포트 → **이 파일** → 105

BEGIN;

-- 사전 확인 — 아래 두 수를 기록해 두고 사후 확인과 대조한다.
--   SELECT count(*) FROM products WHERE cardinality(gender) <> 1;
--   SELECT count(*) FROM products WHERE gender_source = 'unverified_legacy';

-- ⚠️ manifest 에서 뽑은 ID 를 여기에 붙여 넣는다. 빈 목록이면 이 DELETE 는
--    아무 행도 지우지 않는다 (안전한 기본값 — 실수로 전량 삭제되지 않는다).
DELETE FROM products
WHERE id IN (
  -- <manifest 의 id 목록>
);

-- 기대: DELETE <manifest 행 수>
-- 수가 다르면 ROLLBACK 하고 manifest 를 다시 만든다 (그 사이 재임포트가
-- 일부를 고쳤다는 뜻이다).
COMMIT;

-- ── 사후 확인 ─────────────────────────────────────────────────────────────
--
-- (a) 를 지웠다면 아래가 0 이어야 105 VALIDATE 가 통과한다:
--   SELECT count(*) FROM products WHERE cardinality(gender) <> 1;
--
-- 검색 누수 지표 — 근거 없이 남녀 양쪽에 노출되는 행:
--   SELECT count(*) FROM products
--   WHERE (gender && ARRAY['unisex'] OR cardinality(gender) > 1)
--     AND (gender_source IS NULL
--          OR gender_source IN ('unverified_legacy','repair_brand_scope'));
--   -- 2026-08-05 기준선: 40,966

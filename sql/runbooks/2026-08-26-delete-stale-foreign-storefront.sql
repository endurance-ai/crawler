-- 2026-08-26: 해외 마켓 스토어프론트 잔류 행 삭제 (통화 오적재 사고 정리)
--
-- 배경
-- ----
-- 크롤러가 사이트 통화를 읽지 않고 config 를 단정해(`config.sourceCurrency
-- || "KRW"`) 해외 통화 금액을 그대로 원화로 적재한 사고의 후속 정리다.
-- 두 브랜드는 한국 쌍둥이 도메인이 따로 있었고, config 의 baseUrl 을 그쪽으로
-- 돌려 재수집했다:
--
--   misekiseoul.com (일본몰, JPY)          → misekiseoul.kr (한국몰, KRW)
--   emostanceclub-global.com (USD)         → emostanceclub.co.kr (KRW)
--
-- product_url 의 호스트가 바뀌므로 재수집은 UPSERT 가 아니라 신규 INSERT 가
-- 됐고, 옛 행이 그대로 남았다.
--
-- 왜 삭제인가
-- ----------
-- 1. 갱신 경로가 없다. 해당 스토어프론트를 더 이상 크롤하지 않으므로
--    refresh-listing 워크리스트에 영원히 안 잡히고, in_stock=true 인 채
--    실제의 약 1/10 가격으로 고정된다.
-- 2. 대부분 중복이다. 상품명 기준 misekiseoul 176/302, emostanceclub 52/53 이
--    새 원화 행과 겹친다 — 검색에 같은 양말이 ₩1,650 과 ₩14,400 두 버전으로 뜬다.
-- 3. 나머지도 일본·미국 마켓 전용 상품이라 한국 사용자 대상 인덱스에 있을 이유가
--    없다.
--
-- 실행 전 백업
-- -----------
-- crawler/local-backup/stale-misekiseoul.com.json (302행)
-- crawler/local-backup/stale-www.emostanceclub-global.com.json (53행)
-- 두 파일 모두 SELECT * 전체 컬럼이다. 되돌리려면 재크롤이 아니라 이 백업을
-- 써야 한다 — 원본 스토어프론트는 크롤 대상에서 빠졌다.
--
-- 실행 경로
-- --------
-- 2026-08-26 PostgREST 셔틀(DB_URL, role=app_user)로 즉시 실행됨.
-- 이 파일은 기록용이며 멱등하다(이미 지워졌으면 0행 영향).

BEGIN;

-- 일본몰 잔류 (JPY 금액이 KRW 로 적재됨: ¥1,650 양말 → ₩1,650)
DELETE FROM products
 WHERE platform = 'misekiseoul'
   AND product_url LIKE '%//misekiseoul.com/%';

-- 글로벌몰 잔류 (USD 금액이 KRW 로 적재됨: $55 티셔츠 → ₩55)
DELETE FROM products
 WHERE platform = 'emostanceclub-global'
   AND product_url LIKE '%//www.emostanceclub-global.com/%';

COMMIT;

-- 검증 (실행하지 않음 — 참고용)
--
-- 남은 행이 전부 한국몰인지:
--   SELECT split_part(split_part(product_url,'//',2),'/',1) AS host,
--          count(*), min(price), max(price)
--     FROM products
--    WHERE platform IN ('misekiseoul','emostanceclub-global')
--    GROUP BY 1;
--   기대: misekiseoul.kr 496행 / 14,400~253,300,
--         www.emostanceclub.co.kr 68행 / 66,000~439,000
--
-- 1만원 미만이 남아 있지 않은지:
--   SELECT count(*) FROM products
--    WHERE platform IN ('misekiseoul','emostanceclub-global') AND price < 10000;
--   기대: 0

-- 096_recollect_cohort_suppress.sql
-- 2026-06 코호트(26개 platform key) 재수집 캠페인 — 사전 in_stock 차단 런북
--
-- 배경:
--   2026-06-22 전후 옛 추출 로직으로 수집된 26개 platform key 를 현재 hybrid/LLM
--   로직으로 재수집한다 (tools/recollect-batch.sh + tools/recollect-batches/batch-*.txt).
--   재수집이 끝날 때까지 이 저품질 데이터가 검색/큐레이션에 노출되지 않아야 한다.
--
-- 코호트 식별 기준 — platform key, created_at 아님:
--   tools/recollect-batches/README.md 는 코호트를 `products.created_at = 2026-06-24`
--   로 정의하지만, 이는 부정확하다. 실측(2026-07-29, dev-app DB): 이 날짜 기준으로는
--   21개 키/41,131행만 잡히고 matteveil/blankroom/swallowlounge/bastong/etcseoul
--   (배치 6, 최대 cafe24, 5,760행) 5개 키가 통째로 누락된다. 원인은 이 키들의
--   created_at 이 2026-06-29~2026-07-28 로 흩어져 있기 때문 — refresh-candidates.ts
--   가 신규 발견 상품을 계속 insert 하면서(신규 행은 최초 insert 시점의 created_at 을
--   갖는다) 같은 platform key 안에 여러 created_at 값이 섞여 있다.
--   → **platform key 목록으로 직접 필터링한다.** 26개 키는 tools/recollect-batches/
--   batch-*.txt 를 `cat batch-*.txt | sort -u` 한 것과 동일해야 하며, 배치 파일이
--   바뀌면 이 파일의 코호트 테이블도 다시 채워야 한다.
--   실측 총량: 26개 키 61,801행 (README 의 60,634 와 근소한 차이 — refresh-candidates
--   가 캠페인 준비 이후에도 신규 상품을 계속 편입시킨 자연 드리프트).
--
-- 왜 in_stock 플립만으로 되는가 (선행 조건 필수):
--   원래는 kiko-refresh.timer(15분 주기)가 "리스트에 살아있는데 DB 는 false" 인
--   상품을 "재입고"로 되돌려(src/lib/listing-refresh.ts:177-180) 사전 플립이 몇 시간
--   안에 무효화됐다. dev-app EC2 의 kiko-refresh.timer / kiko-recrawl.timer 를
--   disable+stop 했으므로(2026-07-29 실측: 둘 다 disabled/inactive/dead, crontab 없음,
--   실행 중인 크롤러 프로세스 없음) 이 제약이 사라졌다 — 타이머가 없으면 플립이
--   유지된다. 전용 배치 서버로 이전 예정이며, 그 전까지는 이 EC2 가 유일한 실행
--   위치이므로 배치를 다시 켤 때는 반드시 §7 을 먼저 읽는다.
--
-- 복구 메커니즘:
--   키별 재수집 → import-products.ts 가 product_url 충돌 시 전체 행 upsert
--   (ignoreDuplicates: false) → in_stock 이 크롤 실측값으로 갱신된다. 재수집이 곧
--   복구다. 크롤 산출물에 안 나온 행(단종)은 아무도 안 건드리므로 false 로 남는다 —
--   별도 soft-delete sweep 이 필요 없다.
--
-- 실행 위치: dev-app EC2, docker 컨테이너 `db`(image kikoai-app-db, Postgres 16).
--   `docker exec -i db psql -U postgres -d kikoai -f <이 파일>` 또는 세션을 열어
--   섹션별로 실행(권장 — §1/§2 사이에 카운트를 육안 확인한다).
--   ai-server/sql/README.md 의 "docker exec -i db psql" 패턴과 동일 접속 방식이나,
--   이 파일은 public 함수가 아니라 데이터 전용이라 CI 자동 적용 대상이 아니다.

-- ── 0. 코호트 키 테이블 — 여러 세션에 걸쳐 재사용 ──────────────
DROP TABLE IF EXISTS recollect_cohort_platforms;
CREATE TABLE recollect_cohort_platforms (platform text PRIMARY KEY);
INSERT INTO recollect_cohort_platforms (platform) VALUES
  ('032c'), ('18east'), ('aime-leon-dore'), ('antonioli'), ('apc-us'),
  ('bastong'), ('blankroom'), ('bodega'), ('brain-dead'), ('browns'),
  ('concepts'), ('cpfm'), ('drakes'), ('etcseoul'), ('kith'),
  ('matteveil'), ('mohawk-general'), ('noah-ny'), ('slam-jam'), ('stussy'),
  ('swallowlounge'), ('union-la'), ('uniqlo-kr'), ('uniqlo-us'),
  ('zara-kr'), ('zara-us');
-- 26 이어야 한다 (tools/recollect-batches/batch-*.txt 와 대조)
SELECT count(*) FROM recollect_cohort_platforms;

-- ── 1. 롤백용 스냅샷 (반드시 플립보다 먼저) ───────────────────
-- 플립하면 "원래 품절이던 행"과 "우리가 숨긴 행"을 구분할 수 없다.
-- 게이트 실패로 재수집이 안 된 키를 되돌릴 때 이 스냅샷이 필요하다.
DROP TABLE IF EXISTS products_instock_snapshot_20260729;
CREATE TABLE products_instock_snapshot_20260729 AS
SELECT p.id, p.platform, p.in_stock
FROM products p
JOIN recollect_cohort_platforms c ON c.platform = p.platform;

-- 건수 확인 — 실측 61,801 (README 의 60,634 와 근소한 차이는 §0 주석 참조)
SELECT count(*), count(*) FILTER (WHERE in_stock) AS was_in_stock
FROM products_instock_snapshot_20260729;

-- ── 2. 플립 ────────────────────────────────────────────────
UPDATE products p
SET in_stock = false, updated_at = now()
FROM recollect_cohort_platforms c
WHERE p.platform = c.platform
  AND p.in_stock = true;

-- ── 3. 플립 직후 검증 ──────────────────────────────────────
-- 코호트 전부 숨겨졌는지 (0 이어야 한다)
SELECT count(*) FROM products p
JOIN recollect_cohort_platforms c ON c.platform = p.platform
WHERE p.in_stock;

-- 코호트 밖은 영향 없어야 한다 (플립 전후 동일 값)
SELECT count(*) FROM products p
WHERE p.in_stock
  AND NOT EXISTS (SELECT 1 FROM recollect_cohort_platforms c WHERE c.platform = p.platform);

-- ── 4. 타이머가 정말 죽었는지 (플립 30분+ 후 재실행) ──────────
-- 이 캠페인의 존재 이유 — 0 이 유지돼야 한다. 0 이 아니면 refresh/recrawl 이
-- 어딘가에서 아직 돌고 있다는 뜻이므로 즉시 원인을 찾는다.
SELECT count(*) FROM products p
JOIN recollect_cohort_platforms c ON c.platform = p.platform
WHERE p.in_stock;

-- ── 5. 배치별 복구 상태 확인 (재수집 진행에 따라 반복 실행) ────
SELECT p.platform,
       count(*) AS total,
       count(*) FILTER (WHERE p.in_stock) AS restored,
       count(*) FILTER (WHERE NOT p.in_stock) AS still_hidden
FROM products p
JOIN recollect_cohort_platforms c ON c.platform = p.platform
GROUP BY p.platform ORDER BY still_hidden DESC;
-- still_hidden = 단종 + import 필터 탈락(color 없음/gender 빈 값/price 실패/brand 미해결,
-- import-products.ts:595-606) 의 합. 특정 키에서 비정상적으로 크면
-- data/recollect/<run-id>/<key>/import.log 의 스킵 사유를 확인한다.

-- ── 6. 롤백 (게이트 실패 등으로 특정 키를 원상복구) ────────────
-- UPDATE products p
-- SET in_stock = s.in_stock, updated_at = now()
-- FROM products_instock_snapshot_20260729 s
-- WHERE p.id = s.id AND s.platform = '<key>';

-- ── 6-1. 전체 롤백 ─────────────────────────────────────────
-- UPDATE products p
-- SET in_stock = s.in_stock, updated_at = now()
-- FROM products_instock_snapshot_20260729 s
-- WHERE p.id = s.id;

-- ── 7. 전용 배치 서버 이전 후 refresh 재개 시 필수 확인 ────────
-- 아직 재수집되지 않은(§5 의 still_hidden > 0 인) 코호트 키를 REFRESH_EXCLUDE 로
-- 반드시 제외한다 (src/refresh-listing.ts:85-93). 안 그러면 refresh 가 리스트에
-- 살아있는 상품을 "재입고"로 되돌려 숨김이 풀린다.

-- ── 8. 캠페인 완료 후 정리 ─────────────────────────────────
-- 전체 26개 키 복구 확인(§5 의 still_hidden 이 단종/필터 탈락만 남았음을 확인) 후:
-- DROP TABLE products_instock_snapshot_20260729;
-- DROP TABLE recollect_cohort_platforms;

# 2026-06 코호트 재수집 배치

2026-06-22 전후에 옛 추출 로직으로 수집된 26개 platform key를 현재 로직으로
처음부터 다시 수집한다. 이 페이지 하단의 platform key 목록(`batch-*.txt` 를
`sort -u` 한 것)이 코호트의 유일한 정본이다.

> **주의**: 한때 이 코호트를 `products.created_at = 2026-06-24` 로 식별할 수
> 있다고 여겼으나 부정확하다(실측 2026-07-29: 이 조건으로는 21개 키/41,131행만
> 잡히고 matteveil/blankroom/swallowlounge/bastong/etcseoul 5개 키가 통째로
> 빠진다 — `refresh-candidates.ts` 가 캠페인 준비 이후에도 같은 platform key 에
> 신규 상품을 계속 insert 하면서 키 내부에 여러 created_at 값이 섞였기 때문).
> **platform key 로만 필터링할 것.** `crawler/sql/096_recollect_cohort_suppress.sql`
> 참조. 실측 총량은 26개 키 61,801행 (아래 표의 합계와 근소한 드리프트 있음).

전부 `src/configs/platforms.ts` 의 수기 등록 항목이다.

## 사전 준비 — 배치 정지 + in_stock 차단

재수집이 끝날 때까지 이 26개 키를 검색/큐레이션에서 숨긴다. 방법은
`products.in_stock` 을 미리 `false` 로 플립해두는 것이다 — 재수집이 키별로 다시
`true` 로 되돌리므로 재수집 자체가 복구 메커니즘이 된다.

**전제조건: dev-app EC2 의 배치 타이머를 전부 죽여야 한다.** 살아있으면
`kiko-refresh.timer` 가 15분마다 "리스트에 살아있는데 DB 는 false" 인 상품을
재입고로 되돌려(`src/lib/listing-refresh.ts:177-180`) 플립이 무효화된다.

```bash
ssh ec2-user@15.165.107.28

# 현재 상태 확인 — deploy/README.md 는 kiko-recrawl 을 "타이머로 안 돌린다"고
# 하지만 실제 유닛은 매일 04:00 발화하게 설치돼 있다(§5 배포 기록). 문서를
# 믿지 말고 실제 상태를 본다.
systemctl list-timers --all | grep kiko
systemctl is-enabled kiko-refresh.timer kiko-recrawl.timer

sudo systemctl disable --now kiko-refresh.timer kiko-recrawl.timer
sudo systemctl stop kiko-refresh.service kiko-recrawl.service kiko-refresh-candidates.service

# 진행 중인 런이 없는지 확인 후에 플립한다 (진행 중 런이 플립을 되돌린다)
systemctl is-active kiko-refresh.service kiko-recrawl.service

crontab -l   # daily-onboard.sh 등 products 에 쓰는 cron 항목을 주석 처리
```

정지를 확인했으면 `crawler/sql/096_recollect_cohort_suppress.sql` 을 실행해
스냅샷 → 플립 → 검증한다 (해당 파일 헤더 주석에 전체 절차와 롤백 SQL 포함).

**전용 배치 서버로 이전한 뒤에는** refresh 를 다시 켤 때 아직 재수집되지 않은
코호트 키를 반드시 `REFRESH_EXCLUDE` 로 제외해야 한다
(`src/refresh-listing.ts:85-93`, `src/lib/refresh-source.ts:100-103`) —
안 그러면 그 시점에 숨김이 풀린다.

## 실행

```bash
# 배치 0 (파일럿) — 반드시 먼저, 모든 지표를 손으로 확인한다
tools/recollect-batch.sh --keys-file tools/recollect-batches/batch-0-pilot.txt \
  --run-id recollect-2026-07-28

# 이후 배치 — 같은 --run-id 를 써서 산출물을 한곳에 모은다
tools/recollect-batch.sh --keys-file tools/recollect-batches/batch-1.txt \
  --run-id recollect-2026-07-28
```

배치마다 멈춰서 `data/recollect/<run-id>/<key>/after.json` 을 읽고 다음으로 넘어간다.
죽은 배치는 같은 명령을 다시 돌리면 완료된 스테이지를 건너뛰고 이어서 돈다.

## 배치 순서의 근거

작은 것부터, 엔진 타입마다 작은 키에서 먼저 노출되게, 브랜드 수가 많은
멀티브랜드 편집샵은 파이프라인이 검증된 뒤 마지막에.

| 배치 | 상품수 | 목적 |
|---|---|---|
| 0 파일럿 | 281 | end-to-end 검증. shopify+cafe24 커버, 전부 단일 브랜드 |
| 1 | 1,728 | cafe24 2차 노출 |
| 2 | 4,085 | shopify 중형 |
| 3 | 3,381 | **uniqlo 최초** |
| 4 | 4,624 | bodega = 품절 83% 첫 사례 |
| 5 | 10,142 | **zara 단독** (봇 차단 리스크) |
| 6 | 11,073 | etcseoul = 최대 cafe24 |
| 7 | 13,865 | mohawk-general = 대규모 품절 83% |
| 8 | 11,455 | browns 단독. 브랜드 390개, 전체 색상 가비지의 47% |

## 캠페인 중 주의사항

- **`kiko-refresh.timer`/`kiko-recrawl.timer` 및 `daily-onboard.sh` 등
  `data/*-products.json` 을 쓰는 cron 을 정지한다.** `data/` 는 공유 네임스페이스이고
  `import-products.ts` 가 이 디렉터리를 glob 한다. 타이머가 살아있으면 사전에 걸어둔
  `in_stock=false` 차단이 15분 안에 되돌아간다 (위 "사전 준비" 참조).
- **분류 로직을 바꾸지 않는다.** 바꾸면 배치 0과 배치 8의 결과를 비교할 수 없다.
  드라이버가 시작 시점 커밋을 `manifest.json` 에 남긴다.
- 기존 repair 스크립트(`repair:product-color` 등)를 이 26개 키에 중복 적용하지
  않는다. 재수집이 대체하며, repair 는 나머지 343개 키용으로 계속 유효하다.

## 파일럿에서 반드시 확인할 것

1. 두 local Qwen endpoint의 `/v1/models` health check가 통과하는지 확인한다.
   `import-products.ts`도 DB 쓰기 전에 이를 강제하며, SSH 터널이 없으면 즉시 실패한다.
2. import 로그의 Qwen `success/unchanged/unavailable/failed/schema_failed/race_skip`
   카운터를 확인한다. `unavailable` 또는 `failed`가 있으면 완료가 아니다.
   `unchanged`만 Qwen 응답 후 안전 정책에 따라 기존 공식 분류를 보존한 상태다.
3. zara/uniqlo 크롤의 `jsonLd`/`breadcrumb`와 필수 결정론적 필드가 채워지는지 확인한다.
4. 임베딩 무효화 비율. 20% 초과면 정규화가 CDN 패턴을 놓친 것이다.

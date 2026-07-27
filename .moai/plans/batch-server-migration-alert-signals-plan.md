# 배치 서버 이관 및 알림 신호 구축 PLAN

> 상태: 승인된 구현 계획, 미구현
> 작성일: 2026-07-27
> 대상 저장소: `crawler`, `kiko.ai-app`, 후속 단계의 `ai-server`
> 실행 runbook: [`../../docs/batch-server-migration-runbook.md`](../../docs/batch-server-migration-runbook.md)

## 다른 PC에서 재개

다음 문구로 작업을 재개한다.

```text
crawler/AGENTS.md,
crawler/.moai/plans/batch-server-migration-alert-signals-plan.md,
crawler/docs/batch-server-migration-runbook.md를 읽고 미완료 체크포인트부터 진행한다.
Phase 0 안정화 완료 전에는 catalog event 작업을 운영 배포하지 않는다.
기존 dirty 파일과 사용자 변경사항은 수정하거나 커밋하지 않는다.
```

현재 로컬 `crawler` 작업 트리에는 이 계획과 무관한 변경이 있을 수 있다. 구현 시
관련 파일만 명시적으로 stage하고, 기존 변경을 되돌리거나 함께 커밋하지 않는다.

## 1. 목표

가격, 재고, 신규 상품, 브랜드 세일, 룩북/공식 소식을 알림 소비자가 사용할 수 있는
정규화된 이벤트로 만든다. 먼저 자원이 부족한 AWS 동거 호스트에서 크롤 배치를
연구실 서버로 옮겨 실행 환경을 안정화하고, 그 다음 신호 이벤트 기능을 추가한다.

1차 구현 범위는 **신호 이벤트 생성까지**다. APNs 발송, 알림함, 사용자별 delivery
상태와 재시도 워커는 후속 작업으로 둔다.

## 2. 목표 실행 구조

| 실행 위치 | 책임 |
| --- | --- |
| AWS EC2 | 앱, Postgres, PostgREST |
| 연구실 서버 | `kiko-refresh`, `refresh-candidates`, 수동 `recrawl-batch`, 향후 브랜드 콘텐츠 크롤러 |

세 크롤 배치는 모두 연구실 서버로 이관할 수 있다. 금지하는 것은 동일 배치를 AWS와
연구실 서버에서 동시에 실행하는 것이다.

- `kiko-refresh`: listing-only 가격/재고 관측과 신규 URL 발견. 주기 실행한다.
- `refresh-candidates`: refresh 성공 후 신규 URL 상세조회, LLM 보강, QC, 상품 적재.
- `recrawl-batch`: 온보딩급 상세 재수집/재분류. 정기 timer 없이 수동 실행한다.
- 브랜드 콘텐츠 크롤러: 상품 refresh와 별도 프로세스, 테이블, timer로 운영한다.

연구실 서버 안에서도 `recrawl-batch`와 refresh 계열의 실행 시간을 겹치지 않는다.
초기 이관은 운영 절차로 단일 실행을 보장하고, 이벤트 구현 단계에서 DB advisory
lock을 추가한다.

## 3. 확정 정책

### 3.1 가격과 재고

- 상품 상태 이력은 최초 기준선과 실제 변경 시점에만 저장한다.
- 외화 상품의 가격 변화는 판매처 원통화 기준으로 판단한다.
- 환율만 바뀐 경우 `products.price`는 갱신할 수 있지만 가격 이벤트는 만들지 않는다.
- 판매처 유효가격 변동률이 1% 미만이면 이력만 남기고 이벤트는 만들지 않는다.
- 명시적 `in_stock=false`는 즉시 반영한다.
- 목록 단순 누락은 engine error가 없고 coverage guard를 통과한 정상 런에서 2회
  연속 누락됐을 때 품절로 확정한다.
- 첫 정상 refresh는 기준선만 저장하고 이벤트를 만들지 않는다.

### 3.2 신규 상품과 브랜드 세일

- 신규 URL은 기존 `product_refresh_candidates` 경로로 처리한다.
- 상세조회, LLM 보강, QC를 통과하고 실제 신규 상품이 INSERT될 때만 신상 이벤트를
  만든다.
- 신상 기본 기간은 게시 시점부터 14일이다. 중앙 설정값으로 두어 변경 가능하게 한다.
- 최초 온보딩이나 이벤트 시스템 기준선에서 적재한 상품은 신상으로 표시하지 않는다.
- 정상 완료 refresh에서 원통화 기준 할인율 10% 이상인 상품이 최소 3개이면서 해당
  브랜드 관측 상품의 10% 이상이면 브랜드 세일 시작으로 판정한다.
- 활성 세일이 조건 미달인 정상 런 2회 연속이면 세일 종료로 판정한다.

### 3.3 브랜드 콘텐츠

- 1차 소스는 공개 인스타그램과 공홈 News/Journal/Lookbook/RSS다.
- 이메일 뉴스레터, 비공개 계정, 영상 다운로드와 음성 전사는 제외한다.
- 인스타 릴스는 캡션, 링크, 게시시각, 커버 이미지만 수집한다.
- 공홈 소스는 홈페이지, sitemap, RSS에서 자동 제안하되 운영 승인된 소스만 활성화한다.
- 모든 신규 원문을 저장하고 `new_drop`, `lookbook`, `sale`, `announcement`, `other`로
  분류한다.
- 기본 confidence 0.8 이상인 앞의 네 타입만 이벤트로 승격한다. 임계값과 허용 타입은
  중앙 설정으로 둔다.
- 콘텐츠 소스의 첫 정상 fetch는 기준선만 저장하고 이벤트를 만들지 않는다.

### 3.4 향후 사용자 매칭

- 가격 인하와 재입고: `ai.saves.product_id`.
- 신상, 브랜드 세일, 브랜드 소식: 온보딩 선택을 포함한
  `ai.user_brand_picks.brand_id`.
- 실제 발송 단계에서는 `notification_settings.release_alerts`를 추가로 확인한다.

## 4. 데이터 계약

DB schema는 `kiko.ai-app/database/migrations/`가 소유한다. 현재 crawler 코드가
의존하지만 migration 원장에 없는 `product_refresh_*` 테이블과 RPC를 먼저 idempotent
catch-up migration으로 편입한다.

### 4.1 `product_state_history`

상품별 변경 시점 스냅샷이다.

- `product_id`, `refresh_run_id`, `observed_at`
- `source_currency`, 판매처 유효가격/정가/세일가
- 관측 당시 원화 가격과 적용 환율
- `in_stock`, `stock_evidence`
- `change_mask`, `is_baseline`

무변경 refresh마다 행을 만들지 않는다. 원화 환산값만 바뀐 경우는 merchant price
event와 구분한다.

### 4.2 `catalog_events`

후속 소비자가 읽는 immutable event log다.

- 공통 필드: `event_id`, `event_key`, `event_type`, `product_id`,
  `brand_node_id`, `occurred_at`, `source_kind`, `source_run_id`, `payload`
- `event_key`에 unique constraint를 두어 런 재시도와 worker 경쟁을 멱등 처리한다.
- 이벤트 타입:
  - `product_price_changed`
  - `product_stock_changed`
  - `product_published`
  - `brand_sale_state_changed`
  - `brand_content_published`

`catalog_events`에는 알림에 사용할 수 있는 확정 이벤트만 넣는다. 기준선, 저신뢰
콘텐츠, 1% 미만 가격 변동은 각 이력/원문 테이블에만 남긴다.

### 4.3 신규 상품 필드

`products`에 `first_seen_at`, `published_at`, `new_until`,
`discovery_source`를 추가한다.

- `first_seen_at`: listing에서 후보를 처음 발견한 시각
- `published_at`: 상세조회/QC 후 실제 상품으로 게시된 시각
- `new_until`: 기본 `published_at + 14 days`
- `discovery_source`: `initial_import`, `listing_refresh` 등 발견 경로

### 4.4 콘텐츠 테이블

- `brand_content_sources`: 브랜드, source type/URL, 승인 상태, 주기, cursor,
  마지막 성공/오류, 기준선 상태
- `brand_content_source_runs`: source별 실행 결과와 메트릭
- `brand_content_items`: external ID, canonical URL, 제목/캡션/요약, 게시시각,
  미디어, content hash, 분류 타입/confidence/model, 처리 상태

동일 source의 external ID, canonical URL, content hash로 hard dedupe한다. 같은
브랜드에서 동일 outbound URL을 가리키는 7일 내 교차 source 항목은 하나의 이벤트로
묶는다.

## 5. 구현 단계

### Phase 0: 배치 서버 이관

[`batch-server-migration-runbook.md`](../../docs/batch-server-migration-runbook.md)에
따라 서버 자원, 네트워크, runtime을 검증하고 cold cutover한다. 최소 24~48시간 또는
2~3회전 정상 동작을 확인하기 전에는 Phase 1 운영 배포를 시작하지 않는다.

### Phase 1: refresh schema 원장화와 이벤트 기반

1. `product_refresh_*` schema와 claim/stats RPC를 migration으로 편입한다.
2. 상태 이력, event log, 소스 기준선, 누락 streak, 브랜드 세일 상태를 추가한다.
3. observation batch를 잠금, 비교, history, projection, event까지 한 트랜잭션에서
   적용하는 DB RPC를 추가한다.
4. 동일 platform의 중복 실행을 막는 DB advisory lock을 추가한다.

### Phase 2: 가격/재고 observation

1. `refresh-listing`이 기존 행의 `id`, `brand_node_id`, 원통화 가격을 함께 읽는다.
2. 현재 per-row `applyUpdates`를 정규화된 observation batch RPC 호출로 교체한다.
3. 명시적 재고와 목록 누락을 분리하고 정상 2회 누락 정책을 적용한다.
4. 가격/재고 history와 threshold를 통과한 event payload를 생성한다.
5. 기준선 여부와 suppressed event 수를 refresh run metrics에 기록한다.

### Phase 3: 신규 상품과 브랜드 세일

1. candidate에 `discovered_in_run_id`, `first_seen_at`, `signal_eligible`을 추가한다.
2. 신규 INSERT와 candidate 완료, 신상 필드, `product_published` event를 한
   트랜잭션에서 처리한다.
3. 중복 upsert 경쟁, QC 거절, 기준선 후보는 이벤트를 만들지 않는다.
4. 정상 run의 brand별 할인 현황을 집계해 세일 시작/종료 상태를 갱신한다.

### Phase 4: 콘텐츠 소스와 crawler

1. source proposal/승인/일시정지용 admin 목록과 action을 추가한다.
2. 인스타 profile 증분 수집 provider를 crawler에 구현한다. 기존 ai-server의
   단일 게시물 Apify 코드는 인증/오류 처리 패턴만 참고한다.
3. 공홈은 RSS/Atom, sitemap, 목록 HTML/JSON-LD 순으로 처리하고 필요할 때만
   source별 parser config나 Playwright fallback을 사용한다.
4. fetch와 LLM 분류를 별도 worker로 분리한다.
5. 기본 주기는 인스타 60분, 공홈 6시간으로 두고 source별 `next_attempt_at`으로
   조정한다.

### Phase 5: 후속 알림 전달

이번 계획의 구현 범위 밖이다. `catalog_events`를 소비해 사용자 매칭, APNs,
알림함, delivery idempotency와 재시도를 추가한다.

## 6. 검증

- 기준선 run/fetch에서 event가 0건인지 검증한다.
- 동일 run과 worker 재시도에서 event가 중복되지 않는지 검증한다.
- 외화 환율-only 변경, 0.9%/1.0% 가격 경계, 가격 인상/인하를 검증한다.
- 명시적 품절, 정상 1회/2회 누락, 중간 실패 run, 재입고 플래핑을 검증한다.
- 브랜드 세일 최소 3개/10% 경계와 종료 2회 확인을 검증한다.
- 신규 candidate의 기준선 제외, QC 거절, 중복 경쟁, 14일 신상 처리를 검증한다.
- 콘텐츠 최초/증분 fetch, 캐러셀/릴스 metadata, 저신뢰 보류, source dedupe를
  검증한다.
- crawler는 `pnpm typecheck`, `pnpm test`, 관련 source probe를 통과한다.
- migration과 DB write path는 idempotent 재적용 및 rollback 전 검증 쿼리를 포함한다.

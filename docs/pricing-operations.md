# 가격 수집·백필 운영

상품 가격은 다음 하나의 tuple로 취급한다.

- 정상가: `price = original_price`, `sale_price = NULL`
- 세일가: `price = sale_price < original_price`
- 미확정: 크롤 결과는 보존하되 import/refresh의 가격 UPDATE에는 사용하지 않는다.

온보딩 import는 `pricingObservation.version = 2`이고 상태가 `sale` 또는 `regular`인
결과만 DB 가격을 바꾼다. Shopify는 구매 가능한 variant 중 세일 variant가 하나라도
있으면 가장 낮은 세일 현재가를 사용한다. Cafe24 refresh는 목록에 단일 현재가가 있으면
저장된 `original_price`를 기준가로 판정한다. 현재가가 기준가보다 낮으면 세일, 같거나
높으면 현재가를 새 정상가로 쓰고 `sale_price`를 비운다. 현재가 자체가 없는 상품만
상세 페이지를 확인하되 목록과 상세를 합친 소스 조각 예산 안에서만 새 상세 요청을
시작한다. 예산 안에 확인하지 못한 현재가는 기존 DB 가격을 유지한다. 신규상품 온보딩은
기준가가 없으므로 기존처럼 미확정 가격을 상세에서 확인한다.

## 감사와 백필

먼저 읽기 전용 감사를 실행한다. 활성 refresh 소스는 크롤하여 예상 변경을 계산하고,
disabled 또는 config가 사라진 소스는 자동 수정 대상에서 격리해 출력한다.

```bash
pnpm refresh -- --audit-prices
```

특정 소스만 확인할 때는 `--site=<platform-key>`를 함께 준다. 감사 결과의 세일 탐지,
상세 가격 확인, 미확정 가격, invalid pair 수를 확인한 뒤 가격만 백필한다.

```bash
pnpm refresh -- --price-only --site=<platform-key>
```

`--price-only`는 가격 컬럼만 갱신하며 재고, `last_seen_at`, 신규 후보 큐를 건드리지
않는다. 전체 활성 소스 백필은 `--site`를 빼고 실행할 수 있지만 외부 사이트를 넓게
크롤하고 공유 DB에 쓰므로 운영 승인 후 실행한다.

## DB 제약

앱 저장소의 `106_products_price_consistency.sql`은 기존 invalid sale tuple을 감사
테이블에 보존한 뒤 모순된 `sale_price` 표지만 제거하고, 이후 동일한 모순이 다시
저장되지 않도록 CHECK 제약을 추가한다. migration 적용과 실제 백필은 별도 운영
작업이며 crawler 코드 배포만으로 자동 실행되지 않는다.

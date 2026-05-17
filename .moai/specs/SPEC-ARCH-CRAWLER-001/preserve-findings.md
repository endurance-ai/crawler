# SPEC-ARCH-CRAWLER-001 — PRESERVE 단계 발견 사항 (버그 인벤토리)

> 정책 결정 (2026-05-17): **방침 A 확정**. 본 SPEC 의 IMPROVE 는 현재 동작을
> byte-identical 로 보존하는 구조 리팩토링만 수행한다. 아래 detail 파서 버그는
> **본 SPEC 스코프에서 제외**하며, 골든 마스터(`tests/fixtures/detail/*.golden.json`,
> 커밋 `be9bb53`)에 현재 깨진 동작 그대로 박제되어 있다. 셀렉터 레지스트리 collapse /
> 파서 전략 DI 는 이 깨진 동작까지 1:1 복제해야 한다 (회귀 = 골든 불일치).
>
> 버그 수정은 **별도 후속 SPEC** (가칭 SPEC-CRAWLER-DETAIL-FIX-001) 에서 다룬다.
> 그 SPEC 진입 시 본 문서를 근거 인벤토리로 사용.

## 유형 1 — `material` 필드 오염 (description 잡텍스트 통째 유입)

소재 셀렉터가 description 블록 전체를 긁어 `material` 에 넣음. DB `material` 컬럼이 광고 문구로 오염 중.

| 사이트 | 박제된 `material` | 기대값 |
|---|---|---|
| `8division` | `클래식한 실루엣의 캡입니다. - 70% Acrylic, 30% Wool - 데일리하게 착용 가능합니다.` | `70% Acrylic, 30% Wool` |
| `blankroom` | `Wool 80%, Nylon 20% 으로 제작되었습니다. 차분한 톤으로 다양한 코디에...` | `Wool 80%, Nylon 20%` |
| `visualaid` | `Cotton 100% 의 부드러운 원단을 사용했습니다. 시그니처 그래픽이...` | `Cotton 100%` |

`blankroom` / `visualaid` 는 `BaseDetailParser` 의 thin subclass (descriptionSelectors 만 override) → 근본 원인은 `BaseDetailParser` 의 material 추출 로직 공통 결함일 가능성 높음.

## 유형 2 — 추출 실패로 `null` (innerText 줄바꿈 collapse)

| 사이트 | 박제된 결과 |
|---|---|
| `chanceclothing` | description `null`, material `null` (color/productCode 정상) |
| `slowsteadyclub` | description `null`, material `null` |
| `shopamomento` | description/color/material/productCode **전부 `null`** (detail 파싱 사실상 0 — 최우선 수정 후보) |

## 유형 3 — 파싱 순서 버그로 `color`/`material` 누락

description 텍스트에 값이 명백히 존재함에도 추출 실패.

| 사이트 | 박제된 결과 | 원인 |
|---|---|---|
| `takeastreet` | color `null`, material `null` | description 에 `컬러 : 블랙 소재 : 겉감 - 나일론 100% / 안감 - 폴리 100%` 존재. `MODEL SIZE` 컷이 라인 스캔보다 먼저 실행되어 색/소재 라인 손실 |
| `adekuver` | color `null`, material `null` | description 에 `핑크 컬러 ... 100% CO` 존재하나 추출 실패 |

## 대조군 (정상 동작 — 수정 불필요)

`eastlogue`: `material` = `Outshell_1 : 100% Cotton / Outshell_2 : 70% Cotton / 30% Poly` 로 정상 분리 추출. 18개 중 일부만 결함이며 공통 추출기 설계 시 정상 파서 동작을 레퍼런스로 삼을 것.

## 후속 SPEC 진입 조건

- 본 SPEC (구조 리팩토링) Phase 2 머지 후 진행 권장 — 셀렉터 레지스트리가 들어선 뒤라야 사이트별 수정이 보일러플레이트 없이 가능.
- 수정 시 각 사이트 골든값을 "기대값" 으로 의도적 갱신 + 갱신 사유를 커밋에 명시 (특성화 → 기대값 전환 추적).

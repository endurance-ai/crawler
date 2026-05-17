---
id: SPEC-ARCH-CRAWLER-001
version: 0.1.1
status: draft
created: 2026-05-16
updated: 2026-05-16
author: MoAI orchestrator (manager-spec)
priority: high
issue_number: 0
---

# SPEC-ARCH-CRAWLER-001 — Crawler 내부 아키텍처 재설계 (Validator Gate + Parser Strategy)

> **리포 경계**: 이 SPEC 과 그 구현 코드는 외부 리포 `endurance-ai/crawler` (로컬 `/Users/hansangho/Desktop/kikoai/crawler`) 에서 추적된다 — kiko.ai-app 리포와 별개. 경로는 모두 crawler 리포 루트 기준 (예: `src/lib/...` = crawler 리포의 `src/lib/...`).

## HISTORY

- 2026-05-16 v0.1.1: app 리포에서 crawler 리포로 이전 (`endurance-ai/crawler` 가 별도 리포임을 확인 — 코드+SPEC 동일 리포에서 추적). 모든 경로를 crawler-repo-relative 로 정정 (`crawler/` prefix 제거). 내용 변경 없음.
- 2026-05-16 v0.1.0: 초안. stack-internal 재설계 4-SPEC 분해 중 1번 (실행 순서 1번, 최저 회귀 위험). 언어 불변 (TS Playwright 유지). 감사 결과 — `src/lib/parsers/detail/` 에 18개 copy-paste 사이트 파서 + `src/lib/core/` 부재 확인. PRESERVE-IMPROVE 전략을 위험도별 3 페이즈로 분할.

## Overview

crawler 리포는 외부 데이터 수집 본체 (Playwright Cafe24 + Shopify JSON, 81k SKU / 697 브랜드). 현재 두 가지 구조적 문제가 있다:

1. **검증 부재** — 파싱된 product 가 JSON/DB 로 쓰이기 전 Zod 스키마 게이트가 없어, 깨진/부분 레코드가 조용히 DB 를 오염시킬 수 있다 (silent DB corruption risk).
2. **파서 중복** — `src/lib/parsers/detail/` 에 18개 사이트별 detail 파서 (`8division-parser.ts`, `adekuver-parser.ts`, `anotheroffice-parser.ts`, `bastong-parser.ts`, `blankroom-parser.ts`, `chanceclothing-parser.ts`, `eastlogue-parser.ts`, `etcseoul-parser.ts`, `fr8ight-parser.ts`, `havati-parser.ts`, `roughside-parser.ts`, `sculpstore-parser.ts`, `shopamomento-parser.ts`, `sienneboutique-parser.ts`, `slowsteadyclub-parser.ts`, `swallowlounge-parser.ts`, `takeastreet-parser.ts`, `visualaid-parser.ts`) 가 셀렉터만 다른 copy-paste 구조다. 사이트 #33 추가 시 보일러플레이트가 선형 증가한다.

이 SPEC 의 목표 속성은 **"사이트 #33 을 최소 보일러플레이트로 추가"** 다. 이것은 재작성이 아니라 추출/계층화다. **사용자 가시 동작 변화 0 — 수집되는 product 데이터의 필드/값은 재설계 전후 byte-identical 해야 한다 (HARD).**

위험도별 3 페이즈로 분할한다: Zod validator (ZERO risk, 신규 게이트만 추가) → selector registry (MEDIUM, 18 파서 → 단일 레지스트리 collapse) → parser strategy DI (HIGH, characterization tests 통과 후에만).

## Goals (EARS-format requirements)

### REQ-CRAWLER-001 (Ubiquitous) — Product Validation Gate

The crawler **shall** validate every parsed product against a Zod `ProductSchema` in `src/lib/core/product-validator.ts` BEFORE the product is written to any JSON output file or database upsert.

[HARD] Schema 게이트는 신규 추가 레이어이며 기존 파서 출력을 변형하지 않는다 — 유효한 product 는 그대로 통과, 무효 product 는 구조화 로그와 함께 reject (write 차단).

### REQ-CRAWLER-002 (Unwanted) — Reject Invalid Records

**If** a parsed product fails `ProductSchema` validation (missing required field, type mismatch, malformed price/url), **then** the crawler **shall not** write that record to JSON or DB, and **shall** emit a structured error event (site, sku, failed field, raw value) via the observability hook.

### REQ-CRAWLER-003 (Event-driven) — Selector Registry Collapse

**When** a Cafe24-family site's detail page is parsed, the crawler **shall** resolve field selectors (price / url / image / gender / name / description) from a single declarative selector registry keyed by site, replacing the 18 copy-paste per-site detail parser modules with one registry + shared field extractors.

[HARD] 레지스트리 collapse 후 18개 사이트 각각의 파싱 결과는 collapse 전과 field-by-field 동일해야 한다 (selector registry 는 동작 보존 추출이며 동작 변경이 아님).

### REQ-CRAWLER-004 (Optional) — Pluggable Parser Strategy

**Where** a new platform requires custom parsing logic beyond declarative selectors, the crawler **shall** provide a `Parser` strategy interface (DI-injected) plus shared field extractors so a new platform parser is implemented by supplying a strategy + selector entry, not by copy-pasting a full module.

### REQ-CRAWLER-005 (Event-driven) — Structured Observability Hook

**When** a parse or validation event occurs (success, field-extraction fallback, validation reject, site error), the crawler **shall** emit a structured event through a single observability hook (not ad-hoc `console.log`), enabling per-site parse health metrics.

### REQ-CRAWLER-006 (Optional) — Scaffold Tooling

**Where** a developer adds a new crawl site, the crawler **shall** provide a `scaffold-platform` tool and an `add-platform.md` guide that generate the strategy + selector-registry entry skeleton, minimizing boilerplate for site #33+.

## Acceptance Criteria

상세 Given/When/Then 시나리오는 `acceptance.md` 참고 (Plan 워크플로 후속 산출). 필수 게이트:

- **[HARD] 사용자 가시 동작 & 화면 불변**: crawler 출력 데이터가 소비되는 다운스트림(app `/`, 검색)의 화면/동작은 변경 0. 재설계 전 크롤 결과 JSON 과 재설계 후 JSON 이 동일 입력 사이트에 대해 byte-identical (페이즈 2/3 회귀 검증).
- **[HARD] Characterization-tests-precede-refactor 게이트**: 페이즈 3 (parser strategy DI) 진입 전, 3개 대표 플랫폼(**cafe24 + shopify + uniqlo**)에 대한 characterization tests (실제 페이지 fixture HTML → 파싱 결과 스냅샷)가 작성·통과되어야 한다. 페이즈 1 (Zod validator) 은 신규 게이트라 characterization 불필요, 페이즈 2 (selector registry) 진입 전 18 사이트 fixture 스냅샷 필요.
- **타깃 폴더 레이아웃** (감사에서 도출한 구체 디렉터리명, crawler 리포 루트 기준):
  - `src/lib/core/product-validator.ts` — Zod `ProductSchema` + `validateProduct()` 게이트 (신규)
  - `src/lib/parsers/detail/selector-registry.ts` — 사이트별 셀렉터 선언 레지스트리 (18 파서 collapse 대상)
  - `src/lib/parsers/field-extractors/` — `price.ts` / `url.ts` / `image.ts` / `gender.ts` 공유 추출기
  - `src/lib/parsers/parser-strategy.ts` — `Parser` 전략 인터페이스 + DI 컨테이너
  - `src/lib/core/observability.ts` — 구조화 이벤트 훅
  - `tools/scaffold-platform.ts` + `docs/add-platform.md` — 신규 사이트 스캐폴드
- **롤백 전략**: 페이즈별 독립 PR. 페이즈 1 (validator) 은 feature flag `CRAWLER_VALIDATION_ENABLED` (기본 on, off 시 게이트 bypass = 기존 동작). 페이즈 2/3 은 selector registry / strategy 도입 PR 단위로 git revert 가능 — 18 파서 원본은 페이즈 2 머지 후 별도 정리 PR 에서만 삭제 (revert 안전성 확보).

## Doc Sync

> 이 SPEC 의 코드는 crawler 리포에 있으나, CLAUDE.md 필수 동기화 3종 doc 은 **kiko.ai-app 리포**에 있다. crawler 재설계 완료 시 app 리포 측 doc 갱신은 app 리포 PR 로 별도 수행 (cross-repo 동기화).

- (app 리포) `docs/ARCHITECTURE.md` — crawler 토폴로지 섹션: 외부 리포(`endurance-ai/crawler`) 데이터 흐름에 validator 게이트 + selector registry 추가 반영. **이 SPEC 완료 시 app 리포 PR 로 갱신 필수.**
- (app 리포) `docs/features/main-flow.md` — 변경 없음 (crawler 는 메인 플로우 외부 데이터 소스, IG/Vision/검색 흐름 무관). app 리포 PR 시 "변경 없음" 명시.
- (app 리포) `docs/features/search-engine.md` — 변경 없음 (검색 알고리즘/스코어링 무관). app 리포 PR 시 "변경 없음" 명시.
- (crawler 리포) `README` + `docs/add-platform.md` — 신규 selector registry + scaffold 워크플로 반영. 이 SPEC 완료 시 crawler 리포 PR 로 갱신.

## What NOT to Build (Exclusions / NOT in scope)

- 언어 마이그레이션 (Go/Rust 등) — 전면 금지. TS Playwright 유지.
- 크롤 알고리즘/수집 정책 변경 (rate limit, robots, 사이트 추가 정책) — 추출만 한다.
- 신규 사이트 실제 추가 (site #33 구현) — 스캐폴드 도구만 제공, 실제 사이트는 별도 작업.
- 수집 데이터 스키마 자체 변경 (DB 컬럼 추가/변경) — `ProductSchema` 는 **현재 출력 형태를 박제**할 뿐 새 필드 도입 아님. DB 스키마 변경 필요 시 별도 SPEC + (app 리포) `docs/guides/platform-parser-guide.md`.
- 성능 최적화 (병렬도, 캐시) — 본 SPEC 은 유지보수성/온보딩 중심. 성능은 별도 SPEC.
- review 파서 (`src/lib/parsers/review/`) 재설계 — detail 파서만 본 SPEC 스코프.

## Dependency Ordering & Parallelism

- **실행 순서**: 4-SPEC 중 **1번 (최우선, 최저 회귀 위험)**. crawler 출력은 app/ai 와 코드 공유 없음 → 격리도 최고. (나머지 3 SPEC 은 app 리포 `.moai/specs/`: SPEC-ARCH-AI-001, SPEC-ARCH-APP-001, SPEC-SEARCH-UNIFY-001.)
- **병렬 가능**: SPEC-ARCH-AI-001 과 **병렬 실행 가능** (서로 다른 리포, 코드 공유 0). 단 리뷰 대역폭 한정 시 crawler 먼저 권장 (위험 최저로 재설계 패턴 검증).
- **후행 의존**: 없음. 이 SPEC 는 ARCH-AI/APP/SEARCH-UNIFY 의 선행 의존이 아니다 (독립).

## Cross-References

> 아래 SPEC 들은 app 리포 `.moai/specs/` 에 위치 (cross-repo 참조).

- SPEC-ARCH-AI-001 (app 리포): 병렬 가능 (독립 리포). 재설계 패턴(validator gate + strategy DI)을 ai/ services 추출과 동일 철학으로 정렬.
- SPEC-SEARCH-UNIFY-001 (app 리포): 간접 — crawler 데이터 품질 게이트(REQ-CRAWLER-001/002)가 검색 입력 신뢰성을 높이나, 검색 port 계약과 직접 결합 없음.

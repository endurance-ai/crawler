# 커스텀 브랜드 수집 파일럿 리포트 (imweb)

작성일: 2026-07-16 · 확정: 2026-07-17 · 상태: **완료** (25/25 브랜드 적재 성공)

## 배경

cafe24 최적화(lightpanda, 셀렉터 레지스트리, hybrid LLM 분류) 이후, `brand-crawl detect`가
custom(929) / unknown(511)으로 분류한 브랜드의 수집 전략 수립 + 파일럿.
전략: **플랫폼 패밀리당 엔진 + 구조화 데이터 우선 + LLM은 온보딩 분류에만** (플랜:
`~/.claude/plans/cafe24-binary-chipmunk.md`).

## Phase A — 구성 프로브 (완료)

`detectBrand()` fingerprint 확장 (`src/brand-crawl.ts`): 마이너 플랫폼 10종 시그널 +
bot_protected / jsonld_product / sitemap 관찰 필드. `platform_type`은 DB CHECK 제약
(`custom` 등 8개 값만 허용) 때문에 유지하고, 세분류는 `detection.platform_family`에 기록.

**custom 927개 재분류 결과** (2026-07-16 재프로브):

| platform_family | 브랜드 수 | 공략법 |
|---|---|---|
| custom 미분류 | 553 | 대부분 글로벌 자체구축 (봇방어 194개 포함) — 후속 |
| demandware (Salesforce CC) | 106 | 전용 엔진 후보 — 후속 |
| **imweb** | **64** | **이번 파일럿 — 엔진 완성** |
| nextjs-headless | 59 | `__NEXT_DATA__` JSON 추출 후보 — 후속 |
| woocommerce | 43 | Store API 비공개 사이트 많음(실측 2/2) — sitemap+JSON-LD 폴백 필요 |
| squarespace | 43 | JSON-LD 표준 탑재 — 후속 |
| sixshop | 26 | 한국 2순위 — 후속 |
| magento / wix / godomall | 20 / 11 / 2 | 후속 |

부수 성과: custom이던 23개가 shopify로 재분류(1151→1174) → 기존 shopify 엔진으로 즉시 수집 가능.
unknown 511 → 488 (일부 재분류 성공, 나머지는 fetch 실패/봇차단 — Playwright 재프로브 후속).

## Phase B — 엔진 (완료)

| 자산 | 내용 |
|---|---|
| `src/lib/parsers/structured-data.ts` | JSON-LD Product + OG meta 파서 (모든 향후 커스텀 엔진 공용, 테스트 10개) |
| `src/lib/imweb-engine.ts` | 리스트: `.shop-item[data-product-properties]` JSON (Playwright) · 상세: 서버렌더 JSON-LD (**plain fetch** — 브라우저 불필요) · 카테고리 자동탐색 |
| `tools/pilot-classify.ts` | data/*.json → canonical category/subcategory LLM 배치 분류(gpt-4.1-nano) + gender 백필 |
| 배선 | `PlatformType`에 "imweb", crawl.ts 디스패치, platforms.ts 파일럿 25개 엔트리 |

실측 (heretic.kr):
- 리스트-only: 188개 상품, name/price/image 100% / color 95% (상품명 "/color" 패턴)
- 상세 포함: **전 필드 100%** (JSON-LD로 desc/color/재고 확보), 20개 42s
- waitForSelector 최적화로 고정 대기 대비 2.4× 단축
- 갱신 경로: 리스트 data 속성만으로 가격/세일가 — **LLM 0회, 결정적**

테스트: 221/221 그린 (기존 205 + 신규 16).

## Phase C — 25개 브랜드 파일럿 (진행 중)

대상: imweb 64개 중 robots.txt 허용 확인된 25개
(aubour, heretic, questandguest, differentis, service-en, youche-pa, sacredt, noobstore,
eonts, bluesf, durt, corebrass, lost-town-supply, homly, monjagal, rarseoul, taille,
dogmaehks, jimilii, amabe, singularisca, pulajournal, hokuspokus, minihorses, hausou)

파이프라인: `crawl --detail` → `pilot-classify` (canonical taxonomy + gender 백필)
→ `import-products --no-new-brands --in-stock-only` → `reclassify --only-invalid` 가드레일
→ 갱신 시뮬레이션 (리스트-only 재크롤, LLM 0회 확인)

### 최종 결과 (25/25 브랜드)

**크롤 2,419개(재고) → DB 적재 1,820개 · 적재 에러 0 · DB null(category/color/gender) 0 · admin 25/25 `imported` 자동 동기화**

| 브랜드 | DB 적재 | 브랜드 | DB 적재 | 브랜드 | DB 적재 |
|---|---|---|---|---|---|
| taille | 338 | corebrass | 66 | questandguest | 24 |
| heretic | 257 | pulajournal | 63 | sacredt | 16 |
| hokuspokus | 201 | bluesf | 44 | differentis | 14 |
| durt | 134 | noobstore | 41 | jimilii | 12 |
| amabe | 126 | dogmaehks | 41 | eonts | 11 |
| aubour | 112 | lost-town-supply | 36 | minihorses | 8 |
| homly | 108 | youche-pa | 68 | hausou | 4 |
| service-en | 68 | singularisca | 19 | monjagal·rarseoul | 3·3 |

- **review 분리 ~599개 (25%)**: 대부분 color null (상품명/설명에 색상 정보가 없는 브랜드 — noobstore 89%, service-en 43%가 극단 사례). reject(완전 폐기) 0.
- **LLM 비용 총 ~$0.033 / 2,400여 개 ≈ $0.000014/상품** (gpt-4.1-nano 배치 분류+색상복구). 브랜드당 ~$0.0013.
- **갱신 시뮬레이션** (sacredt, 리스트-only): 43s · LLM 0회 · price 100% · 재입고 3개 감지 — 결정적 갱신 경로 실증.
- 품절 1,124개는 크롤 단계에서 제외 (프로젝트 규칙 준수).
- 카테고리 분포: tops 612 · bottoms 474 · outerwear 168 · knitwear 153 · jewelry 97 · accessories 67 · dresses 63 · bags 54 …

### 파일럿 중 발견·수정한 결함

1. **crawl.ts 저장 게이트 유실**: 온보딩 크롤을 게이트 ON으로 돌리면 비canonical 카테고리가 `category_noncanonical_dropped`로 대량 유실 (aubour 134→30). → 온보딩은 `CRAWLER_VALIDATION_ENABLED=false CRAWLER_QC_NORMALIZATION_ENABLED=false` + 분류 후 import 게이트.
2. **imweb 소수점 세일가**: `27599.99` 같은 값이 DB integer 컬럼에서 **배치 단위 실패** (heretic 57개). → 엔진 `toNumber()` 반올림 수정.
3. **gender DB CHECK(091)**: 빈 gender는 적재 불가. → SiteConfig.defaultGender(brand_nodes.gender_scope 유래) + pilot-classify 백필.
4. **사이트 행(hang)**: 604service가 8.7h 소모(리다이렉트/타임아웃 루프). → imweb 디스패치에 cafe24와 동일한 `withSiteTimeout`(120분) 추가.
5. **일시 장애 0개**: questandguest 첫 크롤 0개, 단독 재시도로 37개 성공(동시 크롤 리소스 경합 추정). → 파일럿 절차에 "0개 사이트 재시도 패스" 포함.
6. **crawlDetails 하드코딩 금지**: config에 true로 박으면 갱신도 상세 크롤이 됨. → config 기본 false, 온보딩만 CLI `--detail`.
7. **load 이벤트 행(hang) 사이트군**: 7개 사이트(jimilii/amabe/singularisca/pulajournal/hokuspokus/minihorses/hausou)가 goto(domcontentloaded) 30s 타임아웃으로 전멸 — DOM은 289ms에 파싱되지만(`readyState: interactive`) 행 걸린 동기 리소스가 load 이벤트를 영영 막는 구조. → **goto를 `waitUntil: "commit"`으로 전환 + 셀렉터 기반 대기**로 수정, 재시도에서 7/7 전부 회복 (imweb-engine.ts 3개 goto).

### 검증 (Verification 결과)

- `npm run typecheck` + `npm test` 221/221 그린 (구조화 데이터 10 + imweb 6 신규 테스트 포함)
- DB: `products` 1,820행, category/color/gender null **0**, out_of_stock **0**
- 가드레일 `reclassify --only-invalid`: 수정 대상 0 (LLM 분류가 canonical만 출력)
- admin `product_crawl_brands` 뷰: 25/25 `imported` — 수기 mark 없이 자동 반영
- 갱신 경로: 리스트-only 재크롤이 LLM 0회로 완료 (sacredt 43s)

### 추가 변경 (2026-07-18)

품절 상품도 크롤 산출물에 포함하도록 `imweb-engine.ts` 수정 — 기존에는 크롤 단계에서
`in_stock=false`를 걸러냈으나(다른 엔진과 동일한 프로젝트 관행), 재입고 감지·admin
가시성을 위해 imweb 엔진은 원본을 완전하게 남기고 **적재 시점 필터(`import-products.ts
--in-stock-only`)로만 제어**하도록 정책을 분리했다. cafe24/shopify 등 기존 엔진은
변경하지 않음(영향 범위 최소화). 위 표의 크롤/적재 수치는 이 변경 이전 실행 결과이며,
재크롤 전까지는 품절 상품이 반영되지 않는다.

### 후속 과제

- **색상 미기재 브랜드 (review ~599개)**: 텍스트 기반 복구의 한계 — 이미지 기반 색상 추출(ai-server FashionSigLIP/vision 경로) 검토가 다음 레버. review 큐는 admin 검수로도 소화 가능.
- **imweb 잔여 39개 + 식스샵 26개**: 이번 파이프라인 그대로 확장 (재시도 패스 포함).
- **604service 재크롤**: 정상 크롤됐지만(122개) 8.7h 소요 — 워치독 추가 후 재실행 시 정상 시간 확인 필요.

## 확장 로드맵 (전량 929+511)

1. **아임웹 잔여 39개 + 식스샵 26개**: 파일럿 안정화 후 동일 패턴 (식스샵 엔진은 imweb 스파이크 방식 재사용)
2. **squarespace(43) / nextjs-headless(59)**: structured-data.ts 재사용도가 높은 그룹
3. **woocommerce(43)**: sitemap + JSON-LD 폴백 엔진
4. **demandware(106) + custom 미분류(553)**: 봇방어(403 194개) 대응 필요 — ZARA/Farfetch real-Chrome 경로 재사용 검토, 비용/가치 판단 후
5. **unknown 488**: Playwright 기반 재프로브로 재분류

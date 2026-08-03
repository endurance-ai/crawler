# 성별 추출 롤백: VLM(product_features) → 크롤러(products.gender)

## 진행 상태 (2026-08-03 갱신)

```
🟢 P0  측정                    ← 수율 81.5% → 98.3% (platforms.ts 복원 + gender-defaults.ts)
🟢 P1  RPC 순위 교체            ← 5+2곳 술어 + curation/products.py. 회귀 없음(베이스라인 대조)
🟢 P2  크롤러 코드 복원          ← tsc 0 에러 / 383 테스트 통과
⏸️ P3  연구실 서버 배포          ← P2 머지 후. **P5 보다 반드시 먼저**
🟡 P4  백필 (재크롤)            ← 진행 중. adsb 100% · sportyandrich 98.3% 실증
   └─ 22개 플랫폼 재크롤 백그라운드 실행 중
⏸️ P5  제약 + VALIDATE          ← P4 완료 후. migration 103/104 작성 완료
⏸️ P6  RPC 하드 필터            ← VALIDATE 성공 후
🟢 P7  정리                     ← package.json · CLAUDE.md §18 완료
```

### P1 결과 (ai-server)

`products.gender` 를 1순위로, VLM 을 2순위로 강등. fail-open 은 P6 까지 유지한다.
- `sql/functions/search_products_v6.sql` 술어 5곳 + 헤더 근거 갱신
- `sql/functions/search_products_hybrid_v1.sql` kNN CTE 2곳
- `app/services/curation_refresh.py` `GENDER_MATCH_SQL` (fail-closed 유지)
- `app/api/products.py` PDP 상세 쿼리 (`ARRAY[NULL]` 방지)
- `app/services/search_service.py` `_resolve_gender` 독스트링

검증: 전체 스위트 1,355 pass / 1 fail / 13 error. 베이스라인(변경 전)은
1,321 pass / 1 fail / 47 error — 동일 테스트 1건이 양쪽 모두 실패하고 에러는
Redis·네트워크 환경 문제다. **회귀 없음.**
통합 테스트(`test_curation_gender_bridge.py`)는 Docker 필요로 skip — CI 에서 확인할 것.

### P4 재크롤 실증

DB 텍스트만으로는 6,780행 중 980행(14%)만 해결됐다. 재크롤은 크롤 시점에만
존재하는 근거(shopify 태그, 카테고리 URL)를 확보하므로 결과가 다르다:

| 플랫폼 | 재크롤 후 수율 |
|---|---|
| adsb | 576/576 (100%) — engine=509 태그, url=67 |
| sportyandrich | 517/526 (98.3%) — engine=504 |
| a-cold-wall-2808 | **0/119** — 카탈로그 전체에 성별 신호 없음 |

`sportyandrich`·`a-cold-wall-2808` 은 SiteConfig 가 없어 재크롤이 불가능했다.
robots.txt 통과를 확인하고 `platforms.ts` 에 추가했다(둘 다 Shopify/KRW).
혼성 브랜드라 `defaultGender` 는 두지 않았다.

**A-COLD-WALL 은 재크롤로도 해결되지 않는다** — 상품명이 순수 제품 서술이고
태그·URL 어디에도 성별이 없다. 사용자 결정("드랍 유지")에 따라 적재하지 않으며,
DB 95행은 NULL 로 남는다. `twojeys`(장신구) 등도 같은 부류다.
→ P5 VALIDATE 전에 이 잔여분은 삭제 런북이 필요하다.

**범위 추가 (사용자 지시, 2026-08-03)**: 29cm 크롤링 전면 제거 완료 — 엔진·테스트·설정·
`PlatformType`·`crawl.ts`/`refresh-listing.ts` 분기·`apiCategoryCodes` 전부 삭제.
DB 적재량은 0건이었다. 무신사는 크롤 대상으로 존재한 적이 없다(29CM 모회사 언급뿐).

### P0 실측 (캐시 65,982건)

| 단계 | 수율 |
|---|---|
| 복원 전 | 81.5% |
| `platforms.ts` 복원 (defaultGender 59 + 카테고리 gender 266) | 83.6% |
| `gender-defaults.ts` (검증된 24개 사이트) 추가 | **98.3%** |

남은 0%대 9개 플랫폼(1,105행)은 근거가 없어 **의도적으로 비워 뒀다**
(oryany=핸드백 전용, roaringrad/samostuff=성별 구분 없음≠unisex, nuakle=근거 충돌 등).

### P4 가 막힌 지점 🔴

`products.gender IS NULL` 6,780행 중 repair 스크립트가 해결한 것은 980행뿐이다.
잔여 5,601행(82.6%)의 정체:

- **혼성 브랜드** — `jadedldn` 은 repair 가 이미 남성 61 + 여성 142 를 확정했다.
  `sportyandrich`, `bodega`, `apc-us` 도 남녀 모두 판매한다. **이런 브랜드에
  사이트 기본값을 박는 것은 구조적으로 틀리다** — 상품 절반을 반대 성별로 적재한다.
- **무신호 브랜드** — `twojeys`(장신구), `beheavyer`, `borseoul` 등은 상품명·URL·
  카테고리 어디에도 성별 신호가 없다.

즉 P4 는 "기본값을 더 찾으면 되는 문제"가 아니다. 선택지는 셋뿐이다:

1. 해당 플랫폼 **재크롤** — 엔진/URL 근거를 새로 확보 (정확하지만 비용·시간)
2. 잔여분 **삭제** — 단, `products` 는 `product_embeddings`/`product_reviews` 로
   cascade 되므로 반드시 리뷰된 admin 런북으로 (repair 스크립트는 DELETE 를 거부한다)
3. P5 를 **NOT VALID 로만** 적용 — 신규 INSERT 는 막고 기존 행은 통과시킴

---

## Context

2026-07-29~30, 커밋 `1febe76` 이 크롤러에서 color·gender·description 추출을 전부 걷어내고
VLM(`product_features.feature_metadata`)에 위임했다. color 는 크롤러 추출 일치율이 54.8% 에
불과해 이관이 옳았지만, **gender 는 VLM 성능이 나오지 않았다.**

현재 상태의 문제:

- `search_products_v6` 의 성별 술어는 3단 다리 — **1순위가 VLM**, 2순위 `products.gender`,
  3순위 fail-open(무조건 통과). VLM 이 값을 내놓으면 기존 15만행의 멀쩡한 `products.gender`
  를 덮어쓴다. VLM 품질이 나쁘다는 전제 하에 이건 매일 손해다.
- 2026-07-30 이후 적재된 신규 상품은 gender 가 NULL 이라 전부 3단(fail-open)으로 떨어져
  **남성 검색과 여성 검색 양쪽에 다 노출**된다.
- `chk_products_gender_required` 는 migration 096 에서 DROP 됐다.

목표: 크롤러가 다시 `products.gender` 의 단일 출처가 되고, 성별 없는 상품은 적재되지 않으며,
DB 가 그걸 강제한다. **color 는 계속 VLM/product_features 에서 온다 — 건드리지 않는다.**

### 확정된 설계 결정

1. **brand_nodes.gender_scope 폴백 제외.** engine / URL / text / config_default 만 사용.
   `isSingleGenderScope` 와 `brand_scope` 분기를 복원 대상에서 뺀다. brand_nodes 데이터 품질이
   롤백의 선행 조건에서 완전히 빠진다.
2. **기존 NULL 행은 repair 스크립트로 백필** (재크롤 아님) — DB 의 name/product_url/tags/
   category 텍스트로 재추론.
3. **DB 제약은 VALIDATE 까지.** dirty 822행 + NULL 행 정리 후 `chk_products_gender_required`
   재생성 및 검증.
4. **`import-brand-nodes.ts` 에 `cleanGenderScope` 정규화 추가.**
5. `unisex` 는 "확인된 남녀공용"일 때만. 미확인은 절대 unisex 로 세탁하지 않는다.

---

## 조사에서 확인된 사실 (실측)

**드리프트 실측** (`git diff --numstat 1febe76 HEAD`):

| 파일 | 드리프트 | 복원 난이도 |
|---|---|---|
| `src/lib/29cm-engine.ts`, `farfetch-engine.ts`, `zara-engine.ts` | **0** | 기계적 |
| `src/lib/core/product-validator.ts`, `tools/generate-platform-configs.ts` | **0** | 기계적 |
| `src/spikes/imweb-engine-test.ts` | **0** (제거 diff 는 color 전용 — **gender 변경 없음**) | 손댈 것 없음 |
| `src/configs/platforms.ts` | +58/−0, color 오염 0줄 | **`git apply -R -3` 로 clean 적용 확인됨** |
| `src/lib/uniqlo-engine.ts`, `imweb-engine.ts` | 1~2줄 (gender 무관) | 사소 |
| `src/lib/shopify-engine.ts` | +12/−4 | 수동 |
| `src/lib/cafe24-engine.ts` | +155/−8 | 수동, 최대 작업 |
| `src/crawl.ts` | +22/−4 | **수동 필수 (아래 함정)** |
| `src/configs/platforms.generated.ts` | +601/−46, 82→344 사이트 | **복원 안 함** |

**함정 A — `src/crawl.ts` 는 역적용 금지.** 제거 커밋이 추가한 22줄에 `--allow-multibrand`
편집샵 제외 블록과 `detailFetchedAt` 재시작 마커가 들어있다. 역적용하면 multiBrand 가드가
사라지고 `loadExistingDetails` 가 `p.color` 마커로 되돌아간다 — 그 필드는 이제 항상 falsy라
매 재시작마다 전 상세페이지를 재크롤한다.

**함정 B — refresh-candidates 경로엔 gender 공급원이 아예 없다.**
`src/lib/llm-product-enrichment.ts` 의 `EnrichmentSchema` 는 `{category, subcategory}` 뿐이다.
row builder 에 gender 키만 되살리면 migration 099 가 기록한 `null value in column "color"`
210회 사고가 gender 로 그대로 재현된다. 자체 결의 단계가 필요하다.

**수율 절벽 (실측, `platforms.ts` 주석에 보존됨):** 텍스트+URL 추론만으로는 하우스브랜드
자사몰에서 ~90% 가 드랍된다.
- `drakes`: 1816개 중 1639개 드랍 (기존 DB 942행 전량 men)
- `noah-ny`: 634행 중 66행만 생존 (기존 DB 실측 men=634)
- `cpfm`: 상품 9개 전부 드랍 → 파일 자체가 안 써짐

게이트는 정상 동작한 것이고, 신호가 없는 것이다. → **`platforms.ts` 의 hand-curated
`defaultGender` 59개 + 카테고리 gender 266개 복원이 이 계획에서 단일 최고가치 작업.**

**반대로 `platforms.generated.ts` 의 gender 는 복원하면 안 된다.** 실측 분포:
`["unisex"]` 415 / `["women"]` 291 / `["men"]` 16. 57% 가 unisex 인데, 생성기 코드가
`c.gender?.length ? c.gender : ["unisex"]` 로 **기본값**을 박은 결과다 (womenswear 브랜드
LOW CLASSIC 이 17개 카테고리 전부 unisex). 결정 #5 정면 위반이고, 그 값의 출처는 결국
`brand_nodes.gender_scope` 라 결정 #1 위반이기도 하다.

**gender_source 는 신규 migration 불필요.** migration 095 의 allow-list 가 이미
`engine, url, text, llm, config_default, brand_scope, legacy_backfill, repair_url,
repair_text, repair_brand_scope, unverified_legacy` 를 전부 포함한다.
단 repair 스크립트가 `repair_config_default` 같은 새 값을 만들면 안 된다 — `config_default` 재사용.

**읽기 경로는 4곳** (조사 중 1곳 추가 발견): `search_products_v6.sql`(술어 5회 반복),
`search_products_hybrid_v1.sql`(kNN CTE 2곳), `curation_refresh.py`,
그리고 **`ai-server/app/api/products.py:150-157`** (PDP 상세 쿼리).

**마이그레이션 번호**: 현재 최대 `102_unbounded_product_images.sql`. **103, 104 사용.**

---

## 단계 순서 (배포 순서가 설계의 핵심)

```
P0  측정            (배포 없음)   ── 수율 기준선 확보
P1  RPC 순위 교체   (ai-server)   ── VLM 강등, fail-open 유지
P2  크롤러 코드 복원 (crawler)     ── 두 INSERT 경로 모두 gender 생산
P3  연구실 서버 배포 + soak       ── 제약 걸기 전에 코드가 먼저 살아있어야 함
P4  백필 (repair + 103)           ── NULL + dirty 822행
P5  104: ADD CONSTRAINT → VALIDATE
P6  RPC 하드 필터   (ai-server)   ── fail-open 및 pf 단 제거
P7  정리
```

**P1 을 맨 앞에 두는 이유**: 오늘 1순위가 VLM 이다. VLM 품질이 나쁘다는 게 이 작업의 전제이므로,
순위만 뒤집는 것은 크롤러 변경과 완전히 독립적이면서 즉시 이득이고, fail-open 이 남아있어
리콜 리스크가 0이다. 1일차에 배포한다.

**P1~P5 동안 fail-open 을 유지하는 이유**: 07-30 이후 NULL 행이 P4 완료 전까지 존재한다.
먼저 제거하면 그 행들이 모든 성별 검색에서 사라진다.

**P3 이 P5 보다 반드시 앞서는 이유**: `kiko-refresh.timer` 가 `OnUnitInactiveSec=15min` 으로
돌며 `OnSuccess=kiko-refresh-candidates.service` 를 연쇄시킨다. 연구실 서버
(`kjk@100.70.101.17:/home/kjk/kiko-crawler`, branch `dev`)가 옛 코드인 상태로 CHECK 가
검증되면 15분마다 신규상품 INSERT 가 전량 실패한다 — color 사고 그대로.

---

## P0 — 측정 (배포 없음)

`product-gender.ts` + `types.ts` + import-products 결의 패스 + 새 `--dry-run` 카운터만 복원하고
**row-mapper 스킵 가드는 넣지 않은 채** 기존 `data/*-products.json` 캐시에 대해
`pnpm tsx src/import-products.ts --dry-run` 실행.

기존 dry-run 계측(구규칙 brand_scope 대비)은 의미가 사라졌으므로 **재작성**한다:
플랫폼별 `resolved/total`, 출처별 히스토그램, `resolved/total < 0.5` 인 플랫폼 top-N.

`platforms.ts` 와 `gender-defaults.ts` 를 넣은 뒤 같은 측정을 반복해 비교한다.
이 숫자가 P2 진행 여부의 게이트다.

---

## P1 — RPC 순위 교체 (fail-open 유지)

`ai-server/sql/functions/search_products_v6.sql` — 동일 술어 **5곳** 전부:

```sql
AND (
  p_gender IS NULL
  OR CASE
       WHEN p.gender IS NOT NULL AND cardinality(p.gender) > 0
         THEN p.gender && ARRAY[p_gender, 'unisex']
       WHEN pf.feature_metadata->>'gender' IS NOT NULL
         THEN pf.feature_metadata->>'gender' IN (p_gender, 'unisex')
       ELSE true
     END
)
```

동일 교체: `search_products_hybrid_v1.sql` (img/txt 두 kNN CTE),
`app/services/curation_refresh.py` `GENDER_MATCH_SQL` (`ELSE false` 유지 — 큐레이션은 의도적 fail-closed),
`app/api/products.py:150-157` (`p.gender` 우선, `ARRAY[NULL]` 되지 않게 `NULLIF` 가드).

- 두 `.sql` 은 `deploy.ai.sh` → psql 로 적용되고 선두 `DO` 블록이 모든 오버로드를 DROP 한다.
  시그니처 변경이 없으므로 **`DO` 블록은 그대로 둔다** (7/10 사고).
- `LEFT JOIN product_features pf` 는 **제거하지 않는다** — color 필터가 계속 쓴다.
- 헤더 독블록(`search_products_v6.sql` 상단, `search_service._resolve_gender` 독스트링)이
  "VLM 이 최종 상태"라고 서술 중 — 갱신.
- 테스트: `tests/test_auth/test_curation_gender_bridge.py`,
  `tests/test_arch_ai_001/test_search_rpc_contract_characterization.py`,
  `tests/test_search_precision_filters.py`.

---

## P2 — 크롤러 코드 복원

### 2.1 통째 복원 (`git show 1febe76^:<path>`)

| 파일 | 조정 |
|---|---|
| `src/lib/product-gender.ts` | `isSingleGenderScope` 및 `resolveProductGenderWithSource` 의 `brand_scope` 분기·`brandGenderScope` 파라미터 삭제. JSDoc 우선순위를 8단 → 6단으로. **`GENDER_SOURCE_VALUES` 에서 `brand_scope` 는 남긴다** — 기존 DB 행이 그 값을 갖고 있어 타입이 파싱해야 한다. |
| `src/lib/gender-repair.ts` | `brand_single_gender` 버킷 삭제, `config_default` 버킷 추가 |
| `src/repair-product-gender.ts` | brand_nodes gender_scope fetch 및 brand-scope `--scope=` 삭제. `--plan`/`--apply` 2단계 유지 |
| `tests/product-gender.test.ts`, `tests/gender-repair.test.ts` | 해당 케이스 제외하고 복원 |

`sql/092/093/094` 크롤러 로컬 사본은 **복원하지 않는다** — 정본은 `kiko.ai-app/database/migrations/`
에 있고 이미 적용됐다.

### 2.2 기계적 복원 (드리프트 0, color 오염 0)

`git diff 1febe76^ 1febe76 -- <path> | git apply -R -3`

- **`src/configs/platforms.ts`** — `defaultGender` 59개 + 카테고리 `gender:` 266개.
  clean 적용 검증 완료. 적용 후 `multiBrand`/`brandFromNamePrefix` 플래그와
  `twojeys`/`jadedldn` 엔트리 생존 확인.
  후속 감사: `notes:` 에 `gender_scope=unisex` 근거가 달린 ~6개 사이트(:1322, :1580, :2368,
  :2402, :2414)는 결정 #5 위반 소지 — 실제 사이트 확인 후 유지하거나 `defaultGender` 삭제.
- **`src/lib/29cm-engine.ts`** — `WOMEN_L1_CODES`/`MEN_L1_CODES`, `genderFromCategoryCode()`,
  `RawTwentyninecmItem._gender`, `parseProductsFromDom` 4번째 인자
- **`src/lib/farfetch-engine.ts`** — `deriveGenderFromUrl()`, `parseProductsFromCards` genderHint
- **`src/lib/core/product-validator.ts`** — `gender: z.array(z.enum(PRODUCT_GENDER_VALUES)).min(1)`,
  `genderSource` optional. **color/description 은 복원 금지.** 헤더 독블록 갱신
  ("color 와 gender 는 이 게이트에서 빠졌다" → gender 만 회귀)

### 2.3 수동 복원

**`src/lib/cafe24-engine.ts`** (최대 작업) — `DiscoveredCategory.gender`,
`collectProductsFromPage` 의 `categoryGender` 파라미터와 in-page `products.push` 의
`gender`/`genderSource`, `crawlCategory` 의 전달, `crawlCafe24` 의 `config.defaultGender` 사용.
`evalArgs` 에 추가할 때 드리프트로 들어온 `brandPrefixPatternStr` 를 덮어쓰지 말 것.
**색상 관련(`extractColorFromText`, swatch 블록) 복원 금지. `detailFetchedAt` 마커 건드리지 말 것.**

*개선 (권장)*: `discoverCategories` 가 이미 카테고리 링크 텍스트를 `name` 으로 읽는다.
`inferGenderFromText(name)` 을 적용하면 `"WOMEN"` / `"여성 아우터"` 에서 진짜 카테고리별 근거를
`genderSource: "engine"` 으로 얻는다. `discovery: "auto"` 사이트에도 통해 config 방식보다 낫다.

**`src/lib/shopify-engine.ts`** — `ShopifyParseOptions.defaultGender`, 태그 기반 추론 블록,
`crawlShopify` 의 `defaultGender: config.defaultGender`.
드리프트 보존: `brand: options.brandOverride || sp.vendor || ...` 와
`brandOverride: config.multiBrand ? undefined : config.brand` (43675e1 하우스브랜드 강제).
**골든 마스터 위험**: `tests/shopify-parse.characterization.test.ts` 는 "재생성 금지" 골든인데
출력에 `gender` 가 붙으면 깨진다. → 재생성 + 팀 승인, 그리고 태그가 기여하지 않았을 때
`genderSource: "config_default"` 를 찍는다 (기존 코드는 이를 생략해 shopify gender 를 `engine`
으로 오귀속했고, 새 dedup rank 는 이 구분에 의존한다).

**`src/lib/uniqlo-engine.ts` / `zara-engine.ts`** — `mapGender()` 복원. 둘 다 `kids`/`baby` 를
반환하는데 `cleanGenderScope` 가 이를 `[]` 로 떨구고 `isKidsText` 가드가 성인 성별 세탁을 막는다.
이게 의도된 동작 — 테스트로 고정. zara 는 역적용 시 color 가 딸려오므로 수동.
uniqlo 는 `mapImages` 무제한 수집 드리프트 보존.

**`src/lib/imweb-engine.ts`** — `Pick<SiteConfig,...>` 에 `defaultGender` 추가,
`gender: [...(config.defaultGender ?? [])], genderSource: "config_default" as const`.
**`brand: config.brand || ""` 보존** (역적용이 `config.brand || config.name` 으로 되돌리지 않게).

**`src/crawl.ts`** (함정 A) — 복원: 엔진 import 2개(`genderFor29cm`, `deriveFarfetchGender`),
observability `emit`, `probeSite` 의 `it._gender`, farfetch gender 인자, `writeProductsFile` 의
결의 루프(brandGenderScope 없이), `gender 출처` 요약 로그, `lintGenderConfig`.
**복원 금지**: `loadBrandGenderScopeForPlatform` / `getBrandGenderScopeForPlatform` /
`brandGenderScopeCache` (결정 #1).
**되돌리기 금지**: `detailFetchedAt` 마커, `--allow-multibrand` 블록.

### 2.4 INSERT 경로 1 — `src/import-products.ts`

제거 전 코드는 그대로 재적용 불가 (`SELF_BRANDED` 가 없어지고 브랜드 해석이
`resolveProductBrand(p.brand, config)` / `src/lib/brand-provenance.ts` 로 바뀜).

1. `CrawledProduct` 에 `gender: string[]`, `genderSource?: string` 추가
2. `loadBrandNodes()` **변경 없음** — `gender_scope` 를 select 하지 않고 `genderById` 도 만들지 않는다
3. `applyProductQcGate` 앞에 결의 패스 삽입 — `resolveProductGenderWithSource(p.gender,
   {name, category, subcategory, tags, productUrl}, p.genderSource ?? "engine")`.
   `description` 은 `CrawledProduct` 에 없으므로 evidence 에서 제외
4. row mapper: `const gender = cleanGenderScope(p.gender)`, `gender_source`,
   그리고 `if (gender.length === 0) { genderSkipped++; return null }` —
   기존 `if (!brand) return null` **뒤에** 배치해 스킵 카운터 비교가 가능하게
5. dedup merge `GENDER_SOURCE_RANK` 복원, **`brand_scope` 제외**:
   `{engine: 5, url: 4, text: 3, llm: 2, config_default: 1}`
   (migration 095 가 문서화한 의도 순서). `genderWinner` 클로저와 `gender_merge_conflict` emit 복원
6. `--dry-run` 계측 **재작성** (P0 참조)

### 2.5 INSERT 경로 2 — `refresh-candidates.ts` (함정 B, 가장 위험)

- `src/lib/refresh-candidate-import.ts`: `if (!selected.gender.length) throw ...` 가드와
  `gender` / `gender_source` 키 복원. **color 는 복원 금지.**
- `src/refresh-candidates.ts` `importCandidate`: `candidate.raw_product` 에 엔진 gender 가
  실려 오지만 `enrichProductWithLlm` 은 gender 를 만들지 않는다.
  `enrichProductWithLlm` 과 `applyProductQcGate` 사이에 결정론적 결의를 넣고,
  미해결 시 **`PermanentCandidateError`** 로 던진다 (일반 `Error` 면 `maxAttempts` 까지
  같은 후보를 무한 재시도한다).
- *후속 (P2 아님)*: `EnrichmentSchema` 에 `gender` 추가 + `gender_source: "llm"`.
  migration 095 가 `llm` 을 이미 허용한다. P0 이 드랍량을 알려준 뒤 판단.

### 2.6 타입 / QC

- `src/lib/types.ts`: `Product.gender: string[]`(필수), `Product.genderSource?: GenderSource`,
  `CategoryConfig.categories?: {name; cateNo; gender?: string[]}[]`, `SiteConfig.defaultGender?: string[]`.
  **`detailFetchedAt` / `sourceImageUrl` / `imageSelection` / `multiBrand` 제거 금지.
  `description` / `color` / `colorSource` 복원 금지.**
- `src/lib/product-qc/normalization.ts`: `field` 유니온에 `"gender"` 복귀,
  `ProductQcInput.gender`, `normalizeGenderField()` 와 `normalizeProductTextFields` 배선.
  **`COLOR_RULES`/`normalizeColorField` 등 ~470줄 복원 금지.**
  `normalizeGenderField` 는 `gender_missing` 시 `needsReview: true` 를 반환해
  `applyProductQcGate` 가 상품을 드랍한다 — row-mapper 가드 위의 2중 게이트이고
  `refresh-candidates.ts` 에서도 작동한다. 유지.
  `inferGenderFromText` 입력에서 `product.description` 제외 (필드 없음).
- `src/lib/core/observability.ts`: **변경 없음.** `GenderSourceConflictEvent`(:60)와
  `GenderMergeConflictEvent`(:69)가 이미 정의되어 있고 union(:80-81)에도 들어있다. emit 만 돌아온다.

### 2.7 `src/import-brand-nodes.ts` (결정 #4)

`:86` 의 `parseCSV(r.gender_scope)` → `cleanGenderScope(parseCSV(r.gender_scope))`.
`:124-125` 통계 블록이 정크를 임의 키로 만들지 않고 `unknown` 으로 올바르게 분류하게 된다.

> 범위 외 발견: `:160-180` 이 migration 081 에서 DROP 된 `products.style_node` 를 UPDATE 한다.
> 죽은 코드이며 에러를 낸다. 별도 이슈로 분리.

### 2.8 config 전략 (수율 절벽 해소)

- **`platforms.ts`**: 전량 복원 (§2.2)
- **`platforms.generated.ts`**: **아무것도 복원하지 않는다** (57% 가 unisex 기본값 세탁)
- **`tools/generate-platform-configs.ts`**: `CandidateRow.categories` 의
  `gender?: string[]` 타입만 복원(복원된 `CategoryConfig` 와 타입 체크용).
  `c.gender?.length ? c.gender : ["unisex"]` 방출과 imweb `defaultGender` 유도는 **삭제**.
  → 생성 결과는 오늘과 동일, 7,718줄 재생성 불필요.
- **신규 `src/configs/gender-defaults.ts`**: 손으로 관리·리뷰되는
  `Record<platformKey, ProductGender[]>`. `getSiteConfig()` 에서 config 에 `defaultGender` 가
  없을 때만 병합. ~262개 생성 사이트의 절벽을 막는 장치.
- **신규 `tools/propose-site-gender.ts`** (read-only): 플랫폼별로 **2026-07-30 이전** `products`
  행의 gender 분포를 출력. `noah-ny` 주석이 인용한 "기존 DB 634행 실측: men=634" 와 같은 근거다.
  **50행 이상이고 한 성별이 95% 이상**일 때만 기본값을 제안하고 나머지는 리뷰 목록으로.
  근거도 없고 우세 성별도 없는 사이트는 기본값 없이 둔다 — 그 상품들은 드랍된다.
  결정 #5 에 부합하는 올바른 결과다.

---

## P3 — 연구실 서버 배포

`kjk@100.70.101.17`, `/home/kjk/kiko-crawler`, branch `dev`, systemd **user** 유닛.

1. `dev` 머지 → 서버에서 pull → 빌드
2. `systemctl --user restart kiko-refresh.timer`
3. soak: 최소 2 사이클(30분) 동안 `journalctl --user -u kiko-refresh-candidates` 에
   gender 관련 에러 0, 신규 INSERT 가 gender 를 실어 들어가는지 확인
4. **검증 없이 P5 로 넘어가지 않는다**: `git -C /home/kjk/kiko-crawler log -1` 이 새 커밋인지,
   `systemctl --user status kiko-refresh-candidates` 가 정상인지 육안 확인

---

## P4 — 백필

### `103_products_gender_cleanup.sql` (멱등, 재실행 가능)

```sql
BEGIN;

-- (a) dirty 822행: canonical 밖 토큰 제거 (kids 351 / unknown 301 / baby 170).
--     091 의 CHECK 이 NOT VALID 라 들어온 값들이다.
UPDATE products
SET gender = NULLIF(
      ARRAY(SELECT DISTINCT g FROM unnest(gender) g
            WHERE g IN ('men','women','unisex')),
      '{}')
WHERE gender IS NOT NULL
  AND NOT (gender <@ ARRAY['men','women','unisex']::text[]);

-- (b) 빈 배열 / NULL 원소 → NULL. (a)+(b) 후 상태는 정확히 둘 뿐:
--     유효한 비어있지 않은 배열, 또는 NULL. NULL 은 repair 스크립트가 담당한다.
UPDATE products
SET gender = NULL
WHERE gender IS NOT NULL
  AND (cardinality(gender) = 0 OR array_position(gender, NULL) IS NOT NULL);

COMMIT;
```

감사 쿼리 (기대: dirty 0):
```sql
SELECT count(*) FILTER (WHERE gender IS NOT NULL
         AND NOT (gender <@ ARRAY['men','women','unisex']::text[])) AS dirty,
       count(*) FILTER (WHERE gender IS NULL) AS still_null
FROM products;
```

### repair 스크립트 실행

`pnpm tsx src/repair-product-gender.ts --plan` → 결과 검토 → `--apply`.
`--use-description` 은 **끈 채로** (기본값). 스크립트 독블록의 경고대로
`products.description` 은 2000자 마케팅/사이즈표 slice 라 "여성 사이즈 참고" 같은 문구가
대량 오판을 낸다.

`still_null` 이 0 이 될 때까지 반복. 남는 잔여분 처리는 §리스크 참조.

---

## P5 — `104_products_gender_required.sql`

**전제**: §P4 감사에서 `dirty = 0` **그리고** `still_null = 0`.

```sql
BEGIN;

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_gender_required;
ALTER TABLE products ADD CONSTRAINT chk_products_gender_required
  CHECK (
    gender IS NOT NULL
    AND cardinality(gender) > 0
    AND array_position(gender, NULL) IS NULL
    AND gender <@ ARRAY['men','women','unisex']::text[]
  ) NOT VALID;

COMMENT ON COLUMN products.gender IS
  'gender 태그 배열 (men/women/unisex). 출처는 크롤러 write-path
   (import-products.ts / refresh-candidates.ts). 096 의 DEPRECATED 표기는 철회 —
   VLM(product_features.gender) 성능 미달로 2026-08 크롤러 회귀.';

COMMIT;

-- 락 창을 짧게 유지하기 위해 트랜잭션 밖에서 검증 (093 패턴).
ALTER TABLE products VALIDATE CONSTRAINT chk_products_gender_required;
```

`NOT VALID` + 별도 `VALIDATE` 가 중요하다(~154k행): `ADD CONSTRAINT` 단독은 전체 스캔 동안
`ACCESS EXCLUSIVE` 를 잡지만 `VALIDATE` 는 `SHARE UPDATE EXCLUSIVE` 만 잡는다.
**적용 후 `convalidated = 't'` 확인** — 091 이 건너뛴 그 단계가 dirty 822행의 원인이다.

> 별건: `product_features` 의 `chk_pf_gender_vocab`(095)도 여전히 NOT VALID. 임계 경로는 아님.

---

## P6 — RPC 하드 필터 (VALIDATE 성공 후에만)

v6 5곳 + hybrid 2곳을 단일 단으로 축약:
```sql
AND (p_gender IS NULL OR p.gender && ARRAY[p_gender, 'unisex'])
```
`chk_products_gender_required` 가 VALIDATE 되어 `p.gender` 가 non-NULL·non-empty 를 보장하므로
`&&` 가 NULL 을 낼 수 없다. **pf 단은 완전 제거, fail-open 제거.**

`curation_refresh.py`:
```python
GENDER_MATCH_SQL = """
        %(gender)s = ANY(p.gender) AND NOT ('unisex' = ANY(p.gender))
"""
```
`products.py` 는 `p.gender` 단순 참조.

**`LEFT JOIN product_features pf` 는 유지** — color 필터와 품질 게이트가 계속 쓴다.

---

## P7 — 정리

- `package.json:29` `repair:product-gender` — §2.1 로 복구됨
- `package.json:31,32` `repair:product-color`, `repair:product-color-llm` — 대상 파일이 영구히
  없어졌다(color 는 VLM 유지). **두 줄 삭제.**
- `tools/product-extraction-poc.ts` — gender 경로(`normalizeGender` 등)는 이제 다시 옳다.
  `:86-87`, `:212` 의 상충하는 주석 삭제하고, 사설 복사본 대신
  `product-gender.ts` 의 `normalizeGenderToken` 을 쓰게 변경
- `crawler/CLAUDE.md` §18 gender 문단(`:480-486`) 과 `deploy/lab-server-migration.md` — 둘 다
  VLM 이관을 목표 상태로 서술 중. 갱신
- `.moai/plans/price-gender-null-wiggly-wombat.md` (untracked) — 이 계획으로 대체됨, 정리

---

## 테스트

**복원 (조정)**: `tests/product-gender.test.ts` (brand-scope/`isSingleGenderScope` 케이스 제외),
`tests/gender-repair.test.ts` (`brand_single_gender` 제외)

**기존 stale 픽스처 (이미 `defaultGender` 를 들고 있어 타입이 다시 맞는다)**:
`tests/imweb-engine.test.ts:13`, `tests/parser-strategy.test.ts:113` — 방출된
`gender`/`genderSource` 를 단언하도록 확장

**승인 후 재생성**: `tests/shopify-parse.characterization.test.ts` 골든,
`tests/fixtures/uniqlo-kr-parse.golden.json`, `tests/fixtures/detail/*.golden.json`
(`ProductSchema` 에 `gender ... min(1)` 이 돌아오면 gender 없는 골든 상품이 전부 실패)

**신규 (핵심)**:
1. `productToCandidateDbRow` 가 `gender: []` 에서 **throw** 하고 성공 시 `gender`/`gender_source`
   를 방출 — color 사고의 회귀 테스트
2. import-products row mapper 가 `gender.length === 0` 에 `null` 반환;
   `GENDER_SOURCE_RANK` 병합이 `url` 을 `config_default` 보다 우선하고 rank 가 다르면
   `['men','women']` union 을 절대 만들지 않음; 동순위 불일치에서만 `gender_merge_conflict` emit
3. `resolveProductGenderWithSource` 가 kids 전용 상품에 대해 `config_default` 가 설정돼 있어도
   `{gender: [], source: null}` 반환 (`isKidsText` 가드가 config 기본값보다 먼저)
4. uniqlo `genderName: "KIDS"` / zara `sectionName: "KID"` 가 성인 성별을 만들지 않음
5. cafe24 `discoverCategories` 가 `"WOMEN"` 링크 텍스트에서 `["women"]` 유도 (§2.3)
6. `normalizeGenderField` 가 gender 부재 + 텍스트 신호 없음에서 `action: "review"` 반환

---

## 리스크

| 리스크 | 규모 | 완화 |
|---|---|---|
| 하우스브랜드 자사몰 대량 드랍 | **실측 ~90%** (drakes 1816→177, noah-ny 634→66, cpfm 9→0) | §2.2 `platforms.ts` 복원 + §2.8 `gender-defaults.ts` + §2.3 cafe24 카테고리명 추론. **P0 숫자로 게이트** |
| 262개 생성 config 사이트는 카테고리명이 `"CatN"` — 신호 0 | P0 전까지 미지, 카탈로그 최대 슬라이스 가능 | `tools/propose-site-gender.ts` 로 07-30 이전 DB 분포에서 유도. 우세 성별 없으면 드랍 수용 |
| 연구실 refresh 워커가 전량 INSERT 실패 | P5 가 P3 보다 앞서면 **확정**, 15분 주기 | P3 → P5 순서 절대 준수 + §P3 육안 검증 |
| 07-30 이후 NULL 행이 검색에서 소실 | fail-open 을 일찍 제거할 경우만 | fail-open 은 P1~P5 유지, P6 에서만 제거 (VALIDATE 성공 게이트) |
| 백필 후에도 성별 미해결로 남는 행 | P4 잔여분 — `VALIDATE` 를 막는다 | (i) 리뷰된 기본값 + `gender_source='unverified_legacy'`, 또는 (ii) 삭제. **복원되는 `repair-product-gender.ts` 는 DELETE 를 명시적으로 거부한다** (크롤러 DB 롤에 권한 없음, `products` 가 `product_embeddings`/`product_reviews` 로 cascade). 삭제는 스크립트가 아니라 리뷰된 admin 런북으로 |
| shopify 골든 마스터 파손 | `parseShopifyProducts` 에서 확정 | 승인 하에 재생성. "재생성 금지" 주석은 `genderSource` rank 의존이 생기기 전 것 |
| 095 가 불허하는 `gender_source` 값 기록 | 낮음 | `repair_config_default` 같은 신규 값을 만들지 말고 `config_default` 재사용 |
| repair 스크립트가 description 으로 대량 오판 | 실재 (스크립트 독블록의 경고) | `--use-description` 기본 off 유지 |

---

## 검증

**P0**: `pnpm tsx src/import-products.ts --dry-run` — 플랫폼별 `resolved/total` 과 출처
히스토그램. `platforms.ts`/`gender-defaults.ts` 전후 비교.

**P2**: `pnpm tsc --noEmit` clean, `pnpm test` 전량 통과 (골든 재생성분은 승인 후).

**P3**: 연구실 서버에서 2 사이클 soak. 신규 INSERT 행에 `gender`, `gender_source` 존재 확인:
```sql
SELECT gender_source, count(*) FROM products
WHERE created_at > now() - interval '1 hour' GROUP BY 1;
```

**P4**: `dirty = 0 AND still_null = 0` 감사 쿼리 통과.

**P5**: `SELECT convalidated FROM pg_constraint WHERE conname='chk_products_gender_required';`
→ `t`.

**P6**: 남성/여성 쿼리로 검색 스모크 — 여성 상품이 남성 결과에 새지 않는지,
`test_curation_gender_bridge.py` 포함 ai-server 테스트 통과.

---

## 이번 범위에서 제외

- `brand_nodes.gender_scope` 데이터 자체의 교정 (결정 #1 로 임계 경로에서 제외됨).
  §2.7 의 입력 정규화만 들어간다. 감사·수정 UI 는 별도 작업
- color 관련 일체 — VLM/product_features 유지
- `import-brand-nodes.ts:160-180` 의 죽은 `products.style_node` UPDATE (별도 이슈)
- `EnrichmentSchema` 에 LLM gender 추가 (P0 측정 후 판단할 후속)

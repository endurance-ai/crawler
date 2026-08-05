---
name: daily-onboard
description: >
  Detects new cafe24/shopify/imweb brands with a homepage_url and KR-market
  eligibility, then picks the N most recently status-updated
  tech_detected/qc_failed candidates (not yet crawled/imported, or previously
  low-yield and eligible for retry) from brand_nodes/product_crawl_status and
  runs them through the hybrid onboarding pipeline (crawl incl.
  crawler-resolved single-value gender + LLM category/subcategory
  classification + import + category guardrail + price/brand anomaly report).
  Live DB reads/writes and external site crawling — confirm scope with the
  user before running.
license: Apache-2.0
compatibility: Designed for Claude Code
allowed-tools: Bash, Read
user-invocable: true
disable-model-invocation: true
metadata:
  version: "1.2.0"
  category: "workflow"
  status: "active"
  updated: "2026-08-05"
  tags: "onboarding, crawl, hybrid, brand-nodes, daily"
  argument-hint: "[limit]"
---

# daily-onboard

매일 한 번, `brand_nodes`(`wiki.homepage_url` 보유)에서 아직 수집 안 된 브랜드 중
`status='tech_detected'`(플랫폼 감지는 끝났지만 크롤/적재 전)이고 **KR-market
eligibility가 확인된**(`eligible_origin`/`eligible_storefront`) 것을 `status_updated_at`
최신순으로 N개 뽑아 hybrid 파이프라인으로 온보딩한다. 매번 다른 프롬프트로 즉흥적으로
지시하던 것을 스킬 하나로 고정해 일관성을 확보하기 위해 만들었다 (2026-07-22, crawler
브랜드/가격 데이터 정합성 세션에서 확정).

## 실행

```
!bash tools/daily-onboard.sh --limit ${1:-5}
```

`$1`(첫 인자)로 오늘 처리할 브랜드 수를 받는다 — 생략 시 5개.

## 결과 보고 [HARD]

실행이 끝나면 결과 요약(처리된 브랜드, 크롤/적재 건수, 이상치 리포트, 스킵/재시도
현황 등)은 **반드시 한글로** 작성한다. 영어로 요약하지 않는다 (2026-07-23,
다른 터미널/세션에서 실행해도 항상 한글로 나와야 한다는 사용자 지시 확정 —
세션별 메모리에 의존하지 않도록 이 스킬 본문에 직접 명시).

## 파이프라인 단계

1. **detect** (`src/brand-crawl.ts detect`, 한 실행에 **4번** 호출) —
   `homepage_url`이 있는 브랜드의 플랫폼(cafe24/shopify/imweb)과 **KR-market
   eligibility**를 함께 판정한다. `--country=KR` 선필터는 없어졌다 (2026-08-04,
   `4180d7b feat(crawl): detect KR-market eligibility for non-KR-origin
   storefronts`) — 해외 원산지라도 한국 locale/Shopify Market에서 실제 variant
   KRW 가격이 확인되면(`eligible_storefront`) 온보딩 대상이 된다. 4번의 호출은
   각각 다른 풀을 훑는다:
   - `--status=not_started --eligibility-status=unchecked` — 신규 브랜드.
     성공 시 `tech_detected`(실패 시 `blocked`)로 승격.
   - `--status=tech_detected,qc_failed --eligibility-status=unchecked
     --preserve-status` — migration 103 이전부터 후보 풀에 있던 비KR 브랜드는
     eligibility만 `unchecked`로 남아 있다. 이 풀을 하루 `--detect-limit`개씩
     소화해야 기존 해외 후보가 새 모델로 유입된다. `--preserve-status`가
     워크플로 상태를 보존한다.
   - `--eligibility-status=retryable_error,inconclusive --eligibility-stale-days=1`
     로 신규(`not_started`)와 기존 상태(`tech_detected`~`blocked`)를 각각 한 번씩.
     DNS/timeout/봇차단은 "한국 미지원"의 근거가 아니므로 확정하지 않고, 하루
     지난 건만 재확인해 같은 brand_node를 매 실행 반복하지 않는다.

   `price_only`/`unsupported`/`inconclusive`는 자동 온보딩하지 않는다. 이 단계를
   건너뛰면 신규 브랜드가 절대 후보 풀에 들어오지 않고 같은 브랜드만 계속
   재시도하게 된다.
2. **generate-platform-configs** (`tools/generate-platform-configs.ts`) —
   `tech_detected` **및 `qc_failed`**(재시도 대상) 후보를 `platforms.generated.ts`에
   반영. cafe24 brand 필드 자동 채움, shopify `/cart.js` 기반 통화 실측 등
   2026-07-21에 검증된 안전장치 포함. `qc_failed`도 포함해야 하는 이유
   (2026-07-23 실측 버그): `tech_detected`만 조회하면 이미 한 번 시도돼
   `qc_failed`로 넘어간 브랜드의 config가 재생성 때마다 파일에서 빠져서, select
   단계가 재시도 대상으로 정확히 골라도 config가 없어 매번 "missing"으로 재발함
   (`dadakarada`/`noscouleurs`/`temporahaus`에서 확인).
   **범위 판정은 `shouldGeneratePlatformConfig`
   (`src/lib/platform-config-lifecycle.ts:24`) 하나뿐이다** — 신규 온보딩은
   `origin_country='KR'` **또는** `kr_eligibility_status` 가 `eligible_origin`/
   `eligible_storefront` 여야 통과한다(예전의 "KR만"이 아니다). 이미 데이터를
   만든 config(`crawled`/`imported`/`embedded`/`active`)는 나중에 origin 메타데이터가
   바뀌어도 살아남고, `blocked`는 삭제하지 않고 disabled 항목으로 방출한다 —
   config 인벤토리와 브랜드 온보딩 상태는 다른 생명주기다.
   `eligible_storefront`인 사이트는 `baseUrl`이 홈페이지가 아니라 **검증된 KR
   스토어프론트 URL**로 박힌다. 후보가 소진되면(`select-onboard-batch.ts`가 "선정
   브랜드 없음" 경고) 이 스코프를 넓힐지 사용자에게 확인할 것 — 자동으로 넓히지 않는다.
3. **select** (`tools/select-onboard-batch.ts`) — `status`가 `tech_detected`(신규) 또는
   `qc_failed`(재시도 대상)이고 `kr_eligibility_status`가 `eligible_origin`/
   `eligible_storefront`인 브랜드를 `status_updated_at` 내림차순으로 `--limit`개
   골라 `getSiteConfig()`의 **완전한** config를 그대로 복사해 `onboard-batch.sh
   --configs`용 JSON을 만든다. 절대 `{key}`만 있는 stub을 쓰지 않는다 —
   `product-extraction-poc.ts`가 `POC_EXTRA_BRANDS`를 `getSiteConfig()`보다 우선
   적용해서, stub을 넘기면 `type`/`baseUrl`이 사라져 크롤이 전량 0건으로 실패한다
   (2026-07-21 실측 사고, `.moai/plans/velvet-toasting-star.md` 참조).
   `qc_failed` 브랜드는 `product_crawl_runs`(stage='import')를 최근 실행부터
   역순으로 훑어 **가장 최근 success 직후부터의 연속 실패**만 세고, 3회 이상이면
   건너뛴다(`MAX_IMPORT_RETRIES`) — 영구히 깨진 사이트에 LLM 비용을 무한정
   태우지 않기 위함. 누적 실패가 아니라 연속 실패라 한 번 성공하면 카운터가
   리셋된다.
   **알려진 갭: imweb은 여기서 선정되지 않는다.** 2번 단계는 imweb config를
   만들지만(`generatedPlatformType`이 `platform_type='custom'` +
   `detection.platform_family='imweb'`을 imweb으로 매핑), 이 select는
   `platform_type in ('cafe24','shopify')`로 조회하고 뷰에는 imweb이 `custom`으로
   저장돼 있어 매칭되지 않는다. imweb 브랜드를 태우려면 `onboard-batch.sh
   --configs`에 수동으로 넘겨야 한다.
4. **onboard-batch --variants hybrid** — 크롤(existing) + LLM 카테고리/subcategory
   분류(hybrid) + import(`--no-new-brands` 아님, 신규 브랜드 자동 등록) +
   `reclassify-categories.ts --only-invalid` guardrail까지 한 번에 실행.
   **색상/설명/성별은 hybrid LLM 분류 대상이 아니다** —
   `tools/product-extraction-poc.ts`의 `ClassificationSchema`(:214)는
   category/subcategory 두 필드만 남아있다. **color**는 VLM(`product_features`)이
   단일 출처(2026-07-29 이관, §18)이고 description은 소비처가 없어 폐기됐다.
   **gender는 2026-08-03 크롤러로 회귀**했다 — LLM 분류가 아니라
   `resolveProductGenderWithSource`(engine→url→text→config_default, §18)가
   만들고 import가 그대로 `products.gender`에 싣는다. 온보딩에 걸리는 성별 계약은
   세 가지다:
   - **값은 항상 단일값이다** (2026-08-05, migration 105). `import-products.ts:639`
     이 `cleanGenderScope(p.gender).length !== 1`인 상품을 적재에서 제외한다.
     이 가드 없이 105가 걸린 DB에 적재하면 `chk_products_gender_required`가
     INSERT를 전량 거부한다 — 099 color 사고 패턴이다. **옛 크롤러 코드로 이
     스킬을 돌리지 말 것.**
   - **미확인은 적재하지 않는다.** `unisex`는 근거가 있을 때만 쓰고 "모름"에는
     절대 쓰지 않는다 — `search_products_v6`가 `p.gender && ARRAY[p_gender,
     'unisex']`로 unisex를 남녀 양쪽에 노출시키므로 세탁하면 여성 상품이 남성
     검색으로 샌다. 게이트는 이중이다(QC `normalizeGenderField` → needsReview,
     그리고 위 INSERT 가드).
   - **태그가 Men·Women 두 부서에 걸려 있으면 확인된 unisex다** — ⚠️ **아직 dev에
     없다.** `inferDualDepartmentFromTags`는 `fix/gender-rules-unify`
     (a6dd55a, 2026-08-05)에 있고 머지 전이다. shopify 편집샵이 같은 상품을 두
     부서에 올리는 경우를 근거로 잡으며, **태그만** 보고 상품명은 보지 않고
     (마케팅 카피가 부서 분류로 둔갑하는 것 방지), kids 가드가 이 규칙보다 먼저
     돈다. 머지 전까지 dev로 돌리는 온보딩은 이 상품들을 unisex로 확정하지 못해
     성별 미확정으로 스킵한다. 머지되면 이 경고 문구를 지울 것.

   import 로그의 `genderSourceCounts`와 성별 스킵 건수로 그날 판정 분포를 볼 수 있다.
   **QC 통과율이 낮으면 자동으로 재시도 대상이 된다**: `import-products.ts`가
   크롤 원본 대비 QC 게이트 통과 비율(`raw.length / rawAll.length`)을 계산해서
   50% 미만이면 상품이 일부 들어갔어도(`inserted>0`) `status='imported'`로 확정하지
   않고 `status='qc_failed'`로 남긴다 — 그래야 다음 실행의 select 단계(3번)가 다시
   집어서 재시도한다. (2026-07-22 추가 — 이전에는 부분 성공도 무조건 `imported`로
   찍혀서 영구히 재시도 후보에서 빠지는 문제가 있었다.)
5. **anomaly check** (`tools/check-onboard-anomalies.ts`) — 오늘 처리한 브랜드만 대상으로
   가격(KRW인데 1000원 미만/null 10%+), 브랜드(빈 문자열/name과 동일/spec 라벨 누출)
   이상 패턴을 검사해 `<out-root>/anomaly-report.log`에 남긴다. 색상 체크는 §18
   색상 VLM 이관(2026-07-29) 이후 이 스크립트에서 제거됐다 — products 테이블에
   해당 컬럼이 없다. **gender 이상치 체크는 여전히 이 스크립트에 없다**
   (2026-08-05 확인: 스크립트에 gender 참조 0건). `chk_products_gender_required`
   (migration 104 도입 → **105에서 `cardinality(gender)=1`로 축소**), QC의
   needsReview 게이트, `import-products.ts`의 단일값 가드가 write 시점에 빈/다중
   gender를 이미 막지만, "값은 있는데 틀린" 케이스(예: 특정 브랜드에서 unisex로
   쏠림)는 여기서 잡히지 않는다. **단계 5의 콘솔 출력이 "가격/브랜드/색상/성별
   이상 검사"라고 찍히지만 실제로 도는 것은 가격·브랜드뿐이다** —
   `tools/daily-onboard.sh`의 echo 문구가 갱신되지 않았다. 온보딩 직후 성별 분포가
   의심스러우면 해당 브랜드의 `products.gender` 분포를 수동으로 확인할 것.
   **원인 조사와 코드 수정은 자동화하지 않는다** — 오판으로 멀쩡한 데이터를
   망가뜨릴 위험이 있어, 이상 발견 시 그 리포트를 다음 Claude 세션에 붙여넣어 조사를
   요청하는 흐름을 상정한다. 스킬 실행 자체는 이상치가 있어도 실패로 끝나지 않는다
   (경고만 출력).

## 안전 참고사항

- **Lightpanda 엔진 미지원**: hybrid variant는 Chromium 엔진에서만 동작한다.
  Playwright가 Lightpanda의 부분 CDP 구현과 근본적으로 안 맞아 `page.goto`조차
  타임아웃난다(`.moai/plans/lightpanda-spike-report.md` 실측). `CRAWLER_CAFE24_ENGINE`
  env var를 건드리지 않으면 기본값(chromium)으로 동작한다.
- **저사양 코어 환경**: 브랜드당 페이지 로드 2번(existing 상세크롤 + hybrid 재방문) +
  LLM 호출 1번 구조라 브랜드 규모에 따라 느릴 수 있다. CPU가 지속적으로 높으면
  `tools/daily-onboard.sh`가 띄운 프로세스 트리를 찾아(`chrome-headless-shell.exe`,
  `node.exe` — `product-extraction-poc.ts`/`onboard-classify.ts` 커맨드라인으로 식별)
  종료해도 안전하다. 체크포인트(`data/<key>-products.json`)가 30개 상품마다 저장되므로
  재시작 시 이어서 진행된다.
- **실행 전 확인**: 라이브 DB에 상태(`product_crawl_status`)를 쓰고, `--no-new-brands`
  없이 import하므로 신규 브랜드가 `brand_nodes`/`products`에 자동 등록된다. 실행
  결과는 `<out-root>/onboard-tally.csv`와 `<out-root>/chunk-0-finalize.log`에서
  확인한다.
- **`--out-root`를 직접 지정할 땐 실행마다 고유하게**: 기본값은 이제
  `poc-runs/daily-<날짜>-<시분초>`라 같은 날 여러 번 돌려도 안전하지만, `--out-root`를
  손으로 고정해서 넘기면 두 번째 실행이 첫 번째 실행의 `products.jsonl`을 재사용하는
  `onboard-batch.sh`의 "중단 후 재개" 로직에 걸려 이번에 새로 선정된 브랜드가 실제로는
  크롤되지 않고 0건으로 끝날 수 있다 (2026-07-23 실측: 같은 날짜 out-root를 재사용해서
  `en-5267`/`dadakarada`/`temporahaus`/`noscouleurs` 전부 크롤 스킵, 우연히 겹친
  브랜드 하나만 옛 데이터로 재적재됨). 정말 "같은 실행을 중단 후 재개"하려는 경우에만
  동일한 `--out-root`를 재사용할 것.

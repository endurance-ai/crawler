# Cafe24 hybrid variant: 상세페이지 중복 재방문 제거

## 배경 (Context)

오늘 진행한 12개 브랜드 재온보딩 작업(etce, bittercells, oheshio, nonblank, intheraw,
en-4821, burmula, beheavyer, thecoldestmoment, en-5267, plasticproduct, kindersalmon)에서
deterministic 전용 `existing` 크롤 대신 `existing,hybrid`로 전환했습니다 — LLM이 뽑아주는
category/subcategory/color/description/gender가 `crawl.ts`의 QC "review" 버킷에서 통째로
버려지지 않도록 하기 위해서였습니다 (`tools/onboard-classify.ts`,
`tools/reclassify-categories.ts --only-invalid`, 이번 세션에서 `tools/onboard-batch.sh`에
추가한 `--variants` 플래그).

`runHybridVariant`(`tools/product-extraction-poc.ts:852-928`)를 보다가, 사용자가 두 가지를
질문했습니다: (1) hybrid가 왜 existing 단계에서 이미 로드한 DOM을 재사용하지 않고 상세페이지를
두 번째로 재방문하는지, (2) `llm-scraper`가 cafe24 전용인지.

**이번 세션에서 조사로 확인한 사실:**

- `runHybridVariant`는 플랫폼에 무관합니다 — 범용 `SiteConfig` + `Product[]`를 받고
  `product.productUrl`만 필요로 하므로 `cafe24`/`shopify` config 둘 다에서 동작합니다
  (`tools/product-extraction-poc.ts:424-449`의 `existing`은 `config.type`으로 분기하지만
  hybrid는 신경 안 씀).
- **중복 방문 문제는 cafe24에만 해당합니다.** `src/lib/shopify-engine.ts`는 Playwright를
  전혀 안 쓰고 `/products.json`에 순수 `fetch()`만 합니다. shopify config에서는 hybrid의
  `page.goto()`가 유일한 브라우저 방문이지 중복이 아닙니다. cafe24의 `existing` 단계는
  `config.crawlDetails`가 true면 이미 `crawlCafe24` 자체 상세크롤 루프
  (`src/lib/cafe24-engine.ts:757-878`) 안에서 Playwright로 상세페이지를 한 번 엽니다 —
  그런데 hybrid는 같은 URL을 완전히 새로운
  `browser = await chromium.launch(...)` 인스턴스로 (`tools/product-extraction-poc.ts:865`)
  또 열어서 그 살아있는 페이지를 `LLMScraper.run(page, ...)`에 넘길 뿐입니다.
- 왜 재방문하는가: `crawlCafe24`는 추출된 필드(`Product[]`)만 반환하고 raw HTML은 버립니다.
  hybrid가 돌 때쯤엔 existing 단계에서 쓴 `Page` 객체들은 이미 닫혔거나 다른 URL로 넘어간
  뒤입니다. `LLMScraper.run()`(`llm-scraper@2.0.0`,
  `node_modules/.pnpm/llm-scraper@2.0.0_zod@4.4.3/.../dist/index.d.ts`)은 `page` 파라미터를
  진짜 `import('playwright').Page` 타입으로 명시합니다 — 지금 쓰는 `format: "custom"` +
  `formatFunction` 조합에서는 실제로 그 페이지에 `.evaluate()`만 호출하지만
  (`readCompactContext`, `tools/product-extraction-poc.ts:812-844`), 그래도 런타임에는
  "질의 가능한 살아있는 페이지"가 필요하지 캐시된 문자열로는 안 됩니다.
- 해결 방향: `crawlCafe24`의 기존 상세크롤 루프는 상품마다 deterministic 파싱을 하는 그
  순간에 이미 살아있는 페이지(`pg`)를 들고 있습니다
  (`src/lib/cafe24-engine.ts:794-820`, `detailParser.parse(pg, product.productUrl)` 호출 —
  페이지가 `about:blank`로 리셋되거나 다음 상품으로 넘어가기 전). 여기가 LLM 보강을
  인라인으로 끼워넣기에 자연스러운 지점이고, cafe24에 한해 두 번째 네비게이션을 완전히
  없앨 수 있습니다.
- 제약: 그 지점의 `pg`는 `Cafe24Page` 타입입니다(`src/lib/cafe24-page.ts:16-35`) — Chromium과
  Lightpanda 엔진이 추출 로직을 공유할 수 있도록 만든 좁은 구조적 인터페이스입니다. Chromium
  엔진(`createPlaywrightDetailPageFactory`, `src/lib/cafe24-engine.ts:129-160`)에서는 `pg`가
  런타임에 실제 Playwright `Page`로 뒷받침되므로 `LLMScraper.run()`에 캐스팅해서 넘겨도
  안전합니다.
  **Lightpanda는 이 훅을 절대 받을 수 없습니다 — 확정.** `.moai/plans/lightpanda-spike-report.md`
  (2026-07-07 macOS 스파이크 실측)에 이미 검증돼 있습니다: "Playwright(production 스택) +
  lightpanda = 실패 — `page.goto`/`page.evaluate`가 example.com에서도 20~60s 타임아웃/행.
  모든 사이트 재현." / "Puppeteer로만 정상 동작." `llm-scraper`의 `LLMScraper.run()`은 타입
  시그니처가 `import('playwright').Page`로 고정된 Playwright 전용 라이브러리라서, Lightpanda
  프로세스에 Playwright를 어떤 경로로 붙이든(`connectOverCDP` 포함) 근본적으로 막힌다.
  `cafe24-lightpanda.ts`가 Playwright가 아니라 `puppeteer-core`로 작성된 이유가 바로 이것.
  즉 인라인 훅뿐 아니라 기존 `runHybridVariant`의 재방문 방식으로도 Lightpanda+hybrid는
  동작하지 않는다 — Lightpanda 엔진에서는 hybrid variant 자체를 아예 지원 불가로 취급한다.

**이 리팩터링의 결과**: cafe24 hybrid 크롤이 상품당 "페이지 로드 2번 + LLM 호출 1번"에서
"페이지 로드 1번 + LLM 호출 1번"으로 줄어, hybrid 소요시간과 브라우저 리소스 사용량이 대략
절반이 됩니다 — 오늘 이 저코어 머신에서 CPU/hang 문제를 반복 겪은 것과 직접 관련이 있습니다.
shopify hybrid는 이미 단일 방문이라 손대지 않습니다.

## 설계 (Design)

### 1. `src/lib/cafe24-engine.ts` — 인라인 보강 훅 옵션 추가

`CrawlCafe24Options`(112-127줄)에 추가:

```ts
/**
 * Chromium 전용: deterministic 파싱 직후, 페이지가 리셋/재사용되기 전에
 * 살아있는 상세 페이지와 함께 호출된다. product-extraction-poc.ts의 hybrid
 * variant가 두 번째 네비게이션 없이 LLM 보강을 돌릴 수 있게 해준다.
 * Lightpanda 엔진에는 절대 넘기면 안 된다 — 그쪽 Cafe24Page는 진짜
 * Playwright Page가 아니라 llm-scraper가 요구하는 타입이 아니다.
 */
enrichDetailPage?: (page: Cafe24Page, product: Product) => Promise<void>
```

상세크롤 루프(794-820줄)에서 deterministic `detailParser.parse(pg, product.productUrl)`
성공 직후(`detailFallbacks` 계산 후, lease/페이지가 다음으로 넘어가기 전) 호출:

```ts
if (options.enrichDetailPage) {
  await options.enrichDetailPage(pg, product).catch(() => {})
}
```

상세크롤 루프의 나머지 부분과 동일하게 에러를 삼켜서, LLM 실패가 이미 뽑아둔
deterministic 필드까지 날리지 않도록 한다.

### 2. `tools/product-extraction-poc.ts` — 플랫폼 타입별로 hybrid 연결 분기

- `runHybridVariant`에 지금 인라인으로 박혀 있는 LLM 분류 조각들(`usageCapturingModel`,
  `ClassificationSchema`, `CLASSIFY_SYSTEM`, `readCompactContext`, `LLMScraper` 생성)을
  재사용 가능한 작은 함수로 뽑아낸다. 예: `classifyProductInline(page, product, model, stats)`.
- **cafe24 경로**: `options.variants.includes("hybrid")` && `config.type === "cafe24"` &&
  엔진이 `"chromium"`으로 해석될 때, `crawlCafe24Chromium(config, limit, detailParser)` 호출
  (`tools/product-extraction-poc.ts:404-422`)에 `enrichDetailPage: (page, product) =>
  classifyProductInline(page, product, ...)`를 넘기고, 이후 별도로 `runHybridVariant`를
  호출하지 않는다. `crawlCafe24`가 반환한 뒤, 이미 LLM으로 채워진 각 `Product`(category/
  subcategory/color/description/gender 포함)를 복제해서 `hybrid` 출력 행을 만든다 — 추가
  브라우저 작업 없음. `existing` 행도 지금처럼 같은 패스에서 계속 출력
  (`options.variants.includes("existing")` 게이트, `tools/product-extraction-poc.ts:1640-1646`)
  해서 `onboard-classify.ts`의 `ONBOARD_VARIANT=existing` vs `hybrid` 선택이 그대로 동작하게
  유지한다.
- **shopify 경로**: 그대로 유지 — 지금처럼 `runHybridVariant(config, matched, ...)`를 호출.
  이미 페이지 방문 1번이 최적이므로 손대지 않는다.
- **Lightpanda 엔진 경로**: hybrid 자체를 명시적으로 미지원 처리한다. `crawlCafe24WithLightpanda`로
  크롤되는 cafe24 config는 `enrichDetailPage`를 받지 않는 것은 물론, 기존 `runHybridVariant`
  재방문 방식으로도 폴백하지 않는다 — 스파이크 리포트로 이미 확정됐듯 Playwright가 Lightpanda의
  CDP 구현과 `page.goto`/`page.evaluate` 레벨에서 근본적으로 안 맞아 재방문 방식도 애초에
  동작하지 않는다. `engine === "lightpanda"`이고 `variants.includes("hybrid")`인 조합은
  명확한 에러(`"hybrid variant is not supported on the Lightpanda engine — see
  lightpanda-spike-report.md"`)로 즉시 실패시켜, 조용히 0건 크롤되는 대신 원인을 바로 알 수
  있게 한다.
- `runHybridVariant` 위 doc 주석(846-851줄)을 "shopify 전용 (cafe24는 인라인 훅으로 대체됨,
  Lightpanda는 hybrid 미지원)"으로 갱신하고, hybrid 동작을 일반적으로 설명하는 `Options:`
  사용법 텍스트가 있다면 같이 갱신.

### 3. 변경 불필요

- `tools/onboard-batch.sh`, `tools/onboard-classify.ts` — 이번 세션에서 이미
  `--variants`/`ONBOARD_VARIANT`를 받도록 고쳐뒀고, `products.jsonl`의 `hybrid` 행이 어떻게
  만들어졌는지는 신경 쓰지 않는다 (`variant === "hybrid"` 행이 기대 필드를 갖추고 있으면 됨).
- `src/lib/cafe24-lightpanda.ts` — 코드 변경 없음, 새 훅을 아예 받지 않게 둔다.

## 검증 (Verification)

1. `pnpm typecheck` — `Cafe24Page`/`enrichDetailPage` 타입 정합성, `product-extraction-poc.ts`
   재구성된 hybrid 연결부 컴파일 확인.
2. 소규모 실행: `bash tools/onboard-batch.sh --configs <단일-브랜드-json> --variants hybrid
   --out-root poc-runs/hybrid-inline-test`를 소규모 cafe24 카탈로그(예: `thecoldestmoment`,
   ~25개 상품, 오늘 `existing,hybrid` 실행에서 이미 정상 확인됨)로 돌려서 오늘의
   `poc-runs/reonboard-12-hybrid` 로그의 동일 브랜드와 비교:
   - 상세크롤 단계 소요시간이 대략 절반으로 줄어야 함.
   - `chunk-0/products.jsonl`에 `variant: "existing"`과 `variant: "hybrid"` 행이 둘 다
     여전히 존재하고, `hybrid` 행에 category/subcategory/color/description/gender가
     채워져 있어야 함 — 오늘 결과물과 같은 형태.
   - OpenAI usage(platform.openai.com/settings/organization/usage)에 예상되는 호출 수가
     여전히 찍혀야 함 (상품당 1회로 호출 수 자체는 동일 — 중복 페이지 네비게이션만 제거됨).
3. shopify hybrid에 영향 없는지 확인: 같은 소규모 테스트를 shopify 브랜드 config로 돌려서
   `runHybridVariant`의 출력 형태/소요시간을 리팩터링 이전 기준과 비교(동작 변화 없어야 함).
4. `pnpm test` 재실행으로 기존 cafe24-engine.ts 유닛 테스트
   (`tests/cafe24-engine-selection.test.ts`, `tests/cafe24-chain.test.ts`) 회귀 없는지 확인.

## 실행 시점

지금 돌고 있는 hybrid 배치(12개 플랫폼, `poc-runs/reonboard-12-hybrid`) 완료 후 착수한다.
그 백그라운드 프로세스는 이미 메모리에 코드를 로드해서 돌고 있으므로 소스 수정 자체는
안전하지만, 혼동을 피하기 위해 배치 완료 후 진행한다.

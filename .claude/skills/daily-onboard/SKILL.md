---
name: daily-onboard
description: >
  Detects new cafe24/shopify brands with a homepage_url and picks the N most
  recently status-updated tech_detected/qc_failed candidates (not yet
  crawled/imported, or previously low-yield and eligible for retry) from
  brand_nodes/product_crawl_status, then runs them through the hybrid
  onboarding pipeline (crawl + LLM category/color/description enrichment +
  import + category guardrail + price/brand/color/gender anomaly report).
  Live DB reads/writes and external site crawling — confirm scope with the
  user before running.
license: Apache-2.0
compatibility: Designed for Claude Code
allowed-tools: Bash, Read
user-invocable: true
disable-model-invocation: true
metadata:
  version: "1.0.0"
  category: "workflow"
  status: "active"
  updated: "2026-07-22"
  tags: "onboarding, crawl, hybrid, brand-nodes, daily"
  argument-hint: "[limit]"
---

# daily-onboard

매일 한 번, `brand_nodes`(`wiki.homepage_url` 보유)에서 아직 수집 안 된 브랜드 중
`status='tech_detected'`(플랫폼 감지는 끝났지만 크롤/적재 전)인 것을 `status_updated_at`
최신순으로 N개 뽑아 hybrid 파이프라인으로 온보딩한다. 매번 다른 프롬프트로 즉흥적으로
지시하던 것을 스킬 하나로 고정해 일관성을 확보하기 위해 만들었다 (2026-07-22, crawler
브랜드/가격 데이터 정합성 세션에서 확정).

## 실행

```
!bash tools/daily-onboard.sh --limit ${1:-5}
```

`$1`(첫 인자)로 오늘 처리할 브랜드 수를 받는다 — 생략 시 5개.

## 파이프라인 단계

1. **detect** (`src/brand-crawl.ts detect --status=not_started --url=present --country=KR`) —
   `status`가 없거나(`product_crawl_brands` 뷰에서 NULL은 `not_started`로 COALESCE됨)
   `not_started`이고, `homepage_url`이 있고, `wiki.origin_country='KR'`인 브랜드를
   대상으로 cafe24/shopify 여부를 감지해 `tech_detected`(또는 실패 시 `blocked`)로
   승격. `--country=KR`은 2026-07-23 추가 — generate-platform-configs.ts가 애초에
   KR만 config로 만들 수 있으므로, 해외 브랜드까지 detect해서 tech_detected로
   승격시켜봤자 다음 단계에서 영구히 스킵될 뿐이라 detect 낭비 + "config 없음"
   스킵 노이즈만 쌓였다 (실측: `status_updated_at` 최신순 50건 중 48건이 해외).
   이 단계를 건너뛰면 신규 브랜드가 절대 후보 풀에 들어오지 않고 같은 브랜드만
   계속 재시도하게 된다.
2. **generate-platform-configs** (`tools/generate-platform-configs.ts`) —
   `tech_detected` **및 `qc_failed`**(재시도 대상) 후보를 `platforms.generated.ts`에
   반영. cafe24 brand 필드 자동 채움, shopify `/cart.js` 기반 통화 실측 등
   2026-07-21에 검증된 안전장치 포함. `qc_failed`도 포함해야 하는 이유
   (2026-07-23 실측 버그): `tech_detected`만 조회하면 이미 한 번 시도돼
   `qc_failed`로 넘어간 브랜드의 config가 재생성 때마다 파일에서 빠져서, select
   단계가 재시도 대상으로 정확히 골라도 config가 없어 매번 "missing"으로 재발함
   (`dadakarada`/`noscouleurs`/`temporahaus`에서 확인).
   **범위 제약: `wiki->>origin_country = 'KR'`인 브랜드만 처리한다**
   (`tools/generate-platform-configs.ts:125`). detect 단계가 이제 `--country=KR`로
   선필터링하므로 이 갭은 대부분 안 생기지만, origin_country가 나중에 바뀌거나
   detect를 필터 없이 수동 실행한 경우를 대비해 이 단계도 여전히 KR만 통과시킨다.
   KR 후보가 소진되면(`select-onboard-batch.ts`가 "선정 브랜드
   없음" 경고) 이 스코프를 넓힐지 사용자에게 확인할 것 — 자동으로 넓히지 않는다.
3. **select** (`tools/select-onboard-batch.ts`) — `status`가 `tech_detected`(신규) 또는
   `qc_failed`(재시도 대상)인 브랜드를 `status_updated_at` 내림차순으로 `--limit`개
   골라 `getSiteConfig()`의 **완전한** config를 그대로 복사해 `onboard-batch.sh
   --configs`용 JSON을 만든다. 절대 `{key}`만 있는 stub을 쓰지 않는다 —
   `product-extraction-poc.ts`가 `POC_EXTRA_BRANDS`를 `getSiteConfig()`보다 우선
   적용해서, stub을 넘기면 `type`/`baseUrl`이 사라져 크롤이 전량 0건으로 실패한다
   (2026-07-21 실측 사고, `.moai/plans/velvet-toasting-star.md` 참조).
   `qc_failed` 브랜드는 `product_crawl_runs`(stage='import')에서 몇 번 시도했는지
   세어 3회 이상이면 건너뛴다(`MAX_IMPORT_RETRIES`) — 영구히 깨진 사이트에 LLM
   비용을 무한정 태우지 않기 위함.
4. **onboard-batch --variants hybrid** — 크롤(existing) + LLM 카테고리/subcategory/
   색상/설명 보강(hybrid) + import(`--no-new-brands` 아님, 신규 브랜드 자동 등록) +
   `reclassify-categories.ts --only-invalid` guardrail까지 한 번에 실행.
   **QC 통과율이 낮으면 자동으로 재시도 대상이 된다**: `import-products.ts`가
   크롤 원본 대비 QC 게이트 통과 비율(`raw.length / rawAll.length`)을 계산해서
   50% 미만이면 상품이 일부 들어갔어도(`inserted>0`) `status='imported'`로 확정하지
   않고 `status='qc_failed'`로 남긴다 — 그래야 다음 실행의 select 단계(3번)가 다시
   집어서 재시도한다. (2026-07-22 추가 — 이전에는 부분 성공도 무조건 `imported`로
   찍혀서 영구히 재시도 후보에서 빠지는 문제가 있었다.)
5. **anomaly check** (`tools/check-onboard-anomalies.ts`) — 오늘 처리한 브랜드만 대상으로
   가격(KRW인데 1000원 미만/null 10%+), 브랜드(빈 문자열/name과 동일/spec 라벨 누출),
   색상(null 30%+), 성별(빈 배열) 이상 패턴을 검사해 `<out-root>/anomaly-report.log`에
   남긴다. **원인 조사와 코드 수정은 자동화하지 않는다** — 오판으로 멀쩡한 데이터를
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

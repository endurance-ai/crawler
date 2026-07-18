# Lightpanda 검증 스파이크 (Cafe24 크롤링 경량화)

## Context

패션 브랜드 상품 크롤러가 Cafe24 사이트를 headless Chromium(Playwright)으로 병렬 크롤링하는데, 병렬을 돌리면 무겁고 오래 걸린다. Lightpanda(Zig 기반 경량 헤드리스 브라우저)가 문서상 "Chrome 대비 ~11배 빠르고 ~9배 적은 메모리"를 주장하므로, 이걸로 Cafe24 브라우저 크롤링을 경량화할 수 있는지 **실측으로** 판단하려 한다.

조사 결과 핵심 사실:

- **현재 스택**: Playwright `chromium.launch({headless:true})`, 사이트마다 독립 브라우저. CDP-connect 배선은 전무. Lightpanda는 `connectOverCDP`로만 구동 → launch를 connect로 바꿔야 함.
- **Lightpanda 동시성 제약 (결정적)**: 프로세스당 CDP 연결 1개 · context 1개 · page 1개. 현재 Cafe24 detail 단계는 하나의 browser에서 `browser.newContext()`를 3-way로 띄우므로(`src/lib/cafe24-engine.ts:613-621`) **그대로는 불가**. 동시성 N을 얻으려면 **lightpanda 프로세스를 N개** 띄워야 함.
- **JS 렌더링 커버리지가 미지수**: Lightpanda는 V8 JS + 자체 DOM 엔진, XHR/Fetch/DOM 지원하지만 Beta이고 "수백 개 Web API 미구현", 그래픽 렌더링 없음. Cafe24 목록은 `waitForTimeout`으로 "JS 렌더링 대기"를 하므로(`cafe24-engine.ts:471`) **실제로 렌더링되는지는 실측해야만 안다**. 이것이 go/no-go의 핵심 리스크.
- **범위 밖**: ZARA/Farfetch는 Akamai 우회로 실제 Chrome(`channel:"chrome"`) 필수 → lightpanda 대체 불가. Shopify/Uniqlo는 브라우저 없이 `fetch` → 애초에 무관. **대상은 Cafe24(활성 ~86개) + 29cm.**

목표: 코드 변경을 프로덕션에 섞지 않고, **버려도 되는 스파이크(POC)** 로 대표 Cafe24 사이트에서 lightpanda가 (1) 목록/상세를 실제로 뽑아내는지, (2) 메모리/속도가 Chromium 대비 얼마나 이득인지 측정해 데이터 기반 go/no-go 근거를 만든다.

## 산출물 범위 (사용자 확정)

- 검증 스파이크(POC + 벤치마크). 실제 마이그레이션은 결과 확인 후 별도.
- 대상: Cafe24 중심(+29cm). ZARA/Farfetch/Shopify/Uniqlo 제외.

## 접근 (Approach)

프로덕션 코드는 손대지 않는다. 새 스파이크 디렉터리 `src/spikes/` 에 독립 실행 파일을 만들고, **기존 크롤 로직을 최대한 재사용**해 "브라우저만 바꿨을 때" 순수 차이를 측정한다.

### 1. Lightpanda 바이너리 셋업

- macOS(darwin, 개발기) 지원됨. `scripts/install-lightpanda.sh` 로 공식 릴리스 바이너리를 `bin/lightpanda` 에 내려받아 실행권한 부여(설치 방식은 실행 시점 공식 문서 확인). `.gitignore` 에 `bin/lightpanda` 추가.
- 헬퍼 `src/spikes/lightpanda-proc.ts`: 주어진 포트로 `lightpanda serve --host 127.0.0.1 --port <p>` 프로세스를 spawn하고, ready(WS 엔드포인트 응답)까지 대기 후 `{ wsEndpoint, kill() }` 반환. **프로세스 = 동시 page 1개** 원칙을 캡슐화.

### 2. 재사용할 기존 자산

- `crawlCafe24(page, config, detailParser?, reviewParser?)` — `src/lib/cafe24-engine.ts:510`. 이미 **열린 page를 인자로 받으므로**, lightpanda `connectOverCDP` 로 얻은 page를 그대로 주입 가능(목록 단계 무수정 재사용).
- 타이밍 계측 필드 `listWaitMs`/`detailMs`/`detailNavCount`/`duration` (동 파일 :516-521, :727-730)와 `printTimingReport` (`src/crawl.ts:811`) — 그대로 재사용해 lightpanda/Chromium 수치 비교.
- 대표 대상 선정: `getActivePlatforms()` (`src/configs/platforms.ts:2207`) 에서 Cafe24 중 **`crawlDetails:true` 2개 + 목록전용 1개** 를 뽑는다(디테일 경로/목록 경로 둘 다 커버).

### 3. POC 실행기 `src/spikes/lightpanda-poc.ts`

CLI: `pnpm tsx src/spikes/lightpanda-poc.ts --engine=lightpanda|chromium --sites=key1,key2 [--detail]`.

- **엔진 추상화**: `getPage(engine)` — `chromium` 이면 `chromium.launch()` → context → page; `lightpanda` 이면 lightpanda 프로세스 1개 spawn → `chromium.connectOverCDP(wsEndpoint)` → 기본 context/page 획득.
- **Phase A (목록)**: 각 대상에 대해 `crawlCafe24(page, config)` 를 **detailParser 없이** 호출. → lightpanda가 Cafe24 목록 DOM을 렌더/추출하는지 + 상품 수를 Chromium 기준선과 대조.
- **Phase B (상세, `--detail`)**: 목록에서 얻은 상품 URL 5~10개에 대해, lightpanda는 **URL당 프로세스 1개**(작은 풀, 예: 4개 프로세스 = 4-way)로 detail parser 실행. `ctx.route(...route.abort())` 이미지 차단(`cafe24-engine.ts:620`)이 lightpanda Fetch 도메인에서 동작하는지도 검증(미지원 시 차단 없이 폴백).
- **계측**: 엔진별로 (a) 추출 상품 수·필드 채움율(name/price/color 존재율), (b) 벽시계 시간, (c) 프로세스 RSS 피크(`ps`/`process.memoryUsage` 폴링). 동일 대상·동일 동시성에서 Chromium과 1:1 비교.

### 4. 동시성 스케일 테스트

Lightpanda 프로세스 M개(예: 3 → 10 → 20)를 동시에 띄워 같은 목록 대상을 병렬 처리하고 **집계 메모리 vs Chromium 3-browser** 를 비교. "PARALLEL_LIMIT=3을 20~30으로 올릴 수 있는가"라는 실제 이득 레버를 정량화(현재 `PARALLEL_LIMIT`/`DETAIL_CONCURRENCY` 는 하드코딩 리터럴 `crawl.ts:515`, `cafe24-engine.ts:612`).

### 5. 스파이크 리포트

`.moai/plans/lightpanda-spike-report.md` 에 비교표(엔진 × 대상 × [상품수, 필드율, 시간, 메모리, 동시성])와 **go/no-go 권고** 작성. 판정 기준:

- **Go 조건**: lightpanda 상품 추출 수·필드율이 Chromium의 ~95%+ 이고, 동일 동시성 메모리가 크게 낮음(문서상 ~9x는 아니어도 실측 이득 유의미).
- **No-go 신호**: 목록/상세 DOM 미렌더(상품 0 또는 필드 대량 누락), 잦은 크래시, route.abort 미지원으로 이득 상쇄.
- Go일 경우 후속 마이그레이션 스케치(프로세스 풀 매니저로 `crawl.ts:688-726` 워커 교체, `browser.newContext()` 제거, env로 엔진/동시성 토글)를 리포트 말미에 개략만 남긴다(별도 작업).

## 수정/생성 파일

| 파일 | 성격 |
|------|------|
| `scripts/install-lightpanda.sh` | 신규 · 바이너리 설치 |
| `src/spikes/lightpanda-proc.ts` | 신규 · 프로세스 spawn 헬퍼 |
| `src/spikes/lightpanda-poc.ts` | 신규 · 벤치마크 실행기(버려도 되는 스파이크) |
| `.moai/plans/lightpanda-spike-report.md` | 신규 · 결과 리포트 + go/no-go |
| `.gitignore` | 수정 · `bin/lightpanda` 무시 |
| `package.json` | 수정(선택) · `spike:lightpanda` 스크립트 |

**프로덕션 크롤 경로(`src/crawl.ts`, `src/lib/cafe24-engine.ts`)는 이번 스파이크에서 수정하지 않는다.**

## 검증 (Verification)

1. `bash scripts/install-lightpanda.sh` → `bin/lightpanda` 실행 가능 확인(`bin/lightpanda --version`).
2. 기준선: `pnpm tsx src/spikes/lightpanda-poc.ts --engine=chromium --sites=<3개> --detail` → 상품수/시간/메모리 기록.
3. 대상: `--engine=lightpanda` 동일 명령 → 상품수/시간/메모리 기록.
4. 동시성 스케일 테스트 실행(M=3/10/20) → 집계 메모리 곡선 기록.
5. 두 엔진 산출 상품의 필드 채움율 대조(추출 정확도 회귀 없는지). 
6. `.moai/plans/lightpanda-spike-report.md` 의 비교표·권고가 위 수치로 채워졌는지 확인.

리스크 노트: (a) lightpanda가 Cafe24 테마 JS를 못 돌려 목록이 비면 즉시 no-go — 이 경우 "목록은 fetch+파싱으로도 되는지"를 리포트에 부수 관찰로 남긴다. (b) macOS 바이너리 크래시 잦으면 Linux(CI/서버)에서 재측정 권고. (c) POC는 소수 사이트 표본이므로 전량 일반화 금지 — 리포트에 표본 한계 명시.

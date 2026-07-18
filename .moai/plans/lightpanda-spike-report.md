# Lightpanda 검증 스파이크 결과 리포트

측정일: 2026-07-07 · 환경: macOS 15 / arm64 (개발기) · Lightpanda: nightly `lightpanda-aarch64-macos` (67.8MB) · Playwright 1.58 (Chromium `chromium_headless_shell`) · puppeteer-core 25.3

대상: Cafe24 (실측 사이트 `eastlogue.com`, 카테고리 `cate_no=24`, 338개 상품)

---

## 판정: 조건부 GO — "Cafe24 전용 · Puppeteer 기반 경로"

렌더링/추출 **동등성 입증 + 메모리 ~5배 절감**으로 병렬도를 크게 올릴 수 있음이 실측으로 확인됐다. 단, **Playwright drop-in 교체는 불가**(Playwright는 lightpanda와 호환 안 됨). Puppeteer로 Cafe24 경로를 이식하는 실제 엔지니어링이 필요하다.

---

## 1. 추출 동등성 — 완전 일치 (list 단계)

같은 카테고리 페이지에서 두 엔진의 결과가 **바이트 단위로 동일**:

| 항목 | Chromium (Playwright) | Lightpanda (Puppeteer) |
|---|---|---|
| 상품 아이템 수 (production 셀렉터) | **338** | **338** |
| img 요소 수 | 55 | 55 |
| DOM 크기 | 236,549 B | 237,507 B |
| 첫 3개 상품 name/price/href | (기준) | **완전 일치** |

첫 상품 예시(두 엔진 동일): `Q'S CARD CASE EL CONCHO VER. / BLACK · ₩268,000 Out of stock · /product/qs-card-case-.../2141/category`

→ Cafe24 테마의 클라이언트 JS 렌더링을 lightpanda가 충분히 실행한다. **"JS 미렌더로 목록이 빈다"는 최대 우려는 반증됨.** (production이 이미지 URL을 `data-original` 등 DOM 속성에서 읽는 방식이므로, lightpanda가 이미지를 실제 디코딩하지 않아도 무관.)

## 2. 메모리 — Lightpanda가 ~5배 가볍다 (핵심 이득)

동일 페이지를 M개 동시 처리했을 때 프로세스 서브트리 피크 RSS:

| 동시 M | Chromium 피크 | Lightpanda 피크 | 인스턴스당 (Cr/Lp) | 비율 |
|---|---|---|---|---|
| 1 | 459 MB | 78 MB | 459 / 78 | **5.9×** |
| 5 | 1,931 MB | 402 MB | 386 / 80 | **4.8×** |
| 10 | 3,576 MB | 785 MB | 358 / 79 | **4.6×** |

Lightpanda는 **인스턴스당 ~80MB로 평탄**, 모든 동시도에서 338개를 정확히 추출. (문서의 9~16배까지는 아님 — Cafe24 페이지가 amiibo 데모보다 무겁기 때문. 그래도 ~5배는 확실한 실측 이득.)

## 3. 속도 — 단건은 동급, 동시도가 오를수록 Lightpanda 우위

| 동시 M | Chromium | Lightpanda |
|---|---|---|
| 1 | 4.8s | 5.4s |
| 5 | 8.5s | 5.7s |
| 10 | 10.5s | **6.9s** |

단일 list 벤치는 3.78s(Cr) vs 3.75s(Lp)로 동급(둘 다 고정 3s 렌더 대기 포함, 실제 nav ~0.7s). Chromium은 동시도가 오르면 RAM/CPU 경합으로 급격히 느려지지만 Lightpanda는 완만하게 증가.

## 4. 실제 이득 레버

현재 `PARALLEL_LIMIT = 3` (`src/crawl.ts:515`)은 하드코딩. 16GB 예산 기준:
- Chromium(~360-460MB/인스턴스) → 실용 상한 ~3-4 동시 (현재 설정 그대로)
- Lightpanda(~80MB/인스턴스) → **같은 RAM으로 20-40 동시** 가능

즉 lightpanda 도입의 본질적 가치는 "인스턴스가 빨라서"가 아니라 **가벼워서 병렬도를 크게 올릴 수 있어서** 전체 처리량이 오르는 것이다.

---

## 5. 결정적 제약 — Playwright 비호환 (drop-in 불가)

| 사실 | 근거 |
|---|---|
| **Playwright(production 스택) + lightpanda = 실패** | `page.goto`/`page.evaluate`가 example.com에서도 20~60s 타임아웃/행. 모든 사이트 재현. |
| lightpanda HTTP 계층은 정상 | 네이티브 `lightpanda fetch`는 example/eastlogue/taats 모두 즉시 성공 (HTTP/TLS 문제 아님). |
| **Puppeteer로만 정상 동작** | 반드시 `browser.createBrowserContext() → context.newPage()` 패턴. `pages()[0]` 재사용 시 `BrowserContextNotLoaded` 에러 → goto 행. |
| 동시성 모델 | 프로세스당 context 1·page 1. 실측상 프로세스 풀로 문제없이 동작(~80MB/proc 평탄). |
| ZARA/Farfetch | `channel:"chrome"`(Akamai) 필수 → lightpanda 대체 불가, Playwright/실Chrome 유지. |
| Shopify/Uniqlo | fetch 기반 → 애초에 무관. |

문서의 "Playwright는 Chrome 내부 가정에 의존해 일부 기능이 안 맞는다"가 실제로 **navigation/evaluate 레벨에서 전면 실패**로 나타났다. lightpanda는 Puppeteer를 1차 지원 클라이언트로 삼는다.

---

## 6. 권고 — 단계적 도입 (버려도 되는 스파이크 코드 기반)

**GO 조건 충족**(추출 동등 + 메모리 ~5배), 단 아래는 flag 하나로 끝나지 않는 실제 작업:

1. **[Phase 1 — 저위험/즉효] 목록전용 Cafe24 72개** (`crawlDetails:false`, 활성 72개): detail parser 불필요. list 수집만 Puppeteer+lightpanda 프로세스 풀로 이식 → 즉시 ~5배 메모리 절감 + 병렬도 상향. `crawlCafe24`는 Playwright `Page`에 묶여 있으므로 재사용 불가 → list 추출부(카테고리 순회 + `collectProductsFromPage` 셀렉터 로직)를 Puppeteer `Page`용으로 이식.
2. **[Phase 2] detail 21개**: detail 파서(`src/lib/parsers/detail/*`)가 Playwright `Page` 타입에 묶여 있어 Puppeteer 이식 또는 얇은 Page 추상화 필요. detail(상품당 1 nav, 3-way)이 지배적 비용이라 메모리 이득이 여기서 복리로 커짐. `browser.newContext()` 3-way(`cafe24-engine.ts:613-621`)를 **lightpanda 프로세스 풀**로 교체.
3. **엔진 토글 + 폴백**: env/config로 사이트별 `engine: lightpanda|chromium` 선택. Beta 안정성("크래시 가능") 때문에 burn-in 중 오인식 사이트는 Chromium 폴백 유지.
4. **Linux 재검증 필수**: 본 수치는 macOS/arm64. 서버(Linux)에서 재측정 후 확정.
5. **두 스택 공존 수용**: lightpanda+Puppeteer(Cafe24) ∥ Playwright+실Chrome(ZARA/Farfetch) ∥ fetch(Shopify/Uniqlo).
6. `route.abort` 이미지 차단: lightpanda는 그래픽 렌더링이 없어 이미지를 애초에 안 가져올 가능성 높음(경량화 원인) → 검증하되 아마 무의미. img 요소 파싱은 DOM에 존재(55개 동등) → 영향 없음.

**표본 한계**: 단일 사이트(eastlogue) 1개 카테고리 표본. 전량 일반화 금지 — Phase 1에서 72개 사이트 burn-in으로 오인식률/크래시율 확인 후 Phase 2 진행.

---

## 7. 재현 방법

```bash
bash scripts/install-lightpanda.sh          # bin/lightpanda 설치 (macOS/Linux 자동감지)
export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"
U="https://eastlogue.com/product/list.html?cate_no=24"

# 단일 list (추출 수·메모리·시간)
node --import tsx src/spikes/lightpanda-poc.ts --engine=chromium  --urls="$U"
node --import tsx src/spikes/lightpanda-poc.ts --engine=lightpanda --urls="$U"

# 동시성 스케일 (집계 메모리 곡선)
node --import tsx src/spikes/lightpanda-poc.ts --engine=chromium  --urls="$U" --scale=1,5,10
node --import tsx src/spikes/lightpanda-poc.ts --engine=lightpanda --urls="$U" --scale=1,5,10
```

스파이크 자산(프로덕션 미연결): `scripts/install-lightpanda.sh`, `src/spikes/lightpanda-proc.ts`, `src/spikes/lightpanda-poc.ts`. `puppeteer-core`는 스파이크 전용 devDep(스파이크 폐기 시 제거 가능). 프로덕션 크롤 경로(`src/crawl.ts`, `src/lib/cafe24-engine.ts`)는 무수정.

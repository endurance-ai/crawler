# 다수 브랜드 일괄 온보딩 — 흐름 정리

> 대상: 수십~수백 개 브랜드를 한 번에 크롤·분류·적재하는 작업자.
> 단일 브랜드 신규 추가(파서 작성 포함)는 [`onboard-new-brand.md`](./onboard-new-brand.md) 참조.
> 이 문서는 **이미 `platforms.ts`에 등록된 브랜드들을 대량으로 재크롤/재분류**하는 경로를 다룬다
> (2026-07 category taxonomy 개편 + lightpanda 엔진 전환 작업에서 정립됨).

---

## 0. 전체 아키텍처

```
brands.json (SiteConfig[] 배열, key 필수)
  │
  ▼
tools/onboard-batch.sh  ── 청크 단위(기본 20개)로 반복 ──┐
  │                                                        │
  ├─ 1. crawl (product-extraction-poc.ts, --variants=existing)
  │      → poc-runs/chunk-N/products.jsonl
  │
  ├─ 2. finalize (tools/onboard-classify.ts)
  │      QC 이상치 필터 → 규칙 기반 분류(category/subcategory) → 색상 복구
  │      → data/<key>-products.json  (import 스키마)
  │
  ├─ 3. import (src/import-products.ts --site=<key>)
  │      canonical DB upsert → local Qwen best-effort 조건부 보강
  │
  └─ 4. guardrail (tools/reclassify-categories.ts --only-invalid)
         비canonical category가 남아있으면 규칙+local Qwen으로 수정
                                                            │
                                                            ▼
                                              chunk N+1로 반복
```

**핵심 원칙**: category/subcategory의 단일 진실 원천은 `src/lib/enums/product-enums.ts`다.
크롤 파이프라인의 모든 분류기(QC의 `normalization.ts`, 규칙기반 `shopify-category-classifier.ts`,
Qwen 정규화 스키마(`product-qwen-normalization.ts`)는 이 파일의 `CATEGORIES`/`SUBCATEGORIES`를 참조한다 —
taxonomy를 바꿀 땐 이 파일부터 고친다 (§5 참조).

---

## 1. Taxonomy (15 family + subcategory)

검색 경로(Vision/RPC)와 크롤러가 **같은 단어**로 만나도록 고정된 vocabulary. family를 늘리는 대신
subcategory 레벨에서 정밀도를 확보한다 (예: 스니커즈/부츠 구분은 `shoes` family 안의 subcategory).

| family | 대표 subcategory |
|---|---|
| `tops` | t-shirt, shirt, blouse, polo, hoodie, sweatshirt, tank-top, crop-top, henley, camisole |
| `knitwear` | sweater, cardigan, pullover, knit-top, turtleneck |
| `bottoms` | jeans, trousers, chinos, shorts, skirt, joggers, cargo-pants, wide-pants, leggings, sweatpants |
| `dresses` | mini/midi/maxi-dress, shirt-dress, wrap-dress, slip-dress, knit-dress, jumpsuit |
| `outerwear` | overcoat, trench-coat, parka, bomber, blazer, vest, leather/denim/down-jacket, windbreaker, fleece |
| `underwear` | briefs, bra |
| `swimwear` | swimsuit, bikini, trunks |
| `activewear` | tracksuit, sports-bra, athletic-shorts |
| `shoes` | sneakers, boots, loafers, derby, oxford, sandals, mules, heels, flats, slides, running-shoes |
| `bags` | tote, crossbody, backpack, clutch, shoulder-bag, belt-bag, messenger, bucket-bag |
| `accessories` | scarf, belt, watch, tie, gloves, socks |
| `eyewear` | sunglasses, glasses |
| `jewelry` | necklace, bracelet, ring, earrings |
| `headwear` | hat, cap, beanie, beret, bucket-hat |
| `other` | (비패션 / 분류 불가 — subcategory 없음) |

비패션 상품이나 name만으로 분류가 안 되는 상품은 `other`로 떨어진다 — 이건 버그가 아니라
의도된 안전판이다 (검색 필터 오염 방지).

---

## 2. 명령어 사용법

### 2-1. 브랜드 목록 준비

`platforms.ts`에서 대상 브랜드를 뽑아 JSON 배열로 저장한다 (`key` 필드 필수):

```bash
npx dotenv -e .env.local -- npx tsx -e '
import {getActivePlatforms} from "./src/configs/platforms"
import * as fs from "fs"
fs.writeFileSync("/tmp/batch.json", JSON.stringify(getActivePlatforms(), null, 2))
'
```

### 2-2. 배치 실행

```bash
tools/onboard-batch.sh --configs /tmp/batch.json \
  --chunk-size 20 --start 0 --end 6 \
  --engine chromium \
  --out-root poc-runs/my-batch-2026-08
```

옵션:
| 플래그 | 기본값 | 설명 |
|---|---|---|
| `--configs <path>` | (필수) | SiteConfig 배열 JSON |
| `--engine` | `chromium` | `chromium` \| `lightpanda` (Cafe24 크롤 엔진) |
| `--chunk-size` | 20 | 청크당 브랜드 수 |
| `--start` / `--end` | 0 / 마지막 | 실행할 청크 인덱스 범위 (inclusive) |
| `--out-root` | `poc-runs` | 크롤 결과·로그·tally CSV 저장 위치 |
| `--import-flags` | `--no-new-brands` | import-products.ts 에 넘길 플래그 |

**품절 상품도 수집한다** (2026-08-19). 크롤은 항상 `--include-out-of-stock` 로 돌고,
`--import-flags` 기본값에서 `--in-stock-only` 가 빠졌다 — `tools/recollect-batch.sh` 와
같은 규칙이다. 품절 필터는 import 가 아니라 **크롤 레이어**(`cafe24-engine.ts`, dedupe
직후·상세 크롤 **전**)에 있어서, 예전 기본값은 그 상품들의 상세 페이지를 열지도 않았고
`products.jsonl` 에서 통째로 빠졌다. 노출은 `in_stock` 이 이미 막으므로(검색 RPC 는
`in_stock=true` 만 본다) 담아두는 쪽이 재입고 복구를 리스팅 갱신만으로 끝낼 수 있다.

**⚠️ `--out-root`는 배치마다 다른 값을 써라.** 같은 out-root를 재사용하면 이전 배치의
`chunk-N/products.jsonl`이 남아있어 크롤이 "이미 있음"으로 스킵되고 엉뚱한 청크의 브랜드가
섞일 수 있다 (실제로 발생한 버그 — §4 참조).

### 2-3. 결과 확인

- `<out-root>/onboard-tally.csv` — 청크별 `pass/crawled/import/net/invalid_found/invalid_fixed`
- `<out-root>/chunk-N-finalize.log` — 규칙 기반 분류 fill rate(category/color)
- `<out-root>/guardrail-chunk-N.log` — 가드레일이 이번 청크 이후 잡아낸 비canonical 값

### 2-4. 중단 후 재개

같은 `--out-root`로 같은 `--start`를 다시 실행하면, 이미 크롤된 청크(`products.jsonl` 존재)는
자동 스킵하고 이어서 진행한다.

---

## 3. 엔진 선택 (Cafe24)

| 엔진 | 메모리/인스턴스 | detail 병렬도 | 폴백 |
|---|---|---|---|
| `chromium` (기본) | ~360-460MB | 3 | 없음 |
| `lightpanda` | ~80MB | 8 (env `CRAWLER_CAFE24_LIGHTPANDA_PARALLEL`) | 브랜드별 렌더 실패 시 자동 Chromium 폴백 |

`--engine lightpanda` 사용 전 `bin/lightpanda` 바이너리 필요 (`scripts/install-lightpanda.sh`).
Shopify는 `products.json` fetch 기반이라 엔진 선택과 무관 (브라우저 자체를 안 씀).
ZARA류(Akamai 방어)는 항상 real Chrome 경로를 쓴다 — lightpanda 대상 아님.

---

## 4. 재분류 도구 (`tools/reclassify-categories.ts`)

DB에 이미 적재된 상품의 category/subcategory를 재분류할 때 쓴다. 규칙기반
(`classifyShopifyCategory`, 비용 없음) 우선 → 매칭 안 되면 local Qwen 폴백.

```bash
# 전체 DB 재분류 (id 순서로 페이지 처리, 재개 가능)
npx dotenv -e .env.local -- npx tsx tools/reclassify-categories.ts --dry-run --limit 1000  # 샘플 검증
npx dotenv -e .env.local -- npx tsx tools/reclassify-categories.ts                          # 전체 실행
npx dotenv -e .env.local -- npx tsx tools/reclassify-categories.ts --start-id <id>           # 중단 후 재개

# 가드레일 모드 — 지금 category가 canonical 15-family에 없는 행만 찾아서 고침 (빠름, 항상 안전)
npx dotenv -e .env.local -- npx tsx tools/reclassify-categories.ts --only-invalid
```

`--only-invalid`는 `onboard-batch.sh`가 매 청크 import 직후 자동으로 호출한다 — 원인이 무엇이든
(아래 §4-1) 비canonical 값이 남으면 그 자리에서 잡아낸다.

### 4-1. 실제로 겪은 함정 (교훈)

이번 세션(2026-07)의 105K 상품 재분류 + 137브랜드 온보딩 중 발견된 문제들:

1. **온보딩 분류기가 taxonomy 변경을 안 따라감**: `tools/onboard-classify.ts`(구 `_scale-pipeline.ts`)는
   자체 `CANON` 상수를 갖고 있어서, `product-enums.ts`의 taxonomy를 바꿔도 이 파일을 별도로
   갱신하지 않으면 계속 구 카테고리를 출력한다. → **taxonomy 변경 시 이 파일의 CANON도 반드시 갱신**
   (§5 체크리스트에 포함).
2. **Upsert가 이미 고친 값을 되돌림**: `import-products.ts`는 `product_url` 기준 upsert라, taxonomy
   재분류 이후에 (구 CANON을 쓰던 시점의) 캐시된 `data/<key>-products.json`으로 같은 브랜드를 다시
   import하면 DB의 정상화된 category가 구 값으로 덮어써진다. → **가드레일(§4, `--only-invalid`)을
   매 import 직후 실행**하면 원인과 무관하게 이 클래스의 버그를 전부 잡는다.
3. **워크트리에 출력 디렉토리 부재**: 새 git worktree는 `poc-runs/`, `data/`가 없어 크롤 직후
   파일 쓰기가 조용히 실패(0 rows)할 수 있다. → `onboard-batch.sh`가 실행 시작 시 항상
   `mkdir -p`로 방어.
4. **out-root 재사용 충돌** (§2-2 경고): 다른 배치가 같은 `chunk-N` 이름을 재사용하면 잔여
   파일 때문에 크롤이 스킵되고 엉뚱한 브랜드 결과가 섞인다.
5. **규칙기반 분류기는 영어 패턴만 매칭**: `classifyShopifyCategory`의 `TYPE_TO_CATEGORY`는 영어
   정규식뿐이라, 한글 전용 상품명(자사몰 특유)은 자주 `other`로 떨어진다. import 후 Qwen 보강이 이걸 잡아준다 —
   `--only-invalid` 가드레일은 `other`를 "이미 유효한 canonical 값"으로 보고 건드리지 않으므로,
   `other` 비율이 비정상적으로 높으면 별도로 LLM 재검토가 필요할 수 있다(수동 판단 필요).

---

## 5. Taxonomy를 바꿀 때 체크리스트

`product-enums.ts`의 `CATEGORIES`/`SUBCATEGORIES`를 변경했다면, 다음을 **모두** 갱신해야 한다
(순서대로 grep 확인 권장 — 자세한 내역은 `git log --oneline -- src/lib/enums/product-enums.ts`):

1. `src/lib/enums/product-enums.ts` — 원천. Qwen JSON Schema와 프롬프트에 자동 주입.
2. `src/lib/product-qc/normalization.ts` — `CATEGORY_ALIASES`(이름 텍스트 추론), `CATEGORY_COMPAT`
   (구/동의어 → 신규 family 매핑). canonical-strict 로직 자체는 안 바뀜.
3. `src/lib/shopify-category-classifier.ts` — `TYPE_TO_CATEGORY`, `SUBCATEGORY_BY_CATEGORY`
   (Shopify 규칙기반 분류기, 온보딩 재분류 가드레일도 이걸 재사용).
4. `tools/onboard-classify.ts` — `product-enums.ts`의 canonical enum을 직접 사용.
5. `src/lib/product-qwen-normalization.ts` — strict JSON Schema와 category/subcategory 검증.
6. 테스트: `tests/product-qc-normalization.test.ts`, `tests/shopify-category-classifier.test.ts`,
   `tests/product-qwen-normalization.test.ts`, `tests/fixtures/shopify-parse*.golden.json`.
7. 기존 DB 데이터 재분류: `tools/reclassify-categories.ts` (전체 실행, §4 참조).

`npm run typecheck && npm test` 로 205개 이상의 테스트가 그린인지 확인 후 커밋.

---

## 6. 한 줄 요약 파이프라인

```
브랜드 목록 JSON 준비 (getActivePlatforms() 또는 수동 필터)
  → tools/onboard-batch.sh --configs <path> --engine <chromium|lightpanda> --out-root <고유경로>
      (청크마다: crawl → onboard-classify → import → guardrail, 전부 자동)
  → <out-root>/onboard-tally.csv 로 전체 결과 확인
  → (taxonomy를 바꾼 경우) tools/reclassify-categories.ts 로 기존 DB 전체 재분류
```

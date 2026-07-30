# 새 브랜드 온보딩 — 크롤 → 적재 → 임베딩 (end-to-end)

> 대상: 새 브랜드를 추가하는 작업자.
> 범위: 브랜드 선정 → 크롤 코드 작성(로컬 AI 활용) → 데이터 적재 → 임베딩까지 한 사이클.
> 파서 아키텍처(셀렉터 레지스트리/전략) 상세는 [`add-platform.md`](./add-platform.md) 참조.
> **수십~수백 개 브랜드를 한 번에** 재크롤/재분류하는 대량 온보딩은
> [`bulk-onboarding.md`](./bulk-onboarding.md) 참조 (`tools/onboard-batch.sh`).

---

## 0. 먼저 알아야 할 "바뀐 규칙" (2026-06 기준)

기존과 달라진 핵심 — **적재 게이트가 엄격해졌다.**

| 항목 | 규칙 | 근거 |
|---|---|---|
| **category 필수** | 없으면(빈문자/null) **적재 안 됨**. DB 컬럼도 `NOT NULL`. | validator `z.string().min(1)` + migration 091 |
| **품절 제외** | `inStock=false`(품절/sold out) 상품은 크롤·적재 모두에서 제외. | crawler `!inStock` 필터 + import `--in-stock-only` |
| **신규 브랜드 차단(옵션)** | `--no-new-brands` 시 `brand_nodes` 미등록 브랜드는 INSERT 안 하고 해당 상품도 제외. | import `--no-new-brands` |
| **색상은 크롤러가 안 뽑음** | 색상 단일 출처는 VLM `product_features.primary_color`. 크롤러 색상 로직은 2026-07-29 제거. | CLAUDE.md §18 |
| **임베딩 이미지** | 대표 이미지 = `image_url` (== `images[0]`, 전 데이터셋 동일). `images` 비면 `image_url`로 폴백. | `embed_batch_devapp.py` fetch 쿼리 |
| **신규 브랜드는 신뢰 출처만** (2026-07-30) | 미등록 브랜드의 `brand_nodes` 자동 INSERT 는 **단일브랜드 자사몰**(`config.brand` 또는 `SELF_BRANDED`, `multiBrand` 아님)에서만 한다. 멀티브랜드 편집샵의 미등록 브랜드는 INSERT 없이 **상품이 격리**된다. | `lib/brand-provenance.ts` |

> 의미: **category를 못 뽑는 상품은 검색 품질 무가치로 보고 버린다.** 색상·성별은 크롤러 책임이 아니다(VLM).

> **provenance 가드가 왜 필요했나**: 편집샵은 상품마다 브랜드가 달라, 크롤러가 DOM 에서
> 브랜드를 잘못 주워오면 그 쓰레기가 그대로 신규 `brand_nodes` 가 됐다. 실측 오염 —
> 플랫폼명이 브랜드로 적재(8division 계열, `tools/cleanup-platform-as-brand.ts` 가 치움),
> `glowny` 1,345건 brand = `"ㅤ"`(U+3164 채움문자), `etce` 1,604건 brand = `"판매가 : …"`.
> 적재 로그에 `⛔ 미등록 brand N개 … 자동 INSERT 제외(상품 격리)` 가 뜨면 이 가드가 동작한 것이다.
> 편집샵의 실제 상품별 브랜드는 온보딩 LLM 추출 → 기존 `brand_nodes` 매칭(`--no-new-brands`)
> 경로로만 적재된다.

---

## 1. 브랜드 선정 & brand_nodes 등록

1. 추가할 브랜드의 **공식몰 URL**과 **플랫폼 종류**(Cafe24 / Shopify / 기타)를 확인.
2. **`--no-new-brands`로 적재할 거면 `brand_nodes`에 브랜드가 먼저 있어야 한다.** 없으면 그 브랜드 상품이 통째로 제외됨.
   - 신규 브랜드를 정식 추가하는 경우: 먼저 `brand_nodes`에 등록(별도 프로세스)하거나, 이번 적재만 `--no-new-brands`를 빼고 진행.
3. `robots.txt`로 크롤 허용 여부 확인 — 명시적으로 금지하는 사이트는 보류(프로젝트 HARD 룰).

---

## 2. 크롤 코드 작성 (로컬에서 AI 활용)

### 2-1. 플랫폼 형태 판별
- **Shopify**: `{baseUrl}/products.json` 이 열리면 Shopify. 파서 거의 재사용 — config만 추가.
- **Cafe24 계열**: `/product/list.html?cate_no=N` 패턴 → `cafe24-engine` + 셀렉터 레지스트리.
- **기타 커스텀**: 전용 전략 추가([`add-platform.md`](./add-platform.md) §0 참조).

### 2-2. SiteConfig 추가
`src/configs/platforms.ts` 에 항목 추가 (`key`, `name`, `type`, `baseUrl`, 카테고리 정의 등).
- 카테고리는 가능하면 **수동 매핑**(`discovery: "manual"`)으로 정확히 — 카테고리 오분류가 데이터 오염의 주원인.
- Cafe24 상세 크롤 필요 시 `crawlDetails: true` + 셀렉터 레지스트리 항목.

### 2-3. 스캐폴드 도구
```bash
npm run scaffold:platform -- <key> --name "Display Name"          # 미리보기
npm run scaffold:platform -- <key> --name "Display Name" --write  # 스텁 생성
```
출력된 스니펫을 실제 파일에 붙여넣고 셀렉터를 채운다(상세는 add-platform.md §1~3).

### 2-4. 타입체크 + 테스트
```bash
npm run typecheck     # exit 0
npm test              # 기존 golden 깨지면 안 됨
```

---

## 3. 크롤 실행

```bash
# (선택) 카테고리 탐색만 — 상품 안 긁음
npm run crawl -- --dry-run --site=<key>

# 온보딩 크롤 — 기본으로 --detail (상세 페이지) 사용.
npm run crawl -- --site=<key> --detail
```
출력: `data/<key>-products.json`

> **온보딩 = 상세, 갱신 = 리스트.** 가격/재고 주기 갱신은 `--detail` 없이 실행한다
> (리스트 페이지에서 price·stock만, 상품당 상세 로드 없이 빠르게). image는
> 거의 변하지 않으므로 온보딩 1회 상세크롤로 확정하고 갱신에서는 다시 긁지 않는다.

### 크롤 후 확인 사항
- **category 채움률**: 출력 JSON에서 `category`가 비어있는 비율이 높으면 카테고리 매핑 점검.
- **품절 제외 동작**: `[품절]` 로그가 보이고 해당 상품이 결과에서 빠졌는지.
- **멈춤 없이 완료**: 한 상세 페이지가 멈춰도 timeout으로 넘어감(evaluate 20s / detail 25s / 사이트 전체 20분). 사이트가 통째로 안 끝나면 `SITE_TIMEOUT_MS` 안에 강제 종료됨.

---

## 4. DB 적재

### 4-1. 환경 파일 준비
`crawler/.env.local` (gitignore됨):
```
DB_URL=http://<PostgREST 게이트웨이>:3001     # 직접 Postgres가 아니라 REST 게이트웨이
DB_TOKEN=<service JWT>
```
> import는 PostgREST(`@supabase/supabase-js`)로 붙는다. psql 직결(5432)과는 **다른 경로**.

### 4-2. 적재 실행
```bash
# .env.local 은 npm 스크립트(dotenv -e .env)가 안 읽으므로 명시 호출
npx dotenv -e .env.local -- npx tsx src/import-products.ts --no-new-brands --in-stock-only --site=<key>
```
플래그 의미:
- `--no-new-brands` — 미등록 브랜드 상품 제외 (정식 신규 브랜드면 뺀다)
- `--in-stock-only` — 품절 상품 제외
- `--site=<key>` — 특정 플랫폼만 적재(생략 시 `data/` 전체)

### 4-3. 적재 중/후 확인 사항
- **`validation_reject` 로그** = category 누락으로 버려진 상품. 다수면 크롤 추출 품질 문제 → 2단계로 회귀.
- **`style_node` 류 컬럼 에러 주의**: products에서 drop된 컬럼(`style_node`(081), `material`(079))을 payload에 넣으면
  `Could not find the 'X' column ... in schema cache` 로 **전 배치 실패**. import payload는 현 스키마와 일치해야 함.
- psql로 결과 검증 (psql이 PATH에 없으면 전체 경로 사용):
  ```bash
  export PGHOST=<host> PGPORT=5432 PGUSER=ai_user PGPASSWORD=<pw> PGDATABASE=kikoai PGSSLMODE=require PGCLIENTENCODING=UTF8
  LC_ALL=C "/c/Program Files/PostgreSQL/16/bin/psql.exe" -c \
    "SELECT count(*) total,
            count(*) FILTER (WHERE category IS NULL) null_rows,
            count(*) FILTER (WHERE in_stock=false) out_of_stock
     FROM products WHERE platform='<key>';"
  ```
  → `null_rows=0`, `out_of_stock=0` 이어야 정상.

> migration 091(category NOT NULL)은 이미 적용됨. validator가 막으니 신규 적재에서 null은 안 들어간다.

---

## 5. 임베딩

`ai-server` 리포에서 실행. 로컬 FashionSigLIP로 인코딩 → `bulk_update_product_embeddings` RPC upsert.

### 5-1. 준비
```bash
cd <repo>/ai-server
uv sync --group embed
export KIKOAI_DEVAPP_DSN='postgresql://ai_user:<pw>@<host>:5432/kikoai?sslmode=require'   # Postgres 직결 DSN
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1 HF_HUB_DISABLE_SYMLINKS_WARNING=1              # Windows cp949 크래시 방지
```

### 5-2. 검증 → 실행
```bash
uv run python scripts/embed_batch_devapp.py --limit 50 --dry-run   # 대상 수 확인(쓰기 없음)
uv run python scripts/embed_batch_devapp.py --limit 50             # 50건 end-to-end 테스트
uv run python scripts/embed_batch_devapp.py --download-workers 8   # 전체 배치
```
- **재실행 안전**: `product_embeddings`에 없는 상품(`NOT EXISTS`)만 집어감 → 중단/skip돼도 다시 돌리면 이어서.
- **DNS `getaddrinfo failed` skip이 잦으면** `--download-workers`를 낮춰라(8 → 4). 죽은 호스트가 아니라 동시성에 의한 로컬 DNS 과부하임. skip된 건 재실행 시 자동 보충.
- CPU 인코딩은 느림(대략 0.3~0.4s/건). GPU/MPS 있으면 훨씬 빠름.

### 5-3. 검증
```sql
SELECT count(*) FROM product_embeddings;                       -- 전체
SELECT * FROM product_embedding_coverage WHERE platform='<key>';  -- 플랫폼별 커버리지
```
이미지 자체가 없는 극소수(빈 `image_url`)는 임베딩 불가 — 무시 가능.

---

## 6. 한 줄 요약 파이프라인

```
브랜드 선정(+brand_nodes 등록)
  → 크롤 코드(config/셀렉터) 작성 → npm run typecheck && npm test
  → npm run crawl -- --site=<key> --detail   (온보딩 기본=상세: category/품절 확인)
  → import-products --no-new-brands --in-stock-only --site=<key>   (validation_reject/스키마 확인)
  → embed_batch_devapp.py --download-workers 8                     (재실행으로 커버리지 수렴)
```

## 자주 밟는 함정
- psql이 PATH에 없음 → `"/c/Program Files/PostgreSQL/16/bin/psql.exe"` 전체 경로.
- 한글 콘솔(cp949)에서 파이썬 출력 크래시 → `PYTHONIOENCODING=utf-8`.
- `.env.local`을 npm 스크립트가 안 읽음 → `npx dotenv -e .env.local -- ...` 직접 호출.
- products에서 drop된 컬럼을 import payload에 남겨두면 전 배치 실패 → 스키마와 payload 일치 유지.
- 임베딩 대상이 예상보다 적음 → `images` 배열이 빈 플랫폼(예: Zara)인지 확인. fetch 쿼리가 `image_url` 폴백을 포함하는지 점검.

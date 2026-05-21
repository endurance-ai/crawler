# HANDOFF — Brand Enrichment

> 작성일: 2026-05-21
> 작업자: Claude Code 세션
> 상태: **✅ 완료 (Phase 1 + Phase 2 P1~P4 + review 적재)**
> 종결일: 2026-05-21

---

## ✅ 최종 결과

| 단계 | 결과 |
|---|---|
| P1 DDL | `brand_nodes.wiki jsonb` + partial index 3개 (`country`, `ig`, `status`) |
| P2 dry-run | `ok=1901, skipped=0, failed=0` |
| P3 import (ok) | DB `filled=1901` |
| P4 manual | 9개 brand WebSearch → +4 ok 승격, +5 review 정보 채움 |
| P3 재실행 (--include-review) | **DB 최종 `filled=1910 / 2899` (66%)** |

**P4 에서 갱신한 9개 brand**: 산산기어, 써저리, 오호스, Aleksandre Akhalkatsishvili (→ ok) / 언더마이카, 탄산마그네슘, ADER error, 999휴머니티, 타일레 (→ review, founder/year 부족)

**남은 989개 (`no_data`)**: 사용자 기여 UI 로 후속 처리 대상.

**다음 작업 (별도 세션)**: app 리포 — `/admin/brand-nodes` drawer 에 wiki 섹션 추가 (SPEC-BRAND-WIKI-001 M2).

---

## 핵심 산출물

```
data/brand-enrichment/
├── manifest.jsonl              # 2,899 lines (단일 source of truth)
├── brands/{brand_id}.json      # 2,899 JSON 파일
├── review_queue.jsonl          # 7 lines (admin 검수 대기)
├── no_data_queue.jsonl         # 968 lines (사용자 기여 대상)
├── kr_review_queue.jsonl       # 88 lines (한국 brand 우선)
├── SCHEMA.md                   # 데이터 스키마
└── IMPORT_GUIDE.md             # 3단계 import 전략

tools/
├── build_enrichment_queue.py   # queue.jsonl 재생성
├── pick_samples.py             # dry-run 샘플 선택
├── write_brand.py              # 단일 brand JSON heredoc 작성
├── bulk_fill.py                # TSV bulk → JSON + manifest
├── progress.sh                 # PROGRESS 한 줄 출력
├── enrichment_progress_logger.sh  # 5분 간격 백그라운드
├── promote_tier1.py            # founder만 누락 ok 승격
├── demote_tier3.py             # IG 추정값 brand 정직화
└── extract_kr_indie.py         # 한국 brand 큐 분리
```

## 현재 상태

```
total:    2,899
  ok:     1,901  (65.6%)  ← 자동 import 대상
  review:     7  (0.2%)   ← admin 검수
  no_data:  991  (34.2%)  ← 사용자 기여 대상
  error:      0
```

## 다음 작업 — Phase 2 (DB Import)

### 우선순위 1: DB 스키마 변경 SPEC 작성

**위치**: `kikoai/app/database/migrations/` 또는 `.moai/specs/SPEC-BRAND-WIKI-001/`

**제안 스키마**: `brand_nodes.wiki jsonb` 단일 컬럼
- 기존 `attributes` (VLM 결과) 와 분리
- 스키마 변경 최소
- 차후 위키 페이지 진화 유연성

**migration 초안** (IMPORT_GUIDE.md 참조):
```sql
ALTER TABLE brand_nodes ADD COLUMN wiki jsonb;
CREATE INDEX idx_brand_nodes_wiki_country ON brand_nodes ((wiki->>'origin_country')) WHERE wiki IS NOT NULL;
CREATE INDEX idx_brand_nodes_wiki_ig ON brand_nodes ((wiki->>'instagram_handle')) WHERE wiki IS NOT NULL;
```

### 우선순위 2: Import 스크립트 작성

**위치**: `crawler/src/import-brand-enrichment.ts`

기존 `import-brand-nodes.ts` 패턴 참고 — PostgREST shim (`$DB_URL`, `$DB_TOKEN`) 경유.

**3단계 전략**:
1. `--status=ok` 만 자동 입력 (1,901개)
2. `--status=review` 는 별도 admin 승인 후 입력
3. `--status=no_data` 는 import 안 함 (사용자 기여로 후속)

### 우선순위 3: P1 한국 brand 검수 (8개)

```bash
cat data/brand-enrichment/kr_review_queue.jsonl | jq 'select(.status!="ok") | {brand_id, brand_name, status, ig_guess}'
```

수동 search 또는 사용자 직접 확인 후 manifest 업데이트.

## 환경 정보

- **DB**: dev-app Postgres via PostgREST shim (`http://54.116.104.193:3001`)
- **인증**: `.env.local` 의 `DB_URL`, `DB_TOKEN` (이미 세팅됨)
- **`brand_nodes` 컬럼**: id (bigint), brand_name, brand_name_normalized, source_platforms, gender_scope, primary_style_node_id, secondary_style_node_id, attributes (jsonb), price_min_usd, price_max_usd, updated_at
- **추가될 컬럼**: `wiki jsonb` (제안)

## 이번 세션 의사 결정 요약

1. **LLM API 호출 0회 유지** — Claude Code 정액제 안에서 처리
2. **WebSearch 약 30회** (초반 dry-run + 메이저 brand 검증)
3. **나머지 ~2870 brand** — Claude knowledge cutoff (Jan 2026) 기반 bulk_fill
4. **Tier 1 (founder만 누락 211개)** — 일괄 ok 승격 (`founder_unknown` reason)
5. **Tier 3 (IG handle 추정만 968개)** — 정직하게 no_data 로 다운그레이드, ig_guess 필드 보존
6. **JSON only** — DB 직접 수정 안 함, 사용자 import 결정 대기

## 알려진 한계

- `ok` 1,901개 중 founder/year 가 wikipedia 기반 추정값 → 사용자 위키 수정 UI 필요
- `no_data` 991개의 IG handle 추정값은 brand 이름 lowercase 한 추정 — 검증 필요
- 일부 sub-line/diffusion brand 의 founder/year 가 모회사와 동일 (예: Versace Eyewear → Versace)
- VLM `attributes` (style sensibility) 와 wiki `description_ko` (브랜드 정체성) 은 다른 차원의 데이터

---

## 재개 명령

**새 세션 첫 메시지 예시:**

```
crawler 디렉터리에서 HANDOFF.md 읽고 남은 작업 이어서 진행해줘.
```

다음 세션에서 자동으로 해야 할 첫 단계:

```bash
cd /Users/hansangho/Desktop/kikoai/crawler
cat HANDOFF.md
bash tools/progress.sh
ls -la sql/ src/import-brand-enrichment.ts data/brand-enrichment/
```

## Phase 2 남은 작업 (우선순위)

### P1 — migration 적용 (DB DDL, 사용자 승인 필요)

```bash
# 1) app 리포로 migration 파일 복사
cp /Users/hansangho/Desktop/kikoai/crawler/sql/068_brand_wiki.sql \
   /Users/hansangho/Desktop/kikoai/app/database/migrations/

# 2) app 리포의 migration runner 로 실행 (사용자가 한 번 확인 후 진행)
#    또는 SSH 로 dev-app EC2 접속해서 psql 직접
#    ssh -i ~/Desktop/aws-infra/kikoai-key.pem ec2-user@54.116.104.193
```

→ 결과 확인: `curl -H "Authorization: Bearer $DB_TOKEN" "$DB_URL/brand_nodes?select=id,wiki&limit=1"` 가 `wiki` 컬럼 포함 응답하면 성공.

### P2 — Import 전체 dry-run (사용자 승인 불요)

```bash
pnpm exec dotenv -e .env.local -- npx tsx src/import-brand-enrichment.ts --dry-run 2>&1 | tail -20
```

기대 결과: `✅ Done: ok=1901, skipped=0, failed=0 (DRY-RUN mode)`

### P3 — 실제 import (DB write, 사용자 승인 필요)

```bash
# ok 1,901 brand 만
pnpm exec dotenv -e .env.local -- npx tsx src/import-brand-enrichment.ts

# review 7개 추가 검수 후 포함
pnpm exec dotenv -e .env.local -- npx tsx src/import-brand-enrichment.ts --include-review
```

### P4 — manual 검수 (자율 가능)

```bash
# review 큐 7개
cat data/brand-enrichment/review_queue.jsonl | python3 -m json.tool

# 한국 brand 우선 큐 8개 (review/no_data 만)
python3 -c "
import json
for l in open('data/brand-enrichment/kr_review_queue.jsonl'):
    r = json.loads(l)
    if r['status'] != 'ok':
        print(r['brand_id'], r['brand_name'], r['status'], r.get('ig_guess'))
"
```

→ WebSearch 로 정보 채운 후 `tools/write_brand.py` 또는 manifest 직접 수정.

## 진행 옵션 (예전)
- (A) DB 스키마 SPEC 작성 + migration 파일 → ✅ 완료 (`sql/068_brand_wiki.sql`)
- (B) Import 스크립트 작성 → ✅ 완료 (`src/import-brand-enrichment.ts`, dry-run 검증됨)
- (C) P1 한국 brand 8개 manual 검수 → 대기

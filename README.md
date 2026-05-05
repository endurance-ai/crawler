# crawler

> 포탈AI 크롤러 — 패션 자사몰에서 SKU·브랜드·이미지를 수집해 Supabase 로 적재하는 배치.
> [endurance-ai/portal.ai](https://github.com/endurance-ai/portal.ai) 의 검색·추천 파이프라인이 이 데이터를 소비.

Ported from `endurance-ai/portal.ai @ 5e3e7a0` on 2026-05-05.

---

## 무엇을 하나

| 지표 | 값 (분리 시점 기준) |
|---|---|
| 플랫폼 | 32개 (22 Cafe24 국내 + 10 Shopify 해외) |
| 누적 SKU | ~81,000 (45k 국내 + 35k 해외) |
| 누적 브랜드 | 697 |
| 실행 환경 | EC2 (cron / systemd timer) — 분리 후 운영 |

확장 예정: ZARA, H&M, 29CM, 무신사, 유니클로, 후르츠 등.

## 두 엔진

### Cafe24 — Playwright

- 카테고리 트리 파싱 → 카테고리별 상품 목록 페이지네이션 → (옵션) 상세 페이지
- `pricePattern` regex 로 가격 추출, 사이트별 셀렉터 오버라이드 지원
- 리뷰: board / inline / composite Strategy

### Shopify — JSON

- `<host>/products.json?limit=250&page=N` 표준 엔드포인트
- Playwright 없이 fetch 만으로 동작 → 빠름
- variants / vendor / tags 활용

## 디렉토리 구조

```
crawler/
  src/
    cli.ts                ← 진입점
    commands/             ← crawl, import-*, probe-* 등
  engines/
    cafe24/
      index.ts
      parsers/{detail,review}/
    shopify/
      index.ts
  configs/
    platforms.ts          ← 플랫폼 정의 (객체 1개 = 사이트 1개)
  lib/
    types.ts
    database.types.ts     ← supabase gen types 산출물
  output/                 ← gitignore (스크래핑 결과 캐시)
```

## 빠른 시작

\`\`\`bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
# .env 채우기

# 단일 플랫폼 dry-run
pnpm tsx src/cli.ts crawl --platform=<key> --dry-run

# 실제 실행
pnpm tsx src/cli.ts crawl --platform=<key>
\`\`\`

## 환경변수

`.env.example` 참고. 핵심 5종:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — 서비스 롤 직접 사용 (write 전용)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — Cloudflare R2 이미지 저장

⚠️ public 리포이므로 `.env` 는 절대 커밋 금지.

## 새 플랫폼 추가

1. `configs/platforms.ts` 의 `PLATFORMS: SiteConfig[]` 배열에 객체 1개 추가
2. Cafe24 면 기본 셀렉터로 시도 → 안 되면 `selectors` 오버라이드
3. Shopify 면 host 만 지정하면 끝
4. `pnpm tsx src/cli.ts crawl --platform=<key> --dry-run` 으로 검증

## 운영 (Phase 1)

EC2 1대 (c6i.large Spot 권장) + systemd timer / cron. 자세한 배포 가이드는 추후 `docs/operations.md` 에 추가.

## 데이터 흐름

\`\`\`
crawler (이 리포)
   ↓ Supabase write (SKU, 브랜드, 이미지 메타)
   ↓ R2 write (이미지 바이너리)
Supabase + R2
   ↓
portal.ai (검색·추천 웹)
\`\`\`

`portal.ai` 와 `crawler` 는 **DB 를 계약으로** 분리됨. 직접 호출 / API 없음.

## 라이선스

내부 프로젝트.

# 2026-06 코호트 재수집 배치

2026-06-22 전후에 옛 추출 로직으로 수집된 26개 platform key(60,634행)를 현재
로직으로 처음부터 다시 수집한다. 이 코호트는 `products.created_at = 2026-06-24`,
`crawled_at = 2026-06-21~23` 으로 나머지 343개 키(2026-07 생성분)와 명확히 구분된다.

전부 `src/configs/platforms.ts` 의 수기 등록 항목이다.

## 실행

```bash
# 배치 0 (파일럿) — 반드시 먼저, 모든 지표를 손으로 확인한다
tools/recollect-batch.sh --keys-file tools/recollect-batches/batch-0-pilot.txt \
  --run-id recollect-2026-07-28

# 이후 배치 — 같은 --run-id 를 써서 산출물을 한곳에 모은다
tools/recollect-batch.sh --keys-file tools/recollect-batches/batch-1.txt \
  --run-id recollect-2026-07-28
```

배치마다 멈춰서 `data/recollect/<run-id>/<key>/after.json` 을 읽고 다음으로 넘어간다.
죽은 배치는 같은 명령을 다시 돌리면 완료된 스테이지를 건너뛰고 이어서 돈다.

## 배치 순서의 근거

작은 것부터, 엔진 타입마다 작은 키에서 먼저 노출되게, 브랜드 수가 많은
멀티브랜드 편집샵은 파이프라인이 검증된 뒤 마지막에.

| 배치 | 상품수 | 목적 |
|---|---|---|
| 0 파일럿 | 281 | end-to-end 검증. shopify+cafe24 커버, 전부 단일 브랜드 |
| 1 | 1,728 | cafe24 2차 노출 |
| 2 | 4,085 | shopify 중형 |
| 3 | 3,381 | **uniqlo 최초** |
| 4 | 4,624 | bodega = 품절 83% 첫 사례 |
| 5 | 10,142 | **zara 단독** (봇 차단 리스크) |
| 6 | 11,073 | etcseoul = 최대 cafe24 |
| 7 | 13,865 | mohawk-general = 대규모 품절 83% |
| 8 | 11,455 | browns 단독. 브랜드 390개, 전체 색상 가비지의 47% |

## 캠페인 중 주의사항

- **`daily-onboard.sh` 및 `data/*-products.json` 을 쓰는 cron 을 정지한다.**
  `data/` 는 공유 네임스페이스이고 `import-products.ts` 가 이 디렉터리를 glob 한다.
- **분류 로직을 바꾸지 않는다.** 바꾸면 배치 0과 배치 8의 결과를 비교할 수 없다.
  드라이버가 시작 시점 커밋을 `manifest.json` 에 남긴다.
- 기존 repair 스크립트(`repair:product-color` 등)를 이 26개 키에 중복 적용하지
  않는다. 재수집이 대체하며, repair 는 나머지 343개 키용으로 계속 유효하다.

## 파일럿에서 반드시 확인할 것

1. `--no-visit-page` 없이 zara/uniqlo 의 `jsonLd`/`breadcrumb` 가 채워지는지
   (SPA 렌더 타이밍). 비어 있으면 키별 `--enrich-args "--wait-ms=3000"`.
2. zara 봇 차단율 — `--enrich-args "--concurrency=1 --sleep-ms=2000"` 로 시작해
   차단이 계속되면 `--no-visit-page` 로 폴백.
3. 보강 비용. `.env.local` 에 `LLM_SCRAPER_INPUT_USD_PER_1M` /
   `LLM_SCRAPER_OUTPUT_USD_PER_1M` 를 넣어야 스크립트가 1000개당 단가를 출력한다.
   실측 토큰(etcseoul): 상품당 in 2,577 / out 112.
4. 임베딩 무효화 비율. 20% 초과면 정규화가 CDN 패턴을 놓친 것이다.

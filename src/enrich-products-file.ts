/**
 * 크롤 산출 JSON(data/<key>-products.json)을 LLM 으로 보강한다.
 *
 * 재수집 캠페인의 2단계다: `crawl --site=K --detail` 로 결정론적 필드(name/price/
 * image/stock/tags/images)를 받아온 뒤, 이 스크립트가 같은 파일 위에서
 * category/subcategory/color/description/gender 만 LLM 으로 다시 만든다. 그리고
 * `import-products --site=K` 가 그 파일을 적재한다.
 *
 *   pnpm enrich:products -- --file=data/kith-products.json --site=kith
 *   pnpm enrich:products -- --file=data/zara-kr-products.json --site=zara-kr \
 *     --concurrency=1 --sleep-ms=2000
 *
 * 왜 별도 스크립트인가 (기존 경로를 안 쓴 이유):
 *   - tools/onboard-classify.ts: payload 에 images/tags/sizeInfo/productCode 가
 *     없어서 기존 행에 upsert 하면 그 컬럼들이 NULL 로 덮인다. 신규 온보딩
 *     전용이고 재수집에는 파괴적이다.
 *   - src/refresh-candidates.ts: 큐 claim 기반이고 upsert 가 ignoreDuplicates.
 *   - src/repair-product-color-llm.ts: DB 에서 읽어 color 만 고친다.
 * 셋 다 크롤 직후의 "파일 전체를 현재 로직으로 다시 만든다"는 요구에 안 맞는다.
 *
 * 설계 요점:
 *   - **재개 가능**: 보강된 항목에 llmEnrichedAt 을 찍고, 그 값이 있으면 건너뛴다.
 *     --checkpoint 마다 파일을 다시 쓰므로 1만 건짜리 보강이 중간에 죽어도
 *     처음부터 다시 돌지 않는다. 캠페인에서 가장 중요한 속성이다.
 *   - **결정론적 필드 보존**: enrichProductWithLlm 이 {...product} 스프레드 위에
 *     5개 필드만 덮으므로 images/tags/price 등은 그대로다.
 *   - **DB 를 건드리지 않는다**: 출력은 파일뿐. 적재는 import-products 담당이고,
 *     그 사이에 게이트(tools/recollect-metrics.ts)가 들어간다.
 *
 * Flags:
 *   --file=PATH          보강할 크롤 산출 JSON (필수)
 *   --site=KEY           SiteConfig 키 (필수). enrichProductWithLlm 의 동일 출처
 *                        가드(assertSameSource)와 프롬프트 컨텍스트에 쓰인다.
 *   --concurrency=N      동시 페이지 수 (기본 4, 최대 8)
 *   --limit=N            앞에서 N개만 보강 (스모크 테스트용)
 *   --checkpoint=N       N개 보강마다 파일 저장 (기본 100)
 *   --wait-ms=N          페이지 로드 후 대기 (기본 0 = enrich 모듈 기본값 800 사용)
 *   --sleep-ms=N         상품 간 지연 (기본 0). 봇 차단 사이트용
 *   --max-retries=N      429/5xx 재시도 횟수 (기본 3)
 *   --no-visit-page      페이지를 열지 않고 크롤된 레코드만으로 보강.
 *                        SPA/봇차단 사이트(zara)의 탈출구
 *   --force              llmEnrichedAt 이 있어도 다시 보강
 *   --preflight          1개만 보강해보고 결과를 출력한 뒤 종료 (파일 미변경)
 */

import * as fs from "node:fs"
import * as path from "node:path"

import {chromium, type Browser, type Page} from "playwright"

import {getSiteConfig} from "./configs/platforms"
import {runAsyncPool} from "./lib/async-pool"
import {
  backoffMs,
  isRetryable,
  readProductsFile,
  selectEnrichTargets,
  writeProductsFile,
} from "./lib/enrich-file"
import {enrichProductWithLlm, type LlmTokenUsage} from "./lib/llm-product-enrichment"
import type {Product, SiteConfig} from "./lib/types"

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// ─── CLI ────────────────────────────────────────────

interface Flags {
  file: string
  site: string
  concurrency: number
  limit: number
  checkpoint: number
  waitMs: number
  sleepMs: number
  maxRetries: number
  visitPage: boolean
  force: boolean
  preflight: boolean
}

function parseFlags(): Flags {
  const raw: Record<string, string | boolean> = {}
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue
    const [key, value] = arg.slice(2).split("=")
    raw[key!] = value ?? true
  }
  const num = (key: string, def: number, max = Number.POSITIVE_INFINITY): number => {
    const value = raw[key]
    if (typeof value !== "string") return def
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      console.error(`invalid --${key}=${value}`)
      process.exit(1)
    }
    return Math.min(parsed, max)
  }
  const str = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string) : "")

  const file = str("file")
  const site = str("site")
  if (!file || !site) {
    console.error("usage: enrich-products-file --file=data/<key>-products.json --site=<key>")
    process.exit(1)
  }
  return {
    file,
    site,
    concurrency: Math.max(1, num("concurrency", 4, 8)),
    limit: num("limit", 0),
    checkpoint: Math.max(1, num("checkpoint", 100)),
    waitMs: num("wait-ms", 0),
    sleepMs: num("sleep-ms", 0),
    maxRetries: num("max-retries", 3),
    visitPage: raw["no-visit-page"] !== true,
    force: raw.force === true,
    preflight: raw.preflight === true,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── 컨텍스트 없이 보강 (--no-visit-page) ───────────────

/**
 * 상세 페이지를 열지 않고 보강한다. 크롤 레코드(name/description/tags)로 최소
 * 문서를 만들어 페이지에 심고, enrich 모듈의 navigate 를 꺼서 그 문서를 읽게 한다.
 * 상세 페이지 대량 방문이 봇 차단을 부르는 사이트(zara)의 탈출구 — 품질은
 * 떨어지지만 0건보다는 낫다. LLM 은 name/brand/tags/existingColorHint 를 별도
 * 인자로도 받으므로 실제 손실은 breadcrumb/jsonLd 뿐이다.
 */
async function enrichWithoutPage(
  page: Page,
  product: Product,
  config: SiteConfig,
  waitMs: number,
): Promise<Awaited<ReturnType<typeof enrichProductWithLlm>>> {
  const stub = [
    `<title>${escapeHtml(product.name)}</title>`,
    product.description ? `<div id="prdDetail">${escapeHtml(product.description)}</div>` : "",
    (product.tags ?? []).map((tag) => `<nav><a>${escapeHtml(tag)}</a></nav>`).join(""),
  ].join("")
  await page.setContent(`<!doctype html><html><body>${stub}</body></html>`, {waitUntil: "domcontentloaded"})
  return enrichProductWithLlm(page, product, config, {navigate: false, waitMs})
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]!)
}

// ─── 메인 ────────────────────────────────────────────

interface Totals {
  enriched: number
  skipped: number
  failed: number
  usage: LlmTokenUsage
  costUsd: number
  costKnown: boolean
}

function loadProducts(file: string): Product[] {
  const absolute = path.resolve(file)
  if (!fs.existsSync(absolute)) {
    console.error(`❌ 파일 없음: ${absolute}`)
    process.exit(1)
  }
  try {
    return readProductsFile(file)
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const flags = parseFlags()
  const found = getSiteConfig(flags.site)
  if (!found) {
    console.error(`❌ 알 수 없는 site 키: ${flags.site}`)
    process.exit(1)
  }
  // 아래 enrichOne 은 호이스팅되는 함수 선언이라 위 가드의 좁히기가 적용되지
  // 않는다 — 좁혀진 값을 const 로 한 번 붙잡아 둔다.
  const config: SiteConfig = found
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY 가 필요합니다")
    process.exit(1)
  }

  const products = loadProducts(flags.file)
  const alreadyEnriched = products.filter((product) => product.llmEnrichedAt).length
  const targets = selectEnrichTargets(products, {force: flags.force, limit: flags.limit})

  console.log(
    `📄 ${flags.file} — 총 ${products.length}개 / 보강 대상 ${targets.length}개` +
      ` (이미 보강됨 ${alreadyEnriched})`,
  )
  if (targets.length === 0) {
    console.log("✅ 보강할 항목 없음")
    return
  }
  console.log(
    `⚙️  site=${flags.site} concurrency=${flags.concurrency} checkpoint=${flags.checkpoint}` +
      ` visitPage=${flags.visitPage} sleepMs=${flags.sleepMs}` +
      (flags.waitMs > 0 ? ` waitMs=${flags.waitMs}` : ""),
  )
  // --wait-ms 미지정(0)이면 enrich 모듈 기본값(800ms)을 그대로 쓴다.
  const enrichOptions = flags.waitMs > 0 ? {waitMs: flags.waitMs} : {}

  const totals: Totals = {
    enriched: 0,
    skipped: 0,
    failed: 0,
    usage: {input_tokens: 0, output_tokens: 0, total_tokens: 0},
    costUsd: 0,
    costKnown: true,
  }
  const startedAt = Date.now()
  let sinceCheckpoint = 0
  const failures: string[] = []

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({headless: true})
    const context = await browser.newContext({userAgent: USER_AGENT, locale: "ko-KR"})
    // 분류에 이미지 픽셀은 필요 없다 — 차단하면 페이지당 수 초가 빠진다.
    await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,mp4}", (route) => route.abort())

    // --preflight: 한 건만 돌려 동일 출처 가드/렌더 타이밍/스키마를 확인한다.
    // 브랜드당 수천 번 같은 오류를 반복하기 전에 걸러내는 장치.
    if (flags.preflight) {
      const page = await context.newPage()
      const {product} = targets[0]!
      console.log(`\n🔍 preflight: ${product.productUrl}`)
      try {
        const result = flags.visitPage
          ? await enrichProductWithLlm(page, product, config, enrichOptions)
          : await enrichWithoutPage(page, product, config, flags.waitMs)
        console.log(`   model=${result.model} usage=${JSON.stringify(result.usage)} cost=${result.costUsd ?? "n/a"}`)
        console.log(
          `   before: category=${product.category} subcategory=${product.subcategory ?? "-"}` +
            ` color=${product.color ?? "-"} gender=${(product.gender ?? []).join("/")}`,
        )
        console.log(
          `   after : category=${result.product.category} subcategory=${result.product.subcategory ?? "-"}` +
            ` color=${result.product.color ?? "-"} gender=${(result.product.gender ?? []).join("/")}`,
        )
        console.log("✅ preflight 통과 — 파일은 변경하지 않았습니다")
      } catch (error) {
        console.error(`❌ preflight 실패: ${error instanceof Error ? error.message : error}`)
        process.exitCode = 1
      }
      await page.close().catch(() => {})
      return
    }

    // 페이지를 워커 수만큼 만들어 재사용한다 (상품마다 newPage 는 비싸다).
    const pages: Page[] = []
    for (let i = 0; i < Math.min(flags.concurrency, targets.length); i++) {
      const page = await context.newPage()
      page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}))
      pages.push(page)
    }
    // 페이지 대여: 워커 수와 페이지 수가 같고 핸들러가 반드시 반납하므로 idle 이
    // 비는 일은 없다. 라운드로빈 커서로는 두 워커가 같은 페이지를 잡아 동시에
    // goto 를 걸 수 있어(호출 순서가 균등하다는 보장이 없다) 반드시 pop/push 여야 한다.
    const idlePages: Page[] = [...pages]

    await runAsyncPool(targets, pages.length, async ({product, index}) => {
      const page = idlePages.pop()!
      try {
        await enrichOne(page, product, index)
      } finally {
        idlePages.push(page)
      }
    })

    async function enrichOne(page: Page, product: Product, index: number): Promise<void> {
      let lastError: unknown = null

      for (let attempt = 0; attempt <= flags.maxRetries; attempt++) {
        try {
          const result = flags.visitPage
            ? await enrichProductWithLlm(page, product, config, enrichOptions)
            : await enrichWithoutPage(page, product, config, flags.waitMs)

          products[index] = {
            ...result.product,
            llmEnrichedAt: new Date().toISOString(),
            llmModel: result.model,
          }
          totals.enriched += 1
          totals.usage.input_tokens += result.usage.input_tokens
          totals.usage.output_tokens += result.usage.output_tokens
          totals.usage.total_tokens += result.usage.total_tokens
          if (result.costUsd === null) totals.costKnown = false
          else totals.costUsd += result.costUsd
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt < flags.maxRetries && isRetryable(error)) {
            await sleep(backoffMs(attempt))
            continue
          }
          break
        }
      }

      if (lastError) {
        totals.failed += 1
        // 실패한 항목은 llmEnrichedAt 을 찍지 않는다 — 다음 런이 자동 재시도한다.
        if (failures.length < 20) {
          failures.push(`${product.productUrl}: ${lastError instanceof Error ? lastError.message : lastError}`)
        }
      }

      sinceCheckpoint += 1
      if (sinceCheckpoint >= flags.checkpoint) {
        sinceCheckpoint = 0
        writeProductsFile(flags.file, products)
        const done = totals.enriched + totals.failed
        const rate = done / ((Date.now() - startedAt) / 1000)
        console.log(
          `   💾 체크포인트 ${done}/${targets.length}` +
            ` (성공 ${totals.enriched} 실패 ${totals.failed}, ${rate.toFixed(2)}/s)`,
        )
      }

      if (flags.sleepMs > 0) await sleep(flags.sleepMs)
    }

    await Promise.all(pages.map((page) => page.close().catch(() => {})))
    await context.close().catch(() => {})
  } finally {
    await browser?.close().catch(() => {})
  }

  writeProductsFile(flags.file, products)

  const elapsedMin = (Date.now() - startedAt) / 60_000
  const per1000 = totals.enriched > 0 ? (totals.costUsd / totals.enriched) * 1000 : 0
  console.log(
    `\n🏁 보강 ${totals.enriched} / 실패 ${totals.failed} / 전체 ${products.length}` +
      ` | ${elapsedMin.toFixed(1)}분` +
      ` | 토큰 in=${totals.usage.input_tokens} out=${totals.usage.output_tokens}` +
      (totals.costKnown
        ? ` | $${totals.costUsd.toFixed(4)} ($${per1000.toFixed(2)}/1000개)`
        : " | 비용 미상 (LLM_SCRAPER_INPUT_USD_PER_1M/_OUTPUT_ 미설정)"),
  )
  if (failures.length > 0) {
    console.log(`   실패 샘플 (최대 20):`)
    for (const failure of failures) console.log(`     - ${failure}`)
  }
  // 실패가 남아 있으면 재실행으로 이어서 재시도된다 — 드라이버가 판단할 수 있게
  // 종료 코드로 알린다 (전량 실패는 명백한 장애).
  if (totals.enriched === 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`💥 enrich 치명 오류: ${error instanceof Error ? error.stack : error}`)
  process.exit(1)
})

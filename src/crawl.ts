#!/usr/bin/env npx tsx
/**
 * 범용 플랫폼 크롤러 CLI
 *
 * 사용법:
 *   npx tsx scripts/crawl.ts --list                    # 등록된 플랫폼 목록
 *   npx tsx scripts/crawl.ts --site=obscura            # 단일 사이트
 *   npx tsx scripts/crawl.ts --site=obscura,llud       # 복수 사이트
 *   npx tsx scripts/crawl.ts --all                     # 전체 크롤링
 *   npx tsx scripts/crawl.ts --type=cafe24             # 타입별
 *   npx tsx scripts/crawl.ts --probe=obscura           # 사이트 구조 프로빙 (상품 안 긁음)
 *   npx tsx scripts/crawl.ts --dry-run --site=obscura  # 카테고리 탐색만 (상품 안 긁음)
 *
 * 출력: data/{platform-key}-products.json
 */

import {chromium} from "playwright"
import * as fs from "fs"
import * as path from "path"
import {createClient} from "@supabase/supabase-js"
import {getActivePlatforms, getPlatformsByType, getSiteConfig, PLATFORMS} from "./configs/platforms"
import {crawlCafe24} from "./lib/cafe24-engine"
import {crawlShopify} from "./lib/shopify-engine"
import {crawlUniqlo, parseRateFlag, pickUserAgent} from "./lib/uniqlo-engine"
import {crawlZara, detectBmVerifyIntercept, pickZaraUserAgent} from "./lib/zara-engine"
import {
  crawl29cm,
  genderFromCategoryCode as genderFor29cm,
  harvestRawItems as harvest29cmItems,
  is29cmCloudflareChallenge,
  parseProductsFromXhr as parse29cmXhr,
  pick29cmUserAgent,
} from "./lib/29cm-engine"
import {
  crawlFarfetch,
  deriveGenderFromUrl as deriveFarfetchGender,
  detectChallengeIntercept as detectFarfetchChallenge,
  extractCardsFromDom as extractFarfetchCards,
  type FarfetchRegion,
  parseProductsFromCards as parseFarfetchCards,
  pickFarfetchUserAgent,
} from "./lib/farfetch-engine"
import {checkRobots} from "./lib/robots-check"
import {getDetailParser} from "./lib/parsers/detail"
import {getReviewParser} from "./lib/parsers/review"
import type {CrawlResult, Product, SiteConfig} from "./lib/types"
import type {DetailData} from "./lib/parsers/detail/types"
import {applyValidationGate} from "./lib/core/validation-gate"
import {getValidationReport} from "./lib/core/observability"
import {applyProductQcGate, getProductQcReport} from "./lib/product-qc/normalization"

// 크롤 결과를 product_crawl_status(091, brand_node_id 기준)에 자동 반영한다(수기 mark 불필요).
// 배포 admin 페이지(product_crawl_brands 뷰)가 읽는 소스가 이 테이블이다. DB_URL/DB_TOKEN
// 미설정이면 조용히 스킵 — crawl.ts는 큐와 무관한 40+ 기존 플랫폼에도 쓰이므로 필수 아님.
const queueDb =
  process.env.DB_URL && process.env.DB_TOKEN
    ? createClient(process.env.DB_URL, process.env.DB_TOKEN)
    : null

// platform_key → brand_node_id. 기존 status 행의 platform_key 로 resolve, 없으면
// SiteConfig.brand 로 brand_nodes 를 매칭해 폴백.
async function resolveBrandNodeId(platform: string): Promise<number | null> {
  if (!queueDb) return null
  const {data: statusRow} = await queueDb
    .from("product_crawl_status")
    .select("brand_node_id")
    .eq("platform_key", platform)
    .maybeSingle()
  if (statusRow) return (statusRow as {brand_node_id: number}).brand_node_id

  const brandName = getSiteConfig(platform)?.brand
  if (brandName) {
    const {data: node} = await queueDb
      .from("brand_nodes")
      .select("id")
      .ilike("brand_name", brandName)
      .maybeSingle()
    if (node) return (node as {id: number}).id
  }
  return null
}

async function syncCrawlResultToQueue(result: CrawlResult): Promise<void> {
  if (!queueDb) return
  const brandNodeId = await resolveBrandNodeId(result.platform)
  if (!brandNodeId) return // brand_node 해석 실패 — no-op

  const success = result.errors.length === 0 && result.stats.totalProducts > 0
  const status = success ? "crawled" : "qc_failed"

  await queueDb.from("product_crawl_status").upsert(
    {
      brand_node_id: brandNodeId,
      status,
      platform_key: result.platform,
      crawled_at: success ? new Date().toISOString() : null,
      last_error: result.errors[0] ?? null,
    },
    {onConflict: "brand_node_id"},
  )

  await queueDb.from("product_crawl_runs").insert({
    brand_node_id: brandNodeId,
    stage: "crawl",
    status: success ? "success" : "failed",
    platform_key: result.platform,
    actor: "crawl-auto",
    command: `crawl --site=${result.platform}`,
    duration_ms: result.stats.duration,
    error_message: result.errors[0] ?? null,
    metrics: {
      total_products: result.stats.totalProducts,
      in_stock: result.stats.inStock,
      unique_brands: result.stats.uniqueBrands,
      errors: result.errors,
    },
  })
}

// ─── CLI 인자 파싱 ───────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const flags: Record<string, string | boolean> = {}

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=")
      flags[key] = val ?? true
    }
  }

  return flags
}

// ─── 프로빙 (사이트 구조 확인) ───────────────────────

async function probeSite(config: SiteConfig) {
  console.log(`\n🔍 프로빙: ${config.name} (${config.baseUrl})`)
  console.log(`   타입: ${config.type}`)

  // REQ-004 pre-flight: robots.txt blanket-Disallow check before any
  // product-path fetch. Engine-agnostic — applies to all types.
  const robots = await checkRobots(config.baseUrl)
  if (!robots.allowed) {
    console.error(
      `   ❌ robots-block: ${config.key} blocked by robots.txt (${robots.blockingLine ?? "unknown"}). ` +
        `Project HARD rule #1: sites that explicitly forbid crawling MUST be deferred.`,
    )
    process.exit(1)
  }

  if (config.type === "uniqlo") {
    try {
      const apiOrigin = new URL(config.baseUrl).origin
      const url = `${apiOrigin}/kr/api/commerce/v5/ko/products?path=${encodeURIComponent(
        config.apiCategoryPaths?.[0] ?? "57892,,,",
      )}&limit=1&offset=0`
      const res = await fetch(url, {
        headers: {"User-Agent": pickUserAgent(0), Accept: "application/json"},
      })
      if (!res.ok) {
        console.log(`   ❌ HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as {result?: {items?: Array<Record<string, unknown>>}}
      const sample = data.result?.items?.[0]
      console.log(`   ✅ Uniqlo API 접근 가능`)
      if (sample) {
        const baseValue = (sample.prices as {base?: {value?: number}} | undefined)?.base?.value
        console.log(`   📦 name: ${String(sample.name ?? "(없음)")}`)
        console.log(`   📦 productCode: ${String(sample.productId ?? "(없음)")}`)
        console.log(`   📦 prices.base.value: ${baseValue ?? "(없음)"}`)
        console.log(
          `   📦 productUrl: ${config.baseUrl}/products/${String(sample.productId ?? "")}`,
        )
      } else {
        console.log(`   📦 샘플: (items 비어있음)`)
      }
    } catch (err) {
      console.log(`   ❌ 접속 실패: ${err}`)
    }
    return
  }

  if (config.type === "zara") {
    const firstUrl = config.categoryUrls?.[0]
    if (!firstUrl) {
      console.log(`   ❌ zara-kr: categoryUrls is empty — cannot probe`)
      return
    }
    let browser
    try {
      browser = await chromium.launch({headless: true, channel: "chrome"})
    } catch (err) {
      console.log(`   ❌ Chromium (channel:'chrome') launch failed: ${err}`)
      console.log(`      Install with: npx playwright install chrome`)
      return
    }
    try {
      const ctx = await browser.newContext({
        userAgent: pickZaraUserAgent(0),
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        viewport: {width: 1440, height: 900},
      })
      const page = await ctx.newPage()
      let xhrPayload: unknown = null
      page.on("response", async (res) => {
        if (xhrPayload) return
        if (/\/category\/\d+\/products\?ajax=true/.test(res.url())) {
          try {
            const buf = await res.body()
            xhrPayload = JSON.parse(buf.toString("utf-8"))
          } catch {}
        }
      })
      const response = await page.goto(firstUrl, {waitUntil: "domcontentloaded", timeout: 30000})
      console.log(`   HTTP: ${response?.status()}`)
      const body = await page.content()
      const intercept = detectBmVerifyIntercept(body)
      if (intercept.isIntercept) {
        console.log(`   ❌ Akamai intercept detected (${intercept.reason}); body=${body.length} bytes`)
        await ctx.close()
        return
      }
      // Dismiss cookie banner
      try {
        await page.locator("#onetrust-accept-btn-handler").click({timeout: 2500})
      } catch {}
      try {
        await page.waitForSelector(".product-grid-product, [data-productid]", {timeout: 12000})
      } catch {}
      // Mild scroll to trigger XHR
      for (let y = 0; y < 4000 && !xhrPayload; y += 600) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y)
        await page.waitForTimeout(350)
      }
      await page.waitForTimeout(1500)
      if (!xhrPayload) {
        console.log(`   ⚠️  no /category/{id}/products?ajax=true XHR captured`)
        await ctx.close()
        return
      }
      const {harvestRawProducts, parseProductsFromXhr} = await import("./lib/zara-engine")
      const raws = harvestRawProducts(xhrPayload)
      const products = parseProductsFromXhr(raws.slice(0, 3), config.baseUrl, config.key)
      console.log(`   ✅ ZARA bypass OK: harvested ${raws.length} raw products from XHR; sample 3:`)
      for (const p of products) {
        console.log(`      ${p.priceFormatted} — ${p.name.slice(0, 40)} → ${p.productUrl.slice(0, 80)}`)
      }
      await ctx.close()
    } catch (err) {
      console.log(`   ❌ probe failed: ${err}`)
    } finally {
      await browser.close().catch(() => {})
    }
    return
  }

  if (config.type === "29cm") {
    const codes = config.apiCategoryCodes ?? []
    const firstCode = codes[0]
    if (typeof firstCode !== "number") {
      console.log(`   ❌ 29cm-kr: apiCategoryCodes is empty — cannot probe`)
      return
    }
    const probeUrl = `https://www.29cm.co.kr/store/category/list?categoryLargeCode=${firstCode}&sort=RECOMMENDED`
    let browser
    try {
      browser = await chromium.launch({headless: true})
    } catch (err) {
      console.log(`   ❌ Chromium launch failed: ${err}`)
      console.log(`      Install with: npx playwright install chromium`)
      return
    }
    const ctx = await browser.newContext({
      userAgent: pick29cmUserAgent(0),
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      viewport: {width: 1440, height: 900},
    })
    try {
      const page = await ctx.newPage()
      let xhrPayload: unknown = null
      const onResponse = async (res: import("playwright").Response) => {
        if (xhrPayload) return
        if (/display-bff-api\.29cm\.co\.kr\/api\/v1\/listing\/items(?:\?|$)/.test(res.url())) {
          try {
            const buf = await res.body()
            xhrPayload = JSON.parse(buf.toString("utf-8"))
          } catch {}
        }
      }
      page.on("response", onResponse)
      try {
        const response = await page.goto(probeUrl, {waitUntil: "domcontentloaded", timeout: 30000})
        console.log(`   HTTP: ${response?.status()}`)
        const body = await page.content()
        const intercept = is29cmCloudflareChallenge(body)
        if (intercept.isIntercept) {
          console.log(`   ❌ Cloudflare intercept (${intercept.reason}); body=${body.length} bytes`)
          return
        }
        // Mild scroll to trigger React Query fetch
        for (let i = 0; i < 8 && !xhrPayload; i++) {
          await page.evaluate((y) => window.scrollTo(0, y), (i + 1) * 800)
          await page.waitForTimeout(500)
        }
        await page.waitForTimeout(1500)
        if (!xhrPayload) {
          console.log(`   ⚠️  no display-bff-api/listing/items XHR captured`)
          return
        }
        const harvested = harvest29cmItems(xhrPayload)
        for (const it of harvested) {
          it._categoryCode = firstCode
          it._gender = genderFor29cm(firstCode)
        }
        const products = parse29cmXhr(harvested.slice(0, 3), config.baseUrl, config.key)
        console.log(`   ✅ 29CM XHR OK: harvested ${harvested.length} raw items; sample 3:`)
        for (const p of products) {
          console.log(`      ${p.priceFormatted} — ${p.name.slice(0, 40)} → ${p.productUrl.slice(0, 80)}`)
        }
      } finally {
        page.off("response", onResponse)
      }
    } catch (err) {
      console.log(`   ❌ probe failed: ${err}`)
    } finally {
      await ctx.close().catch(() => {})
      await browser.close().catch(() => {})
    }
    return
  }

  if (config.type === "farfetch") {
    const allUrls = config.categoryUrls ?? []
    if (allUrls.length === 0) {
      console.log(`   ❌ ${config.key}: categoryUrls is empty — cannot probe`)
      return
    }
    // Top-level pages (`/men/items.aspx`, `/women/items.aspx`) are
    // curated showcases without per-card brand/price text. Prefer L2
    // landings (slugs like `/clothing-2/`, `/shoes-2/`) so the probe
    // exercises the parser's product-extraction path.
    const isL2 = (u: string) => /\/(?:men|women|kids)\/[^/]+\/items\.aspx$/.test(u)
    const probeOrder = [...allUrls.filter(isL2), ...allUrls.filter((u) => !isL2(u))]
    let browser
    try {
      browser = await chromium.launch({headless: true, channel: "chrome"})
    } catch (err) {
      console.log(`   ❌ Chromium (channel:'chrome') launch failed: ${err}`)
      console.log(`      Install with: npx playwright install chrome`)
      return
    }
    const region: FarfetchRegion = config.region === "US" ? "US" : "KR"
    const sourceCurrency: "KRW" | "USD" = region === "US" ? "USD" : "KRW"
    const MAX_PROBE_URLS = 3
    try {
      const ctx = await browser.newContext({
        userAgent: pickFarfetchUserAgent(0),
        viewport: {width: 1440, height: 900},
        ...(region === "US"
          ? {locale: "en-US", timezoneId: "America/New_York"}
          : {locale: "ko-KR", timezoneId: "Asia/Seoul"}),
      })
      const page = await ctx.newPage()
      let probeSucceeded = false
      for (let i = 0; i < Math.min(MAX_PROBE_URLS, probeOrder.length); i++) {
        const url = probeOrder[i]!
        if (i > 0) await page.waitForTimeout(2000)
        console.log(`   ⏳ [${i + 1}/${Math.min(MAX_PROBE_URLS, probeOrder.length)}] ${url}`)
        const response = await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000})
        const body = await page.content()
        const title = await page.title()
        const intercept = detectFarfetchChallenge(body, title)
        if (intercept.isIntercept) {
          console.log(`      ❌ intercept detected (${intercept.reason}); body=${body.length} bytes`)
          continue
        }
        try {
          await page.waitForSelector('[data-component*="ProductCard"]', {timeout: 15000})
        } catch {}
        for (let s = 0; s < 4; s++) {
          await page.evaluate((y: number) => window.scrollTo(0, y), (s + 1) * 800).catch(() => {})
          await page.waitForTimeout(400)
        }
        const cards = await extractFarfetchCards(page)
        const gender = deriveFarfetchGender(url)
        const products = parseFarfetchCards(cards, config.baseUrl, config.key, region, sourceCurrency, gender)
        console.log(`      HTTP=${response?.status()} cards=${cards.length} products=${products.length}`)
        if (products.length > 0) {
          console.log(`   ✅ Farfetch DOM-scrape OK; sample 3:`)
          for (const p of products.slice(0, 3)) {
            console.log(`      ${p.priceFormatted} — ${p.brand} ${p.name.slice(0, 30)} → ${p.productUrl.slice(0, 80)}`)
          }
          probeSucceeded = true
          break
        }
        console.log(`      ⚠️  cards extracted but no product parsed (likely curated/top-level page) — trying next URL`)
      }
      if (!probeSucceeded) {
        console.log(`   ❌ all probed URLs returned 0 parsed products — selector drift or empty catalog`)
      }
      await ctx.close()
    } catch (err) {
      console.log(`   ❌ probe failed: ${err}`)
    } finally {
      await browser.close().catch(() => {})
    }
    return
  }

  if (config.type === "shopify") {
    try {
      const res = await fetch(`${config.baseUrl}/products.json?limit=1`)
      if (res.ok) {
        const data = await res.json()
        console.log(`   ✅ Shopify /products.json 접근 가능`)
        console.log(`   📦 샘플: ${data.products?.[0]?.title || "없음"}`)
      } else {
        console.log(`   ❌ HTTP ${res.status}`)
      }
    } catch (err) {
      console.log(`   ❌ 접속 실패: ${err}`)
    }
    return
  }

  // Cafe24 프로빙
  const browser = await chromium.launch({headless: true})
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "ko-KR",
  })
  const page = await context.newPage()

  try {
    // 메인 페이지 접속
    const response = await page.goto(config.baseUrl, {waitUntil: "domcontentloaded", timeout: 30000})
    console.log(`   HTTP: ${response?.status()}`)
    await page.waitForTimeout(2000)

    // 카테고리 링크 수집
    const cateLinks = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="cate_no="]')
      return Array.from(links).slice(0, 20).map((a) => ({
        text: a.textContent?.trim().replace(/\s+/g, " ").slice(0, 30) || "",
        href: a.getAttribute("href") || "",
      }))
    })
    console.log(`   📋 카테고리 링크: ${cateLinks.length}개`)
    for (const l of cateLinks.slice(0, 8)) {
      console.log(`      ${l.text} → ${l.href}`)
    }

    // 상품 리스트 페이지 구조 확인
    if (cateLinks.length > 0) {
      const firstHref = cateLinks[0].href
      const testUrl = firstHref.startsWith("http")
        ? firstHref
        : `${config.baseUrl}${firstHref.startsWith("/") ? "" : "/"}${firstHref}`

      await page.goto(testUrl, {waitUntil: "domcontentloaded", timeout: 30000})
      await page.waitForTimeout(2000)

      const structure = await page.evaluate(() => {
        const selectors = [
          'li[id^="anchorBoxId"]',
          "ul.thumbnail > li",
          "ul.prdList > li",
          ".product-list .item",
          ".grid-list > li",
        ]
        const results: {selector: string; count: number}[] = []
        for (const sel of selectors) {
          const count = document.querySelectorAll(sel).length
          if (count > 0) results.push({selector: sel, count})
        }
        return results
      })

      console.log(`\n   🔧 상품 셀렉터 탐지:`)
      for (const s of structure) {
        console.log(`      ${s.selector} → ${s.count}개`)
      }

      if (structure.length === 0) {
        console.log(`      ⚠️ 기본 셀렉터로 상품을 찾지 못함 — 커스텀 셀렉터 필요`)
        // 페이지 구조 힌트 출력
        const hints = await page.evaluate(() => {
          const allLists = document.querySelectorAll("ul, ol, div.grid, div.list")
          return Array.from(allLists)
            .slice(0, 5)
            .map((el) => ({
              tag: el.tagName,
              className: el.className.slice(0, 60),
              children: el.children.length,
            }))
        })
        console.log(`\n   📐 페이지 구조 힌트:`)
        for (const h of hints) {
          console.log(`      <${h.tag.toLowerCase()} class="${h.className}"> (${h.children} children)`)
        }
      }
    }
  } catch (err) {
    console.log(`   ❌ 프로빙 실패: ${err}`)
  } finally {
    await browser.close()
  }
}

// ─── 크롤 실행 ────────────────────────────────────────

const PARALLEL_LIMIT = 3 // 동시 브라우저 수

// 사이트 전체 크롤 상한 — 한 사이트가 어딘가에서 멈춰도(무한 hang) 배치 전체가
// 얼어붙지 않도록 강제 중단한다. crawlCafe24 내부에는 evaluate/detail 단위
// timeout이 있지만, 사이트 단위 전체 안전망이 별도로 필요하다.
const SITE_TIMEOUT_MS = 120 * 60_000 // 120분 — 대형 카탈로그(1000+ 상품, 상세 크롤 포함) 완주 여유

const withSiteTimeout = <T>(promise: Promise<T>, site: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`site timeout after ${SITE_TIMEOUT_MS / 60_000}min: ${site}`)),
        SITE_TIMEOUT_MS,
      ),
    ),
  ])

async function runCrawl(configs: SiteConfig[], dryRun: boolean) {
  const results: CrawlResult[] = []
  const outDir = path.join(process.cwd(), "data")
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive: true})

  const cafe24Sites = configs.filter((c) => c.type === "cafe24")
  const shopifySites = configs.filter((c) => c.type === "shopify")
  const uniqloSites = configs.filter((c) => c.type === "uniqlo")
  const zaraSites = configs.filter((c) => c.type === "zara")
  const twentyninecmSites = configs.filter((c) => c.type === "29cm")
  const farfetchSites = configs.filter((c) => c.type === "farfetch")

  // Uniqlo (브라우저 불필요 — fetch 기반 병렬)
  if (uniqloSites.length > 0) {
    // REQ-004 pre-flight: every Uniqlo site must pass robots-check before
    // any product fetch. crawlUniqlo also re-checks internally so the
    // engine remains correct when invoked directly, but we surface the
    // block early at the dispatch level for clearer operator output.
    for (const config of uniqloSites) {
      const robots = await checkRobots(config.baseUrl)
      if (!robots.allowed) {
        console.error(
          `❌ robots-block: ${config.key} blocked by robots.txt (${robots.blockingLine ?? "unknown"}). ` +
            `Project HARD rule #1: sites that explicitly forbid crawling MUST be deferred.`,
        )
        process.exit(1)
      }
    }
    const uniqloResults = await Promise.all(
      uniqloSites.map(async (config) => {
        try {
          if (dryRun) {
            await probeSite(config)
            return null
          }
          const result = await crawlUniqlo(config)
          return saveResultAndTrim(outDir, result)
        } catch (err) {
          console.error(`❌ ${config.name} 크롤 실패:`, err)
          return null
        }
      }),
    )
    results.push(...uniqloResults.filter((r): r is CrawlResult => r !== null))
  }

  // ZARA — sequential (each crawl launches its own Chromium browser
  // internally; running in parallel multiplies memory cost without
  // throughput benefit at the current 1-platform scale).
  if (zaraSites.length > 0) {
    for (const config of zaraSites) {
      const robots = await checkRobots(config.baseUrl)
      if (!robots.allowed) {
        console.error(
          `❌ robots-block: ${config.key} blocked by robots.txt (${robots.blockingLine ?? "unknown"}). ` +
            `Project HARD rule #1: sites that explicitly forbid crawling MUST be deferred.`,
        )
        process.exit(1)
      }
    }
    for (const config of zaraSites) {
      try {
        if (dryRun) {
          await probeSite(config)
          continue
        }
        const result = await crawlZara(config)
        results.push(saveResultAndTrim(outDir, result))
      } catch (err) {
        console.error(`❌ ${config.name} 크롤 실패:`, err)
      }
    }
  }

  // 29CM — sequential (each crawl launches its own Chromium browser
  // internally; mirrors ZARA's per-engine browser-launch pattern).
  if (twentyninecmSites.length > 0) {
    for (const config of twentyninecmSites) {
      const robots = await checkRobots(config.baseUrl)
      if (!robots.allowed) {
        console.error(
          `❌ robots-block: ${config.key} blocked by robots.txt (${robots.blockingLine ?? "unknown"}). ` +
            `Project HARD rule #1: sites that explicitly forbid crawling MUST be deferred.`,
        )
        process.exit(1)
      }
    }
    for (const config of twentyninecmSites) {
      try {
        if (dryRun) {
          await probeSite(config)
          continue
        }
        const result = await crawl29cm(config)
        results.push(saveResultAndTrim(outDir, result))
      } catch (err) {
        console.error(`❌ ${config.name} 크롤 실패:`, err)
      }
    }
  }

  // Farfetch — sequential (each crawl launches its own Chromium internally;
  // mirrors ZARA's per-engine browser-launch pattern).
  if (farfetchSites.length > 0) {
    for (const config of farfetchSites) {
      const robots = await checkRobots(config.baseUrl)
      if (!robots.allowed) {
        console.error(
          `❌ robots-block: ${config.key} blocked by robots.txt (${robots.blockingLine ?? "unknown"}). ` +
            `Project HARD rule #1: sites that explicitly forbid crawling MUST be deferred.`,
        )
        process.exit(1)
      }
    }
    for (const config of farfetchSites) {
      try {
        if (dryRun) {
          await probeSite(config)
          continue
        }
        const result = await crawlFarfetch(config)
        results.push(saveResultAndTrim(outDir, result))
      } catch (err) {
        console.error(`❌ ${config.name} 크롤 실패:`, err)
      }
    }
  }

  // Shopify — sequential per site (fetch-based, no browser needed) with
  // inter-site delay to respect Shopify/Cloudflare per-IP rate limits.
  // Empirical 2026-05-07: parallel Promise.all of 10 sites triggered
  // HTTP 429 across most of them; cooldown was ~10–30 minutes.
  // Sequential + 5-sec inter-site delay keeps total throughput well below
  // Shopify's per-IP burst threshold while preserving correctness.
  // SPEC-PLATFORM-EXPANSION-007 v0.2.2 (2026-05-07).
  if (shopifySites.length > 0) {
    const SHOPIFY_INTER_SITE_DELAY_MS = 5000
    for (let i = 0; i < shopifySites.length; i++) {
      const config = shopifySites[i]!
      if (i > 0) {
        await new Promise((r) => setTimeout(r, SHOPIFY_INTER_SITE_DELAY_MS))
      }
      try {
        if (dryRun) {
          await probeSite(config)
          continue
        }
        const result = await crawlShopify(config)
        results.push(saveResultAndTrim(outDir, result))
      } catch (err) {
        console.error(`❌ ${config.name} 크롤 실패:`, err)
      }
    }
  }

  // Cafe24 — 사이트별 병렬 (워커 풀: PARALLEL_LIMIT개 동시, 하나 끝나면 큐에서 바로 다음 투입)
  if (cafe24Sites.length > 0) {
    console.log(`\n⚡ 병렬 크롤링: ${cafe24Sites.length}개 사이트, ${PARALLEL_LIMIT}개 동시 (큐 방식)\n`)

    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < cafe24Sites.length) {
        const config = cafe24Sites[nextIndex++]!
        console.log(`\n🔄 시작 (${nextIndex}/${cafe24Sites.length}): ${config.name}`)

        // 사이트마다 독립 브라우저
        const browser = await chromium.launch({headless: true})
        const context = await browser.newContext({
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          locale: "ko-KR",
        })
        const page = await context.newPage()
        // JS 팝업(alert/confirm 등)을 즉시 닫는다 — 안 닫고 두면 브라우저 종료 시
        // Playwright 내부 dialog 핸들링이 uncaught rejection을 던져 전체 배치
        // 프로세스가 죽는다 (2026-07-06, kupido-movingwear/hagamos 크롤 중 확인).
        page.on("dialog", (d) => d.dismiss().catch(() => {}))

        try {
          if (dryRun) {
            await probeSite(config)
            continue
          }
          const dp = config.crawlDetails ? getDetailParser(config.key) : undefined
          const rp = config.crawlReviews ? getReviewParser(config.key) : undefined
          const existingDetails = config.crawlDetails ? loadExistingDetails(outDir, config.key) : undefined
          if (existingDetails && existingDetails.size > 0) {
            console.log(`[${config.name}] ⏭️  이전 체크포인트 재사용 — ${existingDetails.size}개 상품 상세 스킵`)
          }
          const onDetailProgress = (products: Product[]) => saveCheckpoint(outDir, config.key, products)
          const result = await withSiteTimeout(
            crawlCafe24(page, config, dp, rp, onDetailProgress, existingDetails),
            config.key,
          )
          results.push(saveResultAndTrim(outDir, result))
        } catch (err) {
          console.error(`❌ ${config.name} 크롤 실패:`, err)
        } finally {
          await browser.close()
        }
      }
    }

    await Promise.all(
      Array.from({length: Math.min(PARALLEL_LIMIT, cafe24Sites.length)}, () => worker())
    )
  }

  if (!dryRun && results.length > 0) {
    await printSummary(results)
  }
}

function writeProductsFile(outDir: string, platform: string, rawProducts: Product[]) {
  if (rawProducts.length === 0) return

  // SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-001/002: validate every parsed
  // product before it is written to JSON. Valid products pass through
  // byte-identical; invalid ones are excluded + a structured reject
  // event is emitted. Flag OFF (CRAWLER_VALIDATION_ENABLED=false) →
  // exact legacy behavior (all products written, no gate).
  const qcProducts = applyProductQcGate(rawProducts, platform)
  const products = applyValidationGate(qcProducts, platform)
  if (products.length === 0) return

  const outPath = path.join(outDir, `${platform}-products.json`)
  fs.writeFileSync(outPath, JSON.stringify(products, null, 2), "utf-8")
  console.log(`   💾 저장: ${outPath}`)
}

function saveResult(outDir: string, result: CrawlResult) {
  writeProductsFile(outDir, result.platform, result.products)
}

// 상세크롤 도중 주기적으로 지금까지의 진행 상황을 디스크에 반영한다 — 대형
// 카탈로그(1000+ 상품) 크롤 도중 프로세스가 죽어도 이미 끝낸 작업이 통째로
// 유실되지 않도록 함 (2026-07-06, hippiedippy 1511개 중 795개 완료 상태에서
// 유실된 사고). crawlCafe24()가 아직 반환하기 전에 호출되므로 saveResultAndTrim
// 의 "사이트 완료 시 products 비움" 불변식과는 무관 — 별개의 중간 저장일 뿐이다.
function saveCheckpoint(outDir: string, platform: string, products: Product[]) {
  writeProductsFile(outDir, platform, products)
}

// 재시작 스킵: 이전 실행(체크포인트든 정상 완료든)의 결과 파일이 있으면
// productUrl → 상세정보(색상 등)만 가벼운 Map으로 뽑아온다. 전체 Product 객체를
// 복제해서 들고 있지 않음 — 사이트당 최대 한 벌의 전체 배열만 메모리에 존재하도록
// (2026-07-06).
function loadExistingDetails(outDir: string, platform: string): Map<string, DetailData> {
  const map = new Map<string, DetailData>()
  const outPath = path.join(outDir, `${platform}-products.json`)
  if (!fs.existsSync(outPath)) return map
  try {
    const prior = JSON.parse(fs.readFileSync(outPath, "utf-8")) as Product[]
    for (const p of prior) {
      if (p.productUrl && p.color) {
        map.set(p.productUrl, {
          color: p.color,
          description: p.description ?? null,
          material: p.material ?? null,
          productCode: p.productCode ?? null,
        })
      }
    }
  } catch {
    // 손상된 이전 파일 — 그냥 처음부터 크롤
  }
  return map
}

// `results`는 printSummary까지 사이트별 stats/errors 를 보존해야 하지만,
// products 배열(description/images/reviews 포함)까지 전체 런 끝까지 들고
// 있을 필요는 없다 — 31개 cafe24 사이트 detail 크롤 시 heap OOM 유발 확인
// (2026-07-05). 디스크에 쓴 직후 products 를 비워서 GC가 회수하게 한다.
function saveResultAndTrim(outDir: string, result: CrawlResult): CrawlResult {
  saveResult(outDir, result)
  return {...result, products: []}
}

async function printSummary(results: CrawlResult[]) {
  for (const r of results) {
    await syncCrawlResultToQueue(r)
  }

  console.log("\n" + "═".repeat(60))
  console.log("🏁 전체 크롤링 완료")
  console.log("═".repeat(60))

  let totalProducts = 0
  let totalBrands = 0
  let totalErrors = 0

  console.log(`\n${"플랫폼".padEnd(20)} ${"상품".padStart(6)} ${"재고".padStart(6)} ${"브랜드".padStart(6)} ${"시간".padStart(8)}`)
  console.log("─".repeat(50))

  for (const r of results) {
    const config = getSiteConfig(r.platform)
    const name = config?.name || r.platform
    console.log(
      `${name.padEnd(20)} ${String(r.stats.totalProducts).padStart(6)} ${String(r.stats.inStock).padStart(6)} ${String(r.stats.uniqueBrands).padStart(6)} ${(r.stats.duration / 1000).toFixed(1).padStart(7)}s`
    )
    totalProducts += r.stats.totalProducts
    totalBrands += r.stats.uniqueBrands
    totalErrors += r.errors.length
  }

  console.log("─".repeat(50))
  console.log(
    `${"합계".padEnd(20)} ${String(totalProducts).padStart(6)} ${" ".padStart(6)} ${String(totalBrands).padStart(6)}`
  )

  if (totalErrors > 0) {
    console.log(`\n⚠️ 에러 ${totalErrors}건:`)
    for (const r of results) {
      for (const e of r.errors) {
        console.log(`   [${r.platform}] ${e}`)
      }
    }
  }

  printProductQcReport()
  printDropReport()

  console.log("\n" + "═".repeat(60))
}

/**
 * validation 게이트에서 드롭된 상품을 사이트별·사유별로 요약 출력.
 * "왜 안 적재됐지"를 로그를 뒤지지 않고 한눈에 보게 한다 (color/gender/category 공백 추적).
 */
function printDropReport() {
  const report = getValidationReport()
  if (report.size === 0) return

  console.log("\n" + "─".repeat(60))
  console.log("🚫 적재 제외(validation 드롭) 요약")
  console.log("─".repeat(60))

  for (const [site, stat] of report) {
    const config = getSiteConfig(site)
    const name = config?.name || site
    const fields = Object.entries(stat.byField)
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${f}=${n}`)
      .join(", ")
    console.log(`\n[${name}] 총 ${stat.total}개 드롭 — ${fields}`)
    for (const [field, skus] of Object.entries(stat.samples)) {
      if (skus.length === 0) continue
      console.log(`   ${field} 샘플:`)
      for (const sku of skus) console.log(`     - ${sku}`)
    }
  }
}

function printProductQcReport() {
  const report = getProductQcReport()
  if (report.size === 0) return

  console.log("\n" + "-".repeat(60))
  console.log("Product QC summary")
  console.log("-".repeat(60))

  for (const [site, stat] of report) {
    const config = getSiteConfig(site)
    const name = config?.name || site
    const reasons = Object.entries(stat.byReason)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ")
    console.log(
      `\n[${name}] total=${stat.total}, keep=${stat.kept}, auto_fix=${stat.autoFixed}, review=${stat.review}, reject=${stat.rejected}`,
    )
    if (reasons) console.log(`   reasons: ${reasons}`)
    for (const [reason, skus] of Object.entries(stat.samples)) {
      if (skus.length === 0) continue
      console.log(`   ${reason} samples:`)
      for (const sku of skus) console.log(`     - ${sku}`)
    }
  }
}

// ─── 엔트리 ──────────────────────────────────────────

async function main() {
  const flags = parseArgs()
  const detailFlag = !!flags.detail
  const reviewFlag = !!flags.reviews

  // REQ-007: --rate=N parser. Validate at parse time BEFORE any fetch.
  // Rejects N>5, N<=0, non-integer N (e.g. 2.5, "abc").
  let rateOverrideMs: number | null = null
  if (typeof flags.rate === "string") {
    const parsed = parseRateFlag(flags.rate)
    if (parsed instanceof Error) {
      console.error(`❌ ${parsed.message}`)
      process.exit(1)
    }
    rateOverrideMs = parsed.delayMs
    console.log(`⏱  --rate=${parsed.ratePerSecond}: per-request delay overridden to ${rateOverrideMs}ms`)
  }

  // --list: 플랫폼 목록 출력
  if (flags.list) {
    console.log("\n📋 등록된 플랫폼:")
    console.log(`\n${"키".padEnd(20)} ${"이름".padEnd(16)} ${"타입".padEnd(10)} ${"상태".padEnd(6)}`)
    console.log("─".repeat(55))
    for (const p of PLATFORMS) {
      console.log(
        `${p.key.padEnd(20)} ${p.name.padEnd(16)} ${p.type.padEnd(10)} ${p.disabled ? "비활성" : "활성"}`
      )
    }
    console.log(`\n총 ${PLATFORMS.length}개 (활성 ${getActivePlatforms().length}개)`)
    return
  }

  // --probe: 사이트 구조 프로빙
  if (typeof flags.probe === "string") {
    const keys = flags.probe.split(",")
    for (const key of keys) {
      const config = getSiteConfig(key.trim())
      if (!config) {
        console.error(`❌ 알 수 없는 플랫폼: ${key}`)
        continue
      }
      await probeSite(config)
    }
    return
  }

  // 크롤 대상 결정
  let targets: SiteConfig[] = []
  const dryRun = !!flags["dry-run"]

  if (flags.all) {
    targets = getActivePlatforms()
  } else if (typeof flags.type === "string") {
    // SPEC-PLATFORM-AUTOMATION-009 (2026-05-07): support comma-separated
    // types so cron can run e.g. `--type=shopify,uniqlo,zara,29cm,farfetch`
    // (Cafe24 KR self-brands excluded from daily cron by user direction).
    const types = flags.type.split(",").map((t) => t.trim()).filter(Boolean)
    const seen = new Set<string>()
    for (const t of types) {
      for (const c of getPlatformsByType(t as SiteConfig["type"])) {
        if (!seen.has(c.key)) { seen.add(c.key); targets.push(c) }
      }
    }
  } else if (typeof flags.site === "string") {
    const keys = flags.site.split(",")
    for (const key of keys) {
      const config = getSiteConfig(key.trim())
      if (config) {
        targets.push(config)
      } else {
        console.error(`❌ 알 수 없는 플랫폼: ${key} (--list로 확인)`)
      }
    }
  }

  // Apply exclusions (combine with any of --all/--type/--site selections).
  // SPEC-PLATFORM-AUTOMATION-009 (2026-05-07).
  if (typeof flags["exclude-type"] === "string") {
    const excludeTypes = new Set(
      flags["exclude-type"].split(",").map((t) => t.trim()).filter(Boolean)
    )
    targets = targets.filter((c) => !excludeTypes.has(c.type))
  }
  if (typeof flags["exclude-site"] === "string") {
    const excludeSites = new Set(
      flags["exclude-site"].split(",").map((s) => s.trim()).filter(Boolean)
    )
    targets = targets.filter((c) => !excludeSites.has(c.key))
  }

  if (targets.length === 0 && !flags.list && !flags.probe) {
    console.log(`
🕷️ 범용 플랫폼 크롤러

사용법:
  npx tsx scripts/crawl.ts --list                                등록된 플랫폼 목록
  npx tsx scripts/crawl.ts --site=obscura                        단일 사이트 크롤
  npx tsx scripts/crawl.ts --site=obscura,llud                   복수 사이트
  npx tsx scripts/crawl.ts --all                                 전체 크롤링
  npx tsx scripts/crawl.ts --type=cafe24                         단일 타입
  npx tsx scripts/crawl.ts --type=shopify,uniqlo,zara,29cm,farfetch   복수 타입
  npx tsx scripts/crawl.ts --all --exclude-type=cafe24           Cafe24 제외 전체
  npx tsx scripts/crawl.ts --all --exclude-site=heights-store    특정 사이트 제외
  npx tsx scripts/crawl.ts --probe=obscura                       사이트 구조 프로빙
  npx tsx scripts/crawl.ts --dry-run --site=obscura              카테고리만 탐색

옵션:
  --list                  등록된 플랫폼 목록
  --site=KEY[,KEY,...]    크롤링 대상 (콤마 구분)
  --all                   전체 활성 플랫폼
  --type=TYPE[,TYPE,...]  타입별: cafe24, shopify, uniqlo, zara, 29cm, farfetch (콤마 구분)
  --exclude-type=TYPE     선택된 타겟에서 타입 제외 (--all과 조합)
  --exclude-site=KEY      선택된 타겟에서 사이트 제외
  --probe=KEY             사이트 구조 확인
  --dry-run               카테고리 탐색만 (상품 안 긁음)
  --detail      상세 페이지 크롤링 (description, color, material 수집)
  --reviews     리뷰 크롤링 (--detail 없이도 가능, 리뷰 보드 페이지 기반)
`)
    return
  }

  if (targets.length === 0) {
    console.error("❌ 크롤링 대상이 없습니다")
    return
  }

  if (detailFlag) {
    for (const config of targets) {
      config.crawlDetails = true
    }
    console.log("📖 상세 페이지 크롤링 활성화")
  }

  if (reviewFlag) {
    for (const config of targets) {
      config.crawlReviews = true
    }
    console.log("💬 리뷰 크롤링 활성화")
  }

  if (rateOverrideMs !== null) {
    for (const config of targets) {
      config.crawlDelay = rateOverrideMs
    }
  }

  lintGenderConfig(targets)

  console.log(`\n🚀 크롤링 시작: ${targets.map((t) => t.name).join(", ")}`)
  if (dryRun) console.log("   (dry-run 모드 — 카테고리 탐색만)")

  await runCrawl(targets, dryRun)
}

/**
 * 크롤 전 gender config 린트: manual 카테고리인데 gender 가 비어 있고
 * defaultGender 도 없는 사이트를 경고한다. 이런 상품은 gender=[] 로 나와
 * validation 에서 전량 드롭되므로, 크롤을 돌리기 전에 한 번만 설정하도록 유도.
 */
function lintGenderConfig(targets: SiteConfig[]) {
  const warnings: string[] = []
  for (const c of targets) {
    if (c.type !== "cafe24") continue
    if (c.category?.discovery !== "manual" || !c.category.categories) continue
    if (c.defaultGender && c.defaultGender.length > 0) continue
    const missing = c.category.categories.filter((cat) => !cat.gender || cat.gender.length === 0)
    if (missing.length > 0) {
      const sample = missing.slice(0, 3).map((m) => `${m.name}(cate_no=${m.cateNo})`).join(", ")
      warnings.push(
        `   [${c.name}] gender 미지정 카테고리 ${missing.length}개 (예: ${sample}) — defaultGender 또는 각 카테고리 gender 설정 권장`
      )
    }
  }
  if (warnings.length > 0) {
    console.log("\n⚠️ gender config 점검 (미설정 시 해당 상품 전량 적재 제외):")
    for (const w of warnings) console.log(w)
  }
}

// 안전망: 개별 사이트 크롤은 각자 try/catch로 감싸져 있지만, Playwright의 내부
// CDP 이벤트 핸들링(예: dialog 처리 중 context가 닫히는 경우) 은 그 바깥에서
// unhandledRejection 으로 터질 수 있다 — 이게 전체 배치를 죽인 사고가 있었음
// (2026-07-06, 50개 배치 크롤 중 kupido-movingwear/hagamos 에서 발생).
// 로그만 남기고 배치는 계속 진행한다.
process.on("unhandledRejection", (reason) => {
  console.error(`\n⚠️ unhandledRejection (배치 계속 진행):`, reason)
})

main()
  .then(() => {
    // queueDb(supabase-js) 사용 시 내부 keep-alive 핸들이 남아 프로세스가
    // 자연 종료되지 않는다. 모든 크롤/큐 write 는 main() 완료 시점에 이미
    // await 로 끝났으므로 명시적으로 종료한다.
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

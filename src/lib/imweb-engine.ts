/**
 * imweb(아임웹) 크롤 엔진 — 커스텀 브랜드 파일럿 (2026-07)
 *
 * 구조 (스파이크 실측: heretic.kr / aubour.com):
 *   - 리스트: 렌더된 카테고리 페이지의 `.shop-item` 요소가
 *     `data-product-properties` JSON 속성을 갖는다
 *     ({idx, code, name, original_price, price, image_url}) — DOM 텍스트
 *     스크래핑 불필요. 링크는 `a[href*="?idx="]`.
 *   - 상세: JSON-LD schema.org/Product 완비 (brand/offers/availability)
 *     → parsers/structured-data.ts 의 extractStructuredProduct() 재사용.
 *   - 갱신(리스트-only): data-product-properties의 price/original_price만으로
 *     가격·세일 확보 — LLM 0회, 결정적 경로.
 *
 * 클라이언트 렌더링(XHR 위젯)이라 Playwright 필수. 브랜드는 단일브랜드
 * 자사몰 원칙에 따라 config.brand 고정 (cafe24-engine과 동일 — DOM 추출은
 * 멀티브랜드 편집샵 전용 폴백).
 */

import {chromium, type Browser, type Page} from "playwright"
import type {CrawlResult, Product, SiteConfig} from "./types"
import {extractStructuredProduct} from "./parsers/structured-data"
import {CURRENCY_SYMBOL} from "./fx"

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const LIST_RENDER_WAIT_MS = 5000
const NAV_TIMEOUT_MS = 30000

/**
 * `.shop-item` 렌더 대기 — 아이템이 있는 페이지는 1~2s에 resolve, 없는
 * 페이지만 LIST_RENDER_WAIT_MS 전체를 소모한다 (고정 waitForTimeout 대비
 * 파일럿 실측 2배+ 단축). resolve 후 짧은 settle로 위젯 지연 항목을 흡수.
 */
async function waitForShopItems(page: Page): Promise<void> {
  const found = await page
    .waitForSelector(".shop-item", {timeout: LIST_RENDER_WAIT_MS, state: "attached"})
    .then(() => true)
    .catch(() => false)
  if (found) await page.waitForTimeout(800)
}
/** 자동 카테고리 탐색 시 방문할 내부 링크 상한 */
const DISCOVERY_MAX_PAGES = 30
/** 상세 크롤 기본 딜레이 */
const DEFAULT_CRAWL_DELAY_MS = 1200

/** `.shop-item`의 data-product-properties JSON (실측 스키마) */
export interface ImwebItemProperties {
  idx?: number | string
  code?: string
  name?: string
  original_price?: number | string
  price?: number | string
  image_url?: string
}

export interface ImwebListItem {
  properties: ImwebItemProperties
  /** 절대 URL로 정규화된 상품 링크 */
  link: string | null
  /** SOLD OUT 배지 텍스트 감지 (리스트 단계 근사값 — 상세 availability가 우선) */
  soldOutBadge: boolean
}

function toNumber(value: number | string | undefined): number | null {
  // KRW 정수 반올림 — imweb 세일가는 소수점(예: 27599.99)으로 내려오는데
  // DB products.price는 integer라 그대로 보내면 배치 전체가 실패한다 (파일럿 실측).
  if (typeof value === "number" && Number.isFinite(value)) return value > 0 ? Math.round(value) : null
  if (typeof value === "string") {
    const num = Number(value.replace(/[^\d.]/g, ""))
    return Number.isFinite(num) && num > 0 ? Math.round(num) : null
  }
  return null
}

/**
 * @MX:NOTE: [AUTO] Pure list-item → Product mapping seam (browser 비의존,
 * 단위 테스트 대상). shopify-engine의 parseShopifyProducts와 동일한
 * "실제 데이터 필드 우선" 원칙: data-product-properties JSON이 원천이고
 * DOM 텍스트는 쓰지 않는다.
 */
export function parseImwebListItem(
  item: ImwebListItem,
  config: Pick<SiteConfig, "key" | "name" | "brand" | "sourceCurrency">,
  category: string,
): Product | null {
  const props = item.properties
  const name = typeof props.name === "string" ? props.name.trim() : ""
  if (!name || !item.link) return null

  const originalPrice = toNumber(props.original_price)
  const price = toNumber(props.price) ?? originalPrice
  if (price === null) return null

  const onSale = originalPrice !== null && price !== null && price < originalPrice
  const imageUrl = typeof props.image_url === "string" && /^https?:\/\//.test(props.image_url) ? props.image_url : ""

  // imweb 위젯 JSON의 price/original_price는 항상 스토어 원본 통화값이다.
  // 이전에는 sourceCurrency를 전혀 판정하지 않고 KRW로 단정해 저장했는데,
  // 604service(config.sourceCurrency="USD")처럼 원화가 아닌 스토어에서
  // $145 같은 값이 그대로 145원으로 적재되는 사고가 있었다(실측: id 605827).
  // cafe24/shopify 엔진과 동일하게 원본 통화값 그대로 저장하고, KRW 환산은
  // import-products.ts의 기존 sourceCurrency 분기(convertToKrw)에 위임한다.
  const sourceCurrency = config.sourceCurrency || "KRW"

  return {
    // 하우스 브랜드만 사용한다. config.brand 가 없으면 플랫폼명(config.name)으로
    // 폴백하지 않고 빈 브랜드로 남긴다 — platform-as-brand 오염 방지. 단일브랜드
    // imweb 자사몰은 반드시 config.brand 를 설정해야 하며(미설정 시 import 단계에서
    // 격리), 멀티브랜드 편집샵은 온보딩 LLM 브랜드 추출로 처리한다.
    brand: config.brand || "",
    name,
    category,
    price,
    originalPrice: originalPrice ?? price,
    salePrice: onSale ? price : null,
    priceFormatted: sourceCurrency === "KRW"
      ? `₩${price.toLocaleString("ko-KR")}`
      : `${CURRENCY_SYMBOL[sourceCurrency] ?? sourceCurrency}${price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
    imageUrl,
    productUrl: item.link,
    inStock: !item.soldOutBadge,
    platform: config.key,
    crawledAt: new Date().toISOString(),
    images: imageUrl ? [imageUrl] : undefined,
    productCode: typeof props.code === "string" ? props.code : undefined,
    sourceCurrency,
    sourcePrice: price,
  }
}

/** 렌더된 페이지에서 .shop-item들을 추출 (evaluate는 문자열 — tsx __name 헬퍼 주입 회피) */
async function extractListItems(page: Page): Promise<ImwebListItem[]> {
  const raw = (await page.evaluate(`(() => {
    return [...document.querySelectorAll(".shop-item")].map((el) => {
      const a = el.querySelector('a[href]')
      const badge = (el.textContent || "").toUpperCase()
      return {
        propsJson: el.getAttribute("data-product-properties"),
        href: a ? a.getAttribute("href") : null,
        soldOutBadge: badge.includes("SOLD OUT") || badge.includes("품절"),
      }
    })
  })()`)) as Array<{propsJson: string | null; href: string | null; soldOutBadge: boolean}>

  const base = page.url()
  const items: ImwebListItem[] = []
  for (const entry of raw) {
    if (!entry.propsJson) continue
    let properties: ImwebItemProperties
    try {
      properties = JSON.parse(entry.propsJson) as ImwebItemProperties
    } catch {
      continue
    }
    let link: string | null = null
    if (entry.href) {
      try {
        link = new URL(entry.href, base).toString()
      } catch {
        link = null
      }
    }
    items.push({properties, link, soldOutBadge: entry.soldOutBadge})
  }
  return items
}

/**
 * 카테고리 자동 탐색: 홈 내비의 내부 링크를 방문해 `.shop-item`이 렌더되는
 * 페이지만 카테고리로 채택. imweb 메뉴는 `/N`(숫자)·커스텀 슬러그가 혼재라
 * 정적 판별이 불가능하다 (스파이크 실측). config.categoryUrls가 있으면 스킵.
 */
async function discoverCategories(page: Page, baseUrl: string): Promise<Array<{name: string; url: string}>> {
  await page.goto(baseUrl, {waitUntil: "commit", timeout: NAV_TIMEOUT_MS})
  await page.waitForTimeout(LIST_RENDER_WAIT_MS)

  const links = (await page.evaluate(`(() => {
    const skip = /login|logout|join|member|cart|mypage|policy|privacy|guide|board|notice|faq|cs$|about|shop_/i
    const seen = new Set()
    const out = []
    for (const a of document.querySelectorAll("a[href]")) {
      let u
      try { u = new URL(a.href) } catch { continue }
      if (u.hostname !== location.hostname) continue
      const path = u.pathname.replace(/\\/$/, "")
      if (!path || path === "" || skip.test(path) || u.search) continue
      if (seen.has(path)) continue
      seen.add(path)
      out.push({name: (a.textContent || "").trim().slice(0, 40) || path, url: u.origin + path})
    }
    return out
  })()`)) as Array<{name: string; url: string}>

  const categories: Array<{name: string; url: string}> = []
  for (const candidate of links.slice(0, DISCOVERY_MAX_PAGES)) {
    try {
      await page.goto(candidate.url, {waitUntil: "commit", timeout: NAV_TIMEOUT_MS})
      await waitForShopItems(page)
      const count = (await page.evaluate(`document.querySelectorAll(".shop-item").length`)) as number
      if (count > 0) {
        // 메뉴가 리다이렉트되는 경우가 있어(스파이크: /18 → /83) 최종 URL 기준으로 중복 제거
        const finalUrl = page.url().split("#")[0]
        if (!categories.some((c) => c.url === finalUrl)) {
          categories.push({name: candidate.name, url: finalUrl})
        }
      }
    } catch {
      continue
    }
  }
  return categories
}

/**
 * 상세 페이지에서 structured-data(JSON-LD/OG) 기반 필드 보강.
 * imweb 상세의 JSON-LD Product는 서버 렌더링이라(실측: heretic.kr 정적 fetch로
 * 확인) 브라우저 내비 없이 plain fetch로 처리한다 — 상품당 ~5s → ~1.5s.
 */
async function enrichFromDetail(product: Product, delay: number): Promise<void> {
  const res = await fetch(product.productUrl, {
    headers: {"User-Agent": USER_AGENT, Accept: "text/html,*/*"},
    signal: AbortSignal.timeout(NAV_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const structured = extractStructuredProduct(html)
  if (!structured) return

  if (structured.inStock !== null) product.inStock = structured.inStock
  if (structured.images.length > 0) {
    product.images = [...new Set([...(product.images ?? []), ...structured.images])].slice(0, 10)
    if (!product.imageUrl) product.imageUrl = structured.images[0]
  }
  if (structured.sku && !product.productCode) product.productCode = structured.sku
}

export async function crawlImweb(config: SiteConfig): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []
  const products: Product[] = []
  const maxPages = config.maxPages ?? 10
  const delay = config.crawlDelay ?? DEFAULT_CRAWL_DELAY_MS

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl}) [imweb]`)
  console.log(`${"─".repeat(50)}`)

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({headless: true})
    const context = await browser.newContext({userAgent: USER_AGENT})
    const page = await context.newPage()

    // 1. 카테고리: 수동(config.categoryUrls) 우선, 없으면 자동 탐색
    let categories: Array<{name: string; url: string}>
    if (config.categoryUrls && config.categoryUrls.length > 0) {
      categories = config.categoryUrls.map((url) => ({name: "", url}))
    } else {
      categories = await discoverCategories(page, config.baseUrl)
      console.log(`   카테고리 자동 탐색: ${categories.length}개 (${categories.map((c) => c.name).join(", ")})`)
    }
    if (categories.length === 0) errors.push("no categories discovered")

    // 2. 리스트 수집 (?page=N 페이지네이션, 빈 페이지에서 중단)
    const seen = new Set<string>()
    for (const category of categories) {
      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        const url = new URL(category.url)
        if (pageNo > 1) url.searchParams.set("page", String(pageNo))
        try {
          await page.goto(url.toString(), {waitUntil: "commit", timeout: NAV_TIMEOUT_MS})
          await waitForShopItems(page)
        } catch (err) {
          errors.push(`list nav failed: ${url} (${err instanceof Error ? err.message : err})`)
          break
        }
        const items = await extractListItems(page)
        let added = 0
        for (const item of items) {
          const key = String(item.properties.code ?? item.properties.idx ?? item.link)
          if (seen.has(key)) continue
          seen.add(key)
          const product = parseImwebListItem(item, config, category.name)
          if (product) {
            products.push(product)
            added++
          }
        }
        console.log(`   ${category.name || category.url} p${pageNo}: ${items.length}개 항목, 신규 ${added}`)
        if (items.length === 0 || added === 0) break
        await new Promise((r) => setTimeout(r, delay))
      }
    }

    // 3. 상세 보강 (온보딩: description/color/availability — 서버렌더 JSON-LD, fetch 기반)
    if (config.crawlDetails) {
      console.log(`   상세 크롤: ${products.length}개 (fetch)`)
      for (const product of products) {
        try {
          await enrichFromDetail(product, delay)
        } catch (err) {
          errors.push(`detail failed: ${product.productUrl} (${err instanceof Error ? err.message : err})`)
        }
        await new Promise((r) => setTimeout(r, delay))
      }
    }

    await context.close()
  } catch (err) {
    errors.push(`crawl failed: ${err instanceof Error ? err.message : err}`)
  } finally {
    await browser?.close()
  }

  // 품절 상품도 크롤 산출물에 포함한다 (in_stock 필드는 정확히 채워짐 — 재입고
  // 감지·admin 가시성·적재 시점 선택적 필터링을 위해 원본은 완전하게 유지).
  // 다른 엔진(cafe24/shopify)은 여전히 크롤 단계에서 제외하는 기존 정책을 따름 —
  // 실제 DB 반영 여부는 import-products.ts의 `--in-stock-only` 플래그가 결정한다.
  const inStockCount = products.filter((p) => p.inStock).length
  const withPrice = products.filter((p) => p.price !== null)
  const avgPrice =
    withPrice.length > 0 ? Math.round(withPrice.reduce((s, p) => s + (p.price ?? 0), 0) / withPrice.length) : 0

  const result: CrawlResult = {
    platform: config.key,
    products,
    stats: {
      totalProducts: products.length,
      inStock: inStockCount,
      outOfStock: products.length - inStockCount,
      uniqueBrands: new Set(products.map((p) => p.brand)).size,
      avgPrice,
      duration: Date.now() - startTime,
    },
    errors,
  }

  console.log(
    `\n   ✅ ${config.name} 완료: ${result.stats.totalProducts}개 상품 (재고 ${result.stats.inStock}개, 품절 ${result.stats.outOfStock}개, ${(result.stats.duration / 1000).toFixed(1)}s)`,
  )
  return result
}

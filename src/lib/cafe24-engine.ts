/**
 * Cafe24 범용 크롤 엔진
 *
 * Cafe24 기반 쇼핑몰의 공통 패턴:
 *   - 카테고리: /product/list.html?cate_no=XXX
 *   - 상품 목록: ul.thumbnail li / ul.prdList li
 *   - 페이지네이션: ?page=N
 *
 * 사이트마다 테마가 달라 셀렉터가 조금씩 다를 수 있음 → 폴백 셀렉터로 대응
 */

import type {CrawlResult, Product, SiteConfig} from "./types"
import type {Cafe24DetailPageLease, Cafe24Page} from "./cafe24-page"
import type {IDetailParser} from "./parsers/detail"
import type {DetailData} from "./parsers/detail/types"
import type {IReviewParser} from "./parsers/review"
import {
  applyCafe24DetailFallbacks,
  assessCafe24ProductQuality,
  cleanCafe24ProductName,
  dedupeAndFilterCafe24Categories,
  extractCafe24DetailFallbacks,
  filterCafe24ProductsWithUsablePrice,
  parseCafe24CategoryHref,
  runFirstUsefulCafe24Step,
  type Cafe24CategoryCandidate,
} from "./cafe24-chain"

// page.evaluate() has no built-in timeout in Playwright — wrap every evaluate call
// with this to prevent indefinite hangs when page JS is stuck or network stalls.
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
    ),
  ])

// ─── 기본 셀렉터 (폴백 체인) ──────────────────────────

const DEFAULT_SELECTORS = {
  // 상품 아이템: 가장 흔한 것부터
  productItem: [
    'li[id^="anchorBoxId"]',
    "ul.thumbnail > li",
    "ul.prdList > li",
    // li.xans-record- 는 Cafe24 AJAX 로드 완료 후에만 생기는 클래스.
    // .xans-product li보다 앞에 두어야 skeleton(<a href="">) 오판을 막는다.
    "li.xans-record-",
    ".xans-product li",           // LLUD 등 minishop 패턴
    ".product-list .item",
    ".product_listnormal_list > li",
    ".grid-list > li",
    "div[class*=product] li",     // 범용 폴백
  ],
  productName: [
    ".name a",
    ".name span",
    ".name",
    ".nm span",           // sculpstore 패턴
    ".nm a",
    ".nm",
    ".prd-name",
    ".prdt-name",         // cafe24 "PC 2.0" 모던 스킨 패턴 (dadadaseoul 등)
    ".product-name",
    ".tit",
    "strong.title a",
    "div.img img",        // img alt 폴백 (swallowlounge 등 img에만 상품명이 있는 테마)
  ],
  productPrice: [
    ".price .sale_price",
    ".price",
    ".prdt-price",         // cafe24 "PC 2.0" 모던 스킨 패턴 (productName과 동일 계열)
    ".prd-price",
    ".product-price",
    ".sell-price",
    "span.sale_price",
  ],
  productImage: [
    "img.thumb-img",
    "img.ThumbImage",
    ".thumbnail img",
    ".prd-img img",
    "a > img",
    "img",
  ],
  productLink: [
    'a[href*="/product/"]',
    'a[href*="product_no="]',
    ".thumbnail a",
    ".prd-img a",
    "a",
  ],
}

const CAFE24_LIST_READY_SELECTOR = [
  'li[id^="anchorBoxId"] a[href*="/product/"]',
  'li[id^="anchorBoxId"] a[href*="product_no="]',
  'li.xans-record- a[href*="/product/"]',
  'li.xans-record- a[href*="product_no="]',
  'ul.thumbnail > li a[href*="/product/"]',
  'ul.prdList > li a[href*="/product/"]',
  '.product-list .item a[href*="/product/"]',
  '.product_listnormal_list > li a[href*="/product/"]',
  '.grid-list > li a[href*="/product/"]',
].join(", ")

/**
 * Cafe24 목록은 대부분 domcontentloaded 시점에 상품 카드가 이미 있고, 일부 테마만
 * AJAX로 늦게 붙인다. 고정 3초 sleep 대신 실제 상품 링크를 기다리면 SSR 목록은 즉시
 * 진행하고 AJAX/빈 페이지는 기존과 같은 최대 3초 경계를 유지한다.
 */
export async function waitForCafe24ListReady(page: Cafe24Page, timeoutMs = 3000): Promise<void> {
  await page.waitForSelector(CAFE24_LIST_READY_SELECTOR, {timeout: timeoutMs}).catch(() => undefined)
}

// ─── 카테고리 자동 탐색 ───────────────────────────────

interface DiscoveredCategory {
  name: string
  cateNo: number
  url: string
}

/** 사이트별 성능 계측 누적기 (crawlCafe24 1회 호출당 하나 — 병렬 사이트 간 공유 없음). */
interface CrawlTiming {
  listWaitMs: number
}

export interface CrawlCafe24Options {
  detailConcurrency?: number
  createDetailPage?: () => Promise<Cafe24DetailPageLease>
  onDetailProgress?: (products: Product[]) => Promise<void> | void
  existingDetails?: Map<string, DetailData>
  /** POC-only cap for list/detail work; omitted in production crawl paths. */
  sampleLimit?: number
  /**
   * 갱신 전용 모드 — 상세 크롤을 건너뛰고 품절 상품도 결과에 남긴다.
   *
   * 일반 크롤은 품절을 여기서 걸러내지만(적재 대상이 아니므로), 갱신은 "재고
   * 있었는데 지금 품절"을 DB 에 반영해야 하므로 걸러내면 안 된다 — 사라진
   * 상품과 품절 상품이 구분되지 않으면 완전성 가드가 오판한다.
   */
  listingOnly?: boolean
  /**
   * Chromium 전용: deterministic 상세 파싱 직후, 페이지가 리셋/재사용되기 전에
   * 그 살아있는 상세 페이지와 함께 호출된다. product-extraction-poc.ts의 hybrid
   * variant가 두 번째 네비게이션 없이 LLM 보강(category/subcategory/color/
   * description/gender)을 돌릴 수 있게 해준다 (SPEC: .moai/plans/velvet-toasting-star.md).
   * Lightpanda 엔진에는 절대 넘기면 안 된다 — 그쪽 Cafe24Page는 진짜 Playwright
   * Page가 아니라서 llm-scraper(LLMScraper.run)가 요구하는 타입이 아니고, 실측상
   * Playwright의 page.goto/page.evaluate 자체가 Lightpanda와 근본적으로 안 맞아
   * 타임아웃난다 (.moai/plans/lightpanda-spike-report.md).
   */
  enrichDetailPage?: (page: Cafe24Page, product: Product) => Promise<void>
}

function createPlaywrightDetailPageFactory(page: Cafe24Page): () => Promise<Cafe24DetailPageLease> {
  const browser = (
    page as unknown as {
      context?: () => {browser?: () => {
        newContext: () => Promise<{
          route: (pattern: string, handler: (route: {abort: () => unknown}) => unknown) => Promise<unknown>
          newPage: () => Promise<Cafe24Page>
          close: () => Promise<unknown>
        }>
      } | null}
    }
  ).context?.().browser?.()

  if (!browser) {
    throw new Error("Cafe24 detail crawl requires a detail page factory for this browser engine")
  }

  return async () => {
    const ctx = await browser.newContext()
    await ctx.route("**/*.{png,jpg,jpeg,gif,webp,svg,css,woff,woff2}", (route) => route.abort())
    const detailPage = await ctx.newPage()
    ;(detailPage as unknown as {on?: (event: "dialog", handler: (dialog: {dismiss: () => Promise<void>}) => void) => void})
      .on?.("dialog", (dialog) => {
        dialog.dismiss().catch(() => {})
      })
    return {
      page: detailPage,
      close: async () => void (await ctx.close()),
    }
  }
}

function countUniqueInStockProducts(products: Product[]): number {
  const seen = new Set<string>()
  let count = 0
  for (const p of products) {
    if (!p.inStock || !p.productUrl || seen.has(p.productUrl)) continue
    seen.add(p.productUrl)
    count++
  }
  return count
}

async function discoverCategories(
  page: Cafe24Page,
  config: SiteConfig
): Promise<DiscoveredCategory[]> {
  const discoveryUrl = config.category?.discoveryUrl || config.baseUrl
  const ignorePatterns = config.category?.ignorePatterns || []

  await page.goto(discoveryUrl, {waitUntil: "domcontentloaded", timeout: 60000})
  // Cafe24는 JS 렌더링이 필요한 경우가 많음
  await page.waitForTimeout(2000)

  const selectors = [
    config.category?.discoverySelector || 'a[href*="cate_no="]',
    'a[href*="/category/"]',
    'a[href*="/product/list.html"]',
    'a[href*="cate_no="], a[href*="/category/"], a[href*="/product/list.html"]',
  ]

  const extractBySelector = async (selector: string): Promise<Cafe24CategoryCandidate[]> => {
    const links = await withTimeout(
      page.evaluate(({sel}: {sel: string}) => {
        const anchors = document.querySelectorAll(sel)
        return Array.from(anchors).slice(0, 500).map((a) => ({
          text: a.textContent?.trim().replace(/\s+/g, " ") || "",
          href: a.getAttribute("href") || "",
        }))
      }, {sel: selector}),
      20_000,
      `discoverCategories:${selector}`,
    )

    return dedupeAndFilterCafe24Categories(
      links
        .map((link) => parseCafe24CategoryHref(link.href, config.baseUrl, link.text))
        .filter((category): category is Cafe24CategoryCandidate => category !== null),
      ignorePatterns,
    )
  }

  const chain = selectors.map((selector, index) => ({
    name: index === 0 ? "configured-cate-no" : `fallback-${index}`,
    run: () => extractBySelector(selector),
  }))

  const result = await runFirstUsefulCafe24Step(undefined, chain, (value) => value.length >= 2)
  if (result.attempted.length > 1) {
    const attempted = result.attempted.map((s) => `${s.name}:${s.count}`).join(", ")
    console.log(`[${config.name}]    category-chain ${result.strategy} (${attempted})`)
  }

  return result.value
}

// ─── 상품 수집 (단일 페이지) ──────────────────────────

async function collectProductsFromPage(
  page: Cafe24Page,
  config: SiteConfig,
  categoryName: string,
  brandOverride?: string,
  timing?: CrawlTiming
): Promise<Product[]> {
  const selectors = config.selectors || {}

  // 상품 셀렉터가 나타날 때까지 대기 (최대 3초)
  const itemSelectorList = selectors.productItem
    ? [selectors.productItem, ...DEFAULT_SELECTORS.productItem]
    : DEFAULT_SELECTORS.productItem

  // 리스트 아이템이 렌더될 때까지 1회 대기 (OR 셀렉터, 총 상한 3초).
  // 개별 후보를 순차로 기다리면(후보당 3초) 미스마다 3초×N을 스크래핑 전에
  // 낭비하므로, CSS 셀렉터 리스트로 합쳐 "아무거나 먼저 나타나면 즉시 진행"한다.
  // 순서 의존 추출은 이 대기가 아니라 아래 page.evaluate 의 querySelectorAll
  // 루프(첫 non-empty 셀렉터 채택)에 있으며 이 변경과 무관하다.
  const listWaitStart = Date.now()
  await page.waitForSelector(itemSelectorList.join(", "), {timeout: 3000}).catch(() => null)
  if (timing) timing.listWaitMs += Date.now() - listWaitStart

  // 폴백 셀렉터로 상품 아이템 찾기
  // NOTE: page.evaluate 안에 function/const 선언 금지 — tsx의 __name 변환이 브라우저에서 ReferenceError 유발
  const evalArgs = {
    itemSelectors: selectors.productItem
      ? [selectors.productItem, ...DEFAULT_SELECTORS.productItem]
      : DEFAULT_SELECTORS.productItem,
    nameSelectors: selectors.productName
      ? [selectors.productName, ...DEFAULT_SELECTORS.productName]
      : DEFAULT_SELECTORS.productName,
    priceSelectors: selectors.productPrice
      ? [selectors.productPrice, ...DEFAULT_SELECTORS.productPrice]
      : DEFAULT_SELECTORS.productPrice,
    imageSelectors: selectors.productImage
      ? [selectors.productImage, ...DEFAULT_SELECTORS.productImage]
      : DEFAULT_SELECTORS.productImage,
    linkSelectors: selectors.productLink
      ? [selectors.productLink, ...DEFAULT_SELECTORS.productLink]
      : DEFAULT_SELECTORS.productLink,
    categoryName,
    brandNameOverride: brandOverride || "",
    baseUrl: config.baseUrl,
    platformKey: config.key,
    pricePatternStr: config.pricePattern?.source || null,
    sourceCurrency: config.sourceCurrency || "KRW",
  }

  // NOTE: page.evaluate 블록 안에서는 var 사용 — tsx의 __name 변환이 let/const 선언을 브라우저에서 ReferenceError로 유발
  // eslint-disable-next-line no-eval
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const evalResult: {ok: boolean; products?: any[]; error?: string} = await withTimeout(
    page.evaluate((args) => {
    /* eslint-disable no-var */
    try {
      let items: NodeListOf<Element> | null = null
      for (let i = 0; i < args.itemSelectors.length; i++) {
        const els = document.querySelectorAll(args.itemSelectors[i])
        if (els.length > 0) { items = els; break }
      }
      if (!items) return {ok: false as const, error: "no items"}

      // 기본 패턴은 반드시 숫자로 시작해야 한다 — 콤마만 있어도 매치되는 /[\d,]+/는
      // 가격 후보 텍스트가 상품명을 포함한 큰 블록일 때(예: 여러 span/div를 훑는
      // fallback 경로) 상품명 안의 콤마(예: "DRESS, WHITE")를 실제 가격보다 먼저
      // "가격"으로 잘못 캡처한다 → parseInt(",")=NaN → 가격 null (실측: areyou,
      // 381개 중 379개가 이 사고로 전부 null 처리됨).
      const priceRegex = args.pricePatternStr
        ? new RegExp(args.pricePatternStr)
        : (args.sourceCurrency === "KRW" ? /\d[\d,]*/ : /\d+(?:\.\d+)?/)
      const products: Array<Record<string, unknown>> = []

      for (let j = 0; j < items.length; j++) {
        const el = items[j]

        // 상품명 추출: displaynone 요소 제외, ":" 같은 쓰레기값 건너뛰기
        var name = ""
        for (let k = 0; k < args.nameSelectors.length; k++) {
          var nameEls = el.querySelectorAll(args.nameSelectors[k])
          for (var ni = 0; ni < nameEls.length; ni++) {
            var ne = nameEls[ni]
            // displaynone 클래스가 있으면 건너뛰기
            if (ne.classList.contains("displaynone")) continue
            // img 태그는 textContent가 없으므로 alt attribute를 사용
            var txt = ne.tagName === "IMG"
              ? (ne.getAttribute("alt") || "").trim()
              : (ne.textContent || "").trim().replace(/\s+/g, " ")
            // 값 없이 라벨 단어만 있는 접근성 텍스트는 통째로 건너뛴다(예: "상품명"
            // 단독 — 콜론이 없어 아래 stripping 정규식에 안 걸리고 length>2를 통과해
            // name이 "상품명" 자체로 오염되는 사고 실측: 2026-07-18 fragola).
            if (/^(상품명|제조사|판매가|브랜드|소비자가|적립금)\s*:?\s*$/.test(txt)) continue
            // Cafe24 숨은 spec 블록 라벨이 앞에 붙는 사이트 대응: "상품명 : X" → "X"
            txt = txt.replace(/^(상품명|제품명|Product\s*Name|Name|제조사|판매가|브랜드|소비자가|적립금)\s*[:：]\s*/i, "")
            // ":" 또는 1~2글자 쓰레기값 건너뛰기
            if (txt.length > 2 && txt !== ":") { name = txt; break }
          }
          if (name) break
        }
        if (!name) continue

        let priceEl: Element | null = null
        for (let k = 0; k < args.priceSelectors.length; k++) {
          priceEl = el.querySelector(args.priceSelectors[k])
          if (priceEl) break
        }
        // .textContent는 displaynone 자손의 텍스트도 그대로 포함한다. 일부 테마는
        // 할인 전/후 가격을 나란히 숨겨두는데(예: <p class="displaynone"><s>0원</s></p>
        // 146,000원<p class="displaynone">...</p>), 이 경우 "0원"이 앞줄에 와서 첫
        // 숫자 매치가 0이 되어 가격이 통째로 null 처리된다(실측: roseanne). priceEl을
        // 복제해 displaynone 자손을 제거한 뒤 텍스트를 읽어 실제 노출 가격만 남긴다.
        let priceText = ""
        if (priceEl) {
          var priceClone = priceEl.cloneNode(true) as Element
          var hiddenInClone = priceClone.querySelectorAll(".displaynone")
          for (var hi = 0; hi < hiddenInClone.length; hi++) hiddenInClone[hi].remove()
          priceText = (priceClone.textContent || "").trim()
        }

        // 셀렉터 실패 시: 아이템 내 모든 span/p에서 가격 패턴 (₩/KRW + 숫자) 탐색
        if (!priceText) {
          const spans = el.querySelectorAll("span, p, div")
          for (let k = 0; k < spans.length; k++) {
            const t = (spans[k].textContent || "").trim()
            if (
              t.match(/[₩\uFFE6][\d,]+/) ||
              t.match(/KRW\s*[\d,]+/) ||
              t.match(/^\d{1,3}(,\d{3})+원?$/) ||
              (args.sourceCurrency !== "KRW" && t.match(/(?:USD|\$|EUR|€|GBP|£)\s*\d+(?:\.\d+)?/i))
            ) {
              priceText = t
              break
            }
          }
        }

        const priceMatch = priceText.match(priceRegex)
        // 캡처 그룹이 있으면 [1], 없으면 [0]
        const priceStr = priceMatch ? (priceMatch[1] || priceMatch[0]) : null
        const rawPrice = priceStr ? Number(priceStr.replace(/,/g, "")) : null
        // KRW ₩1,000 미만은 비정상 (상품명의 숫자가 파싱된 경우 — e.g. "26SS" → 26).
        // 해외 멀티샵 Cafe24는 $9.12 같은 소수 가격이 정상이라 0 초과만 검사한다.
        let price = rawPrice !== null && (
          args.sourceCurrency === "KRW" ? rawPrice >= 1000 : rawPrice > 0
        ) ? rawPrice : null

        // Cafe24 표준 spec 블록(.xans-product-listitem) 폴백.
        // 일부 테마는 가격을 .price 가 아닌 "판매가 : ₩X" 라벨 텍스트로만 노출 (beslow 등).
        var specText = ""
        var specEls = el.querySelectorAll(".xans-product-listitem")
        for (var sx = 0; sx < specEls.length; sx++) specText += " " + (specEls[sx].textContent || "")
        if (price === null && specText) {
          var specClean = specText.replace(/,/g, "")
          if (args.sourceCurrency === "KRW") {
            var saleM = specClean.match(/할인판매가\s*:?\s*[₩￦]?\s*(\d{4,})/)
            var listM = specClean.match(/판매가\s*:?\s*[₩￦]?\s*(\d{4,})/)
            var specPrice = saleM ? Number(saleM[1]) : (listM ? Number(listM[1]) : null)
            if (specPrice !== null && specPrice >= 1000) price = specPrice
          } else {
            var saleUsdM = specClean.match(/(?:discounted\s*price|sale\s*price|할인판매가)\s*:?\s*(?:USD|\$|EUR|€|GBP|£)?\s*(\d+(?:\.\d+)?)/i)
            var listUsdM = specClean.match(/(?:price|판매가)\s*:?\s*(?:USD|\$|EUR|€|GBP|£)?\s*(\d+(?:\.\d+)?)/i)
            var specCurrencyPrice = saleUsdM ? Number(saleUsdM[1]) : (listUsdM ? Number(listUsdM[1]) : null)
            if (specCurrencyPrice !== null && specCurrencyPrice > 0) price = specCurrencyPrice
          }
        }

        // 이미지: 아이콘/로고가 아닌 실제 상품 이미지 찾기
        var imageUrl = ""
        for (var ik = 0; ik < args.imageSelectors.length; ik++) {
          var imgCandidates = el.querySelectorAll(args.imageSelectors[ik])
          for (var im = 0; im < imgCandidates.length; im++) {
            var imgSrc = (imgCandidates[im].getAttribute("src") || imgCandidates[im].getAttribute("data-original") || imgCandidates[im].getAttribute("data-src") || imgCandidates[im].getAttribute("data-lazy-src") || "")
            // 아이콘/로고/배지 파일 건너뛰기
            if (imgSrc.match(/\/(icon_|logo_|badge_|btn_|blank\.|spacer\.)/i)) continue
            // 너무 작은 이미지 건너뛰기 (width/height 속성 기준)
            var imgW = parseInt(imgCandidates[im].getAttribute("width") || "0", 10)
            var imgH = parseInt(imgCandidates[im].getAttribute("height") || "0", 10)
            if ((imgW > 0 && imgW < 50) || (imgH > 0 && imgH < 50)) continue
            if (imgSrc) { imageUrl = imgSrc; break }
          }
          if (imageUrl) break
        }
        if (imageUrl.startsWith("//")) imageUrl = "https:" + imageUrl

        let linkEl: Element | null = null
        for (let k = 0; k < args.linkSelectors.length; k++) {
          linkEl = el.querySelector(args.linkSelectors[k])
          if (linkEl) break
        }
        const href = linkEl ? (linkEl.getAttribute("href") || "") : ""
        const productUrl = href.startsWith("http")
          ? href
          : href ? args.baseUrl + (href.startsWith("/") ? "" : "/") + href : ""

        // 재고: soldout 요소가 보이면 품절, 숨겨져 있으면 재고 있음
        var inStock = true
        var soldoutEl = el.querySelector('[class*="soldout"], .sold, .sold-out, .icon-soldout')
        if (soldoutEl) {
          // 방법 1: "displaynone" 클래스 (일부 Cafe24 테마)
          // 방법 2: CSS computed display: none (슬로우스테디클럽 등)
          var hasDisplayNoneClass = soldoutEl.classList.contains("displaynone")
          var isHiddenByCSS = window.getComputedStyle(soldoutEl).display === "none"
          // 방법 3: 빈 placeholder 컨테이너 (kyod 등) — 일부 테마는 `.sold` 같은
          // 컨테이너를 모든 상품에 항상 렌더링해두고, 실제 품절일 때만 텍스트/이미지를
          // 채워 넣는다. displaynone도 아니고 CSS로도 안 숨겨진 "빈" 컨테이너는
          // 품절 신호가 아니라 항상 존재하는 뼈대일 뿐이다(재고 있어도 매칭되어
          // 전 상품이 품절 오판되는 사고 실측: kyod).
          var hasNoContent = soldoutEl.children.length === 0 && (soldoutEl.textContent || "").trim() === ""
          inStock = hasDisplayNoneClass || isHiddenByCSS || hasNoContent
        } else {
          // 컨테이너 단위(span/div/p)로 순회하며 "그 요소 자신"의 visibility만
          // 검사하면, displaynone이 안 걸린 부모 컨테이너(예: <div class="promotion">)의
          // textContent를 읽을 때 그 안의 숨김 자손 배지(각각 displaynone인
          // "Sold Out"/"Best"/"New"/"In Stock" span들)까지 통째로 섞여 들어온다
          // (실측: smoothmood — 모든 상품이 "Sold Out" 배지 텍스트 오염으로 재고
          // 0 판정). el 전체를 복제해 displaynone 자손을 먼저 제거한 뒤 남은
          // 텍스트만 검사해야 부모-자손 visibility 불일치를 피한다.
          var elClone = el.cloneNode(true) as Element
          var hiddenInEl = elClone.querySelectorAll(".displaynone")
          for (var hi2 = 0; hi2 < hiddenInEl.length; hi2++) hiddenInEl[hi2].remove()
          var stockText = (elClone.textContent || "").toLowerCase()
          inStock = !stockText.includes("out of stock") && !stockText.includes("품절") && !stockText.includes("sold out")
        }

        // 브랜드: 단일브랜드 자사몰은 config.brand로 명시 선언된 경우 DOM 추측을
        // 아예 건너뛴다. DOM 기반 추측은 멀티브랜드 편집샵에서만 의미가 있고,
        // 자사몰 테마에서는 "상품명 :" 같은 숨김 라벨을 .description 폴백이
        // 잘못 주워오는 경우가 있다(goyowear: .name의 displaynone 라벨 텍스트가
        // .description 첫 줄로 새어 들어옴, taats에서도 동일 패턴 확인).
        let brand = args.brandNameOverride || ""
        if (!brand) {
          // 상품 텍스트에서 추출 (Cafe24 편집샵은 보통 브랜드명이 상품명 앞에 있음)
          const brandEl = el.querySelector(".brand, [class*=brand], .manufacturer, .mf_name, p.b, .b")
          brand = brandEl ? (brandEl.textContent || "").trim() : ""
        }
        // Cafe24 spec 블록의 "브랜드 : X" 라벨 폴백 (멀티브랜드 편집샵 대응)
        if (!brand && specText) {
          var brandM = specText.match(/브랜드\s*:?\s*([^\n:]{2,40}?)(?:\s{2,}|상품명|제조사|판매가|$)/)
          if (brandM) brand = brandM[1].trim()
        }
        // 일부 사이트는 상품명 전체 텍스트 첫 줄이 브랜드
        if (!brand) {
          const firstText = el.querySelector(".description, .spec, .summary")
          var firstBrandLine = firstText ? (firstText.textContent || "").trim().split("\n")[0].trim() : ""
          if (!/^(상품명|제품명|product\s*name|name|제조사|판매가|price|소비자가|적립금)\s*[:：]?/i.test(firstBrandLine)) {
            brand = firstBrandLine
          }
        }

        // 스펙 라벨 누출 가드: 위 두 DOM 폴백(461/471줄)은 매칭된 요소의
        // textContent를 그대로 쓰거나 "첫 줄"만 잘라내는데, 일부 테마는 spec
        // 블록의 여러 라벨(판매가/상품명/제조사 등)을 <br>·인접 span으로 렌더링해
        // 실제 줄바꿈 문자 없이 한 덩어리로 이어붙는다 — 이 경우 "첫 줄" 추출이
        // 라벨 여러 개를 통째로 brand에 담아버린다(실측: brand="판매가 : 125,000,
        // 상품명 : ..." 1,604건). 라벨:콜론 패턴이 하나라도 섞여 있거나, brand가
        // 상품명 그대로 복제된 경우(=DOM에서 상품명을 브랜드로 오인)는 폐기한다.
        // config.brand로 고정된 자사몰(brandNameOverride)에는 이 폴백 자체가
        // 적용되지 않으므로 가드 대상에서 제외.
        if (brand && !args.brandNameOverride) {
          var leaksSpecLabel = /(?:판매가|상품명|제조사|소비자가|적립금|브랜드|원산지|모델명|재질)\s*[:：]/.test(brand)
          var duplicatesName = brand.trim().toLowerCase() === name.trim().toLowerCase()
          if (leaksSpecLabel || duplicatesName || brand.length > 40) brand = ""
        }

        // 세일가: price2 div 체크
        const price2El = el.querySelector(".price2, .sale_price, [class*=sale]")
        let originalPrice = price
        let salePrice: number | null = null
        if (price2El && !price2El.classList.contains("displaynone")) {
          const price2Text = (price2El.textContent || "").trim()
          const price2Match = price2Text.match(priceRegex)
          if (price2Match) {
            const p2 = Number((price2Match[1] || price2Match[0]).replace(/,/g, ""))
            // 메인 가격(371~373줄)과 동일한 KRW 1000원 하한을 여기도 적용한다.
            // 이 하한이 없으면 할인율 배지("10%")나 적립금 텍스트의 작은 숫자가
            // price2 셀렉터에 걸려 세일가로 잘못 캡처된다 (실측: etce 1239건,
            // lossyrow 698건이 이 경로로 1~1000원대 가격이 저장됨).
            const p2Valid = args.sourceCurrency === "KRW" ? p2 >= 1000 : p2 > 0
            if (p2Valid && p2 < (price || Infinity)) {
              // price2가 더 싸면: price=원가, price2=세일가
              originalPrice = price
              salePrice = p2
            }
          }
        }

        var priceFormatted = ""
        if (price) {
          if (args.sourceCurrency === "USD") {
            priceFormatted = "$" + price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})
          } else if (args.sourceCurrency === "EUR") {
            priceFormatted = "€" + price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})
          } else if (args.sourceCurrency === "GBP") {
            priceFormatted = "£" + price.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})
          } else {
            priceFormatted = "₩" + price.toLocaleString()
          }
        }

        products.push({
          brand, name, category: args.categoryName,
          price: salePrice || price,
          originalPrice, salePrice,
          priceFormatted,
          imageUrl, productUrl, inStock,
          platform: args.platformKey,
          sourceCurrency: args.sourceCurrency,
          sourcePrice: salePrice || price || undefined,
          crawledAt: new Date().toISOString(),
        })
      }
      return {ok: true as const, products}
    } catch (e: unknown) {
      return {ok: false as const, error: (e as Error).message}
    }
    /* eslint-enable no-var */
    }, evalArgs),
    20_000,
    "collectProductsFromPage"
  ).catch((err: Error) => ({ok: false as const, error: err.message}))

  if (!evalResult.ok) {
    console.log(`      [eval-error] ${evalResult.error}`)
    return []
  }

  const products = (evalResult.products || []) as Array<Record<string, unknown>>
  for (const p of products) {
    if (typeof p.name === "string") p.name = cleanCafe24ProductName(p.name)
  }

  return products as unknown as Product[]
}

// ─── 카테고리 크롤 (페이지네이션 포함) ────────────────

async function crawlCategory(
  page: Cafe24Page,
  config: SiteConfig,
  category: DiscoveredCategory,
  timing?: CrawlTiming,
  listingOnly = false,
): Promise<Product[]> {
  const allProducts: Product[] = []
  const maxPages = config.maxPages || 10
  const delay = config.crawlDelay || 2000
  const seenUrls = new Set<string>()

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const separator = category.url.includes("?") ? "&" : "?"
    const url = pageNum === 1
      ? category.url
      : `${category.url}${separator}page=${pageNum}`

    try {
      await page.goto(url, {waitUntil: "domcontentloaded", timeout: 60000})
      if (listingOnly) await waitForCafe24ListReady(page)
      else await page.waitForTimeout(3000) // 상세/온보딩 경로의 기존 대기 보존

      const products = await collectProductsFromPage(
        page,
        config,
        category.name,
        config.brand,
        timing
      )

      if (products.length === 0) break // 빈 페이지면 중단

      // 중복 페이지 감지: 이전 페이지와 URL이 동일하면 페이지네이션 루프 방지
      if (pageNum > 1) {
        const newUrls = products.map((p) => p.productUrl).filter(Boolean)
        const hasNew = newUrls.some((u) => !seenUrls.has(u))
        if (!hasNew) break
      }
      for (const p of products) {
        if (p.productUrl) seenUrls.add(p.productUrl)
      }

      allProducts.push(...products)

      // 페이지네이션 비활성이면 첫 페이지만
      if (!config.paginate) break

      await new Promise((r) => setTimeout(r, delay))
    } catch {
      break
    }
  }

  return allProducts
}

// ─── 메인 크롤 함수 ──────────────────────────────────

export async function crawlCafe24(
  page: Cafe24Page,
  config: SiteConfig,
  detailParser?: IDetailParser,
  reviewParser?: IReviewParser,
  options: CrawlCafe24Options = {},
): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []
  const allProducts: Product[] = []
  const timing: CrawlTiming = {listWaitMs: 0}
  let detailMs = 0
  let detailNavCount = 0

  const tag = `[${config.name}]`

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl})`)
  console.log(`${"─".repeat(50)}`)

  // Step 1: 카테고리 탐색
  let categories: DiscoveredCategory[]

  if (config.category?.discovery === "manual" && config.category.categories) {
    categories = config.category.categories.map((c) => ({
      name: c.name,
      cateNo: c.cateNo,
      url: `${config.baseUrl}/product/list.html?cate_no=${c.cateNo}`,
    }))
    console.log(`${tag} 📋 수동 카테고리 ${categories.length}개`)
  } else {
    try {
      categories = await discoverCategories(page, config)
      console.log(`${tag} 📋 자동 탐색: ${categories.length}개 카테고리 발견`)
    } catch (err) {
      const msg = `카테고리 탐색 실패: ${err}`
      console.error(`${tag} ❌ ${msg}`)
      errors.push(msg)
      categories = []
    }
  }

  if (categories.length === 0) {
    console.log(`${tag} ⚠️ 카테고리 없음 — 메인 페이지에서 직접 수집 시도`)
    try {
      await page.goto(`${config.baseUrl}/product/list.html`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      })
      await page.waitForTimeout(1500)
      const products = await collectProductsFromPage(page, config, config.name, config.brand, timing)
      allProducts.push(...products)
      console.log(`${tag} 📦 메인: ${products.length}개 상품`)
    } catch (err) {
      errors.push(`메인 페이지 수집 실패: ${err}`)
    }
  }

  // Step 2: 카테고리별 상품 수집
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i]
    const delay = config.crawlDelay || 2000

    try {
      const products = await crawlCategory(page, config, cat, timing, options.listingOnly)
      allProducts.push(...products)

      const inStockCount = products.filter((p) => p.inStock).length
      console.log(
        `${tag} [${i + 1}/${categories.length}] ${cat.name} — ${products.length}개 (재고 ${inStockCount})`
      )

      for (const p of products) {
        const stock = p.inStock ? "" : " [품절]"
        console.log(
          `${tag}    ${p.priceFormatted || "가격없음"} — ${p.brand || "?"} | ${p.name.slice(0, 50)}${stock}`
        )
      }

      if (options.sampleLimit && countUniqueInStockProducts(allProducts) >= options.sampleLimit) {
        console.log(`${tag} POC sampleLimit=${options.sampleLimit} reached; stopping category crawl`)
        break
      }
    } catch (err) {
      const msg = `${cat.name} 수집 실패: ${err}`
      console.error(`${tag} ❌ ${msg}`)
      errors.push(msg)
    }

    await new Promise((r) => setTimeout(r, delay))
  }

  // 중복 제거 + 품절 제외 (productUrl 기준). listingOnly(갱신)에서는 품절도 남긴다.
  const seen = new Set<string>()
  const dedupedAll = allProducts.filter((p) => {
    if (!p.productUrl || seen.has(p.productUrl)) return false
    seen.add(p.productUrl)
    return true
  })
  const dedupedProducts = options.listingOnly ? dedupedAll : dedupedAll.filter((p) => p.inStock)
  let uniqueProducts = options.sampleLimit
    ? dedupedProducts.slice(0, options.sampleLimit)
    : dedupedProducts

  // ── Step 3: 상세 페이지 크롤링 (파서 주입 + 3-way 병렬) ──
  if (config.crawlDetails && detailParser && !options.listingOnly) {
    console.log(`\n${tag} 🔍 상세 크롤링 시작 — ${uniqueProducts.length}개 상품`)
    const detailStart = Date.now()
    detailNavCount = uniqueProducts.length
    let detailSuccess = 0
    const DETAIL_CONCURRENCY = options.detailConcurrency ?? 3
    // 체크포인트: 대형 카탈로그(1000+ 상품) 상세크롤 도중 프로세스가 죽어도
    // 이미 끝낸 작업이 통째로 유실되지 않도록 30개 상품마다 디스크에 반영한다
    // (2026-07-06, hippiedippy 1511개 중 795개 완료 상태에서 유실된 사고).
    const CHECKPOINT_EVERY = 30
    let sinceCheckpoint = 0
    const externalDetailFactory = options.createDetailPage

    // 상품마다 browser.newContext()를 새로 만들고 닫는 대신, DETAIL_CONCURRENCY개의
    // 컨텍스트/페이지를 한 번만 만들어 사이트 전체 상세크롤 동안 재사용한다.
    // 대형 카탈로그(bergwerk 1344개 등)에서 상품당 컨텍스트 생성/종료를 반복하니
    // OS 프로세스가 점진적으로 쌓여(체크: 79개 chrome/node) 크롤이 극도로 느려지고
    // 결국 리소스 고갈로 프로세스가 죽는 사고가 있었다 (2026-07-06).
    const workerLeases: Cafe24DetailPageLease[] = externalDetailFactory
      ? []
      : await Promise.all(
          Array.from({length: DETAIL_CONCURRENCY}, () => createPlaywrightDetailPageFactory(page)()),
        )

    try {
      for (let i = 0; i < uniqueProducts.length; i += DETAIL_CONCURRENCY) {
        const batch = uniqueProducts.slice(i, i + DETAIL_CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (product, slot) => {
            // 재시작 스킵: 이전 체크포인트/결과 파일에서 이미 상세를 끝낸 상품이면
            // 재요청하지 않고 그대로 재사용 (2026-07-06 — 중단 후 재실행 시 이미 끝낸
            // 상세크롤을 반복하지 않기 위함). 마커는 Product.detailFetchedAt 이다
            // (2026-07-29 이전에는 color 유무로 판정 → color 가 VLM 으로 이관되며 교체).
            const known = options.existingDetails?.get(product.productUrl)
            if (known && product.detailFetchedAt) {
              return {product, detail: known, detailFallbacks: null}
            }
            const lease = externalDetailFactory ? await externalDetailFactory() : workerLeases[slot]!
            const pg = lease.page
            try {
              const detail = await withTimeout(
                detailParser.parse(pg, product.productUrl),
                25_000,
                `detail:${product.productUrl.slice(-50)}`
              )
              const detailFallbacks = await extractCafe24DetailFallbacks(pg)
              if (options.enrichDetailPage) {
                await options.enrichDetailPage(pg, product).catch(() => {})
              }
              product.detailFetchedAt = new Date().toISOString()
              return {product, detail, detailFallbacks}
            } catch {
              // withTimeout이 포기해도 내부 parse()의 page.goto는 백그라운드에서
              // 계속 진행 중일 수 있다 — 페이지를 재사용하므로, 다음 배치가 같은
              // 슬롯에서 새 URL로 goto할 때 "interrupted by another navigation"
              // 에러가 나는 걸 막기 위해 about:blank로 강제 리셋해 정리한다
              // (2026-07-06, 페이지 재사용 도입 후 A.R.U 등에서 확인된 회귀).
              const detailFallbacks = await extractCafe24DetailFallbacks(pg).catch(() => null)
              await pg.goto("about:blank", {timeout: 5000}).catch(() => {})
              return {product, detail: null, detailFallbacks}
            } finally {
              if (externalDetailFactory) await lease.close()
            }
          })
        )

        for (const {product, detail, detailFallbacks} of results) {
          if (!detail && !detailFallbacks) continue
          if (detailFallbacks) {
            applyCafe24DetailFallbacks(product, detailFallbacks)
          }
          if (detail?.material) product.material = detail.material
          if (detail?.productCode) product.productCode = detail.productCode
          if (
            detail?.material ||
            detail?.productCode ||
            detailFallbacks?.name ||
            detailFallbacks?.price != null ||
            detailFallbacks?.descriptionFirstLine
          ) {
            detailSuccess++
          }
        }

        const done = Math.min(i + DETAIL_CONCURRENCY, uniqueProducts.length)
        process.stdout.write(`\r${tag}    📖 ${done}/${uniqueProducts.length} (성공: ${detailSuccess})`)

        sinceCheckpoint += batch.length
        if (options.onDetailProgress && sinceCheckpoint >= CHECKPOINT_EVERY) {
          sinceCheckpoint = 0
          await options.onDetailProgress(uniqueProducts)
        }
      }
    } finally {
      await Promise.all(workerLeases.map((lease) => lease.close().catch(() => {})))
    }

    detailMs = Date.now() - detailStart
    console.log(`\n${tag} ✅ 상세 크롤링 완료 — ${detailSuccess}/${uniqueProducts.length}개 데이터 수집`)
  }

  if (!options.listingOnly) {
    const priceFiltered = filterCafe24ProductsWithUsablePrice(uniqueProducts)
    if (priceFiltered.dropped.length > 0) {
      const samples = priceFiltered.dropped
        .slice(0, 3)
        .map((p) => `${p.name || "(unnamed)"} (${p.priceFormatted || p.productUrl})`)
        .join(", ")
      console.log(`${tag} 🧹 가격 0/누락 상품 제외: ${priceFiltered.dropped.length}개 — ${samples}`)
      uniqueProducts = priceFiltered.products
      if (options.onDetailProgress) await options.onDetailProgress(uniqueProducts)
    }
  }

  // ── Step 4: 리뷰 크롤링 (파서 주입) ──
  if (config.crawlReviews && reviewParser) {
    console.log(`\n${tag} 💬 리뷰 크롤링 시작 — ${uniqueProducts.length}개 상품`)
    let reviewCount = 0
    let withReviews = 0
    const reviewDelay = config.crawlDelay || 800

    for (const product of uniqueProducts) {
      try {
        await page.goto(product.productUrl, {waitUntil: "domcontentloaded", timeout: 15000})
        await page.waitForTimeout(500)

        const reviewData = await reviewParser.parse(page, 10)

        reviewCount++
        if (reviewData.reviewCount > 0 || reviewData.reviews.length > 0) {
          product.reviewCount = reviewData.reviewCount || reviewData.reviews.length
          product.reviews = reviewData.reviews
          withReviews++
          console.log(
            `${tag}    💬 [${reviewCount}/${uniqueProducts.length}] ${(product.name || "").slice(0, 35)}` +
            ` → 리뷰 ${product.reviewCount}건 (추출: ${reviewData.reviews.length}건)`
          )
        }
      } catch {
        reviewCount++
      }

      await new Promise((r) => setTimeout(r, reviewDelay))
    }

    console.log(`${tag} ✅ 리뷰 크롤링 완료 — ${withReviews}/${uniqueProducts.length}개 상품에 리뷰`)
  }

  const quality = assessCafe24ProductQuality(uniqueProducts, config)
  if (!quality.passed) {
    const msg = `Cafe24 quality failed: ${quality.reasons.join(", ")}`
    errors.push(msg)
    console.log(`${tag} ⚠️ ${msg} ${JSON.stringify(quality.metrics)}`)
  }

  // 통계
  const uniqueBrands = new Set(uniqueProducts.map((p) => p.brand))
  const withPrice = uniqueProducts.filter((p) => p.price !== null)
  const avgPrice =
    withPrice.length > 0
      ? Math.round(withPrice.reduce((s, p) => s + (p.price || 0), 0) / withPrice.length)
      : 0

  const result: CrawlResult = {
    platform: config.key,
    products: uniqueProducts,
    stats: {
      totalProducts: uniqueProducts.length,
      inStock: uniqueProducts.filter((p) => p.inStock).length,
      outOfStock: uniqueProducts.filter((p) => !p.inStock).length,
      uniqueBrands: uniqueBrands.size,
      avgPrice,
      duration: Date.now() - startTime,
      listWaitMs: timing.listWaitMs,
      detailMs,
      detailNavCount,
    },
    errors,
  }

  console.log(`\n${tag} ✅ 완료: ${result.stats.totalProducts}개 상품 | 재고 ${result.stats.inStock}개 | ${result.stats.uniqueBrands}개 브랜드 | ${(result.stats.duration / 1000).toFixed(1)}s`)

  return result
}

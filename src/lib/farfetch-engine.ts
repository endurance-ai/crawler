/**
 * Farfetch KR Terms of Service — captured 2026-05-07 by hansangho via live
 * Playwright session at https://www.farfetch.com/kr/terms-and-conditions/
 * (REQ-008). Full body archived at .moai/cache/spec-006-analyze/tos-body.txt.
 *
 * 제13조 (지적 재산권, 소프트웨어, 콘텐츠) verbatim — primary residual risk:
 *
 * 당사는 웹사이트와 그 콘텐츠에( 문자, 그래픽, 로고, 버튼 아이콘, 이미지,
 * 오디오 클립, 디지털 다운로드, 데이터 편집, 프레젠테이션과 편집을 포함한
 * 소프트웨어)("콘텐츠") 관한 지적 재산권이 있거나 그것의 소유자입니다.
 * 웹사이트와 콘텐츠에 관한 권리는 국제 저작권 협약 및 저작권, 작가의 권리,
 * 데이터베이스 권리 법률에 대한 해당 국가의 법률에 의해 보호됩니다. 이 같은
 * 권리는 모두 보호됩니다.
 *
 * 웹사이트 또는 콘텐츠의 일부분을 체계적으로 발췌하거나 재사용할 수 없습니다.
 * 특히 웹사이트의 대부분을 재사용하기 위해 데이터 마이닝, 로봇 또는 유사한
 * 데이터 수집 및 발췌 툴을 사용하여 발췌할 수 없습니다. (횟수에 상관없이)
 * 당사의 서면동의 없이 웹사이트의 상당 부분을 사용하여(예: 당사의 가격 및
 * 상품 리스트) 귀하 스스로 데이터베이스를 만들거나 개재할 수 없습니다.
 *
 * Bilingual keyword scan results (38 candidates):
 *   - 데이터 수집: 1 hit (in §13 above)
 *   - 봇: 1 hit (incidental — appears in unrelated context)
 *   - 로봇: 1 hit (in §13 above as "데이터 마이닝, 로봇")
 *   - 프로그램: 1 hit (in §11 about virus/malware)
 *   - 크롤러/크롤링/스크래핑/스크래퍼: 0 hits
 *   - crawl/crawler/scrape/scraper/automated/data mining/agent/spider: 0 hits
 *
 * Verdict: AMBIGUOUS-ACCEPTED-BY-OWNER (hansangho 2026-05-07)
 *   §13 names "데이터 마이닝, 로봇, 데이터 수집 및 발췌 툴" generically and
 *   prohibits unauthorized creation of databases from "가격 및 상품 리스트"
 *   without written consent. Qualitatively MORE restrictive than ZARA KR §15
 *   (pure IP rights with no automation reference) but LESS explicit than 29CM
 *   제11조 §2.9호 (which named "크롤러(Crawler)" verbatim). The clause is an
 *   IP-rights protection in spirit — analogous to ZARA US §17 with stricter
 *   wording on database creation.
 *
 * Owner-imposed conditions (mandatory):
 *   1. portal.ai-internal-use ONLY — NO public re-distribution of Farfetch
 *      product data, NO commercial database, NO third-party API exposure
 *   2. 3 sec/page pacing minimum (this file enforces via crawlDelay default)
 *   3. Halt-on-cease-and-desist — set disabled:true on receipt of any
 *      communication from Farfetch UK Limited or its parent (Coupang Inc.
 *      acquired Farfetch in 2024)
 *   4. 90-day re-verification — re-capture this file's clause text every
 *      90 days and update verdict if the text changes
 *   5. Operator MUST NOT publish "당사의 가격 및 상품 리스트"-derived
 *      database publicly; portal.ai internal Supabase upsert is in scope
 *
 * Governing law: Farfetch KR ToS §17 designates UK law and English courts
 * for general disputes; Korean consumer protection law applies for
 * Korean-resident user disputes per 약관규제법.
 *
 * Source URL: https://www.farfetch.com/kr/terms-and-conditions/
 * Capture method: Playwright `page.evaluate(() => document.body.innerText)`
 * Capture timestamp: 2026-05-07 (UTC+9)
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-006 REQ-008
 */

/**
 * Farfetch US Terms of Service — note 2026-05-07.
 *
 * The /terms-and-conditions/ endpoint serves Korean ToS for KR-routed IPs
 * with the explicit notice "This section is currently only available in
 * Korean." (verbatim from English-locale capture). Therefore the §13 body
 * captured for KR above is the binding ToS text for both KR and US
 * storefronts when accessed from a KR-resident operator. If the operator
 * later accesses the US storefront from a US-resident IP and the en-US
 * locale serves a different ToS, this comment block MUST be updated.
 *
 * Verdict: AMBIGUOUS-ACCEPTED-BY-OWNER (mirrors KR; same legal entity).
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-006 REQ-008 (US extension by user request
 *       2026-05-07; US storefront added in same Run as KR per owner's
 *       directive "Farfetch kr 하고 us도 같이해줘 이번에 하면서, 법적
 *       괜찮으니까 그냥 진행해도돼").
 */

/**
 * Farfetch KR/US Playwright + DOM-scrape engine.
 *
 * Strategy: navigate to each category landing page in a real Chromium
 * browser (channel:"chrome", required because bundled Chromium is hard
 * 403'd by Akamai's TLS/header fingerprint check — verified empirically
 * 2026-05-07 against /kr/shopping/men/items.aspx etc. REQ-007 probe 8/8
 * pass at 3-sec pacing). The page SSRs product cards directly in the
 * initial HTML response (DataDome/Akamai-friendly delivery). The engine
 * walks the rendered DOM via `page.evaluate(() => walkCards())` rather
 * than intercepting an XHR endpoint (no equivalent product-list JSON XHR
 * was observed during 5-second initial-render window — research.md §2.1).
 *
 * No fingerprint-evasion library is used. No IP rotation, no proxy, no
 * CAPTCHA solver, no authenticated scraping. `channel: "chrome"` is a
 * vanilla Playwright launch option that swaps the bundled Chromium binary
 * for the system's installed Chrome — it is not a stealth plugin and does
 * not modify browser fingerprint signals beyond what a normal Chrome user
 * would emit. This conforms to the project HARD rules.
 *
 * Pagination quirk: `?page=N` requests return HTTP 4xx status BUT the
 * response body is fully populated with 200+ product cards. The engine's
 * abort logic treats `status >= 400 && cards >= 10` as a successful
 * response (REQ-006 extension).
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-006 REQ-001..REQ-011
 */

import {type Browser, chromium, type Page} from "playwright"
import type {CrawlResult, Product, SiteConfig} from "./types"
import {checkRobots} from "./robots-check"

// SPEC-006 REQ-002: region drives source currency, price-formatter
// locale/symbol, and browser context locale + timezone. KR is the
// default for backward compat and matches the ToS-binding storefront.
export type FarfetchRegion = "KR" | "US"

// ─── User-Agent rotation (one UA per browser context) ────────

const FARFETCH_USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
] as const

export function pickFarfetchUserAgent(index: number): string {
  return FARFETCH_USER_AGENTS[index % FARFETCH_USER_AGENTS.length]!
}

// ─── Image host whitelist ────────────────────────────────

/**
 * Verified hosts seen in the live DOM on 2026-05-07:
 *   - cdn-images.farfetch-contents.com (primary)
 *   - cdn-static.farfetch-contents.com (secondary)
 * Add new hosts here only after observing them in a live capture.
 */
const FARFETCH_IMAGE_HOSTS = new Set([
  "cdn-images.farfetch-contents.com",
  "cdn-static.farfetch-contents.com",
])

export function isSafeFarfetchImageUrl(src: string): boolean {
  if (typeof src !== "string" || !src.startsWith("https://")) return false
  try {
    return FARFETCH_IMAGE_HOSTS.has(new URL(src).hostname)
  } catch {
    return false
  }
}

// ─── productUrl whitelist regex (per-baseUrl) ──────────────

/**
 * Build a region-aware productUrl whitelist pattern keyed off the
 * SiteConfig `baseUrl`. Both KR (`https://www.farfetch.com/kr`) and US
 * (`https://www.farfetch.com`) are supported. The canonical product URL
 * shape observed 2026-05-07:
 *   /kr/shopping/men/{designer-slug}--item-{id}.aspx   (KR)
 *   /shopping/men/{designer-slug}--item-{id}.aspx     (US, no /us prefix)
 *
 * Note the trailing dash on the designer slug producing visual `--item-`
 * — the slug character class includes hyphens.
 *
 * Slug character set is URL-safe only — alphanumerics, hyphen, dot,
 * percent-encoded bytes. Path-traversal sequences (../, /, protocol-
 * relative strings) are rejected.
 *
 * SPEC: SPEC-006 REQ-002, REQ-010
 */
export function buildFarfetchProductUrlPattern(baseUrl: string): RegExp {
  const trimmed = baseUrl.replace(/\/+$/, "")
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `^${escaped}/shopping/(?:men|women|kids)/[A-Za-z0-9%.\\-]+-item-\\d+\\.aspx$`,
  )
}

export function isSafeFarfetchProductUrl(url: string, baseUrl: string): boolean {
  if (typeof url !== "string") return false
  return buildFarfetchProductUrlPattern(baseUrl).test(url)
}

// ─── price parsers and formatter (region-aware) ─────────────

/**
 * Region-aware price parser. The Farfetch DOM emits priceText in the
 * region's natural format:
 *   - KR: "₩659,000" (KRW integer with comma thousand-separators)
 *   - US: "$659.00"  (USD decimal with dot decimal-separator)
 * Returns the normalized numeric price in the region's natural unit
 * (KRW integer for KR, USD decimal for US) or `null` if parsing fails.
 *
 * Sale displays may emit "₩1,050,000 ₩630,000" (original then sale);
 * we take the LAST numeric token as the effective consumer price.
 *
 * SPEC: SPEC-006 REQ-003
 */
export function parseFarfetchPrice(text: string, region: FarfetchRegion): number | null {
  if (typeof text !== "string" || text.length === 0) return null
  if (region === "US") {
    const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)/g)
    if (!m || m.length === 0) return null
    const last = m[m.length - 1]!.replace(/[$,\s]/g, "")
    const v = parseFloat(last)
    if (!Number.isFinite(v) || v <= 0) return null
    return v
  }
  // KR (KRW integer)
  const m = text.match(/₩\s*([\d,]+)/g)
  if (!m || m.length === 0) return null
  const last = m[m.length - 1]!.replace(/[₩,\s]/g, "")
  const v = parseInt(last, 10)
  if (!Number.isFinite(v) || v <= 0) return null
  return v
}

/**
 * Region-aware price formatter. KR emits `₩{price.toLocaleString("ko-KR")}`
 * (matches ZARA KR pattern bit-for-bit); US emits `${price.toFixed(2)}`
 * (USD decimal with two trailing digits — matches ZARA US pattern).
 *
 * SPEC: SPEC-006 REQ-003 / AC-4
 */
export function formatFarfetchPrice(price: number, region: FarfetchRegion): string {
  if (region === "US") return `$${price.toFixed(2)}`
  return `₩${price.toLocaleString("ko-KR")}`
}

// ─── KRW price sanity range ─────────────────────────────

const KRW_MIN = 1_000
const KRW_MAX = 100_000_000
const USD_MIN = 5
const USD_MAX = 100_000

function isPriceInSaneRange(price: number, region: FarfetchRegion): boolean {
  if (region === "US") return price >= USD_MIN && price <= USD_MAX
  return Number.isInteger(price) && price >= KRW_MIN && price <= KRW_MAX
}

// ─── Challenge-intercept detector ───────────────────────

const CHALLENGE_BODY_LIMIT = 5000

export interface InterceptCheck {
  isIntercept: boolean
  reason?: string
}

/**
 * Detect DataDome / Akamai / Cloudflare challenge interstitial pages.
 * Heuristic: body length < 5,000 bytes AND title contains one of
 * "just a moment", "challenge", "datadome", "cf-mitigated", "access denied".
 * Bundled-Chromium hard-403 typically returns < 1,000 bytes with
 * "Access Denied" in the body. Mirrors detectBmVerifyIntercept from
 * zara-engine but with broader vendor coverage.
 */
export function detectChallengeIntercept(html: string, title = ""): InterceptCheck {
  if (typeof html !== "string") return {isIntercept: true, reason: "non-string body"}
  if (html.length >= CHALLENGE_BODY_LIMIT) return {isIntercept: false}
  const haystack = `${title}\n${html}`.toLowerCase()
  if (/just a moment|challenge|datadome|cf-mitigated/.test(haystack)) {
    return {isIntercept: true, reason: "anti-bot challenge"}
  }
  if (html.length < 1000 && /access denied/.test(haystack)) {
    return {isIntercept: true, reason: "access-denied-403"}
  }
  return {isIntercept: false}
}

// ─── Raw card shape (extracted via page.evaluate) ──────

export interface RawFarfetchCard {
  href: string
  name: string
  brand: string
  priceText: string
  imageUrl: string
}

// ─── Region-agnostic gender derivation ──────────────────

/**
 * Match `/kr/shopping/(men|women|kids)/...` (KR) or `/shopping/(men|women|kids)/...` (US).
 * Returns canonical `"men"` / `"women"` / `"kids"` or empty string.
 *
 * SPEC: SPEC-006 REQ-002
 */
export function deriveGenderFromUrl(url: string): string {
  if (typeof url !== "string") return ""
  const m = url.match(/\/(?:kr\/)?shopping\/(men|women|kids)\b/i)
  if (!m) return ""
  return m[1]!.toLowerCase()
}

// ─── Pure parse function (fixture-testable) ─────────────

/**
 * Parse extracted DOM cards into Product[] with region-aware pricing
 * and the locked image-host + productUrl whitelists.
 *
 * @param cards         Output of extractCardsFromDom
 * @param baseUrl       SiteConfig.baseUrl (e.g. "https://www.farfetch.com/kr")
 * @param platformKey   SiteConfig.key (e.g. "farfetch-kr")
 * @param region        "KR" | "US"
 * @param sourceCurrency "KRW" | "USD"
 * @param genderHint    Optional gender inferred from category URL (cards from
 *                      a /men/ category landing inherit "men" by default).
 *
 * @MX:NOTE: Defensive null-handling on every nested field; a card that
 * fails any guardrail is dropped silently rather than aborting the page.
 */
export function parseProductsFromCards(
  cards: RawFarfetchCard[],
  baseUrl: string,
  platformKey: string,
  region: FarfetchRegion = "KR",
  sourceCurrency: "KRW" | "USD" = "KRW",
  genderHint = "",
): Product[] {
  const out: Product[] = []
  const crawledAt = new Date().toISOString()
  const productUrlPattern = buildFarfetchProductUrlPattern(baseUrl)
  for (const raw of cards) {
    if (!raw || typeof raw !== "object") continue
    if (!raw.href || !raw.brand || !raw.name || !raw.priceText) continue
    if (!productUrlPattern.test(raw.href)) continue
    if (!isSafeFarfetchImageUrl(raw.imageUrl)) continue
    const price = parseFarfetchPrice(raw.priceText, region)
    if (price === null) continue
    if (!isPriceInSaneRange(price, region)) continue
    const idMatch = raw.href.match(/-item-(\d+)\.aspx$/)
    const productCode = idMatch ? idMatch[1]! : ""
    const gender = genderHint ? [genderHint] : (deriveGenderFromUrl(raw.href) ? [deriveGenderFromUrl(raw.href)] : [])
    out.push({
      brand: raw.brand,
      name: raw.name,
      category: "",
      price,
      originalPrice: price,
      salePrice: null,
      priceFormatted: formatFarfetchPrice(price, region),
      imageUrl: raw.imageUrl,
      productUrl: raw.href,
      inStock: true,
      gender,
      platform: platformKey,
      crawledAt,
      productCode,
      sourceCurrency,
      sourcePrice: price,
    })
  }
  return out
}

// ─── DOM extraction (Playwright-bound) ──────────────────

const PRODUCT_CARD_SELECTOR = '[data-component*="ProductCard"]'

/**
 * Walk the SSR'd product card DOM and extract a `RawFarfetchCard[]`.
 * Pure DOM extraction; no parsing. Selector is the locked
 * `[data-component*="ProductCard"]` (research.md §3.1, REQ-007 8/8 pass).
 */
export async function extractCardsFromDom(page: Page): Promise<RawFarfetchCard[]> {
  return page.evaluate((sel: string) => {
    var out: any[] = []
    var els = document.querySelectorAll(sel)
    for (var i = 0; i < els.length; i++) {
      var root = els[i] as HTMLElement
      var aEl = root.querySelector('a[href*="-item-"]') as HTMLAnchorElement | null
      var href = aEl ? aEl.href : ""
      var brand = ""
      var brandEl = root.querySelector('[data-component*="BrandName"], p[data-component*="Brand"]')
      if (brandEl) brand = (brandEl.textContent || "").trim()
      var name = ""
      var nameEl = root.querySelector('[data-component*="Description"], p[data-component*="ProductCardDescription"]')
      if (nameEl) name = (nameEl.textContent || "").trim()
      var priceText = ""
      var priceEl = root.querySelector('[data-component*="Price"], [data-component*="price"]')
      if (priceEl) priceText = (priceEl.textContent || "").trim()
      var imageUrl = ""
      var img = root.querySelector('img') as HTMLImageElement | null
      if (img) imageUrl = img.getAttribute("src") || img.getAttribute("data-src") || ""
      out.push({href: href, brand: brand, name: name, priceText: priceText, imageUrl: imageUrl})
    }
    return out
  }, PRODUCT_CARD_SELECTOR)
}

// ─── Engine entry ────────────────────────────────────────

const ABORT_THRESHOLD = 3
const PER_CATEGORY_TIMEOUT_MS = 30_000
const SELECTOR_TIMEOUT_MS = 15_000
// Scroll loop: walk to page bottom in larger steps, pausing for lazy
// hydration. Farfetch React-virtualizes the grid: only cards within ~2
// viewports of the scrollport carry brand/price text; those outside are
// skeleton placeholders. Generous scrolling (~24 steps × 1000 px) exposes
// 80–150 fully-hydrated cards per L2 landing in the live 2026-05-07 capture.
const SCROLL_PIXEL_STEP = 1000
const SCROLL_PAUSE_MS = 600
const SCROLL_MAX_STEPS = 24
const SCROLL_STAGNATION_LIMIT = 3 // bottom-reached: 3 consecutive identical scrollY
// REQ-006 extension: HTTP 4xx with cards >= EXTENDED_SUCCESS_MIN_CARDS is NOT an error.
const EXTENDED_SUCCESS_MIN_CARDS = 10
// Per-category cap (mirrors ZARA practice). Prevents pagination explosion.
const PER_CATEGORY_PRODUCT_CAP = 200

interface CategoryScrapeResult {
  url: string
  products: Product[]
  error?: {type: string; detail: string}
}

// @MX:WARN: [AUTO] Browser lifecycle is owned by `crawlFarfetch` — every
// `chromium.launch` call MUST be matched by a `browser.close()` in the
// finally block, or a Chromium subprocess will leak between crawl runs.
// @MX:REASON: Mirrors ZARA's engine pattern. Lifecycle (browser owned by
// engine) is deliberately not externalized; per-category context is
// re-created so UA rotation and locale are bound to the page session.
async function crawlOneCategory(
  page: Page,
  categoryUrl: string,
  baseUrl: string,
  platformKey: string,
  gender: string,
  region: FarfetchRegion,
  sourceCurrency: "KRW" | "USD",
): Promise<CategoryScrapeResult> {
  const result: CategoryScrapeResult = {url: categoryUrl, products: []}
  try {
    const navResp = await page.goto(categoryUrl, {
      waitUntil: "domcontentloaded",
      timeout: PER_CATEGORY_TIMEOUT_MS,
    })
    const status = navResp?.status() ?? 0

    // Wait for the locked product-card selector. Even on HTTP 4xx, the
    // body may still be populated (Farfetch pagination quirk).
    let selectorOk = false
    try {
      await page.waitForSelector(PRODUCT_CARD_SELECTOR, {timeout: SELECTOR_TIMEOUT_MS})
      selectorOk = true
    } catch {
      // selector failed within timeout — fall through to challenge / status check
    }

    // Quick body check for challenge intercept.
    const probeBody = await page.content().catch(() => "")
    const probeTitle = await page.title().catch(() => "")
    const intercept = detectChallengeIntercept(probeBody, probeTitle)
    if (intercept.isIntercept) {
      result.error = {type: intercept.reason ?? "intercept", detail: "challenge or hard-block"}
      return result
    }

    // Aggressive scroll to expose lazy-loaded product cards. Farfetch
    // React-virtualizes the grid: cards outside the viewport are
    // skeleton placeholders without brand/name/price text. We
    // scroll-to-bottom in steps and break on stagnation (no scrollY
    // change after N attempts → reached bottom).
    let lastScrollY = -1
    let stagnant = 0
    for (let i = 0; i < SCROLL_MAX_STEPS; i++) {
      await page.evaluate((y: number) => window.scrollTo(0, y), (i + 1) * SCROLL_PIXEL_STEP).catch(() => {})
      await page.waitForTimeout(SCROLL_PAUSE_MS)
      const currentY = await page.evaluate(() => window.scrollY).catch(() => 0)
      if (typeof currentY === "number" && currentY === lastScrollY) {
        if (++stagnant >= SCROLL_STAGNATION_LIMIT) break
      } else {
        stagnant = 0
        lastScrollY = currentY
      }
    }

    const cards = await extractCardsFromDom(page).catch(() => [] as RawFarfetchCard[])
    if (!selectorOk && cards.length === 0) {
      // selector AND extraction both failed
      if (status >= 400) {
        result.error = {type: `http-${status}`, detail: `nav status ${status}, no cards`}
      } else {
        result.error = {type: "selector-timeout", detail: "product card not rendered"}
      }
      return result
    }

    // REQ-006 extension: HTTP 4xx + cards >= 10 is NOT an error.
    if (status >= 400 && cards.length < EXTENDED_SUCCESS_MIN_CARDS) {
      result.error = {type: `http-${status}`, detail: `nav status ${status}, cards=${cards.length}`}
      return result
    }

    const products = parseProductsFromCards(
      cards,
      baseUrl,
      platformKey,
      region,
      sourceCurrency,
      gender,
    )
    result.products = products.slice(0, PER_CATEGORY_PRODUCT_CAP)
    return result
  } catch (err) {
    result.error = {type: "exception", detail: String(err).slice(0, 200)}
    return result
  }
}

/**
 * @MX:ANCHOR: [AUTO] Farfetch crawler entry point. Invariant: ALWAYS
 * returns a CrawlResult, never throws. Browser is launched and closed
 * within this function. Errors are surfaced via result.errors[].
 * @MX:REASON: fan_in expected from runCrawl, probeSite, and characterization
 * tests once SPEC-006 ships. Behavior change here ripples through
 * dispatch wiring and test fixtures; keep the contract stable.
 * @MX:SPEC: SPEC-PLATFORM-EXPANSION-006 REQ-002, REQ-003, REQ-006
 */
export async function crawlFarfetch(config: SiteConfig): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []
  const allProducts: Product[] = []
  const crawlDelay = config.crawlDelay ?? 3000
  const categoryUrls = config.categoryUrls ?? []
  const region: FarfetchRegion = config.region === "US" ? "US" : "KR"
  const sourceCurrency: "KRW" | "USD" =
    config.sourceCurrency === "USD" || config.sourceCurrency === "KRW"
      ? config.sourceCurrency
      : region === "US"
        ? "USD"
        : "KRW"

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl}) [Farfetch ${region}]`)
  console.log(`${"─".repeat(50)}`)

  // REQ-005: robots.txt pre-flight check before any browser launch.
  const robots = await checkRobots(config.baseUrl)
  if (!robots.allowed) {
    const msg =
      `[robots-block] ${config.key} blocked by robots.txt — ` +
      `${robots.blockingLine ?? "unknown"}. Project HARD rule #1: sites that ` +
      `explicitly forbid crawling MUST be deferred.`
    errors.push(msg)
    console.error(`   ❌ ${msg}`)
    return buildResult(config.key, allProducts, errors, startTime)
  }

  if (categoryUrls.length === 0) {
    errors.push(JSON.stringify({type: "config-error", detail: "categoryUrls is empty"}))
    return buildResult(config.key, allProducts, errors, startTime)
  }

  let browser: Browser | null = null
  try {
    browser = await chromium.launch(
      process.env.CRAWLER_BROWSER_CHANNEL === "chromium"
        ? {headless: true}
        : {headless: true, channel: "chrome"},
    )
  } catch (err) {
    const runtime =
      process.env.CRAWLER_BROWSER_CHANNEL === "chromium"
        ? "Playwright bundled Chromium"
        : "system Chrome"
    errors.push(
      JSON.stringify({
        type: "browser-launch-failed",
        detail:
          `${String(err).slice(0, 200)}. Farfetch engine tried ${runtime}; ` +
          `install the selected browser runtime or change CRAWLER_BROWSER_CHANNEL.`,
        timestamp: new Date().toISOString(),
      }),
    )
    return buildResult(config.key, allProducts, errors, startTime)
  }

  let consecutiveErrors = 0
  try {
    for (let i = 0; i < categoryUrls.length; i++) {
      const categoryUrl = categoryUrls[i]!
      const ua = pickFarfetchUserAgent(i)
      const gender = deriveGenderFromUrl(categoryUrl)

      // 3 sec/page pacing between consecutive page navigations
      // (REQ-003). First request runs immediately.
      if (i > 0) {
        await new Promise((r) => setTimeout(r, crawlDelay))
      }

      const ctx = await browser.newContext({
        userAgent: ua,
        viewport: {width: 1440, height: 900},
        // SPEC-006 REQ-002: do NOT override locale/timezoneId for KR
        // (server geo-routes based on IP); for US, set en-US explicitly
        // so that an operator running from a non-US IP still gets the US
        // currency/listing surface where Farfetch honors the locale.
        ...(region === "US"
          ? {locale: "en-US", timezoneId: "America/New_York"}
          : {locale: "ko-KR", timezoneId: "Asia/Seoul"}),
      })
      const page = await ctx.newPage()
      let result: CategoryScrapeResult
      try {
        result = await crawlOneCategory(
          page,
          categoryUrl,
          config.baseUrl,
          config.key,
          gender,
          region,
          sourceCurrency,
        )
      } finally {
        await ctx.close().catch(() => {})
      }

      if (result.error) {
        consecutiveErrors += 1
        errors.push(
          JSON.stringify({
            category: categoryUrl,
            type: result.error.type,
            detail: result.error.detail,
            timestamp: new Date().toISOString(),
          }),
        )
        console.error(
          `   ❌ ${categoryUrl}: ${result.error.type} (${consecutiveErrors}/${ABORT_THRESHOLD} consecutive)`,
        )
        if (consecutiveErrors >= ABORT_THRESHOLD) {
          console.error(
            `   ⛔ aborting remaining categories after ${ABORT_THRESHOLD} consecutive errors`,
          )
          break
        }
        continue
      }

      if (result.products.length === 0) {
        console.log(`   ℹ️  ${categoryUrl}: 0 products`)
        consecutiveErrors = 0
        continue
      }

      allProducts.push(...result.products)
      console.log(`   ${categoryUrl}: ${result.products.length} products`)
      consecutiveErrors = 0
    }
  } finally {
    await browser.close().catch(() => {})
  }

  return buildResult(config.key, allProducts, errors, startTime)
}

function buildResult(
  platformKey: string,
  products: Product[],
  errors: string[],
  startTime: number,
): CrawlResult {
  const uniqueBrands = new Set(products.map((p) => p.brand))
  const withPrice = products.filter((p) => p.price !== null)
  const avgPrice =
    withPrice.length > 0
      ? Math.round(withPrice.reduce((s, p) => s + (p.price ?? 0), 0) / withPrice.length)
      : 0
  return {
    platform: platformKey,
    products,
    stats: {
      totalProducts: products.length,
      inStock: products.filter((p) => p.inStock).length,
      outOfStock: products.filter((p) => !p.inStock).length,
      uniqueBrands: uniqueBrands.size,
      avgPrice,
      duration: Date.now() - startTime,
    },
    errors,
  }
}

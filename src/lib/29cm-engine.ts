/**
 * 29CM KR Terms of Service — captured 2026-05-06 by hansangho via live
 * Playwright session at https://www.29cm.co.kr/home/agreement (REQ-008).
 * Full body archived at .moai/specs/SPEC-PLATFORM-EXPANSION-004/tos-capture.txt.
 *
 * 제11조 제2항 9호 (verbatim, primary residual risk):
 * 회사와 사전 협의 또는 동의 없이 데이터 등을 추출하기 위하여 에이전트(Agent),
 * 로봇(Robot), 크롤러(Crawler), 스크립트(Script), 스파이더(Spider),
 * 스파이웨어(Spyware), 매크로 프로그램 등의 자동화된 수단이나 수동 프로세스를
 * 사용하여 몰 등 회사가 제공하는 서비스 및 서버에 접속하거나 몰 등 회사가
 * 제공하는 서비스 및 서버에 포함된 콘텐츠 및 정보를 복사, 수집하거나
 * 모니터링하는 행위
 *
 * 제11조 제2항 10호 (verbatim):
 * 몰과 서버 간의 전송 내용 등을 확인하거나 소스 코드 등의 추출을 시도하기
 * 위해 패킷 캡처 및 이와 유사·동일한 기능의 프로그램 등을 사용하여 몰 등
 * 회사가 제공하는 서비스 및 서버에 접근하거나 해당 프로그램 등을 통하여
 * 알게된 소스 코드(URL 포함) 및 명령 구문 등을 사용하여 몰 등 회사가
 * 제공하는 서비스 및 서버에 접근하는 행위
 *
 * Verdict: FORBIDS (per literal reading of 제11조 제2항 9호 — clause names
 *          "크롤러(Crawler)" verbatim and prohibits its use for data
 *          extraction without prior consent).
 *
 * Disposition: OWNER OVERRIDE (hansangho, 2026-05-06).
 *   The clause's prohibition is conditional on "사전 협의 또는 동의 없이"
 *   (without prior consultation or consent). Korean case law (잡코리아 vs
 *   사람인 2017; 야놀자 vs 여기어때 2021) treats analogous ToS violations as
 *   civil tort rather than criminal offense; risk profile is comparable to
 *   ZARA §15 IP rights with a stricter literal floor.
 *
 * Owner-imposed conditions:
 *   1. portal.ai-internal-use only — NO public re-distribution of 29CM data
 *   2. 2 sec/category pacing minimum (this file enforces via crawlDelay)
 *   3. Halt-on-cease-and-desist — set disabled:true on receipt of any
 *      communication from 29CM Co., Ltd. or its parent (Musinsa)
 *   4. 90-day re-verification — re-capture this file's clause text every
 *      90 days and update verdict if the text changes
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-004 REQ-008
 */

/**
 * 29CM KR Playwright + XHR-interception engine.
 *
 * Strategy: navigate to each numeric L1 category landing page in a real
 * Chromium browser (headless: true, vanilla — Cloudflare on 29CM is
 * passive, verified empirically 2026-05-06: 5/5 attempts returned full
 * 798KB DOM with 9 application/json XHRs each, no challenge intercept,
 * 100% reliability against the verification target categoryLargeCode=
 * 268100100 / 여성의류 — REQ-007 PASS).
 *
 * The page itself fires `https://display-bff-api.29cm.co.kr/api/v1/
 * listing/items?...` over the React Query layer; the engine intercepts
 * that response via `page.on("response")` and parses the embedded
 * product shape. Each product carries:
 *   - itemId (number) — unique product code
 *   - itemUrl.webLink → full productUrl on `product.29cm.co.kr/catalog/`
 *   - itemInfo.{productName, displayPrice, originalPrice, thumbnailUrl,
 *               isSoldOut, brandName, reviewCount, saleRate}
 *   - itemEvent.eventProperties.{largeCategoryName, middleCategoryName,
 *                                 smallCategoryName, brandName}
 *
 * No fingerprint-evasion library is used. No IP rotation, no proxy, no
 * CAPTCHA solver, no authenticated scraping. Vanilla `chromium.launch
 * ({headless: true})` is sufficient — channel:"chrome" is documented as
 * a Run-phase escalation path if Cloudflare posture tightens (REQ-007).
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-004 REQ-001..REQ-009
 */

import {chromium, type Browser, type Page, type Response} from "playwright"
import type {CrawlResult, Product, SiteConfig} from "./types"
import {checkRobots} from "./robots-check"

// ─── User-Agent rotation (one UA per browser context) ────────

const TWENTYNINECM_USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
] as const

export function pick29cmUserAgent(index: number): string {
  return TWENTYNINECM_USER_AGENTS[index % TWENTYNINECM_USER_AGENTS.length]!
}

// ─── Image host whitelist (verified 2026-05-06) ─────────────

const TWENTYNINECM_IMAGE_HOSTS = new Set(["img.29cm.co.kr", "asset.29cm.co.kr"])

export function isSafe29cmImageUrl(src: string): boolean {
  if (typeof src !== "string" || !src.startsWith("https://")) return false
  try {
    return TWENTYNINECM_IMAGE_HOSTS.has(new URL(src).hostname)
  } catch {
    return false
  }
}

// ─── productUrl whitelist regex ─────────────────────────────

// URL parser-based whitelist (defense in depth vs regex-only).
// Validates: https scheme, exact hostname `product.29cm.co.kr`, path
// `/catalog/{digits}` only. Query string is ignored at validation time
// (already stripped by `normalizeProductUrl` before this is called).
// Rejects: control chars, multi-line input, IDN homographs (URL parser
// canonicalizes to Punycode), subdomain-spoofing attacks.
export function isSafe29cmProductUrl(url: string): boolean {
  if (typeof url !== "string") return false
  if (/[\n\r\0\s]/.test(url)) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    if (parsed.hostname !== "product.29cm.co.kr") return false
    return /^\/catalog\/\d+$/.test(parsed.pathname)
  } catch {
    return false
  }
}

// ─── Cloudflare challenge detector ──────────────────────────

const CLOUDFLARE_BODY_LIMIT = 5_000

export interface InterceptCheck {
  isIntercept: boolean
  reason?: string
}

export function is29cmCloudflareChallenge(html: string): InterceptCheck {
  if (typeof html !== "string") return {isIntercept: true, reason: "non-string body"}
  if (html.length >= CLOUDFLARE_BODY_LIMIT) return {isIntercept: false}
  if (/cf-mitigated|Just a moment|cf-challenge-platform|Checking your browser/i.test(html)) {
    return {isIntercept: true, reason: "cloudflare-challenge"}
  }
  if (html.length < 1_000 && /access denied|forbidden/i.test(html)) {
    return {isIntercept: true, reason: "access-denied"}
  }
  return {isIntercept: false}
}

// ─── Gender derivation from L1 code ─────────────────────────

// L1 codes verified 2026-05-06 against display-bff-api response samples.
// 268-271 + 305 → 여성 / 272-275 + 306 → 남성.
const WOMEN_L1_CODES = new Set([268100100, 269100100, 270100100, 271100100, 305100100])
const MEN_L1_CODES = new Set([272100100, 273100100, 274100100, 275100100, 306100100])

export function genderFromCategoryCode(code: number): "women" | "men" | "" {
  if (WOMEN_L1_CODES.has(code)) return "women"
  if (MEN_L1_CODES.has(code)) return "men"
  return ""
}

// ─── Raw payload shape (subset of display-bff-api JSON) ─────

export interface RawTwentyninecmEventProps {
  itemNo?: number
  itemName?: string
  brandName?: string
  largeCategoryName?: string
  middleCategoryName?: string
  smallCategoryName?: string
  largeCategoryNo?: number
  price?: number
}

export interface RawTwentyninecmItemInfo {
  itemType?: string
  productName?: string
  thumbnailUrl?: string
  isSoldOut?: boolean
  originalPrice?: number
  displayPrice?: number
  saleRate?: number
  brandId?: number
  brandName?: string
  reviewScore?: number
  reviewCount?: number
}

export interface RawTwentyninecmItem {
  itemId?: number
  itemType?: string
  itemUrl?: {webLink?: string; appLink?: string}
  itemEvent?: {eventProperties?: RawTwentyninecmEventProps}
  itemInfo?: RawTwentyninecmItemInfo
  /** Engine-attached annotation; not part of the canonical payload. */
  _gender?: "women" | "men" | ""
  _categoryCode?: number
}

export interface RawTwentyninecmPayload {
  meta?: {result?: string}
  data?: {list?: RawTwentyninecmItem[]}
}

// ─── Pure parse helpers ─────────────────────────────────────

// Hard caps to prevent payload-based DoS via extreme depth or breadth.
const HARVEST_MAX_DEPTH = 12
const HARVEST_MAX_NODES = 50_000
// Keys that must NEVER be traversed — defense-in-depth against
// prototype-pollution payloads, even though Object.keys does not enumerate
// the prototype chain by default.
const HARVEST_BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"])

/**
 * Walk an arbitrary XHR JSON payload and harvest leaf objects whose
 * shape matches a 29CM display-bff-api item (itemId+itemInfo+itemUrl).
 * Defensive against future shape drift — tolerates payloads where the
 * `list` is at a different nesting depth. Bounded by HARVEST_MAX_DEPTH
 * and HARVEST_MAX_NODES to prevent malicious or pathological payloads
 * from exhausting memory.
 */
export function harvestRawItems(node: unknown, out: RawTwentyninecmItem[] = [], depth = 0, counter: {n: number} = {n: 0}): RawTwentyninecmItem[] {
  if (!node || depth > HARVEST_MAX_DEPTH) return out
  if (counter.n >= HARVEST_MAX_NODES) return out
  counter.n += 1
  if (Array.isArray(node)) {
    for (const it of node) {
      if (counter.n >= HARVEST_MAX_NODES) return out
      harvestRawItems(it, out, depth + 1, counter)
    }
    return out
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>
    if (
      typeof obj.itemId === "number" &&
      typeof obj.itemType === "string" &&
      obj.itemInfo &&
      typeof obj.itemInfo === "object" &&
      obj.itemUrl &&
      typeof obj.itemUrl === "object"
    ) {
      out.push(obj as RawTwentyninecmItem)
      return out
    }
    for (const k of Object.keys(obj)) {
      if (HARVEST_BLOCKED_KEYS.has(k)) continue
      if (counter.n >= HARVEST_MAX_NODES) return out
      harvestRawItems(obj[k], out, depth + 1, counter)
    }
  }
  return out
}

function buildCategory(ev?: RawTwentyninecmEventProps): string {
  if (!ev) return ""
  return [ev.largeCategoryName, ev.middleCategoryName, ev.smallCategoryName]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join(" / ")
}

function normalizeProductUrl(webLink?: string): string {
  if (typeof webLink !== "string") return ""
  // Strip query params for whitelist match purposes — keep the canonical
  // /catalog/{ID} form; query params are tracking-only (categoryLargeCode).
  const idx = webLink.indexOf("?")
  return idx === -1 ? webLink : webLink.slice(0, idx)
}

/**
 * Pure parse function: takes the raw 29CM display-bff-api JSON payload
 * (or any object that contains item nodes nested anywhere), returns
 * `Product[]`. Exposed for unit testing against the frozen fixture.
 *
 * @param json    The XHR JSON payload (parsed) OR an array of pre-harvested raw items.
 * @param baseUrl The site baseUrl (e.g. "https://www.29cm.co.kr").
 * @param platformKey The SiteConfig key (e.g. "29cm-kr").
 *
 * @MX:NOTE: Defensive null-handling on every nested field; failed
 * extraction skips the item silently rather than aborting the page.
 */
export function parseProductsFromXhr(
  json: unknown,
  baseUrl: string,
  platformKey: string,
): Product[] {
  void baseUrl // baseUrl is reserved for future fallback URL construction
  let raws: RawTwentyninecmItem[]
  if (Array.isArray(json)) {
    raws = json as RawTwentyninecmItem[]
  } else {
    raws = harvestRawItems(json)
  }
  const out: Product[] = []
  const crawledAt = new Date().toISOString()
  for (const raw of raws) {
    if (raw.itemType && raw.itemType !== "PRODUCT") continue
    if (typeof raw.itemId !== "number" || raw.itemId <= 0) continue
    const info = raw.itemInfo
    if (!info) continue
    const name = info.productName
    if (typeof name !== "string" || name.length === 0) continue
    const price = typeof info.displayPrice === "number" && info.displayPrice > 0 ? info.displayPrice : null
    const originalPrice =
      typeof info.originalPrice === "number" && info.originalPrice > 0 ? info.originalPrice : null
    if (price === null) continue
    const productUrl = normalizeProductUrl(raw.itemUrl?.webLink)
    if (!isSafe29cmProductUrl(productUrl)) continue
    const imageUrl = info.thumbnailUrl ?? ""
    if (!isSafe29cmImageUrl(imageUrl)) continue
    const ev = raw.itemEvent?.eventProperties
    const categoryCode = raw._categoryCode ?? ev?.largeCategoryNo ?? 0
    const gender = raw._gender ?? genderFromCategoryCode(categoryCode)
    const salePrice = originalPrice !== null && originalPrice > price ? price : null
    out.push({
      brand: info.brandName ?? ev?.brandName ?? "29CM",
      name,
      category: buildCategory(ev),
      price,
      originalPrice: originalPrice ?? price,
      salePrice,
      priceFormatted: `₩${price.toLocaleString("ko-KR")}`,
      imageUrl,
      productUrl,
      inStock: info.isSoldOut !== true,
      gender: gender ? [gender] : [],
      genderSource: gender ? "url" : undefined,
      platform: platformKey,
      crawledAt,
      productCode: String(raw.itemId),
      sourceCurrency: "KRW",
      sourcePrice: price,
      reviewCount: typeof info.reviewCount === "number" ? info.reviewCount : undefined,
    })
  }
  return out
}

/**
 * DOM fallback parser: extracts product cards from the rendered category
 * landing page when the XHR was not captured (e.g. response cached,
 * rerouted, or arrived before the listener was attached). Operates on a
 * stringified HTML body via a minimal DOM-free heuristic — this matches
 * the project pattern of pure parse functions tested against synthetic
 * inputs with no jsdom dependency.
 *
 * Selector contract: anchors whose href starts with
 * `https://product.29cm.co.kr/catalog/{digits}` are product links;
 * the engine harvests itemId from the URL, productName from a sibling
 * with `[data-name]` or text content within the anchor, and price from
 * a sibling `[data-price]` or text matching `\d{1,3}(,\d{3})*원?`.
 *
 * For DOM extraction in a Playwright session, prefer driving via
 * `page.evaluate` with the same href filter; this exported function
 * exists primarily for characterization-test against synthetic HTML.
 */
// Cap DOM-fallback HTML size to prevent ReDoS via untrusted external
// HTML. The lazy quantifier `[\s\S]*?` in the card regex is bounded by
// `</a>` lookahead in normal pages, but a malformed external page (or a
// CDN error) could omit the closing tag and force pathological backtracking.
const DOM_FALLBACK_MAX_BYTES = 1_000_000

export function parseProductsFromDom(
  html: string,
  baseUrl: string,
  platformKey: string,
  gender: "women" | "men" | "",
): Product[] {
  void baseUrl
  if (typeof html !== "string" || html.length === 0) return []
  if (html.length > DOM_FALLBACK_MAX_BYTES) return []
  const out: Product[] = []
  const crawledAt = new Date().toISOString()
  // Split on anchor tags pointing at /catalog/{ID}; each chunk holds one card.
  const cardRe = /<a[^>]*href="(https:\/\/product\.29cm\.co\.kr\/catalog\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = cardRe.exec(html)) !== null) {
    const productUrl = normalizeProductUrl(match[1])
    const itemId = match[2]
    const inner = match[3] ?? ""
    if (!isSafe29cmProductUrl(productUrl) || !itemId) continue
    // Image: first <img src="https://...29cm.co.kr...">
    const imgMatch = /<img[^>]*src="(https:\/\/[^"]*29cm\.co\.kr[^"]+)"/i.exec(inner)
    const imageUrl = imgMatch?.[1] ?? ""
    if (!isSafe29cmImageUrl(imageUrl)) continue
    // Name: first non-empty text after a [data-name] attr or in a span/strong/h3
    const nameMatch =
      /data-name="([^"]+)"/i.exec(inner) ||
      /<(?:span|strong|h3|h4|p)[^>]*class="[^"]*(?:name|title|product)[^"]*"[^>]*>([^<]+)</i.exec(inner)
    const name = (nameMatch?.[1] ?? "").trim()
    if (name.length === 0) continue
    // Price: first \d{3,}(?:,\d{3})* ideally followed by 원
    const priceMatch = /([\d]{1,3}(?:,[\d]{3})+|[\d]{4,})\s*원/.exec(inner)
    const priceStr = priceMatch?.[1]?.replace(/,/g, "")
    const price = priceStr ? Number(priceStr) : NaN
    if (!Number.isFinite(price) || price <= 0) continue
    out.push({
      brand: "29CM",
      name,
      category: "",
      price,
      originalPrice: price,
      salePrice: null,
      priceFormatted: `₩${price.toLocaleString("ko-KR")}`,
      imageUrl,
      productUrl,
      inStock: true,
      gender: gender ? [gender] : [],
      genderSource: gender ? "url" : undefined,
      platform: platformKey,
      crawledAt,
      productCode: itemId,
      sourceCurrency: "KRW",
      sourcePrice: price,
    })
  }
  return out
}

// ─── Engine entry ───────────────────────────────────────────

const ABORT_THRESHOLD = 3
const PER_CATEGORY_TIMEOUT_MS = 30_000
const SELECTOR_TIMEOUT_MS = 15_000
const SCROLL_PIXEL_STEP = 800
const SCROLL_PAUSE_MS = 600
const SCROLL_MAX_STEPS = 12
const PER_CATEGORY_PRODUCT_CAP = 200
const PRODUCT_HREF_SELECTOR = 'a[href^="https://product.29cm.co.kr/catalog/"]'
// XHR endpoint pattern — verified 2026-05-06 against display-bff-api.
const XHR_URL_RE = /display-bff-api\.29cm\.co\.kr\/api\/v1\/listing\/items(?:\?|$)/

interface CategoryScrapeResult {
  url: string
  products: Product[]
  error?: {type: string; detail: string}
}

async function crawlOneCategory(
  page: Page,
  categoryCode: number,
  baseUrl: string,
  platformKey: string,
): Promise<CategoryScrapeResult> {
  const categoryUrl = `https://www.29cm.co.kr/store/category/list?categoryLargeCode=${categoryCode}&sort=RECOMMENDED`
  const result: CategoryScrapeResult = {url: categoryUrl, products: []}
  const xhrPayloads: unknown[] = []

  const onResponse = async (res: Response) => {
    if (xhrPayloads.length >= 6) return
    if (!XHR_URL_RE.test(res.url())) return
    try {
      const buf = await res.body()
      xhrPayloads.push(JSON.parse(buf.toString("utf-8")))
    } catch {
      // ignore parse failure; surfaced below if no payload accumulated
    }
  }
  page.on("response", onResponse)

  try {
    const navResp = await page.goto(categoryUrl, {
      waitUntil: "domcontentloaded",
      timeout: PER_CATEGORY_TIMEOUT_MS,
    })
    const status = navResp?.status() ?? 0
    if (status >= 400) {
      result.error = {type: `http-${status}`, detail: `nav status ${status}`}
      return result
    }

    const probeBody = await page.content()
    const intercept = is29cmCloudflareChallenge(probeBody)
    if (intercept.isIntercept) {
      result.error = {type: intercept.reason ?? "intercept", detail: "cloudflare or hard-block"}
      return result
    }

    // Wait for either at least one XHR captured or product hrefs in DOM.
    try {
      await page.waitForSelector(PRODUCT_HREF_SELECTOR, {timeout: SELECTOR_TIMEOUT_MS})
    } catch {
      if (xhrPayloads.length === 0) {
        result.error = {type: "selector-timeout", detail: "product card href not rendered + no XHR captured"}
        return result
      }
    }

    // Infinite-scroll loop: trigger React Query to paginate.
    let lastHrefCount = 0
    let plateauCount = 0
    for (let i = 0; i < SCROLL_MAX_STEPS; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), (i + 1) * SCROLL_PIXEL_STEP)
      await page.waitForTimeout(SCROLL_PAUSE_MS)
      const hrefCount = await page.evaluate(
        (sel) => document.querySelectorAll(sel).length,
        PRODUCT_HREF_SELECTOR,
      )
      if (hrefCount >= PER_CATEGORY_PRODUCT_CAP) break
      if (hrefCount === lastHrefCount) {
        plateauCount += 1
        if (plateauCount >= 2) break
      } else {
        plateauCount = 0
        lastHrefCount = hrefCount
      }
    }
    await page.waitForTimeout(1_000)

    // Prefer XHR extraction; fall back to DOM if no XHR captured.
    let products: Product[] = []
    if (xhrPayloads.length > 0) {
      const harvested: RawTwentyninecmItem[] = []
      for (const payload of xhrPayloads) {
        const items = harvestRawItems(payload)
        for (const it of items) {
          it._categoryCode = categoryCode
          it._gender = genderFromCategoryCode(categoryCode)
          harvested.push(it)
        }
      }
      // Dedupe by itemId across pages.
      const seen = new Set<number>()
      const unique: RawTwentyninecmItem[] = []
      for (const it of harvested) {
        if (typeof it.itemId !== "number" || seen.has(it.itemId)) continue
        seen.add(it.itemId)
        unique.push(it)
      }
      products = parseProductsFromXhr(unique, baseUrl, platformKey)
    } else {
      const html = await page.content()
      const gender = genderFromCategoryCode(categoryCode)
      products = parseProductsFromDom(html, baseUrl, platformKey, gender)
    }

    if (products.length === 0) {
      result.error = {type: "empty-extraction", detail: "no products parsed from XHR or DOM fallback"}
      return result
    }
    result.products = products.slice(0, PER_CATEGORY_PRODUCT_CAP)
    return result
  } catch (err) {
    result.error = {type: "exception", detail: String(err).slice(0, 200)}
    return result
  } finally {
    page.off("response", onResponse)
  }
}

/**
 * @MX:ANCHOR: [AUTO] 29CM crawler entry point. Invariant: ALWAYS returns
 * a CrawlResult, never throws. Browser is launched and closed within
 * this function. Errors surfaced via result.errors[].
 * @MX:REASON: fan_in >= 3 (runCrawl, probeSite, characterization tests).
 * Behavior change here ripples through dispatch wiring and test fixtures;
 * keep the contract stable.
 * @MX:SPEC: SPEC-PLATFORM-EXPANSION-004 REQ-002, REQ-003, REQ-006
 */
// @MX:WARN: [AUTO] Browser lifecycle owned by this function — every
// `chromium.launch` MUST be matched by `browser.close()` in the finally
// block, or a Chromium subprocess will leak between crawl runs.
// @MX:REASON: 29CM-specific launch options (vanilla headless, ko-KR
// locale, Asia/Seoul timezone) are tied to the Cloudflare-passive bypass
// strategy and must not leak into the dispatcher.
export async function crawl29cm(config: SiteConfig): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []
  const allProducts: Product[] = []
  const crawlDelay = config.crawlDelay ?? 2000
  const codes = config.apiCategoryCodes ?? []

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl}) [29CM]`)
  console.log(`${"─".repeat(50)}`)

  // REQ-005: robots.txt pre-flight check before any browser launch.
  const robots = await checkRobots(config.baseUrl)
  if (!robots.allowed) {
    const msg =
      `[robots-block] ${config.key} blocked by robots.txt — ` +
      `${robots.blockingLine ?? "unknown"}. Project HARD rule #1.`
    errors.push(msg)
    console.error(`   ❌ ${msg}`)
    return buildResult(config.key, allProducts, errors, startTime)
  }

  if (codes.length === 0) {
    errors.push(JSON.stringify({type: "config-error", detail: "apiCategoryCodes is empty"}))
    return buildResult(config.key, allProducts, errors, startTime)
  }

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({headless: true})
  } catch (err) {
    errors.push(
      JSON.stringify({
        type: "browser-launch-failed",
        detail:
          `${String(err).slice(0, 200)}. 29CM engine requires bundled Chromium ` +
          `(playwright); install with \`npx playwright install chromium\`.`,
        timestamp: new Date().toISOString(),
      }),
    )
    return buildResult(config.key, allProducts, errors, startTime)
  }

  let consecutiveErrors = 0
  try {
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!
      const ua = pick29cmUserAgent(i)

      if (i > 0) {
        await new Promise((r) => setTimeout(r, crawlDelay))
      }

      const ctx = await browser.newContext({
        userAgent: ua,
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        viewport: {width: 1440, height: 900},
      })
      const page = await ctx.newPage()
      let result: CategoryScrapeResult
      try {
        result = await crawlOneCategory(page, code, config.baseUrl, config.key)
      } finally {
        await ctx.close().catch(() => {})
      }

      if (result.error) {
        consecutiveErrors += 1
        errors.push(
          JSON.stringify({
            categoryCode: code,
            type: result.error.type,
            detail: result.error.detail,
            timestamp: new Date().toISOString(),
          }),
        )
        console.error(
          `   ❌ code=${code}: ${result.error.type} (${consecutiveErrors}/${ABORT_THRESHOLD} consecutive)`,
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
        console.log(`   ℹ️  code=${code}: 0 products`)
        consecutiveErrors = 0
        continue
      }
      allProducts.push(...result.products)
      console.log(`   code=${code}: ${result.products.length} products`)
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

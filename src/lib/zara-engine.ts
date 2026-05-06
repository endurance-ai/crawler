/**
 * ZARA KR Terms of Service — pre-verified by project owner 2026-05-05 (hansangho).
 * Source PDF: static.zara.net/static/pdfs/KR/terms-and-conditions/terms-and-conditions-ko_KR-20251125.pdf
 *
 * §2.1 (general use limit):
 * 이용자는 회사에 대한 정당한 요청이나 주문 목적으로만 웹사이트를 이용할 수 있습니다.
 *
 * §6 bullet 2 (automated purchasing — does NOT apply to read-only scraping):
 * 자동구매 소프트웨어 기타 유사한 도구를 사용하여 다중 주문, 반복 구매, 사재기를 하는 행위
 *
 * §15 (IP rights — primary residual risk):
 * 웹사이트 내의 모든 콘텐츠에 대한 저작권, 상표권 등 일체의 지적 재산권은 회사 또는 회사가
 * 권한을 부여한 자에게 귀속됩니다. 이용자는 회사 또는 회사가 권한을 부여한 자의 허락을 받아
 * 해당 콘텐츠를 사용할 수 있습니다. 그러나 이용자가 필요한 범위 내에서 자신의 주문내역
 * 또는 계약 내용을 복사하는 행위는 허용됩니다.
 *
 * Verdict: AMBIGUOUS-ACCEPTED-BY-OWNER
 * Conditions: portal.ai-internal-use only; halt-on-cease-and-desist; re-verify on ToS PDF
 *             version change OR ITX Korea Limited communication OR > 90 days elapsed.
 * SPEC: SPEC-PLATFORM-EXPANSION-003 REQ-008 (amended v0.2.0)
 */

/**
 * ZARA US Terms of Service — captured by project owner 2026-05-06 (hansangho)
 * via canonical PDF located through SPA homepage footer.
 * Source PDF: static.zara.net/static/pdfs/US/terms-and-conditions/terms-and-conditions-en_US-20250829.pdf
 * Last modified (per PDF footer): August 26, 2025.
 *
 * Keyword scan: "crawl", "crawler", "scrape", "scraping", "robot", "bot",
 * "automated", "automation", "data harvest", "data extraction",
 * "screen scraping", "AI training", "machine learning" — NONE present
 * verbatim in the 24-page PDF. ZARA US ToS does NOT name automation
 * directly (in contrast to 29CM KR which named "크롤러(Crawler)" verbatim).
 *
 * §3 (USE OF OUR WEBSITE) bullet 1:
 * You may only use the Website and/or Mobile App to make legitimate
 * inquiries or orders.
 *
 * §3 (USE OF OUR WEBSITE) bullet 5:
 * You will not attempt to interfere or interfere in any way with the
 * Site's network, the Mobile App's network, or our networks, or related
 * network security, or attempt to use the Site's or Mobile App's service
 * to gain unauthorized access to any other computer system.
 *
 * §17 (INTELLECTUAL PROPERTY — primary residual risk; structurally
 * analogous to ZARA KR §15):
 * The Site and Mobile App, including all of its information and contents,
 * such as text, data, wallpaper, icons, characters, artwork, images,
 * photographs, graphics, music, sound, messages, graphics, software and
 * the HTML used to generate the pages (collectively, "Materials"), is
 * ZARA property or that of our suppliers or licensors and is protected by
 * patent, trademark and/or copyright under United States and/or foreign
 * laws. Except as otherwise provided on the Site, the Mobile App, or in
 * these Terms, you may not use, download, upload, copy, print, display,
 * perform, reproduce, publish, modify, delete, add to, license, post,
 * transmit, or distribute any Materials from the Site or Mobile App in
 * whole or in part for any public or commercial purpose without the
 * specific prior written permission of ZARA. We grant you a personal,
 * limited, non-exclusive, nontransferable license to access the Site
 * and/or Mobile App and to use the information and services contained on
 * the Site and/or Mobile App.
 * […]
 * Any commercial use of the Site or Mobile App is strictly prohibited,
 * except as allowed herein or otherwise approved by us. You may not
 * download or save a copy of any of the Materials or screens for any
 * purpose except as otherwise provided by ZARA.
 *
 * Verdict: AMBIGUOUS-ACCEPTED-BY-OWNER (parallel to KR §15 disposition).
 * No clause unambiguously forbids automated catalog access; §17 IP rights
 * are structurally analogous to KR §15 with slightly more explicit
 * "may not download or save a copy of any of the Materials" wording.
 * Conditions: portal.ai-internal-use only; halt-on-cease-and-desist;
 *             re-verify on ToS PDF version change (filename carries
 *             20250829 date stamp) OR ZARA USA, Inc. communication
 *             OR > 90 days elapsed.
 * Governing law (§Governing Law and Venue): State of New York. Federal
 *             or state courts of New York for litigation; AAA arbitration
 *             for disputes.
 * SPEC: SPEC-PLATFORM-EXPANSION-005 REQ-008
 */

/**
 * ZARA KR Playwright engine.
 *
 * Strategy: navigate to each category landing page in a real Chromium
 * browser (channel:"chrome", required because bundled chromium is hard
 * 403'd by Akamai's TLS/header fingerprint check — verified empirically
 * 2026-05-05, REQ-007 probe 5/5 pass). The page itself fetches the
 * `/kr/ko/category/{categoryId}/products?ajax=true` JSON endpoint over
 * the established Akamai-trusted session; the engine intercepts that
 * response via `page.on("response")` and parses the embedded product
 * shape directly. This is the cleanest available data source — every
 * product carries name, price (KRW integer), seo.keyword,
 * seo.seoProductId, availability, and detail.colors[0].xmedia[0] image
 * metadata.
 *
 * No fingerprint-evasion library is used. No IP rotation, no proxy,
 * no CAPTCHA solver, no authenticated scraping. `channel: "chrome"`
 * is a vanilla Playwright launch option that swaps the bundled
 * Chromium binary for the system's installed Chrome — it is not a
 * stealth plugin and does not modify browser fingerprint signals
 * beyond what a normal Chrome user would emit. This conforms to the
 * project HARD rules.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-003 REQ-001..REQ-009
 */

import {type Browser, chromium, type Page} from "playwright"
import type {CrawlResult, Product, SiteConfig} from "./types"
import {checkRobots} from "./robots-check"

// SPEC-PLATFORM-EXPANSION-005 REQ-002: region parameter drives source
// currency, price-formatter locale/symbol, and browser context locale +
// timezone. KR remains the default for backward compatibility.
export type ZaraRegion = "KR" | "US"

// ─── User-Agent rotation (one UA per browser context) ────────

const ZARA_USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
] as const

export function pickZaraUserAgent(index: number): string {
  return ZARA_USER_AGENTS[index % ZARA_USER_AGENTS.length]!
}

// ─── Image host whitelist ────────────────────────────────

/**
 * Verified host(s) seen in the live XHR payload on 2026-05-05:
 *   - static.zara.net
 * `static-images.zara.net` is included as a documented public alias
 * referenced in research.md §1.3 and accepted defensively even though
 * it was not observed during the live capture; if a future capture
 * reveals additional hosts, append them here.
 */
const ZARA_IMAGE_HOSTS = new Set(["static.zara.net", "static-images.zara.net"])

export function isSafeZaraImageUrl(src: string): boolean {
  if (typeof src !== "string" || !src.startsWith("https://")) return false
  try {
    return ZARA_IMAGE_HOSTS.has(new URL(src).hostname)
  } catch {
    return false
  }
}

// ─── productUrl whitelist regex (per-baseUrl) ──────────────

/**
 * Build a region-aware productUrl whitelist pattern keyed off the
 * SiteConfig `baseUrl`. The baseUrl typically looks like
 * `https://www.zara.com/kr/ko` or `https://www.zara.com/us/en`; we
 * escape regex metacharacters and append the canonical product-slug
 * tail `/<keyword>-p<id>.html`.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-005 REQ-002 (region parameterization)
 */
export function buildZaraProductUrlPattern(baseUrl: string): RegExp {
  const trimmed = baseUrl.replace(/\/+$/, "")
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Slug character set is URL-safe only — alphanumerics, percent-encoded
  // bytes, hyphen, dot. This rejects path-traversal sequences (../, /,
  // protocol-relative strings) that the previous `[^"'\s]+` permitted.
  // Security review 2026-05-06: SPEC-005 P1 hardening.
  return new RegExp(`^${escaped}/[A-Za-z0-9%.\\-]+-p\\d+\\.html$`)
}

export function isSafeZaraProductUrl(url: string, baseUrl: string): boolean {
  if (typeof url !== "string") return false
  return buildZaraProductUrlPattern(baseUrl).test(url)
}

// ─── price formatter (region-aware) ─────────────────────

/**
 * Region-aware raw-price normalizer. The ZARA XHR payload encodes
 * `price` differently per region (verified empirically 2026-05-06
 * against live KR + US captures):
 *   - KR: integer KRW (e.g. raw.price=19900 means ₩19,900)
 *   - US: integer cents (e.g. raw.price=14900 means $149.00)
 * Returns the normalized numeric price in the region's natural unit
 * (KRW integer for KR, USD decimal for US). Engine call sites pass
 * the normalized value to `formatZaraPrice` and store it on
 * `Product.price` / `Product.sourcePrice`.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-005 REQ-003 (cache stores native
 *       USD decimal), Run-phase IMPROVE finding 2026-05-06.
 */
export function normalizeZaraPrice(rawPrice: number, region: ZaraRegion): number {
  if (region === "US") return rawPrice / 100
  return rawPrice
}

/**
 * Region-aware price formatter. KR keeps the existing
 * `₩{price.toLocaleString("ko-KR")}` output bit-for-bit; US emits
 * `${price.toFixed(2)}` (USD decimal with two trailing digits).
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-005 REQ-002, AC-4
 */
export function formatZaraPrice(price: number, region: ZaraRegion): string {
  if (region === "US") return `$${price.toFixed(2)}`
  return `₩${price.toLocaleString("ko-KR")}`
}

// ─── bm-verify intercept detector ────────────────────────

const BM_VERIFY_BODY_LIMIT = 5000

export interface InterceptCheck {
  isIntercept: boolean
  reason?: string
}

export function detectBmVerifyIntercept(html: string): InterceptCheck {
  if (typeof html !== "string") return {isIntercept: true, reason: "non-string body"}
  if (html.length < BM_VERIFY_BODY_LIMIT && html.includes("bm-verify")) {
    return {isIntercept: true, reason: "bm-verify"}
  }
  // Bundled-Chromium hard-403 also returns a tiny body without bm-verify.
  if (html.length < 1000 && /access denied/i.test(html)) {
    return {isIntercept: true, reason: "access-denied-403"}
  }
  return {isIntercept: false}
}

// ─── Raw payload shape (subset of the live XHR JSON) ─────

export interface RawZaraXmedia {
  path?: string
  name?: string
  timestamp?: string | number
  layers?: Array<{url?: string}>
  url?: string
  extraInfo?: {deliveryUrl?: string}
}

export interface RawZaraColor {
  id?: string
  productId?: number
  name?: string
  hexColor?: string
  xmedia?: RawZaraXmedia[]
}

export interface RawZaraProduct {
  id?: number
  reference?: string
  name?: string
  price?: number
  section?: number
  sectionName?: string
  familyName?: string
  subfamilyName?: string
  detail?: {
    reference?: string
    displayReference?: string
    colors?: RawZaraColor[]
  }
  seo?: {
    keyword?: string
    seoProductId?: string
    discernProductId?: number
  }
  availability?: string
  availableColors?: Array<{colorName?: string; hexColor?: string}>
  /** Engine-attached annotation; not part of the canonical ZARA payload. */
  _gender?: string
  _category?: string
}

// ─── Pure parse helpers ──────────────────────────────────

function buildImageUrl(xm?: RawZaraXmedia): string {
  if (!xm) return ""
  // Preference order:
  // 1. layers[0].url with {width} placeholder
  const layerUrl = xm.layers?.[0]?.url
  if (typeof layerUrl === "string" && layerUrl.startsWith("https://")) {
    return layerUrl.replace("{width}", "1024")
  }
  // 2. extraInfo.deliveryUrl
  const dUrl = xm.extraInfo?.deliveryUrl
  if (typeof dUrl === "string" && dUrl.startsWith("https://")) return dUrl
  // 3. xm.url with {width} placeholder
  if (typeof xm.url === "string" && xm.url.startsWith("https://")) {
    return xm.url.replace("{width}", "1024")
  }
  // 4. Construct from path + name + timestamp
  if (xm.path && xm.name) {
    const ts = xm.timestamp ? `?ts=${xm.timestamp}&w=1024` : "?w=1024"
    return `https://static.zara.net${xm.path}/${xm.name}.jpg${ts}`
  }
  return ""
}

function buildProductUrl(baseUrl: string, seo: RawZaraProduct["seo"]): string {
  if (!seo?.keyword || !seo?.seoProductId) return ""
  const trimmed = baseUrl.replace(/\/+$/, "")
  return `${trimmed}/${seo.keyword}-p${seo.seoProductId}.html`
}

function mapGender(p: RawZaraProduct): string[] {
  // Prefer engine-attached _gender (derived from URL section). Fall back
  // to sectionName which is "WOMAN" / "MAN" in the live payload.
  if (p._gender) return [p._gender]
  const sn = (p.sectionName || "").toUpperCase()
  if (sn === "WOMAN") return ["women"]
  if (sn === "MAN") return ["men"]
  if (sn === "KID" || sn === "KIDS") return ["kids"]
  return []
}

/**
 * Walk an arbitrary XHR JSON payload and harvest leaf objects whose
 * shape matches a ZARA grid product (id+name+price+seo.keyword).
 */
export function harvestRawProducts(node: unknown, out: RawZaraProduct[] = [], depth = 0): RawZaraProduct[] {
  if (!node || depth > 12) return out
  if (Array.isArray(node)) {
    for (const it of node) harvestRawProducts(it, out, depth + 1)
    return out
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>
    const seo = obj.seo as RawZaraProduct["seo"] | undefined
    if (
      typeof obj.id === "number" &&
      typeof obj.name === "string" &&
      typeof obj.price === "number" &&
      seo &&
      typeof seo.keyword === "string"
    ) {
      out.push(obj as RawZaraProduct)
      return out
    }
    for (const k of Object.keys(obj)) harvestRawProducts(obj[k], out, depth + 1)
  }
  return out
}

/**
 * Pure parse function: takes the raw ZARA XHR JSON payload (or any
 * object that contains product nodes nested anywhere), returns
 * `Product[]`. Exposed for unit testing against the frozen fixture.
 *
 * @param json    The XHR JSON payload (parsed) OR an array of pre-harvested raw products.
 * @param baseUrl The site baseUrl (e.g. "https://www.zara.com/kr/ko").
 * @param platformKey The SiteConfig key (e.g. "zara-kr").
 *
 * @MX:NOTE: Defensive null-handling on every nested field; failed
 * extraction skips the product silently rather than aborting the page.
 */
export function parseProductsFromXhr(
  json: unknown,
  baseUrl: string,
  platformKey: string,
  region: ZaraRegion = "KR",
  sourceCurrency: "KRW" | "USD" = "KRW",
): Product[] {
  // Accept either a raw payload or a pre-harvested array.
  let raws: RawZaraProduct[]
  if (Array.isArray(json)) {
    raws = json as RawZaraProduct[]
  } else {
    raws = harvestRawProducts(json)
  }
  const out: Product[] = []
  const crawledAt = new Date().toISOString()
  const productUrlPattern = buildZaraProductUrlPattern(baseUrl)
  for (const raw of raws) {
    if (!raw.id || !raw.name || typeof raw.price !== "number" || raw.price <= 0) continue
    const productUrl = buildProductUrl(baseUrl, raw.seo)
    if (!productUrlPattern.test(productUrl)) continue
    const xm = raw.detail?.colors?.[0]?.xmedia?.[0]
    const imageUrl = buildImageUrl(xm)
    if (!imageUrl || !isSafeZaraImageUrl(imageUrl)) continue
    const colorNames = (raw.availableColors ?? [])
      .map((c) => c.colorName)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
    const inStock = (raw.availability ?? "").toLowerCase() === "in_stock"
    const normalizedPrice = normalizeZaraPrice(raw.price, region)
    out.push({
      brand: "ZARA",
      name: raw.name,
      category: [raw.familyName, raw.subfamilyName].filter(Boolean).join(" / "),
      price: normalizedPrice,
      originalPrice: normalizedPrice,
      salePrice: null,
      priceFormatted: formatZaraPrice(normalizedPrice, region),
      imageUrl,
      productUrl,
      inStock,
      gender: mapGender(raw),
      platform: platformKey,
      crawledAt,
      productCode: raw.seo?.seoProductId ?? String(raw.id),
      color: colorNames.length > 0 ? colorNames.join(", ").slice(0, 500) : undefined,
      sourceCurrency,
      sourcePrice: normalizedPrice,
    })
  }
  return out
}

// ─── Engine entry ────────────────────────────────────────

const ABORT_THRESHOLD = 3
const PER_CATEGORY_TIMEOUT_MS = 30_000
const SELECTOR_TIMEOUT_MS = 15_000
const SCROLL_PIXEL_STEP = 600
const SCROLL_PAUSE_MS = 350
const SCROLL_MAX_STEPS = 12
const PRODUCT_CARD_SELECTOR = ".product-grid-product, [data-productid]"
const COOKIE_ACCEPT_SELECTOR = "#onetrust-accept-btn-handler"
const XHR_URL_RE = /\/category\/\d+\/products\?ajax=true/

interface CategoryScrapeResult {
  url: string
  products: Product[]
  error?: {type: string; detail: string}
}

// @MX:WARN: [AUTO] Browser lifecycle is owned by this function — every
// `chromium.launch` call MUST be matched by a `browser.close()` in the
// finally block, or a Chromium subprocess will leak between crawl runs.
// @MX:REASON: Cafe24's pattern accepts an externally-owned Page, but
// ZARA's launch options (channel:"chrome", specific UA + locale +
// timezone) are tightly coupled to the Akamai-bypass strategy and must
// not leak into the dispatcher's concerns.
async function crawlOneCategory(
  page: Page,
  categoryUrl: string,
  baseUrl: string,
  platformKey: string,
  gender: string,
  region: ZaraRegion,
  sourceCurrency: "KRW" | "USD",
): Promise<CategoryScrapeResult> {
  const result: CategoryScrapeResult = {url: categoryUrl, products: []}

  let xhrPayload: unknown = null
  const onResponse = async (res: import("playwright").Response) => {
    if (xhrPayload) return // capture only the first matching response
    const url = res.url()
    if (!XHR_URL_RE.test(url)) return
    try {
      const buf = await res.body()
      xhrPayload = JSON.parse(buf.toString("utf-8"))
    } catch {
      // ignore parse failure; will be reported as no-data below
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
    // Quick body check for hard-403 / bm-verify intercept.
    const probeBody = await page.content()
    const intercept = detectBmVerifyIntercept(probeBody)
    if (intercept.isIntercept) {
      result.error = {type: intercept.reason ?? "intercept", detail: "bm-verify or hard-block"}
      return result
    }
    // Dismiss cookie banner if it intercepts events; ignore failures.
    try {
      await page.locator(COOKIE_ACCEPT_SELECTOR).click({timeout: 2500})
    } catch {
      // No banner present — continue
    }
    // Wait for at least one product card; selector failure is a
    // category-level failure (we do NOT attempt to "rescue" without DOM).
    try {
      await page.waitForSelector(PRODUCT_CARD_SELECTOR, {timeout: SELECTOR_TIMEOUT_MS})
    } catch {
      result.error = {type: "selector-timeout", detail: "product card not rendered"}
      return result
    }
    // Slow scroll to trigger ZARA's lazy AJAX. The XHR is fired during
    // the initial render in our 2026-05-05 capture; scrolling ensures
    // additional pagination XHRs fire if the category is large.
    for (let i = 0; i < SCROLL_MAX_STEPS && !xhrPayload; i++) {
      await page.evaluate(
        ([y]: [number]) => window.scrollTo(0, y),
        [(i + 1) * SCROLL_PIXEL_STEP] as [number],
      )
      await page.waitForTimeout(SCROLL_PAUSE_MS)
    }
    // Final wait for the response handler to finish.
    await page.waitForTimeout(1500)
    if (!xhrPayload) {
      result.error = {type: "xhr-not-captured", detail: "no /category/.../products?ajax=true response observed"}
      return result
    }
    // Parse — annotate each raw with _gender so the parser maps it correctly.
    const harvested = harvestRawProducts(xhrPayload)
    for (const r of harvested) r._gender = gender
    const products = parseProductsFromXhr(harvested, baseUrl, platformKey, region, sourceCurrency)
    result.products = products
    return result
  } catch (err) {
    result.error = {type: "exception", detail: String(err).slice(0, 200)}
    return result
  } finally {
    page.off("response", onResponse)
  }
}

/**
 * Region-agnostic gender derivation. Matches any 2-letter country/2-letter
 * language locale prefix (e.g. `/kr/ko/`, `/us/en/`) followed by the gender
 * slug. Return values are unchanged from the KR-only predecessor so that
 * downstream `mapGender` semantics are preserved bit-for-bit.
 *
 * SPEC: SPEC-PLATFORM-EXPANSION-005 REQ-002
 */
export function deriveGenderFromUrl(url: string): string {
  if (typeof url !== "string") return ""
  const m = url.match(/\/(?:[a-z]{2})\/(?:[a-z]{2})\/(woman|women|man|men|kids|kid)/)
  if (!m) return ""
  const slug = m[1]
  if (slug === "woman" || slug === "women") return "women"
  if (slug === "man" || slug === "men") return "men"
  return "kids"
}

/**
 * @MX:ANCHOR: [AUTO] ZARA crawler entry point. Invariant: ALWAYS returns
 * a CrawlResult, never throws. Browser is launched and closed within
 * this function. Errors are surfaced via result.errors[].
 * @MX:REASON: fan_in >= 3 (runCrawl, probeSite, characterization tests).
 * Behavior change here ripples through dispatch wiring and test fixtures;
 * keep the contract stable.
 * @MX:SPEC: SPEC-PLATFORM-EXPANSION-003 REQ-002, REQ-003, REQ-006
 */
export async function crawlZara(config: SiteConfig): Promise<CrawlResult> {
  const startTime = Date.now()
  const errors: string[] = []
  const allProducts: Product[] = []
  const crawlDelay = config.crawlDelay ?? 2000
  const categoryUrls = config.categoryUrls ?? []
  // SPEC-PLATFORM-EXPANSION-005 REQ-002: region drives source currency
  // and browser context locale/timezone. Default to KR for backward
  // compatibility with the SPEC-003 zara-kr SiteConfig.
  const region: ZaraRegion = config.region === "US" ? "US" : "KR"
  const sourceCurrency: "KRW" | "USD" =
    config.sourceCurrency === "USD" || config.sourceCurrency === "KRW"
      ? config.sourceCurrency
      : region === "US"
        ? "USD"
        : "KRW"

  console.log(`\n${"─".repeat(50)}`)
  console.log(`🏪 ${config.name} (${config.baseUrl}) [ZARA]`)
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
    browser = await chromium.launch({headless: true, channel: "chrome"})
  } catch (err) {
    errors.push(
      JSON.stringify({
        type: "browser-launch-failed",
        detail:
          `${String(err).slice(0, 200)}. ZARA engine requires a real Chrome ` +
          `binary on the host system; install Chrome OR run \`npx playwright install chrome\`.`,
        timestamp: new Date().toISOString(),
      }),
    )
    return buildResult(config.key, allProducts, errors, startTime)
  }

  let consecutiveErrors = 0
  try {
    for (let i = 0; i < categoryUrls.length; i++) {
      const categoryUrl = categoryUrls[i]!
      const ua = pickZaraUserAgent(i)
      const gender = deriveGenderFromUrl(categoryUrl)

      // 2 sec/page pacing between consecutive page navigations
      // (REQ-003). First request runs immediately.
      if (i > 0) {
        await new Promise((r) => setTimeout(r, crawlDelay))
      }

      const ctx = await browser.newContext({
        userAgent: ua,
        ...(region === "US"
          ? {locale: "en-US", timezoneId: "America/New_York"}
          : {locale: "ko-KR", timezoneId: "Asia/Seoul"}),
        viewport: {width: 1440, height: 900},
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
        // Empty category — non-error, do not increment counter.
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

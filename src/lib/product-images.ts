import {extractStructuredProduct} from "./parsers/structured-data"

export const PRODUCT_IMAGE_COLLECTION_VERSION = "product-images-v2"

export const PRODUCT_IMAGE_UTILITY_ASSET_PATTERN =
  String.raw`(?:^|/)(?:(?:icon|ico|logo|badge|button|btn|blank|spacer|loading|spinner|pixel|sprite|banner|payment|naver)(?:[/_.-])|size(?:[-_ ]?(?:chart|guide))(?:[/_.-]|$)|guide(?:[/_.-]|$)|web/main(?:/|$)|img_(?:product_big|404)\.(?:gif|jpe?g|png|webp)(?:$))`
const UTILITY_ASSET_RE = new RegExp(PRODUCT_IMAGE_UTILITY_ASSET_PATTERN, "i")
const NON_IMAGE_EXT_RE = /\.(?:css|html?|js|json|pdf|svg|woff2?)(?:$|[?#])/i
const IMAGE_EXT_RE = /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i

export interface ProductImagePage {
  evaluate<R = unknown>(
    pageFunction: string | ((arg: any) => R | Promise<R>) | (() => R | Promise<R>),
    arg?: any,
  ): Promise<R>
  url(): string
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

export function isProductImageUtilityAsset(raw: unknown, pageUrl: string): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false
  try {
    return UTILITY_ASSET_RE.test(new URL(decodeHtmlEntities(raw.trim()), pageUrl).pathname)
  } catch {
    return false
  }
}

export function normalizeProductImageUrl(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== "string") return null
  const cleaned = decodeHtmlEntities(raw.trim())
  if (
    !cleaned ||
    cleaned.startsWith("data:") ||
    cleaned.startsWith("blob:") ||
    cleaned.includes("${") ||
    cleaned.includes("{$")
  ) {
    return null
  }
  try {
    const url = new URL(cleaned, pageUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    // iOS App Transport Security blocks cleartext loads outright — it never
    // follows the host's http→https redirect — so an http:// URL renders as an
    // empty card in the app even though curl/browsers resolve it fine. Shopify's
    // og:image fallback emits store-domain http URLs, so upgrade here rather
    // than at each producer.
    if (url.protocol === "http:") url.protocol = "https:"
    url.hash = ""
    if (isProductImageUtilityAsset(url.toString(), pageUrl) || NON_IMAGE_EXT_RE.test(url.toString())) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Representative first, then every existing/new URL in stable source order. */
export function mergeProductImages(
  representative: string | null | undefined,
  pageUrl: string,
  ...groups: Array<ReadonlyArray<string | null | undefined> | null | undefined>
): string[] {
  const images: string[] = []
  const seen = new Set<string>()
  const add = (raw: unknown): void => {
    const normalized = normalizeProductImageUrl(raw, pageUrl)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    images.push(normalized)
  }
  add(representative)
  for (const group of groups) for (const value of group ?? []) add(value)
  return images
}

export function sanitizeProductImageFields(input: {
  productUrl: string
  imageUrl?: string | null
  sourceImageUrl?: string | null
  images?: ReadonlyArray<string | null | undefined> | null
}): {imageUrl: string; sourceImageUrl: string; images: string[]} | null {
  const images = mergeProductImages(
    input.imageUrl,
    input.productUrl,
    input.images,
    [input.sourceImageUrl],
  )
  const imageUrl = images[0]
  if (!imageUrl) return null
  return {
    imageUrl,
    sourceImageUrl: normalizeProductImageUrl(input.sourceImageUrl, input.productUrl) ?? imageUrl,
    images,
  }
}

function attr(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const quoted = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(tag)
  if (quoted) return quoted[2]
  return new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*([^\\s>]+)`, "i").exec(tag)?.[1] ?? null
}

function bestSrcsetUrl(value: string): string | null {
  const parsed = value
    .split(",")
    .map((part) => {
      const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i)
      if (!match) return null
      const numeric = Number(match[2] ?? 0)
      const score = match[3]?.toLowerCase() === "x" ? numeric * 1000 : numeric
      return {url: match[1], score: Number.isFinite(score) ? score : 0}
    })
    .filter((item): item is {url: string; score: number} => item !== null)
    .sort((a, b) => b.score - a.score)
  return parsed[0]?.url ?? null
}

/**
 * Static-HTML path. Structured product data is authoritative; DOM images are
 * accepted only when their own tag carries a product/gallery/detail signal.
 * Browser engines should use collectProductImagesFromPage for scoped DOM data.
 */
export function collectProductImagesFromHtml(
  html: string,
  pageUrl: string,
  existing: string[] = [],
): string[] {
  const structured = extractStructuredProduct(html)
  // Product JSON-LD / OG belongs to the current PDP. Do not widen an already
  // authoritative pool with arbitrary DOM images from recommendations, global
  // campaigns, or another product card rendered on the same page.
  if ((structured?.images.length ?? 0) > 0) {
    return mergeProductImages(existing[0], pageUrl, existing.slice(1), structured?.images)
  }
  const hinted: string[] = []
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0]
    if (!/(?:xans-product-(?:image|addimage)|keyImg|product[-_ ]?(?:gallery|images)|(?:gallery|detail|zoom)[-_ ]?(?:image|img)|item[-_ ]?image)/i.test(tag)) continue
    if (/(?:product[-_ ]?(?:list|card)|recommend|related|relation|recent|banner|lookbook|collection|size[-_ ]?(?:chart|guide))/i.test(tag)) continue
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset")
    if (srcset) hinted.push(bestSrcsetUrl(srcset) ?? "")
    for (const name of ["data-zoom-image", "data-origin", "data-original", "data-lazy-src", "data-src", "src"]) {
      const value = attr(tag, name)
      if (value) hinted.push(value)
    }
  }
  return mergeProductImages(existing[0], pageUrl, existing.slice(1), hinted)
}

/** Collect only product-owned gallery/detail DOM nodes; never scan the whole page. */
export async function collectProductImagesFromPage(
  page: ProductImagePage,
  existing: string[] = [],
): Promise<string[]> {
  const extracted = await page.evaluate(() => {
    const roots = [
      ".xans-product-image",
      ".xans-product-addimage",
      ".keyImg",
      "[class*='product-gallery']",
      "[class*='product-images']",
      "[data-component*='ProductImage']",
      "[data-testid*='product-image']",
    ]
    const excluded =
      "header, footer, nav, [class*='product-list'], [class*='product-card'], [class*='relation'], [class*='recommend'], [class*='recent'], [class*='banner'], [class*='lookbook'], [class*='collection'], [class*='size-chart'], [class*='size-guide']"
    const values: string[] = []
    const seenElements = new Set<Element>()
    for (const selector of roots) {
      for (const root of document.querySelectorAll(selector)) {
        if (root.matches(excluded) || root.closest(excluded)) continue
        const images = root instanceof HTMLImageElement ? [root, ...root.querySelectorAll("img")] : [...root.querySelectorAll("img")]
        for (const img of images) {
          if (seenElements.has(img) || img.closest(excluded)) continue
          seenElements.add(img)
          const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || ""
          if (srcset) {
            const best = srcset
              .split(",")
              .map((part) => {
                const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i)
                const numeric = Number(match?.[2] || 0)
                return match ? {url: match[1], score: match[3]?.toLowerCase() === "x" ? numeric * 1000 : numeric} : null
              })
              .filter((item): item is {url: string; score: number} => item !== null)
              .sort((a, b) => b.score - a.score)[0]
            if (best?.url) values.push(best.url)
          }
          for (const name of ["data-zoom-image", "data-origin", "data-original", "data-lazy-src", "data-src", "src"]) {
            const value = img.getAttribute(name)
            if (value) values.push(value)
          }
        }
        for (const anchor of root.querySelectorAll("a[href]")) {
          const href = anchor.getAttribute("href") || ""
          if (/\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i.test(href)) values.push(href)
        }
      }
    }
    const structuredHtml = [...document.querySelectorAll("script[type='application/ld+json'], meta[property^='og:'], meta[property^='product:']")]
      .map((node) => node.outerHTML)
      .join("\n")
    return {values, structuredHtml}
  })
  const structured = extractStructuredProduct(extracted.structuredHtml)
  return (structured?.images.length ?? 0) > 0
    ? mergeProductImages(existing[0], page.url(), existing.slice(1), structured?.images)
    : mergeProductImages(existing[0], page.url(), existing.slice(1), extracted.values)
}

export function hasExplicitImageExtension(url: string): boolean {
  return IMAGE_EXT_RE.test(url)
}

/** Extract every image exposed by Shopify's public product JSON endpoint. */
export function extractShopifyProductImages(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return []
  const root = payload as Record<string, unknown>
  const product = (root.product && typeof root.product === "object" ? root.product : root) as Record<string, unknown>
  const values: string[] = []
  const add = (value: unknown): void => {
    if (typeof value === "string") values.push(value)
    else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>
      if (typeof item.src === "string") values.push(item.src)
      else if (typeof item.url === "string") values.push(item.url)
    }
  }
  for (const image of Array.isArray(product.images) ? product.images : []) add(image)
  add(product.featured_image)
  for (const media of Array.isArray(product.media) ? product.media : []) {
    if (!media || typeof media !== "object") continue
    add((media as Record<string, unknown>).preview_image)
  }
  for (const variant of Array.isArray(product.variants) ? product.variants : []) {
    if (!variant || typeof variant !== "object") continue
    add((variant as Record<string, unknown>).featured_image)
  }
  return values
}

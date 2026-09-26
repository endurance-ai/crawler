import {extractStructuredProductForUrl} from "./parsers/structured-data"
import {sameProductPage} from "./product-url-identity"
import {htmlAttribute as attr, stripInertHtml} from "./html-attributes"

export const PRODUCT_IMAGE_COLLECTION_VERSION = "product-images-v4-scoped"

export const PRODUCT_IMAGE_UTILITY_ASSET_PATTERN =
  String.raw`(?:^|/)(?:(?:icon|ico|logo|badge|button|btn|blank|spacer|loading|spinner|pixel|sprite|banner|payment|naver)(?:[/_.-])|(?:campaign[-_]?logo|txt[-_]?naver)(?:[/_.-]|$)|(?:color|colour|option)[-_]?(?:swatch|chip)(?:[/_.-]|$)|size(?:[-_ ]?(?:chart|guide))(?:[/_.-]|$)|guide(?:[/_.-]|$)|web/main(?:/|$)|(?:img_(?:product_(?:tiny|small|medium|big)|404)|empty_thumb)\.(?:gif|jpe?g|png|webp)(?:$))`
const UTILITY_ASSET_RE = new RegExp(PRODUCT_IMAGE_UTILITY_ASSET_PATTERN, "i")
const SHARED_ASSET_RE = /(?:\/(?:img-prdback|kakao_bg|left_slide_banner_img)\.(?:png|jpe?g|webp|gif)$|\/web\/upload\/category\/)/i
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
    const pathname = new URL(decodeHtmlEntities(raw.trim()), pageUrl).pathname
    // "ICON" is also a merchandise line, not always a UI icon. Shopify's
    // product-photo filenames include a long numeric asset suffix in this case.
    if (/\/files\/(?:icon|logo)-[\w-]+-\d{5,}\.(?:jpe?g|png|webp)$/i.test(pathname)) return false
    return UTILITY_ASSET_RE.test(pathname) || SHARED_ASSET_RE.test(pathname)
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

/** Cafe24's `small` variant is useful only when no larger product image exists. */
export function isLowResolutionProductVariant(raw: unknown, pageUrl: string): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false
  try {
    return /\/web\/product\/small(?:\/|$)/i.test(new URL(decodeHtmlEntities(raw.trim()), pageUrl).pathname)
  } catch {
    return false
  }
}

function dropRedundantLowResolutionVariants(images: string[], pageUrl: string): string[] {
  if (!images.some((url) => !isLowResolutionProductVariant(url, pageUrl))) return images
  return images.filter((url) => !isLowResolutionProductVariant(url, pageUrl))
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

function isLikelyOptionImageTag(tag: string): boolean {
  const classOrId = `${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""}`
  if (/(?:swatch|swatches|color-swatch|colour-swatch|color-chip|colour-chip|option-image|option_thumb|colorchip|logo)/i.test(classOrId)) return true
  if (attr(tag, "data-color") !== null || attr(tag, "data-option") !== null || attr(tag, "role")?.toLowerCase() === "option") return true
  if (attr(tag, "data-zoom-image") || attr(tag, "data-origin") || attr(tag, "data-original") || attr(tag, "srcset") || attr(tag, "data-srcset")) return false
  const widthRaw = attr(tag, "width")
  const heightRaw = attr(tag, "height")
  const width = Number(widthRaw)
  const height = Number(heightRaw)
  if ((widthRaw !== null && Number.isFinite(width) && width <= 96)
    || (heightRaw !== null && Number.isFinite(height) && height <= 96)) return true
  if (widthRaw !== null && heightRaw !== null && Number.isFinite(width) && width === height && width <= 256) return true
  return false
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

const OWNED_IMAGE_ROOT_RE = /(?:xans-product-(?:image|addimage)|keyImg|prdDetail(?:Content)?|detail[-_ ]?area|product[-_ ]?(?:gallery|images)|(?:gallery|detail|zoom)[-_ ]?(?:image|img)|item[-_ ]?image)/i
const EXCLUDED_IMAGE_ROOT_RE = /(?:product[-_ ]?(?:list|card)|recommend|related|relation|recent|banner|lookbook|collection|size[-_ ]?(?:chart|guide))/i
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

/** Scan ancestry, not all page images. Ignore scripts/templates/comments and
 * keep quoted > inside tags. Both collection paths share this ownership rule. */
function collectScopedImages(html: string, pageUrl: string): string[] {
  const inert = stripInertHtml(html)
  const stack: Array<{tag: string; owned: boolean; excluded: boolean}> = []
  const images: string[] = []
  for (const match of inert.matchAll(/<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const tag = match[0]
    const name = match[1].toLowerCase()
    if (tag.startsWith("</")) {
      const index = stack.map((frame) => frame.tag).lastIndexOf(name)
      if (index >= 0) stack.splice(index)
      continue
    }
    const parent = stack[stack.length - 1]
    const hints = ["id", "class", "module", "data-component", "data-testid"].map((key) => attr(tag, key) ?? "").join(" ")
    const rawHref = name === "a" ? attr(tag, "href") : null
    const href = rawHref ? decodeHtmlEntities(rawHref) : null
    const otherProduct = href && /(?:\/(?:products?|goods?|items?|p)\/|[?&](?:product_no|variant|sku|pid|goodsNo|product_id|idx|id|branduid)=)/i.test(href)
      && !IMAGE_EXT_RE.test(href) && !sameProductPage(href, pageUrl)
    const excluded = Boolean(parent?.excluded || /^(header|footer|nav)$/.test(name)
      || EXCLUDED_IMAGE_ROOT_RE.test(hints) || otherProduct)
    const componentGallery = /ProductImage/i.test(attr(tag, "data-component") ?? "")
      || /product-image/i.test(attr(tag, "data-testid") ?? "")
    const owned = Boolean(parent?.owned || OWNED_IMAGE_ROOT_RE.test(hints) || componentGallery)
    if (owned && !excluded) {
      if (name === "img" || name === "source") {
        if (isLikelyOptionImageTag(tag)) continue
        const srcset = attr(tag, "srcset") || attr(tag, "data-srcset")
        if (srcset) images.push(bestSrcsetUrl(srcset) ?? "")
        for (const key of ["data-zoom-image", "data-origin", "data-original", "data-lazy-src", "ec-data-src", "data-src", "src"]) {
          const value = attr(tag, key)
          if (value) images.push(value)
        }
      } else if (href && IMAGE_EXT_RE.test(href)) images.push(href)
    }
    if (!VOID_TAGS.has(name) && !/\/\s*>$/.test(tag)) stack.push({tag: name, owned, excluded})
  }
  return images
}

/** Merge structured images with owned galleries, never page-wide imagery. */
export function collectProductImagesFromHtml(
  html: string,
  pageUrl: string,
  existing: string[] = [],
): string[] {
  const structured = extractStructuredProductForUrl(html, pageUrl)
  return dropRedundantLowResolutionVariants(
    mergeProductImages(existing[0], pageUrl, existing.slice(1), structured?.images, collectScopedImages(html, pageUrl)), pageUrl,
  )
}

/** Use the live DOM, including dynamically hydrated galleries and lazy URLs. */
export async function collectProductImagesFromPage(
  page: ProductImagePage,
  existing: string[] = [],
): Promise<string[]> {
  const html = await page.evaluate(() => document.documentElement.outerHTML)
  return collectProductImagesFromHtml(html, page.url(), existing)
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

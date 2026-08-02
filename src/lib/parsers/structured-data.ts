/**
 * Structured-data product extraction (JSON-LD schema.org/Product + Open Graph).
 *
 * Engine-agnostic: operates on a raw HTML string, so it works for fetch-based
 * engines and for Playwright (`page.content()`) alike. This is the Tier-1
 * extraction path for custom/minor-platform sites — selectors are the
 * fallback, not the default (SPEC: custom-brand pilot, 2026-07).
 */

export interface StructuredProductData {
  name: string | null
  description: string | null
  brand: string | null
  price: number | null
  currency: string | null
  images: string[]
  inStock: boolean | null
  color: string | null
  sku: string | null
  url: string | null
  /** which layer produced the core fields */
  source: "jsonld" | "og" | "merged"
}

type JsonRecord = Record<string, unknown>

const LD_JSON_SCRIPT = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  return null
}

function typeMatches(node: JsonRecord, wanted: string): boolean {
  const t = node["@type"]
  if (typeof t === "string") return t.toLowerCase() === wanted.toLowerCase()
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && x.toLowerCase() === wanted.toLowerCase())
  return false
}

/** Walk a parsed JSON-LD document (object / array / @graph) collecting Product nodes. */
function collectProductNodes(doc: unknown, out: JsonRecord[], depth = 0): void {
  if (depth > 6) return
  if (Array.isArray(doc)) {
    for (const item of doc) collectProductNodes(item, out, depth + 1)
    return
  }
  const node = asRecord(doc)
  if (!node) return
  if (typeMatches(node, "Product")) {
    out.push(node)
    return
  }
  const graph = node["@graph"]
  if (graph) collectProductNodes(graph, out, depth + 1)
  // Some templates nest Product under mainEntity / itemListElement
  if (node.mainEntity) collectProductNodes(node.mainEntity, out, depth + 1)
  if (node.itemListElement) collectProductNodes(node.itemListElement, out, depth + 1)
  if (node.item) collectProductNodes(node.item, out, depth + 1)
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.]/g, "")
    if (!cleaned) return null
    const num = Number(cleaned)
    return Number.isFinite(num) ? num : null
  }
  return null
}

function parseAvailability(value: unknown): boolean | null {
  const s = asString(value)
  if (!s) return null
  // normalize "in stock" / "IN_STOCK" / "https://schema.org/InStock" alike
  const compact = s.toLowerCase().replace(/[^a-z]/g, "")
  if (compact.includes("outofstock") || compact.includes("soldout") || compact.includes("discontinued")) return false
  if (compact.includes("instock") || compact.includes("limitedavailability")) return true
  return null
}

function extractImages(value: unknown): string[] {
  const urls: string[] = []
  const push = (u: unknown): void => {
    const s = asString(u)
    if (s && /^https?:\/\//.test(s) && !urls.includes(s)) urls.push(s)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      push(item)
      const rec = asRecord(item)
      if (rec) push(rec.url ?? rec.contentUrl)
    }
  } else {
    push(value)
    const rec = asRecord(value)
    if (rec) push(rec.url ?? rec.contentUrl)
  }
  return urls
}

interface OfferFields {
  price: number | null
  currency: string | null
  inStock: boolean | null
}

function extractOffer(value: unknown): OfferFields {
  const empty: OfferFields = {price: null, currency: null, inStock: null}
  if (Array.isArray(value)) {
    for (const item of value) {
      const got = extractOffer(item)
      if (got.price !== null || got.inStock !== null) return got
    }
    return empty
  }
  const offer = asRecord(value)
  if (!offer) return empty
  // AggregateOffer: use lowPrice; nested offers array takes precedence when present
  if (typeMatches(offer, "AggregateOffer")) {
    const nested = extractOffer(offer.offers)
    const price = nested.price ?? parsePrice(offer.lowPrice ?? offer.highPrice)
    return {
      price,
      currency: nested.currency ?? asString(offer.priceCurrency),
      inStock: nested.inStock ?? parseAvailability(offer.availability),
    }
  }
  const spec = asRecord(offer.priceSpecification)
  return {
    price: parsePrice(offer.price) ?? (spec ? parsePrice(spec.price) : null),
    currency: asString(offer.priceCurrency) ?? (spec ? asString(spec.priceCurrency) : null),
    inStock: parseAvailability(offer.availability),
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
}

function stripHtml(text: string): string {
  return decodeHtmlEntities(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

function mapProductNode(node: JsonRecord): StructuredProductData {
  const brandRec = asRecord(node.brand)
  const offer = extractOffer(node.offers)
  const rawDescription = asString(node.description)
  return {
    name: asString(node.name),
    description: rawDescription ? stripHtml(rawDescription).slice(0, 2000) || null : null,
    brand: asString(node.brand) ?? (brandRec ? asString(brandRec.name) : null),
    price: offer.price,
    currency: offer.currency,
    images: extractImages(node.image),
    inStock: offer.inStock,
    color: asString(node.color),
    sku: asString(node.sku) ?? asString(node.productID),
    url: asString(node.url),
    source: "jsonld",
  }
}

/**
 * Extract every schema.org/Product node from the page's JSON-LD blocks.
 * Malformed JSON blocks are skipped silently (common in the wild).
 */
export function extractJsonLdProducts(html: string): StructuredProductData[] {
  const nodes: JsonRecord[] = []
  for (const match of html.matchAll(LD_JSON_SCRIPT)) {
    const raw = match[1].trim()
    if (!raw) continue
    try {
      collectProductNodes(JSON.parse(raw), nodes)
    } catch {
      // tolerate trailing commas / HTML comments some themes emit
      try {
        collectProductNodes(JSON.parse(raw.replace(/<!--[\s\S]*?-->/g, "").replace(/,\s*([}\]])/g, "$1")), nodes)
      } catch {
        continue
      }
    }
  }
  return nodes.map(mapProductNode)
}

function metaContent(html: string, property: string): string | null {
  // property= or name=, attribute order varies by template
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
    "i",
  )
  const tag = re.exec(html)?.[0]
  if (!tag) return null
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
  return content ? decodeHtmlEntities(content).trim() || null : null
}

/** Open Graph / product: meta fallback. Weaker than JSON-LD (no color/sku). */
export function extractOgProduct(html: string): StructuredProductData | null {
  const ogType = metaContent(html, "og:type")
  const price = parsePrice(metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount"))
  const name = metaContent(html, "og:title")
  // Only treat as product signal when og:type says so or a price meta exists
  if (!(ogType?.toLowerCase().includes("product") || price !== null)) return null
  const image = metaContent(html, "og:image")
  return {
    name,
    description: metaContent(html, "og:description"),
    brand: metaContent(html, "product:brand"),
    price,
    currency: metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency"),
    images: image && /^https?:\/\//.test(image) ? [image] : [],
    inStock: parseAvailability(metaContent(html, "product:availability") ?? metaContent(html, "og:availability")),
    color: null,
    sku: null,
    url: metaContent(html, "og:url"),
    source: "og",
  }
}

/**
 * Tier-1 extraction entry point: JSON-LD first, OG fallback, field-level merge
 * (JSON-LD wins per field; OG fills gaps). Returns null when the page carries
 * no product structured data at all — caller falls back to selectors.
 */
export function extractStructuredProduct(html: string): StructuredProductData | null {
  const jsonld = extractJsonLdProducts(html)[0] ?? null
  const og = extractOgProduct(html)
  if (!jsonld) return og
  if (!og) return jsonld
  return {
    name: jsonld.name ?? og.name,
    description: jsonld.description ?? og.description,
    brand: jsonld.brand ?? og.brand,
    price: jsonld.price ?? og.price,
    currency: jsonld.currency ?? og.currency,
    images: jsonld.images.length > 0 ? jsonld.images : og.images,
    inStock: jsonld.inStock ?? og.inStock,
    color: jsonld.color,
    sku: jsonld.sku,
    url: jsonld.url ?? og.url,
    source: "merged",
  }
}

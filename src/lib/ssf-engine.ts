import type {CrawlResult, Product, SiteConfig, SsfCategory} from "./types"

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseWon(value: string): number | null {
  const matches = [...decodeHtml(value).matchAll(/([0-9][0-9,]*)/g)]
  if (matches.length === 0) return null
  const parsed = Number(matches.at(-1)![1]!.replaceAll(",", ""))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseSsfProductList(
  html: string,
  config: Pick<SiteConfig, "baseUrl" | "brand" | "key">,
  category: SsfCategory,
): Product[] {
  const products: Product[] = []
  const itemPattern = /<li\s+data-prdno="([^"]+)"[^>]*class="god-item"[^>]*>([\s\S]*?)(?=<li\s+data-prdno=|<\/ul>)/g

  for (const match of html.matchAll(itemPattern)) {
    const productCode = match[1]!
    const body = match[2]!
    const nameMatch = body.match(/<span\s+class="name">([\s\S]*?)<\/span>/)
    const imageMatch = body.match(/<img\s+src="(https:\/\/img\.ssfshop\.com\/[^"]+)"/)
    const hrefMatch = body.match(/<a\s+href="([^"]+\/good\?[^\"]+)"/)
    // The price block contains nested accessibility spans, so its first
    // `</span>` is not the end of the price. Stop at the following score block
    // (live markup) or the enclosing info div (minimal/legacy markup).
    const priceMatch = body.match(
      /<span\s+class="price">([\s\S]*?)(?=<span\s+class="score"|<\/div>\s*<\/a>)/,
    )
    if (!nameMatch || !imageMatch || !hrefMatch || !priceMatch) continue

    const priceBody = priceMatch[1]!
    const salePrice = parseWon(priceBody)
    if (salePrice === null) continue
    const originalMatch = priceBody.match(/<del>([\s\S]*?)<\/del>/)
    const originalPrice = originalMatch ? parseWon(originalMatch[1]!) : null
    // Category query parameters make the same SSF SKU look unique when it is
    // listed in more than one leaf department. Persist the retailer's stable
    // canonical detail path instead.
    const productUrl = new URL(`/JUUN-J/${encodeURIComponent(productCode)}/good`, config.baseUrl).toString()

    products.push({
      brand: config.brand ?? "",
      name: decodeHtml(nameMatch[1]!),
      category: category.category,
      gender: [category.gender],
      genderSource: "engine",
      price: salePrice,
      originalPrice: originalPrice && originalPrice > salePrice ? originalPrice : null,
      salePrice: originalPrice && originalPrice > salePrice ? salePrice : null,
      pricingObservation: {
        state: originalPrice && originalPrice > salePrice ? "sale" : "regular",
        source: "listing",
        version: 2,
      },
      priceFormatted: `${salePrice.toLocaleString("ko-KR")}원`,
      imageUrl: imageMatch[1]!,
      productUrl,
      inStock: true,
      platform: config.key,
      crawledAt: new Date().toISOString(),
      productCode,
      sourceCurrency: "KRW",
      sourcePrice: salePrice,
    })
  }
  return products
}

export function ssfTotalPages(html: string): number {
  const total = html.match(/id="ctgryGodsListTotalRow"\s*\/?>/)?.index
  const prefix = total === undefined ? html : html.slice(Math.max(0, total - 120), total + 80)
  const count = Number(prefix.match(/value="([0-9]+)"/)?.[1] ?? 0)
  return count > 0 ? Math.ceil(count / 60) : 1
}

export function mergeSsfProductEvidence(existing: Product | undefined, incoming: Product): Product {
  if (!existing) return incoming
  const existingGender = existing.gender[0]
  const incomingGender = incoming.gender[0]
  if (
    existingGender
    && incomingGender
    && existingGender !== incomingGender
    && existingGender !== "unisex"
    && incomingGender !== "unisex"
  ) {
    return {...existing, gender: ["unisex"], genderSource: "engine"}
  }
  return existing
}

function buildCategoryUrl(config: SiteConfig, category: SsfCategory, page: number): string {
  const url = new URL(category.path, config.baseUrl)
  url.searchParams.set("dspCtgryNo", category.dspCtgryNo)
  url.searchParams.set("brandShopNo", "BDMA07A11")
  url.searchParams.set("brndShopId", "ECBJC")
  url.searchParams.set("currentPage", String(page))
  url.searchParams.set("sortColumn", "NEW_GOD_SEQ")
  url.searchParams.set("serviceType", "DSP")
  url.searchParams.set("ctgrySectCd", "GNRL_CTGRY")
  url.searchParams.set("fitPsbYn", "N")
  return url.toString()
}

export async function crawlSsf(config: SiteConfig): Promise<CrawlResult> {
  const startedAt = Date.now()
  const errors: string[] = []
  const byCode = new Map<string, Product>()
  const categories = config.ssfCategories ?? []

  console.log(`\n${"─".repeat(50)}\n🏪 ${config.name} (${config.baseUrl}) [SSF]\n${"─".repeat(50)}`)
  for (const category of categories) {
    let pages = 1
    for (let page = 1; page <= pages; page++) {
      try {
        const response = await fetch(buildCategoryUrl(config, category, page), {
          headers: {"User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "ko-KR,ko;q=0.9"},
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) {
          errors.push(`${category.dspCtgryNo} page ${page}: HTTP ${response.status}`)
          break
        }
        const html = await response.text()
        if (page === 1) pages = Math.min(ssfTotalPages(html), config.maxPages ?? 20)
        const parsed = parseSsfProductList(html, config, category)
        for (const product of parsed) {
          const code = product.productCode!
          byCode.set(code, mergeSsfProductEvidence(byCode.get(code), product))
        }
        console.log(`   ${category.gender}/${category.category} ${page}/${pages}: ${parsed.length}개`)
        if (parsed.length === 0) break
        if (config.crawlDelay) await new Promise((resolve) => setTimeout(resolve, config.crawlDelay))
      } catch (error) {
        errors.push(`${category.dspCtgryNo} page ${page}: ${String(error)}`)
        break
      }
    }
  }

  const products = [...byCode.values()]
  const priced = products.filter((product) => product.price !== null)
  return {
    platform: config.key,
    products,
    stats: {
      totalProducts: products.length,
      inStock: products.length,
      outOfStock: 0,
      uniqueBrands: new Set(products.map((product) => product.brand)).size,
      avgPrice: priced.length
        ? Math.round(priced.reduce((sum, product) => sum + (product.price ?? 0), 0) / priced.length)
        : 0,
      duration: Date.now() - startedAt,
    },
    errors,
  }
}

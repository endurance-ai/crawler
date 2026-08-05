#!/usr/bin/env npx tsx
/**
 * Verified homepage fill for brand_nodes #5793-#5867.
 *
 * Dry-run by default. Pass --apply to update only rows that still have no
 * wiki.homepage_url. Existing URLs are never overwritten.
 */
import {createClient} from "@supabase/supabase-js"

type Homepage = {
  brandId: number
  brandName: string
  homepageUrl: string
  sources: string[]
  storefront: "KR" | "GLOBAL" | "JP" | "IT" | "FR" | "UK"
  currency?: "KRW" | "JPY" | "EUR" | "GBP"
  note?: string
}

const VERIFIED_HOMEPAGES: readonly Homepage[] = [
  {
    brandId: 5794,
    brandName: "8DIVISION",
    homepageUrl: "https://www.8division.com",
    sources: ["https://intl.8division.com/about.html", "https://www.8division.com"],
    storefront: "KR",
    currency: "KRW",
    note: "Korean official store and house-label storefront",
  },
  {
    brandId: 5796,
    brandName: "UNAFFECTED X OOFOS",
    homepageUrl: "https://unaffected.co.kr/collection.html?cate_no=89",
    sources: ["https://unaffected.co.kr/collection.html?cate_no=89", "https://unaffected.co.kr/category/unaffected/23/"],
    storefront: "KR",
    currency: "KRW",
    note: "Official Korean collaboration collection",
  },
  {
    brandId: 5798,
    brandName: "3.Paradis",
    homepageUrl: "https://www.3paradis.com",
    sources: ["https://www.3paradis.com", "https://www.3paradis.com/pages/about-the-brand"],
    storefront: "GLOBAL",
    currency: "KRW",
    note: "Official Shopify store offers South Korea and KRW in its country selector",
  },
  {
    brandId: 5799,
    brandName: "Droplet",
    homepageUrl: "https://thedropletco.com",
    sources: ["https://thedropletco.com/collections/all", "https://thedropletco.co.uk/pages/about-us"],
    storefront: "GLOBAL",
    note: "Official global storefront; no KR-localized official store found",
  },
  {
    brandId: 5835,
    brandName: "OSCITARE",
    homepageUrl: "https://oscitare.com",
    sources: ["https://oscitare.com/shopinfo/company.html"],
    storefront: "KR",
    currency: "KRW",
  },
  {
    brandId: 5838,
    brandName: "SADDLERS",
    homepageUrl: "https://saddlers.it",
    sources: ["https://saddlers.it/"],
    storefront: "IT",
    currency: "EUR",
    note: "Official Italian leather-accessories store; no KR-localized official store found",
  },
  {
    brandId: 5843,
    brandName: "FAB.IT",
    homepageUrl: "https://fabitsocks.com",
    sources: ["https://fabitsocks.com/?mode=f1&tid=7"],
    storefront: "JP",
    currency: "JPY",
  },
  {
    brandId: 5845,
    brandName: "LE TRAVAILLEUR GALLICE",
    homepageUrl: "https://travailleurgallice.com",
    sources: ["https://travailleurgallice.com/history/", "https://travailleurgallice.com/products/jacket/"],
    storefront: "FR",
    currency: "EUR",
  },
  {
    brandId: 5851,
    brandName: "ARCURI",
    homepageUrl: "https://www.arcuricravatte.it/en/",
    sources: ["https://www.arcuricravatte.it/en/about-us/", "https://havatishop.com/product/arcuri-smar-2401-blue/14944/"],
    storefront: "IT",
    currency: "EUR",
    note: "Official English-language site; Havati product history matches Franco Arcuri and San Mango d'Aquino",
  },
  {
    brandId: 5853,
    brandName: "THE CORONA UTILITY",
    homepageUrl: "https://www.baku-corona.com/en",
    sources: ["https://www.baku-corona.com/pages/about-us", "https://www.baku-corona.com/en/collections/frontpage"],
    storefront: "JP",
    currency: "JPY",
  },
  {
    brandId: 5857,
    brandName: "SEASUN",
    homepageUrl: "https://www.musinsa.com/brands/seasun",
    sources: ["https://global.musinsa.com/th/goods/5048946", "https://havatishop.com/category/seasun/324/"],
    storefront: "KR",
    currency: "KRW",
    note: "MUSINSA-hosted official online store; no standalone official domain found",
  },
  {
    brandId: 5859,
    brandName: "WONDERLAND",
    homepageUrl: "https://notwonderstore.com",
    sources: ["https://notwonderstore.com/", "https://www.houyhnhnm.jp/en/feature/312499/"],
    storefront: "JP",
    currency: "JPY",
    note: "Official store and atelier operated by the wonderland brand",
  },
  {
    brandId: 5860,
    brandName: "HAUSBACKEN",
    homepageUrl: "https://havatishop.com/category/hausbacken/218/",
    sources: ["https://havatishop.com/category/hausbacken/218/", "https://m.havatishop.com/skin-mobile1/product/hausbacken-daily-t-shirt-navy/16757/display/1/"],
    storefront: "KR",
    currency: "KRW",
    note: "Official Havati private-label storefront",
  },
  {
    brandId: 5864,
    brandName: "KIBATA",
    homepageUrl: "https://www.kibata.kr",
    sources: ["https://www.kibata.kr/Online-Store/?idx=22", "https://www.kibata.kr/shop_view/?idx=22"],
    storefront: "KR",
    currency: "KRW",
  },
  {
    brandId: 5865,
    brandName: "GALLIA",
    homepageUrl: "https://almalia.it",
    sources: ["https://almalia.it/homepage/", "https://almalia.it/our-hub/"],
    storefront: "IT",
    currency: "EUR",
    note: "Official producer site for Gallia Knit Project; no KR-localized official store found",
  },
  {
    brandId: 5867,
    brandName: "BANTS",
    homepageUrl: "https://bants.co.kr",
    sources: ["https://m.bants.co.kr/product/bants-npg-hawaiian-open-collar-shirt-half-navy/699/category/54/display/1/"],
    storefront: "KR",
    currency: "KRW",
  },
]

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

for (const verified of VERIFIED_HOMEPAGES) {
  const {data, error} = await db
    .from("brand_nodes")
    .select("id,brand_name,wiki")
    .eq("id", verified.brandId)
    .single()
  if (error) throw error
  if (data.brand_name !== verified.brandName) {
    throw new Error(`brand id mismatch: expected ${verified.brandName}, got ${data.brand_name}`)
  }

  const wiki = data.wiki && typeof data.wiki === "object" ? data.wiki as Record<string, unknown> : {}
  const before = typeof wiki.homepage_url === "string" && wiki.homepage_url.trim() ? wiki.homepage_url.trim() : null
  const action = before ? "SKIP_PRESENT" : apply ? "APPLY" : "DRY_RUN"
  console.log(`${action}\t${data.id}\t${data.brand_name}\t${before ?? "(missing)"} -> ${verified.homepageUrl}`)
  if (before || !apply) continue

  const nextWiki = {
    ...wiki,
    homepage_url: verified.homepageUrl,
    homepage_verified_at: new Date().toISOString(),
    homepage_sources: verified.sources,
    homepage_storefront: verified.storefront,
    ...(verified.currency ? {homepage_currency: verified.currency} : {}),
    ...(verified.note ? {homepage_verification_note: verified.note} : {}),
  }
  const {error: updateError} = await db
    .from("brand_nodes")
    .update({wiki: nextWiki})
    .eq("id", verified.brandId)
  if (updateError) throw updateError
}

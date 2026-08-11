#!/usr/bin/env npx tsx
/** Update only manually verified official brand homepages. Dry-run by default. */
import {createClient} from "@supabase/supabase-js"

const VERIFIED_HOMEPAGES = [
  {brandId: 244, brandName: "OPEN YY", homepageUrl: "https://open-yy.com", source: "https://open-yy.com/", storefront: "KR", currency: "KRW"},
  {brandId: 5332, brandName: "HYOVASMI", homepageUrl: "https://hyovasmi.com", source: "https://hyovasmi.com/", storefront: "KR", currency: "KRW"},
  {
    brandId: 5793,
    brandName: "AUTUMN",
    homepageUrl: "https://autumnshop.kr",
    source: "https://autumnshop.kr/",
    storefront: "KR",
    currency: "KRW",
  },
  {brandId: 5834, brandName: "FORÉT", homepageUrl: "https://www.foretstudio.dk", source: "https://www.foretstudio.dk/en-us/pages/about"},
  {brandId: 5836, brandName: "HAVERSACK", homepageUrl: "https://haversack.jp/en", source: "https://haversack.jp/en/pages/about-us"},
  {brandId: 5837, brandName: "CHURCHILLROMPER", homepageUrl: "https://www.churchillromper.com", source: "https://www.churchillromper.com/", storefront: "KR", currency: "KRW"},
  {brandId: 5839, brandName: "JOHNSTONES OF ELGIN", homepageUrl: "https://johnstonsofelgin.com/en-kr", source: "https://johnstonsofelgin.com/en-kr", storefront: "KR", currency: "KRW"},
  {brandId: 5840, brandName: "MAZI UNTITLED", homepageUrl: "https://maziuntitled.com", source: "https://maziuntitled.com/", storefront: "KR", currency: "KRW"},
  {brandId: 5841, brandName: "BARNS OUTFITTERS", homepageUrl: "https://barns.jp/ja", source: "https://barns.jp/ja/pages/about-barns"},
  {brandId: 5842, brandName: "SERVICE WORKS", homepageUrl: "https://serviceworks.xyz", source: "https://serviceworks.xyz/"},
  {brandId: 5844, brandName: "LONDON TRADITION", homepageUrl: "https://londontradition.com", source: "https://londontradition.com/about"},
  {brandId: 5846, brandName: "F.O.B FACTORY", homepageUrl: "https://fobfactory.jp", source: "https://fobfactory.jp/aboutus"},
  {brandId: 5847, brandName: "TARVAS", homepageUrl: "https://tarvasfootwear.com", source: "https://tarvasfootwear.com/"},
  {brandId: 5848, brandName: "PUBLIC FIGURE", homepageUrl: "https://publicfigure.kr", source: "https://publicfigure.kr/about", storefront: "KR", currency: "KRW"},
  {brandId: 5849, brandName: "ALL AMERICAN KHAKIS", homepageUrl: "https://www.allamericankhakis.com", source: "https://www.allamericankhakis.com/"},
  {brandId: 5850, brandName: "HOUSTON JAPAN", homepageUrl: "https://www.houston1972.com", source: "https://www.houston1972.com/"},
  {brandId: 5852, brandName: "WOULDBE", homepageUrl: "https://wouldbe.co.kr", source: "https://wouldbe.co.kr/category/cut-sew/72/", storefront: "KR", currency: "KRW"},
  {brandId: 5854, brandName: "BURGUS PLUS", homepageUrl: "https://burgusplus.jp", source: "https://burgusplus.jp/"},
  {brandId: 5855, brandName: "REGAL SHOE & CO.", homepageUrl: "https://regal-shoe-and-co.com/ko", source: "https://regal-shoe-and-co.com/ko", storefront: "KR"},
  {brandId: 5856, brandName: "NORTH SEA CLOTHING", homepageUrl: "https://northseaclothing.com", source: "https://northseaclothing.com/products"},
  {brandId: 5858, brandName: "DUBBLEWORKS", homepageUrl: "https://dubbleworks.com", source: "https://dubbleworks.com/"},
  {brandId: 5861, brandName: "FUJITO", homepageUrl: "https://gofujito.com", source: "https://gofujito.com/about/"},
  {brandId: 5862, brandName: "OMOTO DENIM", homepageUrl: "https://omotodenim.jp/en", source: "https://omotodenim.jp/en/pages/about-omotodenim"},
  {brandId: 5863, brandName: "REFOMED", homepageUrl: "https://refomed.jp", source: "https://refomed.jp/pages/about"},
  {brandId: 5866, brandName: "IYSO", homepageUrl: "https://iyso.kr", source: "https://iyso.kr/", storefront: "KR", currency: "KRW"},
] as const

const apply = process.argv.includes("--apply")
const brandIdsArg = process.argv.find((arg) => arg.startsWith("--brand-ids="))
const brandIds = brandIdsArg
  ? new Set(brandIdsArg.split("=", 2)[1].split(",").map(Number).filter(Number.isFinite))
  : null
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)

for (const verified of VERIFIED_HOMEPAGES.filter((item) => !brandIds || brandIds.has(item.brandId))) {
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
  const before = typeof wiki.homepage_url === "string" ? wiki.homepage_url : null
  console.log(`${apply ? "APPLY" : "DRY-RUN"}\t${data.id}\t${data.brand_name}\t${before ?? "(missing)"} -> ${verified.homepageUrl}`)
  if (!apply || before === verified.homepageUrl) continue

  const verifiedAt = new Date().toISOString()
  const nextWiki = {
    ...wiki,
    homepage_url: verified.homepageUrl,
    homepage_verified_at: verifiedAt,
    homepage_sources: [verified.source],
    ...("storefront" in verified ? {homepage_storefront: verified.storefront} : {}),
    ...("currency" in verified ? {homepage_currency: verified.currency} : {}),
  }
  const {error: updateError} = await db.from("brand_nodes").update({wiki: nextWiki}).eq("id", verified.brandId)
  if (updateError) throw updateError
}

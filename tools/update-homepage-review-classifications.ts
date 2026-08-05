#!/usr/bin/env npx tsx
/** Persist non-homepage outcomes from the 2026-08-05 full legacy re-audit. */
import {createClient} from "@supabase/supabase-js"

type Review = {
  id: number
  brandName: string
  status: "social_only_no_standalone_site" | "duplicate_node" | "retailer_source_optional" | "parent_brand_optional"
  sources: string[]
  note: string
  sourcePlatforms?: string[]
  duplicateOf?: number
}

const REVIEWS: Review[] = [
  {
    id: 5378,
    brandName: "dieweltbuhne",
    status: "social_only_no_standalone_site",
    sources: ["https://www.instagram.com/dieweltbuhne/"],
    note: "Exact social handle re-searched; no matching independent fashion storefront or official standalone domain was verifiable. Same-name German magazine/theatre sites were rejected as unrelated.",
  },
  {
    id: 5429,
    brandName: "TOFF",
    status: "social_only_no_standalone_site",
    sources: ["https://www.instagram.com/toff.syn/"],
    note: "Exact @toff.syn identity re-searched; no independent official storefront or domain was verifiable, and generic TOFF results were rejected as ambiguous.",
  },
  {
    id: 5594,
    brandName: "OTIE",
    status: "retailer_source_optional",
    sources: ["https://www.musinsa.com/brand/otie", "https://global.musinsa.com/ca/brands/otie", "https://www.instagram.com/otie_official/"],
    sourcePlatforms: ["musinsa"],
    note: "Exact Korean OTIE (One Thing Is Enough) identity and KRW products verified at Musinsa; no independent official store was found, so homepage is optional rather than erroneous.",
  },
  {
    id: 5616,
    brandName: "culm",
    status: "social_only_no_standalone_site",
    sources: ["https://www.instagram.com/culm_official/"],
    note: "Exact @culm_official identity re-searched; no independent official storefront or domain was verifiable.",
  },
  {
    id: 5623,
    brandName: "Cenji",
    status: "social_only_no_standalone_site",
    sources: ["https://www.instagram.com/is_cenji/"],
    note: "Exact @is_cenji identity re-searched; no independent official storefront or domain was verifiable.",
  },
  {
    id: 5644,
    brandName: "regen seoul",
    status: "parent_brand_optional",
    sources: ["https://hyosungtextile.com/en/regen/about", "https://www.hyosung.com/en/newsroom/view/13298"],
    sourcePlatforms: ["hyosung"],
    note: "Verified as Hyosung TNC's regen recycled-fiber regional sub-brand, not an independent apparel storefront. The official parent-brand page is recorded as evidence; homepage is optional.",
  },
  {
    id: 5728,
    brandName: "DADAS",
    status: "retailer_source_optional",
    sources: ["https://partyholic.vn/collections/vendors?q=dadas-stu", "https://www.instagram.com/dadas.stu/"],
    sourcePlatforms: ["partyholic"],
    note: "Exact Vietnamese Dadas.stu products were verified at multi-brand dress retailer Partyholic; no independent official store was found, so homepage is optional.",
  },
  {
    id: 5729,
    brandName: "fairrose",
    status: "social_only_no_standalone_site",
    sources: ["https://www.instagram.com/fairrose_official/"],
    note: "Exact @fairrose_official identity re-searched; no independent official storefront or domain was verifiable.",
  },
  {
    id: 5743,
    brandName: "Azamm",
    status: "social_only_no_standalone_site",
    sources: ["https://www.instagram.com/the.azamm.project/"],
    note: "Exact @the.azamm.project identity re-searched; no independent official storefront or domain was verifiable. Node 5755 is a duplicate of this identity.",
  },
  {
    id: 5755,
    brandName: "Azamm",
    status: "duplicate_node",
    sources: ["https://www.instagram.com/the.azamm.project/"],
    duplicateOf: 5743,
    note: "Duplicate brand node: exact name and @the.azamm.project handle match canonical node 5743. It is not an independent homepage target.",
  },
]

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
const db = createClient(dbUrl, dbToken)
const reviewedAt = new Date().toISOString()

for (const review of REVIEWS) {
  const {data: row, error} = await db.from("brand_nodes").select("id,brand_name,source_platforms,wiki").eq("id", review.id).single()
  if (error) throw error
  if (row.brand_name !== review.brandName) throw new Error(`brand mismatch for ${review.id}: ${row.brand_name}`)
  const wiki = row.wiki && typeof row.wiki === "object" ? row.wiki : {}
  const nextWiki = {
    ...wiki,
    homepage_review_status: review.status,
    homepage_reviewed_at: reviewedAt,
    homepage_review_sources: review.sources,
    homepage_review_note: review.note,
    ...(review.duplicateOf ? {duplicate_brand_node_id: review.duplicateOf} : {}),
  }
  const nextPlatforms = review.sourcePlatforms
    ? [...new Set([...(row.source_platforms ?? []), ...review.sourcePlatforms])]
    : row.source_platforms
  console.log(`${apply ? "APPLY" : "DRY_RUN"}\t${review.id}\t${review.brandName}\t${review.status}`)
  if (!apply) continue
  const {error: updateError} = await db.from("brand_nodes").update({wiki: nextWiki, source_platforms: nextPlatforms}).eq("id", review.id)
  if (updateError) throw updateError
}

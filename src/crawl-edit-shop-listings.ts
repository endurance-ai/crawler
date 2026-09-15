import {createClient} from "@supabase/supabase-js"

import {extractWhat100ProductNos, validateWhat100ProductNos} from "./lib/edit-shop-listings"

const WHAT100_URL = "https://m.slowsteadyclub.com/program/what100.html"

async function main() {
  const response = await fetch(WHAT100_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KikoCatalog/1.0; +https://kiko.fashion)",
      Accept: "text/html,application/xhtml+xml",
    },
  })
  if (!response.ok) throw new Error(`what100 fetch failed: HTTP ${response.status}`)
  const productNos = extractWhat100ProductNos(await response.text())
  validateWhat100ProductNos(productNos)

  if (process.argv.includes("--dry-run")) {
    console.log(`what100 valid: ${productNos.length} products (${productNos[0]}..${productNos.at(-1)})`)
    return
  }

  const dbUrl = process.env.DB_URL
  const dbToken = process.env.DB_TOKEN
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
  const db = createClient(dbUrl, dbToken)
  const capturedAt = new Date().toISOString()
  const {error} = await db.rpc("replace_edit_shop_listing_snapshot", {
    p_platform: "slowsteadyclub",
    p_list_type: "what100",
    p_list_key: "what100",
    p_display_name: "WHAT THEY WANT 100",
    p_captured_at: capturedAt,
    p_items: productNos.map((product_no, index) => ({product_no, source_rank: index + 1})),
  })
  if (error) throw new Error(`what100 publish failed: ${error.message}`)
  console.log(`what100 published: 100 products at ${capturedAt}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})


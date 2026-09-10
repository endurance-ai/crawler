/** Generate missing image-derived product features with the local Qwen3-VL endpoint. */
import {createClient} from "@supabase/supabase-js"
import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {assertQwenReady, generateQwenObject, loadQwenConfig} from "./lib/qwen-client"
import {downloadRemoteImage} from "./lib/safe-remote-image"
import {
  featureRetrievalText,
  productFeaturePrompt,
  productFeatureSchema,
} from "./lib/catalog/product-features"

type ProductRow = {
  id: number | string
  brand: string
  name: string
  category: string | null
  subcategory: string | null
  image_url: string | null
  image_selection_version: string | null
  image_selected_at: string | null
  product_features?: Array<{product_id: number | string}> | null
}

const valueArg = (name: string): string | null => {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null
}

const ids = (valueArg("product-ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const platform = valueArg("platform")
const limit = Math.max(1, Number(valueArg("limit") ?? "200"))
const concurrency = Math.max(1, Math.min(4, Number(valueArg("concurrency") ?? "2")))
const apply = process.argv.includes("--apply")

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")
if (ids.length === 0 && !platform) throw new Error("--product-ids or --platform is required")
const db = createClient(dbUrl, dbToken)

async function loadRows(): Promise<ProductRow[]> {
  let query = db.from("products")
    .select("id,brand,name,category,subcategory,image_url,image_selection_version,image_selected_at,product_features(product_id)")
    .not("image_url", "is", null)
    .not("image_selection_version", "is", null)
    .not("image_selected_at", "is", null)
    .is("product_features", null)
    .order("id")
    .limit(limit)
  if (ids.length > 0) query = query.in("id", ids)
  if (platform) query = query.eq("platform", platform)
  const {data, error} = await query
  if (error) throw error
  return (data ?? []) as unknown as ProductRow[]
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (cursor < items.length) await worker(items[cursor++]!)
  }))
}

async function main(): Promise<void> {
  const rows = await loadRows()
  console.log(`product feature candidates=${rows.length} mode=${apply ? "apply" : "dry-run"}`)
  if (rows.length === 0 || !apply) return
  await assertQwenReady(loadQwenConfig())
  let written = 0
  await runPool(rows, async (row) => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "kiko-product-feature-"))
    let generated
    try {
      const downloaded = await downloadRemoteImage(row.image_url!, tempDir)
      const bytes = await fsp.readFile(downloaded.path)
      const mime = downloaded.mimeType.startsWith("image/") ? downloaded.mimeType : "image/jpeg"
      generated = await generateQwenObject({
        schema: productFeatureSchema,
        system: "You are a conservative fashion product image attribute extractor.",
        prompt: productFeaturePrompt(row),
        imageUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      })
    } finally {
      await fsp.rm(tempDir, {recursive: true, force: true})
    }
    const {error} = await db.from("product_features").upsert({
      product_id: row.id,
      retrieval_text: featureRetrievalText(row, generated.value),
      feature_metadata: generated.value,
      text_embedding: null,
      embedding_model: null,
      feature_version: "catalog-qwen-v1",
      vlm_model: generated.model,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {onConflict: "product_id"})
    if (error) throw error
    written++
  })
  console.log(`product features written=${written}`)
}

main().catch((error) => {
  console.error("product feature enrichment failed", error)
  process.exitCode = 1
})

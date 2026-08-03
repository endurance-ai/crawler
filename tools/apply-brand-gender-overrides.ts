/**
 * Apply only manually web-verified brand gender corrections.
 *
 * Dry run:
 *   pnpm exec dotenv -e .env.local -- tsx tools/apply-brand-gender-overrides.ts
 * Apply:
 *   pnpm exec dotenv -e .env.local -- tsx tools/apply-brand-gender-overrides.ts --apply
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {createClient} from "@supabase/supabase-js"

type Scope = "men" | "women" | "unisex"

interface Override {
  brandId: number
  brandName: string
  before: Scope[]
  after: Scope[]
  confidence: number
  sources: string[]
  descriptionKo?: string
}

const shouldApply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

const db = createClient(dbUrl, dbToken)
const repo = path.resolve(import.meta.dirname, "..")
const overridePath = path.join(repo, "data", "brand-gender-verified-overrides.json")
const overrides = JSON.parse(fs.readFileSync(overridePath, "utf8")) as Override[]

function sameArray(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function wikiGender(scope: Scope): string {
  if (scope === "men") return "\uB0A8\uC131"
  if (scope === "women") return "\uC5EC\uC131"
  return "\uACF5\uC6A9"
}

function wikiIsVerified(row: {wiki: unknown}, item: Override): boolean {
  if (!row.wiki || typeof row.wiki !== "object") return false
  const wiki = row.wiki as Record<string, unknown>
  return wiki.gender === wikiGender(item.after[0]) &&
    typeof wiki.gender_verified_at === "string" &&
    wiki.gender_confidence === item.confidence &&
    sameArray(wiki.gender_sources, item.sources) &&
    (!item.descriptionKo || wiki.description_ko === item.descriptionKo)
}

async function main(): Promise<void> {
  const ids = overrides.map((item) => item.brandId)
  const {data, error} = await db
    .from("brand_nodes")
    .select("id,brand_name,gender_scope,wiki")
    .in("id", ids)
  if (error) throw error

  const rows = new Map((data ?? []).map((row) => [row.id, row]))
  const conflicts: string[] = []
  for (const item of overrides) {
    const row = rows.get(item.brandId)
    if (!row) conflicts.push(`${item.brandId} ${item.brandName}: missing`)
    else if (row.brand_name !== item.brandName) conflicts.push(`${item.brandId}: expected ${item.brandName}, got ${row.brand_name}`)
    else if (!sameArray(row.gender_scope, item.before) && !sameArray(row.gender_scope, item.after)) {
      conflicts.push(`${item.brandId} ${item.brandName}: expected ${JSON.stringify(item.before)}, got ${JSON.stringify(row.gender_scope)}`)
    }
  }
  if (conflicts.length) throw new Error(`Preflight conflicts:\n${conflicts.join("\n")}`)

  const pending = overrides.filter((item) => {
    const row = rows.get(item.brandId)
    return !row || !sameArray(row.gender_scope, item.after) || !wikiIsVerified(row, item)
  })
  console.log(JSON.stringify({mode: shouldApply ? "apply" : "dry-run", verified: overrides.length, pending: pending.length}, null, 2))
  for (const item of pending) console.log(`${item.brandId}\t${item.brandName}\t${item.before[0]} -> ${item.after[0]}`)
  if (!shouldApply) return

  const verifiedAt = new Date().toISOString()
  for (const item of pending) {
    const row = rows.get(item.brandId)!
    const currentWiki = row.wiki && typeof row.wiki === "object" ? row.wiki as Record<string, unknown> : {}
    const wiki = {
      ...currentWiki,
      ...(item.descriptionKo ? {description_ko: item.descriptionKo} : {}),
      gender: wikiGender(item.after[0]),
      gender_verified_at: verifiedAt,
      gender_confidence: item.confidence,
      gender_sources: item.sources,
    }
    const {error: updateError} = await db
      .from("brand_nodes")
      .update({gender_scope: item.after, wiki})
      .eq("id", item.brandId)
    if (updateError) throw updateError
  }
  console.log(`applied: ${pending.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

/**
 * Brand Enrichment Import — manifest.jsonl + brands/{id}.json → brand_nodes.wiki jsonb
 *
 * @MX:NOTE: SPEC-BRAND-WIKI-001 P2 import script.
 *   - status=ok: 자동 import (1,901개)
 *   - status=review: 별도 admin 승인 필요 (--include-review 플래그)
 *   - status=no_data: import 안 함 (사용자 기여 대상)
 *
 * 실행:
 *   pnpm exec dotenv -e .env.local -- npx tsx src/import-brand-enrichment.ts [--include-review] [--dry-run] [--limit N]
 *
 * 사전 조건:
 *   - app/database/migrations/068_brand_wiki.sql 적용됨 (brand_nodes.wiki jsonb 추가)
 *   - data/brand-enrichment/manifest.jsonl, brands/ 존재
 *   - .env.local 에 DB_URL, DB_TOKEN 세팅
 */

import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN

if (!dbUrl || !dbToken) {
  console.error("❌ DB_URL, DB_TOKEN 환경변수 필요")
  process.exit(1)
}

const db = createClient(dbUrl, dbToken)

const REPO = path.resolve(__dirname, "..")
const ENRICHMENT_DIR = path.join(REPO, "data", "brand-enrichment")
const MANIFEST_PATH = path.join(ENRICHMENT_DIR, "manifest.jsonl")
const BRANDS_DIR = path.join(ENRICHMENT_DIR, "brands")

// ── CLI flags ───────────────────────────────────────────────
const args = process.argv.slice(2)
const includeReview = args.includes("--include-review")
const dryRun = args.includes("--dry-run")
const limitArg = args.find((a) => a.startsWith("--limit="))
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity

// ── Types ───────────────────────────────────────────────────
interface ManifestEntry {
  brand_id: number
  brand_name: string
  status: "ok" | "review" | "no_data" | "error"
  confidence: number
  ts: string
  reason: string | null
}

interface BrandJson {
  brand_id: number
  brand_name: string
  instagram_handle: string | null
  instagram_url: string | null
  homepage_url: string | null
  description_ko: string | null
  description_original: string | null
  description_source_lang: string
  founder: string[]
  founded_year: number | null
  origin_country: string | null
  sources: Array<{ type: string; url: string; fetched_at: string; title: string; excerpt: string }>
  confidence: Record<string, number>
  review_reasons: string[]
  processed_at: string
  schema_version: string
}

// @MX:ANCHOR: brand_nodes.wiki jsonb 의 표준 직렬화 형식.
// @MX:REASON: 차후 admin UI, apify caller, search 모두 이 shape 에 의존.
function buildWikiPayload(d: BrandJson, m: ManifestEntry): Record<string, unknown> {
  return {
    instagram_handle: d.instagram_handle,
    instagram_url: d.instagram_url,
    homepage_url: d.homepage_url,
    description_ko: d.description_ko,
    description_original: d.description_original,
    description_source_lang: d.description_source_lang,
    founder: d.founder,
    founded_year: d.founded_year,
    origin_country: d.origin_country,
    sources: d.sources,
    confidence: d.confidence.overall,
    confidence_breakdown: {
      instagram_handle: d.confidence.instagram_handle,
      homepage_url: d.confidence.homepage_url,
      description: d.confidence.description,
      founder: d.confidence.founder,
      founded_year: d.confidence.founded_year,
      origin_country: d.confidence.origin_country,
    },
    status: m.status,
    review_reasons: d.review_reasons,
    enriched_at: d.processed_at,
    schema_version: d.schema_version,
  }
}

async function main(): Promise<void> {
  console.log(`📂 Loading manifest: ${MANIFEST_PATH}`)

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`❌ Manifest not found: ${MANIFEST_PATH}`)
    process.exit(1)
  }

  const manifestLines = fs.readFileSync(MANIFEST_PATH, "utf-8").trim().split("\n")
  const entries: ManifestEntry[] = manifestLines.map((l) => JSON.parse(l))

  // Filter by status
  const allowedStatuses = includeReview ? new Set(["ok", "review"]) : new Set(["ok"])
  const targets = entries.filter((e) => allowedStatuses.has(e.status)).slice(0, limit)

  console.log(`📊 Total manifest: ${entries.length}`)
  console.log(`📊 Targets (${[...allowedStatuses].join("|")}): ${targets.length}`)
  console.log(`📊 Dry-run: ${dryRun}`)
  console.log("")

  let ok = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < targets.length; i++) {
    const m = targets[i]
    const brandPath = path.join(BRANDS_DIR, `${m.brand_id}.json`)

    if (!fs.existsSync(brandPath)) {
      console.warn(`⚠️  ${m.brand_id} ${m.brand_name}: JSON not found, skip`)
      skipped++
      continue
    }

    const d: BrandJson = JSON.parse(fs.readFileSync(brandPath, "utf-8"))
    const wiki = buildWikiPayload(d, m)

    if (dryRun) {
      if (i < 3) {
        console.log(`[DRY] ${m.brand_id} ${m.brand_name}:`)
        console.log(`      wiki=${JSON.stringify(wiki).slice(0, 200)}...`)
      }
      ok++
      continue
    }

    // PATCH brand_nodes.wiki = jsonb
    const { error } = await db
      .from("brand_nodes")
      .update({ wiki })
      .eq("id", m.brand_id)

    if (error) {
      console.error(`❌ ${m.brand_id} ${m.brand_name}: ${error.message}`)
      failed++
      continue
    }

    ok++
    if ((i + 1) % 100 === 0) {
      console.log(`  progress: ${i + 1}/${targets.length} (ok=${ok}, skip=${skipped}, fail=${failed})`)
    }
  }

  console.log("")
  console.log(`✅ Done: ok=${ok}, skipped=${skipped}, failed=${failed}`)
  if (dryRun) {
    console.log(`   (DRY-RUN mode — no DB writes)`)
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err)
  process.exit(1)
})

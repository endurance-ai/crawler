/**
 * brand-db.json의 attributes → brand_nodes.attributes 컬럼에 임포트
 *
 * 실행: pnpm exec dotenv -e .env.local -- npx tsx scripts/import-attributes.ts
 */

import * as fs from "fs"
import * as path from "path"
import { createClient } from "@db/db-js"

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN

if (!dbUrl || !dbToken) {
  console.error("❌ DB_URL, DB_TOKEN 환경변수 필요")
  process.exit(1)
}

const db = createClient(dbUrl, dbToken)

type BrandEntry = {
  name: string
  nameRaw: string
  styleNode: string | null
  attributes: Record<string, string[]>
}

async function main() {
  const jsonPath = path.resolve(process.cwd(), "data", "brand-db.json")
  if (!fs.existsSync(jsonPath)) {
    console.error("❌ data/brand-db.json 없음")
    process.exit(1)
  }

  const brands: BrandEntry[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"))
  console.log(`📦 ${brands.length}개 브랜드 로드\n`)

  const withAttrs = brands.filter((b) => Object.keys(b.attributes).length > 0)
  console.log(`🏷️  attributes 있음: ${withAttrs.length}개`)
  console.log(`⬜ attributes 없음: ${brands.length - withAttrs.length}개\n`)

  let updated = 0
  let notFound = 0
  let errors = 0

  for (const brand of withAttrs) {
    const { error, count } = await db
      .from("brand_nodes")
      .update({ attributes: brand.attributes })
      .ilike("brand_name_normalized", brand.name)

    if (error) {
      console.error(`  ❌ ${brand.name}: ${error.message}`)
      errors++
    } else if (count === 0) {
      // fallback: nameRaw로 시도
      const { count: c2 } = await db
        .from("brand_nodes")
        .update({ attributes: brand.attributes })
        .ilike("brand_name", brand.nameRaw)

      if (c2 && c2 > 0) {
        updated++
      } else {
        notFound++
      }
    } else {
      updated++
    }
  }

  console.log("\n" + "═".repeat(50))
  console.log(`✅ 업데이트: ${updated}개`)
  console.log(`⬜ 미발견: ${notFound}개`)
  console.log(`❌ 에러: ${errors}개`)
  console.log("═".repeat(50))
}

main().catch(console.error)

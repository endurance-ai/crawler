/**
 * 크롤링 JSON → products 테이블 적재
 *
 * 사용법:
 *   npx dotenv -e .env.local -- npx tsx scripts/import-products.ts                  # data/ 내 전체
 *   npx dotenv -e .env.local -- npx tsx scripts/import-products.ts --site=obscura   # 특정 플랫폼만
 */

import * as fs from "fs"
import * as path from "path"
import {createClient} from "@supabase/supabase-js"
// @MX:NOTE: Import-time USD→KRW conversion for caches whose source
// currency is non-KRW (currently Uniqlo US). Cache stores native USD;
// only the DB upsert payload sees post-conversion KRW.
// SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-004
import {convertToKrw} from "./lib/fx"
import {applyValidationGate} from "./lib/core/validation-gate"
import {applyProductQcGate, getProductQcReport} from "./lib/product-qc/normalization"

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN

if (!dbUrl || !dbToken) {
  console.error("❌ DB_URL, DB_TOKEN 환경변수 필요")
  console.error("   .env.local에서 로드하려면: npx dotenv -e .env.local -- npx tsx scripts/import-products.ts")
  process.exit(1)
}

const db = createClient(dbUrl, dbToken)

interface CrawledReview {
  text: string
  author: string
  date: string
  photoUrls: string[]
  body: {
    height: string | null
    weight: string | null
    usualSize: string | null
    purchasedSize: string | null
    bodyType: string | null
  } | null
}

interface CrawledProduct {
  brand: string
  name: string
  price: number | null
  originalPrice?: number | null
  salePrice?: number | null
  priceFormatted: string
  imageUrl: string
  productUrl: string
  inStock: boolean
  gender: string[]
  platform: string
  crawledAt: string
  // 상세 페이지 데이터
  description?: string
  color?: string
  material?: string
  subcategory?: string
  images?: string[]
  sizeInfo?: string
  tags?: string[]
  productCode?: string
  /** Source currency (KRW default; "USD" for Uniqlo US cache) */
  sourceCurrency?: "USD" | "EUR" | "GBP" | "KRW"
  // 리뷰 데이터
  reviewCount?: number
  reviews?: CrawledReview[]
}

// 자사몰: brand가 비어있으면 이 이름으로 채움
const SELF_BRANDED: Record<string, string> = {
  roughside: "Roughside",
  bastong: "Bastong",
  blankroom: "Blankroom",
  havati: "Havati",
  mardimercredi: "Mardi Mercredi",
  sienneboutique: "Sienne",
  eastlogue: "Eastlogue",
  anotheroffice: "Another Office",
  slowsteadyclub: "Slow Steady Club",
  llud: "LLUD",
  pottery: "Pottery",
  beslow: "Beslow",
  steadyeverywear: "Steady Everywear",
  chanceclothing: "Chance Clothing",
  yuse: "YUSE",
  ojos: "OJOS",
  goyowear: "GOYOWEAR",
}

// ─── Brand resolution (SPEC-BRAND-NODE-001 PR-Y) ───────────────
//
// 미존재 brand 발견 시 crawler 가 brand_nodes 에 신규 INSERT.
// 기존 brand 와 trigram 유사도 >= 0.85 면 brand_node_review_queue
// 에 reason='alias_candidate' 로 enqueue (admin merge 검토).
// primary_style_node_id / secondary_style_node_id 등 노드 컬럼은 NULL —
// SPEC-BRAND-NODE-001 P3 의 brand-VLM script 가 채운다.

const FUZZY_ALIAS_THRESHOLD = 0.85

interface BrandNodeRow {
  id: number
  brand_name: string
  brand_name_normalized: string | null
}

// platform_key → brand_node_id 해석. product_crawl_status(091) 는 brand_node_id 가 PK 이고
// admin 페이지(product_crawl_brands 뷰)가 이걸 읽는다. 이미 platform_key 가 채워진 status 행이
// 있으면 그걸로 resolve, 없으면 brand_nodes 를 brand_name 으로 매칭해 폴백한다.
async function resolveBrandNodeId(platform: string, brandName: string | null): Promise<number | null> {
  const {data: statusRow} = await db
    .from("product_crawl_status")
    .select("brand_node_id")
    .eq("platform_key", platform)
    .maybeSingle()
  if (statusRow) return (statusRow as {brand_node_id: number}).brand_node_id

  if (brandName) {
    const {data: node} = await db
      .from("brand_nodes")
      .select("id")
      .ilike("brand_name", brandName)
      .maybeSingle()
    if (node) return (node as {id: number}).id
  }
  return null
}

// import 성공/실패를 product_crawl_status(091, brand_node_id 기준)에 자동 반영한다.
// 배포 admin 페이지가 읽는 product_crawl_brands 뷰의 소스가 이 테이블이다.
// brand_node_id 해석 실패 시 no-op(신규 브랜드는 brand_nodes 등록 후 반영됨).
async function syncProductCrawlStatus(
  platform: string,
  brandName: string | null,
  result: {inserted: number; errors: number; total: number},
): Promise<void> {
  const brandNodeId = await resolveBrandNodeId(platform, brandName)
  if (!brandNodeId) return

  const success = result.errors === 0 && result.inserted > 0
  const status = success ? "imported" : "qc_failed"

  await db.from("product_crawl_status").upsert(
    {
      brand_node_id: brandNodeId,
      status,
      platform_key: platform,
      imported_at: success ? new Date().toISOString() : null,
      qc_summary: {rows_total: result.total, rows_upserted: result.inserted, errors: result.errors},
    },
    {onConflict: "brand_node_id"},
  )

  await db.from("product_crawl_runs").insert({
    brand_node_id: brandNodeId,
    stage: "import",
    status: success ? "success" : "failed",
    platform_key: platform,
    actor: "import-products-auto",
    command: `import-products --site=${platform}`,
    metrics: {rows_total: result.total, rows_upserted: result.inserted, errors: result.errors},
  })
}

function normalizeBrand(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ")
}

/** pg_trgm 호환 trigram set (with " " padding). */
function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase().trim()} `
  const out = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
  return out
}

/** Jaccard similarity over trigrams. pg_trgm similarity() 와 거의 동일. */
function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 && tb.size === 0) return 0
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  const union = ta.size + tb.size - intersection
  return union === 0 ? 0 : intersection / union
}

async function loadBrandNodes(): Promise<{
  rows: BrandNodeRow[]
  idMap: Map<string, number>
}> {
  const idMap = new Map<string, number>()

  // PostgREST default 1000 row limit — paginate to fetch all brand_nodes (~2,100 rows).
  // 062 마이그 이후 brand_nodes.style_node legacy text 컬럼 제거됨.
  // 신규 분류는 primary_style_node_id FK → style_nodes 테이블 join 으로 얻음.
  const PAGE = 1000
  const rows: BrandNodeRow[] = []
  let offset = 0
  for (;;) {
    const {data, error} = await db
      .from("brand_nodes")
      .select("id, brand_name, brand_name_normalized")
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.warn("⚠️ brand_nodes 조회 실패:", error.message)
      break
    }
    if (!data?.length) break
    rows.push(...(data as BrandNodeRow[]))
    if (data.length < PAGE) break
    offset += PAGE
  }

  for (const bn of rows) {
    if (bn.brand_name_normalized) {
      idMap.set(bn.brand_name_normalized.toLowerCase(), bn.id)
    }
    idMap.set(bn.brand_name.toLowerCase(), bn.id)
  }
  console.log(`🏷️ brand_nodes ${rows.length}개 로드 (id_map=${idMap.size})`)
  return {rows, idMap}
}

/**
 * unknown brand 문자열에 대해
 *   1) trigram 유사도 >= 0.85 인 기존 brand 검색
 *   2) brand_nodes 에 신규 INSERT (노드 컬럼은 NULL)
 *   3) 유사 brand 있으면 brand_node_review_queue 에 reason='alias_candidate'
 *
 * 결과로 idMap 을 in-place 업데이트.
 */
async function resolveUnknownBrands(
  unknown: Array<{raw: string; platform: string}>,
  known: BrandNodeRow[],
  idMap: Map<string, number>,
): Promise<{inserted: number; aliasFlagged: number; failed: number}> {
  let inserted = 0
  let aliasFlagged = 0
  let failed = 0

  for (const {raw, platform} of unknown) {
    const normalized = normalizeBrand(raw)

    // 1) Fuzzy match against existing brand_name_normalized (+ raw fallback).
    let best: {id: number; name: string; sim: number} | null = null
    for (const bn of known) {
      const candidate = (bn.brand_name_normalized ?? bn.brand_name).toLowerCase().trim()
      if (!candidate) continue
      const sim = trigramSimilarity(normalized, candidate)
      if (!best || sim > best.sim) {
        best = {id: bn.id, name: bn.brand_name_normalized ?? bn.brand_name, sim}
      }
    }

    // 2) Insert new brand_nodes row. id 는 bigserial 자동.
    const {data: ins, error: insErr} = await db
      .from("brand_nodes")
      .insert({
        brand_name: raw,
        brand_name_normalized: normalized,
        gender_scope: [],
        source_platforms: [platform],
      })
      .select("id")
      .single()

    if (insErr || !ins) {
      console.warn(`   ⚠️ brand_nodes INSERT 실패 "${raw}": ${insErr?.message ?? "no data"}`)
      failed++
      continue
    }

    const newId = (ins as {id: number}).id
    idMap.set(raw.toLowerCase(), newId)
    idMap.set(normalized, newId)
    inserted++

    // 3) Alias candidate enqueue (best.sim >= threshold 일 때만).
    if (best && best.sim >= FUZZY_ALIAS_THRESHOLD) {
      const {error: rqErr} = await db
        .from("brand_node_review_queue")
        .insert({
          brand_id: newId,
          reason: "alias_candidate",
          vlm_output: {
            similar_to: {id: best.id, brand_name: best.name, similarity: best.sim},
            new_brand: {brand_name: raw, brand_name_normalized: normalized},
            source_platform: platform,
          },
        })
      if (rqErr) {
        console.warn(`   ⚠️ review_queue INSERT 실패 brand=${newId}: ${rqErr.message}`)
      } else {
        aliasFlagged++
      }
    }
  }

  return {inserted, aliasFlagged, failed}
}

async function main() {
  const dataDir = path.join(process.cwd(), "data")

  if (!fs.existsSync(dataDir)) {
    console.error(`❌ data/ 디렉토리 없음. 먼저 크롤러 실행: npx tsx scripts/crawl.ts --help`)
    process.exit(1)
  }

  // --site 플래그 파싱
  const siteArg = process.argv.find((a) => a.startsWith("--site="))
  const targetSites = siteArg ? siteArg.split("=")[1].split(",") : null

  // --no-new-brands: 미등록 brand를 brand_nodes에 INSERT하지 않고 해당 상품도 적재 제외
  const noNewBrands = process.argv.includes("--no-new-brands")

  // --in-stock-only: 품절(in_stock=false) 상품을 적재에서 제외.
  // 크롤러가 이미 품절을 거르지만, import 단계에서도 명시적으로 보장한다.
  const inStockOnly = process.argv.includes("--in-stock-only")

  // data/ 내 *-products.json 파일 찾기
  const files = fs.readdirSync(dataDir)
    .filter((f) => f.endsWith("-products.json"))
    .filter((f) => {
      if (!targetSites) return true
      const platform = f.replace("-products.json", "")
      return targetSites.includes(platform)
    })

  if (files.length === 0) {
    console.error("❌ 적재할 파일 없음")
    process.exit(1)
  }

  console.log(`📦 ${files.length}개 파일 적재 시작\n`)

  // ── brand_nodes 로드 (id_map only — legacy style_node text 컬럼 062에서 drop) ─
  const {rows: brandRows, idMap: brandIdMap} = await loadBrandNodes()

  // ── Pre-scan: 모든 파일에서 unique brand 문자열 수집 ──────
  // 미존재 brand 는 한 번에 resolve (fuzzy + insert + alias_candidate enqueue).
  // 파일 JSON 은 캐시해서 main loop 에서 재사용 (디스크 IO 1회).
  const fileCache = new Map<string, CrawledProduct[]>()
  const unknownBrands = new Map<string, string>() // brand → first-seen platform

  for (const file of files) {
    const platform = file.replace("-products.json", "")
    const filePath = path.join(dataDir, file)
    let raw: CrawledProduct[]
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch {
      continue // main loop 에서 에러 처리
    }
    fileCache.set(file, raw)

    for (const p of raw) {
      const brand = (p.brand as string) || SELF_BRANDED[platform] || ""
      if (!brand) continue
      const key = brand.toLowerCase()
      if (!brandIdMap.has(key) && !unknownBrands.has(brand)) {
        unknownBrands.set(brand, platform)
      }
    }
  }

  if (unknownBrands.size > 0) {
    if (noNewBrands) {
      console.log(`⚠️  미등록 brand ${unknownBrands.size}개 발견 — --no-new-brands 모드: INSERT 건너뜀, 해당 상품 적재 제외`)
      console.log(`   제외 브랜드: ${[...unknownBrands.keys()].slice(0, 10).join(", ")}${unknownBrands.size > 10 ? ` 외 ${unknownBrands.size - 10}개` : ""}\n`)
    } else {
      console.log(`🆕 미등록 brand ${unknownBrands.size}개 발견 — 자동 INSERT + alias 검사`)
      const resolveResult = await resolveUnknownBrands(
        [...unknownBrands.entries()].map(([raw, platform]) => ({raw, platform})),
        brandRows,
        brandIdMap,
      )
      console.log(
        `   ✅ inserted=${resolveResult.inserted}, alias_candidate=${resolveResult.aliasFlagged}, failed=${resolveResult.failed}\n`,
      )
    }
  }

  let totalInserted = 0
  let totalErrors = 0
  let totalReviews = 0

  for (const file of files) {
    const platform = file.replace("-products.json", "")

    const cached = fileCache.get(file)
    if (!cached) {
      // Pre-scan 단계에서 파싱 실패한 파일.
      console.error(`   ❌ ${file} JSON 파싱 실패 (pre-scan)`)
      totalErrors++
      continue
    }
    const rawAll: CrawledProduct[] = cached
    // SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-001/002: validate every parsed
    // product before the DB upsert. Valid products pass through
    // byte-identical into the existing .map(); invalid ones are excluded
    // + a structured reject event is emitted (does not crash the import
    // on a single bad record). Flag OFF (CRAWLER_VALIDATION_ENABLED=
    // false) → exact legacy behavior (no gate, all products imported).
    const qcRaw = applyProductQcGate(rawAll, platform)
    const raw: CrawledProduct[] = applyValidationGate(qcRaw, platform)
    console.log(`📄 ${file} — ${raw.length}개 상품`)

    // SPEC-005 P1 review 2026-05-06: detect stale Shopify caches that
    // were generated BEFORE the engine native-currency unification.
    // Old caches stored `price` already converted to KRW (e.g. £100 →
    // 175000). If the first sample has sourceCurrency in {USD, EUR, GBP}
    // AND a `price` value implausibly large for that currency (> 5000),
    // it almost certainly is the old format. Refuse to import to avoid
    // double conversion silently inflating Supabase prices.
    if (raw.length > 0) {
      const sample = raw[0] as unknown as Record<string, unknown>
      const sc = typeof sample.sourceCurrency === "string" ? sample.sourceCurrency : undefined
      const sp = typeof sample.price === "number" ? sample.price : null
      if (sc && (sc === "USD" || sc === "EUR" || sc === "GBP") && sp !== null && sp > 5000) {
        console.error(
          `   ❌ ${file} appears to be in legacy KRW-converted format (sourceCurrency=${sc}, price=${sp}). ` +
            `Re-crawl this platform with the current Shopify engine before importing. Skipping.`,
        )
        totalErrors++
        continue
      }
    }

    let fxSkipped = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = raw.map((p: any) => {
      const brand = (p.brand as string) || SELF_BRANDED[platform] || ""
      const productUrl = (p.productUrl as string) || ""

      // --no-new-brands: 미등록 brand 상품 적재 제외
      if (noNewBrands && brand && !brandIdMap.has(brand.toLowerCase())) return null
      // --in-stock-only: 품절 상품 적재 제외
      if (inStockOnly && p.inStock === false) return null
      // color NOT NULL — color 없는 상품은 스킵
      if (!p.color) return null
      // product_no 추출
      const pnoMatch = productUrl.match(/product_no=(\d+)/)
      const productNo = pnoMatch ? parseInt(pnoMatch[1], 10) : null

      // 가격 정합성: integer 범위(2^31) 초과 or 비현실적 값 제거
      const MAX_PRICE = 100_000_000 // 1억원
      const sanitizePrice = (v: unknown): number | null => {
        const n = typeof v === "number" ? v : null
        return n && n > 0 && n <= MAX_PRICE ? n : null
      }

      // SPEC-PLATFORM-EXPANSION-002 REQ-004: import-time USD→KRW
      // conversion. When the cache's sourceCurrency is non-KRW (currently
      // only Uniqlo US ships with "USD"), convert numeric price fields
      // before sanitization. Cached on-disk values remain untouched.
      // If convertToKrw returns null (unknown currency), skip the product.
      const sourceCurrency = (p.sourceCurrency as string | undefined) ?? "KRW"
      let priceRaw = p.price as number | null | undefined
      let originalRaw = p.originalPrice as number | null | undefined
      let saleRaw = p.salePrice as number | null | undefined
      if (sourceCurrency !== "KRW") {
        const conv = (v: number | null | undefined): number | null | undefined => {
          if (typeof v !== "number") return v
          return convertToKrw(v, sourceCurrency)
        }
        const convPrice = conv(priceRaw)
        // If the primary price is non-null but conversion yielded null,
        // the FX table does not contain this currency — skip with warning.
        if (typeof priceRaw === "number" && convPrice === null) {
          console.warn(
            `   ⚠️  Skipping product (unknown currency "${sourceCurrency}"): ${(p.name as string) || productUrl}`,
          )
          fxSkipped += 1
          return null
        }
        priceRaw = convPrice
        const convOriginal = conv(originalRaw)
        originalRaw = typeof originalRaw === "number" && convOriginal === null ? null : convOriginal
        const convSale = conv(saleRaw)
        saleRaw = typeof saleRaw === "number" && convSale === null ? null : convSale
      }

      // Preserve the original (pre-FX) source price + currency for the
      // admin UI's USD-first / KRW-fallback display. SPEC-005 amendment
      // 2026-05-06: schema migration 036 added `source_currency` +
      // `source_price` columns. KRW-source rows store the same numeric
      // value as `price`; non-KRW rows (USD, EUR, GBP) store the native
      // decimal (e.g. USD 99.90).
      const sourcePriceRaw = typeof p.sourcePrice === "number"
        ? p.sourcePrice
        : (typeof p.price === "number" ? p.price : null)
      return {
        brand,
        name: p.name as string,
        category: p.category as string,
        price: sanitizePrice(saleRaw) ?? sanitizePrice(priceRaw),
        original_price: sanitizePrice(originalRaw) ?? sanitizePrice(priceRaw),
        sale_price: sanitizePrice(saleRaw),
        source_currency: sourceCurrency,
        // Sanitize source_price the same way as `price` to reject NaN/
        // Infinity / out-of-range values from malformed payloads. SPEC-005
        // P1 security review 2026-05-06.
        source_price: sanitizePrice(sourcePriceRaw),
        product_no: productNo,
        image_url: p.imageUrl as string,
        product_url: productUrl,
        in_stock: p.inStock as boolean,
        platform: (p.platform as string) || platform,
        gender: p.gender as string[],
        brand_node_id: brandIdMap.get(brand.toLowerCase()) ?? null,
        // products.style_node 컬럼은 migration 081 (2026-06)에서 DROP — payload에서 제외.
        crawled_at: p.crawledAt as string,
        description: p.description?.slice(0, 2000) || null,
        color: (p.color as string).slice(0, 500),
        // material drop (migration 079, 2026-05-20) — 0% fill; extraction logic kept for future revival
        subcategory: p.subcategory || null,
        images: p.images?.slice(0, 10) || null,
        size_info: p.sizeInfo?.slice(0, 2000) || null,
        tags: p.tags?.slice(0, 50) || null,
        product_code: p.productCode?.slice(0, 100) || null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }).filter((r): r is NonNullable<typeof r> => r !== null)
    if (fxSkipped > 0) {
      console.log(`   ⚠️  ${fxSkipped} product(s) skipped due to unknown source currency`)
    }

    // Dedup by product_url — Postgres rejects ON CONFLICT batches that
    // contain the same conflict key twice ("cannot affect row a second
    // time"). ZARA in particular surfaces the same product across
    // multiple category landings (e.g. new-in + outerwear + dresses),
    // so the raw cache can carry a product_url 10+ times.
    //
    // Merge strategy (SPEC-005 P1 review 2026-05-06): instead of last-
    // wins, prefer non-null values when merging — sale_price, original_
    // price, color, material, etc. from any duplicate row carry over.
    // gender arrays are merged; everything else takes the last non-null.
    type Row = (typeof rows)[number]
    const merge = (a: Row, b: Row): Row => {
      const pickRicher = <K extends keyof Row>(key: K): Row[K] => {
        const av = a[key]
        const bv = b[key]
        // Prefer non-null/non-empty
        if (bv === null || bv === undefined || bv === "") return av
        if (av === null || av === undefined || av === "") return bv
        return bv  // both non-null: take the later occurrence
      }
      const mergedGender = (() => {
        const ga = Array.isArray(a.gender) ? a.gender : []
        const gb = Array.isArray(b.gender) ? b.gender : []
        return [...new Set([...ga, ...gb])]
      })()
      return {
        ...b,
        sale_price: a.sale_price ?? b.sale_price,
        original_price: pickRicher("original_price"),
        color: pickRicher("color"),
        description: pickRicher("description"),
        gender: mergedGender,
        category: pickRicher("category"),
        subcategory: pickRicher("subcategory"),
      }
    }
    const dedupedByUrl = new Map<string, Row>()
    for (const r of rows) {
      const existing = dedupedByUrl.get(r.product_url)
      dedupedByUrl.set(r.product_url, existing ? merge(existing, r) : r)
    }
    const beforeDedup = rows.length
    const deduped = [...dedupedByUrl.values()]
    if (beforeDedup !== deduped.length) {
      console.log(`   🧹 dedup: ${beforeDedup} → ${deduped.length} (${beforeDedup - deduped.length} duplicate product_url merged)`)
    }

    // 50개씩 배치 upsert
    const BATCH = 50
    let inserted = 0
    let errors = 0

    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH)
      const {error} = await db.from("products").upsert(batch, {
        onConflict: "product_url",
        ignoreDuplicates: false,
      })

      if (error) {
        console.error(`   ❌ 배치 ${i}-${i + batch.length} 실패:`, error.message)
        errors++
      } else {
        inserted += batch.length
        process.stdout.write(`\r   💾 ${inserted}/${deduped.length}`)
      }
    }

    console.log(`\r   ✅ ${inserted}/${deduped.length} 적재 (에러 ${errors}건)`)
    // 단일브랜드 자사몰: 파일의 대표 브랜드명으로 brand_node 해석 폴백에 사용
    const dominantBrand =
      (rawAll.find((p) => (p.brand as string | undefined)?.trim())?.brand as string | undefined) ??
      SELF_BRANDED[platform] ??
      null
    await syncProductCrawlStatus(platform, dominantBrand, {inserted, errors, total: deduped.length})
    totalInserted += inserted
    totalErrors += errors

    // === 리뷰 import ===
    const productsWithReviews = raw.filter(
      (p) => p.reviews && p.reviews.length > 0
    )
    if (productsWithReviews.length > 0) {
      console.log(`   📝 리뷰 있는 상품 ${productsWithReviews.length}개 처리 중...`)

      // product_url → product_id 매핑 조회 (30개씩 배치 — URL 길이 제한 방지)
      const urls = productsWithReviews.map((p) => p.productUrl)
      const URL_BATCH = 30
      const urlToId = new Map<string, string>()
      let lookupFailed = false

      for (let i = 0; i < urls.length; i += URL_BATCH) {
        const batch = urls.slice(i, i + URL_BATCH)
        const {data, error: lookupErr} = await db
          .from("products")
          .select("id, product_url")
          .in("product_url", batch)

        if (lookupErr) {
          console.error(`   ❌ product_id 조회 실패 (${i}-${i + batch.length}):`, lookupErr.message)
          lookupFailed = true
          break
        }
        if (data) {
          for (const p of data) urlToId.set(p.product_url, p.id)
        }
      }

      if (!lookupFailed && urlToId.size > 0) {

        // 리뷰 행 구성
        const reviewRows: Array<{
          product_id: string
          text: string | null
          author: string | null
          review_date: string | null
          photo_urls: string[]
          body_info: Record<string, unknown> | null
        }> = []

        for (const p of productsWithReviews) {
          const productId = urlToId.get(p.productUrl)
          if (!productId || !p.reviews) continue

          for (const r of p.reviews) {
            reviewRows.push({
              product_id: productId,
              text: r.text?.slice(0, 5000) || null,
              author: r.author?.slice(0, 100) || null,
              review_date: r.date || null,
              photo_urls: r.photoUrls || [],
              body_info: r.body || null,
            })
          }
        }

        // 기존 리뷰 삭제 후 재삽입 (중복 방지)
        const productIds = [...new Set(reviewRows.map((r) => r.product_id))]
        if (productIds.length > 0) {
          await db
            .from("product_reviews")
            .delete()
            .in("product_id", productIds)
        }

        // 50개씩 배치 insert
        let reviewInserted = 0
        for (let i = 0; i < reviewRows.length; i += BATCH) {
          const batch = reviewRows.slice(i, i + BATCH)
          const {error: revErr} = await db
            .from("product_reviews")
            .insert(batch)

          if (revErr) {
            console.error(`   ❌ 리뷰 배치 ${i}-${i + batch.length} 실패:`, revErr.message)
          } else {
            reviewInserted += batch.length
          }
        }
        console.log(`   📝 리뷰 ${reviewInserted}/${reviewRows.length}건 적재`)
        totalReviews += reviewInserted

        // products 테이블에 review_count 업데이트
        for (const p of productsWithReviews) {
          const productId = urlToId.get(p.productUrl)
          if (!productId) continue

          await db
            .from("products")
            .update({ review_count: (p.reviews || []).length })
            .eq("id", productId)
        }
      }
    }
  }

  console.log("\n" + "═".repeat(50))
  console.log(`🏁 전체 적재 완료: ${totalInserted}개 성공, ${totalErrors}건 에러`)
  printProductQcReport()
  if (totalReviews > 0) {
    console.log(`📝 리뷰 적재: ${totalReviews}건`)
  }
  console.log("═".repeat(50))
}

function printProductQcReport() {
  const report = getProductQcReport()
  if (report.size === 0) return

  console.log("\n" + "-".repeat(50))
  console.log("Product QC summary")
  console.log("-".repeat(50))
  for (const [site, stat] of report) {
    const reasons = Object.entries(stat.byReason)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason}=${count}`)
      .join(", ")
    console.log(
      `[${site}] total=${stat.total}, keep=${stat.kept}, auto_fix=${stat.autoFixed}, review=${stat.review}, reject=${stat.rejected}`,
    )
    if (reasons) console.log(`   reasons: ${reasons}`)
    for (const [reason, skus] of Object.entries(stat.samples)) {
      if (skus.length === 0) continue
      console.log(`   ${reason} samples:`)
      for (const sku of skus) console.log(`     - ${sku}`)
    }
  }
}

main().catch(console.error)

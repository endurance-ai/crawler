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
import {isConfirmedPricing, toDbPriceFields} from "./lib/product-pricing"
import {applyValidationGate} from "./lib/core/validation-gate"
import {applyProductQcGate, getProductQcReport} from "./lib/product-qc/normalization"
import {getSiteConfig, PLATFORMS} from "./configs/platforms"
import {queuePlatformType} from "./lib/platform-config-lifecycle"
import {mergeProductImages} from "./lib/product-images"
import {
  canUsePlatformBrandFallback,
  resolveProductBrandNodeIdFromMaps,
} from "./lib/brand-node-resolution"
import {
  isTrustedBrandSource,
  partitionUnknownBrands,
  recordUnknownBrand,
  resolveProductBrand,
  type UnknownBrandEntry,
} from "./lib/brand-provenance"
import {cleanGenderScope, resolveProductGenderWithSource, type GenderSource} from "./lib/product-gender"
import {emit} from "./lib/core/observability"
import {isValidCategory, isValidSubcategory, type Category} from "./lib/enums/product-enums"
import {
  buildQwenNormalizationPatch,
  classifyProductWithQwen,
  needsQwenNormalization,
  qwenNormalizationInputHash,
  type ProductNormalizationInput,
} from "./lib/product-qwen-normalization"
import {QwenDisabledError, QwenUnavailableError} from "./lib/qwen-client"

/**
 * 성별 출처 신뢰도 순위 (dedup merge 용).
 *
 * config_default 가 url/text 아래인 것이 핵심 — 카테고리가 교차하는 사이트
 * (yearsago 등)에서 여성 라인 상품은 "상의" 행에서 사이트 기본값(men)을,
 * "Women" 행에서 카테고리 유래 women 을 받는다. 동순위였다면 union 이 되어
 * ['men','women'] 로 남녀 양쪽에 노출된다.
 *
 * brand_scope 는 없다 — 2026-08 회귀에서 브랜드 스코프 폴백을 복원하지 않았다
 * (src/lib/product-gender.ts 헤더). 과거 행이 그 값을 들고 있으면 rank 0 이 되어
 * 다른 모든 출처에 진다.
 */
const GENDER_SOURCE_RANK: Record<string, number> = {
  engine: 5,
  url: 4,
  text: 3,
  llm: 2,
  config_default: 1,
}

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN

if (!dbUrl || !dbToken) {
  console.error("❌ DB_URL, DB_TOKEN 환경변수 필요")
  console.error("   .env.local에서 로드하려면: npx dotenv -e .env.local -- npx tsx scripts/import-products.ts")
  process.exit(1)
}

const db = createClient(dbUrl, dbToken)
const RETAILER_PLATFORM_KEYS = new Set(
  PLATFORMS.filter((platform) => platform.multiBrand).map((platform) => platform.key),
)

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
  category?: string
  /** men/women/unisex. 비어 있으면 적재하지 않는다 (src/lib/product-gender.ts). */
  gender?: string[]
  genderSource?: string
  price: number | null
  originalPrice?: number | null
  salePrice?: number | null
  priceFormatted: string
  imageUrl: string
  sourceImageUrl?: string
  productUrl: string
  inStock: boolean
  platform: string
  crawledAt: string
  // 상세 페이지 데이터
  material?: string
  subcategory?: string
  images?: string[]
  sizeInfo?: string
  tags?: string[]
  productCode?: string
  /** Source currency (KRW default; "USD" for Uniqlo US cache) */
  sourceCurrency?: "USD" | "EUR" | "GBP" | "KRW"
  sourcePrice?: number
  pricingObservation?: {
    state: "sale" | "regular" | "unknown"
    source: "variant" | "api" | "listing" | "detail"
    version: 2
  }
  llmEnrichedAt?: string
  llmModel?: string
  llmInputHash?: string
  // 리뷰 데이터
  reviewCount?: number
  reviews?: CrawledReview[]
}

interface QwenImportStats {
  targeted: number
  succeeded: number
  deferred: number
  schemaFailed: number
  raceSkipped: number
}

function emptyQwenImportStats(): QwenImportStats {
  return {targeted: 0, succeeded: 0, deferred: 0, schemaFailed: 0, raceSkipped: 0}
}

function writeJsonCheckpoint(filePath: string, products: readonly CrawledProduct[]): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(products, null, 2), "utf-8")
  fs.renameSync(tmp, filePath)
}

async function normalizePersistedRows(
  rows: Array<{
    product_url: string
    name: string
    brand: string
    category: string
    subcategory: string | null
    tags: string[] | null
    updated_at: string
  }>,
  fileProducts: CrawledProduct[],
  stats: QwenImportStats,
): Promise<boolean> {
  let checkpointChanged = false
  await Promise.all(rows.map(async (row) => {
    const input: ProductNormalizationInput = {
      productUrl: row.product_url,
      name: row.name,
      brand: row.brand,
      category: row.category,
      subcategory: row.subcategory,
      tags: row.tags,
    }
    if (!needsQwenNormalization(input)) return
    stats.targeted++

    try {
      const prediction = await classifyProductWithQwen(input)
      const patch = buildQwenNormalizationPatch(input, prediction.value)
      if (!patch) {
        stats.deferred++
        return
      }

      const normalizedAt = new Date().toISOString()
      const {data, error} = await db
        .from("products")
        .update({...patch, updated_at: normalizedAt})
        .eq("product_url", row.product_url)
        .eq("updated_at", row.updated_at)
        .select("id")
        .maybeSingle()
      if (error) throw error
      if (!data) {
        stats.raceSkipped++
        return
      }

      for (const product of fileProducts) {
        if (product.productUrl !== row.product_url) continue
        product.category = patch.category
        product.subcategory = patch.subcategory ?? undefined
        product.llmEnrichedAt = normalizedAt
        product.llmModel = prediction.model
        product.llmInputHash = qwenNormalizationInputHash({
          ...input,
          category: patch.category,
          subcategory: patch.subcategory,
        })
        checkpointChanged = true
      }
      stats.succeeded++
    } catch (error) {
      if (error instanceof QwenDisabledError || error instanceof QwenUnavailableError) {
        stats.deferred++
      } else if (/zod|schema|validation|object generated/i.test(error instanceof Error ? `${error.name}: ${error.message}` : String(error))) {
        stats.schemaFailed++
      } else {
        stats.deferred++
      }
    }
  }))
  return checkpointChanged
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
  gender_scope: string[] | null
}

// platform_key → brand_node_id 해석. product_crawl_status(090) 는 brand_node_id 가 PK 이고
// admin 페이지(product_crawl_brands 뷰)가 이걸 읽는다. 이미 platform_key 가 채워진 status 행이
// 있으면 그걸로 resolve, 없으면 brand_nodes 를 brand_name 으로 매칭해 폴백한다.
async function resolveBrandNodeId(platform: string, brandName: string | null): Promise<number | null> {
  if (canUsePlatformBrandFallback(platform, RETAILER_PLATFORM_KEYS)) {
    const {data: statusRow} = await db
      .from("product_crawl_status")
      .select("brand_node_id")
      .eq("platform_key", platform)
      .maybeSingle()
    if (statusRow) return (statusRow as {brand_node_id: number}).brand_node_id
  }

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

// import 성공/실패를 product_crawl_status(090, brand_node_id 기준)에 자동 반영한다.
// 배포 admin 페이지가 읽는 product_crawl_brands 뷰의 소스가 이 테이블이다.
// brand_node_id 해석 실패 시 no-op(신규 브랜드는 brand_nodes 등록 후 반영됨).
// 최소 QC 통과율 — 이 밑으로 떨어지면 "inserted>0"이라도 imported로 확정하지
// 않는다. import-products.ts의 QC 게이트(applyProductQcGate/applyValidationGate)가
// 크롤 원본 상품 대다수를 review/reject로 걸러내는 경우(실측: en-5267 1,886건 중
// 1건만 통과) 예전에는 그래도 status='imported'로 찍혀서 daily-onboard 스킬의
// status='tech_detected' 선정 쿼리에 영구히 안 걸리는 문제가 있었다 (2026-07-22).
const MIN_QC_PASS_RATE = 0.5

async function syncProductCrawlStatus(
  platform: string,
  brandName: string | null,
  result: {inserted: number; errors: number; total: number; qcPassRate: number},
): Promise<void> {
  const brandNodeId = await resolveBrandNodeId(platform, brandName)
  if (!brandNodeId) return

  const inserted = result.errors === 0 && result.inserted > 0
  const lowYield = result.qcPassRate < MIN_QC_PASS_RATE
  const success = inserted && !lowYield
  const status = success ? "imported" : "qc_failed"
  if (inserted && lowYield) {
    console.warn(
      `   ⚠️  ${platform}: QC 통과율 ${(result.qcPassRate * 100).toFixed(1)}% (<${MIN_QC_PASS_RATE * 100}%) — imported 대신 qc_failed로 기록, 재시도 대상에 남김`,
    )
  }

  // config 를 알고 있으면 platform_type/config_status 도 같이 채운다.
  // 이 배선이 없던 동안 detect 를 거치지 않고 적재된 브랜드가 platform_type='unknown'
  // 으로 남았고, generate-platform-configs 의 generatedPlatformType 이 null 을 돌려
  // config 가 생성되지 않았다 → 그 브랜드는 refresh 워크리스트에 못 들어가 가격·재고가
  // 영구 미갱신 (실측 2026-07-30: 47개 브랜드 / 재고 5,505건).
  const config = getSiteConfig(platform)
  await db.from("product_crawl_status").upsert(
    {
      brand_node_id: brandNodeId,
      status,
      platform_key: platform,
      ...(config
        ? {
            platform_type: queuePlatformType(config.type),
            config_status: config.disabled ? "blocked" : "ready",
          }
        : {}),
      imported_at: success ? new Date().toISOString() : null,
      qc_summary: {
        rows_total: result.total,
        rows_upserted: result.inserted,
        errors: result.errors,
        qc_pass_rate: Math.round(result.qcPassRate * 1000) / 1000,
      },
      last_error: inserted && lowYield ? `low QC pass rate: ${(result.qcPassRate * 100).toFixed(1)}%` : null,
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

async function loadPlatformBrandNodeMap(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const PAGE = 1000
  let offset = 0
  for (;;) {
    const {data, error} = await db
      .from("product_crawl_status")
      .select("platform_key, brand_node_id")
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.warn("⚠️ product_crawl_status 조회 실패:", error.message)
      return out
    }
    if (!data?.length) break
    for (const row of data) {
      const platformKey = (row as {platform_key: string | null}).platform_key
      const brandNodeId = (row as {brand_node_id: number | null}).brand_node_id
      if (
        platformKey &&
        typeof brandNodeId === "number" &&
        canUsePlatformBrandFallback(platformKey, RETAILER_PLATFORM_KEYS)
      ) out.set(platformKey, brandNodeId)
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return out
}

function resolveProductBrandNodeId(
  brand: string,
  platform: string,
  brandIdMap: Map<string, number>,
  platformBrandIdMap: Map<string, number>,
): number | null {
  return resolveProductBrandNodeIdFromMaps(
    brand,
    platform,
    brandIdMap,
    platformBrandIdMap,
    RETAILER_PLATFORM_KEYS,
  )
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

  // --dry-run: DB upsert 없이 플랫폼별 적재 예정 건수만 출력.
  const dryRun = process.argv.includes("--dry-run")

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

  // ── brand_nodes 로드 (id_map — legacy style_node text 컬럼 062에서 drop) ─
  const {rows: brandRows, idMap: brandIdMap} = await loadBrandNodes()
  const platformBrandIdMap = await loadPlatformBrandNodeMap()

  // ── Pre-scan: 모든 파일에서 unique brand 문자열 수집 ──────
  // 미존재 brand 는 한 번에 resolve (fuzzy + insert + alias_candidate enqueue).
  // 파일 JSON 은 캐시해서 main loop 에서 재사용 (디스크 IO 1회).
  const fileCache = new Map<string, CrawledProduct[]>()
  // brand → {대표 platform, 신뢰 출처 여부}. 신뢰 판정 근거는
  // `lib/brand-provenance.ts` 헤더 참조 (편집샵 브랜드 오염 방지).
  const unknownBrands = new Map<string, UnknownBrandEntry>()

  for (const file of files) {
    const platform = file.replace("-products.json", "")
    const config = getSiteConfig(platform)
    const filePath = path.join(dataDir, file)
    let raw: CrawledProduct[]
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch {
      continue // main loop 에서 에러 처리
    }
    fileCache.set(file, raw)

    for (const p of raw) {
      const brand = resolveProductBrand(p.brand, config)
      if (!brand) continue
      const brandNodeId = resolveProductBrandNodeId(brand, platform, brandIdMap, platformBrandIdMap)
      if (brandNodeId === null) {
        recordUnknownBrand(
          unknownBrands,
          brand,
          platform,
          isTrustedBrandSource({
            selfBranded: false,
            configBrand: config?.brand,
            multiBrand: config?.multiBrand,
          }),
        )
      }
    }
  }

  if (unknownBrands.size > 0) {
    if (noNewBrands) {
      console.log(`⚠️  미등록 brand ${unknownBrands.size}개 발견 — --no-new-brands 모드: INSERT 건너뜀, 해당 상품 적재 제외`)
      console.log(`   제외 브랜드: ${[...unknownBrands.keys()].slice(0, 10).join(", ")}${unknownBrands.size > 10 ? ` 외 ${unknownBrands.size - 10}개` : ""}\n`)
    } else {
      // provenance 가드: 신뢰 출처(단일브랜드 자사몰)의 미등록 brand 만 자동 생성한다.
      // 편집샵/비신뢰 출처는 INSERT 하지 않고 상품을 격리한다 — brandNodeId 가 계속
      // null 이라 main loop 가 알아서 제외한다.
      const {insertable, blocked} = partitionUnknownBrands(unknownBrands)
      if (blocked.length > 0) {
        console.log(
          `⛔ 미등록 brand ${blocked.length}개 — 멀티브랜드/비신뢰 출처: 자동 INSERT 제외(상품 격리)`,
        )
        console.log(
          `   격리 브랜드: ${blocked.slice(0, 10).join(", ")}${blocked.length > 10 ? ` 외 ${blocked.length - 10}개` : ""}`,
        )
      }
      if (insertable.length > 0) {
        console.log(`🆕 미등록 brand ${insertable.length}개(신뢰 출처) — 자동 INSERT + alias 검사`)
        const resolveResult = await resolveUnknownBrands(insertable, brandRows, brandIdMap)
        console.log(
          `   ✅ inserted=${resolveResult.inserted}, alias_candidate=${resolveResult.aliasFlagged}, failed=${resolveResult.failed}\n`,
        )
      }
    }
  }

  let totalInserted = 0
  let totalErrors = 0
  let totalReviews = 0
  /** P0 계측: 플랫폼별 성별 해결 수율. 하단 요약에서 저수율 사이트를 뽑는다. */
  const genderYield: Array<{platform: string; resolved: number; total: number}> = []

  for (const file of files) {
    const platform = file.replace("-products.json", "")
    const config = getSiteConfig(platform)
    const filePath = path.join(dataDir, file)

    const cached = fileCache.get(file)
    if (!cached) {
      // Pre-scan 단계에서 파싱 실패한 파일.
      console.error(`   ❌ ${file} JSON 파싱 실패 (pre-scan)`)
      totalErrors++
      continue
    }
    const rawAll: CrawledProduct[] = cached

    // ── 성별 결의 (2026-08 크롤러 회귀) ────────────────────────────
    //
    // 여기 한 번만 수행하고 아래 row mapper 는 결과를 읽기만 한다.
    // 브랜드 스코프 폴백은 복원하지 않았다 — 근거는 engine/url/text/
    // config_default 4단뿐이다 (src/lib/product-gender.ts 헤더 참조).
    const genderSourceCounts: Record<string, number> = {}
    const siteDefaultGender = config?.defaultGender ?? []
    const rawWithGender: CrawledProduct[] = rawAll.map((p) => {
      const evidence = {
        name: p.name,
        category: p.category,
        subcategory: p.subcategory,
        tags: p.tags,
        productUrl: p.productUrl,
      }
      let resolved = resolveProductGenderWithSource(
        p.gender,
        evidence,
        (p.genderSource as GenderSource | undefined) ?? "engine",
        {
          kidsGenderNoisePatterns: config?.kidsGenderNoisePatterns,
          verifiedUnisexDefault: config?.verifiedUnisexDefault,
        },
      )
      // 엔진이 사이트 기본값을 찍지 않은 캐시(구 크롤 JSON, 또는 기본값을
      // 소비하지 않는 엔진)를 위해 import 시점에도 같은 폴백을 적용한다.
      // config_default 는 어차피 최하위 rank 라 url/text 를 이기지 못하므로
      // 엔진이 찍었든 여기서 찍었든 결과 순위는 동일하다.
      if (resolved.gender.length === 0 && !resolved.conflict && siteDefaultGender.length > 0) {
        resolved = resolveProductGenderWithSource(siteDefaultGender, evidence, "config_default", {
          kidsGenderNoisePatterns: config?.kidsGenderNoisePatterns,
          verifiedUnisexDefault: config?.verifiedUnisexDefault,
        })
      }
      genderSourceCounts[resolved.source ?? "unresolved"] = (genderSourceCounts[resolved.source ?? "unresolved"] ?? 0) + 1
      if (resolved.conflict) {
        emit({
          kind: "gender_source_conflict",
          site: platform,
          sku: p.productUrl,
          urlGender: resolved.conflict.url,
          textGender: resolved.conflict.text,
        })
      }
      return resolved.gender.length > 0
        ? {...p, gender: resolved.gender, genderSource: resolved.source ?? undefined}
        : p
    })

    // SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-001/002: validate every parsed
    // product before the DB upsert. Valid products pass through
    // byte-identical into the existing .map(); invalid ones are excluded
    // + a structured reject event is emitted (does not crash the import
    // on a single bad record). Flag OFF (CRAWLER_VALIDATION_ENABLED=
    // false) → exact legacy behavior (no gate, all products imported).
    const qcRaw = applyProductQcGate(rawWithGender, platform, {
      trustedCategory: config?.type === "shopify" || config?.trustedCategory === true,
      kidsGenderNoisePatterns: config?.kidsGenderNoisePatterns,
      verifiedUnisexDefault: config?.verifiedUnisexDefault,
    })
    const raw: CrawledProduct[] = applyValidationGate(qcRaw, platform)
    console.log(`📄 ${file} — ${raw.length}개 상품`)

    {
      const resolvedCount = rawAll.length - (genderSourceCounts["unresolved"] ?? 0)
      const pct = rawAll.length > 0 ? ((resolvedCount / rawAll.length) * 100).toFixed(1) : "0.0"
      const hist = Object.entries(genderSourceCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}=${n}`)
        .join(" ")
      console.log(`   🚻 gender 해결: ${resolvedCount}/${rawAll.length} (${pct}%) — ${hist}`)
      genderYield.push({platform, resolved: resolvedCount, total: rawAll.length})
    }

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

    const unconfirmedPricing = raw.filter((product) => !isConfirmedPricing(product))
    if (unconfirmedPricing.length > 0) {
      console.error(
        `   ❌ 가격 관측 v2 미확정 ${unconfirmedPricing.length}/${raw.length}건 — ` +
          `기존 세일가를 지울 수 있어 플랫폼 파일 전체를 적재하지 않습니다. 최신 엔진으로 상세 재크롤하세요.`,
      )
      totalErrors++
      continue
    }

    let priceSkipped = 0
    let genderSkipped = 0
    const priceSkipSamples: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = raw.map((p: any) => {
      const brand = resolveProductBrand(p.brand, config)
      const productUrl = (p.productUrl as string) || ""
      const brandNodeId = resolveProductBrandNodeId(brand, platform, brandIdMap, platformBrandIdMap)

      // brand NOT NULL — DB 제약상 빈 문자열은 통과하지만, 엔진의 spec-라벨
      // 누출 가드(cafe24-engine.ts)가 오염된 값을 걸러내고 brand=""로 넘기는
      // 경우 여기서 적재 자체를 스킵한다. "브랜드 없음"으로
      // 잘못 적재되는 것보다 재크롤 때까지 보류하는 편이 안전하다.
      if (!brand) return null
      // 성별이 **정확히 하나**가 아니면 적재하지 않는다. 미확인을 unisex 로
      // 채우면 검색 RPC (p.gender && ARRAY[p_gender,'unisex'])가 남녀 양쪽에
      // 노출시켜 여성 상품이 남성 검색으로 샌다 — src/lib/product-gender.ts 참조.
      // 다중값도 같은 결과를 내므로 함께 막는다: migration 105 의
      // chk_products_gender_required 가 cardinality(gender)=1 을 요구하고,
      // 이 가드가 없으면 그 CHECK 이 INSERT 를 전량 거부한다 (099 color 사고 패턴).
      const gender = cleanGenderScope(p.gender)
      if (gender.length !== 1) {
        genderSkipped++
        return null
      }
      // --no-new-brands: 미등록 brand 상품 적재 제외
      if (noNewBrands && brandNodeId === null) return null
      // --in-stock-only: 품절 상품 적재 제외
      if (inStockOnly && p.inStock === false) return null
      // product_no 추출
      const pnoMatch = productUrl.match(/product_no=(\d+)/)
      const productNo = pnoMatch ? parseInt(pnoMatch[1], 10) : null

      const sourceCurrency = (p.sourceCurrency as string | undefined) ?? "KRW"
      const prices = toDbPriceFields(p, sourceCurrency, {requireConfirmed: true})
      if (prices === null) {
        priceSkipped += 1
        if (priceSkipSamples.length < 3) {
          priceSkipSamples.push((p.name as string) || productUrl || "(unnamed)")
        }
        return null
      }

      const category: Category = isValidCategory(p.category) ? p.category : "other"
      const rawSubcategory = typeof p.subcategory === "string" ? p.subcategory.trim() : ""
      const subcategory = rawSubcategory && isValidSubcategory(rawSubcategory, category)
        ? rawSubcategory
        : null

      return {
        brand,
        name: p.name as string,
        category,
        ...prices,
        product_no: productNo,
        image_url: p.imageUrl as string,
        source_image_url: (p.sourceImageUrl as string | undefined) || (p.imageUrl as string),
        product_url: productUrl,
        in_stock: p.inStock as boolean,
        platform: (p.platform as string) || platform,
        brand_node_id: brandNodeId,
        gender,
        gender_source: (p.genderSource as string | undefined) ?? null,
        // products.style_node 컬럼은 migration 081 (2026-06)에서 DROP — payload에서 제외.
        crawled_at: p.crawledAt as string,
        // material drop (migration 079, 2026-05-20) — 0% fill; extraction logic kept for future revival
        subcategory,
        // Kept out of the products upsert below and merged atomically through
        // merge_product_images. A listing-only crawl must never erase richer
        // detail images collected by an earlier run.
        images: mergeProductImages(p.imageUrl, productUrl, p.images),
        size_info: p.sizeInfo?.slice(0, 2000) || null,
        tags: p.tags?.slice(0, 50) || null,
        product_code: p.productCode?.slice(0, 100) || null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }).filter((r): r is NonNullable<typeof r> => r !== null)
    if (priceSkipped > 0) {
      console.log(
        `   ⚠️  ${priceSkipped} product(s) skipped due to missing/invalid price: ${priceSkipSamples.join(", ")}`,
      )
    }
    if (genderSkipped > 0) {
      console.log(`   ⚠️  ${genderSkipped} product(s) skipped — gender unresolved`)
    }

    // Dedup by product_url — Postgres rejects ON CONFLICT batches that
    // contain the same conflict key twice ("cannot affect row a second
    // time"). ZARA in particular surfaces the same product across
    // multiple category landings (e.g. new-in + outerwear + dresses),
    // so the raw cache can carry a product_url 10+ times.
    //
    // Merge strategy (SPEC-005 P1 review 2026-05-06): instead of last-
    // wins, prefer non-null values when merging — sale_price, original_
    // price, material, etc. from any duplicate row carry over.
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
      // 성별은 pickRicher(나중 것 우선)로 병합하면 안 된다. 같은 상품이 여러
      // 카테고리 랜딩에 걸릴 때 한쪽은 카테고리 유래 women, 다른 쪽은 사이트
      // 기본값 men 을 들고 오는데, 그대로 두면 union 이 되어 ['men','women'] 이
      // 되고 검색 RPC 에서 남녀 양쪽에 노출된다 — 브랜드 폴백과 똑같은 세탁이다.
      // 대신 출처 신뢰도가 높은 쪽을 채택하고, 동순위인데 값이 다르면 판정 불가로
      // 보고 이벤트만 남긴다. resolveProductGenderWithSource 와 같은 순서.
      const genderWinner = (() => {
        const ga = Array.isArray(a.gender) ? a.gender : []
        const gb = Array.isArray(b.gender) ? b.gender : []
        if (ga.length === 0) return {gender: gb, gender_source: b.gender_source}
        if (gb.length === 0) return {gender: ga, gender_source: a.gender_source}

        const ra = GENDER_SOURCE_RANK[a.gender_source ?? ""] ?? 0
        const rb = GENDER_SOURCE_RANK[b.gender_source ?? ""] ?? 0
        if (ra !== rb) {
          return ra > rb
            ? {gender: ga, gender_source: a.gender_source}
            : {gender: gb, gender_source: b.gender_source}
        }
        if (ga.join() === gb.join()) return {gender: ga, gender_source: a.gender_source}

        emit({
          kind: "gender_merge_conflict",
          site: platform,
          sku: b.product_url,
          genders: [ga.join("+"), gb.join("+")],
        })
        return {gender: ga, gender_source: a.gender_source}
      })()

      return {
        ...b,
        // 가격은 하나의 coherent tuple이다. 필드를 개별 병합하면 regular 행의
        // price와 sale 행의 sale_price가 섞여 운영 DB의 모순 조합이 된다.
        ...(a.sale_price !== null && b.sale_price === null
          ? {
              price: a.price,
              original_price: a.original_price,
              sale_price: a.sale_price,
              source_price: a.source_price,
              source_currency: a.source_currency,
            }
          : {
              price: b.price,
              original_price: b.original_price,
              sale_price: b.sale_price,
              source_price: b.source_price,
              source_currency: b.source_currency,
            }),
        category: pickRicher("category"),
        subcategory: pickRicher("subcategory"),
        gender: genderWinner.gender,
        gender_source: genderWinner.gender_source,
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

    if (dryRun) {
      console.log(`   🔍 dry-run: ${deduped.length}건 적재 예정 (DB 쓰기 없음)\n`)
      totalInserted += deduped.length
      continue
    }

    // 50개씩 배치 upsert
    const BATCH = 50
    let inserted = 0
    let errors = 0
    const qwenStats = emptyQwenImportStats()

    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH)
      const productRows = batch.map(({images: _images, ...row}) => row)
      const imageUpdates = batch
        .filter((row) => row.images.length > 0)
        .map((row) => ({product_url: row.product_url, images: row.images}))
      const {error} = await db.from("products").upsert(productRows, {
        onConflict: "product_url",
        ignoreDuplicates: false,
      })

      if (error) {
        console.error(`   ❌ 배치 ${i}-${i + batch.length} 실패:`, error.message)
        errors++
      } else {
        const checkpointChanged = await normalizePersistedRows(batch, rawAll, qwenStats)
        if (checkpointChanged) writeJsonCheckpoint(filePath, rawAll)
        const {error: imageError} = imageUpdates.length > 0
          ? await db.rpc("merge_product_images", {updates: imageUpdates})
          : {error: null}
        if (imageError) {
          console.error(`   ❌ 이미지 병합 ${i}-${i + batch.length} 실패:`, imageError.message)
          errors++
        } else {
          inserted += batch.length
          process.stdout.write(`\r   💾 ${inserted}/${deduped.length}`)
        }
      }
    }

    console.log(`\r   ✅ ${inserted}/${deduped.length} 적재 (에러 ${errors}건)`)
    console.log(
      `   🤖 Qwen target=${qwenStats.targeted} success=${qwenStats.succeeded}` +
        ` deferred=${qwenStats.deferred} schema_failed=${qwenStats.schemaFailed}` +
        ` race_skip=${qwenStats.raceSkipped}`,
    )
    // 단일브랜드 자사몰: 파일의 대표 브랜드명으로 brand_node 해석 폴백에 사용
    const dominantBrand =
      resolveProductBrand(rawAll.find((p) => (p.brand as string | undefined)?.trim())?.brand, config) || null
    const qcPassRate = rawAll.length > 0 ? raw.length / rawAll.length : 1
    await syncProductCrawlStatus(platform, dominantBrand, {inserted, errors, total: deduped.length, qcPassRate})
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

  // ── P0 계측: 성별 해결 수율 요약 ────────────────────────────────
  if (genderYield.length > 0) {
    const grandTotal = genderYield.reduce((s, g) => s + g.total, 0)
    const grandResolved = genderYield.reduce((s, g) => s + g.resolved, 0)
    const grandPct = grandTotal > 0 ? ((grandResolved / grandTotal) * 100).toFixed(1) : "0.0"
    console.log(`\n🚻 gender 수율 전체: ${grandResolved}/${grandTotal} (${grandPct}%)`)

    const low = genderYield
      .filter((g) => g.total > 0 && g.resolved / g.total < 0.5)
      .sort((a, b) => a.resolved / a.total - b.resolved / b.total)
    if (low.length > 0) {
      console.log(`⚠️ 수율 50% 미만 플랫폼 ${low.length}개 (defaultGender 필요):`)
      for (const g of low) {
        const pct = ((g.resolved / g.total) * 100).toFixed(1)
        console.log(`   ${g.platform}: ${g.resolved}/${g.total} (${pct}%)`)
      }
    }
  }
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

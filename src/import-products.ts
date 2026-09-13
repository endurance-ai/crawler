/**
 * 크롤링 JSON → products 테이블 적재
 *
 * 사용법:
 *   npx dotenv -e .env.local -- npx tsx scripts/import-products.ts                  # data/ 내 전체
 *   npx dotenv -e .env.local -- npx tsx scripts/import-products.ts --site=obscura   # 특정 플랫폼만
 *   --trusted-category  상세 DOM/LLM 등 신뢰 출처의 canonical category를 이름 규칙보다 우선
 */

import * as fs from "fs"
import * as path from "path"
import {pathToFileURL} from "node:url"
import {initFxRates} from "./lib/fx"
import {createClient} from "@supabase/supabase-js"
import {chromium, type Browser} from "playwright"
// @MX:NOTE: Import-time USD→KRW conversion for caches whose source
// currency is non-KRW (currently Uniqlo US). Cache stores native USD;
// only the DB upsert payload sees post-conversion KRW.
// SPEC: SPEC-PLATFORM-EXPANSION-002 REQ-004
import {getSiteConfig, PLATFORMS} from "./configs/platforms"
import {inferVerifiedSiteGenderFromName, SITE_GENDER_DEFAULTS} from "./configs/gender-defaults"
import {queuePlatformType} from "./lib/platform-config-lifecycle"
import {canonicalizeCafe24ProductUrl} from "./lib/cafe24-chain"
import {
  canUsePlatformBrandFallback,
  resolveProductBrandNodeIdFromMaps,
} from "./lib/brand-node-resolution"
import {
  isTrustedBrandSource,
  resolveProductBrand,
  type UnknownBrandEntry,
} from "./lib/brand-provenance"
import {cleanGenderScope, resolveProductGenderWithSource, type GenderSource} from "./lib/product-gender"
import {classifyProductWithQwen} from "./lib/product-qwen-normalization"
import {assertQwenReady} from "./lib/qwen-client"
import {recoverCafe24CandidateDetailPricing} from "./lib/candidate-detail-pricing"
import {runProductImport, type ProductImportFile} from "./lib/import-products-orchestrator"
import {prepareProductForImport} from "./lib/prepare-product-for-import"
import {addPipelineError, createPipelineReport, finalizePipelineReport, pipelineExitCode, writePipelineReport} from "./lib/pipeline-report"
import {toDecimalId, type BrandResolution, type PreparedProductWriteResult} from "./lib/pipeline-integrity-types"
import type {Product} from "./lib/types"
import {validateProduct} from "./lib/core/product-validator"

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Crawler product import

Usage:
  tsx src/import-products.ts [--site=KEY] [--dry-run] [--no-new-brands] [--in-stock-only]

Options:
  --site=KEY        Import only data/KEY-products.json
  --dry-run         Validate and report without writing to the database
  --no-new-brands   Skip products whose brand_node mapping is missing
  --in-stock-only   Import only products currently in stock
  --report=PATH     Write the structured pipeline result to PATH
  --trusted-category
                    Preserve trusted canonical categories during preparation
  --allow-unconfirmed-pricing
                    Obsolete and rejected: pricing evidence is required
  --allow-qwen-deferred
                    Obsolete and rejected: failed normalization can never be
                    treated as a completed product import.
  --help, -h        Show this help and exit
`)
  process.exit(0)
}

const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN

const db = createClient(dbUrl ?? "http://missing.invalid", dbToken ?? "missing")
const RETAILER_PLATFORM_KEYS = new Set(
  PLATFORMS.filter((platform) => platform.multiBrand).map((platform) => platform.key),
)

function writeJsonCheckpoint(filePath: string, products: readonly Product[]): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(products, null, 2), "utf-8")
  fs.renameSync(tmp, filePath)
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
    const {data: statusRow, error} = await db
      .from("product_crawl_status")
      .select("brand_node_id")
      .eq("platform_key", platform)
      .maybeSingle()
    if (error) throw new Error("product status brand lookup failed")
    if (statusRow) return (statusRow as {brand_node_id: number}).brand_node_id
  }

  if (brandName) {
    const {data: node, error} = await db
      .from("brand_nodes")
      .select("id")
      .ilike("brand_name", brandName)
      .maybeSingle()
    if (error) throw new Error("product status brand lookup failed")
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
  result: {inserted: number; errors: number; total: number; qcPassRate: number; outOfScope: number},
): Promise<void> {
  const brandNodeId = await resolveBrandNodeId(platform, brandName)
  if (!brandNodeId) return

  // A source can legitimately contain only products outside Kiko's scope.
  // Treat that as a completed import rather than a low-yield retry condition.
  if (result.total === 0 && result.errors === 0 && result.outOfScope === 0) return
  const scopeOnly = result.errors === 0 && result.inserted === 0 && result.total === result.outOfScope && result.outOfScope > 0
  const inserted = result.errors === 0 && (result.inserted > 0 || scopeOnly)
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
  const {error: statusError} = await db.from("product_crawl_status").upsert(
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
      ...(success ? {imported_at: new Date().toISOString()} : {}),
      qc_summary: {
        rows_total: result.total,
        rows_upserted: result.inserted,
        rows_out_of_scope: result.outOfScope,
        errors: result.errors,
        qc_pass_rate: Math.round(result.qcPassRate * 1000) / 1000,
      },
      last_error: inserted && lowYield ? `low QC pass rate: ${(result.qcPassRate * 100).toFixed(1)}%` : result.errors > 0 ? `import incomplete: errors=${result.errors}` : null,
    },
    {onConflict: "brand_node_id"},
  )
  if (statusError) throw new Error("product crawl status update failed")

  const {error: runError} = await db.from("product_crawl_runs").insert({
    brand_node_id: brandNodeId,
    stage: "import",
    status: success ? "success" : "failed",
    platform_key: platform,
    actor: "import-products-auto",
    command: `import-products --site=${platform}`,
    metrics: {rows_total: result.total, rows_upserted: result.inserted, errors: result.errors},
  })
  if (runError) throw new Error("product crawl run insert failed")
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
  genderById: Map<number, string[]>
}> {
  const idMap = new Map<string, number>()
  const genderById = new Map<number, string[]>()

  // PostgREST default 1000 row limit — paginate to fetch all brand_nodes (~2,100 rows).
  // 062 마이그 이후 brand_nodes.style_node legacy text 컬럼 제거됨.
  // 신규 분류는 primary_style_node_id FK → style_nodes 테이블 join 으로 얻음.
  const PAGE = 1000
  const rows: BrandNodeRow[] = []
  let afterId = 0
  for (;;) {
    let query = db
      .from("brand_nodes")
      .select("id, brand_name, brand_name_normalized, gender_scope")
      .order("id", {ascending: true})
      .limit(PAGE)
    if (afterId > 0) query = query.gt("id", afterId)
    const {data, error} = await query
    if (error) {
      throw new Error("brand_nodes lookup failed")
    }
    if (!data?.length) break
    const page = data as BrandNodeRow[]
    if (page.some((row) => !Number.isSafeInteger(row.id) || row.id <= afterId)) {
      throw new Error("brand_nodes returned unsafe or unstable IDs")
    }
    rows.push(...page)
    afterId = page[page.length - 1].id
    if (data.length < PAGE) break
  }

  for (const bn of rows) {
    if (bn.brand_name_normalized) {
      idMap.set(bn.brand_name_normalized.toLowerCase(), bn.id)
    }
    idMap.set(bn.brand_name.toLowerCase(), bn.id)
    const scope = cleanGenderScope(bn.gender_scope)
    if (scope.length === 1 && scope[0] !== "unisex") genderById.set(bn.id, scope)
  }
  console.log(`🏷️ brand_nodes ${rows.length}개 로드 (id_map=${idMap.size}, single_gender_scope=${genderById.size})`)
  return {rows, idMap, genderById}
}

async function loadPlatformBrandNodeMap(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const PAGE = 1000
  let afterId = 0
  for (;;) {
    let query = db
      .from("product_crawl_status")
      .select("platform_key, brand_node_id")
      .order("brand_node_id", {ascending: true})
      .limit(PAGE)
    if (afterId > 0) query = query.gt("brand_node_id", afterId)
    const {data, error} = await query
    if (error) {
      throw new Error("product_crawl_status lookup failed")
    }
    if (!data?.length) break
    for (const row of data) {
      const platformKey = (row as {platform_key: string | null}).platform_key
      const brandNodeId = (row as {brand_node_id: number | null}).brand_node_id
      if (
        platformKey &&
        typeof brandNodeId === "number" &&
        Number.isSafeInteger(brandNodeId) &&
        canUsePlatformBrandFallback(platformKey, RETAILER_PLATFORM_KEYS)
      ) out.set(platformKey, brandNodeId)
      if (typeof brandNodeId !== "number" || !Number.isSafeInteger(brandNodeId) || brandNodeId <= afterId) {
        throw new Error("product_crawl_status returned unsafe or unstable IDs")
      }
      afterId = brandNodeId
    }
    if (data.length < PAGE) break
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

export function prepareImportInputProducts(input: unknown[], platform: string,
  config: NonNullable<ReturnType<typeof getSiteConfig>>,
  brandGenderScope: (brand: string) => string[] | undefined = () => undefined): Product[] {
  const byUrl = new Map<string, Product>()
  for (const candidate of input) {
    if (!candidate || typeof candidate !== "object") throw new Error(`${platform} product entry must be an object`)
    const raw = candidate as Record<string, unknown>
    const rawUrl = typeof raw.productUrl === "string" ? raw.productUrl : ""
    const productUrl = config.type === "cafe24" ? canonicalizeCafe24ProductUrl(rawUrl) : rawUrl
    const evidence = {
      name: typeof raw.name === "string" ? raw.name : undefined,
      category: typeof raw.category === "string" ? raw.category : undefined,
      subcategory: typeof raw.subcategory === "string" ? raw.subcategory : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
      productUrl,
    }
    let resolved = resolveProductGenderWithSource(raw.gender, evidence, (raw.genderSource as GenderSource | undefined) ?? "engine", {
      kidsGenderNoisePatterns: config.kidsGenderNoisePatterns,
      verifiedUnisexDefault: config.verifiedUnisexDefault || SITE_GENDER_DEFAULTS[platform]?.includes("unisex"),
      genderTextPatterns: config.genderTextPatterns,
      brandGenderScope: brandGenderScope(typeof raw.brand === "string" ? raw.brand : config.brand ?? ""),
    })
    const verifiedNameGender = typeof raw.name === "string" ? inferVerifiedSiteGenderFromName(platform, raw.name) : null
    if (!resolved.conflict && verifiedNameGender && (resolved.gender.length === 0 || resolved.source === "config_default")) {
      resolved = resolveProductGenderWithSource([verifiedNameGender], evidence, "text", {
        kidsGenderNoisePatterns: config.kidsGenderNoisePatterns,
        verifiedUnisexDefault: config.verifiedUnisexDefault,
        genderTextPatterns: config.genderTextPatterns,
        brandGenderScope: brandGenderScope(typeof raw.brand === "string" ? raw.brand : config.brand ?? ""),
      })
    }
    const siteDefault = config.defaultGender ?? SITE_GENDER_DEFAULTS[platform] ?? []
    if (!resolved.conflict && resolved.gender.length === 0 && siteDefault.length > 0) {
      resolved = resolveProductGenderWithSource(siteDefault, evidence, "config_default", {
        kidsGenderNoisePatterns: config.kidsGenderNoisePatterns,
        verifiedUnisexDefault: config.verifiedUnisexDefault,
        genderTextPatterns: config.genderTextPatterns,
        brandGenderScope: brandGenderScope(typeof raw.brand === "string" ? raw.brand : config.brand ?? ""),
      })
    }
    const normalized = {...raw, productUrl, ...(resolved.gender.length > 0 ? {gender: resolved.gender, genderSource: resolved.source} : {})}
    const validation = validateProduct(normalized)
    if (!validation.ok) throw new Error(`${platform} product validation failed at ${validation.failedField}: ${validation.message}`)
    const prior = byUrl.get(productUrl)
    const nextObserved = Date.parse(validation.value.detailFetchedAt ?? validation.value.crawledAt)
    const priorObserved = prior ? Date.parse(prior.detailFetchedAt ?? prior.crawledAt) : Number.NEGATIVE_INFINITY
    if (!prior || nextObserved >= priorObserved) byUrl.set(productUrl, validation.value)
  }
  return [...byUrl.values()]
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length)
  if (process.argv.includes("--allow-qwen-deferred")) {
    throw new Error("--allow-qwen-deferred is obsolete; restore Qwen and retry the failed normalization")
  }
  if (process.argv.includes("--allow-unconfirmed-pricing")) {
    throw new Error("--allow-unconfirmed-pricing is obsolete; confirmed pricing evidence is required")
  }
  if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

  const dataDir = path.join(process.cwd(), "data")
  const siteArg = process.argv.find((arg) => arg.startsWith("--site="))?.slice("--site=".length)
  const targetSites = siteArg ? new Set(siteArg.split(",").filter(Boolean)) : null
  const filenames = fs.readdirSync(dataDir).filter((file) => file.endsWith("-products.json"))
    .filter((file) => !targetSites || targetSites.has(file.replace("-products.json", "")))
    .sort()
  if (filenames.length === 0) throw new Error("no product files selected")
  if (targetSites) {
    const selected = new Set(filenames.map((file) => file.replace("-products.json", "")))
    const missing = [...targetSites].filter((site) => !selected.has(site))
    if (missing.length > 0) throw new Error(`selected product files missing: ${missing.join(",")}`)
  }

  const {rows: brandRows, idMap: brandIdMap, genderById: brandGenderById} = await loadBrandNodes()
  const platformBrandMap = await loadPlatformBrandNodeMap()
  const sourceByFile = new Map<string, Product[]>()
  const files: ProductImportFile[] = filenames.map((file) => {
    const platform = file.replace("-products.json", "")
    const registeredConfig = getSiteConfig(platform)
    if (!registeredConfig) throw new Error(`platform config missing: ${platform}`)
    const config = process.argv.includes("--trusted-category")
      ? {...registeredConfig, trustedCategory: true}
      : registeredConfig
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"))
    if (!Array.isArray(parsed)) throw new Error(`${file} JSON must contain a product array`)
    const products = prepareImportInputProducts(parsed, platform, config, (brand) => {
      const canonical = resolveProductBrand(brand, config).trim()
      const id = resolveProductBrandNodeId(canonical, platform, brandIdMap, platformBrandMap)
      return id === null ? undefined : brandGenderById.get(id)
    })
    const sample = products[0]
    if (sample && ["USD", "EUR", "GBP"].includes(sample.sourceCurrency ?? "") && typeof sample.price === "number" && sample.price > 5000) {
      throw new Error(`${file} appears to contain legacy KRW-converted prices; re-crawl before importing`)
    }
    sourceByFile.set(file, products)
    return {platform, file, products: process.argv.includes("--in-stock-only") ? products.filter((product) => product.inStock) : products, config}
  })

  // All selected files have crossed the local schema boundary before the first
  // database read or mutation. This keeps malformed input failures reportable.
  if (!dryRun) {
    await initFxRates()
    await assertQwenReady()
  }
  let browser: Browser | null = null
  const result = await runProductImport(files, {
    mode: dryRun ? "dry_run" : "apply",
    noNewBrands: process.argv.includes("--no-new-brands"),
  }, {
    resolveBrand: (product, config): BrandResolution => {
      const brand = resolveProductBrand(product.brand, config).trim()
      if (!brand) return {status: "quarantined", brand: "", reason: "brand_missing"}
      const id = resolveProductBrandNodeId(brand, config.key, brandIdMap, platformBrandMap)
      if (id !== null) return {status: "existing", brand, brandNodeId: toDecimalId(id),
        genderScope: brandGenderById.get(id) ?? null}
      return isTrustedBrandSource({selfBranded: false, configBrand: config.brand, multiBrand: config.multiBrand})
        ? {status: "would_create", brand}
        : {status: "quarantined", brand, reason: "untrusted_unknown_brand"}
    },
    getExistingProduct: async (productUrl) => {
      const {data, error} = await db.from("products").select("id,product_url,updated_at,crawled_at,last_seen_at").eq("product_url", productUrl).maybeSingle()
      if (error) throw new Error("existing product lookup failed")
      if (!data) return null
      const row = data as {id: string | number; product_url: string; updated_at: string; crawled_at: string | null; last_seen_at: string | null}
      const observations = [row.crawled_at, row.last_seen_at].filter((value): value is string => typeof value === "string")
      const observedAt = observations.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
      return {id: toDecimalId(row.id), productUrl: row.product_url, updatedAt: row.updated_at, observedAt}
    },
    createBrand: async (resolution, config) => {
      const created = await resolveUnknownBrands([{raw: resolution.brand, platform: config.key}], brandRows, brandIdMap)
      if (created.failed > 0) throw new Error("brand creation failed")
      const id = resolveProductBrandNodeId(resolution.brand, config.key, brandIdMap, platformBrandMap)
      if (id === null) throw new Error("created brand mapping missing")
      return {status: "existing", brand: resolution.brand, brandNodeId: toDecimalId(id)}
    },
    prepare: prepareProductForImport,
    prepareDependencies: {
      normalize: async (input) => {
        const response = await classifyProductWithQwen(input)
        return {...response.value, model: response.model}
      },
      recoverDetailPricing: async (product) => {
        browser ??= await chromium.launch({headless: true})
        const page = await browser.newPage()
        try {
          await page.goto(product.productUrl, {waitUntil: "domcontentloaded", timeout: 15000})
          return await recoverCafe24CandidateDetailPricing(product, page)
        } finally { await page.close() }
      },
    },
    writePrepared: async (rows) => {
      const {data, error} = await db.rpc("upsert_prepared_products", {p_rows: rows})
      if (error) throw new Error("prepared product RPC failed")
      return data as PreparedProductWriteResult[]
    },
    replaceReviews: async (input) => {
      const {data, error} = await db.rpc("replace_product_reviews", {
        p_product_id: input.productId, p_observed_at: input.observedAt, p_reviews: input.reviews,
      })
      if (error) throw new Error("review replacement RPC failed")
      return data as {outcome: "applied" | "unchanged" | "stale" | "missing"; product_id: string; review_count: number}
    },
    writeCheckpoint: ({file, productUrl, normalization}) => {
      if (!file) return
      const products = sourceByFile.get(file)
      const target = products?.find((product) => product.productUrl === productUrl)
      if (!products || !target) throw new Error("checkpoint product missing")
      target.normalization = normalization
      writeJsonCheckpoint(path.join(dataDir, file), products)
    },
    syncStatus: async ({platform, status, counts}) => {
      const file = files.find((entry) => entry.platform === platform)
      const dominantBrand = file?.products.find((product) => product.brand.trim())?.brand ?? null
      await syncProductCrawlStatus(platform, dominantBrand, {
        inserted: (counts.inserted ?? 0) + (counts.updated ?? 0) + (counts.unchanged ?? 0),
        errors: status === "success" ? 0 : counts.failed ?? 1,
        total: counts.input ?? 0,
        qcPassRate: (counts.input ?? 0) > 0 ? ((counts.input ?? 0) - (counts.qc_failed ?? 0)) / (counts.input ?? 1) : 1,
        outOfScope: counts.policy_excluded ?? 0,
      })
    },
  }).finally(async () => { if (browser) await browser.close() })
  if (reportPath) await writePipelineReport(reportPath, result.report)
  const c = result.report.counts
  console.log(`Import ${result.report.status}: input=${c.input ?? 0} inserted=${c.inserted ?? 0} updated=${c.updated ?? 0} unchanged=${c.unchanged ?? 0} excluded=${c.policy_excluded ?? 0} failed=${c.failed ?? 0} pending=${c.pending ?? 0}`)
  process.exitCode = pipelineExitCode(result.report)
}

async function handleMainError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length)
  if (reportPath) {
    const report = createPipelineReport({mode: process.argv.includes("--dry-run") ? "dry_run" : "apply"})
    report.counts = {input: 0, inserted: 0, updated: 0, unchanged: 0, policy_excluded: 0, failed: 1, pending: 0}
    addPipelineError(report, {stage: "setup", code: "invalid_setup", message, retryable: false})
    await writePipelineReport(reportPath, finalizePipelineReport(report, {status: "failed"})).catch(() => {})
  }
  process.exitCode = /required|selected|config|directory|JSON|obsolete/i.test(message) ? 2 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch(handleMainError)
}

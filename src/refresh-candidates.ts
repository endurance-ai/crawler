#!/usr/bin/env npx tsx

import {chromium, type Browser} from "playwright"

import {getSiteConfig} from "./configs/platforms"
import {applyValidationGate} from "./lib/core/validation-gate"
import {enrichProductWithLlm} from "./lib/llm-product-enrichment"
import {
  buildQwenNormalizationPatch,
  needsQwenNormalization,
  type ProductNormalizationInput,
} from "./lib/product-qwen-normalization"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {isValidCategory} from "./lib/enums/product-enums"
import {applyProductQcGate} from "./lib/product-qc/normalization"
import {resolveProductGenderWithSource} from "./lib/product-gender"
import {productToCandidateDbRow} from "./lib/refresh-candidate-import"
import type {Product} from "./lib/types"

interface CandidateRow {
  id: number
  platform_key: string
  product_url: string
  raw_product: Product
  detected_brand: string | null
  matched_brand_node_id: number
  attempt_count: number
  imported_product_id: number | null
  status?: string
  updated_at?: string
  next_attempt_at?: string | null
}

class PermanentCandidateError extends Error {}

function intFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function stringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  return raw && raw.length > 0 ? raw : null
}

function booleanFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const CANDIDATE_SELECT =
  "id,platform_key,product_url,raw_product,detected_brand,matched_brand_node_id,attempt_count,imported_product_id,status,updated_at,next_attempt_at"

/**
 * The database RPC supports origin-country scoping but not platform scoping.
 * Filtering after the RPC would leave unrelated brands claimed, so explicit
 * platform recovery uses an optimistic compare-and-set claim instead.
 */
async function claimPlatformCandidates(
  db: ProductCollectionClient,
  platform: string,
  limit: number,
  maxAttempts: number,
  inStockOnly: boolean,
): Promise<CandidateRow[]> {
  const {data, error} = await db
    .from("product_refresh_candidates")
    .select(CANDIDATE_SELECT)
    .eq("platform_key", platform)
    .not("matched_brand_node_id", "is", null)
    .lt("attempt_count", maxAttempts)
    .in("status", ["discovered", "failed", "enriching"])
    .order("first_seen_at", {ascending: true})
    .order("id", {ascending: true})
    .limit(Math.max(limit * 4, limit))
  if (error) throw new Error(`platform candidate scan failed: ${error.message}`)

  const now = Date.now()
  const staleBefore = now - 30 * 60_000
  const eligible = ((data ?? []) as CandidateRow[]).filter((candidate) => {
    if (inStockOnly && candidate.raw_product.inStock !== true) return false
    if (candidate.status === "enriching") {
      return typeof candidate.updated_at === "string" && new Date(candidate.updated_at).getTime() < staleBefore
    }
    return candidate.next_attempt_at == null || new Date(candidate.next_attempt_at).getTime() <= now
  })

  const claimed: CandidateRow[] = []
  for (const candidate of eligible) {
    if (claimed.length >= limit) break
    let query = db
      .from("product_refresh_candidates")
      .update({
        status: "enriching",
        attempt_count: candidate.attempt_count + 1,
        next_attempt_at: null,
        last_error: null,
      })
      .eq("id", candidate.id)
      .eq("status", candidate.status)
      .eq("attempt_count", candidate.attempt_count)
    if (candidate.updated_at) query = query.eq("updated_at", candidate.updated_at)
    const {data: row, error: claimError} = await query.select(CANDIDATE_SELECT).maybeSingle()
    if (claimError) throw new Error(`platform candidate claim failed: ${claimError.message}`)
    if (row) claimed.push(row as CandidateRow)
  }
  return claimed
}

/**
 * 후보를 claim 한다. `originCountry` 는 RPC 안에서 걸린다 — 이 함수가 행을
 * 고르는 그 자리에서 status='enriching' 으로 잠그기 때문에, 받아서 거르면
 * 이미 claim 된 뒤라 되돌려도 다음 claim 이 같은 행을 또 집는다 (migration 100).
 */
async function claimCandidates(
  db: ProductCollectionClient,
  limit: number,
  maxAttempts: number,
  originCountry: string | null,
  platform: string | null = null,
  inStockOnly = false,
): Promise<CandidateRow[]> {
  if (platform) return claimPlatformCandidates(db, platform, limit, maxAttempts, inStockOnly)
  const {data, error} = await db.rpc("claim_product_refresh_candidates", {
    p_limit: limit,
    p_max_attempts: maxAttempts,
    p_origin_country: originCountry,
  })
  if (error) throw new Error(`candidate claim failed: ${error.message}`)
  return (data ?? []) as CandidateRow[]
}

async function ensureExistingBrand(
  db: ProductCollectionClient,
  candidate: CandidateRow,
): Promise<void> {
  const {data, error} = await db
    .from("brand_nodes")
    .select("id")
    .eq("id", candidate.matched_brand_node_id)
    .maybeSingle()
  if (error) throw new Error(`brand recheck failed: ${error.message}`)
  if (!data) throw new PermanentCandidateError("matched existing brand no longer exists")
}

async function markRejected(
  db: ProductCollectionClient,
  candidate: CandidateRow,
  error: string,
): Promise<void> {
  const {error: updateError} = await db
    .from("product_refresh_candidates")
    .update({status: "rejected", last_error: error, next_attempt_at: null})
    .eq("id", candidate.id)
  if (updateError) throw new Error(`candidate reject update failed: ${updateError.message}`)
}

async function markFailed(
  db: ProductCollectionClient,
  candidate: CandidateRow,
  maxAttempts: number,
  error: string,
): Promise<void> {
  if (candidate.attempt_count >= maxAttempts) {
    if (candidate.imported_product_id !== null) {
      await markImported(db, candidate, candidate.imported_product_id, {
        last_error: `imported with Qwen warning after max attempts: ${error}`,
      })
    } else {
      await markRejected(db, candidate, `max attempts reached: ${error}`)
    }
    return
  }
  const delayMinutes = 5 * 2 ** Math.max(0, candidate.attempt_count - 1)
  const {error: updateError} = await db
    .from("product_refresh_candidates")
    .update({
      status: "failed",
      imported_product_id: candidate.imported_product_id,
      last_error: error,
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    })
    .eq("id", candidate.id)
  if (updateError) throw new Error(`candidate failure update failed: ${updateError.message}`)
}

async function saveImportedProductId(
  db: ProductCollectionClient,
  candidate: CandidateRow,
  productId: number,
): Promise<void> {
  const {error} = await db
    .from("product_refresh_candidates")
    .update({imported_product_id: productId})
    .eq("id", candidate.id)
  if (error) throw new Error(`candidate product-id checkpoint failed: ${error.message}`)
  candidate.imported_product_id = productId
}

async function getPersistedProduct(
  db: ProductCollectionClient,
  productId: number,
): Promise<{id: number; category: string; subcategory: string | null; updated_at: string} | null> {
  const {data, error} = await db
    .from("products")
    .select("id,category,subcategory,updated_at")
    .eq("id", productId)
    .maybeSingle()
  if (error) throw new Error(`persisted product lookup failed: ${error.message}`)
  return data as {id: number; category: string; subcategory: string | null; updated_at: string} | null
}

async function findExistingProductId(
  db: ProductCollectionClient,
  productUrl: string,
): Promise<number | null> {
  const {data, error} = await db
    .from("products")
    .select("id")
    .eq("product_url", productUrl)
    .maybeSingle()
  if (error) throw new Error(`product lookup failed: ${error.message}`)
  return data ? Number((data as {id: number}).id) : null
}

async function markImported(
  db: ProductCollectionClient,
  candidate: CandidateRow,
  productId: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const {error} = await db
    .from("product_refresh_candidates")
    .update({
      status: "imported",
      imported_product_id: productId,
      last_error: null,
      next_attempt_at: null,
      ...extra,
    })
    .eq("id", candidate.id)
  if (error) throw new Error(`candidate imported update failed: ${error.message}`)
}

async function processCandidate(
  db: ProductCollectionClient,
  candidate: CandidateRow,
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>,
): Promise<"skipped" | "normalized"> {
  const config = getSiteConfig(candidate.platform_key)
  if (!config || config.disabled) {
    throw new PermanentCandidateError("source config missing or disabled")
  }
  await ensureExistingBrand(db, candidate)

  // LLM 호출 **전에** 중복을 거른다. 후보 1건 = 상세 크롤 + LLM 1회이므로, 이미
  // products 에 있는 URL 을 그대로 태우면 돈만 쓰고 아무것도 안 하는 호출이 된다.
  // 예전에는 upsert(ignoreDuplicates) 뒤에야 중복을 알았다 — 그때는 이미 비용을
  // 다 치른 뒤다. 실측 2026-07-31: fetchExistingRows 의 ORDER BY 누락으로 이미
  // products 에 있는 URL 이 후보로 3,996건 쌓여 있었다.
  const alreadyImported = await findExistingProductId(db, candidate.product_url)
  if (alreadyImported !== null && candidate.imported_product_id === null) {
    await markImported(db, candidate, alreadyImported)
    return "skipped"
  }

  const raw: Product = {
    ...candidate.raw_product,
    productUrl: candidate.product_url,
    platform: candidate.platform_key,
  }
  // 리스팅 크롤이 실은 엔진 gender 가 있으면 그걸 쓰고, 없으면 URL/상품명/사이트
  // 기본값으로 결의한다. Qwen 호출 전에 이 결정론적 최소 row를 먼저 적재한다.
  const resolvedGender = resolveProductGenderWithSource(
    raw.gender,
    {
      name: raw.name,
      category: raw.category,
      subcategory: raw.subcategory,
      tags: raw.tags,
      productUrl: raw.productUrl,
    },
    raw.genderSource ?? "engine",
    {
      kidsGenderNoisePatterns: config.kidsGenderNoisePatterns,
      verifiedUnisexDefault: config.verifiedUnisexDefault,
      genderTextPatterns: config.genderTextPatterns,
    },
  )
  const withGender =
    resolvedGender.gender.length > 0
      ? resolvedGender
      : config.defaultGender && config.defaultGender.length > 0
        ? resolveProductGenderWithSource(config.defaultGender, {}, "config_default", {
            verifiedUnisexDefault: config.verifiedUnisexDefault,
            genderTextPatterns: config.genderTextPatterns,
          })
        : resolvedGender
  if (withGender.gender.length === 0) {
    // PermanentCandidateError 여야 한다 — 일반 Error 면 maxAttempts 까지 같은
    // 후보를 계속 재시도한다. 성별 근거가 없는 건 재시도로 해결되지 않는다.
    throw new PermanentCandidateError("gender unresolved")
  }
  raw.gender = withGender.gender
  raw.genderSource = withGender.source ?? undefined
  const qc = applyProductQcGate([raw], candidate.platform_key, {
    trustedCategory: config.type === "shopify" || config.trustedCategory === true,
    kidsGenderNoisePatterns: config.kidsGenderNoisePatterns,
    verifiedUnisexDefault: config.verifiedUnisexDefault,
  })
  if (qc.length !== 1) throw new PermanentCandidateError("product QC rejected initial product")
  const validated = applyValidationGate(qc, candidate.platform_key)
  if (validated.length !== 1) throw new PermanentCandidateError("product validation rejected initial product")
  const payload = productToCandidateDbRow(
    validated[0],
    config,
    candidate.matched_brand_node_id,
  )
  let productId = candidate.imported_product_id
  if (productId === null) {
    const {data: inserted, error} = await db
      .from("products")
      .upsert(payload, {onConflict: "product_url", ignoreDuplicates: true})
      .select("id")
      .maybeSingle()
    if (error) throw new Error(`candidate product insert failed: ${error.message}`)

    productId = (inserted as {id: number} | null)?.id ?? null
    if (productId === null) {
      // 위 사전 확인 이후에 다른 임포터가 이겼다. 이미 존재하는 행을 덮어쓰지 않고
      // 후보만 완료 처리한다.
      productId = await findExistingProductId(db, candidate.product_url)
      if (productId === null) throw new Error("candidate product race lookup failed: no data")
      await markImported(db, candidate, productId)
      return "skipped"
    }
    await saveImportedProductId(db, candidate, productId)
  }

  const persisted = await getPersistedProduct(db, productId)
  if (!persisted) throw new Error("persisted candidate product disappeared")
  const normalizationInput: ProductNormalizationInput = {
    productUrl: validated[0].productUrl,
    name: validated[0].name,
    brand: validated[0].brand,
    category: persisted.category,
    subcategory: persisted.subcategory,
    tags: validated[0].tags,
  }
  if (!needsQwenNormalization(normalizationInput)) {
    await markImported(db, candidate, productId)
    return "skipped"
  }

  const enrichment = await enrichProductWithLlm(page, validated[0], config)
  if (!isValidCategory(enrichment.product.category)) {
    throw new Error("Qwen returned a non-canonical category")
  }
  const patch = buildQwenNormalizationPatch(normalizationInput, {
    category: enrichment.product.category,
    subcategory: enrichment.product.subcategory ?? null,
  })
  if (!patch) throw new Error("Qwen result did not provide a safe normalization patch")

  const {data: patched, error: patchError} = await db
    .from("products")
    .update({...patch, updated_at: new Date().toISOString()})
    .eq("id", productId)
    .eq("updated_at", persisted.updated_at)
    .select("id")
    .maybeSingle()
  if (patchError) throw new Error(`candidate Qwen patch failed: ${patchError.message}`)
  if (!patched) throw new Error("candidate Qwen patch skipped after concurrent update")

  await markImported(db, candidate, productId, {
    enriched_product: {...validated[0], ...patch},
    llm_model: enrichment.model,
    llm_usage: enrichment.usage,
    llm_cost_usd: enrichment.costUsd,
  })
  return "normalized"
}

interface BatchTotals {
  imported: number
  failed: number
  rejected: number
  qwenSucceeded: number
  qwenDeferred: number
  schemaFailed: number
  raceSkipped: number
}

async function processBatch(
  db: ProductCollectionClient,
  browser: Browser,
  candidates: CandidateRow[],
  concurrency: number,
  maxAttempts: number,
  totals: BatchTotals,
): Promise<void> {
  let cursor = 0
  let imported = 0
  let failed = 0
  let rejected = 0
  let qwenSucceeded = 0
  let qwenDeferred = 0
  let schemaFailed = 0
  let raceSkipped = 0
  const workers = Array.from({length: Math.min(concurrency, candidates.length)}, async () => {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "ko-KR",
      })
      await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}", (route: {abort: () => unknown}) => route.abort())
      const page = await context.newPage()
      try {
        while (cursor < candidates.length) {
          const candidate = candidates[cursor++]
          try {
            const outcome = await processCandidate(db, candidate, page)
            if (outcome === "normalized") qwenSucceeded += 1
            imported += 1
            console.log(`✓ candidate #${candidate.id} ${candidate.platform_key} imported`)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (error instanceof PermanentCandidateError) {
              await markRejected(db, candidate, message)
              rejected += 1
            } else {
              await markFailed(db, candidate, maxAttempts, message)
              failed += 1
              if (candidate.imported_product_id !== null) {
                qwenDeferred += 1
                if (/schema|validation|non-canonical/i.test(message)) schemaFailed += 1
                if (/concurrent update/i.test(message)) raceSkipped += 1
              }
            }
            console.error(`✖ candidate #${candidate.id}: ${message}`)
          } finally {
            await page.goto("about:blank", {timeout: 5000}).catch(() => {})
          }
        }
      } finally {
        await context.close()
      }
    })
  await Promise.all(workers)
  totals.imported += imported
  totals.failed += failed
  totals.rejected += rejected
  totals.qwenSucceeded += qwenSucceeded
  totals.qwenDeferred += qwenDeferred
  totals.schemaFailed += schemaFailed
  totals.raceSkipped += raceSkipped
}

async function main(): Promise<void> {
  // 상한을 두지 않는다. 예전에는 Math.min(limit,200) / Math.min(concurrency,4) 로
  // 코드에 박혀 있어 systemd 플래그를 올려도 무시됐고, 워커가 claim 배치 1회만 돌고
  // 끝나 처리량이 ~250건/일에 묶였다 (적체 실측 2026-07-30: discovered 31,901 → 넉 달).
  const batchSize = Math.max(1, intFlag("limit", 200))
  const maxAttempts = Math.max(1, intFlag("max-attempts", 3))
  const concurrency = Math.max(1, intFlag("concurrency", 2))
  // 예산 기반 루프. 0(기본)이면 종전대로 배치 1회만 돌고 끝난다 — 무제한으로 두면
  // 한 런이 끝나지 않아 다음 refresh 를 막는다(같은 이유로 refresh 도 예산제다).
  const budgetMs = Math.max(0, intFlag("budget-minutes", 0)) * 60_000
  // 브랜드 origin 필터. 큐 75,404건 중 KR 이 58,917건(78%)이고 운영 방침이
  // 한국 브랜드 우선이라, 대상이 아닌 후보에 LLM 비용을 쓰지 않기 위한 것이다.
  // 미지정이면 전량 — 방침이 바뀌면 플래그만 빼면 된다.
  const originCountry = stringFlag("country")
  const platform = stringFlag("platform")
  const inStockOnly = booleanFlag("in-stock-only")
  const startedAt = Date.now()
  const withinBudget = () => budgetMs > 0 && Date.now() - startedAt < budgetMs

  const db = createProductCollectionClient()
  const totals: BatchTotals = {
    imported: 0,
    failed: 0,
    rejected: 0,
    qwenSucceeded: 0,
    qwenDeferred: 0,
    schemaFailed: 0,
    raceSkipped: 0,
  }
  let claimed = 0
  let batches = 0
  let browser: Browser | null = null

  try {
    for (;;) {
      const candidates = await claimCandidates(db, batchSize, maxAttempts, originCountry, platform, inStockOnly)
      if (candidates.length === 0) {
        if (batches === 0) {
          console.log(
            `신규상품 LLM 후보 없음` +
            `${originCountry ? ` (origin=${originCountry})` : ""}` +
            `${platform ? ` (platform=${platform}${inStockOnly ? ", in_stock_only" : ""})` : ""}`,
          )
        }
        break
      }
      // 브라우저는 배치마다 새로 띄우지 않는다 — 예산 루프에서 반복 기동은 비싸다.
      browser ??= await chromium.launch({headless: true})
      claimed += candidates.length
      batches += 1
      await processBatch(db, browser, candidates, concurrency, maxAttempts, totals)
      if (!withinBudget()) break
    }
  } finally {
    if (browser) await browser.close()
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  console.log(
    `신규상품 worker 완료${originCountry ? ` [origin=${originCountry}]` : ""}` +
      `${platform ? ` [platform=${platform}${inStockOnly ? ", in_stock_only" : ""}]` : ""}:` +
      ` batches=${batches} claimed=${claimed} imported=${totals.imported}` +
      ` failed=${totals.failed} rejected=${totals.rejected}` +
      ` qwen_success=${totals.qwenSucceeded} qwen_deferred=${totals.qwenDeferred}` +
      ` schema_failed=${totals.schemaFailed} race_skip=${totals.raceSkipped} · ${elapsed}초` +
      (budgetMs > 0 && !withinBudget() && claimed > 0 ? ` (예산 ${budgetMs / 60_000}분 소진)` : ""),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

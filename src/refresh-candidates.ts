#!/usr/bin/env npx tsx

import {chromium, type Browser} from "playwright"

import {getSiteConfig} from "./configs/platforms"
import {applyValidationGate} from "./lib/core/validation-gate"
import {enrichProductWithLlm} from "./lib/llm-product-enrichment"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {applyProductQcGate} from "./lib/product-qc/normalization"
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
}

class PermanentCandidateError extends Error {}

function intFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

async function claimCandidates(
  db: ProductCollectionClient,
  limit: number,
  maxAttempts: number,
): Promise<CandidateRow[]> {
  const {data, error} = await db.rpc("claim_product_refresh_candidates", {
    p_limit: limit,
    p_max_attempts: maxAttempts,
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
    await markRejected(db, candidate, `max attempts reached: ${error}`)
    return
  }
  const delayMinutes = 5 * 2 ** Math.max(0, candidate.attempt_count - 1)
  const {error: updateError} = await db
    .from("product_refresh_candidates")
    .update({
      status: "failed",
      last_error: error,
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    })
    .eq("id", candidate.id)
  if (updateError) throw new Error(`candidate failure update failed: ${updateError.message}`)
}

async function processCandidate(
  db: ProductCollectionClient,
  candidate: CandidateRow,
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>,
): Promise<void> {
  const config = getSiteConfig(candidate.platform_key)
  if (!config || config.disabled) {
    throw new PermanentCandidateError("source config missing or disabled")
  }
  await ensureExistingBrand(db, candidate)
  const raw: Product = {
    ...candidate.raw_product,
    productUrl: candidate.product_url,
    platform: candidate.platform_key,
  }
  const enrichment = await enrichProductWithLlm(page, raw, config)
  const qc = applyProductQcGate([enrichment.product], candidate.platform_key)
  if (qc.length !== 1) throw new PermanentCandidateError("product QC rejected LLM enrichment")
  const validated = applyValidationGate(qc, candidate.platform_key)
  if (validated.length !== 1) throw new PermanentCandidateError("product validation rejected LLM enrichment")
  const payload = productToCandidateDbRow(
    validated[0],
    config,
    candidate.matched_brand_node_id,
  )
  const {data: inserted, error} = await db
    .from("products")
    .upsert(payload, {onConflict: "product_url", ignoreDuplicates: true})
    .select("id")
    .maybeSingle()
  if (error) throw new Error(`candidate product insert failed: ${error.message}`)

  let productId = (inserted as {id: number} | null)?.id
  if (!productId) {
    // Another importer won the race. Treat the candidate as complete without
    // rewriting that already-existing product row.
    const {data: existing, error: existingError} = await db
      .from("products")
      .select("id")
      .eq("product_url", candidate.product_url)
      .maybeSingle()
    if (existingError || !existing) {
      throw new Error(
        `candidate product race lookup failed: ${existingError?.message ?? "no data"}`,
      )
    }
    productId = Number((existing as {id: number}).id)
  }
  const {error: candidateError} = await db
    .from("product_refresh_candidates")
    .update({
      status: "imported",
      imported_product_id: productId,
      enriched_product: validated[0],
      llm_model: enrichment.model,
      llm_usage: enrichment.usage,
      llm_cost_usd: enrichment.costUsd,
      last_error: null,
      next_attempt_at: null,
    })
    .eq("id", candidate.id)
  if (candidateError) throw new Error(`candidate imported update failed: ${candidateError.message}`)
}

interface BatchTotals {
  imported: number
  failed: number
  rejected: number
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
            await processCandidate(db, candidate, page)
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
}

async function main(): Promise<void> {
  // 상한을 두지 않는다. 예전에는 Math.min(limit,200) / Math.min(concurrency,4) 로
  // 코드에 박혀 있어 systemd 플래그를 올려도 무시됐고, 워커가 claim 배치 1회만 돌고
  // 끝나 처리량이 ~250건/일에 묶였다 (적체 실측 2026-07-30: discovered 31,901 → 넉 달).
  const batchSize = Math.max(1, intFlag("limit", 200))
  const maxAttempts = Math.max(1, intFlag("max-attempts", 3))
  const concurrency = Math.max(1, intFlag("concurrency", 4))
  // 예산 기반 루프. 0(기본)이면 종전대로 배치 1회만 돌고 끝난다 — 무제한으로 두면
  // 한 런이 끝나지 않아 다음 refresh 를 막는다(같은 이유로 refresh 도 예산제다).
  const budgetMs = Math.max(0, intFlag("budget-minutes", 0)) * 60_000
  const startedAt = Date.now()
  const withinBudget = () => budgetMs > 0 && Date.now() - startedAt < budgetMs

  const db = createProductCollectionClient()
  const totals: BatchTotals = {imported: 0, failed: 0, rejected: 0}
  let claimed = 0
  let batches = 0
  let browser: Browser | null = null

  try {
    for (;;) {
      const candidates = await claimCandidates(db, batchSize, maxAttempts)
      if (candidates.length === 0) {
        if (batches === 0) console.log("신규상품 LLM 후보 없음")
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
    `신규상품 worker 완료: batches=${batches} claimed=${claimed} imported=${totals.imported}` +
      ` failed=${totals.failed} rejected=${totals.rejected} · ${elapsed}초` +
      (budgetMs > 0 && !withinBudget() && claimed > 0 ? ` (예산 ${budgetMs / 60_000}분 소진)` : ""),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

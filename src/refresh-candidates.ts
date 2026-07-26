#!/usr/bin/env npx tsx

import {chromium} from "playwright"

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

async function main(): Promise<void> {
  const limit = Math.min(intFlag("limit", 50), 200)
  const maxAttempts = Math.min(intFlag("max-attempts", 3), 10)
  const concurrency = Math.min(intFlag("concurrency", 1), 4)
  const db = createProductCollectionClient()
  const candidates = await claimCandidates(db, limit, maxAttempts)
  if (candidates.length === 0) {
    console.log("신규상품 LLM 후보 없음")
    return
  }

  const browser = await chromium.launch({headless: true})
  let cursor = 0
  let imported = 0
  let failed = 0
  let rejected = 0
  try {
    const workers = Array.from({length: Math.min(concurrency, candidates.length)}, async () => {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "ko-KR",
      })
      await context.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}", (route) => route.abort())
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
  } finally {
    await browser.close()
  }
  console.log(
    `신규상품 worker 완료: claimed=${candidates.length} imported=${imported}` +
      ` failed=${failed} rejected=${rejected}`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

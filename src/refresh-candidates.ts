#!/usr/bin/env npx tsx

import {chromium, type Browser} from "playwright"
import {getSiteConfig} from "./configs/platforms"
import {enrichProductWithLlm} from "./lib/llm-product-enrichment"
import {createProductCollectionClient} from "./lib/product-collection"
import {initFxRates} from "./lib/fx"
import {assertQwenReady} from "./lib/qwen-client"
import type {Product} from "./lib/types"
import {createCandidateRepository} from "./lib/candidate-repository"
import {runCandidateWorker} from "./lib/candidate-worker"
import {recoverCafe24CandidateDetailPricing} from "./lib/candidate-detail-pricing"
import {normalizeProductForImport, prepareProductForImport} from "./lib/prepare-product-for-import"
import {canReuseCandidateCheckpoint} from "./lib/candidate-checkpoint"
import type {ClaimedProductRefreshCandidate} from "./lib/pipeline-integrity-types"
import {addPipelineError, createPipelineReport, finalizePipelineReport, pipelineExitCode, sanitizePipelineMessage, writePipelineReport} from "./lib/pipeline-report"

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

async function mainV2(): Promise<void> {
  if (booleanFlag("help")) {
    console.log("Usage: refresh-candidates [--dry-run] [--limit=N] [--concurrency=N] [--country=CC] [--platform=KEY] [--in-stock-only] [--max-attempts=N] [--max-age-hours=N] [--budget-minutes=N] [--report=FILE]")
    return
  }
  const dryRun = booleanFlag("dry-run")
  const reportPath = stringFlag("report")
  const report = createPipelineReport({mode: dryRun ? "dry_run" : "apply"})
  const filters = {limit: Math.max(1, intFlag("limit", 200)), maxAttempts: Math.max(1, intFlag("max-attempts", 3)),
    originCountry: stringFlag("country"), platform: stringFlag("platform"), inStockOnly: booleanFlag("in-stock-only"),
    maxAgeHours: Math.max(1, intFlag("max-age-hours", 24))}
  let repository
  try {
    const db = createProductCollectionClient()
    repository = createCandidateRepository(db as never)
    if (!dryRun) {
      await initFxRates()
      await assertQwenReady()
    }
  } catch (error) {
    addPipelineError(report, {stage: "setup", code: "setup_failed",
      message: error instanceof Error ? error.message : "candidate setup failed", retryable: true})
    report.counts.failed = 1
    report.files.push({platform: filters.platform ?? "all", status: "failed", counts: {failed: 1}, errors: [...report.errors]})
    const failed = finalizePipelineReport(report, {status: "failed"})
    if (reportPath) await writePipelineReport(reportPath, failed)
    throw error
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once("SIGINT", abort)
  process.once("SIGTERM", abort)
  let workerBrowser: Browser | null = null
  const withPage = async <T>(candidate: ClaimedProductRefreshCandidate,
    action: (page: import("playwright").Page, product: Product) => Promise<T>): Promise<T> => {
    workerBrowser ??= await chromium.launch({headless: true})
    const context = await workerBrowser.newContext()
    try {
      const page = await context.newPage()
      return await action(page, structuredClone(candidate.raw_product) as unknown as Product)
    } finally { await context.close() }
  }
  try {
    const result = await runCandidateWorker({...filters, mode: dryRun ? "dry_run" : "apply",
      concurrency: Math.max(1, intFlag("concurrency", 4)),
      budgetMs: Math.max(0, intFlag("budget-minutes", 15)) * 60_000, signal: controller.signal}, {repository,
      checkpointReusable: (candidate) => canReuseCandidateCheckpoint(candidate, filters.maxAgeHours),
      prepare: async (candidate) => withPage(candidate, async (page, product) => {
        const config = getSiteConfig(candidate.platform_key)
        if (!config) return {status: "failed" as const, error: {stage: "config", code: "platform_unknown",
          message: "platform configuration is unavailable", retryable: false}}
        let navigated = false
        const navigate = async () => { if (!navigated) { await page.goto(candidate.product_url,
          {waitUntil: "domcontentloaded", timeout: 60_000}); navigated = true } }
        const checkpoint = candidate.normalization_result && candidate.enriched_product ? {
          status: candidate.normalization_result.status,
          inputHash: candidate.normalization_result.input_hash,
          policyVersion: candidate.normalization_result.policy_version,
          model: candidate.normalization_result.model,
          completedAt: candidate.normalization_result.completed_at,
          category: String(candidate.enriched_product.product.category),
          subcategory: candidate.enriched_product.product.subcategory === null ? null : String(candidate.enriched_product.product.subcategory),
        } : null
        const result = await prepareProductForImport({product, config,
          observedAt: candidate.raw_observed_at ?? "", expectedUpdatedAt: null,
          normalizationCheckpoint: checkpoint}, {
          resolveBrand: async () => ({status: "existing", brand: candidate.detected_brand ?? product.brand,
            brandNodeId: candidate.matched_brand_node_id ?? "",
            genderScope: candidate.matched_brand_node_id
              ? await repository.brandGenderScope(candidate.matched_brand_node_id) : null}),
          recoverDetailPricing: async (value) => { await navigate(); return recoverCafe24CandidateDetailPricing(value, page) },
          normalize: async (input) => { await navigate(); const enriched = await enrichProductWithLlm(page, {...product, ...input,
            subcategory: input.subcategory ?? undefined, tags: input.tags ?? undefined}, config, {navigate: false})
            return {category: enriched.product.category, subcategory: enriched.product.subcategory ?? null,
              model: enriched.model, completedAt: new Date().toISOString()} },
        })
        if (result.status === "prepared") return result
        return {status: "failed" as const, error: result.status === "failed" ? result.error : {
          stage: "brand", code: result.status, message: "brand is not publishable", retryable: false}}
      }),
      normalizeCurrent: async (candidate, current) => withPage(candidate, async (page, raw) => {
        const config = getSiteConfig(candidate.platform_key)
        if (!config) throw new Error("platform configuration is unavailable")
        const normalized = await normalizeProductForImport({productUrl: candidate.product_url, name: current.name, brand: current.brand,
          category: current.category, subcategory: current.subcategory ?? undefined, tags: current.tags ?? undefined}, null, {
          normalize: async (input) => { await page.goto(candidate.product_url, {waitUntil: "domcontentloaded", timeout: 60_000})
            const enriched = await enrichProductWithLlm(page, {...raw, ...input,
              subcategory: input.subcategory ?? undefined, tags: input.tags ?? undefined}, config, {navigate: false})
            return {category: enriched.product.category, subcategory: enriched.product.subcategory ?? null,
              model: enriched.model, completedAt: new Date().toISOString()} },
        })
        if (normalized.status === "failed") throw new Error(normalized.error?.message ?? "normalization failed")
        return {normalization: {status: normalized.status, input_hash: normalized.inputHash,
          policy_version: normalized.policyVersion, model: normalized.model, completed_at: normalized.completedAt},
          category: normalized.category, subcategory: normalized.subcategory}
      })})
    console.log(`candidate-v2 ${JSON.stringify({...result, errors: result.errors.length})}`)
    for (const error of result.errors) addPipelineError(report, error)
    report.counts = {input: dryRun ? result.listed : result.claimed, planned: result.listed,
      inserted: result.inserted, updated: result.updated, unchanged: result.unchanged,
      failed: result.failed + result.conflicted + result.stale + result.lostClaim + result.rejected,
      pending: result.released}
    const incomplete = report.counts.failed > 0 || report.counts.pending > 0
    report.stages.candidates = {status: incomplete ? "partial" : "success", counts: {...report.counts}}
    report.files.push({platform: filters.platform ?? "all", status: incomplete ? "partial" : "success",
      counts: {...report.counts}, errors: [...report.errors]})
    const finalReport = finalizePipelineReport(report)
    if (reportPath) await writePipelineReport(reportPath, finalReport)
    process.exitCode = pipelineExitCode(finalReport)
  } catch (error) {
    addPipelineError(report, {stage: "candidate_worker", code: "candidate_worker_failed",
      message: error instanceof Error ? error.message : "candidate worker failed", retryable: true})
    report.counts.failed = (report.counts.failed ?? 0) + 1
    report.files.push({platform: filters.platform ?? "all", status: "failed", counts: {...report.counts}, errors: [...report.errors]})
    const finalReport = finalizePipelineReport(report, {status: "failed"})
    if (reportPath) await writePipelineReport(reportPath, finalReport)
    throw error
  } finally {
    process.off("SIGINT", abort); process.off("SIGTERM", abort)
    const activeBrowser = workerBrowser as Browser | null; if (activeBrowser) await activeBrowser.close()
  }
}

mainV2().catch((error) => {
  console.error(sanitizePipelineMessage(error instanceof Error ? error.message : "candidate refresh failed"))
  process.exit(1)
})

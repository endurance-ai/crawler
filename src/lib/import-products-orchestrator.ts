import {isTrustedBrandSource} from "./brand-provenance"
import {addPipelineError, createPipelineReport, finalizePipelineReport} from "./pipeline-report"
import type {
  BrandResolution,
  NormalizationResult,
  PipelineError,
  PipelineReport,
  PreparedProductWrite,
  PreparedProductWriteResult,
} from "./pipeline-integrity-types"
import type {
  PrepareProductForImportDependencies,
  PrepareProductForImportResult,
} from "./prepare-product-for-import"
import type {Product, SiteConfig} from "./types"

export interface ProductImportFile {
  platform: string
  file?: string
  products: Product[]
  config: SiteConfig
}

export interface ExistingImportProduct {
  id: string
  productUrl: string
  updatedAt: string
  observedAt: string | null
}

export interface ProductImportOptions {
  mode: "apply" | "dry_run"
  noNewBrands?: boolean
  runId?: string
  now?: () => string
}

export interface ProductImportDependencies {
  resolveBrand(product: Product, config: SiteConfig): BrandResolution | Promise<BrandResolution>
  getExistingProduct(productUrl: string): ExistingImportProduct | null | Promise<ExistingImportProduct | null>
  createBrand?(resolution: Extract<BrandResolution, {status: "would_create"}>, config: SiteConfig): Extract<BrandResolution, {status: "existing"}> | Promise<Extract<BrandResolution, {status: "existing"}>>
  prepare(input: {product: Product; config: SiteConfig; observedAt: string; expectedUpdatedAt: string | null; normalizationCheckpoint?: NormalizationResult | null}, dependencies: PrepareProductForImportDependencies): Promise<PrepareProductForImportResult>
  prepareDependencies: Omit<PrepareProductForImportDependencies, "resolveBrand">
  writePrepared(rows: PreparedProductWrite[]): Promise<PreparedProductWriteResult[]>
  replaceReviews(input: {productId: string; observedAt: string; reviews: Array<{text: string; author: string | null; review_date: string | null; photo_urls: string[]; body_info: Record<string, unknown> | null}>}): Promise<{outcome: "applied" | "unchanged" | "stale" | "missing"; product_id: string; review_count: number}>
  writeCheckpoint?(input: {file?: string; productUrl: string; normalization: NormalizationResult}): void | Promise<void>
  syncStatus?(input: {platform: string; status: "success" | "failed"; counts: Record<string, number>}): void | Promise<void>
}

export interface ProductImportRunResult {
  report: PipelineReport
  checkpoints: Array<{file?: string; productUrl: string; normalization: NormalizationResult}>
}

const COUNT_KEYS = ["input", "inserted", "updated", "unchanged", "policy_excluded", "failed", "pending", "normalization_succeeded", "qc_failed"] as const

function emptyCounts(): Record<string, number> {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]))
}

function increment(report: PipelineReport, fileCounts: Record<string, number>, key: string, amount = 1): void {
  fileCounts[key] = (fileCounts[key] ?? 0) + amount
  report.counts[key] = (report.counts[key] ?? 0) + amount
}

function errorFor(product: Product, stage: string, code: string, message: string, retryable: boolean): PipelineError {
  return {stage, code, message, retryable, platform: product.platform, productUrl: product.productUrl}
}

function reviewRows(product: Product) {
  return (product.reviews ?? []).map((review) => ({
    text: review.text,
    author: review.author,
    review_date: review.date,
    photo_urls: review.photoUrls,
    body_info: review.body,
  }))
}

function reviewIsPublishable(product: Product): boolean {
  return product.reviewCollection?.status === "succeeded" &&
    ((product.reviews?.length ?? 0) > 0 || product.reviewCollection.confirmedEmpty === true) &&
    typeof product.reviewCollection.observedAt === "string"
}

function isValidPreparedWriteResult(value: unknown, productUrl: string): value is PreparedProductWriteResult {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return row.product_url === productUrl && typeof row.outcome === "string" &&
    ["inserted", "updated", "unchanged", "conflicted", "rejected"].includes(row.outcome) &&
    (["inserted", "updated", "unchanged"].includes(row.outcome)
      ? typeof row.id === "string" && /^[1-9]\d*$/.test(row.id)
      : row.id === null || (typeof row.id === "string" && /^[1-9]\d*$/.test(row.id)))
}

function isValidReviewWriteResult(value: unknown, productId: string, expectedCount: number): value is Awaited<ReturnType<ProductImportDependencies["replaceReviews"]>> {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return row.product_id === productId && typeof row.outcome === "string" &&
    ["applied", "unchanged", "stale", "missing"].includes(row.outcome) &&
    Number.isSafeInteger(row.review_count) && (row.review_count as number) >= 0 &&
    ((row.outcome === "applied" || row.outcome === "unchanged") ? row.review_count === expectedCount : true)
}

export async function runProductImport(
  files: ProductImportFile[],
  options: ProductImportOptions,
  dependencies: ProductImportDependencies,
): Promise<ProductImportRunResult> {
  const report = createPipelineReport({mode: options.mode, runId: options.runId, now: options.now?.()})
  report.counts = emptyCounts()
  const checkpoints: ProductImportRunResult["checkpoints"] = []

  for (const inputFile of files) {
    const counts = emptyCounts()
    const errors: PipelineError[] = []
    increment(report, counts, "input", inputFile.products.length)

    const seenProductUrls = new Set<string>()
    for (const product of inputFile.products) {
      if (seenProductUrls.has(product.productUrl)) {
        const error = errorFor(product, "input", "duplicate_product_url", "duplicate product URL in input file", false)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        continue
      }
      seenProductUrls.add(product.productUrl)
      let brand: BrandResolution
      try {
        brand = await dependencies.resolveBrand(product, inputFile.config)
      } catch {
        const error = errorFor(product, "brand", "brand_map_read_failed", "brand map lookup failed", true)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        continue
      }
      if (brand.status === "quarantined") {
        increment(report, counts, "policy_excluded")
        continue
      }
      if (options.mode === "dry_run") {
        // Planning ends before brand creation, Qwen, browser/detail recovery,
        // checkpoint writes and every database mutation.
        increment(report, counts, "planned")
        continue
      }
      let existing: ExistingImportProduct | null
      try { existing = await dependencies.getExistingProduct(product.productUrl) }
      catch {
        const error = errorFor(product, "lookup", "existing_product_read_failed", "existing product lookup failed", true)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        continue
      }
      const observedAt = product.detailFetchedAt ?? product.crawledAt
      if (existing?.observedAt && Date.parse(existing.observedAt) > Date.parse(observedAt)) {
        const error = errorFor(product, "lookup", "stale_observation", "input observation is older than stored product", false)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        continue
      }

      let prepared: PrepareProductForImportResult
      try {
        prepared = await dependencies.prepare(
          {product, config: inputFile.config, observedAt, expectedUpdatedAt: existing?.updatedAt ?? null, normalizationCheckpoint: product.normalization},
          {...dependencies.prepareDependencies, resolveBrand: () => brand},
        )
      } catch {
        const error = errorFor(product, "prepare", "prepare_failed", "product preparation failed", true)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        continue
      }
      if (prepared.status === "would_create") {
        const trusted = isTrustedBrandSource({selfBranded: false, configBrand: inputFile.config.brand, multiBrand: inputFile.config.multiBrand})
        if (options.noNewBrands || !trusted || !dependencies.createBrand) {
          increment(report, counts, "policy_excluded")
          continue
        }
        try { brand = await dependencies.createBrand(prepared.brandResolution, inputFile.config) }
        catch {
          const error = errorFor(product, "brand", "brand_create_failed", "trusted brand creation failed", true)
          errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
          continue
        }
        try {
          prepared = await dependencies.prepare(
            {product: prepared.product, config: inputFile.config, observedAt, expectedUpdatedAt: existing?.updatedAt ?? null, normalizationCheckpoint: prepared.normalization},
            {...dependencies.prepareDependencies, resolveBrand: () => brand},
          )
        } catch {
          const error = errorFor(product, "prepare", "prepare_after_brand_create_failed", "product preparation after brand creation failed", true)
          errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
          continue
        }
      }
      if (prepared.status !== "prepared") {
        if (prepared.status === "quarantined" || prepared.status === "would_create" || prepared.status === "policy_excluded") increment(report, counts, "policy_excluded")
        else {
          errors.push(prepared.error); addPipelineError(report, prepared.error); increment(report, counts, "failed")
          if (prepared.error.stage === "normalization") increment(report, counts, "qc_failed")
        }
        continue
      }
      if (prepared.normalization.status === "succeeded") increment(report, counts, "normalization_succeeded")
      const checkpoint = {file: inputFile.file, productUrl: product.productUrl, normalization: prepared.normalization}
      checkpoints.push(checkpoint)
      if (dependencies.writeCheckpoint) {
        try { await dependencies.writeCheckpoint(checkpoint) }
        catch {
          const error = errorFor(product, "checkpoint", "checkpoint_write_failed", "normalization checkpoint write failed", true)
          errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
          continue
        }
      }

      let outcome: PreparedProductWriteResult
      try {
        const results = await dependencies.writePrepared([prepared.prepared])
        if (results.length !== 1 || !isValidPreparedWriteResult(results[0], prepared.prepared.product.product_url)) throw new Error("invalid prepared writer result")
        outcome = results[0]
      } catch {
        const error = errorFor(product, "product_write", "prepared_rpc_failed", "prepared product write failed", true)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        continue
      }
      if (outcome.outcome === "inserted" || outcome.outcome === "updated" || outcome.outcome === "unchanged") {
        increment(report, counts, outcome.outcome)
      } else {
        const error = errorFor(product, "product_write", outcome.code ?? outcome.outcome, outcome.message ?? `product write ${outcome.outcome}`, false)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        continue
      }

      const collection = prepared.product.reviewCollection
      if (collection?.status === "partial" || collection?.status === "failed") {
        const error = errorFor(product, "reviews", "review_collection_incomplete", "requested review collection is incomplete", true)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
      } else if (collection?.status === "succeeded" && !reviewIsPublishable(prepared.product)) {
        const error = errorFor(product, "reviews", "review_provenance_invalid", "successful review collection lacks a publishable observation", false)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
      } else if (reviewIsPublishable(prepared.product) && !outcome.id) {
        const error = errorFor(product, "reviews", "product_id_missing", "product write did not return an ID for reviews", false)
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
      } else if (reviewIsPublishable(prepared.product) && outcome.id) {
        try {
          const review = await dependencies.replaceReviews({
            productId: outcome.id,
            observedAt: prepared.product.reviewCollection!.observedAt!,
            reviews: reviewRows(prepared.product),
          })
          if (!isValidReviewWriteResult(review, outcome.id, prepared.product.reviews?.length ?? 0)) throw new Error("invalid review writer result")
          if (review.outcome === "missing" || review.outcome === "stale") throw new Error(review.outcome)
        } catch {
          const error = errorFor(product, "reviews", "review_rpc_failed", "atomic review replacement failed", true)
          errors.push(error); addPipelineError(report, error); increment(report, counts, "failed")
        }
      }
    }

    let status: string = options.mode === "dry_run" ? "planned" : errors.length > 0
      ? ((counts.inserted + counts.updated + counts.unchanged) > 0 ? "partial" : "failed")
      : "success"
    if (options.mode === "apply" && dependencies.syncStatus) {
      try { await dependencies.syncStatus({platform: inputFile.platform, status: status === "success" ? "success" : "failed", counts}) }
      catch {
        const error: PipelineError = {stage: "status", code: "status_write_failed", message: "post-persist status write failed", retryable: true, platform: inputFile.platform}
        errors.push(error); addPipelineError(report, error); increment(report, counts, "failed"); status = (counts.inserted + counts.updated + counts.unchanged) > 0 ? "partial" : "failed"
      }
    }
    report.files.push({platform: inputFile.platform, file: inputFile.file, status, counts, errors})
  }
  return {report: finalizePipelineReport(report, {now: options.now?.()}), checkpoints}
}

/** Exhaust a stable id-ordered reader; any page error fails closed. */
export async function readStablePages<T extends {id: string}>(
  fetchPage: (afterId: string | null, limit: number) => Promise<T[]>,
  limit = 500,
): Promise<T[]> {
  const rows: T[] = []
  let afterId: string | null = null
  for (;;) {
    const page = await fetchPage(afterId, limit)
    if (page.length > limit) throw new Error("stable page reader returned more than the requested limit")
    if (page.length === 0) return rows
    for (const row of page) {
      if (!/^[1-9]\d*$/.test(row.id) || (afterId !== null && BigInt(row.id) <= BigInt(afterId))) {
        throw new Error("stable page IDs must be strictly increasing positive decimal strings")
      }
      rows.push(row)
      afterId = row.id
    }
    if (page.length < limit) return rows
  }
}

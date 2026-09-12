import {canonicalizePlatformBrand, resolveProductBrand} from "./brand-provenance"
import {isValidCategory, isValidSubcategory, type Category} from "./enums/product-enums"
import type {
  BrandResolution,
  NormalizationResult,
  PipelineError,
  PreparedProductRow,
  PreparedProductWrite,
} from "./pipeline-integrity-types"
import {sanitizeProductImageFields} from "./product-images"
import {
  buildQwenNormalizationPatch,
  needsQwenNormalization,
  qwenNormalizationInputHash,
  type ProductNormalizationInput,
} from "./product-qwen-normalization"
import {applyProductQcGate, filterOutOfScopeProducts} from "./product-qc/normalization"
import {isConfirmedPricing, toDbPriceFields} from "./product-pricing"
import type {Product, SiteConfig} from "./types"

export const DEFAULT_NORMALIZATION_POLICY_VERSION = "pipeline-integrity-v1"

export interface QwenNormalizationResponse {
  category: Category
  subcategory: string | null
  model: string
  completedAt?: string
}

export interface PrepareProductForImportInput {
  product: Product
  config: SiteConfig
  observedAt: string
  expectedUpdatedAt: string | null
  normalizationCheckpoint?: NormalizationResult | null
}

export interface PrepareProductForImportDependencies {
  resolveBrand(input: {brand: string; platform: string; config: SiteConfig}): BrandResolution | Promise<BrandResolution>
  normalize?: (input: ProductNormalizationInput) => Promise<unknown>
  recoverDetailPricing?: (product: Product) => Promise<Product>
  policyVersion?: string
  now?: () => string
}

export type PrepareProductForImportResult =
  | {status: "prepared"; prepared: PreparedProductWrite; product: Product; normalization: NormalizationResult; brandResolution: Extract<BrandResolution, {status: "existing"}>}
  | {status: "would_create"; brandResolution: Extract<BrandResolution, {status: "would_create"}>; product: Product; normalization: NormalizationResult}
  | {status: "quarantined"; brandResolution: Extract<BrandResolution, {status: "quarantined"}>}
  | {status: "policy_excluded"; code: "product_out_of_scope"; product: Product}
  | {status: "failed"; error: PipelineError; normalization?: NormalizationResult; brandResolution?: BrandResolution}

function failure(product: Product, stage: string, code: string, message: string, retryable: boolean): PrepareProductForImportResult {
  return {status: "failed", error: {stage, code, message, retryable, platform: product.platform, productUrl: product.productUrl}}
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
}

function checkpointReusable(
  checkpoint: NormalizationResult | null | undefined,
  hash: string,
  policy: string,
  normalizationInput: ProductNormalizationInput,
): checkpoint is NormalizationResult {
  return !!checkpoint && checkpoint.inputHash === hash && checkpoint.policyVersion === policy &&
    (checkpoint.status === "not_required" || checkpoint.status === "succeeded" || checkpoint.status === "unchanged") &&
    isIsoTimestamp(checkpoint.completedAt) &&
    (checkpoint.status === "not_required"
      ? checkpoint.model === null && !needsQwenNormalization(normalizationInput)
      : typeof checkpoint.model === "string" && checkpoint.model.trim() !== "") &&
    isValidCategory(checkpoint.category) &&
    (checkpoint.subcategory === null || isValidSubcategory(checkpoint.subcategory, checkpoint.category))
}

function validQwenResponse(value: unknown): value is QwenNormalizationResponse {
  if (!value || typeof value !== "object") return false
  const response = value as Record<string, unknown>
  return typeof response.category === "string" && isValidCategory(response.category) &&
    (response.subcategory === null || typeof response.subcategory === "string") &&
    typeof response.model === "string" && response.model.trim() !== "" &&
    (response.completedAt === undefined || isIsoTimestamp(response.completedAt))
}

export async function normalizeProductForImport(
  product: ProductNormalizationInput,
  checkpoint: NormalizationResult | null | undefined,
  dependencies: Pick<PrepareProductForImportDependencies, "normalize" | "policyVersion" | "now">,
): Promise<NormalizationResult> {
  const policy = dependencies.policyVersion ?? DEFAULT_NORMALIZATION_POLICY_VERSION
  const normalizationInput: ProductNormalizationInput = product
  const inputHash = qwenNormalizationInputHash(normalizationInput)
  if (checkpointReusable(checkpoint, inputHash, policy, normalizationInput)) return checkpoint
  const completedAt = dependencies.now?.() ?? new Date().toISOString()
  if (!needsQwenNormalization(normalizationInput)) {
    return {status: "not_required", inputHash, policyVersion: policy, model: null, completedAt,
      category: isValidCategory(product.category) ? product.category : "other", subcategory: product.subcategory ?? null}
  }
  if (!dependencies.normalize) {
    return {status: "failed", inputHash, policyVersion: policy, model: null, completedAt: null,
      category: product.category, subcategory: product.subcategory ?? null,
      error: {code: "normalizer_unavailable", message: "normalization dependency is unavailable", retryable: true}}
  }
  try {
    const response = await dependencies.normalize(normalizationInput)
    if (!validQwenResponse(response)) {
      return {status: "failed", inputHash, policyVersion: policy, model: null, completedAt: null,
        category: product.category, subcategory: product.subcategory ?? null,
        error: {code: "normalization_schema_failed", message: "normalization response failed schema validation", retryable: false}}
    }
    const patch = buildQwenNormalizationPatch(normalizationInput, response)
    return {status: patch ? "succeeded" : "unchanged", inputHash, policyVersion: policy,
      model: response.model, completedAt: response.completedAt ?? completedAt,
      category: patch?.category ?? (isValidCategory(product.category) ? product.category : "other"),
      subcategory: patch?.subcategory ?? product.subcategory ?? null}
  } catch {
    return {status: "failed", inputHash, policyVersion: policy, model: null, completedAt: null,
      category: product.category, subcategory: product.subcategory ?? null,
      error: {code: "normalization_failed", message: "normalization dependency failed", retryable: true}}
  }
}

export async function prepareProductForImport(
  input: PrepareProductForImportInput,
  dependencies: PrepareProductForImportDependencies,
): Promise<PrepareProductForImportResult> {
  let product = {...input.product}
  if (!isIsoTimestamp(input.observedAt)) return failure(product, "validation", "observed_at_invalid", "observedAt must be an ISO timestamp", false)
  if (input.expectedUpdatedAt !== null && !isIsoTimestamp(input.expectedUpdatedAt)) {
    return failure(product, "validation", "expected_updated_at_invalid", "expectedUpdatedAt must be an ISO timestamp or null", false)
  }
  if (!isConfirmedPricing(product) && input.config.type === "cafe24") {
    if (!dependencies.recoverDetailPricing) return failure(product, "pricing", "detail_pricing_required", "Cafe24 price requires detail recovery", true)
    try { product = await dependencies.recoverDetailPricing(product) }
    catch { return failure(product, "pricing", "detail_pricing_failed", "detail pricing recovery failed", true) }
  }
  if (!isConfirmedPricing(product)) return failure(product, "pricing", "pricing_unverified", "confirmed pricing v2 is required", true)

  const qcOptions = {
    trustedCategory: input.config.type === "shopify" || input.config.trustedCategory === true,
    verifiedUnisexDefault: input.config.verifiedUnisexDefault,
    genderTextPatterns: input.config.genderTextPatterns,
    kidsGenderNoisePatterns: input.config.kidsGenderNoisePatterns,
    outOfScopeCategories: input.config.outOfScopeCategories,
  }
  if (filterOutOfScopeProducts([product], qcOptions).length === 0) {
    return {status: "policy_excluded", code: "product_out_of_scope", product}
  }
  const canonicalized = applyProductQcGate([product], input.config.key, {
    ...qcOptions,
    excludeOutOfScope: true,
    recordReport: false,
  })
  if (canonicalized.length !== 1) return failure(product, "validation", "product_validation_failed", "product failed initial taxonomy validation", false)
  product = canonicalized[0]

  const houseBrand = resolveProductBrand(product.brand, input.config)
  const canonicalBrand = canonicalizePlatformBrand(houseBrand, input.config.key)
  if (!canonicalBrand) return failure(product, "brand", "brand_missing", "product brand is missing", false)
  let brandResolution: BrandResolution
  try {
    brandResolution = await dependencies.resolveBrand({brand: canonicalBrand, platform: input.config.key, config: input.config})
  } catch {
    return failure(product, "brand", "brand_resolution_failed", "brand resolution failed", true)
  }
  if (!brandResolution || typeof brandResolution.brand !== "string" || !brandResolution.brand.trim()) {
    return failure(product, "brand", "brand_resolution_invalid", "brand resolution is invalid", false)
  }
  if (brandResolution.status === "quarantined") return {status: "quarantined", brandResolution}
  if (brandResolution.status !== "existing" && brandResolution.status !== "would_create") {
    return failure(product, "brand", "brand_resolution_invalid", "brand resolution status is invalid", false)
  }
  if (brandResolution.status === "existing" && !/^[1-9]\d*$/.test(brandResolution.brandNodeId)) {
    return failure(product, "brand", "brand_node_id_invalid", "existing brand node ID must be a positive decimal string", false)
  }

  product.brand = brandResolution.brand
  const normalization = await normalizeProductForImport({
    productUrl: product.productUrl,
    name: product.name,
    brand: product.brand,
    category: product.category,
    subcategory: product.subcategory,
    tags: product.tags,
  }, input.normalizationCheckpoint, dependencies)
  if (normalization.status === "failed") {
    return {
      status: "failed",
      error: {
        stage: "normalization",
        code: normalization.error?.code ?? "normalization_failed",
        message: normalization.error?.message ?? "normalization failed",
        retryable: normalization.error?.retryable ?? true,
        platform: product.platform,
        productUrl: product.productUrl,
      },
      normalization,
      brandResolution,
    }
  }
  product.category = normalization.category
  product.subcategory = normalization.subcategory ?? undefined
  product.normalization = normalization

  const accepted = applyProductQcGate([product], input.config.key, {
    trustedCategory: true, verifiedUnisexDefault: input.config.verifiedUnisexDefault,
    genderTextPatterns: input.config.genderTextPatterns, kidsGenderNoisePatterns: input.config.kidsGenderNoisePatterns,
    outOfScopeCategories: input.config.outOfScopeCategories, excludeOutOfScope: true, recordReport: false,
  })
  if (accepted.length !== 1) return failure(product, "validation", "product_validation_failed", "product failed final taxonomy validation", false)
  product = accepted[0]
  if (product.category !== normalization.category || (product.subcategory ?? null) !== normalization.subcategory) {
    return failure(product, "normalization", "normalization_result_changed", "final validation changed normalization output", false)
  }
  if (product.gender.length !== 1) return failure(product, "validation", "gender_unverified", "exactly one verified gender is required", false)

  const images = sanitizeProductImageFields({productUrl: product.productUrl, imageUrl: product.imageUrl, sourceImageUrl: product.sourceImageUrl, images: product.images})
  if (!images) return failure(product, "validation", "image_missing", "representative image is required", false)
  product = {...product, ...images}
  const prices = toDbPriceFields(product, product.sourceCurrency ?? input.config.sourceCurrency ?? "KRW", {requireConfirmed: true})
  if (!prices) return failure(product, "pricing", "pricing_invalid", "confirmed pricing is incoherent", false)

  if (brandResolution.status === "would_create") {
    return {status: "would_create", brandResolution, product, normalization}
  }

  const category = product.category as Category
  const row: PreparedProductRow = {
    brand: brandResolution.brand, name: product.name, category,
    subcategory: product.subcategory && isValidSubcategory(product.subcategory, category) ? product.subcategory : null,
    ...prices, product_url: product.productUrl, image_url: product.imageUrl,
    source_image_url: product.sourceImageUrl ?? product.imageUrl, images: product.images ?? null,
    in_stock: product.inStock, platform: input.config.key, brand_node_id: brandResolution.brandNodeId,
    gender: product.gender, gender_source: product.genderSource ?? null, crawled_at: input.observedAt,
    tags: product.tags?.slice(0, 50) ?? null, size_info: product.sizeInfo?.slice(0, 2000) ?? null,
    product_code: product.productCode?.slice(0, 100) ?? null,
  }
  const prepared: PreparedProductWrite = {
    product: row,
    normalization: {status: normalization.status, input_hash: normalization.inputHash,
      policy_version: normalization.policyVersion, model: normalization.model, completed_at: normalization.completedAt},
    pricing_observation: product.pricingObservation as PreparedProductWrite["pricing_observation"],
    observed_at: input.observedAt, expected_updated_at: input.expectedUpdatedAt,
  }
  return {status: "prepared", prepared, product, normalization, brandResolution}
}

import type {ImageCandidateAnalysis, ImageSelectionKind} from "./product-image-selection"
import type {ProductImageCandidateTiming} from "./select-product-image"
import type {ProductImageCvTiming} from "./product-image-vision-win"

export interface ProductImageCanaryRow {
  id: number
  platform: string
  platformType: string
  category: string
  productUrl: string
  imageUrl: string
  sourceImageUrl?: string
  images: string[]
  imageCollectionVersion?: string
}

export interface ProductImageCanaryManifest {
  schemaVersion: 1
  generatedAt: string
  rows: ProductImageCanaryRow[]
}

export interface ProductImageCanaryProductResult {
  id: number
  platform: string
  platformType: string
  category: string
  productUrl: string
  beforeUrl: string
  selectedUrl: string
  kind: ImageSelectionKind
  score: number
  errors: string[]
  candidates: ImageCandidateAnalysis[]
  wallMs: number
}

export interface ProductImageCanaryRun {
  schemaVersion: 1
  backend: "linux-cv" | "apple-vision"
  generatedAt: string
  concurrency: number
  ocrWorkers: number | null
  products: ProductImageCanaryProductResult[]
  candidateTimings: ProductImageCandidateTiming[]
  cvTimings: ProductImageCvTiming[]
  metrics: {
    wallMs: number
    cpuMs: number
    peakRssBytes: number
    peakLoad1: number
  }
}

export type ProductImageReviewVerdict =
  | "acceptable"
  | "linux_better"
  | "wrong_non_model"
  | "severe_utility"
  | "severe_broken"

export interface ProductImageManualReview {
  productId: number
  verdict: ProductImageReviewVerdict
  note?: string
}

function imageCountBucket(count: number): string {
  if (count <= 1) return "1"
  if (count <= 4) return "2-4"
  if (count <= 8) return "5-8"
  return "9+"
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic round-robin across platform type, category, and image-count strata. */
export function stratifiedProductImageSample(
  rows: ProductImageCanaryRow[],
  limit: number,
): ProductImageCanaryRow[] {
  const groups = new Map<string, ProductImageCanaryRow[]>()
  for (const row of rows) {
    const key = `${row.platformType}|${row.category}|${imageCountBucket(row.images.length)}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const orderedGroups = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group.sort((a, b) => stableHash(String(a.id)) - stableHash(String(b.id))))
  const sampled: ProductImageCanaryRow[] = []
  for (let offset = 0; sampled.length < limit; offset++) {
    let added = false
    for (const group of orderedGroups) {
      const row = group[offset]
      if (!row) continue
      sampled.push(row)
      added = true
      if (sampled.length >= limit) break
    }
    if (!added) break
  }
  return sampled
}

function selectedAnalysis(result: ProductImageCanaryProductResult): ImageCandidateAnalysis | null {
  return result.candidates.find((candidate) => candidate.url === result.selectedUrl) ?? null
}

export function compareProductImageCanaryRuns(
  linux: ProductImageCanaryRun,
  apple: ProductImageCanaryRun,
  reviews: ProductImageManualReview[] = [],
) {
  const appleById = new Map(apple.products.map((row) => [row.id, row]))
  const reviewById = new Map(reviews.map((row) => [row.productId, row]))
  const pairs = linux.products.flatMap((linuxRow) => {
    const appleRow = appleById.get(linuxRow.id)
    if (!appleRow) return []
    const analysis = selectedAnalysis(linuxRow)
    return [{
      id: linuxRow.id,
      platform: linuxRow.platform,
      category: linuxRow.category,
      productUrl: linuxRow.productUrl,
      linuxUrl: linuxRow.selectedUrl,
      appleUrl: appleRow.selectedUrl,
      linuxKind: linuxRow.kind,
      appleKind: appleRow.kind,
      agreement: linuxRow.selectedUrl === appleRow.selectedUrl,
      automatedUtility: analysis?.isUtility === true,
      automatedBroken: !analysis?.decoded,
      automatedSevere: !analysis?.decoded || analysis.isUtility,
      review: reviewById.get(linuxRow.id) ?? null,
    }]
  })
  const appleModel = pairs.filter((row) => row.appleKind === "model")
  const reviewed = pairs.filter((row) => row.review)
  const disagreements = pairs.filter((row) => !row.agreement)
  const automatedUtility = pairs.filter((row) => row.automatedUtility)
  const automatedBroken = pairs.filter((row) => row.automatedBroken)
  const manuallySevere = reviewed.filter((row) =>
    row.review?.verdict === "severe_utility" || row.review?.verdict === "severe_broken")
  const reviewedDifferences = disagreements.filter((row) => row.review)
  const reviewComplete = disagreements.every((row) => row.review)
  return {
    compared: pairs.length,
    agreementCount: pairs.filter((row) => row.agreement).length,
    agreementRate: pairs.length ? pairs.filter((row) => row.agreement).length / pairs.length : 0,
    appleModelCount: appleModel.length,
    linuxModelWhenAppleModelCount: appleModel.filter((row) => row.linuxKind === "model").length,
    modelShotSelectionRate: appleModel.length
      ? appleModel.filter((row) => row.linuxKind === "model").length / appleModel.length
      : 0,
    automatedSevereCount: pairs.filter((row) => row.automatedSevere).length,
    automatedSevereRate: pairs.length
      ? pairs.filter((row) => row.automatedSevere).length / pairs.length
      : 0,
    automatedUtilityCount: automatedUtility.length,
    automatedUtilityRate: pairs.length ? automatedUtility.length / pairs.length : 0,
    automatedBrokenCount: automatedBroken.length,
    automatedBrokenRate: pairs.length ? automatedBroken.length / pairs.length : 0,
    reviewedCount: reviewed.length,
    disagreementCount: disagreements.length,
    reviewedDifferenceCount: reviewedDifferences.length,
    reviewComplete,
    acceptableDifferentCount: reviewed.filter((row) =>
      !row.agreement && ["acceptable", "linux_better"].includes(row.review!.verdict)
    ).length,
    acceptableDifferentRate: reviewedDifferences.length
      ? reviewedDifferences.filter((row) => ["acceptable", "linux_better"].includes(row.review!.verdict)).length /
        reviewedDifferences.length
      : null,
    manuallyUtilityCount: reviewed.filter((row) => row.review?.verdict === "severe_utility").length,
    manuallyBrokenCount: reviewed.filter((row) => row.review?.verdict === "severe_broken").length,
    manuallySevereCount: manuallySevere.length,
    manuallySevereRate: reviewComplete && pairs.length ? manuallySevere.length / pairs.length : null,
    passesSevereThreshold:
      pairs.length > 0 &&
      reviewComplete &&
      pairs.filter((row) => row.automatedSevere).length / pairs.length < 0.01 &&
      manuallySevere.length / pairs.length < 0.01,
    pairs,
  }
}

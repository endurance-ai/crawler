/** 휴면 — 모델컷 선별(macOS 전용). 배선·제약은 `src/select-product-images.ts` 헤더 참조. */
import {collectProductImagesFromHtml} from "./product-images"

export const IMAGE_SELECTION_VERSION = "mac-vision-v2"
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export type ImageSelectionKind = "model" | "product" | "fallback"

export interface ProductImageSelection {
  kind: ImageSelectionKind
  score: number
  version: string
  candidateCount: number
  selectedAt: string
}

export interface ImageCandidateAnalysis {
  url: string
  width: number
  height: number
  byteLength: number
  mimeType: string
  decoded: boolean
  isAnimated: boolean
  isUtility: boolean
  /** Apple Vision score in the documented -1...1 range. */
  aestheticsScore: number
  /** Fraction of the image covered by recognized text, 0...1. */
  textCoverage: number
  /** Highest human rectangle/body-pose confidence, 0...1. */
  humanConfidence: number
  /** Largest detected human rectangle area divided by image area, 0...1. */
  humanAreaRatio: number
  /** Distance from human center to image center, normalized to 0...1. */
  humanCenterDistance: number
  /** Body joints with confidence >= 0.3. */
  poseJointCount: number
  /** Salient foreground area divided by image area, 0...1. */
  foregroundAreaRatio: number
  /** Distance from salient foreground center to image center, 0...1. */
  foregroundCenterDistance: number
}

export interface RankedImageSelection {
  selected: ImageCandidateAnalysis
  ordered: ImageCandidateAnalysis[]
  kind: ImageSelectionKind
  score: number
}

interface ImageReselectionInput {
  productUrl: string
  imageUrl: string
  sourceImageUrl?: string
  images?: string[]
  imageSelection?: {
    version: string
    candidateCount: number
  }
}

/**
 * A matching selector version is only current for the candidate set it saw.
 * Image collection can append richer gallery images after selection, so
 * candidate growth must make the product eligible again.
 */
export function needsImageReselection(product: ImageReselectionInput): boolean {
  const selection = product.imageSelection
  if (!selection || selection.version !== IMAGE_SELECTION_VERSION) return true

  const knownCandidates = collectImageCandidatesFromHtml("", product.productUrl, [
    product.sourceImageUrl,
    product.imageUrl,
    ...(product.images ?? []),
  ].filter((url): url is string => typeof url === "string" && url.length > 0))
  const selectedCandidateCount = Number.isFinite(selection.candidateCount)
    ? Math.max(0, selection.candidateCount)
    : 0
  return knownCandidates.length > selectedCandidateCount
}

/**
 * Extract image candidates without executing page JavaScript.
 *
 * Existing candidates are deliberately first so a failed enrichment never
 * loses the crawler's current representative. Structured product images then
 * precede DOM images; within srcset, the highest declared resolution wins.
 */
export function collectImageCandidatesFromHtml(
  html: string,
  pageUrl: string,
  existing: string[] = [],
): string[] {
  return collectProductImagesFromHtml(html, pageUrl, existing)
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function centeredTarget(value: number, target: number): number {
  return clamp(1 - Math.abs(value - target) / Math.max(target, 0.01))
}

function baseEligible(item: ImageCandidateAnalysis): boolean {
  if (!item.decoded || item.isAnimated || item.isUtility) return false
  if (item.byteLength <= 0 || item.byteLength > MAX_IMAGE_BYTES) return false
  if (item.width <= 0 || item.height <= 0 || Math.min(item.width, item.height) < 320) return false
  const aspect = item.width / item.height
  return aspect >= 0.4 && aspect <= 1.8
}

function isEligibleModel(item: ImageCandidateAnalysis): boolean {
  return (
    baseEligible(item) &&
    Math.min(item.width, item.height) >= 480 &&
    item.aestheticsScore > -0.6 &&
    item.humanConfidence >= 0.55 &&
    item.humanAreaRatio >= 0.2 &&
    item.humanAreaRatio <= 0.9 &&
    item.poseJointCount >= 5
  )
}

function qualityScore(item: ImageCandidateAnalysis, kind: Exclude<ImageSelectionKind, "fallback">): number {
  const shortEdge = Math.min(item.width, item.height)
  const resolution = clamp((shortEdge - 320) / (1600 - 320)) * 15
  const aspect = item.width / item.height
  const cropFit = clamp(1 - Math.abs(aspect - 0.75) / 0.75) * 20
  const aesthetics = clamp((item.aestheticsScore + 1) / 2) * 20
  const area = kind === "model" ? item.humanAreaRatio : item.foregroundAreaRatio
  const prominence = centeredTarget(area, kind === "model" ? 0.55 : 0.6) * 35
  const centerDistance =
    kind === "model" ? item.humanCenterDistance : item.foregroundCenterDistance
  const centrality = clamp(1 - centerDistance) * 10
  const textPenalty = clamp((item.textCoverage - 0.08) / 0.42) * 30
  return Math.round(clamp(resolution + cropFit + aesthetics + prominence + centrality - textPenalty, 0, 100) * 100) / 100
}

/**
 * Lexicographic policy: eligible model shots always precede product-only
 * candidates. A broken/utility candidate can never replace the current URL.
 */
export function rankImageCandidates(
  items: ImageCandidateAnalysis[],
  currentUrl: string,
): RankedImageSelection {
  if (items.length === 0) throw new Error("rankImageCandidates requires at least one candidate")
  const decorated = items.map((item, index) => {
    const kind: ImageSelectionKind = isEligibleModel(item)
      ? "model"
      : baseEligible(item)
        ? "product"
        : "fallback"
    const score = kind === "fallback" ? 0 : qualityScore(item, kind)
    const tier = kind === "model" ? 2 : kind === "product" ? 1 : 0
    return {item, index, kind, score, tier}
  })

  decorated.sort((a, b) => b.tier - a.tier || b.score - a.score || a.index - b.index)
  const best = decorated[0]
  if (best.tier > 0) {
    return {
      selected: best.item,
      ordered: decorated.map((entry) => entry.item),
      kind: best.kind,
      score: best.score,
    }
  }

  const current = items.find((item) => item.url === currentUrl) ?? items[0]
  return {
    selected: current,
    ordered: [current, ...items.filter((item) => item !== current)],
    kind: "fallback",
    score: 0,
  }
}

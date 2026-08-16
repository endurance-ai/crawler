/** 휴면 — 모델컷 선별(macOS 전용). 배선·제약은 `src/select-product-images.ts` 헤더 참조. */
import {extractStructuredProduct} from "./parsers/structured-data"
import {normalizeProductImageUrl} from "./product-images"

export const IMAGE_SELECTION_VERSION = "mac-vision-v1"
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const IMAGE_EXT_RE = /\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:$|[?#])/i
const PRODUCT_IMAGE_HINT_RE =
  /(?:product|prd|gallery|thumb|zoom|swiper|slick|goods|item[-_ ]?image|detail[-_ ]?image)/i

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

function safeImageUrl(raw: string, pageUrl: string): string | null {
  return normalizeProductImageUrl(raw, pageUrl)
}

function attr(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const quoted = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(tag)
  if (quoted) return quoted[2]
  return new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*([^\\s>]+)`, "i").exec(tag)?.[1] ?? null
}

function srcsetCandidates(value: string): Array<{url: string; width: number}> {
  return value
    .split(",")
    .map((part) => {
      const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i)
      if (!match) return null
      const numeric = Number(match[2] ?? 0)
      const width = match[3]?.toLowerCase() === "x" ? numeric * 1000 : numeric
      return {url: match[1], width: Number.isFinite(width) ? width : 0}
    })
    .filter((item): item is {url: string; width: number} => item !== null)
    .sort((a, b) => b.width - a.width)
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
  const candidates: string[] = []
  const seen = new Set<string>()
  const add = (raw: string | null | undefined): void => {
    if (!raw) return
    const normalized = safeImageUrl(raw, pageUrl)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(normalized)
  }

  for (const url of existing) add(url)

  const structured = extractStructuredProduct(html)
  for (const url of structured?.images ?? []) add(url)

  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])
  const orderedTags = [
    ...imageTags.filter((tag) => PRODUCT_IMAGE_HINT_RE.test(tag)),
    ...imageTags.filter((tag) => !PRODUCT_IMAGE_HINT_RE.test(tag)),
  ]
  for (const tag of orderedTags) {
    for (const name of ["srcset", "data-srcset"]) {
      const value = attr(tag, name)
      if (value) {
        for (const item of srcsetCandidates(value)) add(item.url)
      }
    }
    for (const name of [
      "data-zoom-image",
      "data-origin",
      "data-original",
      "data-lazy-src",
      "data-src",
      "src",
    ]) {
      add(attr(tag, name))
    }
  }

  // Some galleries expose direct image anchors instead of img elements.
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    if (IMAGE_EXT_RE.test(match[2])) add(match[2])
  }

  return candidates
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

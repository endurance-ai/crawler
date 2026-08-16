/** 휴면 — 모델컷 선별(macOS 전용). 배선·제약은 `src/select-product-images.ts` 헤더 참조. */
import * as fs from "node:fs/promises"
import * as path from "node:path"

import type {Product} from "./types"
import {
  collectImageCandidatesFromHtml,
  IMAGE_SELECTION_VERSION,
  rankImageCandidates,
  type ImageCandidateAnalysis,
  type ImageSelectionKind,
} from "./product-image-selection"
import {ProductImageAnalysisCache} from "./product-image-analysis-cache"
import {ProductImageVisionClient} from "./product-image-vision-client"
import {downloadRemoteImage, fetchProductHtml} from "./safe-remote-image"

export interface ProductImageSelectionResult {
  product: Product
  beforeUrl: string
  afterUrl: string
  kind: ImageSelectionKind
  score: number
  candidates: ImageCandidateAnalysis[]
  detailEnriched: boolean
  errors: string[]
}

function failedAnalysis(url: string): ImageCandidateAnalysis {
  return {
    url,
    width: 0,
    height: 0,
    byteLength: 0,
    mimeType: "application/octet-stream",
    decoded: false,
    isAnimated: false,
    isUtility: false,
    aestheticsScore: -1,
    textCoverage: 0,
    humanConfidence: 0,
    humanAreaRatio: 0,
    humanCenterDistance: 1,
    poseJointCount: 0,
    foregroundAreaRatio: 0,
    foregroundCenterDistance: 1,
  }
}

export class LocalProductImageSelector {
  readonly #cache: ProductImageAnalysisCache
  readonly #vision: ProductImageVisionClient
  readonly #tempDir: string
  readonly #globalSlots = new Semaphore(8)
  readonly #hostSlots = new Map<string, Semaphore>()

  constructor(cacheDir: string) {
    this.#cache = new ProductImageAnalysisCache(cacheDir)
    this.#vision = new ProductImageVisionClient(cacheDir)
    this.#tempDir = path.join(cacheDir, "tmp")
  }

  async #analyze(url: string, force: boolean): Promise<{analysis: ImageCandidateAnalysis; error?: string}> {
    if (!force) {
      const cached = this.#cache.get(url)
      if (cached) return {analysis: cached}
    }

    const host = (() => {
      try {
        return new URL(url).hostname
      } catch {
        return "invalid"
      }
    })()
    const hostSlot = this.#hostSlots.get(host) ?? new Semaphore(2)
    this.#hostSlots.set(host, hostSlot)
    return this.#globalSlots.run(() =>
      hostSlot.run(async () => {
        let downloaded: Awaited<ReturnType<typeof downloadRemoteImage>> | null = null
        try {
          downloaded = await downloadRemoteImage(url, this.#tempDir)
          const analysis = await this.#vision.analyze({
            path: downloaded.path,
            url,
            byteLength: downloaded.byteLength,
            mimeType: downloaded.mimeType,
          })
          this.#cache.put(analysis)
          return {analysis}
        } catch (error) {
          return {
            analysis: failedAnalysis(url),
            error: error instanceof Error ? error.message : String(error),
          }
        } finally {
          if (downloaded) await fs.unlink(downloaded.path).catch(() => {})
        }
      }),
    )
  }

  async select(
    product: Product,
    options: {
      force?: boolean
      enrichDetail?: boolean
      renderDetail?: (url: string) => Promise<string>
    } = {},
  ): Promise<ProductImageSelectionResult> {
    const beforeUrl = product.imageUrl
    const sourceImageUrl = product.sourceImageUrl || beforeUrl
    const existing = [
      sourceImageUrl,
      beforeUrl,
      ...(Array.isArray(product.images) ? product.images : []),
    ].filter((url): url is string => typeof url === "string" && url.length > 0)

    let urls = collectImageCandidatesFromHtml("", product.productUrl, existing)
    let detailEnriched = false
    const errors: string[] = []
    if (options.enrichDetail !== false && urls.length < 2) {
      try {
        const html = await fetchProductHtml(product.productUrl)
        urls = collectImageCandidatesFromHtml(html, product.productUrl, existing)
        detailEnriched = true
      } catch (error) {
        errors.push(`detail: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (urls.length < 2 && options.renderDetail) {
        try {
          const rendered = await options.renderDetail(product.productUrl)
          urls = collectImageCandidatesFromHtml(rendered, product.productUrl, urls)
          detailEnriched = true
        } catch (error) {
          errors.push(`rendered detail: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    if (urls.length === 0) {
      // Preserve the empty legacy shape while still producing deterministic
      // selection metadata. Import QC can then report it as a fallback.
      urls = [beforeUrl].filter(Boolean)
    }
    if (urls.length === 0) {
      throw new Error(`product has no image candidate: ${product.productUrl}`)
    }

    const analyzed = await Promise.all(urls.map((url) => this.#analyze(url, options.force === true)))
    for (const item of analyzed) {
      if (item.error) errors.push(`${item.analysis.url}: ${item.error}`)
    }
    const candidates = analyzed.map((item) => item.analysis)
    const ranked = rankImageCandidates(candidates, beforeUrl)
    const selectedAt = new Date().toISOString()
    const selectedSourceImageUrl = urls.includes(sourceImageUrl) ? sourceImageUrl : ranked.selected.url
    const updated: Product = {
      ...product,
      sourceImageUrl: selectedSourceImageUrl,
      imageUrl: ranked.selected.url,
      images: ranked.ordered.map((item) => item.url),
      imageSelection: {
        kind: ranked.kind,
        score: ranked.score,
        version: IMAGE_SELECTION_VERSION,
        candidateCount: candidates.length,
        selectedAt,
      },
    }
    return {
      product: updated,
      beforeUrl,
      afterUrl: ranked.selected.url,
      kind: ranked.kind,
      score: ranked.score,
      candidates,
      detailEnriched,
      errors,
    }
  }

  async close(): Promise<void> {
    await this.#vision.close()
    this.#cache.close()
  }
}

class Semaphore {
  readonly #limit: number
  #active = 0
  readonly #waiting: Array<() => void> = []

  constructor(limit: number) {
    this.#limit = limit
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve))
    }
    this.#active += 1
    try {
      return await work()
    } finally {
      this.#active -= 1
      this.#waiting.shift()?.()
    }
  }
}

/**
 * Composite review parser — Board → Inline 폴백 체인
 *
 * Board 파서를 먼저 시도하고, 리뷰가 없으면 원래 URL로 돌아가서 Inline을 시도한다.
 */

import type {Cafe24Page} from "../../cafe24-page"
import type {IReviewParser, ReviewData} from "./types"
import {BoardReviewParser} from "./board-review-parser"
import {InlineReviewParser} from "./inline-review-parser"

export class CompositeReviewParser implements IReviewParser {
  private strategies: IReviewParser[]

  constructor(strategies?: IReviewParser[]) {
    this.strategies = strategies || [
      new BoardReviewParser(),
      new InlineReviewParser(),
    ]
  }

  async parse(page: Cafe24Page, maxReviews: number): Promise<ReviewData> {
    const currentUrl = page.url()
    let partial: ReviewData | null = null
    const errors: string[] = []

    for (const strategy of this.strategies) {
      if (page.url() !== currentUrl) {
        await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 15000 })
        await page.waitForTimeout(1000)
      }

      try {
        const result = await strategy.parse(page, maxReviews)
        if (result.reviewCollection.status === "succeeded" || result.reviewCollection.status === "not_requested") return result
        if (result.reviewCollection.status === "partial" && !partial) partial = result
        if (result.reviewCollection.error) errors.push(result.reviewCollection.error)
      } catch {
        errors.push("review strategy failed")
      }
    }

    if (partial) return partial
    return {
      reviewCount: 0,
      reviews: [],
      reviewCollection: {
        status: "failed",
        observedAt: null,
        confirmedEmpty: false,
        error: errors.join("; ") || "no review strategy succeeded",
      },
    }
  }
}

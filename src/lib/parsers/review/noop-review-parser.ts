import type {Cafe24Page} from "../../cafe24-page"
import type {IReviewParser, ReviewData} from "./types"

/**
 * 리뷰가 없는 플랫폼용 no-op 파서
 *
 * 불필요한 페이지 탐색을 건너뛴다.
 */
export class NoopReviewParser implements IReviewParser {
  async parse(_page: Cafe24Page, _maxReviews: number): Promise<ReviewData> {
    return { reviewCount: 0, reviews: [] }
  }
}

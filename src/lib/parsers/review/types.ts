import type {Cafe24Page} from "../../cafe24-page"
import type {ReviewCollection} from "../../pipeline-integrity-types"

export interface ReviewerBody {
  height: string | null
  weight: string | null
  usualSize: string | null
  purchasedSize: string | null
  bodyType: string | null
}

export interface Review {
  text: string
  author: string | null
  date: string | null
  photoUrls: string[]
  body: ReviewerBody | null
}

export interface ReviewData {
  reviewCount: number
  reviews: Review[]
  reviewCollection: ReviewCollection
}

export interface IReviewParser {
  parse(page: Cafe24Page, maxReviews: number): Promise<ReviewData>
}

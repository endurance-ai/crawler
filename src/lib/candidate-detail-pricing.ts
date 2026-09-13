import {applyCafe24DetailFallbacks, extractCafe24DetailFallbacks} from "./cafe24-chain"
import type {Cafe24Page} from "./cafe24-page"
import type {Product} from "./types"

/** Recover a confirmed Cafe24 price from a detail page without mutating the caller's snapshot. */
export async function recoverCafe24CandidateDetailPricing(
  product: Product,
  page: Cafe24Page,
  now: () => string = () => new Date().toISOString(),
): Promise<Product> {
  const recovered = {...product}
  const detail = await extractCafe24DetailFallbacks(page)
  applyCafe24DetailFallbacks(recovered, detail)
  recovered.detailFetchedAt = now()
  return recovered
}

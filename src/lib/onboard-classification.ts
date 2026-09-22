import {isValidCategory, isValidSubcategory, type Category} from "./enums/product-enums"
import {inferCategoryFromText} from "./product-qc/normalization"
import {classifyShopifyCategory} from "./shopify-category-classifier"

const FASHION_NOUN = /jacket|coat|pant|trouser|short|tee|shirt|top|knit|sweat|hoodie|cardigan|blouse|dress|skirt|bag|hat|cap|belt|scarf|sock|shoe|sneaker|boot|loafer|sandal|jean|denim|vest|blazer|parka|jersey|ring|necklace|earring|bracelet|jewelry|jewellery|watch|glasses|sunglasses|셔츠|팬츠|자켓|재킷|코트|니트|맨투맨|후드|원피스|스커트|가방|모자|바지|티셔츠|반지|목걸이|귀걸이|팔찌|주얼리|안경/i

export interface OnboardClassificationRow {
  category?: unknown
  subcategory?: unknown
  raw_category?: unknown
  name?: unknown
  tags?: unknown
}

/** A review signal only; callers must not discard a whole brand from this heuristic. */
export function hasSuspiciousShortNames(rows: readonly OnboardClassificationRow[]): boolean {
  if (rows.length < 3) return false
  const suspicious = rows.filter((row) => {
    const name = String(row.name ?? "").trim()
    return name.split(/\s+/).length <= 2 && !FASHION_NOUN.test(name)
  }).length
  return suspicious / rows.length >= 0.6
}

export function validSourceSubcategory(
  row: OnboardClassificationRow,
  category: Category,
): string | null {
  const value = typeof row.subcategory === "string" ? row.subcategory.trim() : ""
  return value && isValidSubcategory(value, category) ? value : null
}

export function classifyOnboardProduct(row: OnboardClassificationRow): {
  category: Category
  subcategory: string | null
} {
  const existing = String(row.category ?? "").toLowerCase().trim()
  if (isValidCategory(existing)) {
    const category = existing as Category
    return {category, subcategory: validSourceSubcategory(row, category)}
  }

  const predicted = classifyShopifyCategory(
    String(row.raw_category ?? row.category ?? ""),
    String(row.name ?? ""),
    Array.isArray(row.tags) ? row.tags.map(String) : [],
  )
  const category = predicted.category && isValidCategory(predicted.category)
    ? predicted.category as Category
    : inferCategoryFromText(String(row.name ?? "")) ?? "other"
  return {
    category,
    subcategory: predicted.subcategory && isValidSubcategory(predicted.subcategory, category)
      ? predicted.subcategory
      : null,
  }
}

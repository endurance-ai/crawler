import {createHash} from "node:crypto"

import {z} from "zod"

import {
  CATEGORIES,
  buildSubcategoryReference,
  isValidCategory,
  isValidSubcategory,
  type Category,
} from "./enums/product-enums"
import {generateQwenObject, type QwenObjectResult} from "./qwen-client"

const ProductNormalizationSchema = z.object({
  category: z.enum(CATEGORIES),
  subcategory: z.string().nullable(),
})

const SYSTEM = `Classify one fashion product into the canonical taxonomy.
category must be exactly one of: ${CATEGORIES.join(", ")}.
subcategory must belong to the selected category below, or be null:
${buildSubcategoryReference()}
Do not invent facts. Return only JSON matching the schema.`

export interface ProductNormalizationInput {
  productUrl: string
  name: string
  brand: string
  category: string
  subcategory?: string | null
  tags?: string[] | null
}

export interface ProductNormalizationPatch {
  category: Category
  subcategory: string | null
}

export function needsQwenNormalization(product: ProductNormalizationInput): boolean {
  return product.category === "other" ||
    (isValidCategory(product.category) && !product.subcategory)
}

export function buildQwenNormalizationPatch(
  product: ProductNormalizationInput,
  prediction: z.infer<typeof ProductNormalizationSchema>,
): ProductNormalizationPatch | null {
  if (!isValidCategory(prediction.category)) return null
  const predictedSubcategory = prediction.subcategory?.trim() || null
  const validSubcategory = predictedSubcategory &&
    isValidSubcategory(predictedSubcategory, prediction.category)
    ? predictedSubcategory
    : null

  if (product.category === "other") {
    // A valid response is not necessarily an enrichment. Preserve other/null
    // without counting a no-op DB update as a Qwen success.
    if (prediction.category === "other") return null
    return {category: prediction.category, subcategory: validSubcategory}
  }

  if (!isValidCategory(product.category) || prediction.category !== product.category) return null
  if (product.subcategory || !validSubcategory) return null
  return {category: product.category, subcategory: validSubcategory}
}

export function qwenNormalizationInputHash(product: ProductNormalizationInput): string {
  const canonical = JSON.stringify({
    name: product.name.trim(),
    brand: product.brand.trim(),
    category: product.category,
    subcategory: product.subcategory ?? null,
    tags: (product.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

export async function classifyProductWithQwen(
  product: ProductNormalizationInput,
): Promise<QwenObjectResult<z.infer<typeof ProductNormalizationSchema>>> {
  return generateQwenObject({
    schema: ProductNormalizationSchema,
    system: SYSTEM,
    prompt: JSON.stringify({
      name: product.name,
      brand: product.brand,
      currentCategory: product.category,
      currentSubcategory: product.subcategory,
      tags: product.tags ?? [],
    }),
  })
}

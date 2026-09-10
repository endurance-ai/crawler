import {z} from "zod"

export const PRODUCT_COLOR_FAMILIES = [
  "BLACK", "WHITE", "GREY", "BLUE", "BROWN", "CREAM", "NAVY", "GREEN",
  "BEIGE", "KHAKI", "PINK", "RED", "YELLOW", "PURPLE", "MULTI", "ORANGE",
] as const

export const productFeatureSchema = z.object({
  primary_color: z.enum(PRODUCT_COLOR_FAMILIES),
  secondary_colors: z.array(z.enum(PRODUCT_COLOR_FAMILIES)).max(4).default([]),
  material: z.string().trim().max(80).nullable().default(null),
  pattern: z.string().trim().max(80).nullable().default(null),
  fit: z.string().trim().max(80).nullable().default(null),
  neckline: z.string().trim().max(80).nullable().default(null),
  style_tags: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  details: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
})

export type ProductFeatureMetadata = z.infer<typeof productFeatureSchema>

export function productFeaturePrompt(row: {
  brand: string
  name: string
  category: string | null
  subcategory: string | null
}): string {
  return [
    "Analyze the single fashion product shown in the image.",
    "Use visual evidence as the authority. The title and category are context only.",
    `Brand: ${row.brand}`,
    `Product: ${row.name}`,
    `Category: ${row.category ?? "unknown"}`,
    `Subcategory: ${row.subcategory ?? "unknown"}`,
    "primary_color must be the dominant product color, not the background or model.",
    "Return concise English attribute values. Use null/empty arrays when uncertain.",
  ].join("\n")
}

export function featureRetrievalText(row: {
  brand: string
  name: string
  category: string | null
  subcategory: string | null
}, feature: ProductFeatureMetadata): string {
  return [
    row.brand, row.name, row.category, row.subcategory, feature.primary_color,
    ...feature.secondary_colors, feature.material, feature.pattern, feature.fit,
    feature.neckline, ...feature.style_tags, ...feature.details,
  ].filter((value): value is string => Boolean(value)).join(" ")
}

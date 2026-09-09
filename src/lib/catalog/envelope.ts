import type {SiteConfig} from "../types"
import {identifierProfileFor, makeIdentifier} from "./identifiers"
import type {CrawledProductEnvelope, ProductIdentifier} from "./types"
import type {Product} from "../types"

export function envelopeFromProduct(product: Product, configOrPlatform?: Pick<SiteConfig, "key" | "type" | "identifierProfile"> | string): CrawledProductEnvelope {
  const profile = identifierProfileFor(configOrPlatform ?? product.platform)
  const identifiers: ProductIdentifier[] = [...(product.identifiers ?? [])]
  if (product.productCode) {
    const identifier = makeIdentifier(profile.productCode, product.productCode, {
      namespace: profile.namespace,
      scope: profile.scope,
      level: profile.level,
      provenance: "legacy.productCode",
      trust: profile.productCode === "source_item_id" ? 0.25 : profile.productCode === "model_id" ? 0.95 : 0.8,
    })
    if (identifier) identifiers.push(identifier)
  }
  const variants = product.variants && product.variants.length > 0
    ? product.variants
    : [{
        sourceVariantKey: "default",
        inStock: product.inStock,
        price: product.price,
        originalPrice: product.originalPrice,
        salePrice: product.salePrice,
        sourceCurrency: product.sourceCurrency,
        sourcePrice: product.sourcePrice,
        productUrl: product.productUrl,
        images: product.images,
      }]
  return {
    sourceProductKey: product.productUrl,
    product,
    identifiers,
    variants,
    schemaVersion: 1,
  }
}

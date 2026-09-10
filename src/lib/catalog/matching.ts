import type {ProductIdentifier} from "./types"

export type MatchStatus = "auto" | "review" | "reject"

export interface CatalogMatchInput {
  brandKey: string
  name: string
  category?: string | null
  colorKey?: string | null
  identifiers?: ProductIdentifier[]
}

export interface CatalogMatchDecision {
  status: MatchStatus
  confidence: number
  reason: string
  evidence: Record<string, unknown>
}

export interface CrossShopMatchInput extends CatalogMatchInput {
  platform: string
  productUrl: string
  imageEmbedding?: number[] | null
  imageReady?: boolean
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

function hostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}

export function extractSourceProductTokens(value: string): string[] {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return []
  }
  const candidates = [
    url.searchParams.get("product_no"),
    url.searchParams.get("productNo"),
    ...url.pathname.split("/"),
  ]
  return [...new Set(candidates
    .map((candidate) => (candidate ?? "").trim().toUpperCase())
    .filter((candidate) => /^\d{5,}$/.test(candidate) || /^(?=.*[A-Z])(?=.*\d)[A-Z\d_-]{8,}$/.test(candidate)))]
}

export function cosineDistance(a: number[] | null | undefined, b: number[] | null | undefined): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  if (normA === 0 || normB === 0) return null
  return Math.max(0, Math.min(2, 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB))))
}

/**
 * Conservative matcher for a domestic official brand shop and a retailer.
 * Bulk execution is intentionally not implied by this pure decision: callers
 * must explicitly provide the pair until the production precision gate passes.
 */
export function decideCrossShopMatch(a: CrossShopMatchInput, b: CrossShopMatchInput): CatalogMatchDecision {
  if (normalizeText(a.brandKey) !== normalizeText(b.brandKey)) {
    return {status: "reject", confidence: 1, reason: "brand_conflict", evidence: {}}
  }
  if (a.platform === b.platform) {
    return {status: "reject", confidence: 1, reason: "same_platform", evidence: {platform: a.platform}}
  }
  const hostA = hostname(a.productUrl)
  const hostB = hostname(b.productUrl)
  if (!hostA || !hostB || hostA === hostB) {
    return {status: "reject", confidence: 1, reason: "not_cross_shop", evidence: {hostA, hostB}}
  }
  if (!a.colorKey || !b.colorKey) {
    return {status: "review", confidence: 0, reason: "color_evidence_missing", evidence: {}}
  }
  if (!colorCompatible(a.colorKey, b.colorKey)) {
    return {status: "reject", confidence: 1, reason: "color_conflict", evidence: {a: a.colorKey, b: b.colorKey}}
  }
  if (a.imageReady === false || b.imageReady === false) {
    return {
      status: "review",
      confidence: 0,
      reason: "pending_image_selection",
      evidence: {a: a.imageReady ?? null, b: b.imageReady ?? null},
    }
  }
  const sameName = normalizeText(a.name) === normalizeText(b.name)
  const sameCategory = Boolean(a.category && b.category && normalizeText(a.category) === normalizeText(b.category))
  if (!sameName || !sameCategory) {
    return {status: "reject", confidence: 1, reason: "product_description_conflict", evidence: {sameName, sameCategory}}
  }

  const tokensA = extractSourceProductTokens(a.productUrl)
  const tokensB = new Set(extractSourceProductTokens(b.productUrl))
  const sharedSourceToken = tokensA.find((token) => tokensB.has(token)) ?? null
  const imageDistance = cosineDistance(a.imageEmbedding, b.imageEmbedding)
  const imageExact = imageDistance !== null && imageDistance <= 0.01
  const evidence = {sharedSourceToken, imageDistance, sameName, sameCategory, hostA, hostB}
  if (sharedSourceToken && imageExact) {
    return {status: "auto", confidence: 0.999, reason: "cross_shop_source_token_and_image_exact", evidence}
  }
  return {status: "review", confidence: imageExact || sharedSourceToken ? 0.95 : 0.7, reason: "cross_shop_corroboration_missing", evidence}
}

function tokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length >= 2))
}

function colorCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && normalizeText(a) === normalizeText(b))
}

function identifiersByKind(input: CatalogMatchInput, kind: ProductIdentifier["kind"]): ProductIdentifier[] {
  const minimumTrust = kind === "gtin" ? 0.99 : 0.8
  return (input.identifiers ?? []).filter(
    (identifier) => identifier.kind === kind && identifier.normalized && identifier.trust >= minimumTrust,
  )
}

function exactEvidence(a: CatalogMatchInput, b: CatalogMatchInput): {kind: string; value: string} | null {
  for (const kind of ["gtin", "mpn", "model_id", "product_group_id"] as const) {
    const left = identifiersByKind(a, kind)
    const right = identifiersByKind(b, kind)
    for (const l of left) {
      if (right.some((r) => l.normalized === r.normalized && l.namespace === r.namespace && l.scope === r.scope)) {
        return {kind, value: l.normalized}
      }
    }
  }
  return null
}

export function decideCatalogMatch(a: CatalogMatchInput, b: CatalogMatchInput): CatalogMatchDecision {
  if (normalizeText(a.brandKey) !== normalizeText(b.brandKey)) {
    return {status: "reject", confidence: 1, reason: "brand_conflict", evidence: {}}
  }
  if (!a.colorKey || !b.colorKey) {
    return {
      status: "review",
      confidence: 0,
      reason: "color_evidence_missing",
      evidence: {a: a.colorKey ?? null, b: b.colorKey ?? null},
    }
  }
  if (!colorCompatible(a.colorKey, b.colorKey)) {
    return {status: "reject", confidence: 1, reason: "color_conflict", evidence: {a: a.colorKey, b: b.colorKey}}
  }
  const exact = exactEvidence(a, b)
  if (exact) {
    return {status: "auto", confidence: exact.kind === "gtin" ? 1 : 0.995, reason: "trusted_identifier_exact", evidence: exact}
  }

  const left = tokens(a.name)
  const right = tokens(b.name)
  const intersection = [...left].filter((token) => right.has(token)).length
  const union = new Set([...left, ...right]).size
  const titleJaccard = union === 0 ? 0 : intersection / union
  const sameCategory = Boolean(a.category && b.category && normalizeText(a.category) === normalizeText(b.category))
  if (sameCategory && titleJaccard >= 0.8) {
    return {
      status: "review",
      confidence: Math.min(0.94, 0.55 + titleJaccard * 0.35),
      reason: "composite_candidate_requires_review",
      evidence: {titleJaccard, sameCategory},
    }
  }
  return {status: "reject", confidence: titleJaccard, reason: "insufficient_evidence", evidence: {titleJaccard, sameCategory}}
}

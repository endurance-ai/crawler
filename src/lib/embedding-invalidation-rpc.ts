import {toDecimalId} from "./pipeline-integrity-types"

export type EmbeddingInvalidationOutcome = "invalidated" | "current" | "missing"
export interface EmbeddingInvalidationResult {
  id: string
  outcome: EmbeddingInvalidationOutcome
}

type RpcClient = {rpc(name: string, args: Record<string, unknown>): PromiseLike<{
  data: unknown
  error: {message: string} | null
}>}

/** Call the database-owned CAS invalidation contract and reject partial/misaligned replies. */
export async function invalidateStaleProductEmbeddings(
  db: RpcClient,
  productIds: readonly (string | number | bigint)[],
): Promise<EmbeddingInvalidationResult[]> {
  const ids = productIds.map(toDecimalId)
  if (new Set(ids).size !== ids.length) throw new Error("Embedding invalidation ids must be unique")
  if (ids.length === 0) return []
  const {data, error} = await db.rpc("invalidate_stale_product_embeddings_v2", {
    p_product_ids: ids,
  })
  if (error) throw new Error(`Embedding invalidation failed: ${error.message}`)
  if (!Array.isArray(data) || data.length !== ids.length) {
    throw new Error("Embedding invalidation returned an invalid response")
  }
  return data.map((value, index) => {
    const row = value as Record<string, unknown> | null
    if (!row || row.id !== ids[index] ||
        !["invalidated", "current", "missing"].includes(String(row.outcome))) {
      throw new Error("Embedding invalidation returned an invalid response")
    }
    return {id: row.id as string, outcome: row.outcome as EmbeddingInvalidationOutcome}
  })
}

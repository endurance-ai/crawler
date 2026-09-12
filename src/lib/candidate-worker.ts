import type {ClaimedProductRefreshCandidate, PipelineError, PreparedProductWrite} from "./pipeline-integrity-types"
import type {CandidateFilters, CandidateRepository, CurrentProductSnapshot, PublishResult} from "./candidate-repository"

export interface CandidateWorkerDependencies {
  repository: CandidateRepository
  prepare(candidate: ClaimedProductRefreshCandidate): Promise<{status: "prepared"; prepared: PreparedProductWrite} | {status: "failed"; error: PipelineError}>
  checkpointReusable(candidate: ClaimedProductRefreshCandidate): boolean
  normalizeCurrent?(candidate: ClaimedProductRefreshCandidate, product: CurrentProductSnapshot): Promise<{
    normalization: PreparedProductWrite["normalization"]
    category: string
    subcategory: string | null
  }>
  now?: () => number
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

export interface CandidateWorkerResult {
  mode: "apply" | "dry_run"
  listed: number
  claimed: number
  imported: number
  conflicted: number
  stale: number
  lostClaim: number
  rejected: number
  failed: number
  released: number
}

export interface CandidateWorkerOptions extends CandidateFilters {
  mode: "apply" | "dry_run"
  budgetMs: number
  heartbeatMs?: number
  signal?: AbortSignal
}

function countFinish(outcome: string, requested: "retry" | "rejected" | "release" | "stale",
  result: CandidateWorkerResult): void {
  if (outcome === "lost_claim") result.lostClaim += 1
  else if (outcome === "stale") result.stale += 1
  else if (requested === "release" && outcome === "release") result.released += 1
  else if (requested === "rejected" && outcome === "rejected") result.rejected += 1
  else if (requested === "retry" && outcome === "retry") result.failed += 1
  else result.failed += 1
}

async function processOne(
  candidate: ClaimedProductRefreshCandidate,
  options: CandidateWorkerOptions,
  dependencies: CandidateWorkerDependencies,
  result: CandidateWorkerResult,
): Promise<void> {
  const repo = dependencies.repository
  let claimAlive = true
  let heartbeatRunning = false
  const beat = async () => {
    if (heartbeatRunning || !claimAlive) return
    heartbeatRunning = true
    try { claimAlive = await repo.heartbeat(candidate.id, candidate.processing_token) }
    catch { claimAlive = false }
    finally { heartbeatRunning = false }
  }
  const timer = (dependencies.setInterval ?? setInterval)(() => { void beat() }, options.heartbeatMs ?? 9 * 60_000)
  try {
    if (!dependencies.checkpointReusable(candidate)) {
      const prepared = await dependencies.prepare(candidate)
      if (prepared.status === "failed") {
        const outcome = prepared.error.retryable ? "retry" : "rejected"
        const finished = await repo.finish(candidate.id, candidate.processing_token, candidate.observation_revision,
          outcome, {code: prepared.error.code, message: prepared.error.message}, options.maxAttempts)
        countFinish(finished, outcome, result)
        return
      }
      if (!claimAlive) { result.lostClaim += 1; return }
      const checkpoint = await repo.checkpoint(candidate.id, candidate.processing_token,
        candidate.observation_revision, prepared.prepared)
      if (checkpoint === "stale") {
        const finished = await repo.finish(candidate.id, candidate.processing_token,
          candidate.observation_revision, "stale", undefined, options.maxAttempts)
        countFinish(finished, "stale", result); return
      }
      if (checkpoint === "lost_claim") { result.lostClaim += 1; return }
    } else {
      const checkpoint = await repo.checkpoint(candidate.id, candidate.processing_token,
        candidate.observation_revision, candidate.enriched_product!)
      if (checkpoint === "stale") {
        const finished = await repo.finish(candidate.id, candidate.processing_token,
          candidate.observation_revision, "stale", undefined, options.maxAttempts)
        countFinish(finished, "stale", result); return
      }
      if (checkpoint === "lost_claim") { result.lostClaim += 1; return }
    }
    await beat()
    if (!claimAlive) { result.lostClaim += 1; return }
    let published = await repo.publish(candidate.id, candidate.processing_token, candidate.observation_revision)
    if (published.outcome === "conflicted" && published.product_id && dependencies.normalizeCurrent) {
      const current = await repo.currentProduct(published.product_id)
      if (!current) {
        const finished = await repo.finish(candidate.id, candidate.processing_token, candidate.observation_revision, "retry",
          {code: "conflict_product_missing", message: "conflicting product is unavailable"}, options.maxAttempts)
        countFinish(finished, "retry", result); return
      }
      const normalized = await dependencies.normalizeCurrent(candidate, current)
      published = await repo.publishNormalization({candidateId: candidate.id,
        token: candidate.processing_token, revision: candidate.observation_revision,
        productId: published.product_id, expectedUpdatedAt: current.updated_at,
        normalization: normalized.normalization, category: normalized.category, subcategory: normalized.subcategory})
      if (published.outcome === "conflicted") {
        const latest = await repo.currentProduct(published.product_id ?? current.id)
        if (latest) {
          const retry = await dependencies.normalizeCurrent(candidate, latest)
          published = await repo.publishNormalization({candidateId: candidate.id,
            token: candidate.processing_token, revision: candidate.observation_revision,
            productId: latest.id, expectedUpdatedAt: latest.updated_at,
            normalization: retry.normalization, category: retry.category, subcategory: retry.subcategory})
        }
      }
    }
    if (published.outcome === "stale") {
      const finished = await repo.finish(candidate.id, candidate.processing_token,
        candidate.observation_revision, "stale", undefined, options.maxAttempts)
      countFinish(finished, "stale", result)
    } else if (published.outcome === "conflicted") {
      const finished = await repo.finish(candidate.id, candidate.processing_token,
        candidate.observation_revision, "retry", {code: "product_cas_conflict", message: "product changed during normalization"}, options.maxAttempts)
      countFinish(finished, "retry", result)
    } else if (published.outcome === "rejected") {
      const finished = await repo.finish(candidate.id, candidate.processing_token,
        candidate.observation_revision, "rejected", {code: published.code ?? "publish_rejected", message: "candidate publish rejected"}, options.maxAttempts)
      countFinish(finished, "rejected", result)
    } else countPublish(published, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "candidate worker failed"
    const finished = await repo.finish(candidate.id, candidate.processing_token, candidate.observation_revision,
      "retry", {code: "worker_failed", message}, options.maxAttempts).catch(() => null)
    if (finished) countFinish(finished, "retry", result)
    else result.failed += 1
  } finally {
    if (dependencies.clearInterval) dependencies.clearInterval(timer)
    else clearInterval(timer as NodeJS.Timeout)
  }
}

function countPublish(published: PublishResult, result: CandidateWorkerResult): void {
  if (published.outcome === "imported") result.imported += 1
  else if (published.outcome === "conflicted") result.conflicted += 1
  else if (published.outcome === "stale") result.stale += 1
  else if (published.outcome === "lost_claim") result.lostClaim += 1
  else result.rejected += 1
}

export async function runCandidateWorker(
  options: CandidateWorkerOptions,
  dependencies: CandidateWorkerDependencies,
): Promise<CandidateWorkerResult> {
  const result: CandidateWorkerResult = {mode: options.mode, listed: 0, claimed: 0,
    imported: 0, conflicted: 0, stale: 0, lostClaim: 0, rejected: 0, failed: 0, released: 0}
  if (options.mode === "dry_run") {
    result.listed = (await dependencies.repository.list(options)).length
    return result
  }
  const started = (dependencies.now ?? Date.now)()
  while (result.claimed < options.limit) {
    const remaining = options.limit - result.claimed
    const candidates = await dependencies.repository.claim({...options, limit: Math.min(10, remaining)})
    if (candidates.length === 0) break
    result.claimed += candidates.length
    let stop = false
    for (let index = 0; index < candidates.length; index += 1) {
      const outOfBudget = options.budgetMs > 0 && (dependencies.now ?? Date.now)() - started >= options.budgetMs
      if (outOfBudget || options.signal?.aborted) {
        const releases = await Promise.allSettled(candidates.slice(index).map((candidate) =>
          dependencies.repository.finish(candidate.id, candidate.processing_token,
            candidate.observation_revision, "release", undefined, options.maxAttempts)))
        for (const release of releases) {
          if (release.status === "fulfilled") countFinish(release.value, "release", result)
          else result.failed += 1
        }
        stop = true
        break
      }
      await processOne(candidates[index], options, dependencies, result)
    }
    if (stop || candidates.length < Math.min(10, remaining)) break
  }
  return result
}

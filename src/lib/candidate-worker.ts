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
  inserted: number
  updated: number
  unchanged: number
  conflicted: number
  stale: number
  lostClaim: number
  rejected: number
  failed: number
  released: number
  errors: PipelineError[]
}

export interface CandidateWorkerOptions extends CandidateFilters {
  mode: "apply" | "dry_run"
  budgetMs: number
  heartbeatMs?: number
  concurrency?: number
  signal?: AbortSignal
}

function itemError(candidate: ClaimedProductRefreshCandidate, stage: string, code: string,
  message: string, retryable: boolean): PipelineError {
  return {stage, code, message, retryable, platform: candidate.platform_key,
    productUrl: candidate.product_url, candidateId: candidate.id}
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
        result.errors.push({...prepared.error, platform: candidate.platform_key,
          productUrl: candidate.product_url, candidateId: candidate.id})
        const outcome = prepared.error.retryable ? "retry" : "rejected"
        const finished = await repo.finish(candidate.id, candidate.processing_token, candidate.observation_revision,
          outcome, {code: prepared.error.code, message: prepared.error.message}, options.maxAttempts)
        countFinish(finished, outcome, result)
        return
      }
      if (!claimAlive) { result.lostClaim += 1; result.errors.push(itemError(candidate,
        "claim", "lost_claim", "candidate claim was lost", true)); return }
      const checkpoint = await repo.checkpoint(candidate.id, candidate.processing_token,
        candidate.observation_revision, prepared.prepared)
      if (checkpoint === "stale") {
        const finished = await repo.finish(candidate.id, candidate.processing_token,
          candidate.observation_revision, "stale", undefined, options.maxAttempts)
        countFinish(finished, "stale", result); result.errors.push(itemError(candidate,
          "checkpoint", "stale_observation", "candidate observation became stale", true)); return
      }
      if (checkpoint === "lost_claim") { result.lostClaim += 1; result.errors.push(itemError(candidate,
        "checkpoint", "lost_claim", "candidate claim was lost", true)); return }
    } else {
      const checkpoint = await repo.checkpoint(candidate.id, candidate.processing_token,
        candidate.observation_revision, candidate.enriched_product!)
      if (checkpoint === "stale") {
        const finished = await repo.finish(candidate.id, candidate.processing_token,
          candidate.observation_revision, "stale", undefined, options.maxAttempts)
        countFinish(finished, "stale", result); result.errors.push(itemError(candidate,
          "checkpoint", "stale_observation", "candidate observation became stale", true)); return
      }
      if (checkpoint === "lost_claim") { result.lostClaim += 1; result.errors.push(itemError(candidate,
        "checkpoint", "lost_claim", "candidate claim was lost", true)); return }
    }
    await beat()
    if (!claimAlive) { result.lostClaim += 1; result.errors.push(itemError(candidate,
      "claim", "lost_claim", "candidate claim was lost", true)); return }
    let published = await repo.publish(candidate.id, candidate.processing_token, candidate.observation_revision)
    if (published.outcome === "conflicted" && published.product_id && dependencies.normalizeCurrent) {
      const current = await repo.currentProduct(published.product_id)
      if (!current) {
        const finished = await repo.finish(candidate.id, candidate.processing_token, candidate.observation_revision, "retry",
          {code: "conflict_product_missing", message: "conflicting product is unavailable"}, options.maxAttempts)
        countFinish(finished, "retry", result)
        result.errors.push(itemError(candidate, "publish", "conflict_product_missing",
          "conflicting product is unavailable", true)); return
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
      result.errors.push(itemError(candidate, "publish", "stale_observation", "candidate observation became stale", true))
    } else if (published.outcome === "conflicted") {
      const finished = await repo.finish(candidate.id, candidate.processing_token,
        candidate.observation_revision, "retry", {code: "product_cas_conflict", message: "product changed during normalization"}, options.maxAttempts)
      countFinish(finished, "retry", result)
      result.errors.push(itemError(candidate, "publish", "product_cas_conflict", "product changed during normalization", true))
    } else if (published.outcome === "rejected") {
      const finished = await repo.finish(candidate.id, candidate.processing_token,
        candidate.observation_revision, "rejected", {code: published.code ?? "publish_rejected", message: "candidate publish rejected"}, options.maxAttempts)
      countFinish(finished, "rejected", result)
      result.errors.push(itemError(candidate, "publish", published.code ?? "publish_rejected", "candidate publish rejected", false))
    } else {
      countPublish(published, result)
      if (published.outcome === "lost_claim") result.errors.push(itemError(candidate,
        "publish", "lost_claim", "candidate claim was lost", true))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "candidate worker failed"
    result.errors.push(itemError(candidate, "candidate_worker", "worker_failed", message, true))
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
  if (published.outcome === "imported") {
    result.imported += 1
    if (published.write_outcome === "inserted") result.inserted += 1
    else if (published.write_outcome === "updated") result.updated += 1
    else if (published.write_outcome === "unchanged") result.unchanged += 1
    else throw new Error("imported publish result is missing write_outcome")
  }
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
    imported: 0, inserted: 0, updated: 0, unchanged: 0, conflicted: 0, stale: 0,
    lostClaim: 0, rejected: 0, failed: 0, released: 0, errors: []}
  if (options.mode === "dry_run") {
    result.listed = (await dependencies.repository.list(options)).length
    return result
  }
  const started = (dependencies.now ?? Date.now)()
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4))
  while (result.claimed < options.limit) {
    const outOfBudget = options.budgetMs > 0 && (dependencies.now ?? Date.now)() - started >= options.budgetMs
    if (outOfBudget || options.signal?.aborted) break
    const remaining = options.limit - result.claimed
    // Bound the lease batch while leaving one follow-up item per worker.
    const claimLimit = Math.min(10, concurrency * 2, remaining)
    const candidates = await dependencies.repository.claim({...options, limit: claimLimit})
    if (candidates.length === 0) break
    result.claimed += candidates.length
    let next = 0
    let stopped = false
    const startedCandidates = new Set<string>()
    await Promise.all(Array.from({length: Math.min(concurrency, candidates.length)}, async () => {
      while (!stopped && next < candidates.length) {
        const candidate = candidates[next++]!
        const expired = options.budgetMs > 0 &&
          (dependencies.now ?? Date.now)() - started >= options.budgetMs
        if (expired || options.signal?.aborted) { stopped = true; break }
        startedCandidates.add(candidate.id)
        await processOne(candidate, options, dependencies, result)
      }
    }))
    if (stopped) {
      const unstarted = candidates.filter((candidate) => !startedCandidates.has(candidate.id))
      const releases = await Promise.allSettled(unstarted.map((candidate) =>
        dependencies.repository.finish(candidate.id, candidate.processing_token,
          candidate.observation_revision, "release", undefined, options.maxAttempts)))
      releases.forEach((release, index) => {
        const candidate = unstarted[index]!
        if (release.status === "fulfilled") {
          countFinish(release.value, "release", result)
          if (release.value !== "release") result.errors.push(itemError(candidate, "release",
            release.value === "lost_claim" ? "lost_claim" : "stale_observation",
            "candidate could not be released in its claimed state", true))
        }
        else {
          result.failed += 1
          result.errors.push(itemError(candidate, "release", "release_failed",
            "unstarted candidate claim could not be released", true))
        }
      })
    }
    if (stopped || candidates.length < claimLimit) break
  }
  return result
}

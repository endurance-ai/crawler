import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {test} from "node:test"
import {pipelineAuditHash, type AuditBrand, type AuditEmbedding, type AuditProduct, type PipelineAuditFinding, type PipelineAuditManifest} from "../src/lib/pipeline-audit"
import {createRecoveryCheckpoint, runPipelineRecovery, validateRecoveryCheckpoint, type RecoveryCandidate, type RecoveryStore} from "../src/lib/pipeline-recovery"

const now = "2026-09-12T12:00:00Z"
const product: AuditProduct = {
  id: "9007199254740993", product_url: "https://shop.test/item", platform: "shop",
  brand: "Exact Brand", brand_node_id: null, updated_at: "2026-09-12T11:00:00.123456Z",
  price: 100, original_price: 100, sale_price: null, in_stock: true,
  image_url: "https://shop.test/image.jpg", image_revision: "3",
  review_count: 9, reviews_observed_at: "2026-09-12T10:00:00.654321Z",
}
const candidate: RecoveryCandidate = {
  id: "5", platform_key: "shop", product_url: "https://shop.test/candidate",
  status: "blocked", updated_at: "2026-09-12T11:00:00.123456Z",
  observation_revision: "4", prepared_observation_revision: "3",
  raw_observed_at: "2026-09-12T11:30:00Z", matched_brand_node_id: "3",
  imported_product_id: "91", processing_token: null, processing_observation_revision: null,
  processing_max_age_hours: null,
  lease_expires_at: null, attempt_count: 3, last_error_code: "normalization_failed",
  normalization_result: {status: "failed"}, raw_product: {name: "Candidate"},
  enriched_product: {old: true}, next_attempt_at: null, last_error: "failed",
}
const embedding: AuditEmbedding = {
  product_id: product.id, source_image_url: null, source_image_revision: null,
  embedded_at: "2026-09-12T09:00:00.123456Z", embedding_model: "legacy",
}

function finding(value: Partial<PipelineAuditFinding> & Pick<PipelineAuditFinding, "finding_id" | "entity" | "id" | "action">): PipelineAuditFinding {
  return {platform: "shop", issue: value.action, certainty: "confirmed", evidence: {}, expected: {}, proposed: {}, ...value}
}
function manifest(findings: PipelineAuditFinding[]): PipelineAuditManifest {
  const value: PipelineAuditManifest = {
    schema_version: 1, kind: "pipeline_integrity_audit", generated_at: now, complete: true,
    scope: {platform: "shop", limit: null, max_observation_age_hours: 24},
    scanned: {products: 1, candidates: 1, embeddings: 1}, findings, content_hash: "",
  }
  value.content_hash = pipelineAuditHash({...value, content_hash: undefined})
  return value
}
const candidateExpected = (() => {
  const {raw_product: _a, normalization_result: _b, processing_observation_revision: _c,
    enriched_product: _d, next_attempt_at: _e, last_error: _f, ...expected} = candidate
  return expected
})()

class FakeStore implements RecoveryStore {
  candidate: RecoveryCandidate | null = structuredClone(candidate)
  product: AuditProduct | null = structuredClone(product)
  embedding: AuditEmbedding | null = structuredClone(embedding)
  brands: AuditBrand[] = [{id: "3", brand_name: "Exact Brand", brand_name_normalized: "exactbrand"}]
  reviewCount = 2
  writes: string[] = []
  race = false
  async readCandidate(id: string) { return this.candidate?.id === id ? structuredClone(this.candidate) : null }
  async updateCandidate(current: RecoveryCandidate, patch: Record<string, unknown>) {
    this.writes.push("candidate")
    if (this.race || !this.candidate || pipelineAuditHash(this.candidate) !== pipelineAuditHash(current)) return false
    this.candidate = {...this.candidate, ...patch, updated_at: "2026-09-12T12:00:00.000001Z"} as RecoveryCandidate
    return true
  }
  async readProduct(id: string) { return this.product?.id === id ? structuredClone(this.product) : null }
  async updateProduct(current: AuditProduct, patch: Record<string, unknown>) {
    this.writes.push("product")
    if (this.race || !this.product || pipelineAuditHash(this.product) !== pipelineAuditHash(current)) return false
    this.product = {...this.product, ...patch, updated_at: "2026-09-12T12:00:00.000001Z"} as AuditProduct
    return true
  }
  async readBrands() { return structuredClone(this.brands) }
  async countReviews() { return this.reviewCount }
  async readEmbedding(id: string) { return this.embedding?.product_id === id ? structuredClone(this.embedding) : null }
  async invalidateEmbedding(id: string): Promise<"invalidated" | "current" | "missing"> {
    this.writes.push("embedding")
    if (this.race) return "current"
    if (!this.embedding || this.embedding.product_id !== id) return "missing"
    this.embedding = null
    return "invalidated"
  }
}

test("dry-run writes nothing and scope IDs exclude outside findings", async () => {
  const store = new FakeStore()
  const audit = manifest([
    finding({finding_id: "resume", entity: "candidate", id: "5", action: "resume_candidate", expected: candidateExpected}),
    finding({finding_id: "outside", entity: "product", id: "7", action: "manual_review", expected: {...product, id: "7"}}),
  ])
  const run = await runPipelineRecovery({manifest: audit, store, ids: new Set(["5"])})
  assert.deepEqual(run.counts, {planned: 1, applied: 0, unchanged: 0, conflicted: 0, failed: 0, deferred: 0})
  assert.deepEqual(store.writes, [])
})

test("candidate resume is CAS guarded, keeps legacy product ID, and is idempotent", async () => {
  const audit = manifest([finding({
    finding_id: "resume", entity: "candidate", id: "5", action: "resume_candidate",
    expected: candidateExpected,
  })])
  const store = new FakeStore()
  const first = await runPipelineRecovery({manifest: audit, store, apply: true, now})
  assert.equal(first.results[0].outcome, "applied")
  assert.equal(store.candidate?.status, "discovered")
  assert.equal(store.candidate?.attempt_count, 0)
  assert.equal(store.candidate?.imported_product_id, "91")
  assert.equal(store.candidate?.enriched_product, null)
  const second = await runPipelineRecovery({manifest: audit, store, apply: true, now})
  assert.equal(second.results[0].outcome, "unchanged")
  assert.equal(createRecoveryCheckpoint(second).manifest_hash, audit.content_hash)

  const stale = new FakeStore()
  stale.candidate!.observation_revision = "9"
  assert.equal((await runPipelineRecovery({manifest: audit, store: stale, apply: true, now})).results[0].code, "candidate_changed")
  const leased = new FakeStore()
  leased.candidate!.processing_token = "token"
  leased.candidate!.lease_expires_at = "2026-09-12T13:00:00Z"
  const expected = {...candidateExpected, processing_token: "token", lease_expires_at: "2026-09-12T13:00:00Z"}
  const leasedAudit = manifest([finding({finding_id: "leased", entity: "candidate", id: "5", action: "resume_candidate", expected})])
  assert.equal((await runPipelineRecovery({manifest: leasedAudit, store: leased, apply: true, now})).results[0].code, "active_lease")
})

test("reobserve wins over resume and brand repair fails closed on ambiguity", async () => {
  const store = new FakeStore()
  const candidates = manifest([
    finding({finding_id: "resume", entity: "candidate", id: "5", action: "resume_candidate", expected: candidateExpected}),
    finding({finding_id: "reobserve", entity: "candidate", id: "5", action: "reobserve_candidate", expected: candidateExpected}),
  ])
  const run = await runPipelineRecovery({manifest: candidates, store, apply: true, now})
  assert.equal(run.results.length, 1)
  assert.equal(store.candidate?.status, "awaiting_observation")

  const brandFinding = finding({
    finding_id: "brand", entity: "product", id: product.id, action: "repair_brand",
    expected: product, evidence: {exact_matches: [{id: "3", name: "Exact Brand"}]},
    proposed: {brand_node_id: "3"},
  })
  const ambiguous = new FakeStore()
  ambiguous.brands.push({id: "4", brand_name: "Exact.Brand", brand_name_normalized: "exactbrand"})
  const brandRun = await runPipelineRecovery({manifest: manifest([brandFinding]), store: ambiguous, apply: true})
  assert.equal(brandRun.results[0].outcome, "deferred")
  assert.deepEqual(ambiguous.writes, [])
})

test("review repair and embedding invalidation preserve raced state", async () => {
  const reviewFinding = finding({
    finding_id: "reviews", entity: "product", id: product.id, action: "repair_review_count",
    expected: product, proposed: {review_count: 2},
  })
  const reviews = new FakeStore()
  reviews.race = true
  assert.equal((await runPipelineRecovery({manifest: manifest([reviewFinding]), store: reviews, apply: true})).results[0].code, "reviews_race")
  assert.equal(reviews.product?.review_count, 9)

  const embeddingFinding = finding({
    finding_id: "embedding", entity: "embedding", id: product.id, action: "regenerate_embedding",
    expected: {...product, embedding}, proposed: {source_image_url: product.image_url, source_image_revision: product.image_revision},
  })
  const raced = new FakeStore()
  raced.race = true
  assert.equal((await runPipelineRecovery({manifest: manifest([embeddingFinding]), store: raced, apply: true})).results[0].outcome, "unchanged")
  assert.deepEqual(raced.embedding, embedding)
  const applied = new FakeStore()
  assert.equal((await runPipelineRecovery({manifest: manifest([embeddingFinding]), store: applied, apply: true})).results[0].outcome, "applied")
  assert.equal(applied.embedding, null)
  assert.equal((await runPipelineRecovery({manifest: manifest([embeddingFinding]), store: applied, apply: true})).results[0].outcome, "unchanged")
})

test("compatible brand and review repairs share one product snapshot and replay safely", async () => {
  const brandFinding = finding({
    finding_id: "brand", entity: "product", id: product.id, action: "repair_brand",
    expected: product, evidence: {exact_matches: [{id: "3", name: "Exact Brand"}]},
    proposed: {brand_node_id: "3"},
  })
  const reviewFinding = finding({
    finding_id: "reviews", entity: "product", id: product.id, action: "repair_review_count",
    expected: product, proposed: {review_count: 2},
  })
  const audit = manifest([brandFinding, reviewFinding])
  const store = new FakeStore()
  const first = await runPipelineRecovery({manifest: audit, store, apply: true})
  assert.deepEqual(first.results.map((item) => item.outcome), ["applied", "applied"])
  assert.equal(store.product?.brand_node_id, "3")
  assert.equal(store.product?.review_count, 2)
  const replay = await runPipelineRecovery({manifest: audit, store, apply: true})
  assert.deepEqual(replay.results.map((item) => item.outcome), ["unchanged", "unchanged"])
})

test("checkpoint persistence failure stops before the next mutation", async () => {
  const audit = manifest([
    finding({
      finding_id: "brand", entity: "product", id: product.id, action: "repair_brand",
      expected: product, evidence: {exact_matches: [{id: "3", name: "Exact Brand"}]},
      proposed: {brand_node_id: "3"},
    }),
    finding({
      finding_id: "reviews", entity: "product", id: product.id, action: "repair_review_count",
      expected: product, proposed: {review_count: 2},
    }),
  ])
  const store = new FakeStore()
  await assert.rejects(runPipelineRecovery({
    manifest: audit,
    store,
    apply: true,
    onResult: async () => { throw new Error("checkpoint unavailable") },
  }), /checkpoint unavailable/)
  assert.deepEqual(store.writes, ["product"])
  assert.equal(store.product?.brand_node_id, "3")
  assert.equal(store.product?.review_count, 9)

  const resumed = await runPipelineRecovery({manifest: audit, store, apply: true})
  assert.deepEqual(resumed.results.map((item) => item.outcome), ["unchanged", "applied"])
  assert.equal(store.product?.review_count, 2)
})

test("CLI validates the default checkpoint and output collisions before database setup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pipeline-recovery-test-"))
  try {
    const manifestPath = path.join(directory, "manifest.json")
    const audit = manifest([])
    await writeFile(manifestPath, JSON.stringify(audit))
    await writeFile(`${manifestPath}.recovery-checkpoint.json`, JSON.stringify({
      schema_version: 1,
      kind: "pipeline_integrity_recovery_checkpoint",
      manifest_hash: "0".repeat(64),
      outcomes: {},
    }))
    const environment = {...process.env}
    delete environment.DB_URL
    delete environment.DB_TOKEN
    const mismatch = spawnSync(process.execPath, [
      "--import", "tsx", "tools/recover-pipeline-integrity.ts",
      `--manifest=${manifestPath}`, "--apply",
    ], {cwd: process.cwd(), env: environment, encoding: "utf8"})
    assert.equal(mismatch.status, 2)
    assert.match(mismatch.stderr, /Checkpoint does not belong/)
    assert.doesNotMatch(mismatch.stderr, /database configuration/)

    const collision = spawnSync(process.execPath, [
      "--import", "tsx", "tools/recover-pipeline-integrity.ts",
      `--manifest=${manifestPath}`, `--report=${manifestPath}`,
    ], {cwd: process.cwd(), env: environment, encoding: "utf8"})
    assert.equal(collision.status, 2)
    assert.match(collision.stderr, /paths must be distinct/)
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test("modified or incomplete manifests are rejected before reads or writes", async () => {
  const valid = manifest([])
  await assert.rejects(runPipelineRecovery({manifest: {...valid, complete: false}, apply: true, store: new FakeStore()}), /Invalid, incomplete, or modified/)
  await assert.rejects(runPipelineRecovery({manifest: {...valid, generated_at: "changed"}, apply: true, store: new FakeStore()}), /Invalid, incomplete, or modified/)
  assert.throws(() => validateRecoveryCheckpoint({
    schema_version: 1,
    kind: "pipeline_integrity_recovery_checkpoint",
    manifest_hash: "0".repeat(64),
    outcomes: {},
  }, valid.content_hash), /does not belong/)
})

import assert from "node:assert/strict"
import test from "node:test"
import {spawnSync} from "node:child_process"
import {mkdtempSync, readFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {runCandidateWorker} from "../src/lib/candidate-worker"
import {createCandidateRepository, type CandidateRepository} from "../src/lib/candidate-repository"
import {canReuseCandidateCheckpoint} from "../src/lib/candidate-checkpoint"
import {DEFAULT_NORMALIZATION_POLICY_VERSION} from "../src/lib/prepare-product-for-import"
import {qwenNormalizationInputHash} from "../src/lib/product-qwen-normalization"
import type {ClaimedProductRefreshCandidate, PreparedProductWrite} from "../src/lib/pipeline-integrity-types"

const prepared = {product: {product_url: "https://shop/p", brand_node_id: "7"},
  normalization: {status: "succeeded", input_hash: "hash", policy_version: "v1", model: "qwen", completed_at: "2026-09-12T00:00:00Z"},
  pricing_observation: {version: 2, state: "regular", observed_at: "2026-09-12T00:00:00Z", source_currency: "KRW", source_price: 1000, current_price_krw: 1000, original_price_krw: null},
  observed_at: "2026-09-12T00:00:00Z", expected_updated_at: null} as unknown as PreparedProductWrite

function candidate(overrides: Partial<ClaimedProductRefreshCandidate> = {}): ClaimedProductRefreshCandidate {
  return {id: "9007199254740993", platform_key: "shop", identity_key: "x", product_url: "https://shop/p",
    raw_product: {}, raw_observed_at: "2026-09-12T00:00:00Z", detected_brand: "Brand",
    matched_brand_node_id: "7", status: "enriching", observation_revision: "3",
    processing_token: "token-a", lease_expires_at: "2026-09-12T00:30:00Z",
    prepared_observation_revision: null, enriched_product: null, normalization_result: null,
    imported_product_id: null, attempt_count: 1, last_error_code: null,
    updated_at: "2026-09-12T00:00:00Z", last_seen_at: "2026-09-12T00:00:00Z", next_attempt_at: null,
    ...overrides}
}

function fakeRepository(rows = [candidate()]): CandidateRepository & {calls: string[]} {
  const calls: string[] = []
  let claimed = false
  return {calls,
    async list() { calls.push("list"); return rows },
    async claim() { calls.push("claim"); if (claimed) return []; claimed = true; return rows },
    async heartbeat(id, token) { calls.push(`heartbeat:${id}:${token}`); return true },
    async checkpoint(id, token, revision) { calls.push(`checkpoint:${id}:${token}:${revision}`); return "ready" },
    async finish(id, token, revision, outcome) { calls.push(`finish:${id}:${token}:${revision}:${outcome}`); return outcome },
    async publish(id, token, revision) { calls.push(`publish:${id}:${token}:${revision}`); return {outcome: "imported", product_id: "91"} },
    async currentProduct() { return null },
    async publishNormalization() { throw new Error("unused") },
  }
}

const options = {mode: "apply" as const, limit: 10, maxAttempts: 3, originCountry: "KR",
  platform: "shop", inStockOnly: true, maxAgeHours: 24, budgetMs: 60_000}

test("repository passes every claim filter into SQL RPC", async () => {
  const calls: Array<{name: string; args: Record<string, unknown>}> = []
  const db = {rpc(name: string, args: Record<string, unknown>) { calls.push({name, args}); return Promise.resolve({data: [], error: null}) }, from() { throw new Error("unused") }}
  await createCandidateRepository(db).claim(options)
  assert.deepEqual(calls[0], {name: "claim_product_refresh_candidates_v2", args: {
    p_limit: 10, p_max_attempts: 3, p_origin_country: "KR", p_platform_key: "shop",
    p_in_stock_only: true, p_max_age_hours: 24}})
})

test("normalization publish serializes frozen category and subcategory parameters", async () => {
  const calls: Array<{name: string; args: Record<string, unknown>}> = []
  const db = {rpc(name: string, args: Record<string, unknown>) {
    calls.push({name, args}); return Promise.resolve({data: {outcome: "imported", product_id: "91"}, error: null})
  }, from() { throw new Error("unused") }}
  await createCandidateRepository(db).publishNormalization({candidateId: "7", token: "token", revision: "4",
    productId: "91", expectedUpdatedAt: "2026-09-12T01:02:03.123456Z", normalization: prepared.normalization,
    category: "clothing", subcategory: "tops"})
  assert.deepEqual(calls[0], {name: "publish_product_refresh_candidate_normalization", args: {
    p_id: "7", p_token: "token", p_expected_revision: "4", p_product_id: "91",
    p_expected_updated_at: "2026-09-12T01:02:03.123456Z", p_normalization: prepared.normalization,
    p_category: "clothing", p_subcategory: "tops"}})
})

test("repository rejects rounded numeric IDs from claim RPC", async () => {
  const db = {rpc() { return Promise.resolve({data: [{...candidate(), id: 9007199254740993}], error: null}) },
    from() { throw new Error("unused") }}
  await assert.rejects(createCandidateRepository(db).claim(options), /invalid response/)
})

test("dry-run converts safe PostgREST numeric IDs without precision loss", async () => {
  const listed = {...candidate(), status: "ready", id: 42, observation_revision: 3, matched_brand_node_id: 7,
    processing_token: null, lease_expires_at: null}
  const query: Record<string, unknown> = {}
  const predicates: string[] = []
  for (const method of ["select", "eq", "gte", "lt", "or", "order", "limit"])
    query[method] = () => query
  query.or = (predicate: string) => { predicates.push(predicate); return query }
  query.then = (resolve: (value: unknown) => void) => resolve({data: [listed], error: null})
  const repository = createCandidateRepository({rpc() { throw new Error("unused") }, from() { return query }})
  const rows = await repository.list(options)
  assert.equal(rows[0].id, "42")
  assert.equal(rows[0].observation_revision, "3")
  assert.equal(rows[0].matched_brand_node_id, "7")
  assert(predicates.includes("status.in.(discovered,failed),and(status.in.(enriching,ready),or(processing_token.is.null,lease_expires_at.lte.now()))"))
})

test("fresh identical listing cannot reuse an expired detail checkpoint", async () => {
  const now = Date.parse("2026-09-13T01:00:00Z")
  const raw = {productUrl: "https://shop/p", name: "Shirt", brand: "Brand", category: "other"}
  const normalization = {...prepared.normalization, input_hash: qwenNormalizationInputHash(raw),
    policy_version: DEFAULT_NORMALIZATION_POLICY_VERSION}
  const row = candidate({raw_product: raw, raw_observed_at: new Date(now).toISOString(),
    prepared_observation_revision: "3", normalization_result: normalization,
    enriched_product: {...prepared, normalization}})
  assert.equal(canReuseCandidateCheckpoint(row, 24, now), false)
  assert.equal(canReuseCandidateCheckpoint({...row, enriched_product: {...row.enriched_product!,
    observed_at: new Date(now - 60_000).toISOString()}}, 24, now), true)
  assert.equal(canReuseCandidateCheckpoint({...row, enriched_product: {...row.enriched_product!,
    observed_at: "invalid"}}, 24, now), false)
  let prepares = 0
  const result = await runCandidateWorker(options, {repository: fakeRepository([row]),
    checkpointReusable: (value) => canReuseCandidateCheckpoint(value, 24, now),
    prepare: async () => { prepares += 1; return {status: "prepared", prepared} },
    setInterval: () => 1, clearInterval: () => {}})
  assert.equal(prepares, 1)
  assert.equal(result.imported, 1)
})

test("dry-run lists only and performs no claim, Qwen, heartbeat, or writes", async () => {
  const repository = fakeRepository()
  let preparedCalls = 0
  const result = await runCandidateWorker({...options, mode: "dry_run"}, {repository,
    prepare: async () => { preparedCalls += 1; return {status: "prepared", prepared} },
    checkpointReusable: () => false})
  assert.equal(result.listed, 1)
  assert.deepEqual(repository.calls, ["list"])
  assert.equal(preparedCalls, 0)
})

test("token and revision accompany heartbeat, checkpoint, and publish", async () => {
  const repository = fakeRepository()
  const result = await runCandidateWorker(options, {repository,
    prepare: async () => ({status: "prepared", prepared}), checkpointReusable: () => false,
    setInterval: () => 1, clearInterval: () => {}})
  assert.equal(result.imported, 1)
  assert(repository.calls.includes("checkpoint:9007199254740993:token-a:3"))
  assert(repository.calls.includes("heartbeat:9007199254740993:token-a"))
  assert(repository.calls.includes("publish:9007199254740993:token-a:3"))
})

test("lost lease aborts checkpoint and publish", async () => {
  const repository = fakeRepository()
  repository.heartbeat = async () => false
  const result = await runCandidateWorker(options, {repository,
    prepare: async () => ({status: "prepared", prepared}), checkpointReusable: () => true,
    setInterval: () => 1, clearInterval: () => {}})
  assert.equal(result.lostClaim, 1)
  assert.equal(repository.calls.some((call) => call.startsWith("publish:")), false)
})

test("preparation failure is finished as retry and never imported", async () => {
  const repository = fakeRepository()
  const result = await runCandidateWorker(options, {repository,
    prepare: async () => ({status: "failed", error: {stage: "pricing", code: "pricing_unverified",
      message: "unknown pricing", retryable: true}}), checkpointReusable: () => false,
    setInterval: () => 1, clearInterval: () => {}})
  assert.equal(result.failed, 1)
  assert.equal(result.imported, 0)
  assert(repository.calls.includes("finish:9007199254740993:token-a:3:retry"))
})

test("cached checkpoint is re-checkpointed after claim restores ready before publish", async () => {
  const repository = fakeRepository([candidate({status: "ready", enriched_product: prepared,
    prepared_observation_revision: "3", normalization_result: prepared.normalization})])
  let state: "enriching" | "ready" = "enriching"
  repository.checkpoint = async () => { state = "ready"; repository.calls.push("checkpoint:cached"); return "ready" }
  repository.publish = async () => {
    assert.equal(state, "ready")
    repository.calls.push("publish:cached")
    return {outcome: "imported", product_id: "91"}
  }
  let prepares = 0
  const result = await runCandidateWorker(options, {repository,
    prepare: async () => { prepares += 1; return {status: "prepared", prepared} },
    checkpointReusable: (row) => row.prepared_observation_revision === row.observation_revision,
    setInterval: () => 1, clearInterval: () => {}})
  assert.equal(prepares, 0)
  assert.equal(result.imported, 1)
  assert(repository.calls.includes("checkpoint:cached"))
})

test("budget exhaustion releases every unprocessed claim", async () => {
  const repository = fakeRepository([candidate(), candidate({id: "2", processing_token: "token-b"})])
  let ticks = 0
  const result = await runCandidateWorker({...options, budgetMs: 1}, {repository,
    prepare: async () => ({status: "prepared", prepared}), checkpointReusable: () => false,
    now: () => ticks++ === 0 ? 0 : 2, setInterval: () => 1, clearInterval: () => {}})
  assert.equal(result.released, 2)
  assert(repository.calls.includes("finish:2:token-b:3:release"))
})

test("release accounting follows actual stale and lost-claim outcomes", async () => {
  const repository = fakeRepository([candidate(), candidate({id: "2", processing_token: "token-b"})])
  repository.finish = async (id) => id === "2" ? "lost_claim" : "stale"
  let ticks = 0
  const result = await runCandidateWorker({...options, budgetMs: 1}, {repository,
    prepare: async () => ({status: "prepared", prepared}), checkpointReusable: () => false,
    now: () => ticks++ === 0 ? 0 : 2, setInterval: () => 1, clearInterval: () => {}})
  assert.equal(result.released, 0)
  assert.equal(result.stale, 1)
  assert.equal(result.lostClaim, 1)
})

test("existing product conflict uses normalization-only CAS and preserves current fields", async () => {
  const repository = fakeRepository()
  repository.publish = async () => ({outcome: "conflicted", product_id: "91"})
  repository.currentProduct = async () => ({id: "91", updated_at: "2026-09-12T01:00:00Z",
    name: "current", brand: "current-brand", category: "other", subcategory: null, tags: ["current"]})
  repository.publishNormalization = async (input) => {
    assert.equal(input.expectedUpdatedAt, "2026-09-12T01:00:00Z")
    assert.equal(input.category, "clothing")
    assert.equal(input.subcategory, "tops")
    assert.deepEqual(Object.keys(input).sort(), ["candidateId", "category", "expectedUpdatedAt", "normalization", "productId", "revision", "subcategory", "token"])
    return {outcome: "imported", product_id: "91"}
  }
  const result = await runCandidateWorker(options, {repository,
    prepare: async () => ({status: "prepared", prepared}), checkpointReusable: () => true,
    normalizeCurrent: async (_candidate, current) => {
      assert.equal(current.name, "current")
      return {normalization: prepared.normalization, category: "clothing", subcategory: "tops"}
    }, setInterval: () => 1, clearInterval: () => {}})
  assert.equal(result.imported, 1)
})

test("dry-run entrypoint fails closed on missing DB setup without starting external work", () => {
  const env = {...process.env}
  delete env.DB_URL
  delete env.DB_TOKEN
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/refresh-candidates.ts", "--dry-run"],
    {cwd: process.cwd(), env, encoding: "utf8"})
  assert.equal(child.status, 1)
  assert.match(child.stderr, /DB_URL and DB_TOKEN are required/)
  assert.doesNotMatch(`${child.stdout}${child.stderr}`, /Qwen 준비|postgres(?:ql)?:\/\//i)
})

test("entrypoint writes a sanitized failed report when setup fails", () => {
  const env = {...process.env}
  delete env.DB_URL
  delete env.DB_TOKEN
  const report = join(mkdtempSync(join(tmpdir(), "candidate-report-")), "report.json")
  const child = spawnSync(process.execPath,
    ["--import", "tsx", "src/refresh-candidates.ts", "--dry-run", `--report=${report}`],
    {cwd: process.cwd(), env, encoding: "utf8"})
  assert.equal(child.status, 1)
  const parsed = JSON.parse(readFileSync(report, "utf8"))
  assert.equal(parsed.status, "failed")
  assert.equal(parsed.errors[0].stage, "setup")
  assert.doesNotMatch(JSON.stringify(parsed), /postgres(?:ql)?:\/\//i)
})

test("entrypoint help is read-only and does not require database setup", () => {
  const env = {...process.env}
  delete env.DB_URL
  delete env.DB_TOKEN
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/refresh-candidates.ts", "--help"],
    {cwd: process.cwd(), env, encoding: "utf8"})
  assert.equal(child.status, 0)
  assert.match(child.stdout, /--report=FILE/)
})

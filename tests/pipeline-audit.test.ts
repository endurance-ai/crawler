import assert from "node:assert/strict"
import {test} from "node:test"
import type {SupabaseClient} from "@supabase/supabase-js"
import {auditManifestCsv, createPipelineAuditManifest, pipelineAuditHash, type AuditCandidate, type AuditProduct} from "../src/lib/pipeline-audit"
import {readAuditPages, readPipelineAudit} from "../src/lib/pipeline-audit-reader"

const now = "2026-09-12T12:00:00Z"
const product: AuditProduct = {id: "9007199254740993", product_url: "https://shop.test/item", platform: "shop", brand: "Brand", brand_node_id: null,
  updated_at: "2026-09-12T11:00:00.123456Z", price: 100, original_price: 100, sale_price: null,
  in_stock: true, image_url: "https://shop.test/image.jpg", image_revision: "3", review_count: 20, reviews_observed_at: null}
const candidate: AuditCandidate = {id: "5", platform_key: "shop", product_url: "https://shop.test/candidate", status: "imported",
  updated_at: "2026-09-12T10:00:00Z", observation_revision: "1", prepared_observation_revision: null,
  raw_observed_at: null, matched_brand_node_id: "3", imported_product_id: "9", processing_token: null, lease_expires_at: null,
  attempt_count: 3, last_error_code: "normalization_failed", normalization_result: null, raw_product: {brand: "Brand"}}

test("audit distinguishes unverifiable legacy provenance from confirmed corruption and preserves CAS precision", () => {
  const input = {products: [product], candidates: [candidate], embeddings: [{product_id: product.id, source_image_url: null, source_image_revision: null, embedded_at: now, embedding_model: "legacy"}],
    brands: [{id: "3", brand_name: "Brand", brand_name_normalized: "brand"}], reviewCounts: new Map([[product.id, 2]]), now,
    scope: {platform: "shop", limit: null, max_observation_age_hours: 24}}
  const manifest = createPipelineAuditManifest(input)
  const byIssue = new Map(manifest.findings.map((finding) => [finding.issue, finding]))
  assert.equal(byIssue.get("embedding_provenance_unknown")?.certainty, "unverified")
  assert.equal(byIssue.get("candidate_import_completion_unverified")?.certainty, "unverified")
  assert.equal(byIssue.get("review_count_mismatch")?.certainty, "confirmed")
  assert.equal(byIssue.get("product_brand_missing")?.proposed.brand_node_id, "3")
  assert.equal(byIssue.get("product_brand_missing")?.expected.updated_at, product.updated_at)
  assert.deepEqual(createPipelineAuditManifest(input), manifest)
  assert.equal(manifest.content_hash, pipelineAuditHash({...manifest, content_hash: undefined}))
  assert.match(auditManifestCsv(manifest), /unverified/)

  const mismatch = createPipelineAuditManifest({...input, embeddings: [{...input.embeddings[0], source_image_url: product.image_url, source_image_revision: "1"}]})
  assert.equal(mismatch.findings.find((finding) => finding.issue === "embedding_source_mismatch")?.certainty, "confirmed")
})

test("audit avoids guessing brands, prevents active-lease recovery, and requires complete review counts", () => {
  const input = {products: [product], candidates: [{...candidate, status: "blocked", processing_token: "active-token", lease_expires_at: "2026-09-12T13:00:00Z"}], embeddings: [],
    brands: [{id: "3", brand_name: "Brand", brand_name_normalized: "brand"}, {id: "4", brand_name: "B.R.A.N.D", brand_name_normalized: "brand"}], reviewCounts: new Map([[product.id, 20]]), now,
    scope: {platform: null, limit: null, max_observation_age_hours: 24}}
  const manifest = createPipelineAuditManifest(input)
  assert.equal(manifest.findings.find((finding) => finding.issue === "product_brand_missing")?.action, "manual_review")
  assert.ok(manifest.findings.filter((finding) => finding.entity === "candidate").every((finding) => finding.action === "manual_review"))
  assert.throws(() => createPipelineAuditManifest({...input, reviewCounts: new Map()}), /Review count missing/)
})

test("keyset reader supports bigint IDs and fails closed on stalled or failed pages", async () => {
  const cursors: Array<string | null> = []
  const rows = await readAuditPages({decimal: true, pageSize: 1, id: (row: {id: string}) => row.id,
    fetchPage: async (cursor) => { cursors.push(cursor); return cursor === null ? [{id: "9007199254740993"}] : cursor === "9007199254740993" ? [{id: "9007199254740994"}] : [] }})
  assert.equal(rows.length, 2)
  assert.deepEqual(cursors, [null, "9007199254740993", "9007199254740994"])
  await assert.rejects(readAuditPages({decimal: true, pageSize: 1, id: (row: {id: string}) => row.id, fetchPage: async () => [{id: "1"}]}), /did not advance/)
  await assert.rejects(readAuditPages({id: (row: {id: string}) => row.id, fetchPage: async () => { throw new Error("read failed") }}), /read failed/)
})

test("database fixture reader uses only SELECT chains and captures filtered counts without mutations", async () => {
  const fixtures: Record<string, Array<Record<string, unknown>>> = {
    products: [{...product}], brand_nodes: [{id: "3", brand_name: "Brand", brand_name_normalized: "brand"}],
    product_reviews: [{id: "00000000-0000-0000-0000-000000000001", product_id: product.id}],
    product_embeddings: [{product_id: product.id, source_image_url: null, source_image_revision: null, embedded_at: now, embedding_model: "legacy"}],
    product_refresh_candidates: [{...candidate}],
  }
  let selects = 0
  const db = {from: (table: string) => {
    let rows = [...fixtures[table]]
    let take = 500
    const query = {
      select: () => { selects++; return query }, order: () => query,
      limit: (limit: number) => { take = limit; return query },
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return query },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[field])); return query },
      gt: () => { throw new Error("unexpected extra page") },
      abortSignal: async () => ({data: rows.slice(0, take), error: null}),
    }
    return new Proxy(query, {get: (target, key) => {
      if (!(key in target)) throw new Error(`Mutation or unsupported operation: ${String(key)}`)
      return target[key as keyof typeof target]
    }})
  }} as unknown as SupabaseClient
  const manifest = await readPipelineAudit(db, {platform: "shop", now})
  assert.equal(selects, 5)
  assert.deepEqual(manifest.scanned, {products: 1, candidates: 1, embeddings: 1})
  assert.equal(manifest.findings.find((finding) => finding.issue === "review_count_mismatch")?.proposed.review_count, 1)
})

/**
 * 재수집 보강 스크립트(src/enrich-products-file.ts)의 재개/재시도 규칙.
 *
 * 이 두 규칙이 깨지면 만 건짜리 배치가 조용히 망가진다:
 *   - 재개 마커를 잘못 읽으면 처음부터 다시 돌거나(수 시간 낭비) 미보강 항목을
 *     건너뛴다(옛 데이터가 그대로 적재됨).
 *   - 재시도 판정이 틀리면 영구 오류를 4번씩 재시도하거나(시간 3배) 일시적
 *     429 에서 상품을 버린다.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import {
  backoffMs,
  isRetryable,
  readProductsFile,
  selectEnrichTargets,
  writeProductsFile,
} from "../src/lib/enrich-file"
import type {Product} from "../src/lib/types"

function product(overrides: Partial<Product> = {}): Product {
  return {
    brand: "Brand",
    name: "Item",
    category: "tops",
    price: 10000,
    originalPrice: 10000,
    salePrice: null,
    priceFormatted: "₩10,000",
    imageUrl: "https://example.com/a.jpg",
    productUrl: "https://example.com/p/1",
    inStock: true,
    gender: ["unisex"],
    platform: "example",
    crawledAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  }
}

test("selectEnrichTargets: 이미 보강된 항목을 건너뛰고 원본 인덱스를 유지한다", () => {
  const products = [
    product({name: "a"}),
    product({name: "b", llmEnrichedAt: "2026-07-28T01:00:00.000Z"}),
    product({name: "c"}),
  ]
  const targets = selectEnrichTargets(products)

  assert.deepEqual(
    targets.map((t) => t.index),
    [0, 2],
    "보강된 b(index 1)는 빠지고, 나머지는 원본 배열 인덱스를 그대로 들고 있어야 한다",
  )
  assert.deepEqual(targets.map((t) => t.product.name), ["a", "c"])
})

test("selectEnrichTargets: --force 는 보강된 항목까지 다시 잡는다", () => {
  const products = [product({llmEnrichedAt: "2026-07-28T01:00:00.000Z"}), product()]
  assert.equal(selectEnrichTargets(products).length, 1)
  assert.equal(selectEnrichTargets(products, {force: true}).length, 2)
})

test("selectEnrichTargets: --limit 은 미보강분에만 적용된다", () => {
  // 이미 보강된 항목이 limit 을 잡아먹으면, 재개할 때마다 진도가 0이 된다.
  const products = [
    product({name: "done", llmEnrichedAt: "2026-07-28T01:00:00.000Z"}),
    product({name: "a"}),
    product({name: "b"}),
  ]
  const targets = selectEnrichTargets(products, {limit: 2})
  assert.deepEqual(targets.map((t) => t.product.name), ["a", "b"])
})

test("isRetryable: 일시적 오류만 재시도한다", () => {
  for (const message of [
    "429 Too Many Requests",
    "rate limit exceeded",
    "503 Service Unavailable",
    "Model is overloaded",
    "socket hang up ECONNRESET",
    "page.goto: Timeout 60000ms exceeded",
  ]) {
    assert.equal(isRetryable(new Error(message)), true, `재시도 대상이어야 함: ${message}`)
  }

  for (const message of [
    "Invalid schema: category must be one of ...",
    "OPENAI_API_KEY is required",
    "401 Unauthorized",
  ]) {
    assert.equal(isRetryable(new Error(message)), false, `재시도하면 안 됨: ${message}`)
  }
})

test("isRetryable: 동일 출처 가드 위반은 재시도하지 않는다", () => {
  // assertSameSource 는 config 가 틀렸다는 뜻이라 몇 번을 다시 해도 같다.
  // 'timeout' 같은 단어가 섞여 들어와도 이 판정이 이겨야 한다.
  assert.equal(
    isRetryable(new Error("candidate URL host differs from source config: https://other.com/p/1")),
    false,
  )
})

test("backoffMs: 지수 증가하되 30초에서 멈춘다", () => {
  assert.equal(backoffMs(0), 1000)
  assert.equal(backoffMs(1), 2000)
  assert.equal(backoffMs(2), 4000)
  assert.equal(backoffMs(10), 30_000)
})

test("writeProductsFile: 원자적으로 쓰고 임시 파일을 남기지 않는다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enrich-file-"))
  const file = path.join(dir, "x-products.json")
  try {
    const products = [product({name: "a"}), product({name: "b", llmEnrichedAt: "2026-07-28T01:00:00.000Z"})]
    writeProductsFile(file, products)

    assert.ok(!fs.existsSync(`${file}.tmp`), "임시 파일이 남으면 안 된다")
    const roundTripped = readProductsFile(file)
    assert.deepEqual(roundTripped, products, "저장→로드가 동형이어야 재개가 성립한다")

    // 덮어쓰기도 원자적이어야 한다 (체크포인트는 같은 파일을 반복해서 쓴다).
    writeProductsFile(file, [product({name: "c"})])
    assert.deepEqual(readProductsFile(file).map((p) => p.name), ["c"])
    assert.ok(!fs.existsSync(`${file}.tmp`))
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test("readProductsFile: 최상위가 배열이 아니면 거부한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enrich-file-"))
  const file = path.join(dir, "bad.json")
  try {
    fs.writeFileSync(file, JSON.stringify({products: []}), "utf-8")
    assert.throws(() => readProductsFile(file), /배열이 아님/)
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

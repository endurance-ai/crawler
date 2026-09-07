import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  compareProductImageCanaryRuns,
  stratifiedProductImageSample,
  type ProductImageCanaryProductResult,
  type ProductImageCanaryRun,
  type ProductImageCanaryRow,
} from "../src/lib/product-image-cv-canary"

function row(id: number, platformType: string, category: string, imageCount: number): ProductImageCanaryRow {
  return {
    id,
    platform: `${platformType}-${id}`,
    platformType,
    category,
    productUrl: `https://shop.example/products/${id}`,
    imageUrl: `https://cdn.example/${id}-0.jpg`,
    images: Array.from({length: imageCount}, (_, index) => `https://cdn.example/${id}-${index}.jpg`),
  }
}

test("stratified sample covers platform/category/image-count groups before taking seconds", () => {
  const rows = [
    row(1, "cafe24", "tops", 1),
    row(2, "cafe24", "tops", 1),
    row(3, "shopify", "tops", 6),
    row(4, "imweb", "bags", 10),
  ]
  const sampled = stratifiedProductImageSample(rows, 3)
  assert.equal(sampled.length, 3)
  assert.deepEqual(new Set(sampled.map((item) => item.platformType)), new Set(["cafe24", "shopify", "imweb"]))
  assert.deepEqual(stratifiedProductImageSample(rows, 3), sampled)
})

function result(id: number, selectedUrl: string, kind: "model" | "product", utility = false): ProductImageCanaryProductResult {
  return {
    id,
    platform: "shop",
    platformType: "shopify",
    category: "tops",
    productUrl: `https://shop.example/products/${id}`,
    beforeUrl: selectedUrl,
    selectedUrl,
    kind,
    score: 80,
    errors: [],
    wallMs: 100,
    candidates: [{
      url: selectedUrl,
      width: 1200,
      height: 1600,
      byteLength: 1000,
      mimeType: "image/jpeg",
      decoded: true,
      isAnimated: false,
      isUtility: utility,
      aestheticsScore: 0,
      textCoverage: 0,
      humanConfidence: kind === "model" ? 0.9 : 0,
      humanAreaRatio: kind === "model" ? 0.5 : 0,
      humanCenterDistance: 0,
      poseJointCount: kind === "model" ? 12 : 0,
      foregroundAreaRatio: 0.5,
      foregroundCenterDistance: 0,
    }],
  }
}

function run(backend: "linux-cv" | "apple-vision", products: ProductImageCanaryProductResult[]): ProductImageCanaryRun {
  return {
    schemaVersion: 1,
    backend,
    generatedAt: new Date(0).toISOString(),
    concurrency: 1,
    ocrWorkers: backend === "linux-cv" ? 2 : null,
    products,
    candidateTimings: [],
    cvTimings: [],
    metrics: {wallMs: 1, cpuMs: 1, peakRssBytes: 1, peakLoad1: 0},
  }
}

test("comparison reports agreement, model coverage, severe selections, and manual alternatives", () => {
  const linux = run("linux-cv", [
    result(1, "https://cdn.example/same.jpg", "model"),
    result(2, "https://cdn.example/linux.jpg", "product", true),
  ])
  const apple = run("apple-vision", [
    result(1, "https://cdn.example/same.jpg", "model"),
    result(2, "https://cdn.example/apple.jpg", "model"),
  ])
  const compared = compareProductImageCanaryRuns(linux, apple, [
    {productId: 2, verdict: "acceptable"},
  ])
  assert.equal(compared.compared, 2)
  assert.equal(compared.agreementRate, 0.5)
  assert.equal(compared.modelShotSelectionRate, 0.5)
  assert.equal(compared.automatedSevereCount, 1)
  assert.equal(compared.automatedUtilityCount, 1)
  assert.equal(compared.automatedBrokenCount, 0)
  assert.equal(compared.acceptableDifferentCount, 1)
  assert.equal(compared.acceptableDifferentRate, 1)
  assert.equal(compared.reviewComplete, true)
  assert.equal(compared.passesSevereThreshold, false)
})

test("comparison does not pass before every Apple disagreement is reviewed", () => {
  const linux = run("linux-cv", [result(1, "https://cdn.example/linux.jpg", "model")])
  const apple = run("apple-vision", [result(1, "https://cdn.example/apple.jpg", "model")])
  const compared = compareProductImageCanaryRuns(linux, apple)
  assert.equal(compared.automatedSevereRate, 0)
  assert.equal(compared.reviewComplete, false)
  assert.equal(compared.passesSevereThreshold, false)
})

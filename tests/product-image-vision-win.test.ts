import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as path from "node:path"

import {
  resolveOcrWorkerPoolSize,
  WinProductImageVisionClient,
  type ProductImageCvTiming,
} from "../src/lib/product-image-vision-win"

test("OCR worker pool defaults to 2 and rejects unsafe values", () => {
  assert.equal(resolveOcrWorkerPoolSize(Number.NaN), 2)
  assert.equal(resolveOcrWorkerPoolSize(1), 1)
  assert.equal(resolveOcrWorkerPoolSize(4), 4)
  assert.equal(resolveOcrWorkerPoolSize(8), 2)
})

test(
  "local Windows/Linux CV pipeline decodes an image and returns the analysis shape",
  {skip: process.platform === "darwin", timeout: 60_000},
  async () => {
    const fixture = path.join(process.cwd(), "tests", "fixtures", "image-selection", "solid.png")
    const stat = await fs.stat(fixture)
    const timings: ProductImageCvTiming[] = []
    const client = new WinProductImageVisionClient({
      ocrWorkerPoolSize: 1,
      onTiming: (timing) => timings.push(timing),
    })
    try {
      const result = await client.analyze({
        path: fixture,
        url: "https://example.com/solid.png",
        byteLength: stat.size,
        mimeType: "image/png",
      })
      assert.equal(result.url, "https://example.com/solid.png")
      assert.equal(result.decoded, true)
      assert.equal(result.width, 4)
      assert.equal(result.height, 4)
      assert.equal(result.humanConfidence, 0)
      assert.equal(result.poseJointCount, 0)
      assert.ok(result.aestheticsScore >= -1 && result.aestheticsScore <= 1)
      assert.ok(result.textCoverage >= 0 && result.textCoverage <= 1)
      assert.equal(timings.length, 1)
      assert.equal(timings[0].url, result.url)
      assert.ok(timings[0].totalMs > 0)
      assert.ok(timings[0].yoloMs >= 0)
      assert.ok(timings[0].ocrMs >= 0)
    } finally {
      await client.close()
    }
  },
)

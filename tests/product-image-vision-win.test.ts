import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as path from "node:path"

import {WinProductImageVisionClient} from "../src/lib/product-image-vision-win"

test(
  "Windows/Linux CV pipeline decodes locally and closes without loading external models",
  {timeout: 5_000},
  async () => {
    const fixture = path.join(process.cwd(), "tests", "fixtures", "image-selection", "solid.png")
    const stat = await fs.stat(fixture)
    const calls: string[] = []
    const client = new WinProductImageVisionClient({
      operations: {
        detectPeople: async (imagePath) => {
          calls.push(`pose:${imagePath}`)
          return {
            humanConfidence: 0,
            humanAreaRatio: 0,
            humanCenterDistance: 1,
            poseJointCount: 0,
          }
        },
        detectTextCoverage: async (imagePath, width, height) => {
          calls.push(`ocr:${imagePath}:${width}x${height}`)
          return 0
        },
        close: async () => {
          calls.push("close")
        },
      },
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
      assert.deepEqual(calls, [
        `pose:${fixture}`,
        `ocr:${fixture}:4x4`,
      ])
    } finally {
      await client.close()
    }
    assert.equal(calls.at(-1), "close")
  },
)

test("Windows/Linux CV pipeline falls back when OCR exceeds its deadline", {timeout: 5_000}, async () => {
  const fixture = path.join(process.cwd(), "tests", "fixtures", "image-selection", "solid.png")
  const stat = await fs.stat(fixture)
  const client = new WinProductImageVisionClient({
    operations: {
      detectPeople: async () => ({
        humanConfidence: 0,
        humanAreaRatio: 0,
        humanCenterDistance: 1,
        poseJointCount: 0,
      }),
      detectTextCoverage: () => new Promise(() => undefined),
    },
    ocrJobTimeoutMs: 25,
  })

  try {
    const startedAt = Date.now()
    const result = await client.analyze({
      path: fixture,
      url: "https://example.com/solid.png",
      byteLength: stat.size,
      mimeType: "image/png",
    })
    assert.equal(result.textCoverage, 0)
    assert.ok(Date.now() - startedAt < 1_000)
  } finally {
    await client.close()
  }
})

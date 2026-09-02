import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as path from "node:path"

import {WinProductImageVisionClient} from "../src/lib/product-image-vision-win"

test(
  "local Windows/Linux CV pipeline decodes an image and returns the analysis shape",
  {skip: process.platform === "darwin", timeout: 60_000},
  async () => {
    const fixture = path.join(process.cwd(), "tests", "fixtures", "image-selection", "solid.png")
    const stat = await fs.stat(fixture)
    const client = new WinProductImageVisionClient()
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
    } finally {
      await client.close()
    }
  },
)

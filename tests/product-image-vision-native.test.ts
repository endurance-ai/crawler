import {test} from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

import {ProductImageVisionClient} from "../src/lib/product-image-vision-client"

test(
  "native Apple Vision helper compiles and returns deterministic image metadata",
  {skip: process.platform !== "darwin", timeout: 30_000},
  async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "kiko-image-vision-test-"))
    const fixture = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "image-selection",
      "solid.ppm",
    )
    const stat = await fs.stat(fixture)
    const client = new ProductImageVisionClient(cacheDir)
    try {
      const result = await client.analyze({
        path: fixture,
        url: "https://example.com/solid.ppm",
        byteLength: stat.size,
        mimeType: "image/x-portable-pixmap",
      })
      assert.equal(result.decoded, true)
      assert.equal(result.width, 4)
      assert.equal(result.height, 4)
      assert.equal(result.url, "https://example.com/solid.ppm")
    } finally {
      await client.close()
      await fs.rm(cacheDir, {recursive: true, force: true})
    }
  },
)

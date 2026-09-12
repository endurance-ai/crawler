import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import {test} from "node:test"

const script = path.resolve("tools/pipeline-artifact.mjs")
test("artifact resume binds both configuration and the exact post-import artifact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pipeline-artifact-"))
  try {
    const artifact = path.join(directory, "products.json")
    const config = path.join(directory, "config.json")
    const stamp = path.join(directory, "stamp.json")
    await writeFile(artifact, "original crawl")
    await writeFile(config, '[{"key":"a"}]')
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], {encoding: "utf8"})
    const hash = run("input-hash", config, "existing", "include-stock").stdout.trim()
    assert.match(hash, /^[a-f0-9]{64}$/)
    assert.equal(run("check", stamp, artifact, hash).status, 1)
    assert.equal(run("record", stamp, artifact, hash).status, 0)
    assert.equal(run("check", stamp, artifact, hash).status, 0)
    const changedFlags = run("input-hash", config, "hybrid", "include-stock").stdout.trim()
    assert.notEqual(changedFlags, hash)
    assert.equal(run("check", stamp, artifact, changedFlags).status, 1)
    await writeFile(artifact, "new forced crawl")
    assert.equal(run("check", stamp, artifact, hash).status, 1)
    assert.equal(JSON.parse(await readFile(stamp, "utf8")).input_hash, hash)
  } finally { await rm(directory, {recursive: true, force: true}) }
})

import {createHash, randomUUID} from "node:crypto"
import {realpathSync} from "node:fs"
import {readFile, rename, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"

export async function artifactHash(filename) {
  return createHash("sha256").update(await readFile(filename)).digest("hex")
}

export async function checkArtifactStamp(stampPath, artifactPath, inputHash) {
  try {
    const stamp = JSON.parse(await readFile(stampPath, "utf8"))
    return stamp.schema_version === 1 && stamp.input_hash === inputHash &&
      stamp.artifact_sha256 === await artifactHash(artifactPath)
  } catch { return false }
}

async function main() {
  const [command, first, second, ...rest] = process.argv.slice(2)
  if (command === "input-hash") {
    const hash = createHash("sha256").update(await readFile(first))
    hash.update(JSON.stringify([second, ...rest]))
    console.log(hash.digest("hex"))
  } else if (command === "check") {
    process.exitCode = await checkArtifactStamp(first, second, rest[0]) ? 0 : 1
  } else if (command === "record") {
    const temporary = `${first}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({schema_version: 1, input_hash: rest[0], artifact_sha256: await artifactHash(second)}), {flag: "wx", mode: 0o600})
    await rename(temporary, first)
  } else throw new Error("Invalid artifact command")
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  main().catch(() => { console.error("Artifact provenance check failed"); process.exitCode = 2 })
}

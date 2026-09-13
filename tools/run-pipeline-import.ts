import {spawn} from "node:child_process"
import {randomUUID} from "node:crypto"
import {realpathSync} from "node:fs"
import {readFile} from "node:fs/promises"
import * as path from "node:path"
import {pathToFileURL} from "node:url"
import {
  addPipelineError, assessPipelineChild, createPipelineReport, finalizePipelineReport,
  pipelineExitCode, readPipelineReport, writePipelineReport,
} from "../src/lib/pipeline-report"
import type {PipelineReport} from "../src/lib/pipeline-integrity-types"

export async function runPipelineImports(options: {
  keys: string[]
  expectedKeys: string[]
  reportDirectory: string
  importFlags: string[]
  runChild: (key: string, reportPath: string, flags: string[]) => Promise<number | null>
}): Promise<PipelineReport> {
  const report = createPipelineReport({mode: "apply"})
  const keys = new Set(options.keys)
  for (const key of new Set(options.expectedKeys)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid platform key")
    const childPath = path.join(options.reportDirectory, `${key}-${randomUUID()}.json`)
    let child: PipelineReport | null = null
    let code: number | null = null
    if (keys.has(key)) {
      try {
        code = await options.runChild(key, childPath, options.importFlags)
        child = await readPipelineReport(childPath)
      } catch {
        // Missing/malformed reports and spawn errors are never inferred from logs.
      }
    }
    const assessment = assessPipelineChild(child, code, [key])
    const errors = child?.errors ?? []
    const files = child?.files.filter((file) => file.platform === key) ?? []
    const counts = child?.counts ?? {}
    for (const [name, count] of Object.entries(counts)) report.counts[name] = (report.counts[name] ?? 0) + count
    if (!assessment.success) {
      const error = {
        stage: keys.has(key) ? "import" : "finalize",
        code: keys.has(key) ? "CHILD_IMPORT_INCOMPLETE" : "CRAWL_QC_INCOMPLETE",
        message: keys.has(key) ? "Import child exit/report did not confirm completion" : "Platform did not pass crawl/finalization",
        retryable: true, platform: key,
      }
      addPipelineError(report, error)
      report.files.push({platform: key, status: assessment.applied > 0 ? "partial" : "failed", counts, errors: [...errors, error]})
    } else {
      report.files.push({platform: key, status: "success", counts, errors: files.flatMap((file) => file.errors)})
    }
  }
  return finalizePipelineReport(report)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const separator = args.indexOf("--")
  const options = separator < 0 ? args : args.slice(0, separator)
  const importFlags = separator < 0 ? [] : args.slice(separator + 1)
  const arg = (name: string) => options.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const reportPath = arg("report")
  const expectedPath = arg("expected-configs")
  const keysPath = arg("keys-file")
  if (!reportPath || !expectedPath || !keysPath || importFlags.some((flag) => /^--(?:report|dry-run|site)(?:=|$)/.test(flag))) {
    throw new Error("Expected --report, --expected-configs, --keys-file; reserved import flags are not allowed")
  }
  const keys: unknown = JSON.parse(await readFile(keysPath, "utf8"))
  const configs: unknown = JSON.parse(await readFile(expectedPath, "utf8"))
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string") || !Array.isArray(configs) ||
    !configs.every((config) => config && typeof config.key === "string")) throw new Error("Invalid platform input files")
  const report = await runPipelineImports({
    keys, expectedKeys: configs.map((config) => config.key), reportDirectory: path.join(path.dirname(reportPath), "imports"), importFlags,
    runChild: (key, childReport, flags) => new Promise((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/import-products.ts", `--site=${key}`, ...flags, `--report=${childReport}`], {stdio: "inherit"})
      child.once("error", () => resolve(null))
      child.once("close", resolve)
    }),
  })
  await writePipelineReport(reportPath, report)
  process.exitCode = pipelineExitCode(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(() => { console.error("Import wrapper setup/report error"); process.exitCode = 2 })
}

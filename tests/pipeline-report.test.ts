import assert from "node:assert/strict"
import {mkdtemp, readdir, rm, writeFile} from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {spawnSync} from "node:child_process"
import {test} from "node:test"
import {
  addPipelineError, assessPipelineChild, createPipelineReport, finalizePipelineReport,
  pipelineExitCode, readPipelineReport, writePipelineReport,
} from "../src/lib/pipeline-report"
import {runPipelineImports} from "../tools/run-pipeline-import"

test("policy exclusions complete successfully while pending and partial writes fail", () => {
  const planned = createPipelineReport({mode: "dry_run"})
  planned.counts = {input: 2, policy_excluded: 2}
  assert.equal(finalizePipelineReport(planned).status, "planned")
  const report = createPipelineReport({mode: "apply"})
  report.counts = {input: 2, policy_excluded: 2}
  assert.equal(finalizePipelineReport(report).status, "success")
  report.counts = {input: 2, pending: 2}
  assert.equal(finalizePipelineReport(report).status, "failed")
  report.counts = {input: 2, inserted: 1, failed: 1}
  const finished = finalizePipelineReport(report)
  assert.equal(finished.status, "partial")
  assert.equal(pipelineExitCode(finished), 1)
  assert.equal(finalizePipelineReport({...planned, errors: [{stage: "setup", code: "DB_ERROR", message: "lookup failed", retryable: true}]}).status, "failed")
})

test("atomic report roundtrip excludes credentials and leaves no temporary files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pipeline-report-test-"))
  try {
    const report = createPipelineReport({mode: "apply"})
    addPipelineError(report, {stage: "write", code: "DB_ERROR", message: "https://user:secret@example.com?q=token Bearer abc.def token=private", retryable: true, productUrl: "https://user:secret@example.com/item?token=private"})
    const filename = path.join(directory, "report.json")
    await writePipelineReport(filename, finalizePipelineReport(report))
    const result = await readPipelineReport(filename)
    assert.equal(result.errors[0].productUrl, "https://example.com/item")
    assert.doesNotMatch(JSON.stringify(result), /private|abc\.def|user:secret/)
    assert.deepEqual(await readdir(directory), ["report.json"])
    await writeFile(filename, JSON.stringify({...result, counts: {inserted: -1}}))
    await assert.rejects(readPipelineReport(filename), /Invalid/)
    await assert.rejects(writePipelineReport(filename, report), /incomplete/)
  } finally { await rm(directory, {recursive: true, force: true}) }
})

test("child exit code, terminal report, mode and per-platform coverage all matter", () => {
  const report = createPipelineReport({mode: "apply"})
  report.files = [{platform: "brand-a", status: "success", counts: {policy_excluded: 2}, errors: []}]
  const complete = finalizePipelineReport(report)
  assert.equal(assessPipelineChild(complete, 0, ["brand-a"]).success, true)
  assert.deepEqual(assessPipelineChild(complete, 1, ["brand-a"]).failedPlatforms, ["brand-a"])
  assert.deepEqual(assessPipelineChild(complete, 0, ["brand-a", "brand-b"]).failedPlatforms, ["brand-b"])
  assert.equal(assessPipelineChild({...complete, ended_at: null}, 0, ["brand-a"]).success, false)
  assert.equal(assessPipelineChild(finalizePipelineReport({...report, mode: "dry_run"}), 0, ["brand-a"]).success, false)
})

test("wrapper preserves actual applied counts and rejects missing reports despite successful child logs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pipeline-wrapper-test-"))
  const called: string[] = []
  try {
    const report = await runPipelineImports({
      keys: ["ok", "bad", "missing"], expectedKeys: ["ok", "bad", "missing", "qc"], reportDirectory: directory, importFlags: [],
      runChild: async (key, reportPath) => {
        called.push(key)
        if (key === "missing") return 0
        const childReport = createPipelineReport({mode: "apply"})
        childReport.counts = {inserted: 1}
        childReport.files = [{platform: key, status: "success", counts: {inserted: 1}, errors: []}]
        // Fake child CLI exercises a real process and independently written file.
        const child = spawnSync(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1], process.argv[2]); process.exit(Number(process.argv[3]))", reportPath, JSON.stringify(finalizePipelineReport(childReport)), key === "bad" ? "1" : "0"])
        return child.status
      },
    })
    assert.deepEqual(called, ["ok", "bad", "missing"])
    assert.equal(report.status, "partial")
    assert.equal(report.counts.inserted, 2)
    assert.deepEqual(report.files.map((file) => [file.platform, file.status]), [["ok", "success"], ["bad", "partial"], ["missing", "failed"], ["qc", "failed"]])
    assert.equal(report.errors.length, 3)
  } finally { await rm(directory, {recursive: true, force: true}) }
})

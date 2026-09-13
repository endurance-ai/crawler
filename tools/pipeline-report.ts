import {addPipelineError, assessPipelineChild, finalizePipelineReport, readPipelineReport, writePipelineReport} from "../src/lib/pipeline-report"

async function main() {
  const [command, filename, argument] = process.argv.slice(2)
  if (!filename) throw new Error("Report file required")
  const report = await readPipelineReport(filename)
  if (command === "count") {
    console.log(argument === "applied"
      ? (report.counts.inserted ?? 0) + (report.counts.updated ?? 0) + (report.counts.unchanged ?? 0)
      : report.counts[argument] ?? 0)
  } else if (command === "check") {
    process.exitCode = assessPipelineChild(report, 0, argument ? [argument] : report.files.map((file) => file.platform)).success ? 0 : 1
  } else if (command === "fail") {
    addPipelineError(report, {stage: argument ?? "wrapper", code: "WRAPPER_STAGE_FAILED", message: "Required wrapper stage failed", retryable: true})
    await writePipelineReport(filename, finalizePipelineReport(report))
  } else throw new Error("Unknown report command")
}
main().catch(() => { console.error("Missing or invalid pipeline report"); process.exitCode = 2 })

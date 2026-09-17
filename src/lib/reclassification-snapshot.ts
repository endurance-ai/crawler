import * as os from "node:os"
import * as path from "node:path"

export function reclassificationSnapshotPath(
  prefix: string,
  generatedAt: string,
  tempDirectory = os.tmpdir(),
): string {
  return path.join(
    tempDirectory,
    `${prefix}-${generatedAt.replace(/[:.]/g, "-")}.json`,
  )
}

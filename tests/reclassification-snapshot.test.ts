import assert from "node:assert/strict"
import test from "node:test"

import {reclassificationSnapshotPath} from "../src/lib/reclassification-snapshot"

test("재분류 감사 파일은 운영체제 임시 디렉터리 아래에 안전한 이름으로 생성한다", () => {
  assert.equal(
    reclassificationSnapshotPath(
      "legacy-unisex-reclassification",
      "2026-09-17T12:06:13.571Z",
      "/tmp",
    ),
    "/tmp/legacy-unisex-reclassification-2026-09-17T12-06-13-571Z.json",
  )
})

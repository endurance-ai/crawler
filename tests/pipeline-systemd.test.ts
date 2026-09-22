import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import test from "node:test"

const unit = (name: string) => readFileSync(new URL(`../deploy/systemd/lab/${name}`, import.meta.url), "utf8")

test("candidate and catalog workers have independent timers", () => {
  assert.match(unit("kiko-refresh-candidates.timer"), /Unit=kiko-refresh-candidates\.service/)
  assert.match(unit("kiko-catalog-pipeline.timer"), /Unit=kiko-catalog-pipeline\.service/)
  assert.doesNotMatch(unit("kiko-refresh.service"), /OnSuccess=/)
  assert.doesNotMatch(unit("kiko-refresh-candidates.service"), /OnSuccess=/)
  assert.doesNotMatch(unit("kiko-refresh-candidates.service"), /After=.*kiko-refresh\.service/)
})

test("candidate worker uses the time budget before the total limit", () => {
  assert.match(unit("kiko-refresh-candidates.service"), /--budget-minutes=90 --limit=1000/)
})

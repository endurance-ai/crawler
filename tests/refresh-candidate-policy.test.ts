import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import test from "node:test"

import {shouldObserveRefreshCandidates} from "../src/lib/refresh-candidate-policy"

test("nightly existing refresh can reuse its listing observation for discovery", () => {
  assert.equal(shouldObserveRefreshCandidates({
    auditPrices: false,
    priceOnly: false,
    existingOnly: true,
    discoverCandidates: true,
  }), true)
})

test("price-only and audit modes never publish candidate observations", () => {
  for (const mode of [{auditPrices: true, priceOnly: false}, {auditPrices: false, priceOnly: true}]) {
    assert.equal(shouldObserveRefreshCandidates({
      ...mode,
      existingOnly: false,
      discoverCandidates: true,
    }), false)
  }
})

test("nightly refresh phases explicitly enable candidate discovery", () => {
  const script = readFileSync(new URL("../scripts/run-refresh-daily.sh", import.meta.url), "utf8")
  const existingOnly = script.match(/--existing-only/g)?.length ?? 0
  const discovery = script.match(/--discover-candidates/g)?.length ?? 0
  assert(existingOnly > 0)
  assert.equal(discovery, existingOnly)
})

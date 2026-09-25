import assert from "node:assert/strict"
import test from "node:test"

import {assessRollingListingHealth} from "../src/lib/refresh-listing-health"

const healthy = {
  attempted_slices: 8,
  completed_sources: 2,
  partial_slices: 6,
  skipped_sources: 0,
  failed_slices: 0,
  confirmed_products: 2_939,
  updated_products: 40,
  update_failures: 0,
  last_seen_failures: 0,
  telemetry_failures: 0,
  guard_tripped: 0,
}

test("rolling listing accepts normal partial source slices as progress", () => {
  assert.deepEqual(assessRollingListingHealth(healthy), {
    status: "success", reason: "none", write_attempted: 2_979,
  })
  assert.equal(assessRollingListingHealth({...healthy, skipped_sources: 1, partial_slices: 5}).status, "degraded")
  assert.equal(assessRollingListingHealth({...healthy, telemetry_failures: 1}).status, "degraded")
  assert.equal(assessRollingListingHealth({...healthy, last_seen_failures: 2}).status, "degraded")
})

test("rolling listing fails on widespread source or DB write failures", () => {
  assert.equal(assessRollingListingHealth({...healthy, completed_sources: 0, partial_slices: 0, skipped_sources: 8}).reason, "no_progress")
  assert.equal(assessRollingListingHealth({...healthy, failed_slices: 3}).reason, "source_failure_rate")
  assert.equal(assessRollingListingHealth({...healthy, last_seen_failures: 65}).reason, "db_write_rate")
  assert.equal(assessRollingListingHealth({...healthy, attempted_slices: 0, completed_sources: 0, partial_slices: 0,
    confirmed_products: 0, updated_products: 0}).status, "success")
})

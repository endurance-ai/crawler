import assert from "node:assert/strict"
import test from "node:test"
import {genderFieldsFromPoc, genderFieldsToPoc} from "../src/lib/onboard-gender-transport"

test("crawler gender evidence survives the POC and import-file boundary", () => {
  const poc = genderFieldsToPoc({
    gender: ["women"],
    genderSource: "engine",
    tags: ["Women", "New"],
  })

  assert.deepEqual(poc, {
    gender: ["women"],
    gender_source: "engine",
    tags: ["Women", "New"],
  })
  assert.deepEqual(genderFieldsFromPoc(poc), {
    gender: ["women"],
    genderSource: "engine",
    tags: ["Women", "New"],
  })
})

test("missing engine evidence stays unresolved instead of becoming unisex", () => {
  assert.deepEqual(genderFieldsFromPoc({}), {gender: []})
})

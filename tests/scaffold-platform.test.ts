/**
 * Smoke test for the SPEC-ARCH-CRAWLER-001 Phase 3 (REQ-CRAWLER-006)
 * new-platform scaffold tool.
 *
 * SPEC: SPEC-ARCH-CRAWLER-001 REQ-CRAWLER-006.
 * Runs via: npm test (node --test --import tsx ./tests/*.test.ts)
 *
 * SCOPE — NEW-CODE test for the scaffold tool itself; no runtime parser is
 * touched. The tool's pure functions are imported IN-PROCESS (the script
 * entry is guarded so importing it never generates anything) so this is
 * sub-millisecond: no subprocess, no fs writes, no browser. It asserts the
 * generated skeleton mirrors the Phase 2/3 contracts (Parser<> from
 * parser-strategy.ts, RegistryEntry from selector-registry.ts, the
 * register() wiring snippet) and that the key validator fails loud.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"

import {
  parseArgs,
  strategyStub,
  wiringSnippets,
  toClassStem,
  ScaffoldError,
} from "../tools/scaffold-platform"

test("REQ-006 scaffold generates a Parser-strategy + RegistryEntry skeleton", () => {
  const {key, displayName} = parseArgs(["acmestore", "--name", "Acme Store"])
  const stub = strategyStub(key, displayName)
  const snip = wiringSnippets(key, displayName)

  // mirrors parser-strategy.ts:Parser<I,O> + readonly platform
  assert.match(stub, /implements Parser<AcmestoreParseInput, Promise<DetailData>>/)
  assert.match(stub, /readonly platform = "acmestore"/)
  // mirrors detail/types.ts:DetailData via the Promise<DetailData> return
  assert.match(stub, /async parse\(_input: AcmestoreParseInput\): Promise<DetailData>/)
  // mirrors selector-registry.ts:RegistryEntry
  assert.match(stub, /ACMESTORE_REGISTRY_ENTRY: RegistryEntry/)
  assert.match(stub, /strategy: "base"/)
  // mirrors parser-strategy.ts:defaultParserRegistry.register chain
  assert.match(snip, /\.register\("acmestore", \(\) => new AcmestoreParserStrategy\(\)\)/)
  // characterization-test-first guidance is surfaced (DDD PRESERVE gate)
  assert.match(snip, /characterization test for "acmestore" BEFORE/)
})

test("REQ-006 scaffold key->ClassStem mapping handles kebab keys", () => {
  assert.equal(toClassStem("acmestore"), "Acmestore")
  assert.equal(toClassStem("acme-store"), "AcmeStore")
  assert.equal(toClassStem("a-b-c"), "ABC")
})

test("REQ-006 scaffold defaults display name to the key, parses --write", () => {
  const a = parseArgs(["solosite"])
  assert.equal(a.displayName, "solosite")
  assert.equal(a.write, false)
  const b = parseArgs(["solosite", "--write"])
  assert.equal(b.write, true)
  const c = parseArgs(["solosite", "--name=Solo Site"])
  assert.equal(c.displayName, "Solo Site")
})

test("REQ-006 scaffold rejects an invalid platform key (loud failure)", () => {
  assert.throws(() => parseArgs(["Bad Key!"]), ScaffoldError)
  assert.throws(() => parseArgs(["8division"]), /Invalid platform key/)
})

test("REQ-006 scaffold requires a key argument", () => {
  assert.throws(() => parseArgs([]), /Usage: tsx tools\/scaffold-platform\.ts/)
})

test("REQ-006 scaffold --name requires a value", () => {
  assert.throws(() => parseArgs(["solosite", "--name"]), /--name requires a value/)
})

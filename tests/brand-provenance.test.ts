import assert from "node:assert/strict"
import test from "node:test"

import {
  isTrustedBrandSource,
  partitionUnknownBrands,
  recordUnknownBrand,
  resolveProductBrand,
  type UnknownBrandEntry,
} from "../src/lib/brand-provenance"

test("단일브랜드몰은 페이지 추출값 대신 config.brand를 그대로 쓴다", () => {
  assert.equal(
    resolveProductBrand("판매가 : 39,000, 상품명 : 니트", {brand: "Marge Sherwood"}),
    "Marge Sherwood",
  )
  assert.equal(resolveProductBrand("translated vendor", {brand: "A.P.C."}), "A.P.C.")
})

test("멀티브랜드몰은 상품에서 추출한 브랜드명을 그대로 유지한다", () => {
  assert.equal(
    resolveProductBrand("Maison Margiela", {brand: "Store Operator", multiBrand: true}),
    "Maison Margiela",
  )
  assert.equal(resolveProductBrand("  KITH  ", {multiBrand: true}), "KITH")
})

test("단일브랜드 자사몰만 신규 brand_nodes 자동 생성을 신뢰한다", () => {
  assert.equal(isTrustedBrandSource({selfBranded: true}), true)
  assert.equal(isTrustedBrandSource({selfBranded: false, configBrand: "Havati"}), true)
  // config.brand 없음 = 상품별 브랜드 추출에 의존 → 신뢰하지 않는다
  assert.equal(isTrustedBrandSource({selfBranded: false}), false)
  assert.equal(isTrustedBrandSource({selfBranded: false, configBrand: null}), false)
  assert.equal(isTrustedBrandSource({selfBranded: false, configBrand: "   "}), false)
})

test("multiBrand 는 config.brand 나 SELF_BRANDED 가 있어도 신뢰하지 않는다", () => {
  // 현재 brand+multiBrand 동시 보유 config 는 0개지만, 편집샵에 하우스 브랜드를
  // 적어 넣는 순간 "brand 가 있으니 신뢰" 로 오판하는 것을 막는다.
  // refresh-source.resolveCandidateBrand 도 같은 기준(house && !multiBrand)이다.
  assert.equal(isTrustedBrandSource({selfBranded: false, configBrand: "Store", multiBrand: true}), false)
  assert.equal(isTrustedBrandSource({selfBranded: true, multiBrand: true}), false)
})

test("같은 브랜드가 여러 출처에서 나오면 신뢰 출처로 승격한다", () => {
  // first-seen 이 우연히 편집샵이라 영구 격리되는 것을 막는다.
  const map = new Map<string, UnknownBrandEntry>()
  recordUnknownBrand(map, "Acme", "editorial-shop", false)
  assert.deepEqual(map.get("Acme"), {platform: "editorial-shop", trusted: false})

  recordUnknownBrand(map, "Acme", "acme-official", true)
  // platform 도 신뢰 출처로 바뀐다 — resolve 입력이 일관되어야 한다.
  assert.deepEqual(map.get("Acme"), {platform: "acme-official", trusted: true})
})

test("이미 신뢰 출처면 비신뢰 출처가 덮어쓰지 않는다", () => {
  const map = new Map<string, UnknownBrandEntry>()
  recordUnknownBrand(map, "Acme", "acme-official", true)
  recordUnknownBrand(map, "Acme", "editorial-shop", false)
  assert.deepEqual(map.get("Acme"), {platform: "acme-official", trusted: true})
})

test("신뢰/비신뢰를 분리해 INSERT 대상과 격리 대상을 가른다", () => {
  const map = new Map<string, UnknownBrandEntry>([
    ["Havati", {platform: "havati", trusted: true}],
    ["판매가 : 39000, 상품명 : 니트", {platform: "etce", trusted: false}],
    ["ㅤ", {platform: "glowny", trusted: false}],
  ])
  const {insertable, blocked} = partitionUnknownBrands(map)
  assert.deepEqual(insertable, [{raw: "Havati", platform: "havati"}])
  assert.deepEqual(blocked.sort(), ["ㅤ", "판매가 : 39000, 상품명 : 니트"].sort())
})

test("빈 맵은 양쪽 다 비어 있다", () => {
  const {insertable, blocked} = partitionUnknownBrands(new Map())
  assert.deepEqual(insertable, [])
  assert.deepEqual(blocked, [])
})

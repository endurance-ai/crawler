import test from "node:test"
import assert from "node:assert/strict"

import {getSiteConfig} from "../src/configs/platforms"

test("웹 검증된 단일 성별 브랜드의 사이트 기본값이 일치한다", () => {
  const blank03 = getSiteConfig("blank03")
  assert.deepEqual(blank03?.defaultGender, ["women"])
  assert.deepEqual(
    blank03?.category && "categories" in blank03.category
      ? blank03.category.categories?.map((category) => category.gender)
      : [],
    [["women"], ["women"]],
  )

  assert.deepEqual(getSiteConfig("heretic")?.defaultGender, ["women"])
})

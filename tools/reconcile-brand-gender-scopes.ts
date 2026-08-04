#!/usr/bin/env npx tsx
import {createClient} from "@supabase/supabase-js"

import {reconcileBrandGenderScopes} from "../src/lib/brand-gender-scope-db"
import {VERIFIED_MIXED_GENDER_BRANDS} from "../src/configs/brand-gender-mixed-verified"

const apply = process.argv.includes("--apply")
const dbUrl = process.env.DB_URL
const dbToken = process.env.DB_TOKEN
if (!dbUrl || !dbToken) throw new Error("DB_URL and DB_TOKEN are required")

const verifiedSources = new Map<number, string[]>(VERIFIED_MIXED_GENDER_BRANDS.map((item) => [item.brandId, [...item.sources]]))
const result = await reconcileBrandGenderScopes(createClient(dbUrl, dbToken), {
  apply,
  ...(apply ? {brandIds: [...verifiedSources.keys()], verifiedSources} : {}),
})
console.log(JSON.stringify({mode: apply ? "apply" : "dry-run", widenings: result.length}, null, 2))
for (const item of result) {
  console.log(`${item.brandId}\t${item.brandName}\t${JSON.stringify(item.before)} -> [\"unisex\"]\tmen=${item.evidence.trustedMen} women=${item.evidence.trustedWomen} unisex=${item.evidence.trustedUnisex}\t${item.homepageUrl ?? ""}`)
}

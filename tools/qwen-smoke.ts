#!/usr/bin/env npx tsx

import {classifyProductWithQwen} from "../src/lib/product-qwen-normalization"
import {loadQwenConfig, resetQwenRuntimeForTests} from "../src/lib/qwen-client"

const samples = [
  {
    productUrl: "https://example.com/qwen-smoke/shirt",
    name: "Classic Oxford Cotton Shirt",
    brand: "Smoke Test",
    category: "other",
    subcategory: null,
    tags: ["menswear", "shirt"],
  },
  {
    productUrl: "https://example.com/qwen-smoke/boots",
    name: "Leather Chelsea Boots",
    brand: "Smoke Test",
    category: "shoes",
    subcategory: null,
    tags: ["boots"],
  },
]

async function main(): Promise<void> {
  const config = loadQwenConfig()
  console.log(`Qwen smoke: model=${config.model} endpoints=${config.baseUrls.join(",")}`)
  resetQwenRuntimeForTests()

  for (const sample of samples) {
    const startedAt = Date.now()
    const result = await classifyProductWithQwen(sample)
    console.log(JSON.stringify({
      endpoint: result.endpoint,
      model: result.model,
      attempts: result.attempts,
      latencyMs: Date.now() - startedAt,
      output: result.value,
      usage: result.usage,
    }))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})

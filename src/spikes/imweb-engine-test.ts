/** Spike: run crawlImweb end-to-end against a live imweb site (no DB writes). */
import {crawlImweb} from "../lib/imweb-engine"
import type {SiteConfig} from "../lib/types"

const detail = process.argv.includes("--detail")
const config: SiteConfig = {
  key: "heretic",
  name: "헤레틱",
  type: "imweb",
  baseUrl: "https://heretic.kr",
  brand: "HERETIC",
  maxPages: 1,
  // detail 모드: 카테고리 1개로 좁혀 상세 경로만 빠르게 검증
  categoryUrls: detail ? ["https://heretic.kr/136"] : undefined,
  crawlDetails: detail,
}

async function main(): Promise<void> {
  const result = await crawlImweb(config)
  console.log("\nstats:", JSON.stringify(result.stats))
  console.log("errors:", result.errors)
  const sample = result.products.slice(0, 5)
  for (const p of sample) {
    console.log(
      JSON.stringify({
        name: p.name,
        price: p.price,
        salePrice: p.salePrice,
        color: p.color,
        inStock: p.inStock,
        url: p.productUrl,
        img: p.imageUrl.slice(0, 60),
        desc: p.description?.slice(0, 50),
      }),
    )
  }
  const fill = (field: keyof (typeof result.products)[0]): string => {
    const n = result.products.filter((p) => {
      const v = p[field]
      return v !== undefined && v !== null && v !== ""
    }).length
    return `${((100 * n) / Math.max(result.products.length, 1)).toFixed(0)}%`
  }
  console.log(
    `fill rates: name=${fill("name")} price=${fill("price")} image=${fill("imageUrl")} color=${fill("color")} desc=${fill("description")}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

/**
 * Spike: render an imweb shop page with Playwright and dump the product-item
 * DOM structure + any XHR endpoints that return product JSON.
 */
import {chromium} from "playwright"

const target = process.argv[2] ?? "https://www.aubour.com/PRODUCT"

async function main(): Promise<void> {
  const browser = await chromium.launch({headless: true})
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  })
  const apiHits: string[] = []
  page.on("response", async (res) => {
    const url = res.url()
    const ct = res.headers()["content-type"] ?? ""
    if (ct.includes("json") && !url.includes("google") && !url.includes("facebook")) {
      let preview = ""
      try {
        preview = (await res.text()).slice(0, 200)
      } catch {}
      apiHits.push(`${res.status()} ${url}\n   ${preview.replace(/\n/g, " ")}`)
    }
  })
  await page.goto(target, {waitUntil: "domcontentloaded", timeout: 30000})
  await page.waitForTimeout(5000)

  const info = await page.evaluate(() => {
    const sels = [".shop-item", "[class*=shop_item]", "[class*=prod]", ".item-list li", "[data-prod-no]"]
    const found: Record<string, number> = {}
    for (const s of sels) found[s] = document.querySelectorAll(s).length
    const first = document.querySelector(".shop-item")
    const links = [...document.querySelectorAll('a[href*="shop_view"], a[href*="idx="]')].slice(0, 5).map((a) => (a as HTMLAnchorElement).href)
    return {
      counts: found,
      firstItemHtml: first ? first.outerHTML.slice(0, 2500) : null,
      productLinks: links,
    }
  })
  console.log("selector counts:", JSON.stringify(info.counts))
  console.log("product links:", info.productLinks)
  console.log("--- first .shop-item HTML ---")
  console.log(info.firstItemHtml)
  console.log("--- JSON XHR endpoints ---")
  for (const hit of apiHits.slice(0, 10)) console.log(hit)
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

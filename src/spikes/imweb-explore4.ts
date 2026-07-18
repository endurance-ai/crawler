/**
 * Spike 4: dump .shop-item inner structure on an imweb list page, then open
 * the first product detail and check OG/JSON-LD/option data.
 */
import {chromium} from "playwright"

const listUrl = process.argv[2] ?? "https://heretic.kr/136"

async function main(): Promise<void> {
  const browser = await chromium.launch({headless: true})
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  })
  await page.goto(listUrl, {waitUntil: "domcontentloaded", timeout: 30000})
  await page.waitForTimeout(5000)

  const list = await page.evaluate(`(() => {
    const items = [...document.querySelectorAll(".shop-item")].slice(0, 3)
    return items.map((el) => {
      const a = el.querySelector("a[href]")
      const img = el.querySelector("img")
      return {
        html: el.outerHTML.slice(0, 1800),
        link: a ? a.href : null,
        img: img ? (img.currentSrc || img.src || img.getAttribute("data-src")) : null,
        text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
      }
    })
  })()`) as Array<{html: string; link: string | null; img: string | null; text: string}>

  console.log("=== list items")
  for (const item of list) {
    console.log(`link=${item.link}\nimg=${item.img}\ntext=${item.text}\n`)
  }
  console.log("=== first item HTML\n" + (list[0]?.html ?? "none"))

  const firstLink = list.find((i) => i.link)?.link
  if (firstLink) {
    console.log(`\n=== detail: ${firstLink}`)
    await page.goto(firstLink, {waitUntil: "domcontentloaded", timeout: 30000})
    await page.waitForTimeout(4000)
    const detail = await page.evaluate(`(() => {
      const meta = (p) => {
        const el = document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]')
        return el ? el.getAttribute("content") : null
      }
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent || "")
        .filter((t) => t.includes("Product"))
        .map((t) => t.slice(0, 1000))
      const options = [...document.querySelectorAll("select option")].slice(0, 15).map((o) => (o.textContent || "").trim())
      const priceEls = [...document.querySelectorAll('[class*="price"]')].slice(0, 5)
        .map((el) => el.className + " :: " + (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60))
      return {
        url: location.href,
        ogType: meta("og:type"),
        ogTitle: meta("og:title"),
        ogImage: meta("og:image"),
        ogDescription: (meta("og:description") || "").slice(0, 120),
        priceAmount: meta("product:price:amount"),
        ldProduct: ld,
        options,
        priceEls,
      }
    })()`)
    console.log(JSON.stringify(detail, null, 1).slice(0, 2500))
  }
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

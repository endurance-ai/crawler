/**
 * Spike 3: open candidate imweb product pages (/N numeric paths) and check
 * whether they are product detail pages (OG product meta / price / cart btn).
 */
import {chromium} from "playwright"

const targets = process.argv.slice(2)
if (targets.length === 0) targets.push("https://www.aubour.com/18", "https://www.aubour.com/86", "https://heretic.kr/136")

async function main(): Promise<void> {
  const browser = await chromium.launch({headless: true})
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  })
  for (const target of targets) {
    console.log(`\n===== ${target}`)
    try {
      await page.goto(target, {waitUntil: "domcontentloaded", timeout: 30000})
      await page.waitForTimeout(4000)
      const info = await page.evaluate(`(() => {
        const meta = (p) => {
          const el = document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]')
          return el ? el.getAttribute("content") : null
        }
        const priceRe = /[\\d,]{4,}\\s*원|₩\\s?[\\d,]{4,}/
        const bodyText = document.body.innerText.slice(0, 30000)
        const m = priceRe.exec(bodyText)
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => (s.textContent || "").slice(0, 150))
        const listCounts = {}
        for (const sel of [".shop-item", "[class*='item-list']", "[class*='prod']", ".list_shop_type", "[class*='shop_widget']"]) {
          listCounts[sel] = document.querySelectorAll(sel).length
        }
        return {
          title: document.title,
          ogType: meta("og:type"),
          ogTitle: meta("og:title"),
          priceAmount: meta("product:price:amount"),
          priceHit: m ? m[0] : null,
          hasCartBtn: !!document.querySelector('[class*="cart"], [onclick*="cart"]'),
          ldBlocks: ld,
          listCounts,
          url: location.href,
        }
      })()`)
      console.log(JSON.stringify(info, null, 1).slice(0, 1200))
    } catch (err) {
      console.error("  failed:", err instanceof Error ? err.message : err)
    }
  }
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

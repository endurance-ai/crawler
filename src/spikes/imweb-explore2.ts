/**
 * Spike 2: find the real product-item container on rendered imweb pages.
 * Dumps repeated element groups with links + prices, plus all shop_view hrefs.
 */
import {chromium} from "playwright"

const targets = process.argv.slice(2)
if (targets.length === 0) targets.push("https://www.aubour.com/PRODUCT", "https://heretic.kr/HERETIC")

async function main(): Promise<void> {
  const browser = await chromium.launch({headless: true})
  for (const target of targets) {
    console.log(`\n===== ${target}`)
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    })
    try {
      await page.goto(target, {waitUntil: "domcontentloaded", timeout: 30000})
      await page.waitForTimeout(6000)
      const info = await page.evaluate(() => {
        // group anchors by their path pattern
        const anchors = [...document.querySelectorAll("a[href]")] as HTMLAnchorElement[]
        const byPattern: Record<string, {count: number; sample: string[]}> = {}
        for (const a of anchors) {
          let u: URL
          try {
            u = new URL(a.href)
          } catch {
            continue
          }
          if (u.hostname !== location.hostname) continue
          const pattern = u.pathname.replace(/\d+/g, "N") + (u.search ? "?" + [...u.searchParams.keys()].join("&") : "")
          byPattern[pattern] ??= {count: 0, sample: []}
          byPattern[pattern].count++
          if (byPattern[pattern].sample.length < 2) byPattern[pattern].sample.push(a.href)
        }
        const top = Object.entries(byPattern)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 12)
          .map(([p, v]) => ({pattern: p, count: v.count, sample: v.sample}))

        // find text nodes that look like prices and report their container class
        const priceRe = /[\d,]{4,}원|₩\s?[\d,]{4,}|KRW/
        const priceClasses: Record<string, number> = {}
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let node: Node | null
        let n = 0
        while ((node = walker.nextNode()) && n < 20000) {
          n++
          const text = node.textContent ?? ""
          if (priceRe.test(text) && text.length < 40) {
            const el = node.parentElement
            if (el) {
              const cls = `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`
              priceClasses[cls] = (priceClasses[cls] ?? 0) + 1
            }
          }
        }
        return {top, priceClasses}
      })
      console.log("link patterns:")
      for (const t of info.top) console.log(`  ${t.count}x ${t.pattern}  e.g. ${t.sample[0] ?? ""}`)
      console.log("price-text containers:", JSON.stringify(info.priceClasses))
    } catch (err) {
      console.error("  failed:", err instanceof Error ? err.message : err)
    } finally {
      await page.close()
    }
  }
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

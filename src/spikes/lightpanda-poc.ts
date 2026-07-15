// Lightpanda vs Chromium validation spike (perf/cafe24 crawling).
//
// Throwaway benchmark — NOT wired into the production crawl path. Measures, on the SAME
// Cafe24 list pages, whether Lightpanda renders the product grid identically to Chromium and
// how its memory/speed compare, including at concurrency.
//
// IMPORTANT finding baked into this harness: Playwright's high-level API (goto/evaluate) HANGS
// against Lightpanda's CDP server — even on example.com. Lightpanda only drives cleanly via
// Puppeteer using the `browser.createBrowserContext() -> context.newPage()` pattern (its default
// target is a phantom that answers `BrowserContextNotLoaded`). So this harness drives each engine
// with its working client: Chromium via Playwright, Lightpanda via Puppeteer.
//
// Usage:
//   pnpm tsx src/spikes/lightpanda-poc.ts --engine=chromium  --urls="https://eastlogue.com/product/list.html?cate_no=24"
//   pnpm tsx src/spikes/lightpanda-poc.ts --engine=lightpanda --urls="https://eastlogue.com/product/list.html?cate_no=24"
//   pnpm tsx src/spikes/lightpanda-poc.ts --engine=lightpanda --urls="<listUrl>" --scale=1,5,10,20
import {execFileSync} from "node:child_process"
import {chromium} from "playwright"
import {LIGHTPANDA_BIN, startLightpanda} from "./lightpanda-proc"

type Engine = "chromium" | "lightpanda"

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// Production Cafe24 list-item selectors (src/lib/cafe24-engine.ts DEFAULT_SELECTORS.productItem).
const PRODUCT_ITEM_SELECTOR = [
  'li[id^="anchorBoxId"]',
  "ul.thumbnail > li",
  "ul.prdList > li",
  "li.xans-record-",
  ".xans-product li",
  ".product-list .item",
  ".product_listnormal_list > li",
  ".grid-list > li",
  "div[class*=product] li",
].join(", ")

// String expressions (not functions) to dodge tsx's `__name` transform inside page.evaluate.
const COUNT_ITEMS_EXPR = `document.querySelectorAll(${JSON.stringify(PRODUCT_ITEM_SELECTOR)}).length`
const COUNT_IMGS_EXPR = `document.querySelectorAll('img').length`
const HTML_LEN_EXPR = `document.documentElement.outerHTML.length`

// ─── Unified navigation handle per engine ─────────────────────────────

interface Nav {
  goto: (url: string, timeoutMs: number) => Promise<void>
  evalNum: (expr: string) => Promise<number>
  close: () => Promise<void>
}

async function openChromium(): Promise<Nav> {
  const browser = await chromium.launch({headless: true})
  const ctx = await browser.newContext({userAgent: UA, locale: "ko-KR"})
  const page = await ctx.newPage()
  return {
    goto: async (url, t) => {
      await page.goto(url, {waitUntil: "domcontentloaded", timeout: t}).catch(() => {})
      await page.waitForTimeout(3000) // production waits out client JS render (cafe24-engine.ts:471)
    },
    evalNum: (expr) => page.evaluate(expr).then((v) => Number(v)).catch(() => -1),
    close: async () => void (await browser.close()),
  }
}

async function openLightpanda(): Promise<Nav> {
  const {default: puppeteer} = await import("puppeteer-core")
  const proc = await startLightpanda()
  const browser = await puppeteer.connect({browserWSEndpoint: proc.wsEndpoint})
  const ctx = await browser.createBrowserContext() // required — default target is not navigable
  const page = await ctx.newPage()
  return {
    goto: async (url, t) => {
      await page.goto(url, {waitUntil: "load", timeout: t}).catch(() => {})
      await new Promise((r) => setTimeout(r, 3000))
    },
    evalNum: (expr) => page.evaluate(expr).then((v) => Number(v)).catch(() => -1),
    close: async () => {
      await browser.disconnect().catch(() => {})
      proc.kill()
    },
  }
}

const open = (engine: Engine) => (engine === "chromium" ? openChromium() : openLightpanda())

// ─── RSS sampling by process command match ────────────────────────────
// Playwright/Puppeteer expose no browser pid, so sum RSS of every process whose command
// contains the engine binary marker. Captures Chromium's renderer/helper subprocesses AND
// every instance in the scale test. Caveat: also counts unrelated same-binary processes, so
// run on an otherwise-idle machine.

function rssMatcher(engine: Engine): string {
  if (engine === "lightpanda") return LIGHTPANDA_BIN
  const ep = chromium.executablePath() // headless launch runs chromium_headless_shell-<ver>
  const marker = "ms-playwright/"
  const i = ep.indexOf(marker)
  return i >= 0 ? `${ep.slice(0, i + marker.length)}chromium` : ep
}

function sampleRssMB(pattern: string): number {
  const out = execFileSync("ps", ["-Axo", "rss=,command="], {encoding: "utf8", maxBuffer: 16 * 1024 * 1024})
  let kb = 0
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/)
    if (m?.[2]?.includes(pattern)) kb += +m[1]!
  }
  return kb / 1024
}

async function withPeakRss<T>(pattern: string, fn: () => Promise<T>): Promise<{result: T; peakRssMB: number}> {
  let peak = 0
  const timer = setInterval(() => {
    try {
      peak = Math.max(peak, sampleRssMB(pattern))
    } catch {
      /* ps hiccup */
    }
  }, 200)
  try {
    return {result: await fn(), peakRssMB: peak}
  } finally {
    clearInterval(timer)
  }
}

// ─── List render + footprint benchmark ────────────────────────────────

async function benchList(engine: Engine, url: string) {
  const t0 = Date.now()
  const {result, peakRssMB} = await withPeakRss(rssMatcher(engine), async () => {
    const nav = await open(engine)
    try {
      await nav.goto(url, 30_000)
      return {
        items: await nav.evalNum(COUNT_ITEMS_EXPR),
        imgs: await nav.evalNum(COUNT_IMGS_EXPR),
        htmlLen: await nav.evalNum(HTML_LEN_EXPR),
      }
    } finally {
      await nav.close()
    }
  })
  return {phase: "list" as const, engine, url, ...result, durationMs: Date.now() - t0, peakRssMB: Math.round(peakRssMB)}
}

// ─── Concurrency scale test: M pages navigated + held open at once ─────

async function benchScale(engine: Engine, url: string, m: number) {
  const navs: Nav[] = []
  const t0 = Date.now()
  const {result, peakRssMB} = await withPeakRss(rssMatcher(engine), async () => {
    const counts = await Promise.all(
      Array.from({length: m}, async () => {
        const nav = await open(engine)
        navs.push(nav)
        await nav.goto(url, 30_000)
        return nav.evalNum(COUNT_ITEMS_EXPR)
      }),
    )
    await new Promise((r) => setTimeout(r, 1000)) // steady-state window
    return {itemsPerPage: counts}
  })
  await Promise.all(navs.map((n) => n.close().catch(() => {})))
  const items = result.itemsPerPage
  return {
    phase: "scale" as const,
    engine,
    m,
    itemsMin: Math.min(...items),
    itemsMax: Math.max(...items),
    durationMs: Date.now() - t0,
    peakRssMB: Math.round(peakRssMB),
    rssPerInstanceMB: Math.round(peakRssMB / m),
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=")
}

async function main() {
  const engine = (arg("engine") ?? "chromium") as Engine
  if (engine !== "chromium" && engine !== "lightpanda") throw new Error("--engine must be chromium|lightpanda")
  const urls = (arg("urls") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  if (urls.length === 0) throw new Error('--urls="<full list url>[,<url2>]" required')
  const scaleList = (arg("scale") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => n > 0)

  const results: unknown[] = []
  for (const url of urls) {
    if (scaleList.length > 0) {
      for (const m of scaleList) {
        console.log(`\n### SCALE ${engine} M=${m} ${url}`)
        results.push(await benchScale(engine, url, m))
      }
    } else {
      console.log(`\n### LIST ${engine} ${url}`)
      results.push(await benchList(engine, url))
    }
  }

  console.log(`\n===RESULTS_JSON===`)
  console.log(JSON.stringify({engine, results}, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

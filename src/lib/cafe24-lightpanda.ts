import type {Browser, BrowserContext, Page as PuppeteerPage} from "puppeteer-core"
import type {IDetailParser} from "./parsers/detail"
import type {IReviewParser} from "./parsers/review"
import type {CrawlResult, SiteConfig} from "./types"
import {crawlCafe24, type CrawlCafe24Options} from "./cafe24-engine"
import {
  type Cafe24DetailPageLease,
  type Cafe24GotoOptions,
  type Cafe24Page,
  sleep,
  translateCafe24WaitUntil,
} from "./cafe24-page"
import {startLightpandaProcess} from "./lightpanda-process"

const CAFE24_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export interface LightpandaCafe24Options {
  detailConcurrency?: number
  onDetailProgress?: CrawlCafe24Options["onDetailProgress"]
  existingDetails?: CrawlCafe24Options["existingDetails"]
  includeOutOfStock?: CrawlCafe24Options["includeOutOfStock"]
}

interface LightpandaPageLease extends Cafe24DetailPageLease {
  close(): Promise<void>
}

function createPuppeteerCafe24Page(page: PuppeteerPage): Cafe24Page {
  return {
    goto: async (url: string, options?: Cafe24GotoOptions) => {
      await page.goto(url, {
        waitUntil: translateCafe24WaitUntil(options?.waitUntil),
        timeout: options?.timeout,
      })
    },
    waitForTimeout: sleep,
    waitForSelector: async (selector, options) => {
      await page.waitForSelector(selector, {timeout: options?.timeout})
    },
    evaluate: async (pageFunction, arg) => {
      if (typeof pageFunction === "string") {
        return await page.evaluate(pageFunction as any)
      }
      if (arg === undefined) {
        return await page.evaluate(pageFunction as any)
      }
      return await page.evaluate(pageFunction as any, arg)
    },
    $eval: async (selector, pageFunction, arg) => {
      if (arg === undefined) {
        return await page.$eval(selector, pageFunction as any)
      }
      return await page.$eval(selector, pageFunction as any, arg)
    },
    $$eval: async (selector, pageFunction, arg) => {
      if (arg === undefined) {
        return await page.$$eval(selector, pageFunction as any)
      }
      return await page.$$eval(selector, pageFunction as any, arg)
    },
    url: () => page.url(),
  }
}

async function openLightpandaPage(): Promise<LightpandaPageLease> {
  const {default: puppeteer} = await import("puppeteer-core")
  const proc = await startLightpandaProcess()
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  try {
    browser = await puppeteer.connect({browserWSEndpoint: proc.wsEndpoint})
    context = await browser.createBrowserContext()
    const nativePage = await context.newPage()
    await nativePage.setUserAgent(CAFE24_UA).catch(() => {})
    await nativePage
      .setExtraHTTPHeaders({"Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"})
      .catch(() => {})

    return {
      page: createPuppeteerCafe24Page(nativePage),
      close: async () => {
        await context?.close().catch(() => {})
        browser?.disconnect()
        proc.kill()
      },
    }
  } catch (err) {
    await context?.close().catch(() => {})
    browser?.disconnect()
    proc.kill()
    throw err
  }
}

class LightpandaPagePool {
  private readonly idle: LightpandaPageLease[] = []
  private readonly waiters: Array<(lease: LightpandaPageLease) => void> = []
  private closed = false

  constructor(private readonly size: number) {}

  async start(): Promise<void> {
    for (let i = 0; i < this.size; i++) {
      this.idle.push(await openLightpandaPage())
    }
  }

  async acquire(): Promise<LightpandaPageLease> {
    if (this.closed) throw new Error("lightpanda page pool is closed")
    const lease = this.idle.pop()
    if (lease) return lease
    return await new Promise((resolve) => this.waiters.push(resolve))
  }

  release(lease: LightpandaPageLease): void {
    if (this.closed) {
      void lease.close()
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(lease)
      return
    }
    this.idle.push(lease)
  }

  async close(): Promise<void> {
    this.closed = true
    const leases = this.idle.splice(0)
    this.waiters.splice(0)
    await Promise.all(leases.map((lease) => lease.close().catch(() => {})))
  }
}

export async function crawlCafe24WithLightpanda(
  config: SiteConfig,
  detailParser?: IDetailParser,
  reviewParser?: IReviewParser,
  options: LightpandaCafe24Options = {},
): Promise<CrawlResult> {
  const detailConcurrency = options.detailConcurrency ?? 3
  const mainPage = await openLightpandaPage()
  const detailPool =
    config.crawlDetails && detailParser
      ? new LightpandaPagePool(Math.max(1, detailConcurrency))
      : null

  try {
    await detailPool?.start()
    return await crawlCafe24(mainPage.page, config, detailParser, reviewParser, {
      detailConcurrency,
      onDetailProgress: options.onDetailProgress,
      existingDetails: options.existingDetails,
      includeOutOfStock: options.includeOutOfStock,
      createDetailPage: detailPool
        ? async () => {
            const lease = await detailPool.acquire()
            return {
              page: lease.page,
              close: async () => detailPool.release(lease),
            }
          }
        : undefined,
    })
  } finally {
    await detailPool?.close()
    await mainPage.close()
  }
}

/**
 * Minimal page contract used by the Cafe24 list/detail/review parser stack.
 *
 * Playwright and Puppeteer expose similar methods for this surface, but their
 * concrete Page types are not interchangeable. Keeping Cafe24 on this narrow
 * structural type lets Chromium and Lightpanda share extraction logic.
 */

export type Cafe24WaitUntil = "commit" | "domcontentloaded" | "load" | "networkidle" | "networkidle0" | "networkidle2"

export interface Cafe24GotoOptions {
  waitUntil?: Cafe24WaitUntil
  timeout?: number
}

export interface Cafe24Page {
  goto(url: string, options?: Cafe24GotoOptions): Promise<unknown>
  waitForTimeout(ms: number): Promise<unknown>
  waitForSelector(selector: string, options?: {timeout?: number}): Promise<unknown>
  evaluate<R = unknown>(
    pageFunction: string | ((arg: any) => R | Promise<R>) | (() => R | Promise<R>),
    arg?: any,
  ): Promise<R>
  $eval<R = unknown>(
    selector: string,
    pageFunction: (element: Element, arg: any) => R | Promise<R>,
    arg?: any,
  ): Promise<R>
  $$eval<R = unknown>(
    selector: string,
    pageFunction: (elements: Element[], arg: any) => R | Promise<R>,
    arg?: any,
  ): Promise<R>
  url(): string
}

export interface Cafe24DetailPageLease {
  page: Cafe24Page
  close(): Promise<void>
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function translateCafe24WaitUntil(waitUntil: Cafe24WaitUntil | undefined): "domcontentloaded" | "load" | "networkidle0" | "networkidle2" | undefined {
  if (waitUntil === "commit") return "domcontentloaded"
  if (waitUntil === "networkidle") return "networkidle0"
  return waitUntil
}

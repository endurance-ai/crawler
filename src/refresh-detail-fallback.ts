#!/usr/bin/env npx tsx

import {mkdir, readFile, rename, writeFile} from "node:fs/promises"
import {dirname} from "node:path"
import {chromium, type BrowserContext, type Page} from "playwright"

import {getSiteConfig, PLATFORMS} from "./configs/platforms"
import {applyDetailCasWrite, recoverDuplicateCanonicalUrl} from "./lib/detail-db-retry"
import {extractCafe24DetailStock} from "./lib/cafe24-engine"
import {extractCafe24DetailFallbacks} from "./lib/cafe24-chain"
import {initFxRates} from "./lib/fx"
import type {RefreshableRow} from "./lib/listing-refresh"
import {createProductCollectionClient, type ProductCollectionClient} from "./lib/product-collection"
import {loadRefreshBatchSources} from "./lib/product-refresh"
import {
  buildDetailRefreshPatch,
  buildRemovedProductPatch,
  chunkDetailFallbackPlatforms,
  classifyDetailHttpStatus,
  combinedRefreshCoverage,
  compareOldestDetailRows,
  compareLikelyLiveDetailRows,
  detailFallbackPacingMs,
  detailFallbackRecovered,
  detailRetryAt,
  detailTransientRetryDelayMs,
  needsDetailFallback,
  isCafe24RemovedRedirect,
  isImwebExpiredStorePage,
  isImwebRemovedRedirect,
  imwebDetailFallbackUrls,
  isZaraRemovedRedirect,
  parseZaraDetailPayload,
  parseZaraDomDetailPayload,
  parseShopifyDetailPayload,
  parseStructuredDetailPayload,
  parseSixshopDetailPayload,
  resolveDetailFallbackType,
  shopifyProductJsonUrl,
  sixshopProductApiUrl,
  type DetailFallbackType,
  type DetailObservation,
} from "./lib/refresh-detail-fallback"
import {extractStructuredProduct} from "./lib/parsers/structured-data"
import {retryAtForRateLimit} from "./lib/shopify-engine"
import {installRequestBlocking} from "./lib/request-blocking"
import {detectBmVerifyIntercept} from "./lib/zara-engine"
import {isUnverifiedUnisexRow} from "./lib/unisex-quarantine"

type DetailRow = RefreshableRow & {
  id: string
  platform: string
  updated_at: string
  crawled_at: string | null
  last_seen_at: string | null
}

type SourceGroup = {platform: string; type: DetailFallbackType; lane: number; rows: DetailRow[]}

type RetryEntry = {retry_at: string; reason: string}
type RollingRetryState = {
  version: 1
  products: Record<string, RetryEntry>
  sources: Record<string, RetryEntry>
}

function isDetailFallbackType(value: string): value is DetailFallbackType {
  return ["cafe24", "shopify", "zara", "imweb", "sixshop"].includes(value)
}

type FallbackCounters = {
  attempted: number
  confirmed: number
  updated: number
  removed: number
  removed_recorded: number
  removed_record_failed: number
  blocked: number
  transient: number
  unreadable: number
  db_failed: number
  cas_conflicts: number
}

function emptyFallbackCounters(): FallbackCounters {
  return {attempted: 0, confirmed: 0, updated: 0, removed: 0, removed_recorded: 0, removed_record_failed: 0, blocked: 0, transient: 0, unreadable: 0, db_failed: 0, cas_conflicts: 0}
}

function flag(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(flag(name) ?? fallback)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`)
  return value
}

function emptyRetryState(): RollingRetryState {
  return {version: 1, products: {}, sources: {}}
}

async function loadRetryState(path: string | null): Promise<RollingRetryState> {
  if (!path) return emptyRetryState()
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<RollingRetryState>
    return {
      version: 1,
      products: value.products && typeof value.products === "object" ? value.products : {},
      sources: value.sources && typeof value.sources === "object" ? value.sources : {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRetryState()
    throw new Error(`rolling retry state load failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function saveRetryState(path: string | null, state: RollingRetryState): Promise<void> {
  if (!path) return
  await mkdir(dirname(path), {recursive: true})
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state)}\n`, "utf8")
  await rename(temporary, path)
}

function retryPending(entry: RetryEntry | undefined, now: number): boolean {
  return Boolean(entry && Date.parse(entry.retry_at) > now)
}

function parseExcluded(): Set<string> {
  return new Set((process.env.REFRESH_EXCLUDE ?? "").split(",").map((key) => key.trim()).filter(Boolean))
}

function logDetailDbError(operation: string, platform: string, code: string | undefined): void {
  const safeCode = code && /^[A-Za-z0-9]{1,16}$/.test(code) ? code : "unknown"
  console.error(`detail DB ${operation} failed: platform=${platform} code=${safeCode}`)
}

async function loadUnconfirmedProducts(
  db: ProductCollectionClient,
  since: string,
  eligible: Set<string>,
): Promise<DetailRow[]> {
  const rows: DetailRow[] = []
  for (const platformChunk of chunkDetailFallbackPlatforms([...eligible].sort())) {
    let lastId = "0"
    for (;;) {
      let page: DetailRow[] | null = null
      let lastError = "unknown error"
      for (let attempt = 0; attempt < 3; attempt++) {
        const {data, error} = await db
          .from("products")
          .select("id,platform,product_url,updated_at,crawled_at,last_seen_at,price,original_price,sale_price,source_price,source_currency,in_stock,gender,gender_source")
          .in("platform", platformChunk)
          .or(`last_seen_at.is.null,last_seen_at.lt.${since}`)
          .gt("id", lastId)
          .order("id", {ascending: true})
          .limit(1000)
          .abortSignal(AbortSignal.timeout(30_000))
        if (!error) {
          page = (data ?? []) as DetailRow[]
          break
        }
        lastError = error.message
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
      if (page === null) throw new Error(`unconfirmed products load failed: ${lastError}`)
      for (const row of page) {
        if (!needsDetailFallback(row, since)) continue
        const typed = row as DetailRow & {gender: string[] | null; gender_source: string | null}
        rows.push({
          ...typed,
          unverified_unisex_quarantined: isUnverifiedUnisexRow({
            platform: row.platform,
            gender: typed.gender,
            genderSource: typed.gender_source,
            verifiedUnisexDefault: getSiteConfig(row.platform)?.verifiedUnisexDefault === true,
          }),
        })
      }
      if (page.length < 1000) break
      lastId = String(page.at(-1)!.id)
    }
  }
  return rows
}

async function fetchShopify(row: DetailRow, sourceCurrency: string): Promise<DetailObservation> {
  const url = shopifyProductJsonUrl(row.product_url)
  if (!url) return {kind: "unreadable", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
  try {
    const response = await fetch(url, {
      headers: {Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; kiko-refresh/1.0)"},
      signal: AbortSignal.timeout(30_000),
    })
    const kind = classifyDetailHttpStatus(response.status)
    if (kind !== "confirmed") {
      return {
        kind,
        status: response.status,
        inStock: null,
        price: null,
        originalPrice: null,
        salePrice: null,
        sourceCurrency,
        retryAt: response.status === 429 ? retryAtForRateLimit(response.headers.get("Retry-After")) : null,
      }
    }
    const parsed = parseShopifyDetailPayload(await response.json(), sourceCurrency)
    return parsed ?? {kind: "unreadable", status: response.status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
  } catch {
    return {kind: "transient", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
  }
}

async function fetchStructuredDetail(
  row: DetailRow,
  sourceCurrency: string,
  deadline: number,
  categoryUrls: string[],
): Promise<DetailObservation> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(row.product_url, {
        headers: {Accept: "text/html,*/*", "User-Agent": "Mozilla/5.0 (compatible; kiko-refresh/1.0)"},
        signal: AbortSignal.timeout(30_000),
      })
      const kind = classifyDetailHttpStatus(response.status)
      if (kind === "transient" && attempt < 2) {
        const delayMs = detailTransientRetryDelayMs(attempt)
        if (delayMs !== null && Date.now() + delayMs < deadline) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }
      }
      if (kind !== "confirmed") {
        return {kind, status: response.status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
      }
      if (isImwebRemovedRedirect(row.product_url, response.url)) {
        return {kind: "removed", status: response.status, inStock: false, price: null, originalPrice: null, salePrice: null, sourceCurrency}
      }
      const html = await response.text()
      if (isImwebExpiredStorePage(html)) {
        return {kind: "removed", status: response.status, inStock: false, price: null, originalPrice: null, salePrice: null, sourceCurrency}
      }
      const parsed = parseStructuredDetailPayload(extractStructuredProduct(html), sourceCurrency)
      if (parsed) return {...parsed, status: response.status}

      const fallbackUrls = imwebDetailFallbackUrls(row.product_url, categoryUrls)
      let removedFallbacks = 0
      for (const fallbackUrl of fallbackUrls) {
        try {
          const fallbackResponse = await fetch(fallbackUrl, {
            headers: {Accept: "text/html,*/*", "User-Agent": "Mozilla/5.0 (compatible; kiko-refresh/1.0)"},
            signal: AbortSignal.timeout(30_000),
          })
          const fallbackKind = classifyDetailHttpStatus(fallbackResponse.status)
          if (fallbackKind === "removed" || isImwebRemovedRedirect(fallbackUrl, fallbackResponse.url)) {
            removedFallbacks++
            continue
          }
          if (fallbackKind !== "confirmed") continue
          const fallbackHtml = await fallbackResponse.text()
          if (isImwebExpiredStorePage(fallbackHtml)) {
            removedFallbacks++
            continue
          }
          const fallbackParsed = parseStructuredDetailPayload(extractStructuredProduct(fallbackHtml), sourceCurrency)
          if (fallbackParsed) return {...fallbackParsed, status: fallbackResponse.status, productUrl: fallbackUrl}
        } catch {
          continue
        }
      }
      return fallbackUrls.length > 0 && removedFallbacks === fallbackUrls.length
        ? {kind: "removed", status: response.status, inStock: false, price: null, originalPrice: null, salePrice: null, sourceCurrency}
        : {kind: "unreadable", status: response.status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
    } catch {
      if (attempt < 2) {
        const delayMs = detailTransientRetryDelayMs(attempt)
        if (delayMs !== null && Date.now() + delayMs < deadline) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }
      }
      return {kind: "transient", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
    }
  }
  return {kind: "transient", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
}

async function fetchSixshopDetail(row: DetailRow, sourceCurrency: string): Promise<DetailObservation> {
  const apiUrl = sixshopProductApiUrl(row.product_url)
  if (!apiUrl) return {kind: "unreadable", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
  try {
    const storefront = new URL(row.product_url)
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
        Origin: storefront.origin,
        Referer: `${storefront.origin}/`,
        originurl: storefront.hostname,
        "User-Agent": "Mozilla/5.0 (compatible; kiko-refresh/1.0)",
      },
      signal: AbortSignal.timeout(30_000),
    })
    const kind = classifyDetailHttpStatus(response.status)
    if (kind !== "confirmed") {
      return {kind, status: response.status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
    }
    const parsed = parseSixshopDetailPayload(await response.json(), sourceCurrency)
    return parsed ? {...parsed, status: response.status} : {
      kind: "unreadable", status: response.status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency,
    }
  } catch {
    return {kind: "transient", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
  }
}

async function fetchCafe24(page: Page, row: DetailRow): Promise<DetailObservation> {
  try {
    const response = await page.goto(row.product_url, {waitUntil: "domcontentloaded", timeout: 30_000})
    const status = response?.status() ?? null
    const kind = classifyDetailHttpStatus(status)
    if (kind === "removed" || isCafe24RemovedRedirect(row.product_url, page.url())) {
      return {kind: "removed", status, inStock: false, price: null, originalPrice: null, salePrice: null, sourceCurrency: row.source_currency ?? null}
    }
    if (kind !== "confirmed") {
      return {kind, status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency: row.source_currency ?? null}
    }
    await page.waitForTimeout(350)
    const [detail, inStock] = await Promise.all([
      extractCafe24DetailFallbacks(page),
      extractCafe24DetailStock(page).catch(() => null),
    ])
    if (detail.price === null && inStock === null) {
      return {kind: "unreadable", status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency: detail.sourceCurrency ?? row.source_currency ?? null}
    }
    return {
      kind: "confirmed",
      status,
      inStock,
      price: detail.price,
      originalPrice: detail.originalPrice,
      salePrice: detail.salePrice,
      sourceCurrency: detail.sourceCurrency ?? row.source_currency ?? null,
    }
  } catch {
    return {kind: "transient", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency: row.source_currency ?? null}
  }
}

async function fetchZara(page: Page, row: DetailRow, sourceCurrency: string): Promise<DetailObservation> {
  try {
    const response = await page.goto(row.product_url, {waitUntil: "domcontentloaded", timeout: 30_000})
    let status = response?.status() ?? null
    const initialKind = classifyDetailHttpStatus(status)
    if (initialKind === "blocked" || initialKind === "transient") {
      return {kind: initialKind, status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
    }
    const challengeDeadline = Date.now() + 20_000
    let intercept = detectBmVerifyIntercept(await page.content())
    while (Date.now() < challengeDeadline) {
      if (!intercept.isIntercept) break
      await page.waitForTimeout(500)
      intercept = detectBmVerifyIntercept(await page.content())
    }
    if (intercept.isIntercept) {
      return {
        kind: intercept.reason === "access-denied-403" ? "blocked" : "transient",
        status,
        inStock: null,
        price: null,
        originalPrice: null,
        salePrice: null,
        sourceCurrency,
      }
    }
    status = status === 410 ? 410 : status
    if (status === 404 || status === 410 || isZaraRemovedRedirect(row.product_url, page.url())) {
      return {kind: "removed", status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
    }
    const payloads = await page.locator('script[type="application/ld+json"]').allTextContents()
      .then((texts) => texts.flatMap((text) => {
        try { return [JSON.parse(text) as unknown] } catch { return [] }
      }))
    const parsed = parseZaraDetailPayload(payloads, sourceCurrency)
    if (parsed) return {...parsed, status, productUrl: page.url()}
    const dom = await page.evaluate(() => {
      const price = document.querySelector<HTMLElement>('[data-qa-id="price-container-current"] data[value]')
        ?? document.querySelector<HTMLElement>('.product-detail-info__price data[value]')
      const panel = document.querySelector<HTMLElement>('.product-detail-info')
      return {
        currentPrice: price?.getAttribute("value") ?? null,
        currency: price?.getAttribute("data-currency") ?? null,
        hasAddToCart: document.querySelector('[data-qa-action="add-to-cart"]') !== null,
        productText: panel?.innerText ?? "",
      }
    })
    const domParsed = parseZaraDomDetailPayload(dom, sourceCurrency)
    return domParsed ? {...domParsed, status, productUrl: page.url()} : {
      kind: "unreadable", status, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency,
    }
  } catch {
    return {kind: "transient", status: null, inStock: null, price: null, originalPrice: null, salePrice: null, sourceCurrency}
  } finally {
    await page.goto("about:blank", {waitUntil: "commit", timeout: 5_000}).catch(() => undefined)
  }
}

async function writeConfirmed(
  db: ProductCollectionClient,
  initial: DetailRow,
  observation: DetailObservation,
): Promise<"updated" | "confirmed" | "conflict" | "failed"> {
  let row = initial
  for (let attempt = 0; attempt < 2; attempt++) {
    const observedAt = new Date().toISOString()
    const patch = buildDetailRefreshPatch(row, observation, observedAt)
    const writePatch = () => applyDetailCasWrite(observedAt,
      () => db.from("products")
        .update({...patch, last_seen_at: observedAt, crawled_at: observedAt, updated_at: observedAt})
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("id")
        .abortSignal(AbortSignal.timeout(20_000)),
      () => db.from("products")
        .select("id,platform,product_url,updated_at,crawled_at,last_seen_at,price,original_price,sale_price,source_price,source_currency,in_stock,gender,gender_source")
        .eq("id", row.id)
        .abortSignal(AbortSignal.timeout(20_000))
        .maybeSingle(),
    )
    const initialOutcome = await writePatch()
    const recovered = await recoverDuplicateCanonicalUrl(
      initialOutcome,
      patch,
      row.id,
      () => db.from("products").select("id").eq("product_url", patch.product_url!).abortSignal(AbortSignal.timeout(20_000)).maybeSingle(),
      writePatch,
    )
    const outcome = recovered.outcome
    if (recovered.preservedUrl && outcome.kind === "written") {
      console.warn(`[detail-db] canonical URL already belongs to another product; preserved existing URL platform=${row.platform}`)
    }
    const changed = Object.keys(patch).some((key) => (row as unknown as Record<string, unknown>)[key] !== (patch as Record<string, unknown>)[key])
    if (outcome.kind === "written") return changed ? "updated" : "confirmed"
    if (outcome.kind === "failed") {
      logDetailDbError("confirm", row.platform, outcome.code)
      return "failed"
    }
    if (attempt === 1) return "conflict"
    const typed = outcome.current as DetailRow & {gender: string[] | null; gender_source: string | null}
    row = {
      ...typed,
      unverified_unisex_quarantined: isUnverifiedUnisexRow({
        platform: typed.platform,
        gender: typed.gender,
        genderSource: typed.gender_source,
        verifiedUnisexDefault: getSiteConfig(typed.platform)?.verifiedUnisexDefault === true,
      }),
    }
  }
  return "conflict"
}

async function recordRemovedCheck(
  db: ProductCollectionClient,
  initial: DetailRow,
): Promise<"recorded" | "conflict" | "failed"> {
  let row = initial
  for (let attempt = 0; attempt < 2; attempt++) {
    const checkedAt = new Date().toISOString()
    const outcome = await applyDetailCasWrite(checkedAt,
      () => db.from("products")
        .update(buildRemovedProductPatch(checkedAt))
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("id")
        .abortSignal(AbortSignal.timeout(20_000)),
      () => db.from("products")
        .select("id,platform,product_url,updated_at,crawled_at,last_seen_at,price,original_price,sale_price,source_price,source_currency,in_stock,gender,gender_source")
        .eq("id", row.id)
        .abortSignal(AbortSignal.timeout(20_000))
        .maybeSingle(),
    )
    if (outcome.kind === "written") return "recorded"
    if (outcome.kind === "failed") {
      logDetailDbError("remove", row.platform, outcome.code)
      return "failed"
    }
    if (attempt === 1) return "conflict"
    row = outcome.current as DetailRow
  }
  return "conflict"
}

async function main(): Promise<void> {
  const rolling = process.argv.includes("--rolling")
  const batchIdRaw = flag("batch-id")
  const batchId = batchIdRaw ? positiveInt("batch-id", 0) : null
  if (!rolling && batchId === null) throw new Error("--batch-id=<id> is required unless --rolling is used")
  const since = flag("since") ?? (rolling ? new Date().toISOString() : null)
  const deadlineRaw = flag("deadline-at")
  if (!since || !Number.isFinite(Date.parse(since))) throw new Error("--since=<ISO timestamp> is required")
  if (!deadlineRaw || !Number.isFinite(Date.parse(deadlineRaw))) throw new Error("--deadline-at=<ISO timestamp> is required")
  const deadline = Date.parse(deadlineRaw)
  const concurrency = positiveInt("concurrency", 4)
  const zaraSourceConcurrency = positiveInt("zara-source-concurrency", 1)
  const shopifySourceConcurrency = positiveInt("shopify-source-concurrency", 1)
  const cafe24ContextMaxRequests = positiveInt("cafe24-context-max-requests", 20)
  const priority = flag("priority") ?? "likely-live"
  if (!["likely-live", "oldest"].includes(priority)) throw new Error("--priority must be likely-live or oldest")
  const reconcileMinCoverage = Number(flag("reconcile-min-coverage") ?? 0.7)
  if (!Number.isFinite(reconcileMinCoverage) || reconcileMinCoverage < 0 || reconcileMinCoverage > 1) {
    throw new Error("--reconcile-min-coverage must be between 0 and 1")
  }
  const selectedTypes = new Set((flag("type") ?? "cafe24,shopify").split(",").map((value) => value.trim()).filter(Boolean))
  if ([...selectedTypes].some((type) => !isDetailFallbackType(type))) {
    throw new Error("--type supports cafe24, shopify, zara, imweb, and sixshop")
  }
  const selectedSite = flag("site")
  const dryRun = process.argv.includes("--dry-run")
  const audit = process.argv.includes("--audit")
  const limit = Number(flag("limit") ?? 0)
  if (!Number.isInteger(limit) || limit < 0) throw new Error("--limit must be a non-negative integer")
  const db = createProductCollectionClient()
  const configByKey = new Map(PLATFORMS.map((config) => [config.key, config]))
  const retryStateFile = rolling ? flag("retry-state-file") : null
  const retryState = await loadRetryState(retryStateFile)
  const selectionTime = Date.now()
  const pruneExpired = (entries: Record<string, RetryEntry>) => {
    for (const [key, entry] of Object.entries(entries)) {
      if (!retryPending(entry, selectionTime)) delete entries[key]
    }
  }
  pruneExpired(retryState.products)
  pruneExpired(retryState.sources)
  const excluded = parseExcluded()
  const batchSources = rolling
    ? [...configByKey.values()]
      .filter((config) => !config.disabled && !excluded.has(config.key))
      .map((config) => ({
        batch_id: 0,
        platform_key: config.key,
        platform_type: config.type,
        product_count: 0,
        status: "pending" as const,
        attempts: 0,
        exception_code: null,
        exception_message: null,
      }))
    : await loadRefreshBatchSources(db, batchId!)
  const sourceTypeByKey = new Map<string, DetailFallbackType>()
  for (const source of batchSources) {
    const type = resolveDetailFallbackType(source.platform_type, configByKey.get(source.platform_key)?.type)
    if (type) sourceTypeByKey.set(source.platform_key, type)
  }
  const eligibleSources = batchSources.filter((source) =>
    selectedTypes.has(sourceTypeByKey.get(source.platform_key) ?? "") &&
    (!selectedSite || source.platform_key === selectedSite) &&
    !retryPending(retryState.sources[source.platform_key], selectionTime) &&
    !["external_block", "config_drift"].includes(source.exception_code ?? ""),
  )
  const eligible = new Set(eligibleSources.map((source) => source.platform_key))
  const loadedRows = await loadUnconfirmedProducts(db, since, eligible)
  const cooledProducts = loadedRows.filter((row) => retryPending(retryState.products[row.id], selectionTime)).length
  const rows = loadedRows.filter((row) => !retryPending(retryState.products[row.id], selectionTime))
  const byPlatform = new Map<string, DetailRow[]>()
  for (const row of rows) {
    const group = byPlatform.get(row.platform) ?? []
    group.push(row)
    byPlatform.set(row.platform, group)
  }
  const groups: SourceGroup[] = eligibleSources.flatMap((source) => {
    const sourceRows = byPlatform.get(source.platform_key)
    const sourceType = sourceTypeByKey.get(source.platform_key)
    if (!sourceRows?.length || !sourceType) return []
    sourceRows.sort(priority === "oldest"
      ? compareOldestDetailRows
      : compareLikelyLiveDetailRows)
    const sourceConcurrency = sourceType === "zara"
      ? zaraSourceConcurrency
      : sourceType === "shopify"
        ? shopifySourceConcurrency
        : 1
    if (sourceConcurrency === 1) {
      return [{platform: source.platform_key, type: sourceType, lane: 0, rows: sourceRows}]
    }
    return Array.from({length: Math.min(sourceConcurrency, sourceRows.length)}, (_, lane) => ({
      platform: source.platform_key,
      type: sourceType,
      lane,
      rows: sourceRows.filter((_, index) => index % sourceConcurrency === lane),
    })).filter((group) => group.rows.length > 0)
  })
  const compareGroupHeads = (a: SourceGroup, b: SourceGroup): number => {
    const aRow = a.rows[0]
    const bRow = b.rows[0]
    if (!aRow) return 1
    if (!bRow) return -1
    return priority === "oldest"
      ? compareOldestDetailRows(aRow, bRow)
      : compareLikelyLiveDetailRows(aRow, bRow)
  }
  const enqueueGroup = (group: SourceGroup): void => {
    const index = groups.findIndex((current) => compareGroupHeads(group, current) <= 0)
    if (index < 0) groups.push(group)
    else groups.splice(index, 0, group)
  }
  groups.sort(compareGroupHeads)
  if (dryRun) {
    console.log(JSON.stringify({
      batch_id: batchId,
      rolling,
      since,
      priority,
      eligible_sources: groups.length,
      eligible_products: rows.length,
      cooled_products: cooledProducts,
      cooled_sources: Object.keys(retryState.sources).length,
      by_type: groups.reduce<Record<string, {sources: number; products: number}>>((summary, group) => {
        const current = summary[group.type] ?? {sources: 0, products: 0}
        current.sources++
        current.products += group.rows.length
        summary[group.type] = current
        return summary
      }, {}),
      largest_sources: groups.map((group) => ({platform: group.platform, type: group.type, products: group.rows.length}))
        .sort((a, b) => b.products - a.products).slice(0, 20),
    }, null, 2))
    return
  }
  await initFxRates()
  const metrics: FallbackCounters & {eligible_products: number} = {
    eligible_products: rows.length,
    ...emptyFallbackCounters(),
  }
  const byType: Record<DetailFallbackType, FallbackCounters & {eligible_products: number}> = {
    cafe24: {
      eligible_products: rows.filter((row) => sourceTypeByKey.get(row.platform) === "cafe24").length,
      ...emptyFallbackCounters(),
    },
    shopify: {
      eligible_products: rows.filter((row) => sourceTypeByKey.get(row.platform) === "shopify").length,
      ...emptyFallbackCounters(),
    },
    zara: {
      eligible_products: rows.filter((row) => sourceTypeByKey.get(row.platform) === "zara").length,
      ...emptyFallbackCounters(),
    },
    imweb: {
      eligible_products: rows.filter((row) => sourceTypeByKey.get(row.platform) === "imweb").length,
      ...emptyFallbackCounters(),
    },
    sixshop: {
      eligible_products: rows.filter((row) => sourceTypeByKey.get(row.platform) === "sixshop").length,
      ...emptyFallbackCounters(),
    },
  }
  const byZaraRegion: Record<string, FallbackCounters & {eligible_products: number}> = {}
  for (const source of eligibleSources) {
    if (sourceTypeByKey.get(source.platform_key) === "zara") {
      byZaraRegion[source.platform_key] = {eligible_products: 0, ...emptyFallbackCounters()}
    }
  }
  for (const row of rows) {
    if (sourceTypeByKey.get(row.platform) !== "zara") continue
    byZaraRegion[row.platform].eligible_products++
  }
  console.log(`상세 보완 시작: ${groups.length}개 소스 · ${rows.length}개 상품 · 동시 ${concurrency} · 마감 ${deadlineRaw}`)
  const hasZara = groups.some((group) => group.type === "zara")
  const browser = groups.some((group) => group.type === "cafe24" || group.type === "zara")
    ? await chromium.launch(hasZara
      ? {headless: process.env.CRAWLER_ZARA_HEADED !== "1", channel: "chrome"}
      : {headless: true})
    : null
  const zaraSessions = new Map<string, {context: BrowserContext; page: Page}>()
  const getZaraPage = async (platform: string, lane: number): Promise<Page> => {
    const sessionKey = `${platform}:${lane}`
    const existing = zaraSessions.get(sessionKey)
    if (existing) return existing.page
    if (!browser) throw new Error("Zara browser is unavailable")
    const config = configByKey.get(platform)
    const region = config?.region === "US" ? "US" : "KR"
    const context = await browser.newContext({
      locale: region === "US" ? "en-US" : "ko-KR",
      timezoneId: region === "US" ? "America/New_York" : "Asia/Seoul",
      viewport: {width: 1440, height: 900},
    })
    await installRequestBlocking(context, {allowStylesheets: true})
    const page = await context.newPage()
    zaraSessions.set(sessionKey, {context, page})
    return page
  }
  try {
    await Promise.all(Array.from({length: concurrency}, async () => {
      let context = null as Awaited<ReturnType<NonNullable<typeof browser>["newContext"]>> | null
      let page: Page | null = null
      let cafe24Requests = 0
      const resetCafe24Context = async () => {
        await context?.close().catch(() => undefined)
        if (!browser) return
        context = await browser.newContext()
        await installRequestBlocking(context)
        page = await context.newPage()
        cafe24Requests = 0
      }
      try {
        while (Date.now() < deadline) {
          if (limit > 0 && metrics.attempted >= limit) break
          const group = groups.shift()
          if (!group) break
          const row = group.rows.shift()
          if (!row) continue
          // The group is absent from the shared queue while awaited, enforcing source concurrency=1.
          const config = configByKey.get(group.platform)
          const sourceCurrency = row.source_currency ?? config?.sourceCurrency ?? "KRW"
          const counters: FallbackCounters[] = [metrics, byType[group.type]]
          if (group.type === "zara") counters.push(byZaraRegion[group.platform])
          const count = (field: keyof FallbackCounters) => {
            for (const counter of counters) counter[field]++
          }
          // Claim the global limit before the request yields so parallel workers cannot overshoot it.
          count("attempted")
          let observation: DetailObservation
          if (group.type === "shopify") {
            observation = await fetchShopify(row, sourceCurrency)
            // Detail endpoints are more aggressively rate-limited than
            // `/products.json`. Respect the source pacing just like the
            // listing engine; the nightly worker keeps one lane per source.
            const delayMs = Math.max(250, config?.crawlDelay ?? 500)
            if (group.rows.length > 0 && Date.now() + delayMs < deadline) {
              await new Promise((resolve) => setTimeout(resolve, delayMs))
            }
          } else if (group.type === "cafe24") {
            if (!page || cafe24Requests >= cafe24ContextMaxRequests) await resetCafe24Context()
            observation = await fetchCafe24(page!, row)
            cafe24Requests++
          } else if (group.type === "zara") {
            const zaraPage = await getZaraPage(group.platform, group.lane)
            observation = await fetchZara(zaraPage, row, sourceCurrency)
            if (observation.kind === "transient" && Date.now() + 2_000 < deadline) {
              await zaraPage.waitForTimeout(2_000)
              observation = await fetchZara(zaraPage, row, sourceCurrency)
            }
          } else {
            observation = group.type === "sixshop"
              ? await fetchSixshopDetail(row, sourceCurrency)
              : await fetchStructuredDetail(row, sourceCurrency, deadline, config?.categoryUrls ?? [])
            const delayMs = detailFallbackPacingMs(group.type, config?.crawlDelay)
            if (group.rows.length > 0 && Date.now() + delayMs < deadline) {
              await new Promise((resolve) => setTimeout(resolve, delayMs))
            }
          }
          let retryReason: Parameters<typeof detailRetryAt>[0] = observation.kind
          if (observation.kind === "confirmed") {
            if (audit) count("confirmed")
            else {
              const result = await writeConfirmed(db, row, observation)
              if (result === "updated") {
                count("confirmed"); count("updated")
              } else if (result === "confirmed") {
                count("confirmed")
              } else if (result === "conflict") {
                count("cas_conflicts")
                retryReason = "cas_conflict"
              } else {
                count("db_failed")
                retryReason = "db_failed"
              }
            }
          } else if (observation.kind === "removed") {
            count("removed")
            if (!audit) {
              const result = await recordRemovedCheck(db, row)
              if (result === "recorded") {
                count("removed_recorded")
              } else {
                count("removed_record_failed")
                if (result === "conflict") {
                  count("cas_conflicts")
                  retryReason = "cas_conflict"
                } else {
                  count("db_failed")
                  retryReason = "db_failed"
                }
              }
            }
          } else {
            count(observation.kind)
          }
          if (rolling) {
            const observedAt = Date.now()
            const productRetryAt = detailRetryAt(retryReason, observedAt, observation.retryAt)
            if (productRetryAt) {
              retryState.products[row.id] = {retry_at: productRetryAt, reason: retryReason}
            } else {
              delete retryState.products[row.id]
            }
            if (observation.kind === "blocked" || observation.kind === "transient") {
              const sourceRetryAt = detailRetryAt(observation.kind, observedAt, observation.retryAt)
              if (sourceRetryAt) {
                retryState.sources[group.platform] = {retry_at: sourceRetryAt, reason: observation.kind}
              }
              // Avoid hammering every old URL on a source that is blocked or rate-limited.
              group.rows.length = 0
            }
          }
          if (group.rows.length > 0 && Date.now() < deadline) enqueueGroup(group)
        }
      } finally {
        await context?.close()
      }
    }))
  } finally {
    await Promise.all([...zaraSessions.values()].map(({context}) => context.close().catch(() => undefined)))
    await browser?.close()
  }
  if (rolling) await saveRetryState(retryStateFile, retryState)
  const finalMetrics = {
    ...metrics,
    priority,
    rolling,
    cooled_products: cooledProducts,
    cooldown_products: Object.keys(retryState.products).length,
    cooldown_sources: Object.keys(retryState.sources).length,
    by_type: byType,
    by_zara_region: byZaraRegion,
  }
  if (!audit && batchId !== null) {
    // Listing and detail observations are two halves of one refresh. A source
    // that failed the listing-overlap guard can be recovered once persisted
    // last_seen_at/crawled_at evidence reaches the same 70% threshold.
    const remaining = await loadUnconfirmedProducts(db, since, eligible)
    const remainingByPlatform = new Map<string, number>()
    for (const row of remaining) {
      remainingByPlatform.set(row.platform, (remainingByPlatform.get(row.platform) ?? 0) + 1)
    }
    const recoveredSources: Array<{platform: string; coverage: number}> = []
    for (const source of eligibleSources) {
      if (source.status !== "exception" || source.exception_code !== "coverage_guard") continue
      const coverage = combinedRefreshCoverage(
        source.product_count,
        remainingByPlatform.get(source.platform_key) ?? 0,
      )
      if (!detailFallbackRecovered(
        source.product_count,
        remainingByPlatform.get(source.platform_key) ?? 0,
        reconcileMinCoverage,
      )) continue
      const {error} = await db.from("product_refresh_batch_sources")
        .update({status: "success", exception_code: null, exception_message: null})
        .eq("batch_id", batchId)
        .eq("platform_key", source.platform_key)
        .eq("status", "exception")
        .eq("exception_code", "coverage_guard")
        .abortSignal(AbortSignal.timeout(20_000))
      if (error) throw new Error(`detail fallback coverage reconciliation failed: ${error.message}`)
      recoveredSources.push({platform: source.platform_key, coverage: Number(coverage.toFixed(3))})
    }
    Object.assign(finalMetrics, {recovered_sources: recoveredSources})
    const {data: batch, error: batchError} = await db.from("product_refresh_batches").select("metrics").eq("id", batchId).single()
    if (batchError) throw new Error(`batch metrics load failed: ${batchError.message}`)
    const existingMetrics = ((batch as {metrics?: Record<string, unknown>}).metrics ?? {})
    const {error: metricsError} = await db.from("product_refresh_batches")
      .update({metrics: {...existingMetrics, detail_fallback: {...finalMetrics, ended_at: new Date().toISOString()}}})
      .eq("id", batchId)
    if (metricsError) throw new Error(`batch metrics update failed: ${metricsError.message}`)
  }
  console.log(JSON.stringify(finalMetrics))
  if (metrics.db_failed > 0 || metrics.cas_conflicts > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

import type {PlatformType, SiteConfig} from "./types"

/**
 * Whether a cafe24/imweb crawl should also visit each PDP.
 *
 * Unset means ON. Only an explicit `false` turns it off, and the two places
 * that pass one are deliberate: the `--no-detail` CLI flag, and
 * `refresh-listing` (which only UPDATEs price/in_stock and has no use for the
 * detail page).
 *
 * The default was flipped on 2026-08-26. As opt-in it silently capped these
 * sites at one image per product — the list page yields a single thumbnail and
 * the gallery lives only on the PDP — which leaves representative-image
 * (model-shot) selection with nothing to choose from. Measured at the time:
 * 16% of the catalogue (39,469 / 248,093 rows) had at most one image, and
 * every imweb site with detail off sat at 51.4% while the one with it on sat
 * at 0%. Initial collection happens once per product, so paying the extra
 * request then is cheaper than a re-collection pass later.
 */
export function shouldCrawlDetails(config: Pick<SiteConfig, "crawlDetails">): boolean {
  return config.crawlDetails !== false
}

export interface PlatformConfigLifecycleRow {
  status: string
  config_status: string
  origin_country: string | null
  kr_eligibility_status: string
  platform_type: string
  detection: Record<string, unknown> | null
}

const COLLECTED_STATUSES = new Set(["crawled", "imported", "embedded", "active"])
const ONBOARDING_STATUSES = new Set(["tech_detected", "qc_failed"])

/**
 * Config inventory and brand onboarding state are different lifecycles.
 *
 * New automatic configs require either KR origin or verified KR storefront
 * eligibility, but a config that already produced
 * data must survive later workflow transitions and origin metadata changes.
 * Blocked rows are retained so the generator can emit them as disabled instead
 * of silently deleting the source from the inventory.
 */
export function shouldGeneratePlatformConfig(row: PlatformConfigLifecycleRow): boolean {
  if (COLLECTED_STATUSES.has(row.status)) return true
  if (row.status === "blocked") return true
  return (
    ONBOARDING_STATUSES.has(row.status) &&
    (row.origin_country === "KR" ||
      row.kr_eligibility_status === "eligible_origin" ||
      row.kr_eligibility_status === "eligible_storefront")
  )
}

/** Map the DB's coarse platform enum to an executable crawler engine. */
export function generatedPlatformType(row: PlatformConfigLifecycleRow): PlatformType | null {
  if (row.platform_type === "cafe24" || row.platform_type === "shopify") {
    return row.platform_type
  }
  if (
    row.platform_type === "custom" &&
    row.detection?.platform_family === "imweb"
  ) {
    return "imweb"
  }
  if (
    row.platform_type === "custom" &&
    row.detection?.platform_family === "sixshop"
  ) {
    return "sixshop"
  }
  return null
}

export function shouldDisableGeneratedConfig(row: PlatformConfigLifecycleRow): boolean {
  return row.status === "blocked" || row.config_status === "blocked"
}

/**
 * product_crawl_status keeps the historical coarse enum where Imweb is
 * represented as custom and its concrete family lives in detection JSON.
 */
export function queuePlatformType(type: PlatformType): string {
  return type === "imweb" || type === "sixshop" || type === "structured" ? "custom" : type
}

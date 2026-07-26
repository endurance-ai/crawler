import type {PlatformType} from "./types"

export interface PlatformConfigLifecycleRow {
  status: string
  config_status: string
  origin_country: string | null
  platform_type: string
  detection: Record<string, unknown> | null
}

const COLLECTED_STATUSES = new Set(["crawled", "imported", "embedded", "active"])
const ONBOARDING_STATUSES = new Set(["tech_detected", "qc_failed"])

/**
 * Config inventory and brand onboarding state are different lifecycles.
 *
 * New automatic configs remain KR-scoped, but a config that already produced
 * data must survive later workflow transitions and origin metadata changes.
 * Blocked rows are retained so the generator can emit them as disabled instead
 * of silently deleting the source from the inventory.
 */
export function shouldGeneratePlatformConfig(row: PlatformConfigLifecycleRow): boolean {
  if (COLLECTED_STATUSES.has(row.status)) return true
  if (row.status === "blocked") return true
  return ONBOARDING_STATUSES.has(row.status) && row.origin_country === "KR"
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
  return type === "imweb" ? "custom" : type
}

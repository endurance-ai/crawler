export type Cafe24EngineMode = "chromium" | "lightpanda" | "auto"

export const DEFAULT_CHROMIUM_CAFE24_PARALLEL = 3
export const DEFAULT_LIGHTPANDA_CAFE24_PARALLEL = 8
export const DEFAULT_CAFE24_DETAIL_CONCURRENCY = 3

export function parseCafe24EngineMode(value: string | undefined): Cafe24EngineMode {
  if (value === "lightpanda" || value === "auto" || value === "chromium") return value
  return "chromium"
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

export function cafe24ParallelLimitFor(mode: Cafe24EngineMode, env = process.env): number {
  if (mode === "chromium") {
    return parsePositiveInt(env.CRAWLER_CAFE24_PARALLEL, DEFAULT_CHROMIUM_CAFE24_PARALLEL)
  }
  return parsePositiveInt(env.CRAWLER_CAFE24_LIGHTPANDA_PARALLEL, DEFAULT_LIGHTPANDA_CAFE24_PARALLEL)
}

export function cafe24DetailConcurrency(env = process.env): number {
  return parsePositiveInt(env.CRAWLER_CAFE24_DETAIL_CONCURRENCY, DEFAULT_CAFE24_DETAIL_CONCURRENCY)
}

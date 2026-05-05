/**
 * robots.txt blanket-Disallow detector.
 *
 * Used by the platform-registration validator and the per-crawl pre-flight
 * gate (REQ-004 of SPEC-PLATFORM-EXPANSION-001). Engine-agnostic — applies
 * to every platform regardless of `type`.
 *
 * @MX:NOTE: Fail-closed on every fetch error. Returning `allowed:false` on
 * 4xx/5xx/network/timeout is a deliberate security choice — fail-open would
 * silently bypass project HARD rule #1 ("Sites that explicitly forbid
 * crawling → DEFER") for any site whose robots.txt is briefly unreachable.
 */

export interface RobotsCheckResult {
  allowed: boolean
  blockingLine?: string
}

const FETCH_TIMEOUT_MS = 5000

/**
 * Fetch `<baseUrl>/robots.txt` (host root, ignoring any path on baseUrl) and
 * return whether the `User-agent: *` group permits a generic crawler.
 *
 * Returns `{allowed:false, blockingLine}` on:
 * - HTTP non-2xx
 * - Network error / timeout
 * - `User-agent: *` group containing a verbatim `Disallow: /` line
 *
 * Returns `{allowed:true}` only when robots.txt is reachable AND the wildcard
 * group does NOT contain a blanket disallow.
 */
export async function checkRobots(baseUrl: string): Promise<RobotsCheckResult> {
  let robotsUrl: string
  try {
    robotsUrl = new URL("/robots.txt", baseUrl).toString()
  } catch (err) {
    return {allowed: false, blockingLine: `robots.txt URL construction failed: ${String(err)}`}
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    })
  } catch (err) {
    clearTimeout(timer)
    return {allowed: false, blockingLine: `robots.txt fetch failed: ${String(err)}`}
  }
  clearTimeout(timer)

  if (!res.ok) {
    return {allowed: false, blockingLine: `robots.txt fetch failed: HTTP ${res.status}`}
  }

  let body: string
  try {
    body = await res.text()
  } catch (err) {
    return {allowed: false, blockingLine: `robots.txt body read failed: ${String(err)}`}
  }

  return parseRobotsBody(body)
}

/**
 * Parse a robots.txt body and check the `User-agent: *` group(s) for a
 * verbatim `Disallow: /` directive. Exposed for unit testing.
 */
export function parseRobotsBody(body: string): RobotsCheckResult {
  const lines = body.split(/\r?\n/)
  let inWildcardGroup = false

  for (const rawLine of lines) {
    // Strip inline comments and trim.
    const line = rawLine.replace(/#.*$/, "").trim()
    if (line === "") {
      // Blank line ends the current group per RFC 9309.
      inWildcardGroup = false
      continue
    }

    const colon = line.indexOf(":")
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === "user-agent") {
      inWildcardGroup = value === "*"
      continue
    }

    if (inWildcardGroup && field === "disallow" && value === "/") {
      return {allowed: false, blockingLine: "Disallow: /"}
    }
  }

  return {allowed: true}
}

/**
 * 원격 이미지·HTML 안전 취득 (SSRF 가드 + 크기 상한). 범용 유틸이지만
 * 현재 소비처는 휴면 상태인 모델컷 선별 경로뿐이다 —
 * `src/select-product-images.ts` 헤더 참조. 다른 곳에서 재사용해도 된다.
 */
import {lookup} from "node:dns/promises"
import * as fs from "node:fs/promises"
import * as net from "node:net"
import * as path from "node:path"
import {randomUUID} from "node:crypto"

import {MAX_IMAGE_BYTES} from "./product-image-selection"

const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const USER_AGENT = "Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X) kiko.ai product-image-selector/1"

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

export function isPublicIp(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family !== 6) return false
  const lower = address.toLowerCase()
  if (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith("ff") ||
    lower.startsWith("2001:db8:")
  ) {
    return false
  }
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  return mapped ? isPublicIpv4(mapped) : true
}

export async function validateRemoteUrl(raw: string): Promise<URL> {
  const url = new URL(raw)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`unsupported URL protocol: ${url.protocol}`)
  }
  if (url.username || url.password) throw new Error("credentialed URLs are not allowed")
  const hostname = url.hostname.toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("local hostnames are not allowed")
  }

  const directFamily = net.isIP(hostname)
  const addresses = directFamily
    ? [{address: hostname}]
    : await lookup(hostname, {all: true, verbatim: true})
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new Error(`URL resolves to a non-public address: ${hostname}`)
  }
  return url
}

async function fetchWithSafeRedirects(raw: string, accept: string): Promise<Response> {
  let current = raw
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const url = await validateRemoteUrl(current)
    const response = await fetch(url, {
      redirect: "manual",
      headers: {"User-Agent": USER_AGENT, Accept: accept},
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get("location")
    if (!location) throw new Error(`redirect without location (${response.status})`)
    await response.body?.cancel().catch(() => {})
    current = new URL(location, url).toString()
  }
  throw new Error(`too many redirects for ${raw}`)
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`response exceeds ${maxBytes} bytes`)
  }
  if (!response.body) throw new Error("response has no body")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`response exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}

async function fetchWithRetries(raw: string, accept: string): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchWithSafeRedirects(raw, accept)
    last = response
    if (response.status !== 429 && response.status < 500) return response
    if (attempt === 2) return response
    const retryAfter = Number(response.headers.get("retry-after"))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000)
      : 500 * 2 ** attempt
    await response.body?.cancel().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  return last!
}

export async function fetchProductHtml(url: string): Promise<string> {
  const response = await fetchWithRetries(url, "text/html,application/xhtml+xml")
  if (!response.ok) throw new Error(`detail page HTTP ${response.status}`)
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType && !contentType.includes("html") && !contentType.includes("text/plain")) {
    throw new Error(`unexpected detail content-type: ${contentType}`)
  }
  return (await readLimited(response, MAX_HTML_BYTES)).toString("utf8")
}

export async function downloadRemoteImage(
  url: string,
  tempDir: string,
): Promise<{path: string; byteLength: number; mimeType: string}> {
  const response = await fetchWithRetries(url, "image/avif,image/webp,image/*,*/*;q=0.5")
  if (!response.ok) throw new Error(`image HTTP ${response.status}`)
  const mimeType = (response.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase()
  if (
    mimeType &&
    !mimeType.startsWith("image/") &&
    mimeType !== "application/octet-stream" &&
    mimeType !== "binary/octet-stream"
  ) {
    throw new Error(`unexpected image content-type: ${mimeType}`)
  }
  const bytes = await readLimited(response, MAX_IMAGE_BYTES)
  await fs.mkdir(tempDir, {recursive: true})
  const target = path.join(tempDir, `${randomUUID()}.image`)
  await fs.writeFile(target, bytes, {flag: "wx"})
  return {path: target, byteLength: bytes.byteLength, mimeType}
}

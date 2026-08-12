#!/usr/bin/env npx tsx
/** Collect read-only gender evidence from official storefront navigation. */
import * as fs from "node:fs"

import {getSiteConfig} from "../src/configs/platforms"

const platforms = (process.argv.find((arg) => arg.startsWith("--platforms="))?.slice(12) ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6)
if (platforms.length === 0) throw new Error("--platforms=key,key is required")

const patterns = {
  men: /(?:\bmen(?:'s|s)?\b|\bmenswear\b|\bman\b|남성|맨즈)/i,
  women: /(?:\bwom[ae]n(?:'s|s)?\b|\bwomenswear\b|\blad(?:y|ies)\b|여성|우먼)/i,
  unisex: /(?:\bunisex\b|\bgenderless\b|\bgender[- ]?neutral\b|남녀공용|젠더리스)/i,
} as const

function decode(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function linksOf(html: string, baseUrl: string) {
  const links: Array<{text: string; url: string}> = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decode(match[2] ?? "")
    if (!text) continue
    let url: string
    try {
      url = new URL(match[1]!, baseUrl).toString()
    } catch {
      continue
    }
    const key = `${text}\t${url}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({text, url})
  }
  return links
}

function isCatalogLink(link: {text: string; url: string}): boolean {
  return /\/(?:collections?|categor(?:y|ies)|shop|products?)(?:\/|\?|$)|cate_no=/i.test(link.url)
}

async function shopifyCollectionLinks(baseUrl: string): Promise<Array<{text: string; url: string}>> {
  try {
    const origin = new URL(baseUrl).origin
    const response = await fetch(`${origin}/collections.json?limit=250`, {
      headers: {"User-Agent": "Mozilla/5.0 (compatible; KikoGenderAudit/1.0)"},
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return []
    const body = await response.json() as {collections?: Array<{title?: string; handle?: string}>}
    return (body.collections ?? [])
      .filter((collection) => collection.title && collection.handle)
      .map((collection) => ({text: collection.title!, url: `${origin}/collections/${collection.handle}`}))
  } catch {
    return []
  }
}

async function audit(key: string) {
  const config = getSiteConfig(key)
  if (!config) return {key, error: "config_missing"}
  try {
    const response = await fetch(config.baseUrl, {
      headers: {"User-Agent": "Mozilla/5.0 (compatible; KikoGenderAudit/1.0)"},
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    })
    const html = await response.text()
    const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    const metaDescription = decode(
      html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)?.[1]
        ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1]
        ?? "",
    )
    const homepageLinks = linksOf(html, response.url || config.baseUrl).filter(isCatalogLink)
    const collectionLinks = config.type === "shopify" ? await shopifyCollectionLinks(response.url || config.baseUrl) : []
    const links = [...homepageLinks, ...collectionLinks].filter(
      (link, index, all) => all.findIndex((candidate) => candidate.text === link.text && candidate.url === link.url) === index,
    )
    const evidence = Object.fromEntries(
      Object.entries(patterns).map(([label, pattern]) => [
        label,
        links.filter((link) => pattern.test(`${link.text} ${link.url}`)).slice(0, 20),
      ]),
    ) as Record<keyof typeof patterns, Array<{text: string; url: string}>>
    const visibleText = decode(html).slice(0, 200_000)
    const bodySignals = Object.fromEntries(
      Object.entries(patterns).map(([label, pattern]) => [label, pattern.test(visibleText)]),
    )
    const verdict = evidence.men.length > 0 && evidence.women.length > 0
      ? "mixed_navigation"
      : evidence.unisex.length > 0
        ? "explicit_unisex"
        : evidence.women.length > 0
          ? "women_navigation"
          : evidence.men.length > 0
            ? "men_navigation"
            : "inconclusive"
    return {
      key,
      name: config.name,
      baseUrl: config.baseUrl,
      finalUrl: response.url,
      status: response.status,
      title,
      metaDescription,
      verdict,
      evidence,
      bodySignals,
      catalogSample: links.slice(0, 100),
    }
  } catch (error) {
    return {key, name: config.name, baseUrl: config.baseUrl, error: error instanceof Error ? error.message : String(error)}
  }
}

const results: unknown[] = []
let cursor = 0
await Promise.all(Array.from({length: Math.min(8, platforms.length)}, async () => {
  while (cursor < platforms.length) results.push(await audit(platforms[cursor++]!))
}))
results.sort((a, b) => String((a as {key: string}).key).localeCompare(String((b as {key: string}).key)))
const payload = {generatedAt: new Date().toISOString(), platforms: platforms.length, results}
if (out) fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8")
console.log(JSON.stringify(payload, null, 2))

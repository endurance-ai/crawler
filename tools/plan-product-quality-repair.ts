/** Read-only official-page repair planner. Never connects to or writes the DB.
 * Input is a bounded audit snapshot; output retains before/after and evidence.
 * Usage: tsx tools/plan-product-quality-repair.ts --snapshot=... --out=...
 */
import fs from "node:fs/promises"
import path from "node:path"
import {pathToFileURL} from "node:url"
import {parseArgs} from "node:util"
import {getSiteConfig} from "../src/configs/platforms"
import {inferExplicitProductGender, inferGenderFromText} from "../src/lib/product-gender"
import {collectProductImagesFromHtml, extractShopifyProductImages, mergeProductImages, normalizeProductImageUrl} from "../src/lib/product-images"
import {extractStructuredProductForUrl} from "../src/lib/parsers/structured-data"
import {sameProductPage} from "../src/lib/product-url-identity"
import {checkRobots} from "../src/lib/robots-check"
import {fetchProductHtml, validateRemoteUrl, downloadRemoteImage} from "../src/lib/safe-remote-image"

export interface AuditRow {
  id: string
  platform: string
  name: string
  product_url: string
  image_url: string | null
  source_image_url: string | null
  image_revision: string
  images: string[] | null
  gender: string[]
  gender_source: string | null
  repair_gender: boolean
  repair_images: boolean
  enrich_images: boolean
}

// Audited legacy platform aliases: use only the exact official hosts observed
// in the incident, not arbitrary parent/sibling domains of a configured host.
const AUDITED_ORIGINS: Record<string, string[]> = {
  "en-208": ["https://lesugiatelier.com", "https://en.lesugiatelier.com"],
  conichiwabonjour: ["https://conichiwabonjour.com"],
}

export function verifiedGenderTarget(platform: string, name: string): string | null {
  // These five sites were checked against their explicit official audiences.
  if (!["uniformbridge", "matin-kim", "fr8ight", "en-5258", "en-579"].includes(platform)) return null
  if (platform === "en-579" && /^MENS\s/i.test(name)) return "men"
  if (platform === "en-5258" && /\bMens\b/i.test(name)) return "men"
  return inferExplicitProductGender(name)
}

export function officialPageMatches(html: string, url: string): boolean {
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].filter(m=>/\brel\s*=\s*["']canonical["']/i.test(m[0]))
  if (canonical.some(m => {
    const href = m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    return href && sameProductPage(href.replace(/&amp;/g, "&"), url)
  })) return true
  const pageNo = html.match(/\bvar\s+iProductNo\s*=\s*(\d+)\s*;/)?.[1]
  return Boolean(pageNo && sameProductPage(new URL(`/product/detail.html?product_no=${pageNo}`, url).href, url))
}

export function observedName(html: string, url: string): string | null {
  const variable = html.match(/\bvar\s+product_name\s*=\s*'((?:\\.|[^'\\])*)'/)?.[1]
  return variable?.replace(/\\'/g, "'").replace(/&amp;/g, "&") ?? extractStructuredProductForUrl(html, url)?.name ?? null
}

export function sameName(a: string, b: string, platform?: string): boolean {
  const clean = (value: string) => {
    let name = value.normalize("NFKC").toLowerCase().replace(/^product\s*:\s*/, "")
    if (platform === "draw-attention") name = name.replace(/^\[(?=[^\]]*(?:당일|무배|할인|sale))[^\]]*\]\s*/i, "")
    if (platform === "en-208") name = name.replace(/[_\s]unisex\b/gi, "")
    return name.replace(/[^\p{L}\p{N}]/gu, "")
  }
  const left = clean(a), right = clean(b)
  return left.length >= 4 && right.length >= 4 && (left === right || (Math.min(left.length, right.length) / Math.max(left.length, right.length) > 0.8 && (left.includes(right) || right.includes(left))))
}

/** Validate file-derived IDs before using them as scope or cache filenames. */
export function selectAuditRows(snapshot: unknown, ids?: string): AuditRow[] {
  const rows = (snapshot as {rows?: unknown} | null)?.rows
  if (!Array.isArray(rows)) throw new Error("snapshot must contain a rows array")
  const validId = (id: unknown): id is string => typeof id === "string"
    && /^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n
  const known = new Set<string>()
  for (const row of rows) {
    if (!row || !validId(row.id) || known.has(row.id)) throw new Error("snapshot IDs must be unique positive bigint strings")
    known.add(row.id)
  }
  if (ids === undefined) return rows as AuditRow[]
  const values = ids.split(",").map(id => id.trim())
  if (values.some(id => !validId(id) || !known.has(id))) throw new Error("--ids must contain valid IDs present in the snapshot")
  const wanted = new Set(values)
  return rows.filter(row => wanted.has(row.id)) as AuditRow[]
}

export function parseRepairArgs(args = process.argv.slice(2)) {
  return parseArgs({args, options: {
    snapshot: {type: "string"},
    out: {type: "string"},
    ids: {type: "string"},
    concurrency: {type: "string"},
    "reuse-pages": {type: "boolean"},
  }}).values
}

async function main() {
  const args = parseRepairArgs()
  const input = args.snapshot, output = args.out
  if (!input || !output) throw new Error("--snapshot and --out are required")
  const concurrency = Number(args.concurrency ?? 4)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("concurrency must be 1..8")
  const reusePages = args["reuse-pages"] === true
  const snapshot: unknown = JSON.parse(await fs.readFile(input, "utf8"))
  const rows = selectAuditRows(snapshot, args.ids)
    .sort((a,b) => Number(b.repair_images)-Number(a.repair_images) || Number(b.repair_gender)-Number(a.repair_gender) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  const dir = path.dirname(output)
  await fs.mkdir(path.join(dir,"pages"), {recursive:true})
  await fs.mkdir(path.join(dir,"image-checks"), {recursive:true})
  const handle = await fs.open(output, "wx", 0o600)
  const robots = new Map<string, Promise<boolean>>()
  let writes = Promise.resolve()
  let next = 0, planned = 0, skipped = 0, failed = 0
  async function one(row: AuditRow) {
    const config = getSiteConfig(row.platform)
    const target = new URL(row.product_url)
    const auditedOrigin = AUDITED_ORIGINS[row.platform]?.includes(target.origin)
    if (!config && !auditedOrigin) return {id:row.id,status:"skipped",reason:"unregistered platform"}
    const base = new URL(auditedOrigin ? target.origin : config!.baseUrl)
    if (base.hostname.replace(/^www\./, "") !== target.hostname.replace(/^www\./, "")) return {id:row.id,status:"skipped",reason:"configured host mismatch"}
    if (!row.repair_images && !row.enrich_images && !verifiedGenderTarget(row.platform,row.name)) return {id:row.id,status:"skipped",reason:"ambiguous gender candidate"}
    let allowed = robots.get(base.origin)
    if (!allowed) {allowed=checkRobots(base.origin).then(r=>r.allowed); robots.set(base.origin,allowed)}
    if (!await allowed) return {id:row.id,status:"skipped",reason:"robots preflight denied or unavailable"}
    let name: string | null = null, images: string[] = [], evidence = ""
    if (config?.type === "shopify") {
      const endpoint = new URL(row.product_url)
      endpoint.search=""; endpoint.hash=""; endpoint.pathname=endpoint.pathname.replace(/\/$/, "")+".js"
      await validateRemoteUrl(endpoint.href)
      const cached = reusePages ? await fs.readFile(path.join(dir,"pages",row.id+".json"),"utf8").catch(()=>null) : null
      let product: {title:string;handle:string}
      if (cached) product=JSON.parse(cached)
      else {
        const response = await fetch(endpoint, {redirect:"error",signal:AbortSignal.timeout(20_000)})
        if (!response.ok) throw new Error(`product JSON HTTP ${response.status}`)
        product=await response.json() as {title:string;handle:string}
      }
      if (product.handle !== target.pathname.split("/").filter(Boolean).pop()) throw new Error("product JSON handle mismatch")
      name=product.title; images=mergeProductImages(null,row.product_url,extractShopifyProductImages(product)); evidence=endpoint.href
      await fs.writeFile(path.join(dir,"pages",row.id+".json"),JSON.stringify(product))
    } else {
      const cached = reusePages ? await fs.readFile(path.join(dir,"pages",row.id+".html"),"utf8").catch(()=>null) : null
      const html=cached ?? await fetchProductHtml(row.product_url).catch(async error=>{
        const productNo=target.searchParams.get("product_no") ?? target.pathname.match(/\/product\/[^/]+\/(\d+)(?:\/|$)/)?.[1]
        if (!productNo || !(error instanceof Error) || !error.message.includes("HTTP 404")) throw error
        const canonical=new URL(`/product/detail.html?product_no=${productNo}`,target).href
        if(canonical===row.product_url) throw error
        return fetchProductHtml(canonical)
      })
      await fs.writeFile(path.join(dir,"pages",row.id+".html"),html)
      if (!officialPageMatches(html,row.product_url)) throw new Error("official page identity mismatch")
      name=observedName(html,row.product_url); images=collectProductImagesFromHtml(html,row.product_url); evidence=row.product_url
    }
    if (!name || !sameName(row.name,name,row.platform)) return {id:row.id,status:"skipped",reason:"official product name mismatch",observedName:name}
    const after: {gender?:string[];gender_source?:string;image_url?:string;source_image_url?:string;images?:string[]} = {}
    if (row.repair_gender) {
      const targetGender=verifiedGenderTarget(row.platform,name)
      if (targetGender && targetGender === inferGenderFromText(name) && row.gender[0] !== targetGender) {
        after.gender=[targetGender]; after.gender_source="repair_text"
      }
    }
    if (row.repair_images || row.enrich_images) {
      if (images.length === 0) throw new Error("no owned images")
      const hero = row.repair_images ? images[0] : normalizeProductImageUrl(row.image_url,row.product_url) ?? images[0]
      after.image_url=hero
      after.source_image_url=row.repair_images ? images[0] : normalizeProductImageUrl(row.source_image_url,row.product_url) ?? images[0]
      after.images=mergeProductImages(hero,row.product_url,images)
      if (hero !== row.image_url) {
        const downloaded=await downloadRemoteImage(hero,path.join(dir,"image-checks"))
        if (downloaded.byteLength < 256) throw new Error("representative image is implausibly small")
      }
    }
    if (Object.keys(after).length === 0) return {id:row.id,status:"skipped",reason:"no verified correction"}
    const {id,platform,name:oldName,product_url,image_url,source_image_url,image_revision,images:oldImages,gender,gender_source} = row
    return {id,status:"planned",evidence,observedName:name,before:{id,platform,name:oldName,product_url,image_url,source_image_url,image_revision,images:oldImages,gender,gender_source},after}
  }
  try {
    await Promise.all(Array.from({length:concurrency},async()=>{
      while (next<rows.length) {
        const row=rows[next++]
        let result
        try {result=await one(row)} catch(error) {result={id:row.id,status:"failed",reason:error instanceof Error?error.message:String(error)}}
        if(result.status==="planned") planned++; else if(result.status==="failed") failed++; else skipped++
        writes=writes.then(async()=>{await handle.write(JSON.stringify(result)+"\n")})
        await writes
        if ((planned+skipped+failed)%25===0 || planned+skipped+failed===rows.length) console.log(JSON.stringify({done:planned+skipped+failed,total:rows.length,planned,skipped,failed}))
      }
    }))
  } finally {await handle.close()}
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{console.error(error);process.exitCode=1})

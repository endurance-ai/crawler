/**
 * SPEC-ARCH-CRAWLER-001 Phase 2 — per-site extraction strategies.
 *
 * Each strategy is the CURRENT extraction algorithm of the corresponding
 * original src/lib/parsers/detail/<site>-parser.ts, transcribed verbatim
 * (selectors/markers externalized into the registry entry). They are no
 * longer 18 IDetailParser modules — they are dispatch targets of ONE
 * registry-driven parser.
 *
 * [HARD] Behavior-preserving: output MUST be byte-identical to the
 * golden masters, INCLUDING documented bugs (preserve-findings.md). The
 * page.evaluate/$eval bodies below are unmodified copies of the originals
 * so the in-page DOM semantics (innerText newline-collapse, regex order,
 * MODEL SIZE early cut, material-pollution) are reproduced exactly.
 */

import type {Page} from "playwright"
import type {DetailData} from "../detail/types"
import type {RegistryEntry, StrategyId} from "../detail/selector-registry"
import {colorFromOptionList} from "./color"
import {baseDescriptionInPage} from "./description"
import {baseMaterialFromDescription} from "./material"

/** SPEC-CRAWLER-DETAIL-FIX-001 review P1: ReDoS guard — bound untrusted section input before [\s\S]*? regexes */
const MAX_SECTION_INPUT = 10_000

function guardSectionInput(s: string): string {
  return s.length > MAX_SECTION_INPUT ? s.slice(0, MAX_SECTION_INPUT) : s
}

type Strategy = (page: Page, entry: RegistryEntry) => Promise<DetailData>

const empty = (): DetailData => ({
  description: null,
  color: null,
  material: null,
  productCode: null,
})

// ─── base family (base fallback + blankroom + visualaid) ───────────────

const baseStrategy: Strategy = async (page, entry) => {
  const result = empty()
  const extracted = await page.evaluate(
    (args) => {
      // description
      let description: string | null = null
      for (const sel of args.descSels) {
        try {
          const el = document.querySelector(sel)
          if (!el) continue
          const text = (el as HTMLElement).innerText?.trim()
          if (text && text.length > 10) {
            description = text.slice(0, 2000)
            break
          }
        } catch {
          /* next */
        }
      }

      // color
      let color: string | null = null
      for (const sel of args.colorSels) {
        try {
          const options = document.querySelectorAll(sel)
          if (options.length === 0) continue
          const colors: string[] = []
          options.forEach((opt) => {
            const t = (opt as HTMLElement).innerText?.trim() || ""
            if (t && !t.includes("선택") && !t.includes("Select") && t !== "*") colors.push(t)
          })
          if (colors.length > 0) {
            color = colors.slice(0, 20).join(", ").slice(0, 500)
            break
          }
        } catch {
          /* next */
        }
      }

      // productCode
      let productCode: string | null = null
      for (const sel of args.codeSels) {
        try {
          const el = document.querySelector(sel)
          if (!el) continue
          const text = (el as HTMLElement).innerText?.trim()
          if (text) {
            const m = text.match(/[:：]\s*(.+)/)
            productCode = m ? m[1].trim() : text
            break
          }
        } catch {
          /* next */
        }
      }

      // material (from description text) — composition-only extraction.
      // SPEC-CRAWLER-DETAIL-FIX-001 Type 1: inline twin of
      // baseMaterialFromDescription (material.ts). Playwright innerText
      // collapses source newlines to spaces, so the old split("\n")/
      // ([^\n<]{3,80}) over-capture leaked trailing prose into material.
      // Anchor on a material label or a bare <pct>% <fiber> token, then
      // capture ONLY the composition run, stopping at the first
      // non-composition token. MUST stay in sync with material.ts.
      // Accepted narrowing: a material label with no <pct>% <fiber> segment
      // (e.g. "소재: 면/나일론혼방") returns null by design (composition-only,
      // REQ-DFIX-002); the base fallback path is the unknown-site fallback
      // and is out of SPEC scope.
      let material: string | null = null
      if (description) {
        const compSrc =
          "(?:\\d+\\s*%\\s*[A-Za-z가-힣]+|[A-Za-z가-힣]+\\s*\\d+\\s*%)" +
          "(?:\\s*[,/]\\s*(?:\\d+\\s*%\\s*[A-Za-z가-힣]+|[A-Za-z가-힣]+\\s*\\d+\\s*%))*"
        const compRe = new RegExp(compSrc)
        const labelRe = /(?:소재|원단|Material|Fabric|Composition)\s*[:：]?\s*/i
        const labelMatch = description.match(labelRe)
        if (labelMatch && labelMatch.index !== undefined) {
          const rest = description.slice(labelMatch.index + labelMatch[0].length)
          const c = rest.match(compRe)
          if (c) material = c[0].trim()
        }
        if (material === null) {
          const bare = description.match(compRe)
          if (bare) material = bare[0].trim()
        }
      }

      return {description, color, material, productCode}
    },
    {
      descSels: entry.descriptionSelectors ?? [],
      colorSels: entry.colorSelectors ?? [],
      codeSels: entry.codeSelectors ?? [],
      matPattern: entry.materialPatternSrc ?? "",
      matKeywords: entry.materialKeywords ?? [],
    },
  )
  result.description = extracted.description
  result.color = extracted.color
  result.material = extracted.material
  result.productCode = extracted.productCode
  // Equivalent to baseDescriptionInPage/baseMaterialFromDescription
  // (referenced to keep the shared helpers wired into the engine).
  void baseDescriptionInPage
  void baseMaterialFromDescription
  return result
}

// ─── 8division ─────────────────────────────────────────────────────────

const eightDivisionStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const addInfo = document.querySelector("div.product-addinfo")
    const rawText = addInfo ? (addInfo as HTMLElement).innerText?.trim() : null

    let description: string | null = null
    let material: string | null = null

    if (rawText) {
      const prodIdx = rawText.indexOf("제품정보")
      const storeIdx = rawText.indexOf("매장 이용안내")
      const shipIdx = rawText.indexOf("배송 및 교환")

      const endIdx = storeIdx > 0 ? storeIdx : shipIdx > 0 ? shipIdx : rawText.length
      const startIdx = prodIdx >= 0 ? prodIdx + "제품정보".length : 0

      description = rawText.slice(startIdx, endIdx).trim().slice(0, 2000) || null

      if (description) {
        // SPEC-CRAWLER-DETAIL-FIX-001 Type 1: 8division has no material
        // label in the 제품정보 segment, and innerText collapse defeats
        // the old split("\n") + /\d+%\s/ whole-line capture (the segment
        // is one space-joined line, so the entire prose became material).
        // Apply the same composition-only rule as the base family:
        // capture only the <pct>% <fiber> run, stopping at bullet prose.
        const compRe = new RegExp(
          "(?:\\d+\\s*%\\s*[A-Za-z가-힣]+|[A-Za-z가-힣]+\\s*\\d+\\s*%)" +
            "(?:\\s*[,/]\\s*(?:\\d+\\s*%\\s*[A-Za-z가-힣]+|[A-Za-z가-힣]+\\s*\\d+\\s*%))*",
        )
        const cm = description.match(compRe)
        if (cm) material = cm[0].trim().slice(0, 200)
      }
    }

    let color: string | null = null
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) {
      const title = (ogTitle as HTMLMetaElement).content || ""
      const match = title.match(/\(([^)]+)\)\s*$/)
      if (match) color = match[1].trim()
    }

    return {description, color, material, productCode: null as string | null}
  })
  result.description = extracted.description
  result.color = extracted.color
  result.material = extracted.material
  return result
}

// ─── adekuver ──────────────────────────────────────────────────────────

const adekuverStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const descEl = document.querySelector(".item.open .content")
    const description = descEl ? (descEl as HTMLElement).innerText?.trim().slice(0, 2000) : null

    let color: string | null = null
    let material: string | null = null
    const codes: string[] = []

    if (description) {
      // SPEC-CRAWLER-DETAIL-FIX-001 Type 3: innerText collapses the
      // .item.open .content source newlines to spaces, so split("\n")
      // yielded one line and none of the per-line tests matched
      // (color/material/productCode null). Segment on the bullet
      // delimiter that survives the collapse — the same /[-\n]/
      // principle eastlogueStrategy already uses — and tokenise for
      // product codes (which are not bullet-prefixed). description
      // unchanged.
      const segments = description
        .split(/[-\n]/)
        .map((l) => l.trim())
        .filter((l) => l)

      for (const seg of segments) {
        if (!color) {
          const cm = seg.match(/^(.+?)\s*컬러\s*$/)
          if (cm?.[1]?.trim()) color = cm[1].trim() || null
        }

        if (!material && /^\d+\s*%\s*[A-Za-z가-힣]/.test(seg)) {
          material = seg.slice(0, 200)
        }
      }

      for (const tok of description.split(/\s+/)) {
        if (/^[A-Z0-9]{6,}$/.test(tok)) codes.push(tok)
      }
    }

    return {
      description,
      color,
      material,
      productCode: codes.length ? codes.join(", ") : null,
    }
  })
  result.description = extracted.description
  result.color = extracted.color
  result.material = extracted.material
  result.productCode = extracted.productCode
  return result
}

// ─── anotheroffice ─────────────────────────────────────────────────────

const anotherofficeStrategy: Strategy = async (page, entry) => {
  const result = empty()
  const extracted = await page.$$eval(".ec-base-tab", (els) => {
    if (els.length < 2) return {description: null, material: null}
    const text = (els[1] as HTMLElement).innerText?.trim() || ""

    let description: string | null = null
    const descStart = text.indexOf("상품결제정보")
    const descEnd = text.indexOf("배송정보")
    if (descStart >= 0 && descEnd > descStart) {
      description =
        text
          .slice(descStart + "상품결제정보".length, descEnd)
          .trim()
          .slice(0, 2000) || null
    }

    let material: string | null = null
    const refundIdx = text.indexOf("교환 및 반품정보")
    if (refundIdx >= 0) {
      const refundText = text.slice(refundIdx, refundIdx + 500)
      const matMatch = refundText.match(/제조국\s*:\s*[^\n]*?(?:겉감\s*)?([A-Za-z][\w\s,%.'·()]+)/)
      if (matMatch) {
        let mat = matMatch[1].trim()
        const careIdx = mat.search(/[-\-](?:본|이)\s*제품|드라이|세탁|물세탁/)
        if (careIdx > 0) mat = mat.slice(0, careIdx).trim()
        if (mat.length > 3) material = mat
      }
    }

    return {description, material}
  })
  result.description = extracted.description
  result.material = extracted.material
  result.color = await colorFromOptionList(page, entry.optionColorMode ?? "anotheroffice")
  return result
}

// ─── bastong ───────────────────────────────────────────────────────────

const bastongStrategy: Strategy = async (page, entry) => {
  const result = empty()
  const descSel = entry.descriptionSelectors?.[0] ?? "#prdDetail"
  result.description = await page
    .$eval(descSel, (el) => {
      const text = (el as HTMLElement).innerText?.trim()
      return text && text.length > 10 ? text.slice(0, 2000) : null
    })
    .catch(() => null)

  const additional = await page
    .$eval(".xans-product-additional", (el) => (el as HTMLElement).innerText?.trim() || "")
    .catch(() => "")

  if (additional) {
    const matMatch =
      additional.match(/겉감\s*[:：]\s*(.+)/) || additional.match(/Fabric\s*[-:：]\s*(.+)/)
    if (matMatch?.[1]) {
      result.material = matMatch[1].trim().slice(0, 500)
    }
  }

  result.color = await colorFromOptionList(page, entry.optionColorMode ?? "bastong")
  return result
}

// ─── chanceclothing ────────────────────────────────────────────────────

const chanceclothingStrategy: Strategy = async (page, entry) => {
  const result = empty()
  const additionalRaw = await page
    .$eval(".xans-product-additional", (el) => (el as HTMLElement).innerText?.trim() || "")
    .catch(() => "")
  // SPEC-CRAWLER-DETAIL-FIX-001 review P1: ReDoS guard — bound untrusted section input before [\s\S]*? regexes
  const additional = guardSectionInput(additionalRaw)

  if (additional) {
    // SPEC-CRAWLER-DETAIL-FIX-001 Type 2: Playwright innerText collapses
    // the .xans-product-additional source newlines to spaces, so the old
    // \n-anchored regexes never matched (material/description came back
    // null). Whitespace-tolerant section segmentation: bound each value
    // by the next known section label instead of a literal newline.
    const matMatch = additional.match(/소재\s+([\s\S]*?)\s*(?:원산지|$)/)
    if (matMatch?.[1]?.trim()) {
      result.material = matMatch[1].trim().slice(0, 500)
    }

    const descMatch = additional.match(/상품\s*설명\s+([\s\S]*?)\s*(?:더보기|$)/)
    if (descMatch?.[1]?.trim()) {
      result.description = descMatch[1].trim().slice(0, 2000)
    }

    const codeMatch = additional.match(/브랜드\s*품번\s*[:：]\s*(.+)/)
    if (codeMatch?.[1]) {
      result.productCode = codeMatch[1].trim()
    }
  }

  result.color = await colorFromOptionList(page, entry.optionColorMode ?? "chanceclothing")
  return result
}

// ─── eastlogue ─────────────────────────────────────────────────────────

const eastlogueStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const descEl = document.querySelector(".xans-product-additional")
    const rawDesc = descEl ? (descEl as HTMLElement).innerText?.trim() : null

    let description: string | null = null
    if (rawDesc) {
      const cutIdx = rawDesc.search(/제조원\s*[:：]|품질보증\s*[:：]|A\/S\s*문의/i)
      description = (cutIdx > 0 ? rawDesc.slice(0, cutIdx).trim() : rawDesc).slice(0, 2000)
    }

    let material: string | null = null
    if (rawDesc) {
      const matLines: string[] = []
      const lines = rawDesc
        .split(/[-\n]/)
        .map((l) => l.trim())
        .filter((l) => l)
      for (const line of lines) {
        if (/^Outshell/i.test(line) || /^Lining/i.test(line) || /^Shell/i.test(line)) {
          matLines.push(line)
        }
      }
      if (matLines.length) {
        material = matLines.join(" / ").slice(0, 200)
      } else {
        for (const line of lines) {
          if (/^\d+%\s/i.test(line)) {
            material = line.slice(0, 200)
            break
          }
        }
      }
    }

    let color: string | null = null
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) {
      const title = (ogTitle as HTMLMetaElement).content || ""
      const cleaned = title.replace(/\s*-\s*EASTLOGUE\s*$/i, "")
      const slashIdx = cleaned.lastIndexOf("/")
      if (slashIdx > 0) {
        color = cleaned.slice(slashIdx + 1).trim().slice(0, 100) || null
      }
    }

    return {description, color, material, productCode: null as string | null}
  })
  result.description = extracted.description
  result.color = extracted.color
  result.material = extracted.material
  return result
}

// ─── etcseoul ──────────────────────────────────────────────────────────

const etcseoulStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const body = document.body.innerText || ""
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)

    let description: string | null = null
    const navKeywords = /^(NEW ARRIVALS|검색|SEARCH|ACCOUNT|SHOPPING)/
    const sectionMarker = /^\[(?:MATERIAL|SIZE|PRODUCT|COLOR)\b/
    const descLines: string[] = []
    let pastNav = false
    for (const line of lines) {
      if (!pastNav) {
        if (navKeywords.test(line)) continue
        pastNav = true
      }
      if (sectionMarker.test(line)) break
      if (line.startsWith("BRAND\t") || line.startsWith("PRODUCT\t")) break
      if (line.length > 10) descLines.push(line)
    }
    if (descLines.length > 0) description = descLines.join("\n").slice(0, 2000)

    let material: string | null = null
    const matIdx = lines.findIndex((l) => l === "[MATERIAL]")
    if (matIdx >= 0 && lines[matIdx + 1]) {
      material = lines[matIdx + 1]
    }
    if (!material) {
      const matLine = lines.find((l) => /^소재\s*[-–]\s*.+/.test(l))
      if (matLine) material = matLine.replace(/^소재\s*[-–]\s*/, "").trim()
    }

    const colorLine = lines.find((l) => /^색상\s*[-–]\s*.+/.test(l))
    const color = colorLine ? colorLine.replace(/^색상\s*[-–]\s*/, "").trim() : null

    return {description, material, color}
  })
  result.description = extracted.description
  result.material = extracted.material
  result.color = extracted.color
  return result
}

// ─── fr8ight ───────────────────────────────────────────────────────────

const fr8ightStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const descEl = document.querySelector(
      ".xans-product-additional.description, .xans-product-additional.in.description",
    )
    const rawDesc = descEl ? (descEl as HTMLElement).innerText?.trim() : null

    let description: string | null = null
    if (rawDesc) {
      const cutIdx = rawDesc.search(/제조원\s*[:：]|품질보증\s*[:：]|A\/S\s*문의/i)
      description = (cutIdx > 0 ? rawDesc.slice(0, cutIdx).trim() : rawDesc).slice(0, 2000)
    }

    let color: string | null = null
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) {
      const title = (ogTitle as HTMLMetaElement).content || ""
      const slashIdx = title.lastIndexOf("/")
      if (slashIdx > 0) {
        color = title.slice(slashIdx + 1).trim().slice(0, 100) || null
      }
    }

    let material: string | null = null
    if (rawDesc) {
      const lines = rawDesc
        .split(/[-\n]/)
        .map((l) => l.trim())
        .filter((l) => l)
      for (const line of lines) {
        if (/^\d+%\s/i.test(line) || /^Outshell\s/i.test(line)) {
          material = line.slice(0, 200)
          break
        }
        if (/^(?:100%|cotton|polyester|nylon|wool|linen)/i.test(line)) {
          material = line.slice(0, 200)
          break
        }
      }
    }

    return {description, color, material, productCode: null as string | null}
  })
  result.description = extracted.description
  result.color = extracted.color
  result.material = extracted.material
  return result
}

// ─── havati ────────────────────────────────────────────────────────────

const havatiStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const body = document.body.innerText || ""
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)

    let description: string | null = null
    const startIdx = lines.findIndex((l) => /^Instagram\s*:?/.test(l))
    const endIdx = lines.findIndex((l) => /^(?:OUTSHELL|SHELL|LINING)\s*:/.test(l))
    if (startIdx >= 0 && endIdx > startIdx) {
      const descLines = lines.slice(startIdx + 1, endIdx).filter((l) => l.length > 10)
      if (descLines.length > 0) description = descLines.join("\n").slice(0, 2000)
    }

    const matLines: string[] = []
    for (const line of lines) {
      if (/^(?:OUTSHELL|SHELL|TRIM|LINING|FILLING)\s*:/.test(line)) {
        matLines.push(line)
      }
    }
    const material = matLines.length > 0 ? matLines.join("\n").slice(0, 500) : null

    const opts = Array.from(document.querySelectorAll('select[name*="option"] option'))
      .map((el) => (el as HTMLElement).innerText?.trim())
      .filter((t) => t && !t.startsWith("-") && t !== "empty" && !t.includes("선택") && t !== "*")
    const color = opts.length > 0 ? opts.slice(0, 20).join(", ") : null

    return {description, material, color}
  })
  result.description = extracted.description
  result.material = extracted.material
  result.color = extracted.color
  return result
}

// ─── roughside ─────────────────────────────────────────────────────────

const roughsideStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const descEl = document.querySelector("ul.prd-detail-desc-list")
    const rawDesc = descEl ? (descEl as HTMLElement).innerText?.trim() : null

    let description: string | null = null
    if (rawDesc) {
      const cutIdx = rawDesc.search(/제조사\s*[:：]|제조년월|Made in /i)
      description = (cutIdx > 0 ? rawDesc.slice(0, cutIdx).trim() : rawDesc).slice(0, 2000)
    }

    let color: string | null = null
    const titleWrappers = document.querySelectorAll("div.title-wrapper")
    for (const tw of titleWrappers) {
      if ((tw as HTMLElement).innerText?.includes("상품 색상")) {
        const next = tw.nextElementSibling
        if (next) {
          color = (next as HTMLElement).innerText?.trim().slice(0, 100) || null
        }
        break
      }
    }

    let material: string | null = null
    if (rawDesc) {
      const lines = rawDesc.split("\n")
      const matLines: string[] = []
      for (const line of lines) {
        const t = line.trim()
        if (/^(Shell|Lining|겉감|안감|소재|원단)\s*[:：]/i.test(t)) {
          matLines.push(t)
        }
      }
      if (matLines.length) material = matLines.join(" / ").slice(0, 200)
    }

    return {description, color, material, productCode: null as string | null}
  })
  result.description = extracted.description
  result.color = extracted.color
  result.material = extracted.material
  return result
}

// ─── sculpstore ────────────────────────────────────────────────────────

const sculpstoreStrategy: Strategy = async (page, entry) => {
  const result = empty()
  result.description = await page
    .$eval(".xans-product-detaildesign", (el) => {
      const rows = el.querySelectorAll("tr")
      for (const row of Array.from(rows)) {
        const th = row.querySelector("th")
        if (th && th.innerText.includes("상품간략설명")) {
          const td = row.querySelector("td")
          if (!td) return null
          let text = td.innerText?.trim() || ""
          const cutoff = text.indexOf("배송 안내")
          if (cutoff > 0) text = text.slice(0, cutoff).trim()
          text = text.replace(/^브랜드\s*설명\s*/, "").trim()
          return text.slice(0, 2000) || null
        }
      }
      return null
    })
    .catch(() => null)

  const extracted = await page.evaluate(() => {
    const text = document.body.innerText || ""
    const matMatch = text.match(/혼용률\s*[:：]?\s*([^\n]{3,100})/)
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    const codeIdx = lines.findIndex((l) => /^CODE$/i.test(l))
    return {
      material: matMatch ? matMatch[1].trim() : null,
      productCode: codeIdx >= 0 && lines[codeIdx + 1] ? lines[codeIdx + 1].trim() : null,
    }
  })

  result.material = extracted.material
  result.productCode = extracted.productCode
  result.color = await colorFromOptionList(page, entry.optionColorMode ?? "swallowlounge")
  return result
}

// ─── shopamomento (preserve-findings 유형 2: all-null) ──────────────────

const shopamomentoStrategy: Strategy = async (page) => {
  const result = empty()
  const additionalRaw = await page
    .$eval(".xans-product-additional", (el) => (el as HTMLElement).innerText?.trim() || "")
    .catch(() => "")
  // SPEC-CRAWLER-DETAIL-FIX-001 review P1: ReDoS guard — bound untrusted section input before [\s\S]*? regexes
  const additional = guardSectionInput(additionalRaw)

  if (additional) {
    // SPEC-CRAWLER-DETAIL-FIX-001 Type 2: innerText collapses the
    // .xans-product-additional source newlines (and the blank line
    // before "Linen 100%") into spaces, so the old \n-anchored regexes
    // never matched (all 4 fields came back null). Whitespace-tolerant
    // section segmentation bounded by the next known label. color and
    // productCode genuinely have no source (no <select>, no product-code
    // element) and stay null — REQ-DFIX-004, do not invent.
    const descMatch = additional.match(
      /Product Note\s+([\s\S]*?)\s*(?:Made In|Composition|Size Measurement|$)/,
    )
    if (descMatch?.[1]?.trim()) {
      result.description = descMatch[1].trim().slice(0, 2000)
    }

    const matMatch = additional.match(
      /Composition\s+([\s\S]*?)\s*(?:Size Measurement|$)/,
    )
    if (matMatch?.[1]?.trim()) {
      result.material = matMatch[1].trim().slice(0, 500)
    }
  }
  return result
}

// ─── sienneboutique ────────────────────────────────────────────────────

const sienneboutiqueStrategy: Strategy = async (page, entry) => {
  const result = empty()
  const descSel = entry.descriptionSelectors?.[0] ?? ".product-tabs-detail"
  result.description = await page
    .$eval(descSel, (el) => {
      const text = (el as HTMLElement).innerText?.trim()
      return text && text.length > 10 ? text.slice(0, 2000) : null
    })
    .catch(() => null)

  result.material = await page
    .$$eval(".tabs-content", (els) => {
      if (els.length < 2) return null
      const text = (els[1] as HTMLElement).innerText?.trim() || ""
      const matMatch = text.match(/FABRIC\s*\*?\s*([\s\S]+?)(?:Care Guide|$)/i)
      if (matMatch?.[1]) return matMatch[1].trim().slice(0, 500)
      const careIdx = text.indexOf("Care Guide")
      if (careIdx > 0) return text.slice(0, careIdx).trim().slice(0, 500)
      return text.length > 3 ? text.slice(0, 500) : null
    })
    .catch(() => null)
  return result
}

// ─── slowsteadyclub ────────────────────────────────────────────────────

const slowsteadyclubStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page
    .$eval(".xans-product-additional", (el) => {
      const rawText = (el as HTMLElement).innerText?.trim() || ""
      // SPEC-CRAWLER-DETAIL-FIX-001 review P1: ReDoS guard — bound untrusted section input before [\s\S]*? regexes
      const text = rawText.length > 10000 ? rawText.slice(0, 10000) : rawText

      // SPEC-CRAWLER-DETAIL-FIX-001 Type 2: innerText collapses the
      // source newlines to spaces, so split("\n") + exact-line equality
      // (l === "소재") never matched (material/description came back
      // null). Segment by known section labels with whitespace
      // boundaries instead. Material kept as the raw space-joined
      // substring (겉감 - ... 안감 - ...), no /-normalisation.
      const matMatch = text.match(/소재\s+([\s\S]*?)\s*(?:원산지|사이즈|$)/)
      const material = matMatch?.[1]?.trim() ? matMatch[1].trim().slice(0, 500) : null

      const descMatch = text.match(/상세설명\s+([\s\S]+)$/)
      const description = descMatch?.[1]?.trim()
        ? descMatch[1].trim().slice(0, 2000)
        : null

      const opts = Array.from(document.querySelectorAll('select[name*="option"] option'))
        .map((el2) => (el2 as HTMLElement).innerText?.trim())
        .filter(
          (t) => t && !t.startsWith("-") && t !== "empty" && !t.includes("선택") && t !== "*",
        )
      const color = opts.length > 0 ? [...new Set(opts)].slice(0, 20).join(", ") : null

      return {description, material, color}
    })
    .catch(() => ({description: null, material: null, color: null}))

  result.description = extracted.description
  result.material = extracted.material
  result.color = extracted.color
  return result
}

// ─── swallowlounge ─────────────────────────────────────────────────────

const swallowloungeStrategy: Strategy = async (page, entry) => {
  const result = empty()
  result.description = await page
    .$eval(
      'li[data-name="details"] > div',
      (el) => (el as HTMLElement).innerText?.trim().slice(0, 2000) || null,
    )
    .catch(() => null)

  result.material = await page
    .$eval(
      'li[data-name="material"] > div',
      (el) => (el as HTMLElement).innerText?.trim().slice(0, 500) || null,
    )
    .catch(() => null)

  result.color = await colorFromOptionList(page, entry.optionColorMode ?? "swallowlounge")
  return result
}

// ─── takeastreet (preserve-findings 유형 3: color/material null) ────────

const takeastreetStrategy: Strategy = async (page) => {
  const result = empty()
  const extracted = await page.evaluate(() => {
    const descEl = document.querySelector("div.detail_left")
    const rawDesc = descEl ? (descEl as HTMLElement).innerText?.trim() : null

    let description: string | null = null
    let color: string | null = null
    let material: string | null = null

    if (rawDesc) {
      // SPEC-CRAWLER-DETAIL-FIX-001 review P1: ReDoS guard — bound untrusted section input before [\s\S]*? regexes
      const safeDesc = rawDesc.length > 10000 ? rawDesc.slice(0, 10000) : rawDesc
      const cutIdx = safeDesc.search(/MODEL SIZE|측정 기준|^\s*cm\s/m)
      description = (cutIdx > 0 ? safeDesc.slice(0, cutIdx).trim() : safeDesc).slice(0, 2000)

      // SPEC-CRAWLER-DETAIL-FIX-001 Type 3: innerText collapses the
      // div.detail_left source newlines to spaces, so rawDesc is one
      // line beginning with the product sentence; the old split("\n") +
      // /^컬러/ /^소재/ line-start anchors never matched (color/material
      // null). Match the labels mid-line with whitespace-tolerant
      // boundaries instead. description cut at MODEL SIZE is unchanged;
      // productCode has no source and stays null (REQ-DFIX-004).
      const colorMatch = safeDesc.match(/컬러\s*[:：]\s*([\s\S]*?)\s*(?:소재|MODEL SIZE|$)/)
      if (colorMatch?.[1]?.trim()) {
        color = colorMatch[1].trim().slice(0, 200)
      }

      const matMatch = safeDesc.match(/소재\s*[:：]\s*([\s\S]*?)\s*(?:MODEL SIZE|$)/)
      if (matMatch?.[1]?.trim()) {
        material = matMatch[1].trim().slice(0, 200)
      }
      if (!material) {
        const shellMatch = safeDesc.match(/Shell\s*[:：]\s*([\s\S]*?)\s*(?:MODEL SIZE|$)/i)
        if (shellMatch?.[1]?.trim()) {
          material = `Shell : ${shellMatch[1].trim()}`.slice(0, 200)
        }
      }
    }

    return {description, color, material, productCode: null as string | null}
  })
  result.description = extracted.description
  result.color = extracted.color
  result.material = extracted.material
  return result
}

// ─── dispatch table ────────────────────────────────────────────────────

export const STRATEGIES: Record<StrategyId, Strategy> = {
  base: baseStrategy,
  "8division": eightDivisionStrategy,
  adekuver: adekuverStrategy,
  anotheroffice: anotherofficeStrategy,
  bastong: bastongStrategy,
  chanceclothing: chanceclothingStrategy,
  eastlogue: eastlogueStrategy,
  etcseoul: etcseoulStrategy,
  fr8ight: fr8ightStrategy,
  havati: havatiStrategy,
  roughside: roughsideStrategy,
  sculpstore: sculpstoreStrategy,
  shopamomento: shopamomentoStrategy,
  sienneboutique: sienneboutiqueStrategy,
  slowsteadyclub: slowsteadyclubStrategy,
  swallowlounge: swallowloungeStrategy,
  takeastreet: takeastreetStrategy,
}

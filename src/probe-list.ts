#!/usr/bin/env npx tsx
/**
 * 상품 목록 페이지 DOM 구조 진단 스크립트
 * Usage: npx tsx src/probe-list.ts --site=swallowlounge [--cate=<cateNo>]
 *        npx tsx src/probe-list.ts --url="https://swallowlounge.co.kr/product/list.html?cate_no=XXX"
 */

import {chromium} from "playwright"
import {getSiteConfig} from "./configs/platforms"

function parseArgs() {
  const args = process.argv.slice(2)
  const flags: Record<string, string | boolean> = {}
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=", 2)
      if (eqIdx === -1) flags[arg.slice(2)] = true
      else flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1)
    }
  }
  return flags
}

const CANDIDATE_SELECTORS = [
  'li[id^="anchorBoxId"]',
  "ul.thumbnail > li",
  "ul.prdList > li",
  ".xans-product li",
  ".product-list .item",
  ".product_listnormal_list > li",
  ".grid-list > li",
  "div[class*=product] li",
  "ul.grid > li",
  "ul.list > li",
  ".item-list li",
  ".prd_wrap li",
  ".product_wrap li",
  ".goods_list li",
  ".goods-list li",
  "ul[class*=list] > li",
  "div[class*=grid] > div",
  "div[class*=item]",
]

async function main() {
  const flags = parseArgs()
  const site = (flags.site as string) || "swallowlounge"
  const cateNo = flags.cate ? parseInt(flags.cate as string, 10) : null
  const directUrl = flags.url as string | undefined

  const config = getSiteConfig(site)
  if (!config) {
    console.error(`❌ 사이트 설정 없음: ${site}`)
    process.exit(1)
  }

  let targetUrl: string
  if (directUrl) {
    targetUrl = directUrl
  } else if (cateNo) {
    targetUrl = `${config.baseUrl}/product/list.html?cate_no=${cateNo}`
  } else {
    targetUrl = `${config.baseUrl}/product/list.html`
  }

  console.log(`\n🔍 목록 페이지 DOM 진단: ${site}`)
  console.log(`   URL: ${targetUrl}`)
  console.log("─".repeat(60))

  const browser = await chromium.launch({headless: true})
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  })

  try {
    await page.goto(targetUrl, {waitUntil: "domcontentloaded", timeout: 30000})
    // 5초 대기 (JS 렌더링 충분히 기다리기)
    await page.waitForTimeout(5000)

    // 1. 후보 셀렉터 테스트
    // NOTE: page.evaluate 안에서 var + function 사용 — tsx __name 변환이 let/const/arrow fn을 브라우저에서 ReferenceError로 유발
    console.log("\n📋 셀렉터 매칭 결과 (5초 대기 후):")
    const selectorResults = await page.evaluate(function(selectors) {
      /* eslint-disable no-var */
      var results = []
      for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i]
        var els = document.querySelectorAll(sel)
        var sample = ""
        if (els.length > 0) {
          var el = els[0]
          // img alt 포함 name 후보 셀렉터
          var nameEl = el.querySelector("div.img img, .name, .nm, .prd-name, .title, a[href*=product]")
          if (nameEl && nameEl.tagName === "IMG") {
            sample = (nameEl.getAttribute("alt") || "").trim().slice(0, 60)
          } else {
            sample = ((nameEl ? nameEl.textContent : null) || el.textContent || "").trim().slice(0, 60).replace(/\s+/g, " ")
          }
        }
        results.push({sel: sel, count: els.length, sample: sample})
      }
      return results
      /* eslint-enable no-var */
    }, CANDIDATE_SELECTORS)

    for (const r of selectorResults) {
      if (r.count > 0) {
        console.log(`  ✅ [${r.count}개] ${r.sel}  예시: "${r.sample}"`)
      } else {
        console.log(`  ✗  [0개]  ${r.sel}`)
      }
    }

    // 2a. li[id^="anchorBoxId"]에서 name 추출 직접 테스트
    console.log("\n🧪 li[id^='anchorBoxId'] name 추출 테스트:")
    const nameTest = await page.evaluate(function() {
      /* eslint-disable no-var */
      var items = document.querySelectorAll('li[id^="anchorBoxId"]')
      var results = []
      for (var i = 0; i < Math.min(items.length, 3); i++) {
        var el = items[i]
        var imgEl = el.querySelector("div.img img")
        var anyImg = el.querySelector("img")
        results.push({
          idx: i,
          id: el.id || "",
          hasDivImg: !!el.querySelector("div.img"),
          hasImgEl: !!imgEl,
          hasAnyImg: !!anyImg,
          imgAlt: imgEl ? (imgEl.getAttribute("alt") || "") : "",
          anyImgAlt: anyImg ? (anyImg.getAttribute("alt") || "") : "",
          firstChildTag: el.firstElementChild ? el.firstElementChild.tagName : "none",
        })
      }
      return results
      /* eslint-enable no-var */
    })
    for (var ti = 0; ti < nameTest.length; ti++) {
      var t = nameTest[ti]
      console.log(`  [${t.idx}] id=${t.id} hasDivImg=${t.hasDivImg} hasImgEl=${t.hasImgEl} hasAnyImg=${t.hasAnyImg}`)
      console.log(`       imgAlt="${t.imgAlt.slice(0, 60)}"`)
      console.log(`       anyImgAlt="${t.anyImgAlt.slice(0, 60)}"`)
      console.log(`       firstChild=${t.firstChildTag}`)
    }

    // 2b. 실제 상품 아이템 HTML 덤프 (name 셀렉터 파악용)
    console.log("\n🔬 li[id^='anchorBoxId'] 내부 HTML (처음 2개, 각 1200자):")
    const liDump = await page.evaluate(function() {
      /* eslint-disable no-var */
      var items = document.querySelectorAll('li[id^="anchorBoxId"]')
      var result = []
      for (var i = 0; i < Math.min(items.length, 2); i++) {
        result.push(items[i].innerHTML.slice(0, 1200))
      }
      return result
      /* eslint-enable no-var */
    })
    if (liDump.length === 0) {
      console.log("  (없음)")
    }
    for (let idx = 0; idx < liDump.length; idx++) {
      console.log(`\n  [li ${idx}]:\n${liDump[idx]}`)
    }

    // 3. DOM 요약
    console.log("\n🏗  페이지 DOM 요약:")
    const domSummary = await page.evaluate(function() {
      /* eslint-disable no-var */
      var allLi = document.querySelectorAll("li").length
      var allUl = document.querySelectorAll("ul").length

      var soldoutEls = document.querySelectorAll('[class*="soldout"], .sold, .sold-out, .icon-soldout')
      var soldoutSamples = []
      for (var si = 0; si < Math.min(soldoutEls.length, 3); si++) {
        var se = soldoutEls[si]
        soldoutSamples.push({
          tag: se.tagName,
          classes: (se.className || "").slice(0, 60),
          visible: window.getComputedStyle(se).display !== "none" && !se.classList.contains("displaynone"),
        })
      }

      var productLinkEls = document.querySelectorAll('a[href*="/product/"]')
      var productLinks = []
      for (var pi = 0; pi < Math.min(productLinkEls.length, 5); pi++) {
        var pa = productLinkEls[pi]
        productLinks.push({
          href: (pa.getAttribute("href") || "").slice(0, 80),
          text: (pa.textContent || "").trim().slice(0, 40).replace(/\s+/g, " "),
        })
      }

      var bodyClass = (document.body.className || "").slice(0, 100)
      var wrapper = document.querySelector(".xans-product-normalpackage, .xans-product-listpackage, #container, .product-list-wrap")
      var wrapperHint = wrapper ? (wrapper.tagName + " " + (wrapper.className || "").slice(0, 60)) : "없음"

      return {allLi: allLi, allUl: allUl, productLinks: productLinks, soldoutSamples: soldoutSamples, bodyClass: bodyClass, wrapperHint: wrapperHint}
      /* eslint-enable no-var */
    })

    console.log(`  body 클래스: ${domSummary.bodyClass}`)
    console.log(`  래퍼: ${domSummary.wrapperHint}`)
    console.log(`  li 총 개수: ${domSummary.allLi}, ul 총 개수: ${domSummary.allUl}`)
    console.log(`  /product/ 링크 ${domSummary.productLinks.length}개:`)
    for (const l of domSummary.productLinks) {
      console.log(`    href: ${l.href}`)
      console.log(`    텍스트: "${l.text}"`)
    }
    console.log(`  품절 요소 ${domSummary.soldoutSamples.length}개:`)
    for (const s of domSummary.soldoutSamples) {
      console.log(`    <${s.tag}> class="${s.classes}" visible=${s.visible}`)
    }

    // 4. 카테고리 자동 탐색 (--cate 없을 때)
    if (!directUrl && !cateNo) {
      console.log("\n🗂  카테고리 자동 탐색 (신발 찾기):")
      await page.goto(config.baseUrl, {waitUntil: "domcontentloaded", timeout: 30000})
      await page.waitForTimeout(2000)
      const cats = await page.evaluate(function() {
        /* eslint-disable no-var */
        var links = document.querySelectorAll('a[href*="cate_no="]')
        var catMap = {}
        for (var i = 0; i < links.length; i++) {
          var a = links[i]
          var href = a.getAttribute("href") || ""
          var m = href.match(/cate_no=(\d+)/)
          if (!m) continue
          var no = parseInt(m[1])
          var name = (a.textContent || "").trim().replace(/\s+/g, " ")
          if (name.length >= 1 && !catMap[no]) catMap[no] = name
        }
        var result = []
        for (var key in catMap) {
          result.push({no: parseInt(key), name: catMap[key]})
        }
        return result
        /* eslint-enable no-var */
      })
      const shoesCats = cats.filter((c: {no: number; name: string}) => /신발|슈즈|shoes|footwear/i.test(c.name))
      if (shoesCats.length > 0) {
        console.log(`  신발 관련 카테고리:`)
        for (const c of shoesCats) {
          console.log(`    cate_no=${c.no}  "${c.name}"`)
        }
      } else {
        console.log(`  신발 카테고리 못 찾음 — 전체 ${cats.length}개`)
        console.log(`  앞 15개: ${cats.slice(0, 15).map((c: {no: number; name: string}) => `${c.no}:${c.name}`).join(", ")}`)
      }
    }

  } finally {
    await browser.close()
  }

  console.log("\n✅ 진단 완료")
}

main().catch((err) => {
  console.error("💥 예외:", err)
  process.exit(1)
})

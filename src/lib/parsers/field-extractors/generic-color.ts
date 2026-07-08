/**
 * 범용 Cafe24 색상 폴백 (site-agnostic).
 *
 * 사이트별 registry 전략(strategies.ts / colorFromOptionList)이 색상을 못 뽑아
 * null 을 반환했을 때만 엔진 레벨에서 발동하는 "최후의 그물". registry 계층을
 * 건드리지 않으므로 golden master (tests/fixtures/detail/*.golden.json) 는 무영향
 * — 폴백은 detail 파싱 이후 엔진(cafe24-engine.ts)에서만 호출된다.
 *
 * Cafe24 상세 페이지에서 색상이 노출되는 흔한 위치를 광범위하게 훑는다:
 *   1. 옵션 <select> ( name*="option" ) 의 <option> 텍스트
 *   2. 옵션 영역 스와치 이미지 alt/title, 색상 칩 링크 title
 *   3. 스펙 테이블에서 "색상 / Color / 컬러" 라벨 행의 값
 * 수집한 원문(raw)에서 extractColorFromText 로 첫 canonical 색상만 채택한다.
 * 비색상 잡텍스트(사이즈·"선택" 등)는 CANONICAL 매칭에서 자연 탈락한다.
 */

import type {Cafe24Page} from "../../cafe24-page"
import {extractColorFromText} from "./color-normalizer"

/**
 * 상세 페이지에서 색상 후보 원문을 긁어 첫 canonical 색상 문자열을 반환.
 * 하나도 못 찾으면 null.
 */
export async function genericCafe24Color(page: Cafe24Page): Promise<string | null> {
  const raw = await page
    .evaluate(() => {
      /* eslint-disable no-var */
      var out: string[] = []

      // 1. 옵션 <select> 의 <option> 텍스트
      var optEls = document.querySelectorAll('select[name*="option"] option')
      for (var i = 0; i < optEls.length; i++) {
        var t = ((optEls[i] as HTMLElement).innerText || optEls[i].textContent || "").trim()
        if (t && !t.includes("선택") && !t.includes("Select") && t !== "*" && !t.startsWith("-")) {
          out.push(t)
        }
      }

      // 2. 옵션 영역 스와치 이미지 alt/title + 색상 칩 링크 title
      var swatchSel = [
        ".xans-product-option img",
        "[class*=color] img",
        "[class*=Color] img",
        "li[class*=color] a",
        ".chips img",
        ".swatch img",
      ]
      for (var s = 0; s < swatchSel.length; s++) {
        var imgs = document.querySelectorAll(swatchSel[s])
        for (var j = 0; j < imgs.length; j++) {
          var alt = (imgs[j].getAttribute("alt") || imgs[j].getAttribute("title") || "").trim()
          if (alt) out.push(alt)
        }
      }

      // 3. 스펙 테이블 "색상 / Color / 컬러" 라벨 행
      var rows = document.querySelectorAll("tr, li, .xans-product-detail li")
      for (var r = 0; r < rows.length; r++) {
        var txt = (rows[r].textContent || "").replace(/\s+/g, " ").trim()
        var m = txt.match(/(?:색상|컬러|color)\s*[:：]?\s*([^\n]{1,60})/i)
        if (m && m[1]) out.push(m[1].trim())
      }

      // 4. Cafe24 option JS payload. Some themes do not render option
      // <select> elements until client scripts finish, but expose stock data as
      // globals such as option_stock_data / option_value_mapper.
      var win = window as unknown as Record<string, unknown>
      var optionNames = String(win.option_name_mapper || "")
        .split("#$%")
        .map(function (s) { return s.trim().toLowerCase() })
      var colorIndex = optionNames.findIndex(function (s) {
        return /^(?:color|colour|색상|컬러)$/.test(s)
      })

      var pushOptionColors = function (raw: unknown) {
        if (!raw) return
        var data = raw
        if (typeof raw === "string") {
          try {
            data = JSON.parse(raw)
          } catch {
            return
          }
        }
        if (!data || typeof data !== "object") return

        var entries = Array.isArray(data)
          ? data
          : Object.keys(data as Record<string, unknown>).map(function (key) {
            return (data as Record<string, unknown>)[key]
          })

        for (var oi = 0; oi < entries.length; oi++) {
          var entry = entries[oi] as Record<string, unknown>
          if (!entry || typeof entry !== "object") continue

          var names = Array.isArray(entry.option_name_original)
            ? entry.option_name_original.map(function (v) { return String(v).trim().toLowerCase() })
            : optionNames
          var idx = names.findIndex(function (s) {
            return /^(?:color|colour|색상|컬러)$/.test(s)
          })
          if (idx < 0) idx = colorIndex

          var values = Array.isArray(entry.option_value_orginal)
            ? entry.option_value_orginal.map(function (v) { return String(v).trim() })
            : String(entry.option_value || "").split("#$%")
          if (idx >= 0 && values[idx]) {
            out.push(values[idx])
          } else if (typeof entry.option_value === "string") {
            out.push(entry.option_value)
          }
        }
      }

      pushOptionColors(win.option_stock_data)

      if (typeof win.option_value_mapper === "string") {
        try {
          var mapper = JSON.parse(win.option_value_mapper)
          var keys = Object.keys(mapper)
          for (var mk = 0; mk < keys.length; mk++) {
            var parts = keys[mk].split("#$%")
            if (colorIndex >= 0 && parts[colorIndex]) out.push(parts[colorIndex])
            else if (parts[0]) out.push(parts[0])
          }
        } catch {
          // ignore malformed theme data
        }
      }

      return out.slice(0, 40).join(", ")
      /* eslint-enable no-var */
    })
    .catch(() => "")

  if (!raw) return null
  return extractColorFromText(raw)
}

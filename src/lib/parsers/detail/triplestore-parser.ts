import type {Cafe24Page} from "../../cafe24-page"
import type {DetailData, IDetailParser} from "./types"

/**
 * triplestore 상세 파서
 *
 * 구조 (.xans-product-additional):
 *   원단 / 소재 정보 (상단)
 *   상품 설명 텍스트
 *  *   option1 = 사이즈
 *   리뷰 없음
 */
export class TriplestoreDetailParser implements IDetailParser {
  async parse(page: Cafe24Page, productUrl: string): Promise<DetailData> {
    const result: DetailData = {
      material: null,
      productCode: null,
    }

    try {
      await page.goto(productUrl, {waitUntil: "domcontentloaded", timeout: 15000})
      await page.waitForTimeout(800)

      const extracted = await page.evaluate(() => {
        // ─── description ───
        const descEl = document.querySelector(".xans-product-additional")
        const rawDesc = descEl ? (descEl as HTMLElement).innerText?.trim() : null
        const description = rawDesc ? rawDesc.slice(0, 2000) : null

        // ─── material ("원단" 라벨 뒤 또는 소재/fabric 키워드 라인) ───
        let material: string | null = null
        if (rawDesc) {
          const lines = rawDesc.split("\n")
          let foundFabricLabel = false
          const matLines: string[] = []

          for (const line of lines) {
            const t = line.trim()
            if (/^원단\s*$/.test(t) || /^소재\s*$/.test(t) || /^Fabric\s*$/i.test(t)) {
              foundFabricLabel = true
              continue
            }
            if (foundFabricLabel && t.length > 3) {
              matLines.push(t)
              if (matLines.length >= 2) break
            }
            if (foundFabricLabel && t === "") break
          }
          if (matLines.length) material = matLines.join(" / ").slice(0, 200)
        }

        return {description, material, productCode: null as string | null}
      })

      result.material = extracted.material
    } catch (err) {
      console.warn(`   ⚠️ 상세 파싱 실패: ${productUrl} — ${(err as Error).message}`)
    }

    return result
  }
}

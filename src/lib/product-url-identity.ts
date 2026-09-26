/** Compare product identity, not tracking/category navigation parameters. */
export function sameProductPage(left: string, right: string): boolean {
  try {
    const a = new URL(left, right)
    const b = new URL(right)
    if (![a, b].every((url) => url.protocol === "https:" || url.protocol === "http:")) return false
    if (a.hostname.replace(/^www\./, "") !== b.hostname.replace(/^www\./, "")) return false
    if (a.port !== b.port) return false
    // A product number does not override a more specific variant identity.
    for (const key of ["variant", "sku", "pid", "goodsNo", "product_id", "idx", "id", "branduid"]) {
      if (JSON.stringify(a.searchParams.getAll(key)) !== JSON.stringify(b.searchParams.getAll(key))) return false
    }
    const productNo = (url: URL) => url.searchParams.get("product_no")
      ?? url.pathname.match(/\/product\/(?:[^/]+\/)?(\d+)(?:\/|$)/i)?.[1]
    const aNo = productNo(a)
    const bNo = productNo(b)
    if (aNo || bNo) return Boolean(aNo && bNo && aNo === bNo)
    if (a.pathname.replace(/\/$/, "") !== b.pathname.replace(/\/$/, "")) return false
    return true
  } catch {
    return false
  }
}

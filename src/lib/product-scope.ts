import {matchesAny} from "./text-match"

const NON_FASHION_NAME_PATTERNS: RegExp[] = [
  /\btowels?\b/i,
  /\b(?:i[-\s]?phone|phone)[-\s]?cases?\b/i,
  /\bumbrellas?\b/i,
  /\breflectors?\b/i,
  /\bflat[-\s]+files?\b/i,
  /\bpen\b/i,
  /(^|[\s([\-/:])펜(?=$|[\s)\]/\-:])/,
  /\blocker[-\s]+baskets?\b/i,
  /\bglasses[-\s]+trays?\b/i,
  /\bapple[-\s]+watch(?:[-\s]+sport)?[-\s]+straps?\b/i,
  /\bshoe[-\s]?horns?\b/i,
  /\b(?:folding[-\s]+)?mesh[-\s]+baskets?\b/i,
  /\b(?:plastic[-\s]+)?laundry[-\s]+bags?\b/i,
  /\blaundry[-\s]+baskets?\b/i,
]

const WEARABLE_CONTEXT_PATTERNS: RegExp[] = [
  /\b(?:shirt|shirts|t[-\s]?shirt|tee|tees|polo|jacket|jackets|vest|vests|shorts|pants|slacks|dress|dresses|skirt|skirts|socks|hoodie|sweatshirt|sneakers?|bag|bags|earrings?|jewelry)\b/i,
]

const REFLECTOR_FASHION_CONTEXT_PATTERNS: RegExp[] = [
  /\b(?:dress|dresses|pants|slacks|shorts|skirt|skirts)\b/i,
  /\bknitted?\b/i,
]

const NON_FASHION_NAME_CONTAINS = [
  "타월",
  "수건",
  "폰케이스",
  "폰 케이스",
  "우산",
  "반사판",
  "플랫 파일",
  "락커 바스켓",
  "글라스 트레이",
  "애플워치 스트랩",
  "애플 워치 스트랩",
]

export function isNonFashionProductName(name: string): boolean {
  const normalizedName = name.toLowerCase()
  const hasWearableContext = WEARABLE_CONTEXT_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(normalizedName))
  const hasNonFashionMatch = matchesAny(name, NON_FASHION_NAME_PATTERNS, NON_FASHION_NAME_CONTAINS)
  if (!hasNonFashionMatch) return false

  const hasMeshBasketMatch = matchesAny(name, [/\b(?:folding[-\s]+)?mesh[-\s]+baskets?\b/i], ["메쉬 바스켓"])
  const hasMeshBasketBagContext = hasMeshBasketMatch && (/\bbags?\b/i.test(name) || /백|가방/.test(name))
  const hasHardNonFashionMatch = matchesAny(name, [
    /\b(?:phone|iphone)[-\s]?cases?\b/i,
    /\bflat[-\s]+files?\b/i,
    /\blocker[-\s]+baskets?\b/i,
    /\bglasses[-\s]+trays?\b/i,
    /\bapple[-\s]+watch(?:[-\s]+sport)?[-\s]+straps?\b/i,
    /\bshoe[-\s]?horns?\b/i,
    /\b(?:plastic[-\s]+)?laundry[-\s]+bags?\b/i,
    /\blaundry[-\s]+baskets?\b/i,
  ], [
    "폰케이스",
    "폰 케이스",
    "플랫 파일",
    "락커 바스켓",
    "글라스 트레이",
    "애플워치 스트랩",
    "애플 워치 스트랩",
    "슈혼",
    "세탁 가방",
    "런드리 백",
  ])
  if (hasHardNonFashionMatch || (hasMeshBasketMatch && !hasMeshBasketBagContext)) return true

  const hasUmbrellaMatch = matchesAny(name, [/\bumbrellas?\b/i], ["우산"])
  if (hasUmbrellaMatch) return !/\bearrings?\b/i.test(name) && !/귀걸이/.test(name)

  const hasReflectorMatch = matchesAny(name, [/\breflectors?\b/i], ["반사판"])
  if (hasReflectorMatch) {
    return !REFLECTOR_FASHION_CONTEXT_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(normalizedName))
  }

  return !hasWearableContext || !matchesAny(name, [/\btowels?\b/i, /\bpen\b/i], ["타월", "수건"])
}

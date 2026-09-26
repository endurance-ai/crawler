/** Read real tag attributes, not attribute-like text inside another value.
 * Boolean attributes have an empty value; missing attributes return null. */
export function htmlAttribute(tag: string, name: string): string | null {
  const attributes = tag.replace(/^<\/?[\w:-]+/, "")
  const tokens = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of attributes.matchAll(tokens)) {
    if (match[1].toLowerCase() === name.toLowerCase()) return match[2] ?? match[3] ?? match[4] ?? ""
  }
  return null
}

/** Exclude inactive snippets before interpreting product metadata or images. */
export function stripInertHtml(html: string, keepScripts = false): string {
  const tags = keepScripts ? "style|template|noscript" : "script|style|template|noscript"
  const pattern = new RegExp(
    String.raw`<!--[\s\S]*?-->|<(${tags})\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>`,
    "gi",
  )
  return html.replace(pattern, "")
}

/**
 * structured-data.ts unit tests — JSON-LD Product + OG meta extraction.
 *
 * Custom-brand pilot (2026-07): Tier-1 extraction path for custom/minor
 * platform sites. Covers the JSON-LD shapes seen in the wild: bare Product,
 * @graph nesting, AggregateOffer, offer arrays, availability URL variants,
 * ImageObject images, malformed sibling blocks, and OG-only pages.
 */

import {test} from "node:test"
import * as assert from "node:assert/strict"
import {
  extractJsonLdProducts,
  extractOgProduct,
  extractStructuredProduct,
} from "../src/lib/parsers/structured-data"

const ldScript = (obj: unknown): string =>
  `<script type="application/ld+json">${JSON.stringify(obj)}</script>`

test("JSON-LD: bare Product with simple Offer", () => {
  const html = `<html><head>${ldScript({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Wool Overcoat",
    description: "A <b>heavy</b> wool coat",
    brand: {"@type": "Brand", name: "Acme"},
    color: "Charcoal",
    sku: "AC-001",
    image: ["https://cdn.acme.com/1.jpg", "https://cdn.acme.com/2.jpg"],
    offers: {
      "@type": "Offer",
      price: "128000",
      priceCurrency: "KRW",
      availability: "https://schema.org/InStock",
    },
  })}</head></html>`

  const [p] = extractJsonLdProducts(html)
  assert.ok(p)
  assert.equal(p.name, "Wool Overcoat")
  assert.equal(p.description, "A heavy wool coat")
  assert.equal(p.brand, "Acme")
  assert.equal(p.color, "Charcoal")
  assert.equal(p.sku, "AC-001")
  assert.equal(p.price, 128000)
  assert.equal(p.currency, "KRW")
  assert.equal(p.inStock, true)
  assert.deepEqual(p.images, ["https://cdn.acme.com/1.jpg", "https://cdn.acme.com/2.jpg"])
})

test("JSON-LD: Product inside @graph, AggregateOffer lowPrice, OutOfStock", () => {
  const html = ldScript({
    "@context": "https://schema.org",
    "@graph": [
      {"@type": "WebSite", name: "store"},
      {
        "@type": "Product",
        name: "Slip Dress",
        offers: {
          "@type": "AggregateOffer",
          lowPrice: 89.5,
          highPrice: 120,
          priceCurrency: "USD",
          availability: "http://schema.org/OutOfStock",
        },
      },
    ],
  })

  const [p] = extractJsonLdProducts(html)
  assert.ok(p)
  assert.equal(p.name, "Slip Dress")
  assert.equal(p.price, 89.5)
  assert.equal(p.currency, "USD")
  assert.equal(p.inStock, false)
})

test("JSON-LD: offers array picks first offer with data; ImageObject image", () => {
  const html = ldScript({
    "@type": "Product",
    name: "Sneaker",
    image: {"@type": "ImageObject", url: "https://cdn.x.com/s.jpg"},
    offers: [
      {"@type": "Offer", price: "59000", priceCurrency: "KRW", availability: "InStock"},
      {"@type": "Offer", price: "61000", priceCurrency: "KRW"},
    ],
  })

  const [p] = extractJsonLdProducts(html)
  assert.ok(p)
  assert.equal(p.price, 59000)
  assert.equal(p.inStock, true)
  assert.deepEqual(p.images, ["https://cdn.x.com/s.jpg"])
})

test("JSON-LD: malformed sibling block is skipped, valid block still parses", () => {
  const html =
    `<script type="application/ld+json">{not valid json}</script>` +
    ldScript({"@type": "Product", name: "Belt", offers: {price: 30000, priceCurrency: "KRW"}})

  const products = extractJsonLdProducts(html)
  assert.equal(products.length, 1)
  assert.equal(products[0].name, "Belt")
  assert.equal(products[0].price, 30000)
})

test("JSON-LD: brand as plain string; price with currency symbols stripped", () => {
  const html = ldScript({
    "@type": "Product",
    name: "Cap",
    brand: "Acme",
    offers: {price: "₩39,000", priceCurrency: "KRW"},
  })
  const [p] = extractJsonLdProducts(html)
  assert.equal(p.brand, "Acme")
  assert.equal(p.price, 39000)
})

test("JSON-LD: non-product pages return empty array", () => {
  const html = ldScript({"@type": "WebSite", name: "store"})
  assert.deepEqual(extractJsonLdProducts(html), [])
  assert.deepEqual(extractJsonLdProducts("<html><body>no ld</body></html>"), [])
})

test("OG: product meta extraction with availability", () => {
  const html = `<head>
    <meta property="og:type" content="product" />
    <meta property="og:title" content="Denim Jacket" />
    <meta property="og:image" content="https://cdn.y.com/d.jpg" />
    <meta property="product:price:amount" content="98000" />
    <meta property="product:price:currency" content="KRW" />
    <meta property="product:availability" content="in stock" />
  </head>`

  const p = extractOgProduct(html)
  assert.ok(p)
  assert.equal(p.name, "Denim Jacket")
  assert.equal(p.price, 98000)
  assert.equal(p.currency, "KRW")
  assert.equal(p.inStock, true)
  assert.deepEqual(p.images, ["https://cdn.y.com/d.jpg"])
  assert.equal(p.source, "og")
})

test("OG: non-product page (og:type website, no price) returns null", () => {
  const html = `<head><meta property="og:type" content="website" /><meta property="og:title" content="Home" /></head>`
  assert.equal(extractOgProduct(html), null)
})

test("merge: JSON-LD wins per field, OG fills gaps", () => {
  const html =
    ldScript({"@type": "Product", name: "Loafer", offers: {price: 210000, priceCurrency: "KRW"}}) +
    `<meta property="og:type" content="product" />
     <meta property="og:title" content="OG Title" />
     <meta property="og:image" content="https://cdn.z.com/l.jpg" />
     <meta property="product:availability" content="instock" />`

  const p = extractStructuredProduct(html)
  assert.ok(p)
  assert.equal(p.source, "merged")
  assert.equal(p.name, "Loafer") // JSON-LD wins
  assert.equal(p.price, 210000)
  assert.deepEqual(p.images, ["https://cdn.z.com/l.jpg"]) // OG fills gap
  assert.equal(p.inStock, true) // OG fills gap
})

test("merge: page with neither returns null", () => {
  assert.equal(extractStructuredProduct("<html><body>plain</body></html>"), null)
})

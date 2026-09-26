import {test} from "node:test"
import assert from "node:assert/strict"
import {collectProductImagesFromHtml} from "../src/lib/product-images"
import {extractStructuredProductForUrl} from "../src/lib/parsers/structured-data"
import {inferExplicitProductGender, resolveProductGenderWithSource} from "../src/lib/product-gender"
import {sameProductPage} from "../src/lib/product-url-identity"

const page = "https://shop.example.com/product/detail.html?product_no=12"
const product = (value: object) => `<script type="application/ld+json">${JSON.stringify({"@type":"Product", ...value})}</script>`
const og = (url: string, image: string) => `<meta property="og:type" content="product"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}">`

test("a shared Cafe24 product number cannot erase variant identity", () => {
  assert.equal(sameProductPage(page+"&variant=red", page+"&variant=blue"), false)
  assert.equal(sameProductPage(page+"&cate_no=3", page+"&cate_no=9"), true)
  assert.equal(sameProductPage("https://shop.example.com/product/tee/12/?variant=red", page+"&variant=red"), true)
})

test("product identities reject a different port or a non-web scheme", () => {
  assert.equal(sameProductPage(page.replace(".com", ".com:8443"), page), false)
  assert.equal(sameProductPage(page.replace("https:", "ftp:"), page), false)
  assert.equal(sameProductPage(page.replace("https:", "http:"), page), true)
})

test("query-only links to other products and variants cannot contribute gallery images", () => {
  const html=`<div id="prdDetail"><img src="/own.jpg">
    <a href="?cate_no=4&amp;product_no=99"><img src="/other-product.jpg"></a>
    <a href="?product_no=12&amp;variant=blue"><img src="/blue.jpg"></a>
    <a href="?product_no=12&amp;variant=red"><img src="/red.jpg"></a></div>`
  assert.deepEqual(collectProductImagesFromHtml(html,page+"&variant=red"),[
    "https://shop.example.com/own.jpg", "https://shop.example.com/red.jpg",
  ])
})

test("a matching JSON-LD Product can use its own OG fallback but never foreign OG", () => {
  const html=product({url:page,name:"Tee"})
  assert.deepEqual(collectProductImagesFromHtml(html+og(page,"https://cdn.example.com/own.jpg"),page),["https://cdn.example.com/own.jpg"])
  assert.deepEqual(collectProductImagesFromHtml(product({name:"Tee"})+og(page.replace("12","99"),"https://cdn.example.com/other.jpg"),page),[])
})

test("an unaddressed Product among recommendations is not a fallback for the current product", () => {
  const html=product({url:page.replace("12","99"),image:["https://cdn.example.com/99.jpg"]})
    +product({name:"Unaddressed recommendation",image:["https://cdn.example.com/unknown.jpg"]})
  assert.deepEqual(collectProductImagesFromHtml(html,page),[])
  assert.deepEqual(collectProductImagesFromHtml(html+og(page,"https://cdn.example.com/current.jpg"),page),["https://cdn.example.com/current.jpg"])
})

test("OG attribute parsing preserves apostrophes and quoted angle brackets", () => {
  const html=`<meta property="og:type" content="product"><meta property="og:url" content="${page}">
    <meta property="og:title" content="Women's top > basics"><meta property="og:image" content="https://cdn.example.com/own.jpg">`
  assert.equal(extractStructuredProductForUrl(html,page)?.name,"Women's top > basics")
})

test("DOM component galleries remain supported without admitting generic product cards", () => {
  const html=`<div data-component="ProductImage"><img src="/front.jpg"></div>
    <div data-testid="product-image"><img src="/back.jpg"></div>
    <div class="product-image"><img src="/card.jpg"></div>`
  assert.deepEqual(collectProductImagesFromHtml(html,page),["https://shop.example.com/front.jpg","https://shop.example.com/back.jpg"])
})

test("boolean option markers and class-like text inside alt attributes are not gallery evidence", () => {
  const html=`<img alt='example class="product-gallery"' src="/unowned.jpg">
    <div class="product-gallery"><img data-color src="/swatch.jpg">
      <img data-option src="/option.jpg"><img src="/own.jpg"></div>`
  assert.deepEqual(collectProductImagesFromHtml(html,page),["https://shop.example.com/own.jpg"])
})

test("empty srcset does not hide the lazy high-resolution gallery source", () => {
  const html=`<div class="product-gallery"><img srcset="" data-srcset="/small.jpg 400w, /large.jpg 1600w"></div>`
  assert.deepEqual(collectProductImagesFromHtml(html,page),["https://shop.example.com/large.jpg"])
})

test("mixed explicit audiences cannot force a single-sex category override", () => {
  for(const name of ["Coat FOR MEN AND WOMEN","Coat for men/women","Coat for women & men","(men) and (women) coat"]) {
    assert.equal(inferExplicitProductGender(name),null,name)
    assert.deepEqual(resolveProductGenderWithSource(["women"],{name}),{gender:["women"],source:"engine"},name)
  }
})

test("site-specific audience rules cannot force mixed labels into one gender", () => {
  assert.deepEqual(resolveProductGenderWithSource(["women"], {name:"For Mens and Womens bracelet"}, "engine", {
    genderTextPatterns: {men:[/\bMens\b/i]},
  }), {gender:["women"],source:"engine"})
})

test("inert Open Graph markup cannot replace real product metadata", () => {
  const own=og(page,"https://cdn.example.com/own.jpg")
  const foreign=og(page,"https://cdn.example.com/foreign.jpg")
  for(const wrapper of [`<!--${foreign}-->`,`<script>const markup = '${foreign}'</script>`,`<template>${foreign}</template>`]) {
    assert.deepEqual(collectProductImagesFromHtml(own+wrapper,page),["https://cdn.example.com/own.jpg"])
  }
})

test("commented and templated JSON-LD do not identify the active product", () => {
  const foreign=product({url:page,image:["https://cdn.example.com/foreign.jpg"]})
  for(const wrapper of [`<!--${foreign}-->`,`<template>${foreign}</template>`,`<script>const markup = '${foreign}'</script>`]) {
    assert.deepEqual(collectProductImagesFromHtml(wrapper,page),[])
  }
})

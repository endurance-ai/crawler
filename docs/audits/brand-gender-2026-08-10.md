# Brand gender audit — 2026-08-10

## Result

- Database snapshot: 3,718 `brand_nodes`.
- Non-canonical values requiring correction: **387**.
  - SQL `NULL`: 211
  - empty array: 103
  - `["unknown"]`: 73
- Canonical values with authoritative web evidence requiring review: **63**.
  - confirmed narrowing: 2 (`unisex` -> `men`)
  - widening candidates: 61 (`men`/`women` -> `unisex`)
- Audit candidate scope: **450 nodes** (12.10% of all nodes). This is not an
  approved batch-change count.
- Applied after explicit approval: ZEGNA #1255 and visvim #1740 were changed
  from `["unisex"]` to `["men"]` at 2026-08-10T07:40:50Z. No widening
  candidates were changed.

The 61 widening rows do not all have the same confidence for product-default
purposes. Of these, 48 had both men's and women's links on the official site,
five had only an official unisex/genderless collection link, and eight relied
on supplementary search, description, or registry evidence. Even the first
group can contain an archive, fragrance section, or a very small opposite-
gender capsule. It must not be applied as one batch without checking that both
active fashion catalogs are current and material.

## Coverage and method

1. Read all `brand_nodes` from the current database and checked that
   `gender_scope` was exactly one of `men`, `women`, or `unisex`.
2. Visited all 3,096 recorded homepages. 2,401 returned usable 2xx HTML; 695
   were blocked, unavailable, or returned an error.
3. Compared official navigation/collection evidence against current canonical
   values. A brand with distinct men's and women's ranges, or an official
   genderless/unisex range alongside its current single-gender range, is
   represented by the canonical brand-level value `unisex`.
4. Searched all 554 canonical single-gender nodes whose recorded homepage was
   missing or unusable. Bing returned result pages for all 554 (two bot-check
   pages); 151 broad opposite-gender term matches were manually screened to
   reject unrelated namesakes, parent brands, retailers, and sub-label leakage.
5. Searched explicit `menswear brand` / `womenswear brand` descriptors for all
   3,331 canonical rows to catch the reverse `unisex` -> single-gender error.
   Three candidates were found; ZEGNA and visvim were confirmed against
   official sources, while Rhude was rejected because its official and current
   catalog evidence was not exclusive enough to narrow safely.
6. Cross-checked product-level gender evidence and existing wiki descriptions.
   Product evidence was used to find candidates, not by itself to narrow a
   brand-wide scope.

Raw read-only reports are generated under `data/`:

- `brand-gender-full-inventory.json`
- `noncanonical-brand-gender-evidence.json`
- `brand-gender-homepage-audit.json`
- `brand-gender-search-fallback.json`
- `brand-gender-descriptor-audit.json`

## Confirmed canonical changes

| ID | Brand | Audited value | Proposed | Official evidence |
|---:|---|---|---|---|
| 93 | MCQ | `women` | `unisex` | https://www.alexandermcqueen.com/ko-kr |
| 231 | NICOLAS ANDREAS TARALIS | `men` | `unisex` | https://shop.nicolasandreastaralis.com/ |
| 246 | 73 LONDON | `men` | `unisex` | https://73london.com/ |
| 247 | King & Tuckfield | `men` | `unisex` | https://kingandtuckfield.com/ |
| 275 | PH5 | `women` | `unisex` | https://ph5.com/ |
| 279 | Harris Wharf London | `women` | `unisex` | https://harriswharflondon.com/ |
| 280 | Lardini | `men` | `unisex` | https://www.lardini.com/en-kr |
| 300 | ICECREAM | `men` | `unisex` | https://www.bbcicecream.com/ |
| 310 | Officine Générale | `men` | `unisex` | https://us.officinegenerale.com/ |
| 354 | Cult Gaia | `women` | `unisex` | https://cultgaia.com/ |
| 422 | Hernán Herdez | `women` | `unisex` | https://hernanherdez.com/ |
| 449 | Octavia Elizabeth | `women` | `unisex` | https://www.octaviaelizabeth.com/ |
| 461 | CFCL | `women` | `unisex` | https://cfcl.jp/ |
| 599 | Barena | `men` | `unisex` | https://barenavenezia.com/ |
| 627 | A Kind of Guise | `men` | `unisex` | https://akindofguise.com/ |
| 751 | Agua By Agua Bendita | `women` | `unisex` | https://www.aguabendita.com/ |
| 773 | Innerraum | `men` | `unisex` | https://ised-isde.canada.ca/cipo/trademark-search/pdf/1962015?lang=eng |
| 800 | Simone Rocha | `women` | `unisex` | https://simonerocha.com/ |
| 1000 | Simkhai | `women` | `unisex` | https://simkhai.com/ |
| 1053 | ASPESI | `men` | `unisex` | https://aspesi.com/en-kr |
| 1112 | Deadwood | `men` | `unisex` | https://www.deadwoodstudios.com/ |
| 1132 | ioannes | `women` | `unisex` | https://ioannes.eu/ |
| 1174 | RTA | `men` | `unisex` | https://rta.com/ |
| 1186 | SOAR Running | `men` | `unisex` | https://www.soarrunning.com/en-kr |
| 1190 | MMIC | `men` | `unisex` | https://en.mmic.kr/ |
| 1251 | Métier | `women` | `unisex` | https://metier.com/ |
| 1255 | ZEGNA | `unisex` | `men` | https://www.zegnagroup.com/en/zegna/ |
| 1289 | &Daughter | `women` | `unisex` | https://www.and-daughter.com/ |
| 1314 | Faith Connexion | `men` | `unisex` | https://www.faithconnexion.com/ |
| 1323 | AAPE by A Bathing Ape | `men` | `unisex` | https://aape.com/ |
| 1329 | Fortela | `men` | `unisex` | https://www.fortela.com/en-row |
| 1337 | Massimo Alba | `men` | `unisex` | https://www.massimoalba.com/ |
| 1362 | Steven Passaro | `men` | `unisex` | https://stevenpassaro.com/ |
| 1374 | MSGM | `women` | `unisex` | https://www.shop-msgm.com/en |
| 1445 | Stolen Girlfriends Club | `men` | `unisex` | https://stolengirlfriendsclub.com/ |
| 1515 | TAAKK | `men` | `unisex` | https://208913-0e.myshopify.com/ |
| 1649 | LCDC | `women` | `unisex` | https://shoplcdc.com/ |
| 1652 | 3.1 Phillip Lim | `women` | `unisex` | https://31philliplim.com/ |
| 1683 | MOWALOLA | `women` | `unisex` | https://www.mowalola.com/products/ |
| 1740 | visvim | `unisex` | `men` | https://www.visvim.tv/wmv/ |
| 1741 | UMARMUNG | `women` | `unisex` | https://umarmung.kr/ |
| 1753 | Won Hundred | `women` | `unisex` | https://wonhundred.com/ |
| 1781 | YMC | `women` | `unisex` | https://www.youmustcreate.com/ |
| 1820 | FRAME | `women` | `unisex` | https://frame-store.com/en-kr |
| 1855 | Jonathan Simkhai | `women` | `unisex` | https://simkhai.com/ |
| 1961 | JORDANLUCA | `men` | `unisex` | https://www.jordanluca.com/ |
| 2021 | SHAY | `women` | `unisex` | https://shayjewelry.com/ |
| 2053 | Kartik Research | `men` | `unisex` | https://www.kartikresearch.com/ |
| 2570 | DUKE + DEXTER | `men` | `unisex` | https://dukeanddexter.com/ |
| 2579 | House of Sunny | `women` | `unisex` | https://houseofsunny.com/ |
| 3691 | Jamie Haller | `women` | `unisex` | https://shop-jamiehaller.com/ |
| 3847 | THOMASMORE | `men` | `unisex` | https://thomasmore.co.kr/ |
| 4875 | Linda Farrow | `women` | `unisex` | https://lindafarrow.com/en-int |
| 4883 | Karen Wazen | `women` | `unisex` | https://karenwazen.com/ |
| 4955 | HYKE | `women` | `unisex` | https://hyke.jp/ |
| 4965 | VIKTOR & ROLF | `women` | `unisex` | https://www.viktor-rolf.com/ |
| 5012 | ROAR GUNS | `men` | `unisex` | https://roarguns.com/ |
| 5063 | Schott | `men` | `unisex` | https://www.schottnyc.com/collections/women |
| 5113 | LIU JO | `women` | `unisex` | https://www.liujo.com/int/men |
| 5122 | Ash | `women` | `unisex` | https://ash.com/fr/insideash/brand |
| 5347 | threetimes | `women` | `unisex` | https://threetimes333.com/ |
| 5418 | NO/FAITH STUDIOS | `men` | `unisex` | https://nofaithstudios.com/ |
| 5739 | Scuffers | `women` | `unisex` | https://scuffers.com/ |

## Apply boundary

Do not apply the 61 widening candidates as one batch. Before changing one to
`["unisex"]`, verify that the current active fashion catalog has material men's
and women's ranges; an archive, fragrance menu, single opposite-gender product,
or small genderless capsule is insufficient when `gender_scope` is used to
derive a product default.

ZEGNA and visvim were updated to `["men"]` after explicit approval. Their
source URLs, decision rules, and verification timestamps were preserved in
`wiki`.

The 387 non-canonical rows must not be blanket-filled with `unisex`. They mix
adult single-gender brands, mixed brands, collaborations, publishers, home
goods, beauty, and duplicate nodes. Their canonical replacement should be
written only after resolving the individual evidence in the raw reports;
duplicate nodes such as `Azamm` (#5755 → #5743) should follow the duplicate-node
workflow instead of receiving an independent scope.

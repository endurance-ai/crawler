# Brand homepage scope policy (2026-08-05)

## Scope rule

A missing `brand_nodes.wiki.homepage_url` is not an error by itself.

- **Direct-store synchronization required**: the brand node has products from an enabled crawler config, that config has an explicit `brand`, and the normalized config brand exactly matches the normalized node name.
- **Homepage optional**: current products or durable `brand_nodes.source_platforms` show collection from a multi-brand shop, marketplace, parent brand, or another platform that is not an exact direct-brand match. Sold-out/deleted products do not erase this provenance.
- **Collaboration optional**: a name containing a spaced `x`/`×` is a collaboration product node, not a separate storefront target.
- **Reviewed without standalone site**: exact social identity was searched but no independent official domain was verifiable, or the row is a confirmed duplicate.
- **Homepage research required**: none of the above evidence exists. These are the only rows that remain in the web-search queue.

The historical audit scope is `brand_nodes.id <= 5792`. Run the audit against all nodes with `--all`.

## Commands

```bash
# Read-only historical scope audit
pnpm exec dotenv -e .env -e .env.local -- tsx tools/audit-missing-brand-homepages.ts

# Fill deterministic direct-store matches only
pnpm exec dotenv -e .env -e .env.local -- tsx tools/audit-missing-brand-homepages.ts --apply

# Recalculate all brand nodes
pnpm exec dotenv -e .env -e .env.local -- tsx tools/audit-missing-brand-homepages.ts --all
```

Existing valid homepage URLs are outside the update set and are never overwritten.

Configs marked `multiBrand: true` are always excluded from direct-store
homepage synchronization. Multi-brand retailer provenance remains valid even
after its current product rows disappear.

## 2026-08-05 final synchronization result

Final snapshot after full re-search and provenance synchronization
(`2026-08-05T04:02:52Z`):

| Scope | Nodes | Homepage present | Homepage missing | Direct sync error | Retailer/other source optional | Collaboration optional | Reviewed without standalone site | Research remaining |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Historical (`id <= 5792`) | 3,677 | 3,056 | 621 | 0 | 580 | 34 | 7 | **0** |

The historical scope initially had **798** missing homepages. **177** were
filled: one deterministic crawler-config match and 176 Instagram-assisted,
exact-identity web verifications. The deterministic match was:

- `#1106 Juntae Kim`: `en-5267` products → Korean/KRW official storefront `https://juntaekim.net`

Therefore the actionable homepage research and direct-store synchronization
backlogs are both zero. The remaining 621 rows are documented optional cases,
not homepage crawl errors.

`#834 SCULPTOR` now has its verified official Korean/KRW store
`https://sculptorpage.com`. Separately, `sculpstore.com` is a multi-brand
retailer. Its erroneous fixed `brand: "SCULPTOR"` fallback was removed from the
crawler config, and retailer platforms are now forbidden from using historical
platform-level brand-node fallbacks during crawl/import. The 3,622 existing
SCULPSTORE products attached to node 834 were preserved but detached by setting
their `brand_node_id` to null for later product-level re-resolution. The stale
`product_crawl_status` mapping was detached and marked `qc_failed`.

### Re-audit and source-provenance correction

The former `source review` label was wrong in two ways: no linked product does
not imply that a brand lacks its own store, and current product rows are not a
durable record of how a node was acquired. The audit now merges current product
platforms with `brand_nodes.source_platforms`, records collaboration/duplicate/
social-only outcomes, and retains retailer evidence such as Musinsa and
Partyholic. This reduced the false research queue from 508 to zero after the
full re-search.

### Month statistics caveat

`brand_nodes` has no `created_at`, so an exact per-node addition month cannot be
reconstructed. `updated_at` is only the last refresh month. For the 621 rows
still lacking a homepage it is: 2026-04 61, 2026-05 80, 2026-07 473, 2026-08 7.
The first linked-product month, a better acquisition proxy where available, is
2026-06 186, 2026-07 96, unknown 339. These proxy fields must not be presented
as exact brand-node creation dates.

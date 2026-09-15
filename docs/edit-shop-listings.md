# Edit-shop source listings

`products.platform` remains the catalog source. Source-page ordering is stored
separately in `public.edit_shop_listing_snapshots/items`, so a product can keep
its canonical internal category while also belonging to multiple retailer
categories.

## Launch sources

| Platform | Engine | Source taxonomy retained by crawler | Week-one API |
| --- | --- | --- | --- |
| `slowsteadyclub` | Cafe24 | 11 approved `cate_no` values and page rank; What100 daily rank | internal category |
| `8division` | Cafe24 | configured gender departments and merchandise `cate_no` page rank | internal category |
| `etcseoul` | Cafe24 | configured merchandise `cate_no` page rank; no retailer gender evidence | internal category |
| `fr8ight` | Cafe24 | configured merchandise `cate_no` page rank | internal category |
| `kith` | Shopify | stable collection handles are available; configured men/women new-arrival handles currently provide gender evidence | internal category |

Cafe24 placements are merged when the same `product_no` appears in several
categories. Kith's base `/products.json` feed does not carry complete collection
membership, so broader collection taxonomy must be fetched explicitly before it
can replace the internal category filter.

## What100 publication

`pnpm crawl:edit-shop-listings` fetches the mobile What They Want page. It
publishes only when exactly 100 unique positive `product_no` values are present
in continuous source order. The database replacement function validates the
same invariant transactionally, so a partial fetch cannot replace the previous
healthy snapshot.

The lab timer runs this at 23:45 KST, before the next day's AI ranking is
generated. Install both `kiko-edit-shop-listings.service` and `.timer` from
`deploy/systemd/lab/` with the other lab units.


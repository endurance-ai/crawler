#!/usr/bin/env python3
"""brand_nodes + brand_sku_counts 조인 → data/brand-enrichment/queue.jsonl

Priority = sku_count desc (SKU 많은 브랜드 먼저, 위키 가치 큼).
SKU 없는 brand 는 뒤로 (priority=0). Output: 1 line per brand JSONL.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NODES = json.loads(Path("/tmp/brand_nodes.json").read_text())
SKUS = json.loads(Path("/tmp/brand_sku_counts.json").read_text())


def norm(s: str) -> str:
    return (s or "").strip().lower().replace(" ", "").replace("-", "").replace(".", "")


sku_by_name = {}
for r in SKUS:
    sku_by_name[norm(r["brand"])] = r["sku_count"]


rows = []
matched = 0
for n in NODES:
    keys = [norm(n.get("brand_name_normalized") or ""), norm(n.get("brand_name") or "")]
    sku = 0
    for k in keys:
        if k and k in sku_by_name:
            sku = sku_by_name[k]
            matched += 1
            break
    rows.append({
        "brand_id": n["id"],
        "brand_name": n["brand_name"],
        "brand_name_normalized": n.get("brand_name_normalized"),
        "source_platforms": n.get("source_platforms") or [],
        "gender_scope": n.get("gender_scope"),
        "primary_style_node_id": n.get("primary_style_node_id"),
        "price_min_usd": n.get("price_min_usd"),
        "price_max_usd": n.get("price_max_usd"),
        "sku_count": sku,
    })

rows.sort(key=lambda r: (-r["sku_count"], r["brand_name"].lower()))
out = REPO / "data" / "brand-enrichment" / "queue.jsonl"
out.parent.mkdir(parents=True, exist_ok=True)
with out.open("w") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print(f"matched sku: {matched}/{len(NODES)}")
print(f"top 5:")
for r in rows[:5]:
    print(f"  {r['sku_count']:>5}  {r['brand_name']}  ({','.join(r['source_platforms'])})")
print(f"with sku>0: {sum(1 for r in rows if r['sku_count']>0)}")
print(f"total: {len(rows)}")
print(f"out: {out}")

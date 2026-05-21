import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
rows = [json.loads(l) for l in (REPO / "data/brand-enrichment/queue.jsonl").open()]
samples = []

for r in rows:
    if r["brand_name"].lower() == "kith":
        samples.append(("major_overseas", r))
        break

for r in rows:
    if 10 < r["sku_count"] < 50 and "SSENSE" in (r["source_platforms"] or []):
        samples.append(("indie_overseas_ssense", r))
        break

MAJOR_INTL = {"SSENSE","FARFETCH","SHOPBOP","MR_PORTER","NET_A_PORTER","MATCHES","END","LUISA_VIA_ROMA","kith","drakes","zara-us","uniqlo-us","NORDSTROM","BERGDORF_GOODMAN","SAKS"}

for r in rows:
    sp = r["source_platforms"] or []
    looks_cafe24 = any(p not in MAJOR_INTL for p in sp)
    if 30 < r["sku_count"] < 300 and looks_cafe24:
        samples.append(("korean_cafe24_guess", r))
        break

for r in rows:
    sp = r["source_platforms"] or []
    if 5 < r["sku_count"] < 30 and len(sp) == 1:
        p = sp[0]
        if isinstance(p, str) and p.lower() not in {x.lower() for x in MAJOR_INTL}:
            samples.append(("small_indie", r))
            break

for r in rows:
    if r["sku_count"] == 0:
        samples.append(("sku_zero", r))
        break

for label, r in samples:
    print(f"[{label}] id={r['brand_id']} name={r['brand_name']!r} sku={r['sku_count']} platforms={r['source_platforms']}")

(REPO / "tools" / "dry_run_samples.json").write_text(
    json.dumps([{"label":l, **r} for l,r in samples], ensure_ascii=False, indent=2)
)

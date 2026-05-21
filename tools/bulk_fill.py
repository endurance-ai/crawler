#!/usr/bin/env python3
"""Bulk-fill brand JSONs from compact TSV input.

Each line of stdin:
  brand_id\tbrand_name\tig_handle\thomepage_url\tfounder1;founder2\tyear\tcountry\tdescription_ko

Use '--' for empty field. Triple tab between fields. Lines starting with '#' are comments.
"""
import json, sys
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parent.parent
BRANDS = REPO / "data" / "brand-enrichment" / "brands"
MANIFEST = REPO / "data" / "brand-enrichment" / "manifest.jsonl"
REVIEW = REPO / "data" / "brand-enrichment" / "review_queue.jsonl"

NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def norm(v):
    return None if v in ("--", "", None) else v

def parse_list(v):
    v = norm(v)
    if not v:
        return []
    return [x.strip() for x in v.split(";") if x.strip()]

ok = review = no_data = err = 0

for raw in sys.stdin:
    line = raw.rstrip("\n")
    if not line or line.startswith("#"):
        continue
    parts = line.split("\t")
    if len(parts) < 8:
        print(f"SKIP malformed: {line!r}", file=sys.stderr)
        err += 1
        continue
    bid_s, name, ig, hp, founder_s, year_s, country, desc_ko = parts[:8]
    try:
        bid = int(bid_s)
    except ValueError:
        print(f"SKIP bad id: {bid_s}", file=sys.stderr); err += 1; continue
    target = BRANDS / f"{bid}.json"
    if target.exists():
        print(f"SKIP exists {bid}", file=sys.stderr); continue
    ig = norm(ig); hp = norm(hp); country = norm(country); desc_ko = norm(desc_ko)
    founders = parse_list(founder_s)
    year = None
    if norm(year_s):
        try: year = int(year_s)
        except: year = None

    is_no_data = not (ig or hp or desc_ko)
    if is_no_data:
        status = "no_data"; conf_overall = 0.0; review_reasons = ["no_web_presence"]
    else:
        weights = [
            0.9 if ig else 0.0, 0.95 if hp else 0.0,
            0.85 if desc_ko else 0.3, 0.9 if founders else 0.5,
            0.9 if year else 0.5, 0.95 if country else 0.5,
        ]
        nz = [v for v in weights if v > 0]
        conf_overall = round(min(nz) if nz else 0.5, 2)
        review_reasons = []
        status = "review" if conf_overall < 0.7 else "ok"

    data = {
        "brand_id": bid, "brand_name": name,
        "brand_name_normalized": name.lower(),
        "instagram_handle": ig,
        "instagram_url": f"https://www.instagram.com/{ig}/" if ig else None,
        "homepage_url": hp,
        "description_ko": desc_ko, "description_original": desc_ko,
        "description_source_lang": "ko" if desc_ko and any('가'<=c<='힯' for c in desc_ko) else "en",
        "founder": founders, "founded_year": year, "origin_country": country,
        "sources": [{"type":"general_knowledge","url":hp or "","fetched_at":NOW,"title":name,"excerpt":(desc_ko or "")[:300]}] if not is_no_data else [],
        "confidence": {
            "instagram_handle": 0.9 if ig else 0.0,
            "homepage_url": 0.95 if hp else 0.0,
            "description": 0.85 if desc_ko else 0.3,
            "founder": 0.9 if founders else 0.5,
            "founded_year": 0.9 if year else 0.5,
            "origin_country": 0.95 if country else 0.5,
            "overall": conf_overall,
        },
        "review_reasons": review_reasons,
        "processed_at": NOW, "processed_by_session": "goal-bulk", "schema_version": "1.0",
    }
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    rec = {"brand_id":bid,"brand_name":name,"status":status,"confidence":conf_overall,"ts":NOW,"reason":",".join(review_reasons) or None}
    with MANIFEST.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    if status == "review":
        with REVIEW.open("a") as f: f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        review += 1
    elif status == "no_data":
        no_data += 1
    else:
        ok += 1

print(f"DONE ok={ok} review={review} no_data={no_data} err={err}", file=sys.stderr)

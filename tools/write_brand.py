#!/usr/bin/env python3
"""Helper: write a brand JSON + append manifest line from minimal CLI args.

Usage:
  python3 tools/write_brand.py <<'JSON'
  {
    "brand_id": 1234,
    "brand_name": "...",
    ...all fields...
  }
  JSON

Reads brand JSON from stdin (full schema), writes to data/brand-enrichment/brands/{id}.json,
then appends manifest.jsonl line with status derived from review_reasons.
"""
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parent.parent
BRANDS = REPO / "data" / "brand-enrichment" / "brands"
MANIFEST = REPO / "data" / "brand-enrichment" / "manifest.jsonl"
REVIEW = REPO / "data" / "brand-enrichment" / "review_queue.jsonl"

data = json.loads(sys.stdin.read())
bid = data["brand_id"]

# Ensure defaults
data.setdefault("schema_version", "1.0")
data.setdefault("processed_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
data.setdefault("processed_by_session", "goal-auto")
data.setdefault("review_reasons", [])
data.setdefault("brand_name_normalized", (data.get("brand_name") or "").lower())
data.setdefault("description_source_lang", "en")
data.setdefault("sources", [])

cf = data.get("confidence", {})
if "overall" not in cf and cf:
    cf["overall"] = round(min([v for k, v in cf.items() if isinstance(v, (int, float))] or [0.5]), 2)
data["confidence"] = cf

# Status determination
overall = cf.get("overall", 0.5)
reasons = data.get("review_reasons") or []
no_data = data.get("_no_data", False)
data.pop("_no_data", None)

if no_data:
    status = "no_data"
elif reasons or overall < 0.7:
    status = "review"
else:
    status = "ok"

# Write brand JSON
out = BRANDS / f"{bid}.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(data, ensure_ascii=False, indent=2))

# Append manifest
rec = {
    "brand_id": bid,
    "brand_name": data.get("brand_name"),
    "status": status,
    "confidence": overall,
    "ts": data["processed_at"],
    "reason": ",".join(reasons) or None,
}
with MANIFEST.open("a") as f:
    f.write(json.dumps(rec, ensure_ascii=False) + "\n")

if status == "review":
    with REVIEW.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

print(f"OK {bid} {data.get('brand_name')} status={status} conf={overall}")

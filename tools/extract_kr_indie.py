#!/usr/bin/env python3
"""한국 인디 brand 별도 큐로 분리.
- origin_country = 'KR' 인 brand 전체 + brand_name 한글 포함
- ok / review / no_data 모두 포함하지만 별도 큐로
- 사용자가 manual 검수 시 우선순위
"""
import json, re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
M = REPO / "data/brand-enrichment/manifest.jsonl"
BRANDS = REPO / "data/brand-enrichment/brands"
OUT = REPO / "data/brand-enrichment/kr_review_queue.jsonl"

kr_brands = []
for l in M.open():
    m = json.loads(l)
    d = json.load((BRANDS / f"{m['brand_id']}.json").open())
    is_kr = d.get('origin_country') == 'KR'
    has_hangul = bool(re.search(r'[가-힣]', d.get('brand_name', '')))
    if is_kr or has_hangul:
        kr_brands.append({
            'brand_id': m['brand_id'],
            'brand_name': m['brand_name'],
            'status': m['status'],
            'confidence': m['confidence'],
            'origin_country': d.get('origin_country'),
            'has_hangul_name': has_hangul,
            'ig_guess': d.get('ig_handle_guess'),
            'instagram_handle': d.get('instagram_handle'),
        })

# Sort: status (review/no_data first), then confidence asc (lowest first for review)
kr_brands.sort(key=lambda r: (
    {'review':0,'no_data':1,'ok':2}.get(r['status'], 3),
    r['confidence']
))

OUT.write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in kr_brands) + '\n')

import collections
print(f'KR brands total: {len(kr_brands)}')
print(f'  status breakdown:')
for s, n in collections.Counter(r['status'] for r in kr_brands).most_common():
    print(f'    {s}: {n}')
print(f'output: {OUT}')

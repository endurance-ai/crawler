#!/usr/bin/env python3
"""Tier 3 demotion: 5개 필드(homepage/desc/founder/year/country)가 모두 비고
IG handle 만 추정값으로 박힌 brand 를 정직하게 처리.

- IG handle 신뢰도 낮음 (자동 추정) → instagram_handle 을 null 로 비움
- status = 'no_data' 로 변경
- review_queue 에서 제거 → no_data 로 분리
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
M = REPO / "data/brand-enrichment/manifest.jsonl"
RQ = REPO / "data/brand-enrichment/review_queue.jsonl"
ND = REPO / "data/brand-enrichment/no_data_queue.jsonl"
BRANDS = REPO / "data/brand-enrichment/brands"

demoted = []
new_lines = []
for l in M.open():
    m = json.loads(l)
    if m['status'] != 'review':
        new_lines.append(l)
        continue
    d = json.load((BRANDS / f"{m['brand_id']}.json").open())
    missing = []
    if not d.get('homepage_url'): missing.append('homepage')
    if not d.get('description_ko'): missing.append('description')
    if not d.get('founder'): missing.append('founder')
    if not d.get('founded_year'): missing.append('year')
    if not d.get('origin_country'): missing.append('country')

    if len(missing) == 5:
        # IG handle 도 자동 추정값일 가능성 매우 큼 → 비우고 ig_candidate 로 보존
        ig_guess = d.get('instagram_handle')
        d['instagram_handle'] = None
        d['instagram_url'] = None
        d['ig_handle_guess'] = ig_guess  # 검수용으로 보존
        d['review_reasons'] = ['no_verified_data','ig_guess_only']
        d['confidence']['overall'] = 0.0
        (BRANDS / f"{m['brand_id']}.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))

        m['status'] = 'no_data'
        m['confidence'] = 0.0
        m['reason'] = 'no_verified_data'
        new_lines.append(json.dumps(m, ensure_ascii=False) + '\n')
        demoted.append(m['brand_id'])
    else:
        new_lines.append(l)

M.write_text(''.join(new_lines))

# review_queue 에서 demoted 제거
rq_lines = []
for l in RQ.open():
    try:
        r = json.loads(l)
        if r['brand_id'] not in demoted:
            rq_lines.append(l)
    except: pass
RQ.write_text(''.join(rq_lines))

# no_data_queue 에 추가 (검수 분리 큐)
with ND.open('a') as f:
    for bid in demoted:
        d = json.load((BRANDS / f"{bid}.json").open())
        f.write(json.dumps({
            'brand_id': bid,
            'brand_name': d['brand_name'],
            'ig_guess': d.get('ig_handle_guess'),
            'reason': 'no_verified_data',
        }, ensure_ascii=False) + '\n')

print(f'Demoted to no_data: {len(demoted)}')

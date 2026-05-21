#!/usr/bin/env python3
"""Tier 1 promotion: founder만 비어있고 다른 필드 다 있는 brand 를 ok 로 승격.
- review_reasons 에 'founder_unknown' 추가
- confidence.overall 재계산 (founder 가중치 제외)
- manifest 상태 갱신
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
M = REPO / "data/brand-enrichment/manifest.jsonl"
RQ = REPO / "data/brand-enrichment/review_queue.jsonl"
BRANDS = REPO / "data/brand-enrichment/brands"

promoted = []
new_lines = []
for l in M.open():
    m = json.loads(l)
    if m['status'] != 'review':
        new_lines.append(l)
        continue
    d = json.load((BRANDS / f"{m['brand_id']}.json").open())
    missing = []
    if not d.get('instagram_handle'): missing.append('ig')
    if not d.get('homepage_url'): missing.append('homepage')
    if not d.get('description_ko'): missing.append('description')
    if not d.get('founder'): missing.append('founder')
    if not d.get('founded_year'): missing.append('year')
    if not d.get('origin_country'): missing.append('country')

    if missing == ['founder']:
        # Promote: 새 confidence 계산 (founder 제외)
        cf = d['confidence']
        non_founder = [cf['instagram_handle'], cf['homepage_url'], cf['description'], cf['founded_year'], cf['origin_country']]
        new_overall = round(min(non_founder), 2)
        cf['overall'] = new_overall
        d['confidence'] = cf
        d['review_reasons'] = ['founder_unknown']
        # status will be 'ok' since we treat founder_unknown as acceptable
        (BRANDS / f"{m['brand_id']}.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))

        m['status'] = 'ok'
        m['confidence'] = new_overall
        m['reason'] = 'founder_unknown'
        new_lines.append(json.dumps(m, ensure_ascii=False) + '\n')
        promoted.append(m['brand_id'])
    else:
        new_lines.append(l)

M.write_text(''.join(new_lines))

# review_queue.jsonl 에서 promoted 제거
rq_lines = []
for l in RQ.open():
    try:
        r = json.loads(l)
        if r['brand_id'] not in promoted:
            rq_lines.append(l)
    except: pass
RQ.write_text(''.join(rq_lines))

print(f'Promoted to ok: {len(promoted)}')

#!/usr/bin/env bash
# One-shot PROGRESS surfacer
M="data/brand-enrichment/manifest.jsonl"
python3 -c "
import json
lines = [json.loads(l) for l in open('$M')]
ok = sum(1 for l in lines if l['status']=='ok')
review = sum(1 for l in lines if l['status']=='review')
nodata = sum(1 for l in lines if l['status']=='no_data')
err = sum(1 for l in lines if l['status']=='error')
print(f'PROGRESS manifest_lines={len(lines)} ok={ok} review={review} no_data={nodata} error={err} target=2899')
"

# Local Qwen provider

Crawler LLM work uses the local OpenAI-compatible Qwen endpoints. There is no
OpenAI fallback. Product import writes the safe canonical row first and applies
Qwen output afterward as a conditional patch.

> **HARD GATE:** production imports require every configured Qwen endpoint to
> expose the configured model through `/models` before the first DB mutation.
> Missing SSH tunnels must fail the job. `success=0 deferred=N` is not a
> completed import.

## Configuration

```dotenv
QWEN_ENABLED=true
QWEN_BASE_URLS=http://127.0.0.1:8001/v1,http://127.0.0.1:8002/v1
QWEN_MODEL=qwen3-vl-30b-awq
QWEN_TIMEOUT_MS=45000
QWEN_MAX_RETRIES=2
QWEN_CONCURRENCY_PER_ENDPOINT=1
```

Only loopback endpoint URLs are accepted. Requests are distributed round-robin,
each endpoint has its own concurrency limit, and a 30-second circuit opens after
all attempts fail. Structured calls use strict JSON Schema output.

`QWEN_ENABLED=false` disables enrichment while leaving crawl/import available.
Rows that could not be enriched remain canonical (`category=other` where needed)
and can be retried from their existing queue or file checkpoint.

## SSH tunnel and health check

When the inference server is remote, create the tunnel outside systemd:

```bash
ssh -N \
  -L 8001:127.0.0.1:8001 \
  -L 8002:127.0.0.1:8002 \
  user@qwen-host
```

Verify both endpoints before starting a canary:

```bash
curl -fsS http://127.0.0.1:8001/v1/models
curl -fsS http://127.0.0.1:8002/v1/models
```

Exercise the crawler provider, strict JSON Schema output, and round-robin routing:

```bash
pnpm smoke:qwen
```

`import:products` performs this endpoint/model check automatically. If an
endpoint becomes unavailable or returns an invalid schema during the run, the
command exits non-zero so batch scripts cannot create a completion marker.

`--allow-qwen-deferred` is an incident-only escape hatch. Scheduled onboarding
and recollection jobs must never use it. When explicitly used, unresolved rows
remain visible as `category=other` or `subcategory=null`.

Start with a small import or `refresh:candidates --limit=...`, confirm the Qwen
`success/unchanged/unavailable/failed/schema/race` counters, then restore the
normal batch limit. `unchanged` means Qwen responded but the safe patch policy
preserved the existing official category. `unavailable` means the model was not
reached and is always an operational failure.

`enrich:products` remains a manual file preflight tool. Normal production imports
perform Qwen normalization only after the database upsert succeeds.

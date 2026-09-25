# Rolling refresh run health

`scripts/run-refresh-rolling.sh` runs a 15-minute listing pass, a Zara detail
pass (at most 180 products), and a general detail pass (at most 5,000 products).
The Zara and overall deadlines are 25 and 50 minutes from the run start.
Each phase still runs after a prior phase fails, and the wrapper exits nonzero
if any phase reports a failed result.

The detail JSON includes `health.status`, `health.reason`, `health.persisted`,
and `health.persistence_attempted`. The listing JSON includes
`rolling_listing_health` and its progress/error counters.

| Status | Meaning | Service exit |
| --- | --- | --- |
| `success` | Bounded work finished without observed errors | 0 |
| `degraded` | Some products or sources need retry, but useful work was persisted | 0 |
| `failed` | No meaningful progress or a systemic source/DB failure | 1 |

For detail, `persisted` counts confirmed products and recorded removals. A pass
fails if eligible work exists but nothing is attempted; if at least 10 products
are attempted but none are persisted or fewer than half are persisted; or if at
least 3 DB failures or CAS conflicts affect at least 2% of persistence attempts.
Other blocked, transient, unreadable, DB, and CAS results remain visible as
`degraded` and in the retry state.

For listing, partial source slices are normal progress. A pass fails if every
attempted slice fails before completion or checkpoint; if at least 3 source
failures affect at least 20% of slices; or if at least 3 DB write failures
affect at least 2% of write attempts. A smaller source or write failure and a
telemetry failure remain `degraded`. The source's own completeness guard still
prevents unsafe out-of-stock writes independently of this run health result.

The 5,000-product general limit is a ceiling, not a target: the 50-minute
deadline stops the pass first when requests are slow. Review attempted count,
runtime, memory peak, and the two health objects over several hourly runs
before changing concurrency, deadlines, or limits.

#!/usr/bin/env bash
set -euo pipefail

# Publishes only after the crawler has verified a complete 100-item source
# response. A failed or partial fetch exits non-zero and leaves the last good
# snapshot untouched.
exec corepack pnpm crawl:edit-shop-listings


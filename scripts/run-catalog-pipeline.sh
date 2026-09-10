#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

. "$(dirname "$0")/lib-batch-prep.sh"
batch_prep

PNPM=${PNPM:-pnpm}
exec $PNPM catalog:pipeline -- --drain "$@"

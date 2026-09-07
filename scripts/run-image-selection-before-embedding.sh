#!/usr/bin/env bash
# Select Linux/Apple representative images, then embed the exact pending set.
# This is the controlled production entrypoint; both stages are bounded by LIMIT.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRAWLER_DIR="${CRAWLER_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
AI_APP_DIR="${AI_APP_DIR:-$(cd "$CRAWLER_DIR/../kiko.ai-app" && pwd)}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

export CRAWLER_DIR
export AUTO_SELECT_REPRESENTATIVE_IMAGES=true
export IMAGE_SELECTION_CONCURRENCY="${IMAGE_SELECTION_CONCURRENCY:-2}"

cd "$AI_APP_DIR"
exec "$PYTHON_BIN" scripts/aws/embed_products.py

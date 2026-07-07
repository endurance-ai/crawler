#!/usr/bin/env bash
# Download the official Lightpanda nightly binary into ./bin/lightpanda.
# Used when CRAWLER_CAFE24_ENGINE=lightpanda or auto.
# Lightpanda ships a single static binary per OS/arch from the `nightly` release tag.
set -euo pipefail

REPO="lightpanda-io/browser"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"
DEST="$DEST_DIR/lightpanda"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os_tag="macos" ;;
  Linux)  os_tag="linux" ;;
  *) echo "Unsupported OS: $os (Lightpanda supports macOS and Linux only)" >&2; exit 1 ;;
esac

case "$arch" in
  arm64|aarch64) arch_tag="aarch64" ;;
  x86_64|amd64)  arch_tag="x86_64" ;;
  *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
esac

asset="lightpanda-${arch_tag}-${os_tag}"
url="https://github.com/${REPO}/releases/download/nightly/${asset}"

mkdir -p "$DEST_DIR"
echo "Downloading ${asset} -> ${DEST}"
curl -fL --retry 3 -o "$DEST" "$url"
chmod a+x "$DEST"

echo "Installed:"
"$DEST" --version || echo "(--version not supported; binary is in place at $DEST)"

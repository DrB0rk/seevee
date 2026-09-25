#!/usr/bin/env sh
# bundle-all.sh — Build every platform bundle and emit SHA256SUMS.
#
# Usage: scripts/bundle-all.sh [output-dir]
#
# Default output-dir: dist/release (relative to repo root).

set -eu

OUTPUT_DIR="${1:-${OUTPUT_DIR:-dist/release}}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
mkdir -p "$OUTPUT_DIR"

PLATFORMS="linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64"

first=1
for P in $PLATFORMS; do
  case "$P" in
    windows-x64) OUT="$OUTPUT_DIR/seevee-${P}.zip" ;;
    *)           OUT="$OUTPUT_DIR/seevee-${P}.tar.gz" ;;
  esac
  echo "==> $P -> $OUT" >&2
  if [ "$first" -eq 1 ]; then
    ./scripts/bundle.sh "$P" "$OUT"
    first=0
  else
    SEEVEE_SKIP_BUILD=1 ./scripts/bundle.sh "$P" "$OUT"
  fi
done

# ---------------------------------------------------------------------------
# SHA256SUMS manifest
# ---------------------------------------------------------------------------
SUM_FILE="$OUTPUT_DIR/SHA256SUMS"
# Use sha256sum if available, else shasum (macOS).
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum seevee-linux-x64.tar.gz seevee-linux-arm64.tar.gz seevee-darwin-x64.tar.gz seevee-darwin-arm64.tar.gz seevee-windows-x64.zip > SHA256SUMS)
else
  (cd "$OUTPUT_DIR" && shasum -a 256 seevee-linux-x64.tar.gz seevee-linux-arm64.tar.gz seevee-darwin-x64.tar.gz seevee-darwin-arm64.tar.gz seevee-windows-x64.zip > SHA256SUMS)
fi

cat "$SUM_FILE"
#!/usr/bin/env sh
# verify_bundle.sh — Verify a downloaded Seevee bundle by unpacking it and
# running the launcher's --version flag.
#
# Usage: scripts/verify_bundle.sh <archive>
#
#   <archive>  path to a .tar.gz or .zip Seevee release bundle.

set -eu

ARCHIVE="${1:-}"

usage() {
  echo "usage: $(basename "$0") <archive>" >&2
  exit 64
}

[ -n "$ARCHIVE" ] || usage
[ -f "$ARCHIVE" ] || { echo "verify_bundle.sh: archive not found: $ARCHIVE" >&2; exit 64; }

WORK="$(mktemp -d -t seevee-verify.XXXXXX)"
cleanup() {
  if [ -n "${SMOKE_WORKSPACE:-}" ] && [ -x "${LAUNCHER:-}" ]; then
    "$LAUNCHER" stop "$SMOKE_WORKSPACE" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# 1. Verify the bundle's published SHA-256 if a sibling SHA256SUMS exists.
# ---------------------------------------------------------------------------
SUMS_DIR="$(dirname "$ARCHIVE")"
if [ -f "$SUMS_DIR/SHA256SUMS" ]; then
  base="$(basename "$ARCHIVE")"
  expected="$(awk -v f="$base" '$2==f {print $1}' "$SUMS_DIR/SHA256SUMS")"
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
    fi
    if [ "$actual" != "$expected" ]; then
      echo "verify_bundle.sh: SHA-256 mismatch for $base" >&2
      echo "  expected: $expected" >&2
      echo "  actual:   $actual" >&2
      exit 1
    fi
    echo "verify_bundle.sh: SHA-256 OK"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Extract to a scratch directory.
# ---------------------------------------------------------------------------
case "$ARCHIVE" in
  *.tar.gz)
    tar -xzf "$ARCHIVE" -C "$WORK"
    ;;
  *.zip)
    if command -v unzip >/dev/null 2>&1; then
      (cd "$WORK" && unzip -q "$ARCHIVE")
    elif command -v python3 >/dev/null 2>&1; then
      python3 - "$ARCHIVE" "$WORK" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2])
PY
    else
      echo "verify_bundle.sh: 'unzip' or 'python3' is required for .zip bundles" >&2
      exit 1
    fi
    ;;
  *)
    echo "verify_bundle.sh: unsupported archive extension: $ARCHIVE" >&2
    exit 64 ;;
esac

BUNDLE_DIR="$WORK/$(ls "$WORK")"  # single top-level entry: seevee-<platform>/

# ---------------------------------------------------------------------------
# 3. Run the structural tests.
# ---------------------------------------------------------------------------
"$(dirname "$0")/test_bundle.sh" "$BUNDLE_DIR"

# ---------------------------------------------------------------------------
# 4. Run the launcher's --version and compare to VERSION.
# ---------------------------------------------------------------------------
case "$(basename "$BUNDLE_DIR")" in
  *windows-*) chmod +x "$BUNDLE_DIR/bin/seevee" 2>/dev/null || true ;;
esac
VERSION_FILE="$(cat "$BUNDLE_DIR/VERSION")"
LAUNCHER="$BUNDLE_DIR/bin/seevee"

if [ ! -x "$LAUNCHER" ]; then
  echo "verify_bundle.sh: launcher is not executable: $LAUNCHER" >&2
  exit 1
fi

OUT="$("$LAUNCHER" --version 2>&1)" || {
  echo "verify_bundle.sh: launcher exited non-zero: $OUT" >&2
  exit 1
}

if printf '%s' "$OUT" | grep -qF "$VERSION_FILE"; then
  echo "verify_bundle.sh: launcher --version matches VERSION ($VERSION_FILE)"
else
  echo "verify_bundle.sh: launcher --version output did not contain $VERSION_FILE" >&2
  echo "  output: $OUT" >&2
  exit 1
fi

echo "verify_bundle.sh: bundle OK"

# ---------------------------------------------------------------------------
# 5. Smoke-test workspace initialization and the detached daemon.
# ---------------------------------------------------------------------------
SMOKE_WORKSPACE="$WORK/smoke workspace"
mkdir -p "$SMOKE_WORKSPACE"
"$LAUNCHER" init "$SMOKE_WORKSPACE" --no-open
STATUS="$(cd "$SMOKE_WORKSPACE" && "$LAUNCHER" status --json)"
if ! printf '%s' "$STATUS" | grep -q '"running": true'; then
  echo "verify_bundle.sh: initialized dashboard did not report healthy" >&2
  printf '%s\n' "$STATUS" >&2
  exit 1
fi
(cd "$SMOKE_WORKSPACE" && "$LAUNCHER" stop)

# Start twice at the same time from a stopped workspace. Both invocations
# must share one server process and the same bound port.
"$LAUNCHER" start "$SMOKE_WORKSPACE" > "$WORK/start-a.log" 2>&1 &
START_A=$!
"$LAUNCHER" start "$SMOKE_WORKSPACE" > "$WORK/start-b.log" 2>&1 &
START_B=$!
if ! wait "$START_A"; then
  cat "$WORK/start-a.log" "$WORK/start-b.log" >&2
  exit 1
fi
if ! wait "$START_B"; then
  cat "$WORK/start-a.log" "$WORK/start-b.log" >&2
  exit 1
fi
PROCESS_COUNT="$(ps -eo pid=,args= | awk -v root="$SMOKE_WORKSPACE" 'index($0,root) && index($0,"runtime/studio/dist/server/entry.mjs") && $2 ~ /node/ { count++ } END { print count+0 }')"
if [ "$PROCESS_COUNT" -ne 1 ]; then
  echo "verify_bundle.sh: expected one Studio process, found $PROCESS_COUNT" >&2
  cat "$WORK/start-a.log" "$WORK/start-b.log" >&2
  exit 1
fi
STATUS="$(cd "$SMOKE_WORKSPACE" && "$LAUNCHER" status --json)"
if ! printf '%s' "$STATUS" | grep -q '"running": true'; then
  echo "verify_bundle.sh: concurrent start did not leave a healthy dashboard" >&2
  printf '%s\n' "$STATUS" >&2
  exit 1
fi
(cd "$SMOKE_WORKSPACE" && "$LAUNCHER" stop)
echo "verify_bundle.sh: init, health, concurrent start reuse, and stop OK"

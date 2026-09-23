#!/usr/bin/env sh
# test_bundle.sh — Static structure checks for an already-built bundle.
#
# Usage: scripts/test_bundle.sh <bundle-dir>
#
# Verifies, without running anything, that a bundle directory contains the
# shape required by .dev/specs/CLI_INSTALLER.md §2:
#
#   <bundle>/
#     VERSION
#     bin/seevee
#     runtime/
#       cli/  schema/  template-sdk/  renderer/  node_modules/

set -eu

BUNDLE_DIR="${1:-}"

usage() {
  echo "usage: $(basename "$0") <bundle-dir>" >&2
  exit 64
}

[ -n "$BUNDLE_DIR" ] || usage

fails=0

assert() {
  desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc"
    fails=$((fails + 1))
  fi
}

# Locate the bundle root. The directory the user passes may be either the
# inner archive root (seevee-<platform>/) or a directory containing it.
if [ ! -d "$BUNDLE_DIR/VERSION" ] && [ -d "$BUNDLE_DIR" ]; then
  # Auto-discover the inner seevee-* directory if present.
  inner="$(find "$BUNDLE_DIR" -maxdepth 2 -name 'VERSION' -print 2>/dev/null | head -1 | xargs -I{} dirname {} 2>/dev/null || true)"
  if [ -n "$inner" ] && [ -d "$inner" ]; then
    BUNDLE_DIR="$inner"
  fi
fi

assert "VERSION file present"  test -f "$BUNDLE_DIR/VERSION"
assert "VERSION non-empty"     test -s "$BUNDLE_DIR/VERSION"
assert "bin/ directory"        test -d "$BUNDLE_DIR/bin"
assert "bin/seevee present"    test -f "$BUNDLE_DIR/bin/seevee"
case "$(basename "$BUNDLE_DIR")" in
  *windows-*) assert "Windows command launcher present" test -f "$BUNDLE_DIR/bin/seevee.cmd" ;;
  *)          assert "bin/seevee executable" test -x "$BUNDLE_DIR/bin/seevee" ;;
esac
assert "runtime/ directory"    test -d "$BUNDLE_DIR/runtime"
assert "runtime/cli/"          test -d "$BUNDLE_DIR/runtime/cli"
assert "runtime/schema/"       test -d "$BUNDLE_DIR/runtime/schema"
assert "runtime/template-sdk/" test -d "$BUNDLE_DIR/runtime/template-sdk"
assert "runtime/renderer/"     test -d "$BUNDLE_DIR/runtime/renderer"
assert "runtime/node_modules/" test -d "$BUNDLE_DIR/runtime/node_modules"
assert "runtime/cli/dist/cli.js present" test -f "$BUNDLE_DIR/runtime/cli/dist/cli.js"
assert "compiled dashboard daemon present" test -f "$BUNDLE_DIR/runtime/cli/dist/runtime/daemon-server.js"

# The @seevee/cli launcher JS must be at runtime/cli/dist/cli.js (matches
# the package.json `main` field) so its relative imports of ./commands/*,
# ./runtime/*, ./scaffold/* resolve correctly.
ver="$(cat "$BUNDLE_DIR/VERSION" 2>/dev/null || true)"
if printf '%s' "$ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "PASS: VERSION is semver ($ver)"
else
  echo "FAIL: VERSION is not semver (got: $ver)"
  fails=$((fails + 1))
fi

if [ "$fails" -gt 0 ]; then
  echo "$fails test(s) failed"
  exit 1
fi

echo "All bundle structure tests passed"

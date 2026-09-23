#!/usr/bin/env sh
# test_install.sh — install.sh static-only behavior tests
# These tests verify structure and argument parsing without network access.
set -e

SCRIPT="$(dirname "$0")/../install.sh"

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

# Test: --help exits 0 without doing anything
assert "--help prints usage" sh -c "$SCRIPT --help | grep -q 'usage:'"
assert "executable"              test -x "$SCRIPT"
assert "has shebang"             sh -c "head -n 1 '$SCRIPT' | grep -q '^#!'"
assert "declares set -e"         sh -c "grep -q '^set -e' '$SCRIPT'"
assert "declares cleanup trap"   sh -c "grep -q 'trap.*cleanup' '$SCRIPT'"
assert "uses sha256sum"          sh -c "grep -q 'sha256sum' '$SCRIPT'"
assert "resolves version"        sh -c "grep -q 'VERSION=' '$SCRIPT'"
assert "uses exit on fail"       sh -c "grep -q 'exit 1' '$SCRIPT'"
assert "writes launcher script"  sh -c "grep -q 'LAUNCHER' '$SCRIPT'"
assert "verifies run"            sh -c "grep -q -- '--version' '$SCRIPT'"
assert "no npm install"          sh -c "! grep -q 'npm install.*seevee' '$SCRIPT'"
assert "checks PATH before hint" sh -c "grep -q 'PATH' '$SCRIPT'"

if [ $fails -gt 0 ]; then
  echo "$fails test(s) failed"
  exit 1
fi

echo "All install.sh static tests passed"

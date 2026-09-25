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
assert "--help prints usage" sh -c "$SCRIPT --help | grep -qi 'usage:'"
assert "executable"              test -x "$SCRIPT"
assert "has shebang"             sh -c "head -n 1 '$SCRIPT' | grep -q '^#!'"
assert "declares strict shell mode" sh -c "grep -q '^set -eu' '$SCRIPT'"
assert "declares cleanup trap"   sh -c "grep -q 'trap.*cleanup' '$SCRIPT'"
assert "verifies SHA-256"         sh -c "grep -q 'sha256sum' '$SCRIPT' && grep -q 'shasum -a 256' '$SCRIPT'"
assert "resolves version"        sh -c "grep -q 'VERSION=' '$SCRIPT'"
assert "shows download progress" sh -c "grep -q -- '--progress-bar' '$SCRIPT'"
assert "downloads release ranges in parallel" sh -c "grep -q -- '--range \"\$range_start-\$range_end\"' '$SCRIPT' && grep -q 'part_count=8' '$SCRIPT'"
assert "checks assembled bundle checksum" sh -c "grep -q '\[ \"\$EXPECTED_SHA\" = \"\$ACTUAL_SHA\" \]' '$SCRIPT'"
assert "prints install status"   sh -c "grep -q 'Checking SHA-256 checksum' '$SCRIPT' && grep -q 'Checking the installed command' '$SCRIPT'"
assert "checks Node requirement" sh -c "grep -q 'NODE_MAJOR' '$SCRIPT'"
assert "checks bundled dashboard, agent guide, and Classic template" sh -c "grep -q 'runtime/studio/dist/server/entry.mjs' '$SCRIPT' && grep -q 'runtime/agent/seevee-workspace-agent/SKILL.md' '$SCRIPT' && grep -q 'runtime/templates/classic/v1/template.json' '$SCRIPT'"
assert "checks the staged CLI before replacing the install" sh -c "grep -q 'Checking the staged command' '$SCRIPT' && grep -q 'Staged command is ready' '$SCRIPT'"
assert "keeps rollback copies until installed command starts" sh -c "grep -q 'LAUNCHER_OLD' '$SCRIPT' && grep -q 'OLD_DIR' '$SCRIPT'"
assert "downloads public release assets directly" sh -c "grep -q 'curl_download \"\$RELEASE_URL/\$asset_name\"' '$SCRIPT'"
assert "does not require GitHub authentication" sh -c "! grep -Eq 'gh auth|GH_TOKEN|GITHUB_TOKEN|netrc' '$SCRIPT'"
assert "writes launcher script"  sh -c "grep -q 'LAUNCHER_TMP' '$SCRIPT'"
assert "verifies run"            sh -c "grep -q -- '--version' '$SCRIPT'"
assert "no npm install"          sh -c "! grep -q 'npm install.*seevee' '$SCRIPT'"
assert "checks PATH before hint" sh -c "grep -q 'PATH' '$SCRIPT'"
assert "enforces HTTPS-only transport" sh -c "grep -q -- '--proto' '$SCRIPT' && grep -q -- '--proto-redir' '$SCRIPT'"
assert "validates archive members and symlinks" sh -c "grep -q 'validate_archive' '$SCRIPT' && grep -q 'archive-members' '$SCRIPT'"
assert "locks concurrent installations" sh -c "grep -q 'install.lock' '$SCRIPT' && grep -q 'Another Seevee installation' '$SCRIPT'"
assert "requires absolute install paths" sh -c "grep -q 'must be an absolute path' '$SCRIPT'"
assert "creates launcher temp file with mktemp" sh -c "grep -q 'mktemp.*seevee' '$SCRIPT'"
assert "prunes superseded versions after activation" sh -c "grep -q 'old_bundle' '$SCRIPT'"
assert "checks the bundled agent runtime" sh -c "grep -q 'runtime/agent-runtime/dist/index.js' '$SCRIPT'"
assert "uses release list without expected 404" sh -c "grep -q 'releases?per_page=20' '$SCRIPT' && ! grep -q 'releases/latest' '$SCRIPT'"

if [ $fails -gt 0 ]; then
  echo "$fails test(s) failed"
  exit 1
fi

echo "All install.sh static tests passed"

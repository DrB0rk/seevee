#!/usr/bin/env sh
# test_install_ps1.ps1 — install.ps1 static-only behavior tests
# We can't run PowerShell directly in CI shells everywhere, so these check syntax + structure.
set -e

SCRIPT="$(dirname "$0")/../install.ps1"

assert() {
  desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc"
    exit 1
  fi
}

# Test: script has param block (PowerShell function param syntax)
if grep -q "^\s*param(" "$SCRIPT"; then
  echo "PASS: install.ps1 has param block"
else
  echo "FAIL: install.ps1 missing param block"
  exit 1
fi

# Test: uses ErrorActionPreference = 'Stop'
if grep -q "ErrorActionPreference = 'Stop'" "$SCRIPT"; then
  echo "PASS: install.ps1 sets strict error mode"
else
  echo "FAIL: install.ps1 missing ErrorActionPreference"
  exit 1
fi

# Test: verifies SHA256 (not MD5/SHA1)
if grep -qi "Get-FileHash.*SHA256" "$SCRIPT"; then
  echo "PASS: install.ps1 uses SHA256 verification"
else
  echo "FAIL: install.ps1 missing SHA256 check"
  exit 1
fi

# Test: downloads with a visible progress meter and status steps
if grep -q "Write-Progress" "$SCRIPT" && grep -q "Write-Step" "$SCRIPT"; then
  echo "PASS: install.ps1 shows progress and stages"
else
  echo "FAIL: install.ps1 missing visible progress"
  exit 1
fi

# Test: checks for Node.js before downloading
if grep -q "Node.js 20 or newer is required" "$SCRIPT"; then
  echo "PASS: install.ps1 checks Node.js requirement"
else
  echo "FAIL: install.ps1 missing Node.js requirement check"
  exit 1
fi

# Test: downloads public release assets without authentication
if grep -q 'https://github.com/\$Repository/releases/download/v\$Version' "$SCRIPT" && ! grep -Eq 'gh auth|GH_TOKEN|GITHUB_TOKEN|Authorization' "$SCRIPT"; then
  echo "PASS: install.ps1 downloads public releases without authentication"
else
  echo "FAIL: install.ps1 must download public releases without authentication"
  exit 1
fi

# Test: uses versioned install path
if grep -q "v\\\$Version\|\\\\v\${Version}\\\\InstallDir" "$SCRIPT" || grep -q "InstallDir.*Version" "$SCRIPT"; then
  echo "PASS: install.ps1 uses versioned install path"
else
  echo "FAIL: install.ps1 missing versioned install path"
  exit 1
fi

# Test: launcher writes to %LOCALAPPDATA%\seevee
if grep -qi "localappdata" "$SCRIPT"; then
  echo "PASS: install.ps1 installs to user-local path"
else
  echo "FAIL: install.ps1 not using user-local install path"
  exit 1
fi

if grep -q 'runtime\\studio\\dist\\server\\entry.mjs' "$SCRIPT" && grep -q 'runtime\\agent\\seevee-workspace-agent\\SKILL.md' "$SCRIPT" && grep -q 'runtime\\templates\\classic\\v1\\template.json' "$SCRIPT"; then
  echo "PASS: install.ps1 checks the full workspace-ready bundle"
else
  echo "FAIL: install.ps1 must check the dashboard, agent guide, and Classic template"
  exit 1
fi

if grep -q 'Checking the staged command' "$SCRIPT" && grep -q 'Checking the installed command' "$SCRIPT"; then
  echo "PASS: install.ps1 verifies both staged and activated CLI"
else
  echo "FAIL: install.ps1 must verify the CLI before and after activation"
  exit 1
fi

assert "validates archive entries and rejects symlinks" grep -q 'Assert-ArchiveEntries' "$SCRIPT"
assert "enforces HTTPS response scheme" sh -c "grep -q 'RequestMessage.RequestUri' '$SCRIPT' && grep -q 'Refusing insecure redirect' '$SCRIPT'"
assert "guards launcher rollback" grep -q 'LauncherTouched' "$SCRIPT"
assert "locks concurrent installations" grep -q 'install.lock' "$SCRIPT"
assert "only removes an owned install lock" sh -c "grep -q 'LockAcquired' '$SCRIPT' && grep -q 'LockDir = \$null' '$SCRIPT'"
assert "creates a private temp directory with retries" grep -q 'GetRandomFileName' "$SCRIPT"
assert "creates launcher temp files with CreateNew" sh -c "grep -q 'Guid.*NewGuid' '$SCRIPT' && grep -q 'FileMode.*CreateNew' '$SCRIPT'"
assert "matches PATH entries exactly" grep -q 'PathEntries -notcontains' "$SCRIPT"
assert "prunes superseded versions" grep -q "Get-ChildItem.*-Filter 'v\*'" "$SCRIPT"
assert "checks the bundled agent runtime" grep -q 'agent-runtime\\dist\\index.js' "$SCRIPT"
assert "uses release list without expected 404" sh -c "grep -q 'releases?per_page=20' '$SCRIPT' && ! grep -q 'releases/latest' '$SCRIPT'"
echo "All install.ps1 static tests passed"

#!/usr/bin/env sh
# test_install_ps1.ps1 — install.ps1 static-only behavior tests
# We can't run PowerShell directly in CI shells everywhere, so these check syntax + structure.
set -e

SCRIPT="$(dirname "$0")/../install.ps1"

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

# Test: supports authenticated private GitHub releases
if grep -q "gh auth token" "$SCRIPT" && grep -q "application/octet-stream" "$SCRIPT"; then
  echo "PASS: install.ps1 supports authenticated release downloads"
else
  echo "FAIL: install.ps1 missing authenticated release download support"
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

echo "All install.ps1 static tests passed"

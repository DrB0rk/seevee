# install.ps1 — Seevee self-install for Windows
# Usage:
#   irm https://raw.githubusercontent.com/DrB0rk/seevee/main/install.ps1 | iex
#   irm https://raw.githubusercontent.com/DrB0rk/seevee/main/install.ps1 | iex -Version "0.2.0"
param(
  [string]$Version = ""
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Detect arch
# ---------------------------------------------------------------------------
$Arch = $env:PROCESSOR_ARCHITECTURE
if ($Arch -eq 'AMD64') { $Arch = 'x64' }
else { throw "Unsupported architecture: $Arch" }

$Platform = "windows-$Arch"
$ArchiveName = "seevee-$Platform.zip"

# ---------------------------------------------------------------------------
# Resolve version
# ---------------------------------------------------------------------------
if ([string]::IsNullOrEmpty($Version)) {
  $Releases = Invoke-RestMethod -Uri "https://api.github.com/repos/DrB0rk/seevee/releases?per_page=1" -TimeoutSec 10
  if ($Releases.Count -gt 0) { $Version = $Releases[0].tag_name -replace '^v', '' }
}
$Version = $Version -replace '^v', ''
if ([string]::IsNullOrEmpty($Version)) { throw "Could not resolve latest version" }
if ($Version -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid release version: $Version" }

$DownloadUrl = "https://github.com/DrB0rk/seevee/releases/download/v${Version}/${ArchiveName}"
$ChecksumUrl = "https://github.com/DrB0rk/seevee/releases/download/v${Version}/SHA256SUMS"

# ---------------------------------------------------------------------------
# Temp directory
# ---------------------------------------------------------------------------
$TmpDir = [System.IO.Path]::GetTempPath()
  $TmpDir = Join-Path $TmpDir ([System.IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $TmpDir | Out-Null
  $TmpArchive = Join-Path $TmpDir $ArchiveName
  $TmpSumFile = Join-Path $TmpDir "SHA256SUMS"

try {
  # ---------------------------------------------------------------------------
  # Download
  # ---------------------------------------------------------------------------
  Write-Host "Downloading Seevee v${Version} for ${Platform}..."
  try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TmpArchive -TimeoutSec 60
  }
  catch { throw "Archive not found: ${ArchiveName} (version ${Version} may not exist)" }

  # ---------------------------------------------------------------------------
  # Verify checksum
  # ---------------------------------------------------------------------------
  Write-Host "Verifying checksum..."
  Invoke-WebRequest -Uri $ChecksumUrl -OutFile $TmpSumFile -TimeoutSec 30
  $ExpectedLine = Get-Content $TmpSumFile | Where-Object { $_ -match " ${ArchiveName}$" }
  if (-not $ExpectedLine) { throw "SHA256SUMS: entry not found for ${ArchiveName}" }
  $ExpectedSha = ($ExpectedLine -split ' ')[0].Trim()
  $ExpectedSha = $ExpectedSha.ToUpperInvariant()

  $Stream = [System.IO.File]::OpenRead($TmpArchive)
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  $Bytes = $Hasher.ComputeHash($Stream)
  $Stream.Close()
  $GotSha = [BitConverter]::ToString($Bytes) -replace '-', ''
  $GotSha = $GotSha.ToUpperInvariant()

  if ($GotSha -ne $ExpectedSha) {
    throw "SHA256 mismatch — archive corrupted or tampered"
  }

  # ---------------------------------------------------------------------------
  # Install
  # ---------------------------------------------------------------------------
  $InstallBase = $env:LOCALAPPDATA
  if ([string]::IsNullOrEmpty($InstallBase)) { $InstallBase = "$env:USERPROFILE\AppData\Local" }
  $InstallDir = Join-Path $InstallBase "seevee\v${Version}"

  Write-Host "Installing to ${InstallDir}..."
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

  Expand-Archive -Path $TmpArchive -DestinationPath $InstallDir -Force
  $BundleDir = Join-Path $InstallDir $Platform

  # ---------------------------------------------------------------------------
  # Stable launcher
  # ---------------------------------------------------------------------------
  $LauncherDir = $env:LOCALAPPDATA
  if ([string]::IsNullOrEmpty($LauncherDir)) { $LauncherDir = "$env:USERPROFILE\AppData\Local" }
  $LauncherDir = Join-Path $LauncherDir "seevee"
  $Launcher = Join-Path $LauncherDir "seevee.cmd"

  New-Item -ItemType Directory -Path $LauncherDir -Force | Out-Null

  $LauncherBody = @"
@echo off
setlocal
set "SEEVEE_ROOT=$BundleDir"
set "SEEVEE_VERSION=$Version"
set "NODE_PATH=$BundleDir\runtime\node_modules"
node "$BundleDir\runtime\cli\dist\cli.js" %*
"@
  [System.IO.File]::WriteAllText($Launcher, $LauncherBody, [System.Text.Encoding]::ASCII)

  if (-not (Test-Path $Launcher)) {
    throw "Launcher not found after install: $Launcher"
  }

  # ---------------------------------------------------------------------------
  # Verify
  # ---------------------------------------------------------------------------
  $ver = & $Launcher --version 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Installation verification failed: $ver" }

  # ---------------------------------------------------------------------------
  # PATH hint
  # ---------------------------------------------------------------------------
  $UserPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if ($UserPath -notlike "*$LauncherDir*") {
    $NewPath = "$LauncherDir;$UserPath"
    [System.Environment]::SetEnvironmentVariable('Path', $NewPath, 'User')
    Write-Host ""
    Write-Host "Installed. Added to user PATH: $LauncherDir"
    Write-Host "Restart your terminal or run: refreshenv  (if using Windows Terminal/Posh)"
  }

  Write-Host "Seevee v${Version} installed successfully."
}
finally {
  Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

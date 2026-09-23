# Seevee installer for Windows PowerShell 5.1+ and PowerShell 7+.
# Usage: irm https://raw.githubusercontent.com/DrB0rk/seevee/main/install.ps1 | iex
param(
  [string]$Version = ""
)

$ErrorActionPreference = 'Stop'
$Repository = 'DrB0rk/seevee'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

function Write-Step([string]$Message) {
  Write-Host "◆ " -NoNewline -ForegroundColor Cyan
  Write-Host $Message
}

function Write-Success([string]$Message) {
  Write-Host "✓ " -NoNewline -ForegroundColor Green
  Write-Host $Message
}

function Download-File([string]$Uri, [string]$Path, [string]$Activity) {
  $Client = [System.Net.Http.HttpClient]::new()
  $Client.Timeout = [TimeSpan]::FromMinutes(5)
  $Response = $null
  $InputStream = $null
  $OutputStream = $null
  try {
    $Response = $Client.GetAsync(
      $Uri,
      [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
    ).GetAwaiter().GetResult()
    $Response.EnsureSuccessStatusCode() | Out-Null
    $Total = $Response.Content.Headers.ContentLength
    $InputStream = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $OutputStream = [System.IO.File]::Create($Path)
    $Buffer = New-Object byte[] 65536
    [long]$Downloaded = 0

    while (($Read = $InputStream.ReadAsync($Buffer, 0, $Buffer.Length).GetAwaiter().GetResult()) -gt 0) {
      $OutputStream.Write($Buffer, 0, $Read)
      $Downloaded += $Read
      $DownloadedMb = [math]::Round($Downloaded / 1MB, 1)
      if ($Total -and $Total -gt 0) {
        $Percent = [int](100 * $Downloaded / $Total)
        $TotalMb = [math]::Round($Total / 1MB, 1)
        Write-Progress -Activity $Activity -Status "$DownloadedMb of $TotalMb MB" -PercentComplete $Percent
      } else {
        Write-Progress -Activity $Activity -Status "$DownloadedMb MB downloaded"
      }
    }
  } finally {
    Write-Progress -Activity $Activity -Completed
    if ($OutputStream) { $OutputStream.Dispose() }
    if ($InputStream) { $InputStream.Dispose() }
    if ($Response) { $Response.Dispose() }
    $Client.Dispose()
  }
}

Write-Host ""
Write-Host '  SEE VEE' -ForegroundColor Cyan -NoNewline
Write-Host '  Local CV studio installer' -ForegroundColor DarkGray
Write-Host ""

Write-Step 'Checking system requirements'
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) { throw 'Node.js 20 or newer is required. Install Node.js, then run this installer again.' }
$NodeVersion = (& node -p 'Number(process.versions.node.split(".")[0])').Trim()
if ([int]$NodeVersion -lt 20) { throw "Node.js 20 or newer is required (found $(& node --version))." }

$Arch = $env:PROCESSOR_ARCHITECTURE
if ($Arch -eq 'AMD64') { $Platform = 'windows-x64' }
else { throw "Unsupported architecture: $Arch. Seevee currently provides a Windows x64 build." }
$ArchiveName = "seevee-$Platform.zip"
Write-Success "$Platform · $(& node --version)"

Write-Step 'Finding a release'
if ([string]::IsNullOrWhiteSpace($Version) -or $Version -eq 'latest') {
  $Releases = @(Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases?per_page=1" -TimeoutSec 15)
  if ($Releases.Count -gt 0) { $Version = [string]$Releases[0].tag_name }
}
$Version = $Version -replace '^v', ''
if ([string]::IsNullOrWhiteSpace($Version)) { throw 'Could not resolve a GitHub Release. Specify -Version to choose one.' }
if ($Version -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid release version: $Version" }
Write-Success "Seevee v$Version"
$ReleaseUrl = "https://github.com/$Repository/releases/download/v$Version"

$TempRoot = [System.IO.Path]::GetTempPath()
$TempDir = Join-Path $TempRoot ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $TempDir | Out-Null
$TempArchive = Join-Path $TempDir $ArchiveName
$TempSums = Join-Path $TempDir 'SHA256SUMS'

try {
  Write-Step 'Downloading release bundle'
  Download-File "$ReleaseUrl/$ArchiveName" $TempArchive "Downloading Seevee v$Version"
  Write-Success 'Bundle downloaded'

  Write-Step 'Checking SHA-256 checksum'
  Download-File "$ReleaseUrl/SHA256SUMS" $TempSums 'Downloading checksum manifest'
  $ChecksumLine = Get-Content $TempSums | Where-Object { $_ -match "\s+$([regex]::Escape($ArchiveName))$" } | Select-Object -First 1
  if (-not $ChecksumLine) { throw "SHA256SUMS has no entry for $ArchiveName." }
  $ExpectedSha = ($ChecksumLine.Trim() -split '\s+')[0].ToUpperInvariant()
  $ActualSha = (Get-FileHash -Path $TempArchive -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($ActualSha -ne $ExpectedSha) { throw 'Checksum verification failed; the archive may be incomplete or altered.' }
  Write-Success 'Checksum verified'

  $InstallBase = $env:LOCALAPPDATA
  if ([string]::IsNullOrWhiteSpace($InstallBase)) { $InstallBase = Join-Path $env:USERPROFILE 'AppData\Local' }
  $LauncherDir = Join-Path $InstallBase 'seevee'
  $InstallDir = Join-Path $LauncherDir "v$Version"
  $BundleDirName = "seevee-$Platform"
  $BundleDir = Join-Path $InstallDir $BundleDirName
  $StageDir = Join-Path $TempDir 'unpacked'

  Write-Step 'Unpacking and installing'
  New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
  Expand-Archive -Path $TempArchive -DestinationPath $StageDir -Force
  $StagedBundle = Join-Path $StageDir $BundleDirName
  $BundledVersion = (Get-Content (Join-Path $StagedBundle 'VERSION') -Raw).Trim()
  if ($BundledVersion -ne $Version) { throw "Bundle version mismatch: expected $Version, found $BundledVersion." }
  if (-not (Test-Path (Join-Path $StagedBundle 'bin\seevee.cmd'))) { throw 'The Windows launcher is missing from the release bundle.' }
  if (-not (Test-Path (Join-Path $StagedBundle 'runtime\cli\dist\cli.js'))) { throw 'The Seevee CLI is missing from the release bundle.' }

  New-Item -ItemType Directory -Path $LauncherDir -Force | Out-Null
  $BackupDir = "$InstallDir.backup-$PID"
  if (Test-Path $BackupDir) { Remove-Item $BackupDir -Recurse -Force }
  if (Test-Path $InstallDir) { Move-Item -Path $InstallDir -Destination $BackupDir }
  try {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Move-Item -Path $StagedBundle -Destination $BundleDir
  } catch {
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    if (Test-Path $BackupDir) { Move-Item -Path $BackupDir -Destination $InstallDir }
    throw
  }
  if (Test-Path $BackupDir) { Remove-Item $BackupDir -Recurse -Force }

  $CliEntry = Join-Path $BundleDir 'runtime\cli\dist\cli.js'
  $env:SEEVEE_VERSION = $Version
  $VersionOutput = & node $CliEntry --version 2>&1
  if ($LASTEXITCODE -ne 0 -or ($VersionOutput -join "`n") -notmatch [regex]::Escape($Version)) {
    throw "The installed CLI did not pass its version check: $($VersionOutput -join ' ')"
  }

  $Launcher = Join-Path $LauncherDir 'seevee.cmd'
  $LauncherBody = @"
@echo off
setlocal
set "SEEVEE_ROOT=%~dp0v$Version\$BundleDirName"
set "SEEVEE_VERSION=$Version"
set "NODE_PATH=%SEEVEE_ROOT%\runtime\node_modules"
node "%SEEVEE_ROOT%\runtime\cli\dist\cli.js" %*
"@
  [System.IO.File]::WriteAllText($Launcher, $LauncherBody, [System.Text.Encoding]::ASCII)

  $UserPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if ($UserPath -notlike "*$LauncherDir*") {
    $NewPath = if ([string]::IsNullOrWhiteSpace($UserPath)) { $LauncherDir } else { "$LauncherDir;$UserPath" }
    [System.Environment]::SetEnvironmentVariable('Path', $NewPath, 'User')
    Write-Host "Added $LauncherDir to your user PATH. Open a new terminal to use it."
  }

  Write-Success "Seevee v$Version is ready"
  Write-Host ""
  Write-Host 'Next step' -ForegroundColor Cyan -NoNewline
  Write-Host '  Run seevee init in a workspace directory.'
} catch {
  throw "Seevee install failed: $($_.Exception.Message) Check the public release page and your network connection."
} finally {
  Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# Seevee installer for Windows PowerShell 5.1+ and PowerShell 7+.
# Usage: irm https://raw.githubusercontent.com/DrB0rk/seevee/main/install.ps1 | iex
param(
  [string]$Version = ""
)

$ErrorActionPreference = 'Stop'
$Repository = 'DrB0rk/seevee'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-ArchiveEntries([string]$Path, [string]$Root) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace('\', '/')
      if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or ($name -ne $Root -and -not $name.StartsWith($Root + '/'))) {
        throw "Unsafe archive entry: $($entry.FullName)"
      }
      $mode = (([uint32]$entry.ExternalAttributes) -shr 16) -band 0xF000
      if ($mode -eq 0xA000) { throw "Archive symlink entries are not allowed: $($entry.FullName)" }
    }
  } finally {
    $archive.Dispose()
  }
}

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
  $Client.DefaultRequestHeaders.UserAgent.ParseAdd('seevee-installer')
  $Response = $null
  $InputStream = $null
  $OutputStream = $null
  try {
    $Response = $Client.GetAsync(
      $Uri,
      [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
    ).GetAwaiter().GetResult()
    $Response.EnsureSuccessStatusCode() | Out-Null
    $FinalUri = $Response.RequestMessage.RequestUri
    if ($null -ne $FinalUri -and $FinalUri.Scheme -ne 'https') { throw "Refusing insecure redirect to $($FinalUri.Scheme)://." }
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
  $ApiBase = "https://api.github.com/repos/$Repository"
  $Headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'seevee-installer' }
  try {
    $Release = Invoke-RestMethod -Uri "$ApiBase/releases/latest" -Headers $Headers -TimeoutSec 15 -ErrorAction Stop
    $Version = [string]$Release.tag_name
  } catch {
    $Releases = @(Invoke-RestMethod -Uri "$ApiBase/releases?per_page=20" -Headers $Headers -TimeoutSec 15 -ErrorAction Stop)
    $Release = $Releases | Where-Object { -not $_.draft } | Select-Object -First 1
    if ($null -eq $Release) { throw 'Could not resolve a public Seevee release. Specify -Version to choose one.' }
    $Version = [string]$Release.tag_name
  }
}
$Version = $Version -replace '^v', ''
if ([string]::IsNullOrWhiteSpace($Version)) { throw 'Could not resolve a GitHub Release. Specify -Version to choose one.' }
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') { throw "Invalid release version: $Version" }
Write-Success "Seevee v$Version"
$ReleaseUrl = "https://github.com/$Repository/releases/download/v$Version"

$TempRoot = [System.IO.Path]::GetTempPath()
$TempDir = $null
for ($Attempt = 0; $Attempt -lt 5 -and $null -eq $TempDir; $Attempt++) {
  $Candidate = Join-Path $TempRoot ([System.IO.Path]::GetRandomFileName())
  try {
    New-Item -ItemType Directory -Path $Candidate -ErrorAction Stop | Out-Null
    $TempDir = $Candidate
  } catch {
    $TempDir = $null
  }
}
if ($null -eq $TempDir) { throw 'Could not create a private temporary directory.' }
$LockDir = $null
$LauncherTemp = $null
$LockAcquired = $false
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
  New-Item -ItemType Directory -Path $LauncherDir -Force -ErrorAction Stop | Out-Null
  $LockDir = Join-Path $LauncherDir '.install.lock'
  New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
  $LockAcquired = $true
  $InstallDir = Join-Path $LauncherDir "v$Version"
  $BundleDirName = "seevee-$Platform"
  Assert-ArchiveEntries $TempArchive $BundleDirName
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
  if (-not (Test-Path (Join-Path $StagedBundle 'runtime\studio\dist\server\entry.mjs'))) { throw 'The dashboard server is missing from the release bundle.' }
  if (-not (Test-Path (Join-Path $StagedBundle 'runtime\agent-runtime\dist\index.js'))) { throw 'The agent runtime is missing from the release bundle.' }
  if (-not (Test-Path (Join-Path $StagedBundle 'runtime\agent\seevee-workspace-agent\SKILL.md'))) { throw 'The workspace-agent guide is missing from the release bundle.' }
  if (-not (Test-Path (Join-Path $StagedBundle 'runtime\agent\seevee-workspace-agent\references\workflows.md'))) { throw 'The agent workflow instructions are missing from the release bundle.' }
  if (-not (Test-Path (Join-Path $StagedBundle 'runtime\templates\classic\v1\template.json'))) { throw 'The default Classic CV template is missing from the release bundle.' }
  if (-not (Test-Path (Join-Path $StagedBundle 'runtime\templates\classic\v1\src\Resume.astro'))) { throw 'The Classic template source is missing from the release bundle.' }

  Write-Step 'Checking the staged command'
  $PreviousSeeveeVersion = $env:SEEVEE_VERSION
  $PreviousNodePath = $env:NODE_PATH
  try {
    $env:SEEVEE_VERSION = $Version
    $env:NODE_PATH = Join-Path $StagedBundle 'runtime\node_modules'
    $StagedVersionOutput = & node (Join-Path $StagedBundle 'runtime\cli\dist\cli.js') --version 2>&1
    $StagedVersionText = $StagedVersionOutput -join "`n"
    if ($LASTEXITCODE -ne 0 -or $StagedVersionText -notmatch ('"cli"\s*:\s*"' + [regex]::Escape($Version) + '"')) {
      throw "The downloaded Seevee command did not pass its version check: $StagedVersionText"
    }
  } finally {
    $env:SEEVEE_VERSION = $PreviousSeeveeVersion
    $env:NODE_PATH = $PreviousNodePath
  }
  Write-Success 'Staged command is ready'

  New-Item -ItemType Directory -Path $LauncherDir -Force | Out-Null
  $BackupDir = "$InstallDir.backup-$PID"
  $Launcher = Join-Path $LauncherDir 'seevee.cmd'
  $LauncherTemp = Join-Path $LauncherDir ('.seevee-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $LauncherBackup = "$Launcher.backup-$PID"
  $LauncherBody = @"
@echo off
setlocal
set "SEEVEE_ROOT=%~dp0v$Version\$BundleDirName"
set "SEEVEE_VERSION=$Version"
set "NODE_PATH=%SEEVEE_ROOT%\runtime\node_modules"
node "%SEEVEE_ROOT%\runtime\cli\dist\cli.js" %*
"@
  $LauncherBytes = [System.Text.Encoding]::ASCII.GetBytes($LauncherBody)
  $LauncherStream = [System.IO.File]::Open($LauncherTemp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $LauncherStream.Write($LauncherBytes, 0, $LauncherBytes.Length) } finally { $LauncherStream.Dispose() }
  if (Test-Path $BackupDir) { Remove-Item $BackupDir -Recurse -Force }
  if (Test-Path $LauncherBackup) { Remove-Item $LauncherBackup -Force }
  $InstallDirTouched = $false
  $LauncherTouched = $false
  try {
    if (Test-Path $InstallDir) {
      Move-Item -Path $InstallDir -Destination $BackupDir
      $InstallDirTouched = $true
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $InstallDirTouched = $true
    Move-Item -Path $StagedBundle -Destination $BundleDir
    if (Test-Path $Launcher) { Move-Item -Path $Launcher -Destination $LauncherBackup }
    $LauncherTouched = $true
    Move-Item -Path $LauncherTemp -Destination $Launcher

    Write-Step 'Checking the installed command'
    $VersionOutput = & $Launcher --version 2>&1
    $VersionText = $VersionOutput -join "`n"
    if ($LASTEXITCODE -ne 0 -or $VersionText -notmatch ('"cli"\s*:\s*"' + [regex]::Escape($Version) + '"')) {
      throw "The installed command did not pass its version check: $VersionText"
    }
  } catch {
    if ($LauncherTouched -and (Test-Path $Launcher)) { Remove-Item $Launcher -Force }
    if (Test-Path $LauncherBackup) { Move-Item -Path $LauncherBackup -Destination $Launcher }
    if ($InstallDirTouched -and (Test-Path $InstallDir)) { Remove-Item $InstallDir -Recurse -Force }
    if (Test-Path $BackupDir) { Move-Item -Path $BackupDir -Destination $InstallDir }
    if (Test-Path $LauncherTemp) { Remove-Item $LauncherTemp -Force }
    throw
  }
  if (Test-Path $BackupDir) { Remove-Item $BackupDir -Recurse -Force }
  if (Test-Path $LauncherBackup) { Remove-Item $LauncherBackup -Force }
  Get-ChildItem -LiteralPath $LauncherDir -Directory -Filter 'v*' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -ne $InstallDir } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  $UserPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $PathEntries = @($UserPath -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($PathEntries -notcontains $LauncherDir) {
    $NewPath = if ([string]::IsNullOrWhiteSpace($UserPath)) { $LauncherDir } else { "$LauncherDir;$UserPath" }
    [System.Environment]::SetEnvironmentVariable('Path', $NewPath, 'User')
    Write-Host "Added $LauncherDir to your user PATH. Open a new terminal to use it."
  }

  Write-Success "Seevee v$Version is ready"
  Write-Host ""
  Write-Host 'Next step' -ForegroundColor Cyan -NoNewline
  Write-Host '  Run seevee init in a workspace directory.'
} catch {
  if ($null -ne $LauncherTemp -and (Test-Path $LauncherTemp)) { Remove-Item $LauncherTemp -Force -ErrorAction SilentlyContinue }
  throw "Seevee install failed: $($_.Exception.Message) Check the public release page and your network connection."
} finally {
  if ($LockAcquired -and $null -ne $LockDir) { Remove-Item $LockDir -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

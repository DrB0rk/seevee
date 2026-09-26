#!/usr/bin/env sh
# Install Seevee from a GitHub Release.
# Usage: curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh
set -eu

REPOSITORY="DrB0rk/seevee"
VERSION=""

usage() {
  cat <<'EOF'
Seevee installer

Usage:
  install.sh [--version VERSION]
  curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh

Options:
  --version VERSION  Install a specific release (v prefix optional)
  -h, --help         Show this help

Environment:
  SEEVE_INSTALL_DIR  Install root (default: ~/.local/share/seevee)
  SEEVE_BIN_DIR      Launcher directory (default: ~/.local/bin)
  NO_COLOR           Disable colored status output
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || { echo "error: --version needs a value" >&2; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  RESET='\033[0m'
  CYAN='\033[36m'
  GREEN='\033[32m'
  RED='\033[31m'
  DIM='\033[2m'
else
  RESET=''
  CYAN=''
  GREEN=''
  RED=''
  DIM=''
fi

step() { printf '%b◆%b %s\n' "$CYAN" "$RESET" "$1" >&2; }
success() { printf '%b✓%b %s\n' "$GREEN" "$RESET" "$1" >&2; }
fail() { printf '%berror:%b %s\n' "$RED" "$RESET" "$1" >&2; exit "${2:-1}"; }

curl_secure() {
  curl --fail --location --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 600 \
    --proto '=https' --proto-redir '=https' "$@"
}

printf '\n%b  SEE VEE%b  %bLocal CV studio installer%b\n\n' "$CYAN" "$RESET" "$DIM" "$RESET" >&2

step 'Checking system requirements'
command -v curl >/dev/null 2>&1 || fail 'curl is required.'
command -v tar >/dev/null 2>&1 || fail 'tar is required.'
command -v node >/dev/null 2>&1 || fail 'Node.js 20 or newer is required. Install Node.js, then run this installer again.'
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20 or newer is required (found $(node --version 2>/dev/null || echo unknown))."

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH='x64' ;;
  aarch64|arm64) ARCH='arm64' ;;
  *) fail "Unsupported architecture: $ARCH" ;;
esac
case "$OS" in
  linux) PLATFORM="linux-$ARCH" ;;
  darwin) PLATFORM="darwin-$ARCH" ;;
  mingw*|msys*|cygwin*) fail 'Use install.ps1 on Windows.' ;;
  *) fail "Unsupported operating system: $OS" ;;
esac
success "${PLATFORM} · Node $(node --version)"

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t seevee)"
STAGE_DIR=''
DOWNLOAD_PIDS=''
DOWNLOAD_PROGRESS_PID=''
LOCK_DIR=''
OLD_DIR=''
LAUNCHER_OLD=''
INSTALL_DIR=''
LAUNCHER=''
LAUNCHER_TMP=''
INSTALL_COMMITTED=0
cleanup() {
  for pid in $DOWNLOAD_PIDS ${DOWNLOAD_PROGRESS_PID:-}; do
    kill "$pid" 2>/dev/null || true
  done
  if [ "$INSTALL_COMMITTED" -eq 0 ] && [ -n "$OLD_DIR" ] && [ -e "$OLD_DIR" ]; then
    [ -z "$INSTALL_DIR" ] || rm -rf "$INSTALL_DIR"
    mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true
  fi
  if [ "$INSTALL_COMMITTED" -eq 0 ] && [ -n "$LAUNCHER_OLD" ] && { [ -e "$LAUNCHER_OLD" ] || [ -L "$LAUNCHER_OLD" ]; }; then
    [ -z "$LAUNCHER" ] || rm -f "$LAUNCHER"
    mv "$LAUNCHER_OLD" "$LAUNCHER" 2>/dev/null || true
  fi
  [ -z "$LOCK_DIR" ] || rmdir "$LOCK_DIR" 2>/dev/null || true
  [ -z "$LAUNCHER_TMP" ] || rm -f "$LAUNCHER_TMP"
  rm -rf "$TMP_DIR"
  [ -z "$STAGE_DIR" ] || rm -rf "$STAGE_DIR"
}
trap cleanup EXIT HUP INT TERM

step 'Finding a release'
if [ -z "$VERSION" ] || [ "$VERSION" = 'latest' ]; then
  RELEASE_JSON="$TMP_DIR/release.json"
  RELEASE_API="https://api.github.com/repos/${REPOSITORY}"
  curl_secure --silent \
    --header 'Accept: application/vnd.github+json' \
    --header 'User-Agent: seevee-installer' \
    "$RELEASE_API/releases?per_page=20" -o "$RELEASE_JSON" \
    || fail 'Could not look up a public Seevee release.'
  VERSION="$(node -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const releases = Array.isArray(data) ? data.filter((item) => !item.draft) : [];
    const release = releases.find((item) => !item.prerelease) ?? releases[0];
    if (typeof release?.tag_name !== "string") process.exit(1);
    process.stdout.write(release.tag_name.replace(/^v/, ""));
  ' "$RELEASE_JSON")" || fail 'GitHub returned no usable Seevee release.'
fi
VERSION="${VERSION#v}"
case "$VERSION" in
  ''|*[!A-Za-z0-9._-]*) fail "Invalid release version: $VERSION" 2 ;;
esac
ARCHIVE="seevee-${PLATFORM}.tar.gz"
RELEASE_URL="https://github.com/${REPOSITORY}/releases/download/v${VERSION}"
success "Seevee v${VERSION}"

curl_download() {
  if [ -t 2 ]; then
    curl_secure --progress-bar "$@"
  else
    curl_secure --silent --show-error "$@"
  fi
}

download_asset() {
  asset_name="$1"
  output_path="$2"
  curl_download "$RELEASE_URL/$asset_name" -o "$output_path"
}

download_bundle() {
  asset_url="$RELEASE_URL/$ARCHIVE"
  output_path="$TMP_DIR/$ARCHIVE"
  part_count=8
  headers="$TMP_DIR/range-headers"
  probe="$TMP_DIR/range-probe"

  # GitHub release assets support byte ranges. Parallel requests avoid a slow
  # single connection on networks that throttle each connection separately.
  if ! curl_secure --silent --show-error \
    --range 0-0 --dump-header "$headers" "$asset_url" -o "$probe" 2>/dev/null; then
    curl_download "$asset_url" -o "$output_path"
    return
  fi
  file_size="$(awk 'tolower($1) == "content-range:" { gsub(/\r/, "", $3); split($3, range, "/"); if (range[2] ~ /^[0-9]+$/) size=range[2] } END { print size }' "$headers")"
  if [ -z "$file_size" ] || [ "$(wc -c < "$probe" | tr -d ' ')" -ne 1 ]; then
    curl_download "$asset_url" -o "$output_path"
    return
  fi

  chunk_size=$(((file_size + part_count - 1) / part_count))
  part=0
  while [ "$part" -lt "$part_count" ]; do
    range_start=$((part * chunk_size))
    [ "$range_start" -lt "$file_size" ] || break
    range_end=$((range_start + chunk_size - 1))
    [ "$range_end" -lt "$file_size" ] || range_end=$((file_size - 1))
    part_file="$TMP_DIR/$ARCHIVE.part.$part"
    part_error="$TMP_DIR/$ARCHIVE.part.$part.err"
    curl_secure --silent --show-error \
      --range "$range_start-$range_end" "$asset_url" -o "$part_file" 2>"$part_error" &
    DOWNLOAD_PIDS="$DOWNLOAD_PIDS $!"
    part=$((part + 1))
  done

  if [ -t 2 ]; then
    (
      while :; do
        received=0
        part=0
        while [ "$part" -lt "$part_count" ]; do
          part_file="$TMP_DIR/$ARCHIVE.part.$part"
          if [ -f "$part_file" ]; then
            received=$((received + $(wc -c < "$part_file" | tr -d ' ')))
          fi
          part=$((part + 1))
        done
        percent=$((received * 100 / file_size))
        [ "$percent" -le 100 ] || percent=100
        printf '\r  Downloading bundle · %3s%% (%s/%s MiB)' "$percent" "$((received / 1048576))" "$(((file_size + 1048575) / 1048576))" >&2
        active=0
        for pid in $DOWNLOAD_PIDS; do
          if kill -0 "$pid" 2>/dev/null; then active=1; break; fi
        done
        [ "$active" -eq 1 ] || break
        sleep 1
      done
      printf '\n' >&2
    ) &
    DOWNLOAD_PROGRESS_PID=$!
  fi

  failed=0
  for pid in $DOWNLOAD_PIDS; do
    wait "$pid" || failed=1
  done
  if [ -n "$DOWNLOAD_PROGRESS_PID" ]; then
    wait "$DOWNLOAD_PROGRESS_PID" 2>/dev/null || true
    DOWNLOAD_PROGRESS_PID=''
  fi
  if [ "$failed" -ne 0 ]; then
    cat "$TMP_DIR"/"$ARCHIVE".part.*.err >&2
    fail 'A release bundle download range failed. Please retry the installer.'
  fi

  : > "$output_path"
  part=0
  while [ "$part" -lt "$part_count" ]; do
    range_start=$((part * chunk_size))
    [ "$range_start" -lt "$file_size" ] || break
    range_end=$((range_start + chunk_size - 1))
    [ "$range_end" -lt "$file_size" ] || range_end=$((file_size - 1))
    part_file="$TMP_DIR/$ARCHIVE.part.$part"
    expected_size=$((range_end - range_start + 1))
    actual_size="$(wc -c < "$part_file" | tr -d ' ')"
    [ "$actual_size" -eq "$expected_size" ] || fail "Release download range $((part + 1)) was incomplete; please retry the installer."
    cat "$part_file" >> "$output_path"
    part=$((part + 1))
  done
  DOWNLOAD_PIDS=''
}

step 'Downloading release bundle'
download_bundle \
  || fail "Could not download $ARCHIVE. Check that the public release v${VERSION} includes this platform bundle."
success 'Bundle downloaded'

validate_archive() {
  archive_path="$1"
  members_path="$TMP_DIR/archive-members"
  details_path="$TMP_DIR/archive-details"
  tar -tzf "$archive_path" > "$members_path" 2>/dev/null || fail 'Could not inspect the release archive.'
  tar -tvzf "$archive_path" > "$details_path" 2>/dev/null || fail 'Could not inspect the release archive.'
  node - "$members_path" "$details_path" "seevee-${PLATFORM}" <<'NODE' \
    || fail 'The release archive contains an unsafe path or link.'
const fs = require('node:fs');
const path = require('node:path');
const [membersPath, detailsPath, root] = process.argv.slice(2);
const members = fs.readFileSync(membersPath, 'utf8').split(/\r?\n/).filter(Boolean);
if (members.length === 0) process.exit(1);
for (const member of members) {
  const normalized = path.posix.normalize(member);
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) process.exit(1);
  if (normalized !== root && !normalized.startsWith(`${root}/`)) process.exit(1);
}
for (const line of fs.readFileSync(detailsPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
  if (/^h/.test(line)) process.exit(1);
  if (!/^l/.test(line)) continue;
  const match = line.match(/^(.*)\s->\s(.*)$/);
  if (!match) process.exit(1);
  const entry = match[1].trim().split(/\s+/).pop();
  const target = match[2];
  if (path.posix.isAbsolute(target)) process.exit(1);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry), target));
  if (resolved === root || !resolved.startsWith(`${root}/`)) process.exit(1);
}
NODE
}


step 'Checking SHA-256 checksum'
download_asset 'SHA256SUMS' "$TMP_DIR/SHA256SUMS" \
  || fail "Could not download SHA256SUMS from release v${VERSION}."
EXPECTED_SHA="$(awk -v f="$ARCHIVE" '$2 == f || $2 == "*" f { print toupper($1); exit }' "$TMP_DIR/SHA256SUMS")"
[ -n "$EXPECTED_SHA" ] || fail "No checksum found for $ARCHIVE."
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "$TMP_DIR/$ARCHIVE" | awk '{print toupper($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "$TMP_DIR/$ARCHIVE" | awk '{print toupper($1)}')"
else
  fail 'sha256sum or shasum is required to verify the download.'
fi
[ "$EXPECTED_SHA" = "$ACTUAL_SHA" ] || fail 'Checksum verification failed; the archive may be incomplete or altered.'
success 'Checksum verified'
validate_archive "$TMP_DIR/$ARCHIVE"

[ -n "${HOME:-}" ] || [ -n "${XDG_DATA_HOME:-}" ] || fail 'HOME or XDG_DATA_HOME must be set for installation.'
DATA_ROOT="${SEEVE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/seevee}"
BIN_DIR="${SEEVE_BIN_DIR:-$HOME/.local/bin}"
case "$DATA_ROOT" in /*) ;; *) fail 'SEEVE_INSTALL_DIR must be an absolute path.' 2 ;; esac
case "$BIN_DIR" in /*) ;; *) fail 'SEEVE_BIN_DIR must be an absolute path.' 2 ;; esac
INSTALL_DIR="$DATA_ROOT/v${VERSION}"
STAGE_DIR="$DATA_ROOT/.install-v${VERSION}-$$"
LAUNCHER="$BIN_DIR/seevee"

step 'Installing Seevee'
mkdir -p "$DATA_ROOT" "$BIN_DIR"

LOCK_DIR="$DATA_ROOT/.install.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_DIR=''
  fail 'Another Seevee installation is already in progress.'
fi
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
TAR_EXTRACT_FLAGS=''
if tar --help 2>&1 | grep -q -- '--no-same-owner'; then
  TAR_EXTRACT_FLAGS='--no-same-owner --no-same-permissions'
fi
step 'Unpacking release bundle'
# shellcheck disable=SC2086
tar $TAR_EXTRACT_FLAGS -xzf "$TMP_DIR/$ARCHIVE" -C "$STAGE_DIR" || fail 'Could not unpack the release archive.'
BUNDLE_DIR="$STAGE_DIR/seevee-${PLATFORM}"
step 'Inspecting release archive'
[ -f "$BUNDLE_DIR/VERSION" ] || fail 'The bundle is missing its VERSION file.'
[ "$(cat "$BUNDLE_DIR/VERSION")" = "$VERSION" ] || fail 'Bundle version does not match the requested release.'
[ -x "$BUNDLE_DIR/bin/seevee" ] || fail 'The bundle launcher is missing or not executable.'
[ -f "$BUNDLE_DIR/runtime/cli/dist/cli.js" ] || fail 'The bundle is missing the Seevee CLI.'
[ -f "$BUNDLE_DIR/runtime/studio/dist/server/entry.mjs" ] || fail 'The bundle is missing the dashboard server.'
[ -f "$BUNDLE_DIR/runtime/agent-runtime/dist/index.js" ] || fail 'The bundle is missing the agent runtime.'
[ -f "$BUNDLE_DIR/runtime/template-sdk/dist/index.js" ] || fail 'The bundle is missing the template SDK.'
[ -f "$BUNDLE_DIR/runtime/renderer/dist/index.js" ] || fail 'The bundle is missing the renderer.'
[ -f "$BUNDLE_DIR/runtime/template-compiler/dist/index.js" ] || fail 'The bundle is missing the template compiler.'
[ -f "$BUNDLE_DIR/runtime/agent/seevee-workspace-agent/SKILL.md" ] || fail 'The bundle is missing the workspace-agent guide.'
[ -f "$BUNDLE_DIR/runtime/agent/seevee-workspace-agent/references/workflows.md" ] || fail 'The bundle is missing the agent workflow instructions.'
[ -f "$BUNDLE_DIR/runtime/templates/classic/v1/template.json" ] || fail 'The bundle is missing the default Classic CV template.'
[ -f "$BUNDLE_DIR/runtime/templates/classic/v1/src/Resume.astro" ] || fail 'The bundle is missing the Classic template source.'
success 'Release archive contents verified'

step 'Checking the staged command'
if ! VERSION_OUTPUT="$("$BUNDLE_DIR/bin/seevee" --version 2>&1)"; then
  printf '%s\n' "$VERSION_OUTPUT" >&2
  fail 'The downloaded Seevee command did not start.'
fi
case "$VERSION_OUTPUT" in
  *"\"cli\": \"$VERSION\""*) success 'Staged command is ready' ;;
  *) printf '%s\n' "$VERSION_OUTPUT" >&2; fail 'The staged command reported an unexpected version.' ;;
esac

shell_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}
TARGET="$(shell_quote "$INSTALL_DIR/bin/seevee")"
LAUNCHER_TMP="$(mktemp "$BIN_DIR/.seevee.XXXXXX")" || fail 'Could not create a temporary launcher.'
printf '#!/usr/bin/env sh\nexec %s "$@"\n' "$TARGET" > "$LAUNCHER_TMP"
chmod +x "$LAUNCHER_TMP"

OLD_DIR="$DATA_ROOT/.old-v${VERSION}-$$"
LAUNCHER_OLD="$BIN_DIR/.seevee-old-$$"
if [ -e "$INSTALL_DIR" ]; then
  mv "$INSTALL_DIR" "$OLD_DIR" || fail 'Could not prepare the existing installation for update.'
fi
if ! mv "$BUNDLE_DIR" "$INSTALL_DIR"; then
  if [ -e "$OLD_DIR" ]; then mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true; fi
  fail 'Could not place the application files.'
fi
if [ -e "$LAUNCHER" ] || [ -L "$LAUNCHER" ]; then
  if ! mv "$LAUNCHER" "$LAUNCHER_OLD"; then
    rm -rf "$INSTALL_DIR"
    if [ -e "$OLD_DIR" ]; then mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true; fi
    fail 'Could not prepare the existing Seevee command for update.'
  fi
fi
if ! mv "$LAUNCHER_TMP" "$LAUNCHER"; then
  if [ -e "$LAUNCHER_OLD" ] || [ -L "$LAUNCHER_OLD" ]; then mv "$LAUNCHER_OLD" "$LAUNCHER" 2>/dev/null || true; fi
  rm -rf "$INSTALL_DIR"
  if [ -e "$OLD_DIR" ]; then mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true; fi
  fail 'Could not activate the installed Seevee command.'
fi

step 'Checking the installed command'
if ! VERSION_OUTPUT="$("$LAUNCHER" --version 2>&1)"; then
  printf '%s\n' "$VERSION_OUTPUT" >&2
  mv "$LAUNCHER" "$LAUNCHER_TMP" 2>/dev/null || true
  if [ -e "$LAUNCHER_OLD" ] || [ -L "$LAUNCHER_OLD" ]; then mv "$LAUNCHER_OLD" "$LAUNCHER" 2>/dev/null || true; fi
  rm -rf "$INSTALL_DIR"
  if [ -e "$OLD_DIR" ]; then mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true; fi
  fail 'The installed command did not start. Check that Node.js 20+ is on PATH.'
fi
case "$VERSION_OUTPUT" in
  *"\"cli\": \"$VERSION\""*) success "Seevee v${VERSION} is ready" ;;
  *)
    printf '%s\n' "$VERSION_OUTPUT" >&2
    mv "$LAUNCHER" "$LAUNCHER_TMP" 2>/dev/null || true
    if [ -e "$LAUNCHER_OLD" ] || [ -L "$LAUNCHER_OLD" ]; then mv "$LAUNCHER_OLD" "$LAUNCHER" 2>/dev/null || true; fi
    rm -rf "$INSTALL_DIR"
    if [ -e "$OLD_DIR" ]; then mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true; fi
    fail 'The installed command reported an unexpected version.'
    ;;
esac
INSTALL_COMMITTED=1
success "Installed Seevee v$VERSION to $INSTALL_DIR"
success "Command available at $LAUNCHER"
rm -rf "$OLD_DIR" "$LAUNCHER_OLD" "$STAGE_DIR" "$LAUNCHER_TMP"
for old_bundle in "$DATA_ROOT"/v*; do
  [ -d "$old_bundle" ] || continue
  [ "$old_bundle" = "$INSTALL_DIR" ] && continue
  rm -rf "$old_bundle"
done

if ! printf '%s' ":${PATH}:" | grep -Fq ":${BIN_DIR}:"; then
  printf '\n%bNext step%b Add Seevee to PATH, then run %bseevee init%b in a workspace:\n  export PATH="%s:$PATH"\n' \
    "$CYAN" "$RESET" "$GREEN" "$RESET" "$BIN_DIR" >&2
else
  printf '\n%bNext step%b Run %bseevee init%b in a workspace directory.\n' \
    "$CYAN" "$RESET" "$GREEN" "$RESET" >&2
fi

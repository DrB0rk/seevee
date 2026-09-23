#!/usr/bin/env sh
# Install Seevee from a GitHub Release.
# Usage: curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh
set -eu

REPOSITORY="DrB0rk/seevee"
VERSION=""
GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

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
GH_NETRC=''
cleanup() {
  rm -rf "$TMP_DIR"
  [ -z "$STAGE_DIR" ] || rm -rf "$STAGE_DIR"
}
trap cleanup EXIT HUP INT TERM

step 'Finding a release'
if [ -z "$GH_TOKEN" ] && command -v gh >/dev/null 2>&1; then
  GH_TOKEN="$(gh auth token --hostname github.com 2>/dev/null || true)"
fi
if [ -n "$GH_TOKEN" ]; then
  GH_NETRC="$TMP_DIR/github.netrc"
  printf 'machine github.com login x-access-token password %s\nmachine api.github.com login x-access-token password %s\n' \
    "$GH_TOKEN" "$GH_TOKEN" > "$GH_NETRC"
  chmod 600 "$GH_NETRC"
  unset GH_TOKEN
fi
if [ -z "$VERSION" ] || [ "$VERSION" = 'latest' ]; then
  if [ -n "$GH_NETRC" ]; then
    VERSION="$(curl --fail --silent --show-error --netrc-file "$GH_NETRC" \
      "https://api.github.com/repos/${REPOSITORY}/releases?per_page=1" \
      | sed -n 's/.*"tag_name": "v\{0,1\}\([^"]*\)".*/\1/p' | head -1)" \
      || fail 'Could not look up the latest release. Check your GitHub credentials.'
  else
    RELEASES_URL="https://api.github.com/repos/${REPOSITORY}/releases?per_page=1"
    VERSION="$(curl -fsSL "$RELEASES_URL" | sed -n 's/.*"tag_name": "v\{0,1\}\([^"]*\)".*/\1/p' | head -1)" \
      || fail 'Could not look up the latest release. For a private repository, authenticate with `gh auth login`.'
  fi
fi
VERSION="${VERSION#v}"
case "$VERSION" in
  ''|*[!A-Za-z0-9._-]*) fail "Invalid release version: $VERSION" 2 ;;
esac
ARCHIVE="seevee-${PLATFORM}.tar.gz"
RELEASE_URL="https://github.com/${REPOSITORY}/releases/download/v${VERSION}"
API_RELEASE_URL="https://api.github.com/repos/${REPOSITORY}/releases/tags/v${VERSION}"
success "Seevee v${VERSION}"

curl_download() {
  if [ -t 2 ]; then
    curl --fail --location --retry 3 --retry-delay 1 --progress-bar "$@"
  else
    curl --fail --location --retry 3 --retry-delay 1 --silent --show-error "$@"
  fi
}

download_asset() {
  asset_name="$1"
  output_path="$2"
  if [ -n "$GH_NETRC" ]; then
    if [ ! -f "$TMP_DIR/release.json" ]; then
      curl --fail --silent --show-error --netrc-file "$GH_NETRC" "$API_RELEASE_URL" \
        -o "$TMP_DIR/release.json" || return 1
    fi
    asset_id="$(node -e 'const release=JSON.parse(require("node:fs").readFileSync(0,"utf8")); const asset=release.assets.find((item)=>item.name===process.argv[1]); if (!asset) process.exit(1); process.stdout.write(String(asset.id));' \
      "$asset_name" < "$TMP_DIR/release.json")" || return 1
    curl_download \
      --netrc-file "$GH_NETRC" -H 'Accept: application/octet-stream' \
      "https://api.github.com/repos/${REPOSITORY}/releases/assets/${asset_id}" \
      -o "$output_path"
  else
    curl_download \
      "$RELEASE_URL/$asset_name" -o "$output_path"
  fi
}

step 'Downloading release bundle'
download_asset "$ARCHIVE" "$TMP_DIR/$ARCHIVE" \
  || fail "Could not download $ARCHIVE. Check GitHub access and the release page; private repositories require 'gh auth login'."
success 'Bundle downloaded'

step 'Checking SHA-256 checksum'
download_asset 'SHA256SUMS' "$TMP_DIR/SHA256SUMS" \
  || fail "Could not download SHA256SUMS. Check GitHub access; private repositories require 'gh auth login'."
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

DATA_ROOT="${SEEVE_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/seevee}"
BIN_DIR="${SEEVE_BIN_DIR:-$HOME/.local/bin}"
INSTALL_DIR="$DATA_ROOT/v${VERSION}"
STAGE_DIR="$DATA_ROOT/.install-v${VERSION}-$$"
LAUNCHER="$BIN_DIR/seevee"

step 'Installing Seevee'
mkdir -p "$DATA_ROOT" "$BIN_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
tar -xzf "$TMP_DIR/$ARCHIVE" -C "$STAGE_DIR" || fail 'Could not unpack the release archive.'
BUNDLE_DIR="$STAGE_DIR/seevee-${PLATFORM}"
[ -f "$BUNDLE_DIR/VERSION" ] || fail 'The bundle is missing its VERSION file.'
[ "$(cat "$BUNDLE_DIR/VERSION")" = "$VERSION" ] || fail 'Bundle version does not match the requested release.'
[ -x "$BUNDLE_DIR/bin/seevee" ] || fail 'The bundle launcher is missing or not executable.'

if [ -e "$INSTALL_DIR" ]; then
  OLD_DIR="$DATA_ROOT/.old-v${VERSION}-$$"
  mv "$INSTALL_DIR" "$OLD_DIR" || fail 'Could not prepare the existing installation for update.'
  if mv "$BUNDLE_DIR" "$INSTALL_DIR"; then
    rm -rf "$OLD_DIR"
  else
    mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true
    fail 'Could not finish installing the new version.'
  fi
else
  mv "$BUNDLE_DIR" "$INSTALL_DIR" || fail 'Could not place the application files.'
fi
rm -rf "$STAGE_DIR"

shell_quote() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}
TARGET="$(shell_quote "$INSTALL_DIR/bin/seevee")"
LAUNCHER_TMP="$BIN_DIR/.seevee-$$"
printf '#!/usr/bin/env sh\nexec %s "$@"\n' "$TARGET" > "$LAUNCHER_TMP"
chmod +x "$LAUNCHER_TMP"
mv "$LAUNCHER_TMP" "$LAUNCHER"

step 'Checking the installed command'
if ! VERSION_OUTPUT="$("$LAUNCHER" --version 2>&1)"; then
  printf '%s\n' "$VERSION_OUTPUT" >&2
  fail 'The installed command did not start. Check that Node.js 20+ is on PATH.'
fi
case "$VERSION_OUTPUT" in
  *"$VERSION"*) success "Seevee v${VERSION} is ready" ;;
  *) printf '%s\n' "$VERSION_OUTPUT" >&2; fail 'The installed command reported an unexpected version.' ;;
esac

if ! printf '%s' ":${PATH}:" | grep -Fq ":${BIN_DIR}:"; then
  printf '\n%bNext step%b Add Seevee to PATH, then run %bseevee init%b in a workspace:\n  export PATH="%s:$PATH"\n' \
    "$CYAN" "$RESET" "$GREEN" "$RESET" "$BIN_DIR" >&2
else
  printf '\n%bNext step%b Run %bseevee init%b in a workspace directory.\n' \
    "$CYAN" "$RESET" "$GREEN" "$RESET" >&2
fi

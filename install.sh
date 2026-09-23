#!/usr/bin/env sh
# install.sh — Seevee self-install
# Usage: curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh
#        curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh -s -- --version 0.2.0
set -e

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --help) echo "usage: $0 [--version <v>]"; exit 0 ;;
    *) shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Detect OS / arch
# ---------------------------------------------------------------------------
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "install.sh: unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

case "$OS" in
  linux) PLATFORM="linux-$ARCH" ;;
  darwin) PLATFORM="darwin-$ARCH" ;;
  mingw*|msys*|cygwin*)
    echo "install.sh: use install.ps1 on Windows" >&2
    exit 1
    ;;
  *)
    echo "install.sh: unsupported OS: $OS" >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Resolve version
# ---------------------------------------------------------------------------
if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/DrB0rk/seevee/releases?per_page=1" 2>/dev/null | \
    sed -n 's/"tag_name": "v\?\([^"]*\)"/\1/p' | head -1)"
fi
VERSION="${VERSION#v}"
case "$VERSION" in
  ""|*[!A-Za-z0-9._-]*)
    echo "install.sh: invalid release version: $VERSION" >&2
    exit 2
    ;;
esac
if [ -z "$VERSION" ]; then
  echo "install.sh: could not resolve latest version" >&2
  exit 1
fi

ARCHIVE="seevee-${PLATFORM}.tar.gz"
DOWNLOAD_URL="https://github.com/DrB0rk/seevee/releases/download/v${VERSION}/${ARCHIVE}"
CHECKSUM_URL="https://github.com/DrB0rk/seevee/releases/download/v${VERSION}/SHA256SUMS"

# ---------------------------------------------------------------------------
# Temp directory — cleaned up on exit
# ---------------------------------------------------------------------------
TMPDIR="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------
echo "Downloading Seevee v${VERSION} for ${PLATFORM}..." >&2
curl -fSL "$DOWNLOAD_URL" -o "$TMPDIR/${ARCHIVE}" 2>/dev/null \
  || { echo "install.sh: archive not found: ${ARCHIVE}" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Verify checksum
# ---------------------------------------------------------------------------
echo "Verifying checksum..." >&2
curl -fsSL "$CHECKSUM_URL" -o "$TMPDIR/SHA256SUMS" 2>/dev/null \
  || { echo "install.sh: SHA256SUMS not found" >&2; exit 1; }

# Compute archive checksum locally
if command -v sha256sum >/dev/null 2>&1; then
  DOWNLOADED_SHA="$(sha256sum "$TMPDIR/${ARCHIVE}" | cut -d' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  DOWNLOADED_SHA="$(shasum -a 256 "$TMPDIR/${ARCHIVE}" | cut -d' ' -f1)"
else
  echo "install.sh: sha256sum or shasum is required" >&2
  exit 1
fi
EXPECTED_SHA="$(grep " ${ARCHIVE}$" "$TMPDIR/SHA256SUMS" | cut -d' ' -f1 | tr '[:lower:]' '[:upper:]')"
DOWNLOADED_UPPER="$(echo "$DOWNLOADED_SHA" | tr '[:lower:]' '[:upper:]')"

if [ "$DOWNLOADED_UPPER" != "$EXPECTED_SHA" ]; then
  echo "install.sh: SHA256 mismatch — archive corrupted or tampered" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/seevee/v${VERSION}"
mkdir -p "$INSTALL_DIR"
echo "Installing to ${INSTALL_DIR}..." >&2

tar -xzf "$TMPDIR/${ARCHIVE}" -C "$INSTALL_DIR" --strip-components=1

# ---------------------------------------------------------------------------
# Stable launcher
# ---------------------------------------------------------------------------
LAUNCHER_DIR="${SEEVE_BIN_DIR:-$HOME/.local/bin}"
LAUNCHER="$LAUNCHER_DIR/seevee"
mkdir -p "$LAUNCHER_DIR"

# Detect if launcher already exists and points to a different version
if [ -f "$LAUNCHER" ]; then
  CURRENT_VERSION="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo "")"
  echo "Replacing existing seevee installation." >&2
fi

# Write launcher script
cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/usr/bin/env sh
# Seevee launcher — managed by install.sh. Do not edit directly.
exec "$INSTALL_DIR/bin/seevee" "\$@"
LAUNCHER_EOF
chmod +x "$LAUNCHER"

# ---------------------------------------------------------------------------
# Verify installation
# ---------------------------------------------------------------------------
if ! "$LAUNCHER" --version >/dev/null 2>&1; then
  echo "install.sh: installation verification failed" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# PATH hint (only when ~/.local/bin is not on PATH)
# ---------------------------------------------------------------------------
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$LAUNCHER_DIR"; then
  echo "" >&2
  echo "Installed. Add to PATH if needed:" >&2
  echo "  export PATH=\"$LAUNCHER_DIR:\$PATH\"" >&2
fi

echo "Seevee v${VERSION} installed successfully." >&2

#!/bin/sh
set -eu

REPO="DrB0rk/seevee"
VERSION="latest"
INSTALL_ROOT="${SEEVE_INSTALL_DIR:-$HOME/.local/share/seevee}"
BIN_DIR="${SEEVE_BIN_DIR:-$HOME/.local/bin}"

usage() {
  cat <<'EOF'
Seevee installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/DrB0rk/seevee/main/install.sh | sh -s -- --version v0.2.0

Options:
  --version <tag>       GitHub release tag to install (default: latest)
  --install-dir <path>  Versioned application root
  --bin-dir <path>      Directory for the seevee launcher
  -h, --help            Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || { echo "seevee installer: --version requires a value" >&2; exit 2; }
      VERSION="$2"; shift 2 ;;
    --install-dir)
      [ "$#" -ge 2 ] || { echo "seevee installer: --install-dir requires a value" >&2; exit 2; }
      INSTALL_ROOT="$2"; shift 2 ;;
    --bin-dir)
      [ "$#" -ge 2 ] || { echo "seevee installer: --bin-dir requires a value" >&2; exit 2; }
      BIN_DIR="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "seevee installer: unknown option: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "seevee installer: curl is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "seevee installer: tar is required" >&2; exit 1; }

case "$(uname -s)" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *)
    echo "seevee installer: unsupported operating system: $(uname -s)" >&2
    echo "On Windows, use install.ps1 once Windows release support is available." >&2
    exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "seevee installer: unsupported architecture: $(uname -m)" >&2
    exit 1 ;;
esac

ASSET="seevee-${OS}-${ARCH}.tar.gz"
if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/${REPO}/releases/latest/download"
else
  case "$VERSION" in
    *[!A-Za-z0-9._-]*)
      echo "seevee installer: invalid release tag: $VERSION" >&2
      exit 2 ;;
  esac
  BASE="https://github.com/${REPO}/releases/download/${VERSION}"
fi

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t seevee)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM HUP

echo "seevee: downloading ${ASSET}..."
curl -fL --retry 3 --retry-delay 1 "${BASE}/${ASSET}" -o "${TMP}/${ASSET}"
curl -fL --retry 3 --retry-delay 1 "${BASE}/SHA256SUMS" -o "${TMP}/SHA256SUMS"

EXPECTED="$(awk -v f="$ASSET" '$2 == f || $2 == "*" f { print $1; exit }' "${TMP}/SHA256SUMS")"
[ -n "$EXPECTED" ] || { echo "seevee installer: no checksum published for $ASSET" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "${TMP}/${ASSET}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "${TMP}/${ASSET}" | awk '{print $1}')"
else
  echo "seevee installer: sha256sum or shasum is required for integrity verification" >&2
  exit 1
fi

[ "$EXPECTED" = "$ACTUAL" ] || {
  echo "seevee installer: checksum verification failed" >&2
  exit 1
}

mkdir -p "${TMP}/extract"
tar -xzf "${TMP}/${ASSET}" -C "${TMP}/extract"

[ -f "${TMP}/extract/VERSION" ] || {
  echo "seevee installer: release bundle is missing VERSION" >&2
  exit 1
}
[ -x "${TMP}/extract/bin/seevee" ] || {
  echo "seevee installer: release bundle is missing executable bin/seevee" >&2
  exit 1
}

RESOLVED_VERSION="$(cat "${TMP}/extract/VERSION")"
case "$RESOLVED_VERSION" in
  ""|*[!A-Za-z0-9._-]*)
    echo "seevee installer: invalid VERSION in release bundle" >&2
    exit 1 ;;
esac

DEST="${INSTALL_ROOT}/${RESOLVED_VERSION}"
mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
STAGE="${INSTALL_ROOT}/.${RESOLVED_VERSION}.installing.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "${TMP}/extract/." "$STAGE/"

if [ -d "$DEST" ]; then
  rm -rf "$STAGE"
else
  mv "$STAGE" "$DEST"
fi

ln -sfn "${DEST}/bin/seevee" "${BIN_DIR}/seevee"

if ! "${BIN_DIR}/seevee" --version >/dev/null 2>&1; then
  echo "seevee installer: installed launcher failed self-check" >&2
  exit 1
fi

echo "seevee: installed ${RESOLVED_VERSION}"
echo "seevee: launcher: ${BIN_DIR}/seevee"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo "seevee: ${BIN_DIR} is not currently in PATH."
    echo "seevee: add it to your shell PATH, then run: seevee init"
    exit 0 ;;
esac

echo "seevee: run 'seevee init' inside a directory to create/open a workspace."

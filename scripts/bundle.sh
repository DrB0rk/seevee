#!/usr/bin/env sh
# bundle.sh — Build a single Seevee runtime bundle.
#
# Usage: scripts/bundle.sh <platform> <output>
#
#   <platform>  one of: linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64
#   <output>    path to the resulting archive (extension decides format: .tar.gz or .zip)
#
# Bundle layout (per .dev/specs/CLI_INSTALLER.md §2):
#
#   seevee-<platform>/
#     VERSION
#     bin/seevee                       (Unix shell wrapper launcher)
#     bin/seevee.exe                   (Windows launcher entry)
#     bin/seevee.cmd                   (Windows cmd wrapper for seevee.exe)
#     runtime/
#       cli/                           built @seevee/cli (dist/*)
#       schema/                        built @seevee/schema (dist/*)
#       template-sdk/                  built @seevee/template-sdk (dist/*)
#       renderer/                      built @seevee/renderer (dist/*)
#       node_modules/                  production-only deps (workspace pkgs linked)

set -eu

PLATFORM="${1:-}"
OUTPUT="${2:-}"

usage() {
  echo "usage: $(basename "$0") <platform> <output>" >&2
  echo "  platforms: linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64" >&2
  exit 64
}

[ -n "$PLATFORM" ] && [ -n "$OUTPUT" ] || usage

case "$PLATFORM" in
  linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64) ;;
  *) echo "bundle.sh: unsupported platform: $PLATFORM" >&2; exit 64 ;;
esac

# Resolve repo root (this script lives in scripts/)
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

case "$OUTPUT" in
  /*) ;;
  *) OUTPUT="$ROOT_DIR/$OUTPUT" ;;
esac

OUTPUT_DIR="$(dirname "$OUTPUT")"
mkdir -p "$OUTPUT_DIR"

ARCHIVE_BASE="seevee-${PLATFORM}"
IS_WINDOWS=0
case "$PLATFORM" in
  windows-x64) IS_WINDOWS=1 ;;
esac

# ---------------------------------------------------------------------------
# 1. Stage directory
# ---------------------------------------------------------------------------
STAGE="$(mktemp -d -t seevee-bundle.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT INT TERM

mkdir -p "$STAGE/$ARCHIVE_BASE/bin" "$STAGE/$ARCHIVE_BASE/runtime"

# ---------------------------------------------------------------------------
# 2. VERSION file (the root VERSION file is canonical)
# ---------------------------------------------------------------------------
VERSION="$(cat VERSION)"
printf '%s\n' "$VERSION" > "$STAGE/$ARCHIVE_BASE/VERSION"

# ---------------------------------------------------------------------------
# 3. Build workspace packages
# ---------------------------------------------------------------------------
# The list of @seevee/* packages we ship in the runtime. We auto-detect
# @seevee/export only when SEEVEE_INCLUDE_EXPORT=1 is set; mid-implementation
# breakage in that package must not break the bundle.
RUNTIME_PKGS="cli schema template-sdk renderer"
if [ "${SEEVEE_INCLUDE_EXPORT:-0}" = "1" ] && [ -f "$ROOT_DIR/packages/export/package.json" ] && [ -d "$ROOT_DIR/packages/export/src" ]; then
  RUNTIME_PKGS="$RUNTIME_PKGS export"
fi

# Use a full install first so devDependencies (typescript) are available
# for the build step. Production-only resolution is done later when staging
# the runtime's node_modules.
echo "bundle.sh: installing deps (with devDeps for build)..." >&2
pnpm install --frozen-lockfile --silent

# Build only the runtime packages we ship so we don't trip on sibling
# packages that are mid-implementation.
echo "bundle.sh: building @seevee packages..." >&2
filter_args=""
for pkg in $RUNTIME_PKGS; do
  filter_args="$filter_args --filter=@seevee/$pkg"
done
# shellcheck disable=SC2086
pnpm -r $filter_args run build

# Packages that ship with `noEmit: true` (template-sdk, renderer, and
# optionally @seevee/export when SEEVEE_INCLUDE_EXPORT=1) need an explicit
# compile pass that emits JS, so dist/ exists in the bundle.
EMIT_PKGS="template-sdk renderer"
if [ "${SEEVEE_INCLUDE_EXPORT:-0}" = "1" ]; then
  EMIT_PKGS="$EMIT_PKGS export"
fi
for pkg in $EMIT_PKGS; do
  pkg_dir="$ROOT_DIR/packages/$pkg"
  if [ -d "$pkg_dir" ] && [ ! -f "$pkg_dir/dist/index.js" ]; then
    echo "bundle.sh: emitting $pkg/dist (tsc --noEmit false)..." >&2
    (cd "$pkg_dir" && node_modules/.bin/tsc -p tsconfig.json --noEmit false)
  fi
done

# ---------------------------------------------------------------------------
# 4. Stage platform launchers
# ---------------------------------------------------------------------------
# The actual JS launcher is `runtime/cli/cli.js` (produced by
# `pnpm --filter @seevee/cli run build`). Its relative imports of
# `./commands/*`, `./runtime/*`, and `./scaffold/*` resolve from there.
CLI_DIST="$ROOT_DIR/packages/cli/dist"
if [ ! -f "$CLI_DIST/cli.js" ]; then
  echo "bundle.sh: cli build did not produce $CLI_DIST/cli.js" >&2
  exit 1
fi

# Unix launcher: a tiny POSIX-sh wrapper that starts the bundled CLI.
cat > "$STAGE/$ARCHIVE_BASE/bin/seevee" <<'SH_EOF'
#!/usr/bin/env sh
# Seevee runtime launcher — installed by install.sh.
# Resolves its install location, sets NODE_PATH to the bundled runtime
# node_modules, and execs the built @seevee/cli entry.
set -e
SELF="$0"
# readlink -f is the GNU coreutils form; on macOS BSD readlink doesn't accept -f.
case "$(uname -s)" in
  Darwin) DIR="$(cd "$(dirname "$SELF")/.." && pwd)" ;;
  *)      DIR="$(dirname "$(readlink -f "$SELF")")/.." ;;
esac
export NODE_PATH="$DIR/runtime/node_modules"
export SEEVEE_VERSION="$(cat "$DIR/VERSION")"
exec node "$DIR/runtime/cli/dist/cli.js" "$@"
SH_EOF
chmod +x "$STAGE/$ARCHIVE_BASE/bin/seevee"

if [ "$IS_WINDOWS" = "1" ]; then
  # Windows entry point using the supported system Node runtime.
  cat > "$STAGE/$ARCHIVE_BASE/bin/seevee.cmd" <<'CMD_EOF'
@echo off
rem Seevee launcher for Windows (cmd).
setlocal
set "SEEVEE_BIN_DIR=%~dp0"
set "SEEVEE_ROOT=%SEEVEE_BIN_DIR%.."
set "NODE_PATH=%SEEVEE_BIN_DIR%..\runtime\node_modules"
set /p SEEVEE_VERSION=<"%SEEVEE_ROOT%\VERSION"
node "%SEEVEE_ROOT%\runtime\cli\dist\cli.js" %*
CMD_EOF
fi

# ---------------------------------------------------------------------------
# 5. Stage the runtime tree
# ---------------------------------------------------------------------------
RUNTIME="$STAGE/$ARCHIVE_BASE/runtime"

for pkg in $RUNTIME_PKGS; do
  src="$ROOT_DIR/packages/$pkg"
  dest="$RUNTIME/$pkg"
  mkdir -p "$dest"

  # Rewrite source TypeScript entry points to the compiled ESM files. Node's
  # ESM resolver does not honor NODE_PATH and cannot load these TS exports on
  # the minimum supported Node 20 runtime.
  node - "$src/package.json" "$dest/package.json" <<'NODE'
const fs = require('node:fs');
const [source, destination] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
const toRuntimePath = (value) => value
  .replace(/^\.\/src\//, './dist/')
  .replace(/\.ts$/, '.js');
manifest.main = toRuntimePath(manifest.main ?? './src/index.ts');
if (manifest.exports && typeof manifest.exports === 'object') {
  for (const [key, value] of Object.entries(manifest.exports)) {
    if (typeof value === 'string') manifest.exports[key] = toRuntimePath(value);
  }
}
fs.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

  # Copy the build output if it exists with at least one .js entry.
  has_js=0
  if [ -d "$src/dist" ]; then
    if find "$src/dist" -maxdepth 2 -name '*.js' -print -quit | grep -q .; then
      has_js=1
    fi
  fi
  if [ "$has_js" = "1" ]; then
    mkdir -p "$dest/dist"
    cp -R "$src/dist/." "$dest/dist/"
  else
    # Source-only fallback — ship the TS source. The launcher runs through
    # Node's --experimental-strip-types when available (Node 22.6+), with
    # tsx as a runtime fallback for older hosts.
    mkdir -p "$dest/src"
    cp -R "$src/src/." "$dest/src/"
  fi
done

# Resolve only the production deps of the runtime packages into a temporary
# pnpm project rooted at the bundle's runtime/. This keeps node_modules
# minimal (no devDeps) and contains only what the runtime actually needs.
WORK="$(mktemp -d -t seevee-pnpm.XXXXXX)"
# Build a workspace YAML and matching dirs from RUNTIME_PKGS so we only
# resolve what the runtime actually ships.
for pkg in $RUNTIME_PKGS; do
  mkdir -p "$WORK/$pkg"
done
# Hoist @seevee/* packages (and their deps) to the top of node_modules so
# Node's resolution algorithm can find @seevee/schema from anywhere under
# runtime/cli/. Without this, pnpm nests workspace pkgs under .pnpm/ via
# symlinks that Node's CommonJS-style walk does not follow.
cat > "$WORK/.npmrc" <<NPMRC
public-hoist-pattern[]=*
shamefully-hoist=true
NPMRC
cat > "$WORK/package.json" <<JSON
{
  "name": "seevee-bundle-resolver",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
JSON
printf 'packages:\n' > "$WORK/pnpm-workspace.yaml"
for pkg in $RUNTIME_PKGS; do
  printf "  - './%s'\n" "$pkg" >> "$WORK/pnpm-workspace.yaml"
done
cp "$ROOT_DIR/pnpm-lock.yaml" "$WORK/pnpm-lock.yaml"
for pkg in $RUNTIME_PKGS; do
  src="$ROOT_DIR/packages/$pkg"
  dest="$WORK/$pkg"
  cp "$src/package.json" "$dest/package.json"
  if [ -d "$src/dist" ]; then
    mkdir -p "$dest/dist"
    cp -R "$src/dist/." "$dest/dist/"
  fi
  if [ -d "$src/src" ]; then
    mkdir -p "$dest/src"
    cp -R "$src/src/." "$dest/src/"
  fi
done
# --no-frozen-lockfile because the synthetic resolver project diverges from
# the root lockfile (we only ship the runtime subset of packages).
(cd "$WORK" && pnpm install --prod --no-frozen-lockfile --silent)
if [ -d "$WORK/node_modules" ]; then
  cp -R "$WORK/node_modules/." "$RUNTIME/node_modules/"
fi
rm -rf "$WORK"

# Copy workspace packages into their scoped package locations for Node's ESM
# resolver. NODE_PATH is only consulted by CommonJS resolution.
rm -rf "$RUNTIME/node_modules/@seevee"
mkdir -p "$RUNTIME/node_modules/@seevee"
for pkg in $RUNTIME_PKGS; do
  cp -R "$RUNTIME/$pkg" "$RUNTIME/node_modules/@seevee/$pkg"
done

# ---------------------------------------------------------------------------
# 6. Pack the archive
# ---------------------------------------------------------------------------
case "$OUTPUT" in
  *.tar.gz)
    (cd "$STAGE" && tar -czf "$OUTPUT" "$ARCHIVE_BASE")
    ;;
  *.zip)
    if command -v zip >/dev/null 2>&1; then
      (cd "$STAGE" && zip -qr "$OUTPUT" "$ARCHIVE_BASE")
    elif command -v python3 >/dev/null 2>&1; then
      python3 - "$STAGE" "$OUTPUT" "$ARCHIVE_BASE" <<'PY'
import pathlib
import sys
import zipfile

stage, output, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in (stage / root).rglob('*'):
        if path.is_file():
            archive.write(path, path.relative_to(stage))
PY
    else
      echo "bundle.sh: 'zip' or 'python3' is required for Windows bundles" >&2
      exit 1
    fi
    ;;
  *)
    echo "bundle.sh: output must end in .tar.gz or .zip" >&2
    exit 64 ;;
esac

echo "$OUTPUT"

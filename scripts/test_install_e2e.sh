#!/usr/bin/env sh
# test_install_e2e.sh — exercise install.sh against a local release stub.
# Usage: scripts/test_install_e2e.sh <release-archive>
set -eu

ARCHIVE="${1:-}"
INSTALLER="${2:-install.sh}"
[ -n "$ARCHIVE" ] || { echo "usage: $(basename "$0") <release-archive> [installer]" >&2; exit 64; }
[ -f "$ARCHIVE" ] || { echo "test_install_e2e.sh: archive not found: $ARCHIVE" >&2; exit 64; }
[ -f "$INSTALLER" ] || { echo "test_install_e2e.sh: installer not found: $INSTALLER" >&2; exit 64; }
command -v node >/dev/null 2>&1 || { echo 'node is required' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo 'python3 is required for hostile fixtures' >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d -t seevee-install-e2e.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
PLATFORM='linux-x64'
VERSION_ENTRY="$(tar -tzf "$ARCHIVE" | sed -n '/\/VERSION$/ { p; q; }')"
VERSION="$(tar -xOf "$ARCHIVE" "$VERSION_ENTRY" | tr -d '\r\n')"
[ -n "$VERSION" ] || { echo 'could not read bundle VERSION' >&2; exit 1; }
export VERSION

FAKE_BIN="$WORK/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/curl" <<'CURL'
#!/usr/bin/env sh
set -eu
output=''
url=''
previous=''
for arg in "$@"; do
  if [ "$previous" = '-o' ]; then output="$arg"; previous=''; continue; fi
  case "$arg" in
    -o) previous='-o' ;;
    -*) ;;
    *) url="$arg" ;;
  esac
done
case "$url" in
  *'/releases/latest'*)
    printf '%s\n' '{"tag_name":"v'"$VERSION"'","draft":false,"prerelease":true}' > "$output"
    ;;
  *'/SHA256SUMS'*)
    cp "$FAKE_SUMS_FILE" "$output"
    ;;
  *'/releases/download/'*)
    for arg in "$@"; do
      if [ "$arg" = '--dump-header' ]; then exit 1; fi
    done
    cp "$FAKE_ARCHIVE_FILE" "$output"
    ;;
  *) exit 1 ;;
esac
CURL
chmod +x "$FAKE_BIN/curl"

SUMS_FILE="$WORK/SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$ARCHIVE")" && sha256sum "$(basename "$ARCHIVE")" | awk -v f="$(basename "$ARCHIVE")" '{ print $1 "  " f }') > "$SUMS_FILE"
else
  (cd "$(dirname "$ARCHIVE")" && shasum -a 256 "$(basename "$ARCHIVE")" | awk -v f="$(basename "$ARCHIVE")" '{ print $1 "  " f }') > "$SUMS_FILE"
fi

export PATH="$FAKE_BIN:$PATH"
export FAKE_ARCHIVE_FILE="$ARCHIVE"
export FAKE_SUMS_FILE="$SUMS_FILE"

INSTALL_ROOT="$WORK/install"
BIN_ROOT="$WORK/bin"
export SEEVE_INSTALL_DIR="$INSTALL_ROOT"
export SEEVE_BIN_DIR="$BIN_ROOT"

sh "$ROOT_DIR/$INSTALLER" --version "$VERSION" > "$WORK/install.log" 2>&1
"$BIN_ROOT/seevee" --version | grep -q "\"cli\": \"$VERSION\""
[ ! -e "$INSTALL_ROOT/.install.lock" ]
printf 'normal install OK\n'

mkdir -p "$INSTALL_ROOT/v0.0.1"
printf 'old\n' > "$INSTALL_ROOT/v0.0.1/old.txt"
sh "$ROOT_DIR/$INSTALLER" --version "$VERSION" > "$WORK/reinstall.log" 2>&1
[ ! -e "$INSTALL_ROOT/v0.0.1" ]
printf 'idempotent reinstall and stale-version cleanup OK\n'

mkdir -p "$INSTALL_ROOT/.install.lock"
set +e
sh "$ROOT_DIR/$INSTALLER" --version "$VERSION" > "$WORK/locked.log" 2>&1
locked_status=$?
set -e
[ "$locked_status" -ne 0 ]
[ -d "$INSTALL_ROOT/.install.lock" ]
rmdir "$INSTALL_ROOT/.install.lock"
printf 'concurrent lock protection OK\n'
python3 - "$WORK/hostile-traversal.tar.gz" "$VERSION" <<'PY'
import io
import sys
import tarfile

output, version = sys.argv[1:]
with tarfile.open(output, 'w:gz') as archive:
    for name, data in [
        (f'seevee-linux-x64/VERSION', f'{version}\n'.encode()),
        ('seevee-linux-x64/../../escape', b'pwned\n'),
    ]:
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
PY
(cd "$WORK" && sha256sum hostile-traversal.tar.gz | awk '{ print $1 "  seevee-linux-x64.tar.gz" }') > "$WORK/HOSTILE-SUMS"
export FAKE_ARCHIVE_FILE="$WORK/hostile-traversal.tar.gz"
export FAKE_SUMS_FILE="$WORK/HOSTILE-SUMS"
export SEEVE_INSTALL_DIR="$WORK/hostile-install"
export SEEVE_BIN_DIR="$WORK/hostile-bin"
set +e
sh "$ROOT_DIR/$INSTALLER" --version "$VERSION" > "$WORK/hostile.log" 2>&1
hostile_status=$?
set -e
[ "$hostile_status" -ne 0 ]
[ ! -e "$WORK/escape" ]
[ ! -e "$WORK/hostile-install/escape" ]
grep -q 'unsafe path or link' "$WORK/hostile.log"
printf 'hostile traversal archive rejected OK\n'

python3 - "$WORK/hostile-symlink.tar.gz" "$VERSION" <<'PY'
import io
import sys
import tarfile

output, version = sys.argv[1:]
with tarfile.open(output, 'w:gz') as archive:
    version_data = f'{version}\n'.encode()
    info = tarfile.TarInfo('seevee-linux-x64/VERSION')
    info.size = len(version_data)
    archive.addfile(info, io.BytesIO(version_data))
    link = tarfile.TarInfo('seevee-linux-x64/runtime')
    link.type = tarfile.SYMTYPE
    link.linkname = '../../../../tmp'
    archive.addfile(link)
PY
(cd "$WORK" && sha256sum hostile-symlink.tar.gz | awk '{ print $1 "  seevee-linux-x64.tar.gz" }') > "$WORK/HOSTILE-SYMLINK-SUMS"
export FAKE_ARCHIVE_FILE="$WORK/hostile-symlink.tar.gz"
export FAKE_SUMS_FILE="$WORK/HOSTILE-SYMLINK-SUMS"
export SEEVE_INSTALL_DIR="$WORK/symlink-install"
export SEEVE_BIN_DIR="$WORK/symlink-bin"
set +e
sh "$ROOT_DIR/$INSTALLER" --version "$VERSION" > "$WORK/symlink.log" 2>&1
symlink_status=$?
set -e
[ "$symlink_status" -ne 0 ]
grep -q 'unsafe path or link' "$WORK/symlink.log"
printf 'hostile symlink archive rejected OK\n'

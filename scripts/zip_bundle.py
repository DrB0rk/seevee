#!/usr/bin/env python3
"""Create a Windows bundle zip without relying on the system zip command.

The runtime tree contains pnpm symlinks. Windows Expand-Archive does not
reliably recreate those links, so this packer dereferences them into regular
files while preventing symlink cycles.
"""

from __future__ import annotations

import os
import pathlib
import sys
import zipfile


def add_tree(archive: zipfile.ZipFile, source: pathlib.Path, arc_root: str, seen: set[str], stack: tuple[str, ...]) -> None:
    real_source = os.path.realpath(source)
    if real_source in stack:
        return
    next_stack = (*stack, real_source)
    with os.scandir(source) as entries:
        for entry in entries:
            arcname = f"{arc_root}/{entry.name}"
            if arcname in seen:
                continue
            child = pathlib.Path(entry.path)
            if entry.is_symlink():
                target = pathlib.Path(os.path.realpath(child))
                if not target.exists():
                    raise RuntimeError(f"broken bundle symlink: {child}")
                if target.is_dir():
                    add_tree(archive, target, arcname, seen, next_stack)
                else:
                    archive.write(target, arcname)
                    seen.add(arcname)
                continue
            if entry.is_dir(follow_symlinks=False):
                add_tree(archive, child, arcname, seen, next_stack)
            elif entry.is_file(follow_symlinks=False):
                archive.write(child, arcname)
                seen.add(arcname)


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: zip_bundle.py <stage> <output> <root>", file=sys.stderr)
        return 64
    stage = pathlib.Path(sys.argv[1])
    output = pathlib.Path(sys.argv[2])
    root = sys.argv[3]
    source = stage / root
    if not source.is_dir():
        print(f"zip_bundle.py: missing bundle root: {source}", file=sys.stderr)
        return 1
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        add_tree(archive, source, root, set(), ())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

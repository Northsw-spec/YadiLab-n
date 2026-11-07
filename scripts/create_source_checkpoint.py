#!/usr/bin/env python3
"""Create a deterministic source checkpoint with a fail-closed npm lock contract."""
import argparse
import hashlib
import json
import os
import re
import stat
import zipfile
from pathlib import Path


def excluded(relative, is_directory):
    parts = relative.split("/")
    top = parts[0]
    if top in {".git", "node_modules", "distribution"} or ".git" in parts or "node_modules" in parts:
        return True
    if top == "ui" and len(parts) > 1 and parts[1] in {"dist", "dist-shell"}:
        return True
    if re.fullmatch(r"dist-[A-Za-z0-9._-]+-test(?:/.*)?", relative):
        return True
    if not is_directory and relative in {"launcher-smoke.log", "launcher-smoke-index.out", "parrot-acceptance-report.json", "parrot-acceptance-report.txt"}:
        return True
    return False


def source_files(root):
    if (root / "package.json").exists() and not (root / "package-lock.json").exists():
        raise SystemExit("BLOCKED: package.json exists but package-lock.json is missing.")
    files = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_dir() or excluded(relative, path.is_dir()):
            continue
        if path.is_symlink():
            raise SystemExit(f"BLOCKED: source symlink is not allowed: {relative}")
        files.append((relative, path))
    if (root / "package.json").exists() and not any(name == "package-lock.json" for name, _ in files):
        raise SystemExit("BLOCKED: source checkpoint file list omitted package-lock.json.")
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    files = source_files(root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative, path in files:
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IMODE(path.stat().st_mode) & 0o777) << 16
            archive.writestr(info, path.read_bytes())
    print(json.dumps({"status": "PASS", "output": str(args.output), "files": len(files), "packageLockIncluded": any(name == "package-lock.json" for name, _ in files)}))


if __name__ == "__main__":
    main()

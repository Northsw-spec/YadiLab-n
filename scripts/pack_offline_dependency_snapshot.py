#!/usr/bin/env python3
"""Create a canonical ZIP_STORED transport for a verified offline dependency snapshot."""
from __future__ import annotations
import hashlib, json, os, pathlib, stat, sys, zipfile

FIXED_TIME = (1980, 1, 1, 0, 0, 0)
MAX_FILES = 200_000
MAX_FILE_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
CONTROL_FILES = ["snapshot-manifest.json", "snapshot-provenance.json", "snapshot-provenance.sig"]


def die(msg: str, code: int = 1) -> None:
    print(f"FAIL dependency snapshot transport pack: {msg}", file=sys.stderr)
    raise SystemExit(code)


def safe_rel(value: str) -> bool:
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value or "\x00" in value:
        return False
    if value.startswith("/"):
        return False
    return all(p not in ("", ".", "..") for p in value.split("/"))


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    if len(sys.argv) != 3:
        die("Usage: python3 scripts/pack_offline_dependency_snapshot.py SNAPSHOT_DIR OUTPUT.zip", 2)
    root = pathlib.Path(sys.argv[1]).resolve()
    out = pathlib.Path(sys.argv[2]).resolve()
    if not root.is_dir():
        die("snapshot directory does not exist")
    manifest_path = root / "snapshot-manifest.json"
    if not manifest_path.is_file():
        die("snapshot-manifest.json is missing")
    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
    except Exception as exc:
        die(f"invalid snapshot-manifest.json: {exc}")
    files = manifest.get("files")
    if not isinstance(files, list) or len(files) > MAX_FILES:
        die("manifest file table invalid or too large")
    expected = []
    seen = set()
    folded = set()
    total = 0
    for item in files:
        rel = item.get("path") if isinstance(item, dict) else None
        size = item.get("size") if isinstance(item, dict) else None
        digest = item.get("sha256") if isinstance(item, dict) else None
        if not safe_rel(rel) or rel in seen or rel.casefold() in folded:
            die(f"unsafe, duplicate, or case-colliding manifest path: {rel!r}")
        if not isinstance(size, int) or size < 0 or size > MAX_FILE_BYTES:
            die(f"invalid/oversized manifest file: {rel}")
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            die(f"invalid manifest SHA-256: {rel}")
        full = root.joinpath(*rel.split("/"))
        try:
            st = full.lstat()
        except FileNotFoundError:
            die(f"listed file missing: {rel}")
        if not stat.S_ISREG(st.st_mode):
            die(f"listed entry is not a regular file: {rel}")
        if st.st_size != size or sha256_file(full) != digest:
            die(f"listed file does not match manifest: {rel}")
        seen.add(rel); folded.add(rel.casefold()); expected.append(rel); total += size
    if total > MAX_TOTAL_BYTES:
        die("snapshot exceeds transport total-byte limit")
    if manifest.get("fileCount") != len(files) or manifest.get("totalBytes") != total:
        die("manifest count/byte totals do not match file table")
    expected = sorted(expected, key=lambda x: (x.casefold(), x))
    if expected != [item["path"] for item in files]:
        die("manifest file table is not canonical/sorted")
    for rel in CONTROL_FILES:
        full = root / rel
        try:
            st = full.lstat()
        except FileNotFoundError:
            die(f"required control file missing: {rel}")
        if not stat.S_ISREG(st.st_mode):
            die(f"required control entry is not a regular file: {rel}")
    entries = expected + CONTROL_FILES
    entries.sort(key=lambda x: (x.casefold(), x))
    if out.exists():
        die("output archive already exists")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        zf.comment = b""
        for rel in entries:
            full = root.joinpath(*rel.split("/"))
            info = zipfile.ZipInfo(rel, FIXED_TIME)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_STORED
            info.flag_bits = 0
            with full.open("rb") as src, zf.open(info, "w", force_zip64=True) as dst:
                for chunk in iter(lambda: src.read(1024 * 1024), b""):
                    dst.write(chunk)
    print(f"PASS sealed dependency snapshot transport: {len(entries)} files, {out.stat().st_size} archive bytes.")

if __name__ == "__main__":
    main()

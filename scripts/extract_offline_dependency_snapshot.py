#!/usr/bin/env python3
"""Fail-closed extractor for YadiLab offline dependency snapshot transport ZIPs."""
from __future__ import annotations
import hashlib, json, pathlib, stat, sys, zipfile

FIXED_TIME = (1980, 1, 1, 0, 0, 0)
MAX_FILES = 200_001
MAX_FILE_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
CONTROL_FILES = {"snapshot-manifest.json", "snapshot-provenance.json", "snapshot-provenance.sig"}


def blocked(msg: str, code: int = 77) -> None:
    print(f"BLOCKED dependency snapshot transport: {msg}", file=sys.stderr)
    raise SystemExit(code)


def safe_rel(value: str) -> bool:
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value or "\x00" in value:
        return False
    if value.startswith("/"):
        return False
    return all(p not in ("", ".", "..") for p in value.split("/"))


def canonical_info(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return (
        safe_rel(info.filename)
        and not info.is_dir()
        and info.compress_type == zipfile.ZIP_STORED
        and info.date_time == FIXED_TIME
        and info.flag_bits & 0x1 == 0
        and info.comment == b""
        and info.extra == b""
        and stat.S_IFMT(mode) == stat.S_IFREG
        and stat.S_IMODE(mode) == 0o644
    )


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python3 scripts/extract_offline_dependency_snapshot.py TRANSPORT.zip EMPTY_OUTPUT_DIR", file=sys.stderr)
        raise SystemExit(2)
    archive = pathlib.Path(sys.argv[1]).resolve()
    out = pathlib.Path(sys.argv[2]).resolve()
    if not archive.is_file():
        blocked("archive does not exist")
    if out.exists() and any(out.iterdir()):
        blocked("output directory must be empty")
    out.mkdir(parents=True, exist_ok=True)
    try:
        zf = zipfile.ZipFile(archive, "r")
    except Exception as exc:
        blocked(f"invalid ZIP: {exc}")
    with zf:
        if zf.comment:
            blocked("archive comment is forbidden")
        infos = zf.infolist()
        if not infos or len(infos) > MAX_FILES:
            blocked("archive entry count invalid")
        names, seen, folded = [], set(), set()
        total = 0
        for info in infos:
            if not canonical_info(info):
                blocked(f"non-canonical/unsafe ZIP entry: {info.filename!r}")
            if info.filename in seen:
                blocked(f"duplicate ZIP entry: {info.filename}")
            cf = info.filename.casefold()
            if cf in folded:
                blocked(f"case-colliding ZIP entry: {info.filename}")
            seen.add(info.filename); folded.add(cf); names.append(info.filename)
            if info.file_size > MAX_FILE_BYTES or info.compress_size != info.file_size:
                blocked(f"oversized or non-stored ZIP entry: {info.filename}")
            total += info.file_size
            if total > MAX_TOTAL_BYTES:
                blocked("archive exceeds total-byte limit")
        if names != sorted(names, key=lambda x: (x.casefold(), x)):
            blocked("ZIP entries are not in canonical sorted order")
        missing_control = sorted(CONTROL_FILES - seen)
        if missing_control:
            blocked(f"required control file missing: {missing_control[0]}")
        try:
            manifest_raw = zf.read("snapshot-manifest.json")
            manifest = json.loads(manifest_raw.decode("utf-8"))
        except Exception as exc:
            blocked(f"invalid snapshot manifest in archive: {exc}")
        files = manifest.get("files")
        if not isinstance(files, list):
            blocked("manifest file table invalid")
        expected = set(CONTROL_FILES)
        declared_total = 0
        manifest_seen = set()
        for item in files:
            if not isinstance(item, dict):
                blocked("manifest entry invalid")
            rel, size, digest = item.get("path"), item.get("size"), item.get("sha256")
            if not safe_rel(rel) or rel in manifest_seen:
                blocked(f"unsafe/duplicate manifest path: {rel!r}")
            if not isinstance(size, int) or size < 0 or size > MAX_FILE_BYTES:
                blocked(f"invalid manifest size: {rel}")
            if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                blocked(f"invalid manifest hash: {rel}")
            manifest_seen.add(rel); expected.add(rel); declared_total += size
        if manifest.get("fileCount") != len(files) or manifest.get("totalBytes") != declared_total:
            blocked("manifest totals invalid")
        if seen != expected:
            extra = sorted(seen - expected)[:5]
            missing = sorted(expected - seen)[:5]
            blocked(f"archive/manifest file set mismatch extra={extra} missing={missing}")
        for item in files:
            info = zf.getinfo(item["path"])
            if info.file_size != item["size"]:
                blocked(f"manifest/archive size mismatch: {item['path']}")
            h = hashlib.sha256()
            target = out.joinpath(*item["path"].split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, target.open("xb") as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk: break
                    h.update(chunk); dst.write(chunk)
            if h.hexdigest() != item["sha256"]:
                blocked(f"manifest/archive SHA-256 mismatch: {item['path']}")
        (out / "snapshot-manifest.json").write_bytes(manifest_raw)
        for control in ("snapshot-provenance.json", "snapshot-provenance.sig"):
            (out / control).write_bytes(zf.read(control))
    print(f"PASS extracted dependency snapshot transport: {len(infos)} files.")

if __name__ == "__main__":
    main()

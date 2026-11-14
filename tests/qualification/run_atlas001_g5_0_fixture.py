#!/usr/bin/env python3
"""ATLAS-001 G5.0 evidence qualification.

This is an independent DOCX/PDF evidence check. It never feeds the manifest
into YadiLab's importer and never creates a topology model. CI uses the
strict default; ``--allow-unaccepted-environment`` is only for local
diagnostics and records a non-accepted renderer profile.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import locale
import os
import platform
import re
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "atlas001-g5.0"
PROFILE = ROOT / "rendering-profile.json"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
PAGE_COUNT = 500


class EvidenceFailure(RuntimeError):
    pass


def fail(message: str) -> None:
    raise EvidenceFailure(message)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def command_output(command: list[str], *, required: bool = True) -> str:
    if shutil.which(command[0]) is None:
        if required:
            fail(f"missing render tool: {command[0]}")
        return ""
    try:
        result = subprocess.run(command, check=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
    except (OSError, subprocess.CalledProcessError) as error:
        if required:
            fail(f"render tool failed: {' '.join(command)}: {error}")
        return ""
    return result.stdout.strip()


def os_release() -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key] = value.strip('"')
    except OSError:
        pass
    return values


def version_line(output: str) -> str:
    return output.splitlines()[0].strip() if output else ""


def font_fingerprint() -> dict[str, object]:
    fc_list = command_output(["fc-list", ":", "family", "style", "file"])
    lines = sorted(line.strip() for line in fc_list.splitlines() if line.strip())
    required = ["DejaVu Sans", "Liberation Sans"]
    matches: dict[str, str] = {}
    for family in required:
        output = command_output(["fc-match", "-f", "%{family}|%{style}|%{file}\\n", family])
        if not output or family not in output:
            fail(f"required font family unavailable: {family}")
        matches[family] = output.splitlines()[0]
    return {
        "inventorySha256": sha256_bytes(("\n".join(lines) + "\n").encode()),
        "inventoryEntryCount": len(lines),
        "requiredFamilies": matches,
        "fontconfigFile": os.environ.get("FONTCONFIG_FILE", ""),
        "fontconfigPath": os.environ.get("FONTCONFIG_PATH", ""),
    }


def environment_snapshot() -> dict[str, object]:
    try:
        import docx  # type: ignore
        python_docx = getattr(docx, "__version__", "")
    except Exception:
        python_docx = ""
    os_info = os_release()
    return {
        "os": {"id": os_info.get("ID", ""), "versionId": os_info.get("VERSION_ID", ""),
               "prettyName": os_info.get("PRETTY_NAME", ""), "kernel": platform.release()},
        "architecture": platform.machine(),
        "locale": os.environ.get("LC_ALL") or os.environ.get("LANG") or locale.setlocale(locale.LC_ALL, None),
        "tools": {
            "libreoffice": version_line(command_output(["soffice", "--version"])),
            "pdfinfo": version_line(command_output(["pdfinfo", "-v"])),
            "pdftotext": version_line(command_output(["pdftotext", "-v"])),
            "python": platform.python_version(), "pythonDocx": python_docx,
        },
        "fontconfig": font_fingerprint(),
        "environment": {key: os.environ.get(key, "") for key in
                        ("LANG", "LC_ALL", "LC_CTYPE", "FONTCONFIG_FILE", "FONTCONFIG_PATH")},
        "commands": {
            "render": ["soffice", "--headless", "--convert-to", "pdf", "--outdir", "<temporary>", "<source.docx>"],
            "pageCount": ["pdfinfo", "<rendered.pdf>"],
            "pageText": ["pdftotext", "-layout", "<rendered.pdf>", "<page-text.txt>"],
        },
    }


def profile_matches(actual: dict[str, object], profile: dict[str, object]) -> list[str]:
    expected = profile["acceptedEnvironment"]
    errors: list[str] = []
    actual_os = actual["os"]
    if actual_os["id"] != expected["osId"] or actual_os["versionId"] != expected["osVersionId"]:
        errors.append(f"OS {actual_os['id']} {actual_os['versionId']} != {expected['osId']} {expected['osVersionId']}")
    if actual["architecture"] != expected["architecture"]:
        errors.append(f"architecture {actual['architecture']} != {expected['architecture']}")
    if actual["locale"] != expected["locale"]:
        errors.append(f"locale {actual['locale']} != {expected['locale']}")
    for name, pattern in expected["toolVersionPatterns"].items():
        if not re.search(pattern, actual["tools"].get(name, "")):
            errors.append(f"{name} version {actual['tools'].get(name, '')!r} does not match {pattern!r}")
    for family in expected["requiredFontFamilies"]:
        if family not in actual["fontconfig"]["requiredFamilies"]:
            errors.append(f"font family missing: {family}")
    return errors


def document_layout(source: Path) -> dict[str, object]:
    with zipfile.ZipFile(source) as archive:
        xml = ElementTree.fromstring(archive.read("word/document.xml"))
    page_size = xml.find(".//w:sectPr/w:pgSz", NS)
    margins = xml.find(".//w:sectPr/w:pgMar", NS)
    if page_size is None or margins is None:
        fail(f"{source.name}: missing page layout")
    def attr(node, key):
        return node.attrib.get(f"{{{NS['w']}}}{key}")
    return {
        "pageSizeTwips": {"width": attr(page_size, "w"), "height": attr(page_size, "h")},
        "marginsTwips": {key: attr(margins, key) for key in
                         ("top", "right", "bottom", "left", "header", "footer", "gutter")},
    }


def table_values(source: Path) -> list[list[list[str]]]:
    with zipfile.ZipFile(source) as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"))
    tables: list[list[list[str]]] = []
    for table in document.findall(".//w:tbl", NS):
        rows: list[list[str]] = []
        for row in table.findall("./w:tr", NS):
            rows.append(["".join(node.text or "" for node in cell.findall(".//w:t", NS))
                         for cell in row.findall("./w:tc", NS)])
        tables.append(rows)
    return tables


def source_checks(source: Path, control: dict[str, object]) -> dict[str, object]:
    actual_sha = sha256_file(source)
    if actual_sha != control["sha256"]:
        fail(f"{control['id']}: original SHA-256 mismatch")
    tables = table_values(source)
    if len(tables) != control["tables"]:
        fail(f"{control['id']}: table count {len(tables)} != {control['tables']}")
    if control["id"] == "A" and tables:
        fail("control A contains topology declarations")
    if control["id"] == "B":
        expected = [[
            ["device_id", "role"], ["g5-router-001", "router"], ["g5-switch-001", "switch"]
        ], [["from_id", "to_id", "from_port", "to_port"],
            ["g5-router-001", "g5-switch-001", "eth1", "eth1"]]]
        if tables != expected:
            fail("control B XML declaration values/order differ from the fixture contract")
    return {"sha256": actual_sha, "tables": len(tables), "layout": document_layout(source)}


def render(source: Path, output_dir: Path) -> tuple[Path, float, int]:
    output_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    output = command_output(["soffice", "--headless", "--convert-to", "pdf",
                             "--outdir", str(output_dir), str(source)])
    pdf = output_dir / f"{source.stem}.pdf"
    if not pdf.exists() or pdf.stat().st_size == 0:
        fail(f"{source.name}: renderer produced no non-empty PDF ({output})")
    after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return pdf, time.monotonic() - started, max(before, after)


def pdf_pages(pdf: Path) -> list[str]:
    info = command_output(["pdfinfo", str(pdf)])
    match = re.search(r"^Pages:\s+(\d+)\s*$", info, re.MULTILINE)
    if not match:
        fail(f"{pdf.name}: pdfinfo did not report Pages")
    if int(match.group(1)) != PAGE_COUNT:
        fail(f"{pdf.name}: page count {match.group(1)} != {PAGE_COUNT}")
    text_path = pdf.with_suffix(".pages.txt")
    command_output(["pdftotext", "-layout", str(pdf), str(text_path)])
    if not text_path.exists() or text_path.stat().st_size == 0:
        fail(f"{pdf.name}: pdftotext produced no page text")
    raw = text_path.read_text(encoding="utf-8", errors="strict")
    pages = raw.split("\f")
    if pages and pages[-1] == "":
        pages.pop()
    if len(pages) != PAGE_COUNT:
        fail(f"{pdf.name}: extracted page order has {len(pages)} pages")
    return pages


def page_marker_checks(control: dict[str, object], pages: list[str]) -> dict[str, object]:
    if len(pages) != PAGE_COUNT:
        fail(f"control {control['id']}: extracted page count {len(pages)} != {PAGE_COUNT}")
    prefix = f"ATLAS-001 G5.0 Control {control['id']} — physical document page "
    for number, page in enumerate(pages, 1):
        marker = f"{prefix}{number:03d}."
        if page.count(marker) != 1:
            fail(f"control {control['id']}: missing/duplicate marker on rendered page {number}")
    if control["id"] == "A":
        if any("device_id" in page or "from_id" in page for page in pages):
            fail("control A: rendered network declaration detected")
        return {"markers": PAGE_COUNT, "declarations": 0}
    checks = {101: ["device_id", "role", "g5-router-001", "g5-switch-001"],
              251: ["from_id", "to_id", "from_port", "to_port", "g5-router-001", "g5-switch-001", "eth1"],
              401: ["Explicit declaration page only", "no additional device or link"]}
    for page_number, needles in checks.items():
        for needle in needles:
            if needle not in pages[page_number - 1]:
                fail(f"control B: {needle!r} missing from rendered page {page_number}")
    for page_number in (100, 102):
        if "device_id" in pages[page_number - 1]:
            fail(f"control B: resource table flowed onto page {page_number}")
    for page_number in (250, 252):
        if "from_id" in pages[page_number - 1]:
            fail(f"control B: connection table flowed onto page {page_number}")
    for page_number in (400, 402):
        if "Explicit declaration page only" in pages[page_number - 1]:
            fail(f"control B: documentation note flowed onto page {page_number}")
    if "device_id" in pages[400] or "from_id" in pages[400]:
        fail("control B: page 401 contains an unexpected topology declaration")
    return {"markers": PAGE_COUNT, "declarations": {
        "resources": {"page": 101, "checked": True},
        "connections": {"page": 251, "checked": True},
        "boundaryNote": {"page": 401, "checked": True},
        "neighbors": [100, 102, 250, 252, 400, 402],
    }}


def run(manifest_path: Path, evidence_dir: Path, allow_unaccepted: bool) -> dict[str, object]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    actual_environment = environment_snapshot()
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    environment_errors = profile_matches(actual_environment, profile)
    renderer_status = "PASS" if not environment_errors else "FAIL"
    if environment_errors and not allow_unaccepted:
        fail("renderer environment is not an accepted profile: " + "; ".join(environment_errors))
    evidence_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, object] = {
        "schema": "atlas-001.g5.0.evidence.v2",
        "exactGitCommit": os.environ.get("GITHUB_SHA", "local-working-tree"),
        "sourceFixtures": [],
        "rendererFingerprint": {"profileId": profile["profileId"], "status": renderer_status,
                                 "environment": actual_environment, "profileMismatches": environment_errors},
        "structuralSourceChecks": {"manifest": manifest_path.name, "status": "PASS"},
        "diagnostics": [], "acceptanceStatus": {},
    }
    with tempfile.TemporaryDirectory(prefix="atlas001-g5-evidence-") as temp:
        temp_path = Path(temp)
        for control in manifest["controls"]:
            source = ROOT / control["file"]
            started = time.monotonic()
            source_result = source_checks(source, control)
            pdf, render_seconds, peak_rss = render(source, temp_path)
            pages = pdf_pages(pdf)
            page_result = page_marker_checks(control, pages)
            result["sourceFixtures"].append({
                "id": control["id"], "file": control["file"], "originalSha256": source_result["sha256"],
                "renderedPages": len(pages), "pdfSha256": sha256_file(pdf),
                "pageOrderChecks": page_result["markers"], "declarationPageChecks": page_result["declarations"],
                "structuralSource": source_result, "durationSeconds": round(render_seconds, 3),
                "peakChildRssKiB": peak_rss, "totalElapsedSeconds": round(time.monotonic() - started, 3),
            })
    result["durationAndResourceMeasurements"] = {
        "fixtures": len(result["sourceFixtures"]),
        "totalSeconds": round(sum(item["totalElapsedSeconds"] for item in result["sourceFixtures"]), 3),
    }
    result["acceptanceStatus"] = {
        "RENDERER_FINGERPRINT": renderer_status, "PHYSICAL_PAGE_COUNT": "PASS", "PAGE_ORDER": "PASS",
        "DECLARATION_PAGE_LOCATION": "PASS", "SOURCE_SHA256": "PASS", "XML_SOURCE_RECONCILIATION": "PASS",
        "NEGATIVE_TESTS": "PENDING_SEPARATE_COMMAND",
        "GITHUB_CI_EVIDENCE": "PASS" if os.environ.get("GITHUB_ACTIONS") else "PENDING_GITHUB_RUN",
        "ATLAS_COMPATIBILITY": "PENDING_G5.1", "VISUAL_APPROVAL": "PENDING_USER",
    }
    (evidence_dir / "atlas001-g5-0-evidence.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=ROOT / "manifest.json")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / "evidence")
    parser.add_argument("--allow-unaccepted-environment", action="store_true")
    args = parser.parse_args()
    try:
        run(args.manifest, args.evidence_dir, args.allow_unaccepted_environment)
    except (EvidenceFailure, OSError, subprocess.SubprocessError, ValueError) as error:
        print(f"FAIL ATLAS-001 G5.0: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

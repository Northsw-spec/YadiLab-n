#!/usr/bin/env python3
"""Generate the deterministic ATLAS-001 G5.0 DOCX control fixtures.

The fixtures are deliberately synthetic.  They exercise physical-page
rendering independently from YadiLab's structure-only DOCX inspection:
control A has no topology declarations; control B has three explicit,
manifested declarations and no inferred links.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from docx import Document
from docx.enum.text import WD_BREAK


ROOT = Path(__file__).resolve().parent
PAGE_COUNT = 500
FIXED_ZIP_DATE = (1980, 1, 1, 0, 0, 0)


def normalize_docx(path: Path) -> None:
    """Rewrite OPC members with stable ordering and timestamps."""
    with zipfile.ZipFile(path, "r") as source:
        members = [(name, source.read(name), source.getinfo(name).compress_type)
                   for name in source.namelist()]
    temporary = path.with_suffix(".normalized.docx")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9) as target:
        for name, payload, _ in sorted(members):
            info = zipfile.ZipInfo(name, FIXED_ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0
            target.writestr(info, payload)
    temporary.replace(path)


def page_break(paragraph) -> None:
    paragraph.add_run().add_break(WD_BREAK.PAGE)


def set_fixed_properties(document: Document, title: str) -> None:
    props = document.core_properties
    props.author = "ATLAS-001 synthetic fixture"
    props.title = title
    props.subject = "G5.0 physical-page and source-fidelity control"
    props.keywords = "ATLAS-001,G5.0,synthetic,control"
    props.comments = "No production network information."
    fixed = datetime.datetime(2026, 1, 1, 0, 0, 0)
    props.created = fixed
    props.modified = fixed
    props.last_printed = fixed


def add_table(document: Document, rows: list[list[str]]) -> None:
    table = document.add_table(rows=len(rows), cols=len(rows[0]))
    table.style = "Table Grid"
    for row, values in zip(table.rows, rows):
        for cell, value in zip(row.cells, values):
            cell.text = value


def build_control_a(path: Path) -> None:
    document = Document()
    set_fixed_properties(document, "ATLAS-001 G5.0 Control A")
    for page in range(1, PAGE_COUNT + 1):
        paragraph = document.add_paragraph(
            f"ATLAS-001 G5.0 Control A — physical document page {page:03d}. "
            "No network declarations."
        )
        if page != PAGE_COUNT:
            page_break(paragraph)
    document.save(path)
    normalize_docx(path)


def build_control_b(path: Path) -> list[dict[str, object]]:
    document = Document()
    set_fixed_properties(document, "ATLAS-001 G5.0 Control B")
    declarations: list[dict[str, object]] = []
    for page in range(1, PAGE_COUNT + 1):
        document.add_paragraph(
            f"ATLAS-001 G5.0 Control B — physical document page {page:03d}."
        )
        if page == 101:
            add_table(document, [
                ["device_id", "role"],
                ["g5-router-001", "router"],
                ["g5-switch-001", "switch"],
            ])
            declarations.append({"page": page, "kind": "resources",
                                 "resource_ids": ["g5-router-001", "g5-switch-001"]})
        if page == 251:
            add_table(document, [
                ["from_id", "to_id", "from_port", "to_port"],
                ["g5-router-001", "g5-switch-001", "eth1", "eth1"],
            ])
            declarations.append({
                "page": page,
                "kind": "connections",
                "connections": [{
                    "from_id": "g5-router-001",
                    "to_id": "g5-switch-001",
                    "from_port": "eth1",
                    "to_port": "eth1",
                }],
            })
        if page == 401:
            document.add_paragraph(
                "Explicit declaration page only; no additional device or link "
                "may be inferred from surrounding prose."
            )
            declarations.append({"page": page, "kind": "boundary-note"})
        if page != PAGE_COUNT:
            page_break(document.add_paragraph())
    document.save(path)
    normalize_docx(path)
    return declarations


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rendered_pages(source: Path, output_dir: Path) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="atlas001-g5-render-") as temp:
        result = subprocess.run([
            "soffice", "--headless", "--convert-to", "pdf",
            "--outdir", temp, str(source),
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True)
        pdf = Path(temp) / f"{source.stem}.pdf"
        if not pdf.exists():
            raise RuntimeError(f"LibreOffice did not produce PDF: {result.stdout}")
        probe = subprocess.run(["pdfinfo", str(pdf)], check=True,
                               stdout=subprocess.PIPE, text=True)
        for line in probe.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    raise RuntimeError("pdfinfo did not report Pages")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    parser.add_argument("--skip-render", action="store_true")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    control_a = args.output_dir / "atlas001-g5-control-a-500-pages.docx"
    control_b = args.output_dir / "atlas001-g5-control-b-500-pages.docx"
    build_control_a(control_a)
    declarations = build_control_b(control_b)
    pages = {} if args.skip_render else {
        control_a.name: rendered_pages(control_a, args.output_dir),
        control_b.name: rendered_pages(control_b, args.output_dir),
    }
    manifest = {
        "format": "docx",
        "profile": "atlas-001.g5.0.synthetic-controls.v1",
        "generator": "generate_g5_fixtures.py",
        "page_count_method": "LibreOffice soffice -> PDF -> pdfinfo Pages",
        "controls": [
            {"id": "A", "file": control_a.name, "expected_pages": PAGE_COUNT,
             "rendered_pages": pages.get(control_a.name), "tables": 0,
             "resources": [], "connections": []},
            {"id": "B", "file": control_b.name, "expected_pages": PAGE_COUNT,
             "rendered_pages": pages.get(control_b.name), "tables": 2,
             "declarations": declarations,
             "resources": ["g5-router-001", "g5-switch-001"],
             "connections": [{"from_id": "g5-router-001", "to_id": "g5-switch-001",
                              "from_port": "eth1", "to_port": "eth1"}]},
        ],
    }
    for control in manifest["controls"]:
        control["sha256"] = sha256(args.output_dir / control["file"])
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

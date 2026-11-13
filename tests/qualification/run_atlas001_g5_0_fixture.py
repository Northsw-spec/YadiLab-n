#!/usr/bin/env python3
"""Independent G5.0 page-count and source-value control verification."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "atlas001-g5.0"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def fail(message: str) -> None:
    raise SystemExit(f"FAIL ATLAS-001 G5.0: {message}")


def page_count(source: Path) -> int:
    with tempfile.TemporaryDirectory(prefix="atlas001-g5-pagecount-") as temp:
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf",
                        "--outdir", temp, str(source)], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        pdf = Path(temp) / f"{source.stem}.pdf"
        output = subprocess.check_output(["pdfinfo", str(pdf)], text=True)
    return int(next(line.split(":", 1)[1] for line in output.splitlines()
                    if line.startswith("Pages:")))


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


manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
for control in manifest["controls"]:
    source = ROOT / control["file"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != control["sha256"]:
        fail(f"{control['id']} source bytes changed")
    actual_pages = page_count(source)
    if actual_pages != control["expected_pages"] or actual_pages != 500:
        fail(f"{control['id']} rendered page count is {actual_pages}, expected 500")

control_a, control_b = manifest["controls"]
if table_values(ROOT / control_a["file"]):
    fail("control A contains undeclared topology tables")

actual_b = table_values(ROOT / control_b["file"])
expected_b = [
    [["device_id", "role"], ["g5-router-001", "router"],
     ["g5-switch-001", "switch"]],
    [["from_id", "to_id", "from_port", "to_port"],
     ["g5-router-001", "g5-switch-001", "eth1", "eth1"]],
]
if actual_b != expected_b:
    fail("control B declarations differ from independently extracted XML values")
if control_b["connections"] != [{"from_id": "g5-router-001",
                                  "to_id": "g5-switch-001",
                                  "from_port": "eth1", "to_port": "eth1"}]:
    fail("control B manifest connection is not exact")
print("PASS ATLAS-001 G5.0 independent 500-page rendering and source manifest controls")

#!/usr/bin/env python3
"""Fail-closed regression probes for ATLAS-001 G5.0 evidence."""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import zipfile
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("run_atlas001_g5_0_fixture.py")
spec = importlib.util.spec_from_file_location("g5_evidence", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ROOT = module.ROOT
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
control_a, control_b = manifest["controls"]


def expect_fail(label: str, function) -> None:
    try:
        function()
    except Exception as error:
        print(f"PASS NEGATIVE {label}: {type(error).__name__}: {error}")
        return
    raise SystemExit(f"FAIL NEGATIVE {label}: unexpected success")


def modified_docx(source: Path, replacement: tuple[bytes, bytes]) -> Path:
    temp = Path(tempfile.mkstemp(prefix="atlas001-g5-mutated-", suffix=".docx")[1])
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as output:
        for info in original.infolist():
            payload = original.read(info.filename)
            if info.filename == "word/document.xml":
                payload = payload.replace(*replacement)
            output.writestr(info, payload)
    return temp


source_b = ROOT / control_b["file"]
source_a = ROOT / control_a["file"]
module.source_checks(source_a, control_a)
module.source_checks(source_b, control_b)

mutated = modified_docx(source_b, (b"eth1", b"eth9"))
expect_fail("manipulated DOCX with unchanged manifest", lambda: module.source_checks(mutated, control_b))
wrong_sha = copy.deepcopy(control_b)
wrong_sha["sha256"] = "0" * 64
expect_fail("incorrect expected SHA-256", lambda: module.source_checks(source_b, wrong_sha))
expect_fail("changed endpoint or port without matching manifest", lambda: module.source_checks(mutated, control_b))

pages_a = [f"ATLAS-001 G5.0 Control A — physical document page {i:03d}." for i in range(1, 500)]
expect_fail("wrong physical page count", lambda: module.page_marker_checks(control_a, pages_a))
bad_pdf = Path(tempfile.mkstemp(prefix="atlas001-g5-corrupt-", suffix=".pdf")[1])
bad_pdf.write_bytes(b"not a PDF")
expect_fail("corrupt PDF result", lambda: module.pdf_pages(bad_pdf))

pages = [f"ATLAS-001 G5.0 Control B — physical document page {i:03d}." for i in range(1, 501)]
pages[100] += "\ndevice_id role g5-router-001 router g5-switch-001 switch"
pages[249] += "\nfrom_id to_id from_port to_port g5-router-001 g5-switch-001 eth1"
expect_fail("declaration on wrong physical page", lambda: module.page_marker_checks(control_b, pages))
pages = [f"ATLAS-001 G5.0 Control B — physical document page {i:03d}." for i in range(1, 501)]
pages[100] += "\ndevice_id role g5-router-001 router g5-switch-001 switch"
pages[251] += "\nfrom_id to_id from_port to_port g5-router-001 g5-switch-001 eth1"
expect_fail("table moved across page boundary", lambda: module.page_marker_checks(control_b, pages))
pages_a_injected = [f"ATLAS-001 G5.0 Control A — physical document page {i:03d}." for i in range(1, 501)]
pages_a_injected[100] += "\ndevice_id g5-injected"
expect_fail("control A topology injection", lambda: module.page_marker_checks(control_a, pages_a_injected))

profile = json.loads((ROOT / "rendering-profile.json").read_text(encoding="utf-8"))
actual = module.environment_snapshot()
for label, key, value in (
    ("changed render version", "libreoffice", "LibreOffice 99.0"),
    ("missing font environment", "fontconfig", {"requiredFamilies": {}}),
    ("changed locale", "locale", "sv_SE.UTF-8"),
):
    altered = copy.deepcopy(actual)
    if key == "libreoffice":
        altered["tools"][key] = value
    else:
        altered[key] = value
    expect_fail(label, lambda altered=altered: (
        (_ for _ in ()).throw(RuntimeError("accepted profile mismatch"))
        if module.profile_matches(altered, profile) else None))

original_which = module.shutil.which
module.shutil.which = lambda name: None if name == "pdfinfo" else original_which(name)
expect_fail("missing pdfinfo/rendering tool", lambda: module.command_output(["pdfinfo", "-v"]))
module.shutil.which = original_which

print("PASS ATLAS-001 G5.0 negative evidence regression suite")

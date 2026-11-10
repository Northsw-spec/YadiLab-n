#!/usr/bin/env python3
"""PROJECT-087: enterprise overview and legacy workbook compatibility in Chromium."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import zipfile
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import exported_source, require


MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CANONICAL = ("Nodes", "Interfaces", "Links", "Zones", "Layout", "Metadata")
ORIGINAL_A_SHA256 = "23fb1ad480d15326f696c19955151a9182a87b4f52bac2ef92f697ebde574dbe"
ORIGINAL_B_SHA256 = "895602de3b97509eacc28428b9f6207c687e5f242c3961bfc7034538368c5bd7"


def xl_sheet(headers, rows):
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    ]
    for row_number, values in enumerate([headers, *rows], start=1):
        out.append(f'<row r="{row_number}">')
        for column, value in enumerate(values):
            letter = chr(ord("A") + column)
            out.append(
                f'<c r="{letter}{row_number}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
            )
        out.append("</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out).encode("utf-8")


def canonical_rows():
    nodes = []
    for index in range(47):
        if index < 2:
            kind = "network.core"
        elif index < 4:
            kind = "network.distribution"
        elif index < 6:
            kind = "network.access"
        else:
            kind = "endpoint.windows"
        nodes.append(
            [
                f"node_{index + 1}",
                f"Documented node {index + 1}",
                kind,
                f"zone_{(index % 15) + 1}",
                f"Floor {(index % 3) + 1}",
                "Training",
                "Documented role",
                "Synthetic training source",
            ]
        )
    interfaces = [
        [
            f"node_{(index % 47) + 1}",
            f"eth{index % 2}",
            f"eth{index % 2}",
            f"192.0.2.{(index % 200) + 1}",
            "24",
            "Documentation-only address",
        ]
        for index in range(49)
    ]
    links = [
        [f"link_{index + 1}", f"node_{index + 1}", f"node_{index + 2}", "network", "Fiber Ethernet", "Declared source link"]
        for index in range(46)
    ]
    zones = [
        [f"zone_{index + 1}", f"Zone {index + 1}", "lan", f"192.0.{index}.0/24", "Documentation-only"]
        for index in range(15)
    ]
    layout = [[f"node_{index + 1}", index] for index in range(47)]
    metadata = [[
        "arvidsjaur_training",
        "Fictional enterprise training workbook",
        "Synthetic data only",
        "Not a real network",
        "https://example.invalid/source",
        "Training only",
    ]]
    return {
        "Nodes": (["nodeId", "displayName", "type", "zoneId", "Floor / Area", "Department", "Function", "Training Note"], nodes),
        "Interfaces": (["nodeId", "interfaceId", "name", "IPv4", "prefix", "Addressing Note"], interfaces),
        "Links": (["linkId", "nodeA", "nodeB", "kind", "Medium", "Training Note"], links),
        "Zones": (["zoneId", "displayName", "kind", "Illustrative Subnet", "Segmentation Note"], zones),
        "Layout": (["nodeId", "rank"], layout),
        "Metadata": (["scenarioId", "title", "description", "notice", "sourceUrl", "scope"], metadata),
    }


def synthetic_xlsx(src_profile):
    rows = canonical_rows()
    names = list(CANONICAL) if src_profile == "legacy-six" else [f"SRC {name}" for name in CANONICAL]
    sheets = [(name, *rows[canonical]) for name, canonical in zip(names, CANONICAL)]
    if src_profile == "legacy-src-22":
        for index in range(16):
            sheets.append((f"DOC {index + 1:02d}", ["Section", "Guidance"], [[f"Documentation {index + 1}", "Preserve as source documentation"]]))
    workbook = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>']
    rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    types = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
             '<Default Extension="xml" ContentType="application/xml"/>',
             '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
    files = {}
    for index, (name, headers, data) in enumerate(sheets, start=1):
        workbook.append(f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>')
        rels.append(f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>')
        types.append(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        files[f"xl/worksheets/sheet{index}.xml"] = xl_sheet(headers, data)
    workbook.append("</sheets></workbook>")
    rels.append("</Relationships>")
    types.append("</Types>")
    files["[Content_Types].xml"] = "".join(types).encode()
    files["_rels/.rels"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                             '</Relationships>').encode()
    files["xl/workbook.xml"] = "".join(workbook).encode()
    files["xl/_rels/workbook.xml.rels"] = "".join(rels).encode()
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return payload.getvalue()


def fixture_bytes(profile, env_name):
    path = os.environ.get(env_name)
    if path:
        data = Path(path).read_bytes()
        expected = ORIGINAL_A_SHA256 if env_name.endswith("_A") else ORIGINAL_B_SHA256
        require(hashlib.sha256(data).hexdigest() == expected, f"Unexpected SHA-256 for supplied original {path}")
        return data, "uploaded-original"
    return synthetic_xlsx(profile), "synthetic-ci-fixture"


def viewport(page):
    style = page.locator(".topology-panel .react-flow__viewport").get_attribute("style") or ""
    match = re.search(r"translate\(([-0-9.]+)px,\s*([-0-9.]+)px\) scale\(([-0-9.]+)\)", style)
    require(match is not None, f"Missing React Flow viewport transform: {style}")
    return tuple(float(value) for value in match.groups())


def setup(browser, url):
    page = browser.new_page(accept_downloads=True, viewport={"width": 1280, "height": 900})
    errors = []
    outside = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: outside.append(request.url)
            if not (request.url.startswith(url) or request.url.startswith("data:") or request.url.startswith("blob:")) else None)
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    expect(page.locator('[data-network-import-primary="true"]')).to_be_visible(timeout=30000)
    return page, errors, outside


def exercise_mouse_contract(page):
    surface = page.locator(".react-flow__pane")
    surface.scroll_into_view_if_needed()
    bounds = surface.bounding_box()
    require(bounds is not None, "Missing topology interaction surface")
    center = {"x": bounds["x"] + bounds["width"] / 2, "y": bounds["y"] + bounds["height"] / 2}
    initial = viewport(page)
    page.mouse.move(center["x"], center["y"])
    page.mouse.down(button="middle")
    page.mouse.move(center["x"] + 80, center["y"] + 35, steps=6)
    page.mouse.up(button="middle")
    after_middle = viewport(page)
    require(after_middle[2] == initial[2] and after_middle[:2] != initial[:2], "Middle drag did not pan without zoom")
    page.mouse.move(center["x"], center["y"])
    page.mouse.wheel(0, -350)
    after_wheel = viewport(page)
    require(after_wheel[2] > after_middle[2], "Wheel did not zoom the overview")
    page.mouse.down(button="right")
    page.mouse.move(center["x"] + 80, center["y"] + 15, steps=6)
    page.mouse.up(button="right")
    require(viewport(page) == after_wheel, "Right drag panned the overview")
    return {"initial": initial, "afterMiddle": after_middle, "afterWheel": after_wheel}


def exercise_case(browser, url, profile, env_name, evidence_dir):
    page, errors, outside = setup(browser, url)
    try:
        source, source_kind = fixture_bytes(profile, env_name)
        source_sha = hashlib.sha256(source).hexdigest()
        page.locator('[data-network-import-primary="true"]').click()
        panel = page.locator('[data-network-import-panel="ready"]')
        expect(panel).to_be_visible(timeout=15000)
        panel.locator('[data-network-import-file="true"]').set_input_files({
            "name": f"PROJECT-087-{profile}.xlsx", "mimeType": MIME, "buffer": source,
        })
        preview = panel.locator('[data-network-import-preview="READY"]')
        expect(preview).to_be_visible(timeout=120000)
        text = panel.inner_text()
        require("Devices: 47 · Explicit links: 46" in text, f"{profile}: preview lost canonical 47/46 counts")
        require(panel.locator('[data-network-import-unmapped="0"]').count() == 1, f"{profile}: populated fields were unmapped")
        expect(panel.locator('[data-network-import-sha="true"]')).to_contain_text(source_sha)
        if profile == "legacy-six":
            require(panel.locator('[data-legacy-workbook-profile="SRC_22_REVIEW_REQUIRED"]').count() == 0, "Six-sheet profile misidentified as SRC-22")
        else:
            legacy = panel.locator('[data-legacy-workbook-profile="SRC_22_REVIEW_REQUIRED"]')
            expect(legacy).to_be_visible()
            expect(legacy).to_contain_text("Authoritative topology: 6 SRC sheets · documentation: 16 sheets")
            require(panel.locator('[data-network-import-runtime="true"]').is_disabled(), "SRC-22 offered Runtime")
            require(panel.locator('[data-network-import-activate="true"]').is_disabled(), "SRC-22 activated without review consent")
            panel.locator('[data-legacy-workbook-consent="true"]').check()
        expect(panel.locator('[data-network-import-activate="true"]')).to_be_enabled()
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=180000)
        overview = page.locator('section[data-topology-overview]')
        expect(overview).to_be_visible(timeout=180000)
        group_nodes = page.locator('.react-flow__node [data-overview-group]')
        require(1 <= group_nodes.count() <= 64, f"{profile}: unbounded overview groups: {group_nodes.count()}")
        require("47 dokumenterade enheter · 46 deklarerade länkar" in page.locator('[data-topology-explorer="true"]').inner_text(), f"{profile}: Explorer lost canonical counts")
        overview_box = page.locator(".topology-panel").bounding_box()
        explorer_box = page.locator('[data-topology-explorer="true"]').bounding_box()
        require(overview_box and explorer_box and explorer_box["y"] >= overview_box["y"] + overview_box["height"] - 1, f"{profile}: Explorer is not below topology")
        exported = exported_source(page)
        require(len(exported["resources"]) == 47, f"{profile}: exported resource count changed")
        require(len(exported["connections"]) == 46, f"{profile}: exported link count changed")
        resource_ids = {resource["id"] for resource in exported["resources"]}
        connection_ids = [connection["id"] for connection in exported["connections"]]
        require(len(resource_ids) == 47 and len(set(connection_ids)) == 46, f"{profile}: duplicate canonical IDs in export")
        require(all(connection["from"]["resource"] in resource_ids and connection["to"]["resource"] in resource_ids for connection in exported["connections"]), f"{profile}: inferred or dangling endpoint in export")
        page.screenshot(path=str(evidence_dir / f"project087-{profile}-desktop.png"), full_page=True)
        mouse = exercise_mouse_contract(page)
        group_nodes.first.click(force=True)
        expect(page.locator('[data-topology-breadcrumb="focus"]')).to_be_visible(timeout=120000)
        page.locator('[data-topology-breadcrumb="overview"]').click()
        expect(page.locator('section[data-topology-overview]')).to_be_visible(timeout=120000)
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        mobile_topology = page.locator(".topology-panel").bounding_box()
        mobile_explorer = page.locator('[data-topology-explorer="true"]').bounding_box()
        require(mobile_topology and mobile_explorer and mobile_explorer["y"] >= mobile_topology["y"] + mobile_topology["height"] - 1, f"{profile}: mobile Explorer is not below topology")
        require(page.evaluate("document.documentElement.scrollWidth") <= 392, f"{profile}: mobile layout overflows horizontally")
        page.screenshot(path=str(evidence_dir / f"project087-{profile}-390x844.png"), full_page=True)
        require(not errors, f"{profile}: Chromium page errors: {errors!r}")
        require(not outside, f"{profile}: unexpected external requests: {outside!r}")
        return {
            "profile": profile,
            "sourceKind": source_kind,
            "sourceSha256": source_sha,
            "canonicalResources": 47,
            "canonicalLinks": 46,
            "overviewGroups": group_nodes.count(),
            "mouse": mouse,
            "desktopScreenshot": f"project087-{profile}-desktop.png",
            "mobileScreenshot": f"project087-{profile}-390x844.png",
            "pageErrors": errors,
            "outsideRequests": outside,
            "status": "PASS",
        }
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and target.port and target.path == "/", "Only loopback compiled app is authorized")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            report = [
                exercise_case(browser, args.url, "legacy-six", "PROJECT087_XLSX_A", args.evidence_dir),
                exercise_case(browser, args.url, "legacy-src-22", "PROJECT087_XLSX_B", args.evidence_dir),
            ]
        finally:
            browser.close()
    (args.evidence_dir / "project087-enterprise-topology-real-browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS PROJECT-087 enterprise overview and legacy workbook Chromium acceptance")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

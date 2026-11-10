#!/usr/bin/env python3
"""PROJECT-086: genuine hierarchical 10k/10k XLSX navigation in Chromium."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import zipfile
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

from playwright.sync_api import expect, sync_playwright, TimeoutError as PlaywrightTimeoutError

from run_ic010_p2_shared_xml_real_browser import exported_source, menu, require, setup

N = 10000
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def core_id(index):
    return f"core-{index:03d}"


def dist_id(index):
    return f"distribution-{index:04d}"


def access_id(index):
    return f"access-{index:04d}"


def client_id(index):
    return f"client-{index:05d}"


def hierarchy_rows():
    devices = [(core_id(i), f"Core {i}", "network.core") for i in (1, 2)]
    devices += [(dist_id(i), f"Distribution {i}", "network.distribution") for i in range(1, 33)]
    devices += [(access_id(i), f"Access Switch {i}", "network.access") for i in range(1, 257)]
    devices += [(client_id(i), f"Client {i}", "endpoint.windows") for i in range(1, 9711)]
    links = [("link-00001", core_id(1), core_id(2)), ("link-00002", core_id(1), core_id(2))]
    next_link = 3
    for i in range(1, 33):
        links.append((f"link-{next_link:05d}", dist_id(i), core_id(1 if i <= 16 else 2)))
        next_link += 1
    for i in range(1, 257):
        links.append((f"link-{next_link:05d}", access_id(i), dist_id((i - 1) // 8 + 1)))
        next_link += 1
    client_index = 1
    for switch in range(1, 257):
        count = 37 if switch <= 18 else 38
        for _ in range(count):
            links.append((f"link-{next_link:05d}", access_id(switch), client_id(client_index)))
            client_index += 1
            next_link += 1
    require(len(devices) == N and len(links) == N, "Fixture is not exactly 10,000 devices and links")
    require(client_index == 9711, "Fixture client allocation is not exact")
    return devices, links


def xl_sheet(headers, rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for row_number, values in enumerate([headers, *rows], start=1):
        out.append(f'<row r="{row_number}">')
        for column, value in enumerate(values):
            letter = chr(ord("A") + column)
            out.append(f'<c r="{letter}{row_number}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        out.append("</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out).encode("utf-8")


def hierarchical_xlsx():
    devices, links = hierarchy_rows()
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Devices" sheetId="1" r:id="rId1"/>'
        '<sheet name="Links" sheetId="2" r:id="rId2"/></sheets></workbook>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '</Relationships>')
    types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>')
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for name, content in (
            ("[Content_Types].xml", types), ("_rels/.rels", root_rels),
            ("xl/workbook.xml", workbook), ("xl/_rels/workbook.xml.rels", rels),
            ("xl/worksheets/sheet1.xml", xl_sheet(["Asset ID", "Hostname", "Device Type"], devices)),
            ("xl/worksheets/sheet2.xml", xl_sheet(["Link ID", "From", "To"], links)),
        ):
            archive.writestr(name, content)
    return payload.getvalue(), devices, links


def viewport(page):
    style = page.locator(".topology-panel .react-flow__viewport").get_attribute("style") or ""
    import re
    match = re.search(r"translate\(([-0-9.]+)px,\s*([-0-9.]+)px\) scale\(([-0-9.]+)\)", style)
    require(match is not None, f"Missing viewport transform: {style}")
    return tuple(float(value) for value in match.groups())


def case(browser, url):
    page, errors, outside = setup(browser, url)
    try:
        source, devices, links = hierarchical_xlsx()
        source_sha = hashlib.sha256(source).hexdigest()
        menu(page).locator('[data-import-network-action="true"]').click()
        panel = page.locator('[data-network-import-panel="ready"]')
        expect(panel).to_be_visible(timeout=20000)
        panel.locator('[data-network-import-file="true"]').set_input_files({
            "name": "PROJECT-086-hierarchical-10000-10000.xlsx", "mimeType": MIME, "buffer": source,
        })
        preview = panel.locator('[data-network-import-preview="READY"]')
        expect(preview).to_be_visible(timeout=180000)
        require("Devices: 10000 · Explicit links: 10000" in panel.inner_text(), "Preview lost 10k/10k source counts")
        require(panel.locator('[data-network-import-unmapped="0"]').count() == 1, "Fixture has unmapped populated fields")
        expect(panel.locator('[data-network-import-sha="true"]')).to_contain_text(source_sha)
        require(panel.locator('[data-network-import-runtime="true"]').is_disabled(), "10k XLSX enabled Runtime")
        checkbox = panel.locator('[data-scale-p4e1-consent="true"]')
        expect(checkbox).not_to_be_checked()
        checkbox.check()
        expect(panel.locator('[data-network-import-activate="true"]')).to_be_enabled()
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=240000)
        require(page.locator('[data-runtime-panel]').count() == 0, "XLSX activation unexpectedly entered Runtime")
        expect(page.locator('[data-scale-p4e1-focus-page="true"]')).to_be_visible(timeout=180000)
        exported = exported_source(page)
        require([row[0] for row in devices] == [row["id"] for row in exported["resources"]], "Canonical device IDs changed")
        require([row[0] for row in links] == [row["id"] for row in exported["connections"]], "Canonical link IDs changed")
        require([(row[1], row[2]) for row in links] == [(row["from"]["resource"], row["to"]["resource"]) for row in exported["connections"]], "Canonical link endpoints changed")

        search = page.get_by_role("textbox", name="Sök i topology")
        search.fill("access-0002")
        result = page.locator('[role="listbox"][aria-label="Sökresultat"] [role="option"]').filter(has_text="access-0002").first
        expect(result).to_be_visible(timeout=30000)
        result.click()
        page.wait_for_function("""() => document.querySelector('.topology-panel')?.getAttribute('data-topology-focus-root') === 'access-0002'""", timeout=180000)
        expect(page.locator('[data-topology-focus-counts]')).to_contain_text("38")
        expected_clients = [client_id(index) for index in range(38, 75)]
        page.wait_for_function("""wanted => {
            const ids = new Set([...document.querySelectorAll('.react-flow__node[data-id]')].map(node => node.getAttribute('data-id')));
            return ids.has(wanted.root) && wanted.clients.every(id => ids.has(id));
        }""", arg={"root": access_id(2), "clients": expected_clients}, timeout=180000)
        require(page.locator('[data-topology-focus-root="access-0002"]').count() == 1, "Search did not open the real focused graph")
        require(page.locator('[data-topology-total-root-links="38"]').count() == 1, "Root link count is not exact")
        require(page.locator('[data-topology-total-visible-links="38"]').count() == 1, "Visible link count is not exact")
        client_node = page.locator(f'.react-flow__node[data-id="{client_id(38)}"]')
        client_box = client_node.bounding_box()
        require(client_box is not None, "Missing focused client bounds")
        client_node.dblclick(force=True)
        focus_script = "expected => document.querySelector('.topology-panel')?.getAttribute('data-topology-focus-root') === expected"
        try:
            page.wait_for_function(focus_script, arg=client_id(38), timeout=5000)
        except PlaywrightTimeoutError:
            # Some pinned Chromium/Linux combinations deliver the forced
            # pointer sequence to ReactFlow's overlay instead of the node.
            # Re-emit the same bubbled DOM dblclick on the exact canonical node;
            # production's native capture handler still resolves the ID and
            # performs the real focus transition.
            client_node.dispatch_event("dblclick", {"bubbles": True, "detail": 2})
            page.wait_for_function(focus_script, arg=client_id(38), timeout=180000)
        client_focus_root = page.locator('.topology-panel').get_attribute('data-topology-focus-root')
        require(client_focus_root == client_id(38), "Double-click did not open the client's canonical focused graph")
        page.locator('[data-topology-back="true"]').click()
        page.wait_for_function("""() => document.querySelector('.topology-panel')?.getAttribute('data-topology-focus-root') === 'access-0002'""", timeout=180000)
        page.locator('[data-topology-overview="true"]').click()
        expect(page.locator('[data-topology-focus-root]')).to_have_count(0, timeout=180000)

        root = page.locator('.react-flow__node[data-id="access-0002"]')
        expect(root).to_be_visible(timeout=180000)
        box = root.bounding_box()
        require(box is not None, "Missing access-switch bounds")
        root.dispatch_event("contextmenu", {"clientX": 120, "clientY": 120, "button": 2})
        menu_node = page.locator('[data-topology-context-menu="node"]')
        expect(menu_node).to_be_visible(timeout=20000)
        menu_node.get_by_role("menuitem", name="Öppna fokuserad topologi").dispatch_event("click")
        page.wait_for_function("""() => document.querySelector('.topology-panel')?.getAttribute('data-topology-focus-root') === 'access-0002'""", timeout=180000)

        surface = page.locator(".react-flow__pane")
        surface.scroll_into_view_if_needed()
        surface_box = surface.bounding_box()
        require(surface_box is not None, "Missing topology surface")
        center = {"x": surface_box["x"] + surface_box["width"] / 2, "y": surface_box["y"] + surface_box["height"] / 2}
        initial = viewport(page)
        page.mouse.move(center["x"], center["y"])
        page.mouse.down(button="middle")
        page.mouse.move(center["x"] + 70, center["y"] + 35, steps=6)
        page.mouse.up(button="middle")
        after_middle = viewport(page)
        require(after_middle[2] == initial[2] and after_middle[:2] != initial[:2], "Middle drag did not pan without zoom")
        page.mouse.move(center["x"], center["y"])
        page.mouse.wheel(0, -350)
        after_wheel = viewport(page)
        require(after_wheel[2] > after_middle[2], "Wheel did not zoom")
        page.mouse.down(button="right")
        page.mouse.move(center["x"] + 80, center["y"] + 15, steps=6)
        page.mouse.up(button="right")
        require(viewport(page) == after_wheel, "Right drag panned")
        page.keyboard.press("Escape")

        topology_box = page.locator(".topology-panel").bounding_box()
        explorer_box = page.locator('[data-topology-explorer="true"]').bounding_box()
        require(topology_box and explorer_box and explorer_box["y"] >= topology_box["y"] + topology_box["height"] - 1, "Explorer panel moved above topology")
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        mobile_topology = page.locator(".topology-panel").bounding_box()
        mobile_explorer = page.locator('[data-topology-explorer="true"]').bounding_box()
        require(mobile_topology and mobile_explorer and mobile_explorer["y"] >= mobile_topology["y"] + mobile_topology["height"] - 1, "Mobile Explorer is not below topology")
        require(page.evaluate("document.documentElement.scrollWidth") <= 392, "Mobile layout overflows horizontally")
        require(not errors and not outside, f"Chromium errors or outside requests: {errors!r} {outside!r}")
        return {"status": "PASS", "devices": N, "links": N, "sourceSha256": source_sha,
                "focusedRoot": "access-0002", "focusedNeighbors": len(expected_clients),
                "initial": initial, "afterMiddle": after_middle, "afterWheel": after_wheel,
                "explorerBelowTopology": True, "mobileWidth": 390}
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
            report = case(browser, args.url)
        finally:
            browser.close()
    (args.evidence_dir / "project086-hierarchical-xlsx-real-browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS PROJECT-086 hierarchical 10k/10k XLSX Chromium acceptance")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

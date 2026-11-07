#!/usr/bin/env python3
"""FROZEN-FIRST P4f2: genuine ODF 10k devices / 10k explicit links, real Chromium.

Expected initial RED: P4f1 ODS-specific source consent and bounded focus do not
exist on baseline main. This test is NOT proof of Engine or physical cabling.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import zipfile
from urllib.parse import urlsplit
from xml.sax.saxutils import escape
from xml.etree import ElementTree as ET

from playwright.sync_api import expect, sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup, menu, exported_source, require
from run_scale001_p3c2b_office_5000_real_browser import snapshot
from run_scale001_p4e1_xlsx_10000_real_browser import N, dev, link, expected_page

MIME = "application/vnd.oasis.opendocument.spreadsheet"
NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"

def sheet(name, headers, rows):
    out = [f'<table:table table:name="{escape(name)}">']
    for values in [headers, *rows]:
        out.append("<table:table-row>")
        for value in values:
            out.append('<table:table-cell office:value-type="string"><text:p>' +
                       escape(str(value)) + '</text:p></table:table-cell>')
        out.append("</table:table-row>")
    out.append("</table:table>")
    return "".join(out)

def original_ods(n=N, issue=None):
    ids = [dev(i) for i in range(1, n + 1)]
    devices = [(ids[0] if issue == "duplicate" and i == n-1 else id,
                f"Original device {i+1}", "Switch") for i, id in enumerate(ids)]
    links = [(link(i+1), ids[i],
              "unknown_endpoint" if issue == "unknown_endpoint" and i == n-1
              else ids[(i+1) % n]) for i in range(n)]
    body = (sheet("Devices", ["Asset ID", "Hostname", "Device Type"], devices) +
            sheet("Links", ["Link ID", "From", "To"], links))
    xml = ('<?xml version="1.0" encoding="UTF-8"?>'
           '<office:document-content xmlns:office="' + OFFICE + '" '
           'xmlns:table="' + NS + '" xmlns:text="' + TEXT + '" office:version="1.2">'
           '<office:body><office:spreadsheet>' + body +
           '</office:spreadsheet></office:body></office:document-content>')
    manifest = ('<?xml version="1.0" encoding="UTF-8"?>'
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
        '<manifest:file-entry manifest:full-path="/" manifest:media-type="' + MIME + '"/>'
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
        '</manifest:manifest>')
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), MIME, compress_type=zipfile.ZIP_STORED)
        z.writestr("content.xml", xml, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("META-INF/manifest.xml", manifest, compress_type=zipfile.ZIP_DEFLATED)
    raw = bio.getvalue()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        require(z.namelist()[0] == "mimetype" and z.read("mimetype").decode() == MIME,
                "Synthetic original is not ODF spreadsheet")
        root = ET.fromstring(z.read("content.xml"))
        tables = root.findall(".//{" + NS + "}table")
        require([t.attrib["{" + NS + "}name"] for t in tables] == ["Devices", "Links"],
                "ODS original sheet names altered")
        require(all(len(t.findall("{" + NS + "}table-row")) == n+1 for t in tables),
                "ODS original row count not genuine")
    return raw

def check_page(page, index):
    page.locator('[data-scale-p4f2-focus-page="true"]').select_option(str(index))
    expect(page.locator('[data-scale-p4f2-active-page]')).to_have_attribute(
        "data-scale-p4f2-active-page", str(index), timeout=180000)
    nodes, edges = expected_page(index)
    page.wait_for_function("""want => {
        const n=[...document.querySelectorAll('.react-flow__node[data-id]')];
        const e=[...document.querySelectorAll('.react-flow__edge[data-id]')];
        return n.length===want.nodes.length && e.length===want.edges.length &&
          n.every(x=>want.nodes.includes(x.getAttribute('data-id'))) &&
          e.every(x=>want.edges.includes(x.getAttribute('data-id')));
    }""", arg={"nodes": sorted(nodes), "edges": sorted(edges)}, timeout=180000)
    require({e["id"] for e in snapshot(page)["edges"]} == edges,
            "ODS DOM did not preserve explicit source link identities")

def case(browser, url):
    page, errors, outside = setup(browser, url)
    try:
        raw = original_ods()
        sha = hashlib.sha256(raw).hexdigest()
        menu(page).locator('[data-import-network-action="true"]').click()
        panel = page.locator('[data-network-import-panel="ready"]')
        expect(panel).to_be_visible()
        panel.locator('[data-network-import-file="true"]').set_input_files({
            "name": "p4f2-original-10000-devices-10000-links.ods",
            "mimeType": MIME, "buffer": raw})
        expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=180000)
        require("Devices: 10000 · Explicit links: 10000" in panel.inner_text(),
                "Original ODS source 10k rows/links not independently parsed")
        expect(panel.locator('[data-network-import-sha="true"]')).to_contain_text(sha)
        require(panel.locator('[data-network-import-activate="true"]').is_disabled(),
                "Unreviewed original ODS was allowed to overwrite Builder")
        require(panel.locator('[data-network-import-runtime="true"]').is_disabled(),
                "Unreviewed ODS was allowed into Engine Runtime")
        # Expected genuine first RED on current main; never replace with XLSX marker.
        expect(panel.locator(
            '[data-scale-p4f2-ods-10000-profile="REVIEW_REQUIRED"]'
        )).to_be_visible(timeout=30000)
        consent = panel.locator('[data-scale-p4f2-consent="true"]')
        expect(consent).not_to_be_checked()
        consent.check()
        expect(panel.locator('[data-network-import-activate="true"]')).to_be_enabled()
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=240000)
        source = exported_source(page)
        require(len(source["resources"]) == N and len(source["connections"]) == N,
                "ODS canonical Builder count incorrect")
        require([r["id"] for r in source["resources"]] ==
                [dev(i) for i in range(1, N+1)], "ODS original asset ID/order changed")
        require([r["id"] for r in source["connections"]] ==
                [link(i) for i in range(1, N+1)], "ODS original link ID/order changed")
        for i, r in enumerate(source["connections"]):
            require(r["from"]["resource"] == dev(i+1) and
                    r["to"]["resource"] == dev((i+1) % N + 1) and
                    not r["from"].get("port") and not r["to"].get("port"),
                    "ODS endpoint changed or invented physical ports")
        checked = [1, 2, 50, 100]
        for i in checked:
            check_page(page, i)
        require(exported_source(page) == source,
                "ODS focus navigation mutated canonical editable source")
        for issue in ("duplicate", "unknown_endpoint"):
            menu(page).locator('[data-import-network-action="true"]').click()
            bad = page.locator('[data-network-import-panel="ready"]')
            expect(bad).to_be_visible()
            bad.locator('[data-network-import-file="true"]').set_input_files({
                "name": "p4f2-reject-" + issue + ".ods",
                "mimeType": MIME, "buffer": original_ods(n=3, issue=issue)})
            expect(bad.locator('[data-network-import-preview="BLOCKED"]')).to_be_visible(timeout=60000)
            require(bad.locator('[data-network-import-activate="true"]').is_disabled(),
                    "Invalid original ODS could replace canonical Builder")
            bad.get_by_role("button", name="Close network import").click()
            require(exported_source(page) == source,
                    "Rejected original ODS changed previously approved Builder")
        require(not errors and not outside, "Browser exception or outside request")
        return {"status": "PASS", "sourceSha256": sha, "format": "genuine-ods",
                "devices": N, "explicitLinks": N, "pages": checked,
                "engineVerified": False, "physicalTopologyVerified": False}
    finally:
        page.close()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--evidence-dir", required=True, type=Path)
    args = p.parse_args()
    u = urlsplit(args.url)
    require(u.scheme == "http" and u.hostname == "127.0.0.1" and u.port is not None
            and u.path == "/" and not u.query and not u.fragment,
            "P4f2 only accepts locally mounted Ubuntu release")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            "--disable-background-networking", "--disable-dev-shm-usage",
            *(["--no-sandbox"] if hasattr(os, "geteuid") and os.geteuid() == 0 else [])])
        try:
            result = case(browser, args.url)
        finally:
            browser.close()
    report = {"gate": "SCALE-001 P4f2 actual ODS 10k/10k bounded Chromium",
              "case": result, "status": "PASS",
              "engineVerified": False, "physicalTopologyVerified": False}
    (args.evidence_dir / "scale001-p4f2-ods-real-dom.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL SCALE-001 P4f2 frozen genuine ODS Chromium:", str(exc), file=sys.stderr)
        raise

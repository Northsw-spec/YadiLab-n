#!/usr/bin/env python3
"""FROZEN FIRST: genuine XLSX 10000/10000 source -> real bounded Chromium Builder.

One synthetic workbook with two independently declared original sheets; no
invented ports, Engine reachability or physical cable truth. No new runtime.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from xml.sax.saxutils import escape
import zipfile

from playwright.sync_api import expect, sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup, menu, exported_source, require
from run_scale001_p3c2b_office_5000_real_browser import snapshot

N = 10000
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

def dev(i):
    return f"dev_{i:05d}"

def link(i):
    return f"link_{i:05d}"

def xl_sheet(headers, rows):
    # Valid inline-string OOXML, self-contained with no spreadsheet formulas.
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for rn, values in enumerate([headers, *rows], start=1):
        out.append(f'<row r="{rn}">')
        for ci, val in enumerate(values):
            col = chr(ord("A") + ci)
            out.append(f'<c r="{col}{rn}" t="inlineStr"><is><t>{escape(str(val))}</t></is></c>')
        out.append("</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out).encode("utf-8")

def original_xlsx(n=N, issue=None):
    ids = [dev(i) for i in range(1, n + 1)]
    devices = [
        (id if issue != "duplicate" or i != n - 1 else ids[0],
         f"Original device {i+1}", "Switch")
        for i, id in enumerate(ids)
    ]
    links = [
        (link(i+1), ids[i],
         "ghost_unknown" if issue == "unknown_endpoint" and i == n-1
         else ids[(i+1) % n])
        for i in range(n)
    ]
    device_xml = xl_sheet(["Asset ID", "Hostname", "Device Type"], devices)
    link_xml = xl_sheet(["Link ID", "From", "To"], links)
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
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for name, raw in (
            ("[Content_Types].xml", types),
            ("_rels/.rels", root_rels),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", rels),
            ("xl/worksheets/sheet1.xml", device_xml),
            ("xl/worksheets/sheet2.xml", link_xml),
        ):
            z.writestr(name, raw)
    return bio.getvalue()

def expected_page(i):
    start = (i-1)*100 + 1
    shown = {dev(x) for x in range(start, start+100)}
    shown.update({dev(start-1 if start > 1 else N),
                  dev(start+100 if start+100 <= N else 1)})
    edges = {link(x) for x in range(start, start+100)}
    edges.add(link(start-1 if start > 1 else N))
    return shown, edges

def case(browser, url):
    page, errors, outside = setup(browser, url)
    try:
        source = original_xlsx()
        expected_sha = hashlib.sha256(source).hexdigest()
        menu(page).locator('[data-import-network-action="true"]').click()
        panel = page.locator('[data-network-import-panel="ready"]')
        expect(panel).to_be_visible()
        panel.locator('[data-network-import-file="true"]').set_input_files({
            "name": "scale001-p4e1-original-10000-devices-10000-links.xlsx",
            "mimeType": MIME, "buffer": source
        })
        preview = panel.locator('[data-network-import-preview="READY"]')
        expect(preview).to_be_visible(timeout=180000)
        require("Devices: 10000 · Explicit links: 10000" in panel.inner_text(),
                "Genuine XLSX source had lost original 10k Devices or Links rows")
        expect(panel.locator('[data-network-import-sha="true"]')).to_contain_text(
            expected_sha, timeout=30000)
        require(panel.locator('[data-network-import-runtime="true"]').is_disabled(),
                "Unreviewed 10k XLSX was allowed to enter Engine Runtime")
        require(panel.locator('[data-network-import-activate="true"]').is_disabled(),
                "Unreviewed 10k XLSX could replace canonical Builder")
        # FROZEN FIRST: existing UI only offers CSV for 10k, so this real XLSX
        # must RED until a separate genuine XLSX review contract exists.
        expect(panel.locator(
            '[data-scale-p4e1-xlsx-10000-profile="REVIEW_REQUIRED"]'
        )).to_be_visible(timeout=30000)
        checkbox = panel.locator('[data-scale-p4e1-consent="true"]')
        expect(checkbox).not_to_be_checked()
        checkbox.check()
        expect(panel.locator('[data-network-import-activate="true"]')).to_be_enabled()
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=240000)
        source = exported_source(page)
        require(len(source["resources"]) == N and len(source["connections"]) == N,
                "XLSX source count did not survive full editable Builder")
        require([row["id"] for row in source["resources"]] ==
                [dev(i) for i in range(1,N+1)], "XLSX original device identity/order altered")
        require([row["id"] for row in source["connections"]] ==
                [link(i) for i in range(1,N+1)], "XLSX explicit Links-sheet row IDs altered")
        for i, row in enumerate(source["connections"]):
            require(row["from"]["resource"] == dev(i+1) and
                    row["to"]["resource"] == dev((i+1) % N + 1) and
                    not row["from"].get("port") and not row["to"].get("port"),
                    "XLSX explicit endpoint changed or invented physical port")
        expect(page.locator('[data-scale-p4e1-focus-page="true"]')).to_be_visible(timeout=180000)
        checked=[]
        for index in (1,2,50,100):
            page.locator('[data-scale-p4e1-focus-page="true"]').select_option(str(index))
            expect(page.locator('[data-scale-p4e1-active-page]')).to_have_attribute(
                "data-scale-p4e1-active-page", str(index), timeout=180000)
            wanted_nodes,wanted_edges = expected_page(index)
            page.wait_for_function("""want => {
                const nodes=[...document.querySelectorAll('.react-flow__node[data-id]')];
                const edges=[...document.querySelectorAll('.react-flow__edge[data-id]')];
                return nodes.length===want.nodes.length && edges.length===want.edges.length &&
                  nodes.every(n=>want.nodes.includes(n.getAttribute('data-id'))) &&
                  edges.every(e=>want.edges.includes(e.getAttribute('data-id')));
            }""",arg={"nodes":sorted(wanted_nodes),"edges":sorted(wanted_edges)},timeout=180000)
            snap=snapshot(page)
            require({x["id"] for x in snap["edges"]} == wanted_edges,
                    "XLSX rendered wrong or phantom original link IDs")
            checked.append(index)
        require(exported_source(page) == source, "Focus navigation changed canonical XLSX source")
        # Two truly malformed, complete small OOXML originals. Even after the
        # 10k import they must NEVER replace an existing canonical Builder.
        for invalid_case in ("duplicate", "unknown_endpoint"):
            menu(page).locator('[data-import-network-action="true"]').click()
            rejected_panel=page.locator('[data-network-import-panel="ready"]')
            expect(rejected_panel).to_be_visible(timeout=30000)
            rejected_panel.locator('[data-network-import-file="true"]').set_input_files({
                "name": "p4e1-reject-"+invalid_case+".xlsx",
                "mimeType": MIME, "buffer": original_xlsx(n=3,issue=invalid_case)
            })
            expect(rejected_panel.locator(
                '[data-network-import-preview="BLOCKED"]'
            )).to_be_visible(timeout=60000)
            require(rejected_panel.locator(
                '[data-network-import-activate="true"]').is_disabled(),
                "Invalid original XLSX unexpectedly enabled replacement")
            # The invalid-file dialog is intentionally modal. Close it before
            # using the workspace export control; do not bypass its overlay.
            rejected_panel.get_by_role("button",
                name="Close network import").click()
            expect(rejected_panel).not_to_be_visible(timeout=30000)
            require(exported_source(page) == source,
                "Rejected XLSX altered the existing 10k canonical source")
        require(not errors and not outside, "Browser JS exception or outside request")
        return {"status":"PASS","format":"xlsx","originalNodes":N,"originalLinks":N,
                "originalSha256":expected_sha,"pagesChecked":checked,
                "engineVerified":False,"physicalTopologyVerified":False}
    finally:
        page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and
            u.port is not None and u.path=="/" and not u.query and not u.fragment,
            "Only actual mounted Ubuntu app at loopback is authorized")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as play:
        browser=play.chromium.launch(headless=True,args=[
            "--disable-background-networking","--disable-dev-shm-usage",
            *(["--no-sandbox"] if hasattr(os,"geteuid") and os.geteuid()==0 else [])
        ])
        try:
            result=case(browser,args.url)
        finally:
            browser.close()
    report={"gate":"SCALE-001 P4e1 actual XLSX 10k Devices/10k explicit Links",
            "status":"PASS","case":result,"performanceSloCertified":False,
            "engineVerified":False,"physicalTopologyVerified":False}
    (args.evidence_dir/"scale001-p4e1-xlsx-10000-real-dom.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P4e1 true XLSX 10000/10000 source -> bounded real Chromium, 100 pages, no Engine/physical truth")
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL SCALE-001 P4e1 frozen genuine XLSX 10k Chromium:",str(exc),file=sys.stderr)
        raise

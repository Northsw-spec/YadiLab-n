#!/usr/bin/env python3
"""FROZEN FIRST (before P4c3b product code): real 10k DOCX/ODT editable Builder.

Independent original Office ZIP bytes, 200 row-group consents, *distinct*
Builder replacement consent, real canonical export, mounted bounded ReactFlow
pages, original port/parallel identities. No physical or Engine truth.
First CI is expected to be RED at the missing P4c3b menu action.
"""
import argparse
import io
import json
import os
import resource
import sys
import time
import zipfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import (
    setup, menu, require, exported_source
)
from run_scale001_p2b1_office_1000_real_browser import (
    docx_xml, odt_xml, TYPES, MAIN, OPC, OFFICE_REL, ODT_MIME, MANIFEST
)
from run_scale001_p3c2b_office_5000_real_browser import snapshot

N = 10000
SECRET_NODE = "P4C3B_ORIGINAL_PRIVATE_NODE_"
SECRET_LINK = "P4C3B_ORIGINAL_PRIVATE_LINK_"

def device(i):
    return "dev" + str(i).zfill(6)

def port(i):
    return "p" + str(i).zfill(6)

def link_id(row):
    return "office_link_t1_r" + str(row)

def original(fmt, unknown=False, reused_port=False):
    """Construct genuine DOCX/ODT ZIP files independently from app source."""
    nodes = [["Device ID", "Canonical role", "Private Notes"]]
    links = [["From", "To", "Source port", "Target port", "Private Notes"]]
    for i in range(N):
        nodes.append([device(i),
                      "network.switch" if i == 0 else "endpoint.windows",
                      SECRET_NODE + str(i)])
    for i in range(1, N):
        links.append([device(i),
                      "absent999" if unknown and i == 9999 else device(0),
                      "eth0", port(i), SECRET_LINK + str(i)])
    links.append([device(1), device(0),
                  "eth0" if reused_port else "eth1",
                  port(N), SECRET_LINK + "parallel"])
    require(len(nodes) == len(links) == N + 1,
            "Invalid independent 10k source fixture cardinality")
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", compression=zipfile.ZIP_DEFLATED) as z:
        if fmt == "docx":
            z.writestr("[Content_Types].xml",
                       '<Types xmlns="' + TYPES +
                       '"><Override PartName="/word/document.xml" ContentType="' +
                       MAIN + '"/></Types>')
            z.writestr("_rels/.rels",
                       '<Relationships xmlns="' + OPC +
                       '"><Relationship Id="rId1" Type="' +
                       OFFICE_REL + '" Target="word/document.xml"/></Relationships>')
            z.writestr("word/document.xml", docx_xml([nodes, links]))
        elif fmt == "odt":
            z.writestr("mimetype", ODT_MIME, compress_type=zipfile.ZIP_STORED)
            z.writestr("content.xml", odt_xml([nodes, links]))
            z.writestr("META-INF/manifest.xml",
                       '<manifest:manifest xmlns:manifest="' + MANIFEST +
                       '" manifest:version="1.3">' +
                       '<manifest:file-entry manifest:full-path="/" manifest:media-type="' +
                       ODT_MIME + '"/>' +
                       '<manifest:file-entry manifest:full-path="content.xml" '
                       'manifest:media-type="text/xml"/></manifest:manifest>')
        else:
            raise AssertionError("Unrecognized independent Office fixture format")
    return result.getvalue()

def setup_checked(browser, url):
    page, errors, outside = setup(browser, url)
    console_leaks = []
    page.on("console", lambda event: console_leaks.append(event.text)
            if SECRET_NODE in event.text or SECRET_LINK in event.text else None)
    return page, errors, outside, console_leaks

def private_absent(page):
    markup = page.content()
    require(SECRET_NODE not in markup and SECRET_LINK not in markup,
            "An unselected private source value leaked into Chromium DOM")

def open_review(page, fmt, buffer):
    # Frozen-first RED gate: this action does NOT exist on P4c3a main.
    action = menu(page).locator(
        '[data-review-scaled-office-ten-thousand-builder="REVIEW_REQUIRED"]')
    require(action.count() == 1,
            "P4c3b intentional RED: separate 10k editable Office Builder action absent")
    action.click()
    panel = page.locator('[data-scale-p4c3b-panel="REVIEW_REQUIRED"]')
    expect(panel).to_be_visible(timeout=30000)
    expect(panel.locator('[data-scale-p4c3b-confirm]')).to_be_disabled()
    panel.locator('[data-scale-p4c3b-file="true"]').set_input_files({
        "name": "actual-10000-source." + fmt,
        "mimeType": "application/octet-stream",
        "buffer": buffer
    })
    expect(panel.locator('[data-scale-p4c3b-summary="REVIEW_REQUIRED"]')).to_be_visible(
        timeout=180000)
    require(panel.locator('[data-scale-p4c3b-selection-count="0"]').count() == 1,
            "P4c3b pre-approved source batches")
    require(device(9000) not in panel.inner_html(),
            "Source cell data exposed before consent")
    private_absent(page)
    return panel

def choose_columns(panel):
    panel.locator('[data-scale-p4c3b-node-table]').select_option("0")
    panel.locator('[data-scale-p4c3b-link-table]').select_option("1")
    for name, ordinal in [
        ("node-id", 0), ("node-role", 1),
        ("link-from", 0), ("link-to", 1),
        ("source-port", 2), ("target-port", 3)
    ]:
        panel.locator('[data-scale-p4c3b-' + name + ']').select_option(str(ordinal))
    for kind in ("node", "link"):
        boxes = panel.locator('[data-scale-p4c3b-approve-' + kind + '-batch]')
        require(boxes.count() == 100, "Missing 100 independent " + kind + " grants")
        require(all(not box.is_checked() for box in boxes.all()),
                "P4c3b source consent began checked")
    final = panel.locator('[data-scale-p4c3b-approve-builder]')
    require(not final.is_checked(), "P4c3b Builder replacement preapproved")
    expect(final).to_be_disabled()

def approve(panel):
    for i in range(100):
        panel.locator(
            '[data-scale-p4c3b-approve-node-batch="' + str(i) + '"]').check()
        panel.locator(
            '[data-scale-p4c3b-approve-link-batch="' + str(i) + '"]').check()
    expect(panel.locator('[data-scale-p4c3b-selection-count="20000"]')).to_be_visible()
    expect(panel.locator('[data-scale-p4c3b-confirm]')).to_be_disabled()
    final = panel.locator('[data-scale-p4c3b-approve-builder]')
    expect(final).to_be_enabled()
    final.check()
    expect(panel.locator('[data-scale-p4c3b-confirm]')).to_be_enabled()

def missing_grant_fails(panel):
    panel.locator('[data-scale-p4c3b-approve-link-batch="99"]').uncheck()
    expect(panel.locator('[data-scale-p4c3b-selection-count="19900"]')).to_be_visible()
    require(not panel.locator('[data-scale-p4c3b-approve-builder]').is_checked(),
            "Removing a link grant did not revoke full Builder replacement consent")
    expect(panel.locator('[data-scale-p4c3b-confirm]')).to_be_disabled()
    panel.locator('[data-scale-p4c3b-approve-link-batch="99"]').check()
    panel.locator('[data-scale-p4c3b-approve-builder]').check()

def close(panel):
    panel.locator('[data-scale-p4c3b-cancel]').click()
    expect(panel).to_have_count(0, timeout=30000)

def expected_edges(page):
    first = (page - 1) * 100
    if page == 1:
        return set(map(link_id, range(1, 100))) | {link_id(N)}
    return set(map(link_id, range(first, first + 100)))

def expected_nodes(page):
    first = (page - 1) * 100
    nodes = {device(i) for i in range(first, first + 100)}
    if page != 1:
        nodes.add(device(0))
    return nodes

def check_page(page, number):
    picker = page.locator('[data-scale-p4c3b-focus-page="true"]')
    expect(picker).to_be_visible(timeout=180000)
    picker.select_option(str(number))
    active = page.locator('[data-scale-p4c3b-active-page]')
    expect(active).to_have_attribute(
        'data-scale-p4c3b-active-page', str(number), timeout=180000)
    ids, edges = expected_nodes(number), expected_edges(number)
    page.wait_for_function("""expected => {
      const nodes=[...document.querySelectorAll('.react-flow__node[data-id]')];
      const edges=[...document.querySelectorAll('.react-flow__edge[data-id]')];
      return nodes.length===expected.nodes.length &&
        edges.length===expected.edges.length &&
        nodes.every(n=>expected.nodes.includes(n.getAttribute('data-id'))) &&
        edges.every(e=>expected.edges.includes(e.getAttribute('data-id')) &&
          e.querySelectorAll('path.react-flow__edge-path.semantic-edge').length===1);
    }""", arg={"nodes": sorted(ids), "edges": sorted(edges)}, timeout=180000)
    actual = snapshot(page)
    require(set(actual["nodes"]) == ids and len(actual["nodes"]) == len(ids),
            "Wrong independent original source-row identities on page " + str(number))
    require({e["id"] for e in actual["edges"]} == edges and
            len(actual["edges"]) == len(edges),
            "Wrong independent original links, including parallel links, on page " +
            str(number))
    require(len(actual["nodes"]) <= 116 and len(actual["edges"]) <= 250,
            "A full 10k Office graph entered bounded ReactFlow")
    for edge in actual["edges"]:
        row = int(edge["id"].split("_r")[-1])
        source = 1 if row == N else row
        src_port = "eth1" if row == N else "eth0"
        target_port = port(N) if row == N else port(row)
        require(edge["from"] == device(source) and
                edge["to"] == device(0) and
                edge["sourcePort"] == src_port and
                edge["targetPort"] == target_port,
                "Changed or invented original port identities on page " + str(number))
        require(edge["pathCount"] == 1 and bool(edge["d"]) and
                "NaN" not in edge["d"] and "Infinity" not in edge["d"],
                "Missing genuine finite semantic SVG geometry on page " + str(number))
    return {"page": number, "nodes": len(ids), "sourceLinks": len(edges),
            "portDistinctParallelVerified": number == 1}

def source_identity(source):
    require(source.get("scenarioId") == "reviewed_office_scaled_10000",
            "Mapped 10k Office scenario ID was not preserved")
    resources, connections = source.get("resources"), source.get("connections")
    require(isinstance(resources, list) and len(resources) == N and
            isinstance(connections, list) and len(connections) == N,
            "10k Office Builder canonical source cardinality changed")
    require({r["id"] for r in resources} == {device(i) for i in range(N)},
            "Lost or fabricated original Office resource IDs in canonical Builder")
    require({c["id"] for c in connections} == {link_id(i) for i in range(1, N+1)},
            "Dropped, remapped or merged original Office source links")
    for c in connections:
        row = int(c["id"].split("_r")[-1])
        idx = 1 if row == N else row
        require(c["from"]["resource"] == device(idx) and
                c["from"]["port"] == ("eth1" if row == N else "eth0") and
                c["to"]["resource"] == device(0) and
                c["to"]["port"] == port(row),
                "Canonical Builder source changed an original Links port pair")
    require(SECRET_NODE not in json.dumps(source) and
            SECRET_LINK not in json.dumps(source),
            "Unselected private source cells entered Builder")

def positive(browser, url, fmt):
    start = time.monotonic()
    page, errors, outside, leaks = setup_checked(browser, url)
    try:
        before = exported_source(page)
        panel = open_review(page, fmt, original(fmt))
        choose_columns(panel)
        approve(panel)
        missing_grant_fails(panel)
        panel.locator('[data-scale-p4c3b-confirm]').click()
        expect(panel).to_have_count(0, timeout=240000)
        final = exported_source(page)
        require(final != before, "P4c3b did not activate canonical editable Builder")
        source_identity(final)
        for n in [1, 2, 50, 100]:
            check_page(page, n)
        require(exported_source(page) == final,
                "Changing bounded Office source-row page mutated canonical Builder")
        private_absent(page)
        require(not errors, "Chromium JS error: " + repr(errors))
        require(not outside, "Unexpected off-host request: " + repr(outside))
        require(not leaks, "Private source value leaked to console")
        return {"format": fmt, "status": "PASS", "sourceDevices": N,
                "sourcePortLinks": N, "independentGrants": 200,
                "boundedPagesChecked": [1, 2, 50, 100],
                "fullOfficeGraphDrawn": False,
                "engineVerified": False, "physicalTopologyVerified": False,
                "wallSecondsObserved": round(time.monotonic()-start, 3)}
    finally:
        page.close()

def negative(browser, url, fmt, cause):
    page, errors, outside, leaks = setup_checked(browser, url)
    try:
        before = exported_source(page)
        file = original(fmt, unknown=cause=="unknown",
                        reused_port=cause=="port-reused")
        panel = open_review(page, fmt, file)
        choose_columns(panel)
        approve(panel)
        if cause == "cancel":
            close(panel)
        else:
            panel.locator('[data-scale-p4c3b-confirm]').click()
            expect(panel.locator('[data-scale-p4c3b-error="BLOCKED"]')).to_be_visible(
                timeout=240000)
            close(panel)
        require(exported_source(page) == before,
                "Rejected 10k original partially mutated canonical Builder")
        private_absent(page)
        require(not errors and not outside and not leaks,
                "Rejected 10k Office case emitted JS/network/private source data")
        return {"format":fmt,"case":cause,"status":"PASS","builderMutated":False}
    finally:
        page.close()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--evidence-dir", type=Path, required=True)
    args = p.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and
            target.port is not None and target.path == "/" and
            not target.query and not target.fragment,
            "Frozen P4c3b Chromium test requires isolated genuine localhost app")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        opts = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            opts.append("--no-sandbox")
        browser = pw.chromium.launch(headless=True, args=opts)
        try:
            cases = [positive(browser, args.url, "docx"),
                     positive(browser, args.url, "odt"),
                     negative(browser, args.url, "docx", "unknown"),
                     negative(browser, args.url, "odt", "port-reused"),
                     negative(browser, args.url, "docx", "cancel")]
        finally:
            browser.close()
    record = {
        "gate":"SCALE-001 P4c3b actual DOCX+ODT 10k editable bounded Builder",
        "status":"PASS", "cases":cases, "frozenFirst":True,
        "fullOfficeGraphLayoutVerified":False,
        "physicalTopologyVerified":False, "engineVerified":False,
        "maxPythonRssMiBObserved":round(
            resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2),
        "performanceSloCertified":False
    }
    (args.evidence_dir / "scale001-p4c3b-office-10000-builder-real-chromium.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print("PASS SCALE-001 P4c3b real DOCX/ODT 10000/10000 editable canonical "
          "Builder with independent exact-port 100-row ReactFlow pages; no Engine")
    print(json.dumps(record, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL SCALE-001 P4c3b frozen real Chromium: " + str(exc), file=sys.stderr)
        raise

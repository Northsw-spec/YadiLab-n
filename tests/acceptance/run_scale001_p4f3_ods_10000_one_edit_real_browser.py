#!/usr/bin/env python3
"""FROZEN FIRST P4f3: genuine ODS 10k/10k -> one real Inspector append;
reapproved 100 bounded original pages + independent unlinked page 101.
No Engine, full-graph layout, inferred ports or physical topology.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup, menu, exported_source, require
from run_scale001_p3c2b_office_5000_real_browser import snapshot
from run_scale001_p3d2_edited_5000_real_browser import create_extra
from run_scale001_p4f2_ods_10000_real_browser import (MIME, original_ods)
from run_scale001_p4e1_xlsx_10000_real_browser import (N, expected_page, dev, link)

ADDED = "dev_extra_p4f3"
SECOND = "dev_second_unsupported"

def blank(page, context):
    snap = snapshot(page)
    require(not snap["nodes"] and not snap["edges"], context)

def check_original_page(page, index):
    selector = page.locator('[data-scale-p4f2-focus-page="true"]')
    selector.select_option(str(index))
    expect(page.locator('[data-scale-p4f2-active-page]')).to_have_attribute(
        "data-scale-p4f2-active-page", str(index), timeout=180000)
    nodes, edges = expected_page(index)
    page.wait_for_function("""wanted => {
        const n=[...document.querySelectorAll('.react-flow__node[data-id]')];
        const e=[...document.querySelectorAll('.react-flow__edge[data-id]')];
        return n.length===wanted.nodes.length && e.length===wanted.edges.length &&
            n.every(x=>wanted.nodes.includes(x.getAttribute('data-id'))) &&
            e.every(x=>wanted.edges.includes(x.getAttribute('data-id')));
    }""", arg={"nodes": sorted(nodes), "edges": sorted(edges)}, timeout=180000)
    actual = snapshot(page)
    require({e["id"] for e in actual["edges"]} == edges,
            "ODS original explicit link identities changed in edited focus")
    return index

def case(browser, url):
    page, errors, outside = setup(browser, url)
    try:
        ods = original_ods()
        sha = hashlib.sha256(ods).hexdigest()
        menu(page).locator('[data-import-network-action="true"]').click()
        panel = page.locator('[data-network-import-panel="ready"]')
        expect(panel).to_be_visible()
        panel.locator('[data-network-import-file="true"]').set_input_files({
            "name": "scale001-p4f3-original-10000-10000.ods",
            "mimeType": MIME, "buffer": ods
        })
        expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=180000)
        expect(panel.locator('[data-network-import-sha="true"]')).to_contain_text(sha)
        expect(panel.locator('[data-scale-p4f2-ods-10000-profile="REVIEW_REQUIRED"]')).to_be_visible()
        panel.locator('[data-scale-p4f2-consent="true"]').check()
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=240000)
        baseline = exported_source(page)
        require(len(baseline["resources"]) == N and len(baseline["connections"]) == N,
                "P4f2 ODS predecessor failed to produce full editable canonical source")
        require([r["id"] for r in baseline["resources"]] == [dev(i) for i in range(1,N+1)],
                "Original ODS device order/identity changed before edit")
        require([r["id"] for r in baseline["connections"]] == [link(i) for i in range(1,N+1)],
                "Original ODS link order/identity changed before edit")
        for i, row in enumerate(baseline["connections"]):
            require(row["from"]["resource"] == dev(i+1) and
                    row["to"]["resource"] == dev((i+1)%N+1) and
                    not row["from"].get("port") and not row["to"].get("port"),
                    "Original ODS endpoint changed or physical port invented")
        check_original_page(page, 1)

        create_extra(page, ADDED)
        # FROZEN FIRST expected RED: P4f2 lacks this P4f3-specific marker.
        stale = page.locator('[data-scale-p4f3-stale="REVIEW_REQUIRED"]')
        expect(stale).to_be_visible(timeout=30000)
        blank(page, "Edited ODS leaked stale or unbounded graph before reapproval")
        edited = exported_source(page)
        require(len(edited["resources"]) == N+1 and
                len(edited["connections"]) == N and
                edited["resources"][:N] == baseline["resources"] and
                edited["connections"] == baseline["connections"] and
                edited["resources"][-1]["id"] == ADDED,
                "One unlinked append changed approved ODS source")
        menu_builder = page.locator(".workspace-menu").filter(
            has=page.locator("summary").filter(has_text="Builder"))
        if menu_builder.get_attribute("open") is None:
            menu_builder.locator("summary").click()
        menu_builder.get_by_role("button", name="Kompilera + layout").click()
        expect(page.locator(".diagnostics")).to_contain_text(
            "SCALE_P4B1_COMPILED_WITHOUT_FULL_LAYOUT", timeout=180000)
        require(exported_source(page) == edited, "Compile-only changed edited ODS")
        blank(page, "Compile-only leaked unbounded ODS graph")

        approval = page.locator('[data-scale-p4f3-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(approval).to_be_enabled(timeout=30000)
        approval.click()
        expect(page.locator(
            '[data-scale-p4f3-edited-focus="ADDED_UNLINKED_ONLY"]'
        )).to_be_visible(timeout=180000)
        require(exported_source(page) == edited, "Rebuild mutated canonical source")
        checked = [check_original_page(page,i) for i in (1,2,50,100)]
        selector = page.locator('[data-scale-p4f2-focus-page="true"]')
        expect(selector.locator("option")).to_have_count(101)
        selector.select_option("101")
        expect(page.locator('[data-scale-p4f2-active-page]')).to_have_attribute(
            "data-scale-p4f2-active-page", "101", timeout=180000)
        marker = page.locator(
            '[data-scale-p4f3-added-page="ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_ODS_ROW"]')
        expect(marker).to_be_visible(timeout=180000)
        expect(marker).to_contain_text(ADDED)
        page.wait_for_function("""id => {
            const n=[...document.querySelectorAll('.react-flow__node[data-id]')];
            const e=[...document.querySelectorAll('.react-flow__edge[data-id]')];
            return n.length===1 && n[0].getAttribute('data-id')===id && e.length===0;
        }""", arg=ADDED, timeout=180000)
        require(exported_source(page) == edited, "Page 101 modified original ODS source")
        check_original_page(page, 1)

        create_extra(page, SECOND)
        expect(stale).to_be_visible(timeout=30000)
        blank(page, "Second unsupported ODS edit leaked old graph")
        unsupported = exported_source(page)
        require(len(unsupported["resources"]) == N+2 and
                unsupported["resources"][:N+1] == edited["resources"] and
                unsupported["connections"] == baseline["connections"],
                "Second unsupported edit modified original ODS identities")
        approval = page.locator('[data-scale-p4f3-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(approval).to_be_visible(timeout=30000)
        approval.click()
        expect(page.locator(".diagnostics")).to_contain_text(
            "SCALE_P4E2_APPEND_ONLY_BLOCKED", timeout=30000)
        blank(page, "Second unsupported edit gained a graph")
        require(exported_source(page) == unsupported,
                "Denied review mutated canonical editable source")
        require(not errors and not outside, "JS exception or outside network request")
        return {"status":"PASS","originalOdsSha256":sha,"originalDevices":N,
                "originalLinks":N,"editedDevices":N+1,
                "pagesChecked":checked,"independentPage":101,
                "secondAppendDenied":True,"engineVerified":False,
                "physicalTopologyVerified":False}
    finally:
        page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
            and u.path=="/" and not u.query and not u.fragment,
            "P4f3 accepts only actual mounted isolated Ubuntu release")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True,args=[
            "--disable-background-networking","--disable-dev-shm-usage",
            *(["--no-sandbox"] if hasattr(os,"geteuid") and os.geteuid()==0 else [])
        ])
        try:
            result=case(browser,args.url)
        finally:
            browser.close()
    report={"gate":"SCALE-001 P4f3 actual ODS 10k/10k one edit bounded Chromium",
            "status":"PASS","case":result,"engineVerified":False,
            "physicalTopologyVerified":False}
    (args.evidence_dir/"scale001-p4f3-ods-one-edit-real-dom.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P4f3 genuine ODS 10000/10000 + one manually added unlinked device; 101 bounded pages, second edit denied; no Engine")
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL SCALE-001 P4f3 frozen actual Chromium:",str(exc),file=sys.stderr)
        raise

#!/usr/bin/env python3
"""SCALE-001 P4c4a FROZEN BEFORE PRODUCT: real original DOCX/ODT
10,000 devices + 10,000 original port-linked source rows through P4c3b's
independent 200 grants and Builder replacement; ONE actual Inspector append;
strict stale/fail-closed view, compile-only, separately reviewed restored bounded
original pages 1/2/50/100, page 101 one separate unlinked source device.
A second unsupported edit must be denied. No full-graph ELK, Engine, or physical truth.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup, exported_source, require
from run_scale001_p3c2b_office_5000_real_browser import snapshot
from run_scale001_p3d2_edited_5000_real_browser import create_extra
from run_scale001_p4c3b_10000_office_builder_real_browser import (
    N, original, open_review, choose_columns, approve,
    source_identity, check_page, private_absent, device
)

ADDED = "dev_extra_p4c4a"
SECOND = "dev_second_unsupported"

def compile_large(page):
    menu = page.locator(".workspace-menu-advanced")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    menu.get_by_role("button", name="Kompilera + layout").click()
    expect(page.locator(".diagnostics")).to_contain_text(
        "SCALE_P4B1_COMPILED_WITHOUT_FULL_LAYOUT", timeout=180000)

def blank(page, message):
    rendered = snapshot(page)
    require(not rendered["nodes"] and not rendered["edges"], message)

def case(browser, url, fmt):
    page, errors, outside = setup(browser, url)
    try:
        panel = open_review(page, fmt, original(fmt))
        choose_columns(panel)
        approve(panel)
        panel.locator('[data-scale-p4c3b-confirm]').click()
        expect(panel).to_have_count(0, timeout=240000)
        baseline = exported_source(page)
        source_identity(baseline)
        check_page(page, 1)
        create_extra(page, ADDED)

        # FROZEN FIRST RED: this exact separate 10k Office edited-state UI
        # does NOT exist on baseline P4c3b main. Existing Office review must
        # already have succeeded before this assertion can fail.
        stale = page.locator('[data-scale-p4c4a-stale="REVIEW_REQUIRED"]')
        expect(stale).to_be_visible(timeout=30000)
        blank(page, "Unreviewed 10,001st device displayed old/unbounded ReactFlow")
        edited = exported_source(page)
        require(len(edited["resources"]) == N+1 and
                len(edited["connections"]) == N and
                edited["resources"][:N] == baseline["resources"] and
                edited["connections"] == baseline["connections"] and
                edited["resources"][N]["id"] == ADDED,
                "One manually appended device modified original 10k source/link/ports")
        source_identity({**edited, "resources": edited["resources"][:N]})
        compile_large(page)
        require(exported_source(page) == edited,
                "Compile-only modified canonical edited source")
        blank(page, "Compiler displayed stale/unbounded Office graph")

        approval = page.locator(
            '[data-scale-p4c4a-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(approval).to_be_enabled(timeout=30000)
        approval.click()
        expect(page.locator(
            '[data-scale-p4c4a-edited-focus="ADDED_UNLINKED_ONLY"]')
        ).to_be_visible(timeout=180000)
        require(exported_source(page) == edited,
                "Explicit bounded rebuild modified canonical edited source")

        views = [check_page(page, i) for i in (1, 2, 50, 100)]
        select = page.locator('[data-scale-p4c3b-focus-page="true"]')
        expect(select.locator("option")).to_have_count(101)
        select.select_option("101")
        expect(page.locator("[data-scale-p4c3b-active-page]")).to_have_attribute(
            "data-scale-p4c3b-active-page", "101", timeout=180000)
        added = page.locator(
            '[data-scale-p4c4a-added-page="ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"]')
        expect(added).to_be_visible(timeout=180000)
        expect(added).to_contain_text(ADDED)
        expect(added).to_contain_text("Explicitly authored unconnected Builder device")
        page.wait_for_function("""expected => {
          const nodes=[...document.querySelectorAll('.react-flow__node[data-id]')];
          const edges=[...document.querySelectorAll('.react-flow__edge[data-id]')];
          return nodes.length===1 && nodes[0].getAttribute('data-id')===expected &&
                 edges.length===0;
        }""", arg=ADDED, timeout=180000)
        result = snapshot(page)
        require(result["nodes"] == [ADDED] and not result["edges"],
                "Separately approved new Builder device got an invented cable")
        require(exported_source(page) == edited,
                "Page 101 or original pages modified full canonical source")
        check_page(page, 1)

        create_extra(page, SECOND)
        expect(stale).to_be_visible(timeout=30000)
        blank(page, "A second unsupported edit leaked stale approved ReactFlow")
        unsupported = exported_source(page)
        require(len(unsupported["resources"]) == N+2 and
                unsupported["resources"][:N+1] == edited["resources"] and
                unsupported["connections"] == baseline["connections"],
                "Second unconnected device changed canonical source/link identities")
        compile_large(page)
        review = page.locator(
            '[data-scale-p4c4a-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(review).to_be_visible(timeout=30000)
        review.click()
        expect(page.locator(".diagnostics")).to_contain_text(
            "SCALE_P4C4A_APPEND_ONLY_BLOCKED", timeout=30000)
        blank(page, "Unsupported second edit received a bounded graph")
        require(exported_source(page) == unsupported,
                "Denied second append mutated canonical editable source")
        private_absent(page)
        require(not errors and not outside,
                "Unexpected JS or outside network request during 10k edited review")
        return {
            "format": fmt, "status": "PASS",
            "originalDevices": N, "originalPortLinks": N,
            "editedCanonicalDevices": N+1,
            "originalPagesChecked": [v["page"] for v in views],
            "independentUnlinkedPage": 101,
            "extraPageNodes": 1, "extraPageLinks": 0,
            "secondAppendDenied": True,
            "unboundedGraphRendered": False,
            "engineVerified": False,
            "physicalTopologyVerified": False
        }
    finally:
        page.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and
            parsed.port is not None and parsed.path == "/" and
            not parsed.query and not parsed.fragment,
            "P4c4a requires the actual isolated GitHub Ubuntu Linux mounted app")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        options = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            options.append("--no-sandbox")
        browser = playwright.chromium.launch(headless=True, args=options)
        try:
            cases = [case(browser, args.url, fmt) for fmt in ("docx", "odt")]
        finally:
            browser.close()
    report = {
        "gate": "SCALE-001 P4c4a 10k Office one manual append edit bounded restored source",
        "status": "PASS", "frozenBeforeProduct": True, "cases": cases,
        "noFullGraph": True, "engineVerified": False,
        "physicalTopologyVerified": False
    }
    (args.evidence_dir / "scale001-p4c4a-10000-office-one-edit-real-dom.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("PASS SCALE-001 P4c4a real DOCX+ODT 10000/10000 plus one manually appended unlinked Builder resource, original exact source/parallel ports on 100 bounded pages and isolated page 101; second edit denied; no Engine")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL SCALE-001 P4c4a frozen real Chromium one edit:", str(exc), file=sys.stderr)
        raise

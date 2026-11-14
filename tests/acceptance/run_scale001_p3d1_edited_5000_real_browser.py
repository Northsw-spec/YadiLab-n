#!/usr/bin/env python3
"""Frozen P3d1 real Chromium: edit a genuine reviewed 5000/5000 Builder source.

This requires the real app, original DOCX ZIP and 100 independent row consent
checkboxes. It is NOT a synthetic store update, a JS token test, or a 5k Engine
simulation. Authored before P3d1 product code.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect,sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require
from run_scale001_p3c2b_office_5000_real_browser import (
    choose,consent,original,assert_source
)

def run_case(browser,url):
    page,errors,external=setup(browser,url)
    try:
        panel=choose(page,"docx",original("docx"))
        consent(panel)
        panel.locator('[data-scale-p3c2-confirm]').click()
        expect(page.locator('[data-scale-p3c2-panel]')).to_have_count(0,timeout=240000)
        expect(page.locator('[data-scale-p3c2-focus-view]')).to_be_visible(timeout=180000)
        before=exported_source(page)
        assert_source(before)
        require(page.locator('.react-flow__node[data-id]').count()>=100,
                "Original 5000 reviewed source was never mounted to actual ReactFlow")

        # Real user authoring, NOT direct app state manipulation.
        section=page.locator('.control-section').filter(
          has=page.locator('summary').filter(has_text='Builder Inspector & Authoring'))
        expect(section).to_have_count(1)
        section.locator('summary').first.click()
        editor=section.locator('.create-panel')
        expect(editor).to_be_visible()
        editor.locator('label.inspector-field').filter(has_text='ID').locator('input').fill(
          'dev_extra_guard')
        editor.locator('label.inspector-field').filter(has_text='Label').locator('input').fill(
          'Manually added endpoint')
        editor.get_by_role('button',name='Skapa objekt').click()

        stale=page.locator('[data-scale-p3d1-edited-source="BOUNDED_REVIEW_REQUIRED"]')
        expect(stale).to_be_visible(timeout=30000)
        expect(page.locator('[data-scale-p3c2-focus-view]')).to_have_count(0)
        require(page.locator('.react-flow__node[data-id]').count()==0,
                "Post-edit 5001-resource Builder unexpectedly rendered a full/old graph")
        require(page.locator('.react-flow__edge[data-id]').count()==0,
                "Post-edit 5001-resource Builder unexpectedly rendered original/phantom edges")
        edited=exported_source(page)
        require(len(edited["resources"])==5001 and len(edited["connections"])==5000,
                "Real inspector's edit did not add exactly one canonical Builder resource")
        require(edited["resources"][:5000]==before["resources"] and
                edited["resources"][-1]["id"]=="dev_extra_guard" and
                edited["connections"]==before["connections"],
                "Original 5000 nodes or exact original port-paired links changed")

        builder_menu=page.locator('.workspace-menu-advanced')
        builder_menu.locator('summary').click()
        builder_menu.get_by_role('button',name='Kompilera + layout').click()
        expect(page.locator('[data-scale-p3d1-safe-compile="NO_UNBOUNDED_LAYOUT"]')).to_be_visible(
            timeout=240000)
        expect(stale).to_be_visible()
        require(page.locator('.react-flow__node[data-id]').count()==0 and
                page.locator('.react-flow__edge[data-id]').count()==0,
                "Compile clicked unbounded ELK/ReactFlow on edited 5000-session")
        require(exported_source(page)==edited,
                "Compilation mutated editable canonical source")

        preview_menu=page.locator('.workspace-menu-advanced')
        preview_menu.locator('summary').click()
        preview_menu.get_by_role('button',name='Förhandsvisa körläge').click()
        expect(page.locator('.diagnostics')).to_contain_text(
            'SCALE_P3D1_ENGINE_NOT_VERIFIED',timeout=30000)
        require(exported_source(page)==edited,
                "Unverified edited large Builder was activated or replaced")
        require(not errors and not external,"Unexpected browser/network error after edit")
        return {"case":"real_DOCX_5000_5000_add_resource_5001_5000",
                "status":"PASS","canonicalNodesAfterEdit":5001,
                "originalPortLinksPreserved":5000,"mountedFullGraph":False,
                "engineActivated":False,"physicalNetworkVerified":False}
    finally:
        page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',required=True)
    parser.add_argument('--evidence-dir',required=True,type=Path)
    args=parser.parse_args()
    url=urlsplit(args.url)
    require(url.scheme=="http" and url.hostname=="127.0.0.1" and url.port is not None and
            url.path=="/" and not url.query and not url.fragment,
            "P3d1 requires actual isolated mounted localhost application")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        opts=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0: opts.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=opts)
        try: case=run_case(browser,args.url)
        finally: browser.close()
    report={"status":"PASS","scope":"SCALE-001 P3d1 edited genuine Office 5000 session bounded real Chromium",
            "cases":[case],"tenThousandDomVerified":False,"engineVerified":False}
    (args.evidence_dir/"scale001-p3d1-edited-5000-real-dom.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P3d1 actual mounted Chromium edited 5000+5000 original DOCX "+
          "Builder to 5001+5000; no unbounded ReactFlow/ELK; source unchanged by safe "+
          "compiler; Engine preview denied")
    print(json.dumps(report,indent=2))
if __name__=='__main__':
    try: main()
    except Exception as error:
        print("FAIL SCALE-001 P3d1 actual edited 5000 source:",str(error),file=sys.stderr)
        raise

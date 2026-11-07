#!/usr/bin/env python3
"""SCALE-001 P2b2B FROZEN before UI: real DOCX/ODT imported 1000/999
with explicit untrusted site definitions, exact original device assignment,
separate consent, read-only presentation and unchanged Builder bytes.
P2b2C geographic ReactFlow drilling is intentionally NOT asserted here.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect,sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require
from run_scale001_p2b1_office_1000_real_browser import (
    choose,approve,original,device,PRIVATE_NODE,PRIVATE_LINK
)

def add_definition(panel,kind,ident,label,parent=None):
    panel.locator("[data-scale-p2b2-"+kind+"-id]").fill(ident)
    panel.locator("[data-scale-p2b2-"+kind+"-label]").fill(label)
    if parent is not None:
        selector="site" if kind=="building" else "building"
        panel.locator("[data-scale-p2b2-"+kind+"-"+selector+"]").select_option(parent)
    panel.locator("[data-scale-p2b2-add-"+kind+"]").click()
    panel.locator('[data-scale-p2b2-ack-definition="'+ident+'"]').check()

def scenario(browser,url,fmt):
    page,errors,external=setup(browser,url)
    try:
        office=choose(page,fmt,original(fmt))
        approve(office)
        office.locator("[data-scale-p2b1-confirm]").click()
        expect(page.locator("[data-scale-p2b1-panel]")).to_have_count(0,timeout=180000)
        before=exported_source(page)
        require(len(before["resources"])==1000 and len(before["connections"])==999,
                "P2b2B required original 1000/999 imported source missing")
        initial_nodes={n.get_attribute("data-id") for n in
                       page.locator(".react-flow__node[data-id]").all()}
        initial_links={x.get_attribute("data-id") for x in
                       page.locator(".react-flow__edge[data-id]").all()}
        page.locator("[data-scale-p2b2-open]").click()
        panel=page.locator('[data-scale-p2b2-panel="REVIEW_REQUIRED"]')
        expect(panel).to_be_visible()
        expect(panel.locator("[data-scale-p2b2-confirm]")).to_be_disabled()
        require("Synthetic Campus Alpha" not in panel.inner_html(),
                "Facility label or site inferred without user action")
        add_definition(panel,"site","site_a","Synthetic Campus Alpha")
        add_definition(panel,"site","site_b","Synthetic Campus Beta")
        add_definition(panel,"building","building_a","User Building Alpha","site_a")
        add_definition(panel,"building","building_b","User Building Beta","site_b")
        add_definition(panel,"floor","floor_a","Floor Alpha","building_a")
        add_definition(panel,"floor","floor_b","Floor Beta","building_b")
        expect(panel.locator("[data-scale-p2b2-confirm]")).to_be_disabled()
        # An unknown source ID must be blocked, never accepted via substring.
        panel.locator("[data-scale-p2b2-device-id]").fill("missing_resource")
        panel.locator("[data-scale-p2b2-device-floor]").select_option("floor_a")
        panel.locator("[data-scale-p2b2-add-assignment]").click()
        expect(panel.locator('[data-scale-p2b2-error="BLOCKED"]')).to_be_visible()
        require(panel.locator('[data-scale-p2b2-ack-assignment="missing_resource"]').count()==0,
                "Unknown device entered approved membership")
        for ident,floor in [(device(0),"floor_a"),(device(500),"floor_b")]:
            panel.locator("[data-scale-p2b2-device-id]").fill(ident)
            panel.locator("[data-scale-p2b2-device-floor]").select_option(floor)
            panel.locator("[data-scale-p2b2-add-assignment]").click()
            panel.locator('[data-scale-p2b2-ack-assignment="'+ident+'"]').check()
        expect(panel.locator("[data-scale-p2b2-confirm]")).to_be_disabled()
        panel.locator("[data-scale-p2b2-approve-definition]").check()
        expect(panel.locator("[data-scale-p2b2-confirm]")).to_be_disabled()
        panel.locator("[data-scale-p2b2-approve-assignment]").check()
        expect(panel.locator("[data-scale-p2b2-confirm]")).to_be_enabled()
        panel.locator("[data-scale-p2b2-confirm]").click()
        expect(page.locator("[data-scale-p2b2-panel]")).to_have_count(0,timeout=30000)
        summary=page.locator('[data-scale-p2b2-summary="READY_FOR_PRESENTATION"]')
        expect(summary).to_be_visible(timeout=30000)
        require(summary.get_attribute("data-scale-p2b2-original-count")=="1000",
                "Canonical full Builder count altered")
        require(summary.get_attribute("data-scale-p2b2-member-count")=="2",
                "Manually approved device assignments altered")
        require(summary.get_attribute("data-scale-p2b2-unassigned-count")=="998",
                "Unassigned original devices silently dropped")
        require(summary.get_attribute("data-scale-p2b2-cross-site-count")=="1",
                "Cross-site original port link reference count incorrect")
        require(exported_source(page)==before,"P2b2B presentation modified canonical source")
        require({n.get_attribute("data-id") for n in
                 page.locator(".react-flow__node[data-id]").all()}==initial_nodes,
                "P2b2B fabricated/deleted rendered original devices")
        require({x.get_attribute("data-id") for x in
                 page.locator(".react-flow__edge[data-id]").all()}==initial_links,
                "P2b2B fabricated/deleted rendered cables")
        require(PRIVATE_NODE not in page.content() and PRIVATE_LINK not in page.content(),
                "P2b2B disclosed unreviewed original private cells")
        require("MODELED_NOT_PHYSICAL" in summary.inner_text(),
                "Unverified membership incorrectly represented as physical truth")
        page.locator("[data-scale-p2b2-open]").click()
        page.locator("[data-scale-p2b2-cancel]").click()
        expect(summary).to_be_visible()
        require(exported_source(page)==before,"P2b2B cancellation changed Builder")
        require(not errors and not external,"P2b2B browser errors or outbound requests")
        return {"format":fmt,"case":"two_manual_sites_two_approved_devices",
                "status":"PASS","originalDevices":1000,"originalLinks":999,
                "approvedAssignments":2,"unassignedOriginals":998,
                "originalCrossSiteLinks":1,"physicalNetworkVerified":False}
    finally:
        page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",type=Path,required=True)
    args=parser.parse_args()
    parsed=urlsplit(args.url)
    require(parsed.scheme=="http" and parsed.hostname=="127.0.0.1" and
            parsed.port is not None and parsed.path=="/" and
            not parsed.query and not parsed.fragment,
            "P2b2B Chromium accepts only explicit isolated localhost")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:
            flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:
            cases=[scenario(browser,args.url,fmt) for fmt in ("docx","odt")]
        finally:
            browser.close()
    evidence={"kind":"SCALE-001 P2b2B original-source user declarations real Chromium",
              "status":"PASS","cases":cases,
              "siteMembershipPhysicallyVerified":False,
              "geographicReactFlowDrillInVerified":False}
    (args.evidence_dir/"scale001-p2b2b-real-chromium.json").write_text(
        json.dumps(evidence,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P2b2B real Chromium DOCX/ODT two separately approved synthetic sites, original 1000/999 Builder source retained, no inferred physical network")
    print(json.dumps(evidence,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL SCALE-001 P2b2B real Chromium: "+str(exc),file=sys.stderr)
        raise

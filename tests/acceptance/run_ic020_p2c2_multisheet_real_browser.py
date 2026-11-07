#!/usr/bin/env python3
"""IC-020 P2c2: actual compiled Chromium real six-tab XLSX/ODS source and no-guess safety."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright,expect
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"tests/fixtures/import"))
from generate_ic020_p2c2_workbooks import build,EXPECTED_EDGES,SHEETS

NODE_IDS={"rtr01","sw01","sw02","win01","win02","lin01","lin02","unknown01"}
EXPECTED={(a,b,c,d) for a,b,c,d in EXPECTED_EDGES}
MIME={"xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "ods":"application/vnd.oasis.opendocument.spreadsheet"}

def picker(page,fmt,data):
    with page.expect_file_chooser(timeout=15000) as future:
        page.locator('[data-network-import-primary="true"]').click()
    future.value.set_files({"name":"consultant."+fmt,"mimeType":MIME[fmt],"buffer":data})
    expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=30000)

def preview(page,fmt,data):
    pane=page.locator('[data-network-import-preview="READY"]')
    expect(pane).to_be_visible(timeout=35000)
    body=pane.inner_text()
    require("Devices: 8" in body and "Explicit links: 6" in body,
            "Model preview includes ghost nodes or inferred cables")
    require(all(name in body for name in SHEETS),
            "Original six independently parsed workbook tabs not shown")
    sha=hashlib.sha256(data).hexdigest()
    require(sha in page.locator('[data-network-import-sha]').inner_text(),
            "Original full XLSX/ODS ZIP SHA not shown")
    require(page.locator('[data-network-import-link-review]').count()==0,
            "Canonical source should not invoke P2a competing source review")
    require(page.locator('[data-network-import-activate]').is_enabled(),
            "Valid canonical six-tab inventory cannot open Builder")
    return sha

def check_graph(s):
    require({x["id"] for x in s["resources"]}==NODE_IDS,
            "Wrong original device IDs")
    require(len(s["connections"])==len(EXPECTED),
            "Wrong number of explicitly declared links")
    actual={(x["from"]["resource"],x["from"].get("port"),
             x["to"]["resource"],x["to"].get("port")) for x in s["connections"]}
    require(actual==EXPECTED,
            "Incorrect port-source binding or inferred edges in compiled Builder")
    unknown=next(x for x in s["resources"] if x["id"]=="unknown01")
    require(unknown["type"]=="resource.generic",
            "Unknown device was upgraded to a Windows/Linux/verified role")
    require(not unknown.get("interfaces"),"Undocumented IP/port was fabricated")
    require(all("unknown01" not in (x["from"]["resource"],x["to"]["resource"])
      for x in s["connections"]), "Gateway automatically created physical cabling")
    require(len(s.get("zones",[]))==3,"Lost documented network zones")

def case_builder(browser,url,fmt):
    page,errors,outside=setup(browser,url)
    try:
        baseline=exported_source(page)
        data=build(fmt)
        picker(page,fmt,data)
        digest=preview(page,fmt,data)
        # The modal is intentionally modal: don't click the underlying
        # Builder export while its overlay intercepts pointer events.
        # The unchanged-Builder assertion is made in every blocked-source
        # case *after* the modal closes; activation is explicit here.
        page.locator('[data-network-import-activate]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        check_graph(source)
        require(not errors,"JavaScript error "+repr(errors))
        require(not outside,"Unexpected network requests "+repr(outside))
        return {"case":"actual_"+fmt+"_six_sheet_Builder",
                "status":"PASS","sourceSha256":digest,
                "nodes":8,"explicitPortBoundLinks":6,
                "partialUnknownNotUpgraded":True,
                "noAutomaticPhysicalConnections":True,"outsideRequests":0}
    finally:page.close()

def case_runtime(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        fmt="ods"
        data=build(fmt)
        picker(page,fmt,data);preview(page,fmt,data)
        page.locator('[data-network-import-runtime]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        page.wait_for_function(
          "document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-hash') !== 'builder'",
          timeout=30000)
        pane=page.locator('[data-active-probe-engine]').first
        expect(pane).to_be_visible(timeout=24000)
        require(pane.get_attribute("open") is not None,
                "Imported multi-sheet ODS Runtime didn't open modeled probe panel")
        pane.get_by_role("button",name="Kör modellerad aktiv probe").click()
        transcript=page.locator('[data-active-probe-transcript]').first
        expect(transcript).to_be_visible(timeout=25000)
        txt=transcript.inner_text()
        require("NO_GUEST_COMMAND_EXECUTION" in txt,
                "A modeled probe was described as real network traffic")
        require("Engine " in txt,
                "Modeled Engine transcript absent or replaced with workbook assumption")
        require(transcript.get_attribute("data-active-probe-scenario-hash")==
          page.locator(".app-frame").get_attribute("data-runtime-scenario-hash"),
          "Probe not bound to the actual current modeled Runtime")
        require(not errors,"JavaScript errors "+repr(errors))
        require(not outside,"External requests "+repr(outside))
        return {"case":"actual_multisheet_ODS_to_modeled_Runtime",
           "status":"PASS","boundary":"NO_GUEST_COMMAND_EXECUTION",
           "truthOwnedByEngine":True,"externalRequests":0}
    finally:page.close()

def case_bad(browser,url,fmt,variant,code):
    page,errors,outside=setup(browser,url)
    try:
        baseline=exported_source(page)
        picker(page,fmt,build(fmt,variant))
        blocked=page.locator('[data-network-import-preview="BLOCKED"]')
        expect(blocked).to_be_visible(timeout=30000)
        require(code in blocked.inner_text(),
                "Unsupported reference did not produce exact diagnostic "+code)
        require(page.locator('[data-network-import-activate]').is_disabled(),
                "Invalid port or node may activate Builder")
        require(page.locator('[data-network-import-runtime]').is_disabled(),
                "Invalid port or node may activate modeled Runtime")
        page.get_by_role("button",name="Close network import").click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0)
        require(exported_source(page)==baseline,
                "Blocked workbook or close unexpectedly changed Builder")
        require(not errors and not outside,
                "Console/HTTP activity "+repr(errors)+repr(outside))
        return {"case":"actual_"+fmt+"_"+variant+"_hard_block",
           "status":"PASS","code":code,"builderUnchanged":True,"outsideRequests":0}
    finally:page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",type=Path,required=True)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and
            not u.username and not u.password,
            "Only actual compiled YadiLab served on local HTTP")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=flags)
        try:
            cases=[case_builder(browser,args.url,"xlsx"),
                   case_builder(browser,args.url,"ods"),
                   case_runtime(browser,args.url)]
            for fmt in ("xlsx","ods"):
                for variant,code in [
                  ("missing-port","WORKBOOK_LINK_PORT_UNKNOWN"),
                  ("duplicate-interface","WORKBOOK_DUPLICATE_INTERFACE_ID"),
                  ("missing-node","WORKBOOK_LINK_ENDPOINT_UNKNOWN")]:
                    cases.append(case_bad(browser,args.url,fmt,variant,code))
        finally:browser.close()
    report={"status":"PASS","kind":"Actual compiled Chromium six-sheet XLSX/ODS original source and port contract",
      "environment":"GitHub Actions Ubuntu; actual live hardware / Parrot NOT_RUN",
      "cases":cases,"inferredLinks":0,"physicalTopologyVerified":False,
      "noGuestExecution":True}
    (args.evidence_dir/"ic020-p2c2-real-multisheet-ports-chromium.json").write_text(
      json.dumps(report,indent=2)+"\n")
    print("PASS IC-020 P2c2 actual compiled Chromium six-sheet XLSX/ODS typed original ports and probe truth",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("FAIL IC-020 P2c2 Chromium: "+str(e),file=sys.stderr)
        raise

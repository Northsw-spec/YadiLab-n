#!/usr/bin/env python3
"""IC-020 P2c5: actual compiled Chromium and five ORIGINAL producer files.
Verdicts must originate in Engine, not source parsing, DOM text tricks or guest commands.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"tests/fixtures/import"))
from generate_ic020_p2c5_network import build

FORMATS=("json","csv","tsv","xlsx","ods")
MIMES={"json":"application/json","csv":"text/csv","tsv":"text/tab-separated-values",
 "xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 "ods":"application/vnd.oasis.opendocument.spreadsheet"}

def select_file(page,fmt,variant):
    data=build(fmt,variant)
    with page.expect_file_chooser(timeout=20000) as future:
        page.locator('[data-network-import-primary="true"]').click()
    future.value.set_files({"name":"consultant."+fmt,"mimeType":MIMES[fmt],"buffer":data})
    expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=30000)
    preview=page.locator('[data-network-import-preview]')
    expect(preview).to_be_visible(timeout=30000)
    require(hashlib.sha256(data).hexdigest() in
        page.locator('[data-network-import-sha]').inner_text(),
        "Original full source SHA was not displayed")
    return preview

def run_selected(pane,page,host,probe,destination,truth):
    source=pane.get_by_label("Källvärd")
    active=pane.get_by_label("Aktiv probe")
    source.select_option(host)
    active.select_option(probe)
    if destination:
        pane.locator("label.inspector-field").filter(has_text=re.compile(r"^Destination")).locator("select").select_option(destination)
    pane.get_by_role("button",name="Kör modellerad aktiv probe").click()
    transcript=page.locator('[data-active-probe-transcript]').first
    expect(transcript).to_be_visible(timeout=25000)
    expect(transcript).to_contain_text("verdict "+truth,timeout=20000)
    message=transcript.inner_text()
    require("NO_GUEST_COMMAND_EXECUTION" in message,
            "Modeled probe boundary incorrectly implies guest/physical execution")
    require(transcript.get_attribute("data-active-probe-scenario-hash")==
            page.locator(".app-frame").get_attribute("data-runtime-scenario-hash"),
            "Transcript not tied to actual active Runtime hash")
    require("Engine " in message,"Missing Engine-owned verdict/provenance")
    require("verdict TRUE" not in message,
            "Negative/UNKNOWN source was misreported as Engine PASS")
    return {"host":host,"probe":probe,"verdict":truth,
            "runtimeScenarioBound":True,"noGuestCommands":True}

def case_runtime(browser,url,fmt):
    page,errors,outside=setup(browser,url)
    try:
        source=select_file(page,fmt,"valid")
        expect(source).to_have_attribute("data-network-import-preview","READY")
        txt=source.inner_text()
        require("Devices: 3" in txt and "Explicit links: 2" in txt,
                "Unexpected modeled graph/connection count for "+fmt)
        require(page.locator('[data-network-import-runtime]').is_enabled(),
                "No explicit eligible modeled Runtime for "+fmt)
        page.locator('[data-network-import-runtime]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        page.wait_for_function(
         "document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-hash') !== 'builder'",
         timeout=30000)
        pane=page.locator('[data-active-probe-engine]').first
        expect(pane).to_be_visible(timeout=25000)
        require(pane.get_attribute("open") is not None,"Modeled probe panel did not open")
        checks=[]
        for host,system in (("win01","windows"),("lin01","linux")):
            checks.append(run_selected(pane,page,host,system+".ping","rtr01","FALSE"))
            checks.append(run_selected(pane,page,host,
              "windows.resolve_dnsname" if system=="windows" else "linux.dig",
              None,"UNKNOWN"))
        require(not errors,"Compiled browser errors "+repr(errors))
        require(not outside,"Unexpected external HTTP request "+repr(outside))
        return {"case":"actual_"+fmt+"_imported_windows_linux_FALSE_UNKNOWN",
                "status":"PASS","probes":checks,"physicalProbes":False,
                "externalRequests":0}
    finally:page.close()

def case_conflicts(browser,url,fmt):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        checked=[]
        for variant,code in (
            ("address-conflict","NETWORK_IMPORT_ADDRESS_CONFLICT"),
            ("prefix-conflict","NETWORK_IMPORT_ADDRESS_CONFLICT"),
            ("alias-conflict","NETWORK_IMPORT_FIELD_AMBIGUOUS"),
            ("duplicate-device","NETWORK_IMPORT_DUPLICATE_DEVICE_ID"),
        ):
            pane=select_file(page,fmt,variant)
            expect(pane).to_have_attribute("data-network-import-preview","BLOCKED")
            require(code in pane.inner_text(),"Invalid typed document was accepted: "+variant)
            require("10.9.10.99" not in pane.inner_text(),"Conflicting raw IP disclosed")
            require(page.locator('[data-network-import-activate]').is_disabled(),
                    "Conflicting document Builder was available")
            require(page.locator('[data-network-import-runtime]').is_disabled(),
                    "Conflicting document Runtime was available")
            page.get_by_role("button",name="Close network import").click()
            expect(page.locator('[data-network-import-panel]')).to_have_count(0)
            require(exported_source(page)==before,"Blocked preview mutated Builder")
            checked.append(variant)
        require(not errors,"Compiled browser errors "+repr(errors))
        require(not outside,"External HTTP request "+repr(outside))
        return {"case":"actual_"+fmt+"_conflicting_address_prefix_alias_and_duplicate",
                "status":"PASS","blocked":checked,"builderUnchanged":True,
                "externalRequests":0}
    finally:page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",type=Path,required=True)
    args=ap.parse_args()
    address=urlsplit(args.url)
    require(address.scheme=="http" and address.hostname=="127.0.0.1" and
            address.port is not None and address.path=="/" and
            not address.query and not address.fragment and
            not address.username and not address.password,
            "Only a local compiled browser application may be tested")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=flags)
        try:
            cases=[]
            for fmt in FORMATS:
                cases.append(case_runtime(browser,args.url,fmt))
                cases.append(case_conflicts(browser,args.url,fmt))
        finally:browser.close()
    report={"status":"PASS","kind":"Actual compiled Chromium five-format P2c5 source-bound modeled verdicts",
            "environment":"GitHub Actions Ubuntu; Parrot-native/physical network NOT_RUN",
            "cases":cases,"networkCommandsExecuted":False,
            "inventedPhysicalLinks":False}
    (args.evidence_dir/"ic020-p2c5-five-format-contradiction-modeled-truth-chromium.json").write_text(
        json.dumps(report,indent=2)+"\n")
    print("PASS IC-020 P2c5 actual compiled Chromium five-format FALSE/UNKNOWN imported Engine and conflicting-fact denial",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("FAIL IC-020 P2c5 Chromium: "+str(e),file=sys.stderr)
        raise

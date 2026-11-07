#!/usr/bin/env python3
"""IC-020 P1: actual compiled Chromium, all five core network inventory files,
original ZIP/text SHA-bound review, stale source refusal and Engine-modeled probes.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_ic010_p2_shared_xml_real_browser import setup, exported_source, require

ROOT=Path(__file__).resolve().parents[2]
EXAMPLES=ROOT/"examples/enterprise-import"
CSV=(EXAMPLES/"network-devices-example.csv").read_bytes()
HEADER=CSV.decode().strip().splitlines()[0].split(",")
ROWS=[dict(zip(HEADER,line.split(","))) for line in CSV.decode().strip().splitlines()[1:]]
JSON_BYTES=json.dumps({"Devices":ROWS},separators=(",",":")).encode()
TSV=CSV.replace(b",",b"\t")
FORMAT_FILES=[
 ("network.json",JSON_BYTES,4,3),
 ("network.csv",CSV,4,3),
 ("network.tsv",TSV,4,3),
 ("network.xlsx",(EXAMPLES/"enterprise-import-template.xlsx").read_bytes(),None,None),
 ("network.ods",(EXAMPLES/"enterprise-import-template.ods").read_bytes(),None,None),
]

def choose_primary(page,name,content):
    with page.expect_file_chooser(timeout=12000) as future:
        page.locator('[data-network-import-primary="true"]').click()
    future.value.set_files({"name":name,"mimeType":"application/octet-stream","buffer":content})
    expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=15000)

def ready(page,name,data,expected_devices=None,expected_links=None):
    preview=page.locator('[data-network-import-preview="READY"]')
    expect(preview).to_be_visible(timeout=35000)
    text=preview.inner_text()
    require(name in text,"Wrong preview filename or cached source "+name)
    digest=hashlib.sha256(data).hexdigest()
    require(digest in page.locator('[data-network-import-sha="true"]').inner_text(),
            "Original complete file SHA mismatch "+name)
    require("Explicit links:" in text and "Devices:" in text,
            "Core network topology summary absent "+name)
    if expected_devices is not None:
        require(f"Devices: {expected_devices}" in text,"Wrong mapped device count "+name)
    if expected_links is not None:
        require(f"Explicit links: {expected_links}" in text,
                "A link was inferred or missing "+name)
    require(page.locator('[data-network-import-activate]').is_enabled(),
            "Builder action absent despite verified source "+name)
    require(page.locator('[data-network-import-runtime]').is_enabled(),
            "Runtime action absent despite verified source "+name)
    require("No real traffic is sent" in page.locator('[data-import-probe-boundary]').inner_text(),
            "Source import is falsely reported as real network probe")
    return digest

def close_modal(page):
    page.get_by_role("button",name="Close network import").click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0)

def case_five_producers(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        baseline=exported_source(page)
        digests={}
        for name,data,devices,links in FORMAT_FILES:
            choose_primary(page,name,data)
            require(".json" in page.locator('[data-network-import-quick-file]').get_attribute("accept"),
                    "JSON missing from same one-click network inventory picker")
            require(".json" in page.locator('[data-network-import-file]').get_attribute("accept"),
                    "JSON missing from consented foreground modal")
            digests[name]=ready(page,name,data,devices,links)
            close_modal(page)
            require(exported_source(page)==baseline,
                    "Preview/close of "+name+" modified live Builder")
        # A normal JSON object of Devices table rows is an inventory, not a YadiLab scenario JSON.
        choose_primary(page,"network.json",JSON_BYTES)
        ready(page,"network.json",JSON_BYTES,4,3)
        page.locator('[data-network-import-activate]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        exported=exported_source(page)
        require(len(exported.get("resources",[]))==4,"JSON inventory did not reach Builder")
        require(len(exported.get("connections",[]))==3,"JSON invented or lost physical connections")
        ids={x["id"] for x in exported["resources"]}
        require(ids=={"router01","switch01","pc01","server01"},
                "Builder inventory IDs lost actual source declarations")
        require(all(x["from"]["resource"] in ids and x["to"]["resource"] in ids
                    for x in exported["connections"]), "Builder contains ghost connection")
        require(not errors,"Uncaught JavaScript errors "+repr(errors))
        require(not outside,"Unexpected outside network requests "+repr(outside))
        return {"case":"one_click_five_subtypes_and_reviewed_json_builder",
          "status":"PASS","sourceProfiles":5,"sha256":digests,
          "jsonBuilderDevices":4,"jsonBuilderExplicitLinks":3,"noUnreviewedMutation":True,
          "outsideRequests":0}
    finally:page.close()

def case_csv_runtime_probes(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        choose_primary(page,"network.csv",CSV)
        ready(page,"network.csv",CSV,4,3)
        page.locator('[data-network-import-runtime]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        page.wait_for_function(
          "document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-hash') !== 'builder'",
          timeout=30000)
        page.locator('[data-active-probe-engine]').wait_for(timeout=25000)
        pane=page.locator('[data-active-probe-engine]').first
        require(pane.get_attribute("open") is not None,
                "Imported Runtime did not automatically open modeled probe engine")
        pane.get_by_role("button",name="Kör modellerad aktiv probe").click()
        transcript=page.locator('[data-active-probe-transcript]').first
        expect(transcript).to_be_visible(timeout=20000)
        message=transcript.inner_text()
        require("NO_GUEST_COMMAND_EXECUTION" in message,
                "Imported CSV probe was represented as a real guest execution")
        require(transcript.get_attribute("data-active-probe-scenario-hash")==
                page.locator('.app-frame').get_attribute('data-runtime-scenario-hash'),
                "Probe transcript provenance mismatches active Runtime")
        require("Engine " in message,
                "No modeled Engine status displayed for imported endpoints")
        require(not errors,"Runtime browser errors "+repr(errors))
        require(not outside,"Runtime tried external network "+repr(outside))
        return {"case":"source_bound_csv_runtime_and_real_engine_modeled_probe",
            "status":"PASS","boundary":"NO_GUEST_COMMAND_EXECUTION",
            "transcriptSourceMatchesRuntime":True,"outsideRequests":0}
    finally:page.close()

def case_source_changed_blocks_activation(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        baseline=exported_source(page)
        altered=CSV.replace(b"router01",b"router99")
        require(len(altered)==len(CSV),"Adversarial source swap must preserve file size")
        page.evaluate("""(changed) => {
          const old=File.prototype.arrayBuffer;
          window.__ic020ReadCounts={};
          const altered=new Uint8Array(changed).buffer;
          File.prototype.arrayBuffer=function(){
            if(this.name==="swapped.csv"){
              const n=(window.__ic020ReadCounts[this.name]||0)+1;
              window.__ic020ReadCounts[this.name]=n;
              if(n>=2)return Promise.resolve(altered.slice(0));
            }
            return old.call(this);
          };
        }""",list(altered))
        choose_primary(page,"swapped.csv",CSV)
        ready(page,"swapped.csv",CSV,4,3)
        page.locator('[data-network-import-activate]').click()
        failure=page.locator('[data-network-import-panel] [role="alert"]')
        expect(failure).to_contain_text("IC020_P1_SOURCE_CHANGED",timeout=40000)
        require(page.locator('[data-network-import-panel]').count()==1,
                "Modified original still allowed import to close modal")
        require(page.evaluate("window.__ic020ReadCounts['swapped.csv']")>=2,
                "Original file was never reread before Builder commit")
        close_modal(page)
        require(exported_source(page)==baseline,
                "Original SHA mismatch silently replaced Builder")
        # A differently formatted source with a missing link endpoint must not
        # become an active scenario even when a UI button is pressed.
        choose_primary(page,"broken.csv",
          b"Asset ID,Hostname,Device Type,Connected To\npc01,PC,Windows,ghost\n")
        expect(page.locator('[data-network-import-preview="BLOCKED"]')).to_be_visible(timeout=20000)
        require(page.locator('[data-network-import-activate]').is_disabled(),
                "Broken link references can activate Builder")
        close_modal(page)
        require(exported_source(page)==baseline,
                "Invalid source mutated Builder")
        require(not errors,"Browser errors "+repr(errors))
        require(not outside,"Network requests "+repr(outside))
        return {"case":"same_size_file_replaced_after_preview_and_bad_link",
                "status":"PASS","staleOriginalBlocked":True,
                "badReferenceBlocked":True,"builderUnchanged":True,"outsideRequests":0}
    finally:page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",type=Path,required=True)
    args=ap.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
      u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
      "Only compiled local HTTP app and browser WebCrypto may be tested")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        launch=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:launch.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=launch)
        try:
            cases=[case_five_producers(browser,args.url),
                   case_csv_runtime_probes(browser,args.url),
                   case_source_changed_blocks_activation(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"Actual compiled Chromium one-click five-file inventory and modeled Engine",
            "environment":"GitHub Actions Ubuntu; Parrot-native and live network NOT_RUN",
            "cases":cases,"unsupportedLiveProbeActivation":False}
    (args.evidence_dir/"ic020-p1-five-source-original-sha-real-browser.json").write_text(
        json.dumps(report,indent=2)+"\n")
    print("PASS IC-020 P1 actual compiled Chromium five-source SHA-bound Builder and Runtime",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL IC-020 P1 real Chromium: "+str(exc),file=sys.stderr)
        raise

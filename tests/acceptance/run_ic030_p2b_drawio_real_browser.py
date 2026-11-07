#!/usr/bin/env python3
"""IC-030 P2b actual compiled Chromium reviewed diagrams.net Builder import."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup, exported_source, require, menu
from run_drawio_p3_real_browser import source, CANARY

ROOT=Path(__file__).resolve().parents[2]
FILENAME="reviewed-network.drawio"
RAW=source()
ALTERED=RAW.replace(b"SECRET-CUSTOMER-ONE",b"SECRET-CUSTOMER-TWO")
require(RAW!=ALTERED and len(RAW)==len(ALTERED),
        "Original source substitute must be valid same-byte-length XML")
PRIVATES=[CANARY,"10.4.8.12","198.51.100.84","CONFIDENTIAL-MONITOR",
          "SECRET-CUSTOMER","internal_server","secret_switch","secret_link",
          "private_monitor","mxCell"]

def open_review(page):
    menu(page).locator('[data-review-drawio-builder="REVIEW_REQUIRED"]').click()
    expect(page.locator('[data-drawio-candidate-panel="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)

def choose(page, data=RAW):
    page.locator('[data-drawio-candidate-file="true"]').set_input_files({
      "name":FILENAME,"mimeType":"application/xml","buffer":data})
    expect(page.locator('[data-drawio-candidate-controls="REVIEW_REQUIRED"]')).to_be_visible(timeout=30000)
    require(page.locator('[data-drawio-candidate-source-sha]').inner_text()==hashlib.sha256(data).hexdigest(),
            "Original bytes SHA-256 not displayed accurately")
    require("Compressed pages: " in page.locator('[data-drawio-candidate-counts]').inner_text(),
            "Actual compressed diagrams not parsed")
    require(page.locator('[data-drawio-candidate-selected-nodes="0"]').count()==1,
            "Implicit default node selection")
    require(page.locator('[data-drawio-candidate-selected-edges="0"]').count()==1,
            "Implicit default modeled link")
    require(page.locator('[data-drawio-candidate-confirm]').is_disabled(),
            "UI must forbid empty candidate")
    for private in PRIVATES:
        require(private not in page.locator('[data-drawio-candidate-panel]').inner_html(),
                "Private diagram source leaked to DOM: "+private)

def select(page, edge=False, typed=False, third=False):
    first=page.locator('[data-drawio-candidate-node="0:0"]')
    first.check()
    if typed:page.locator('[data-drawio-candidate-role="0:0"]').select_option("network.router")
    if edge:
        second=page.locator('[data-drawio-candidate-node="0:1"]')
        second.check()
        if typed:page.locator('[data-drawio-candidate-role="0:1"]').select_option("network.switch")
        e=page.locator('[data-drawio-candidate-edge="0:0"]')
        require(e.is_enabled(),"Drawn edge endpoints explicitly selected but edge unavailable")
        e.check()
        require(page.locator('[data-drawio-candidate-confirm]').is_disabled(),
                "Selected modeled connection accepted without separate acknowledgment")
        page.locator('[data-drawio-candidate-edge-ack="true"]').check()
    if third:
        page.locator('[data-drawio-candidate-node="1:0"]').check()
        if edge:
            require(page.locator('[data-drawio-candidate-confirm]').is_disabled(),
                    "Adding a node after edge consent must revoke old consent")
            require(not page.locator('[data-drawio-candidate-edge-ack="true"]').is_checked(),
                    "Old modeled link approval survived a subsequent node change")
            page.locator('[data-drawio-candidate-edge-ack="true"]').check()
    require(page.locator('[data-drawio-candidate-confirm]').is_enabled(),
            "Explicit chosen graph candidate not confirmed")

def close(page):
    page.locator('[data-drawio-candidate-cancel="true"]').click()
    expect(page.locator('[data-drawio-candidate-panel]')).to_have_count(0,timeout=15000)

def inject_read_gate(page,mode):
    page.evaluate("""({name,changed,mode})=>{
      const original=File.prototype.arrayBuffer;
      window.__ic030_p2b_reads=0;
      window.__ic030_p2b_interrupted=0;
      const changedBytes=new Uint8Array(changed);
      File.prototype.arrayBuffer=function(){
        if(this.name===name){
          window.__ic030_p2b_reads++;
          if(window.__ic030_p2b_reads>=2 && mode==='swap')
            return Promise.resolve(changedBytes.buffer.slice(0));
          if(window.__ic030_p2b_reads===2 && mode==='workspace'){
            const trigger=Array.from(document.querySelectorAll('button'))
              .find(b=>b.textContent?.trim()==='Öppna enterprise i byggläget');
            if(!trigger || trigger.disabled)throw new Error('IC030_P2B_TEST_WORKSPACE_TRIGGER_MISSING');
            trigger.click();
            window.__ic030_p2b_interrupted++;
          }
        }
        return original.call(this);
      };
    }""",{"name":FILENAME,"changed":list(ALTERED),"mode":mode})

def invariant(errors,external):
    require(not errors,"Actual compiled Chromium errors: "+repr(errors))
    require(not external,"Unexpected outbound request: "+repr(external))

def case_cancel(browser,url):
    page,errors,external=setup(browser,url)
    try:
        previous=exported_source(page)
        open_review(page)
        choose(page)
        select(page,edge=True,typed=True)
        close(page)
        require(exported_source(page)==previous,"Cancellation mutated active Builder")
        invariant(errors,external)
        return {"case":"review_cancel_preserves_builder","status":"PASS"}
    finally:page.close()

def case_generic(browser,url):
    page,errors,external=setup(browser,url)
    try:
        open_review(page)
        choose(page)
        select(page)
        page.locator('[data-drawio-candidate-confirm]').click()
        expect(page.locator('[data-drawio-candidate-panel]')).to_have_count(0,timeout=45000)
        scenario=page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
        require(scenario=="drawio_reviewed","Reviewed Builder draft not committed")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "Unexpected automatic Runtime activation")
        exported=exported_source(page)
        require(len(exported["resources"])==1 and
                exported["resources"][0]["type"]=="resource.generic",
                "Single selected drawn vertex must remain generic")
        require(exported["connections"]==[],"Unselected drawn edge was invented as physical cable")
        require(exported["completion"]["path"]=="drawio_manual_verification",
                "Missing unfulfilled verification objective")
        invariant(errors,external)
        return {"case":"one_generic_drawn_vertex_no_inferred_edge","status":"PASS"}
    finally:page.close()

def case_reviewed(browser,url):
    page,errors,external=setup(browser,url)
    try:
        inject_read_gate(page,"count")
        open_review(page)
        choose(page)
        require(page.evaluate("window.__ic030_p2b_reads")==1,
                "Initial preview must read original only once")
        select(page,edge=True,typed=True,third=True)
        page.locator('[data-drawio-candidate-confirm]').click()
        expect(page.locator('[data-drawio-candidate-panel]')).to_have_count(0,timeout=45000)
        require(page.evaluate("window.__ic030_p2b_reads")>=2,
                "Original not reread after actual Builder compiler and ELK layout")
        src=exported_source(page)
        require(src["scenarioId"]=="drawio_reviewed","Wrong Builder identity")
        require([x["type"] for x in src["resources"]]==
                ["network.router","network.switch","resource.generic"],
                "User roles or generic fallback lost")
        require([x["id"] for x in src["resources"]]==
                ["drawio_node_p1_v1","drawio_node_p1_v2","drawio_node_p2_v1"],
                "Drawn position ordinals not preserved")
        require(len(src["connections"])==1 and
                src["connections"][0]["id"]=="drawio_link_p1_e1" and
                src["connections"][0]["from"]["resource"]=="drawio_node_p1_v1" and
                src["connections"][0]["to"]["resource"]=="drawio_node_p1_v2" and
                src["connections"][0]["properties"]=={},
                "Only explicitly selected drawn edge may be modeled")
        require(src["completion"]["path"]=="drawio_manual_verification",
                "Imported diagram must not establish Engine truth")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "Expected Builder (not Runtime/Engine auto launch)")
        exported_text=json.dumps(src)
        for private in PRIVATES:
            require(private not in exported_text,"Private raw diagram content in Builder: "+private)
        invariant(errors,external)
        return {"case":"mixed_compressed_pages_manual_roles_and_one_modeled_edge",
                "status":"PASS","sourceReread":True,"individuallyModeledEdges":1,
                "noPrivateOriginalValues":True,"autoEngineResult":False}
    finally:page.close()

def case_swap(browser,url):
    page,errors,external=setup(browser,url)
    try:
        previous=exported_source(page)
        inject_read_gate(page,"swap")
        open_review(page)
        choose(page)
        select(page,edge=True,typed=True)
        page.locator('[data-drawio-candidate-confirm]').click()
        expect(page.locator('[data-drawio-candidate-error="BLOCKED"]')).to_contain_text(
            "DRAWIO_CANDIDATE_SOURCE_CHANGED",timeout=45000)
        require(page.evaluate("window.__ic030_p2b_reads")>=2,
                "Same-length source mutation bypassed mandatory last read")
        require(page.locator('.app-frame').get_attribute('data-runtime-scenario-id')==previous["scenarioId"],
                "Blocked swapped source changed Builder while modal open")
        close(page)
        require(exported_source(page)==previous,"Blocked swapped file modified source")
        invariant(errors,external)
        return {"case":"same_size_original_file_swap_denied","status":"PASS"}
    finally:page.close()

def case_workspace(browser,url):
    page,errors,external=setup(browser,url)
    try:
        previous=exported_source(page)
        inject_read_gate(page,"workspace")
        open_review(page)
        choose(page)
        select(page,edge=True,typed=True)
        page.locator('[data-drawio-candidate-confirm]').click()
        expect(page.locator('[data-drawio-candidate-error="BLOCKED"]')).to_contain_text(
            "IC030_P2B_WORKSPACE_CHANGED",timeout=45000)
        require(page.evaluate("window.__ic030_p2b_interrupted")==1,
                "Real competing user Builder action did not fire")
        require(page.locator('.app-frame').get_attribute('data-runtime-scenario-id')!='drawio_reviewed',
                "Stale diagram replaced newer Builder")
        close(page)
        require(exported_source(page)!=previous,
                "Competing actual user Builder action did not change active source")
        invariant(errors,external)
        return {"case":"real_competing_builder_action_prevents_stale_drawio_commit","status":"PASS"}
    finally:page.close()

def case_invalid(browser,url):
    page,errors,external=setup(browser,url)
    try:
        previous=exported_source(page)
        open_review(page)
        choose(page)
        select(page,edge=True)
        payload=b'<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxfile/>'
        page.locator('[data-drawio-candidate-file="true"]').set_input_files({
          "name":FILENAME,"mimeType":"application/xml","buffer":payload})
        expect(page.locator('[data-drawio-candidate-error="BLOCKED"]')).to_contain_text(
            "IMPORT_XML_DTD_FORBIDDEN",timeout=30000)
        require(page.locator('[data-drawio-candidate-controls]').count()==0,
                "Old selection or consent survived invalid replaced original")
        close(page)
        require(exported_source(page)==previous,"DTD/XXE denial changed Builder")
        invariant(errors,external)
        return {"case":"malformed_xxe_clears_old_review","status":"PASS"}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and
            u.port is not None and u.path=="/" and not u.query and
            not u.fragment and not u.username and not u.password,
            "Compiled actual Chromium against loopback only")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:
            cases=[case_cancel(browser,args.url),case_generic(browser,args.url),
                   case_reviewed(browser,args.url),case_swap(browser,args.url),
                   case_workspace(browser,args.url),case_invalid(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"IC-030 P2b real compiled Chromium diagrams.net reviewed Builder",
            "platform":"GitHub Actions Ubuntu; Parrot/physical network NOT_RUN",
            "cases":cases,"verifiedPhysicalLinks":False,"realNetworkProbes":False}
    (args.evidence_dir/"ic030-p2b-drawio-reviewed-builder-real-chromium.json").write_text(
        json.dumps(report,indent=2)+"\n")
    print("PASS IC-030 P2b real compiled Chromium drawio reviewed Builder original-swap and concurrent workspace gate",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL IC-030 P2b actual Chromium: "+str(error),file=sys.stderr)
        raise

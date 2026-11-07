#!/usr/bin/env python3
"""IC-030 P1: actual compiled Chromium GraphML last-moment original re-read.
No runtime mocks/guest commands. The intentional File.arrayBuffer mutation is
adversarial input to the *actual* UI event handler, not a mocked Engine/UI.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require,menu

ROOT=Path(__file__).resolve().parents[2]
SOURCE=(ROOT/"tests/fixtures/import/graphml/valid-two-nodes.graphml").read_bytes()
ALTERED=SOURCE.replace(b"router_1",b"router_9")
require(len(SOURCE)==len(ALTERED),"Source-swap adversary must preserve byte size")
FILENAME="ic030-review.graphml"

def open_dialog(page):
    menu(page).locator('[data-inspect-graphml="PREVIEW_ONLY"]').click()
    expect(page.locator('[data-graphml-panel="PREVIEW_ONLY"]')).to_be_visible(timeout=12000)

def choose(page):
    page.locator('[data-graphml-file="true"]').set_input_files({
       "name":FILENAME,"mimeType":"application/xml","buffer":SOURCE
    })
    expect(page.locator('[data-graphml-mapping="REVIEW_REQUIRED"]')).to_be_visible(timeout=12000)
    digest=hashlib.sha256(SOURCE).hexdigest()
    require(digest in page.locator('[data-graphml-source-hash]').inner_text(),
       "Actual original SHA mismatch before review")
    require(page.locator('[data-graphml-role="0"]').input_value()=="resource.generic",
       "No hidden role inference before confirmation")
    require(not page.locator('[data-graphml-edge-decision="0"]').is_checked(),
       "Unselected graph edge inferred as physical link")
    return digest

def allow_modeled_edge(page):
    page.locator('[data-graphml-role="0"]').select_option("network.router")
    page.locator('[data-graphml-role="1"]').select_option("network.switch")
    page.locator('[data-graphml-edge-decision="0"]').check()
    require(page.locator('[data-graphml-map-confirm]').is_disabled(),
            "Missing second acknowledgement for modeled graph edge")
    page.locator('[data-graphml-edge-ack="true"]').check()
    require(page.locator('[data-graphml-map-confirm]').is_enabled(),
            "Explicit consent did not permit a reviewed Builder draft")

def close(page):
    page.locator('[data-graphml-cancel="true"]').click()
    expect(page.locator('[data-graphml-panel]')).to_have_count(0,timeout=15000)

def inject_read_gate(page,mode):
    page.evaluate("""({name,changed,mode})=>{
      const previous=File.prototype.arrayBuffer;
      window.__ic030_original_reads=0;
      window.__ic030_interruption=0;
      const alternative=new Uint8Array(changed);
      File.prototype.arrayBuffer=function(){
        if(this.name===name){
          window.__ic030_original_reads+=1;
          if(window.__ic030_original_reads>=2 && mode==='swap')
            return Promise.resolve(alternative.buffer.slice(0));
          if(window.__ic030_original_reads===2 && mode==='workspace'){
            const trigger=Array.from(document.querySelectorAll('button'))
              .find(b=>b.textContent?.trim()==='Öppna enterprise i byggläget');
            if(!trigger || trigger.disabled) throw new Error('IC030_TEST_WORKSPACE_TRIGGER_UNAVAILABLE');
            trigger.click();
            window.__ic030_interruption+=1;
          }
        }
        return previous.call(this);
      };
    }""",{"name":FILENAME,"changed":list(ALTERED),"mode":mode})

def checks(page,errors,outside):
    require(not errors,"Browser JavaScript errors "+repr(errors))
    require(not outside,"Unexpected external network request "+repr(outside))

def case_cancel(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        open_dialog(page)
        choose(page)
        allow_modeled_edge(page)
        close(page)
        require(exported_source(page)==before,"Review cancelled but active Builder changed")
        checks(page,errors,outside)
        return {"case":"explicit_cancel_preserves_builder","status":"PASS"}
    finally:page.close()

def case_fresh(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        inject_read_gate(page,"count")
        open_dialog(page)
        choose(page)
        require(page.evaluate("window.__ic030_original_reads")==1,
                "Preview must first read one original GraphML file")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")==before["scenarioId"],
                "Preview unexpectedly changed the active scenario before consent")
        allow_modeled_edge(page)
        page.locator('[data-graphml-map-confirm]').click()
        expect(page.locator('[data-graphml-panel]')).to_have_count(0,timeout=45000)
        page.wait_for_function(
          'document.querySelector(".app-frame")?.getAttribute("data-runtime-scenario-id") === "graphml_reviewed"',
          timeout=20000)
        require(page.evaluate("window.__ic030_original_reads")>=2,
                "Builder candidate committed without last-moment original reread")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "Reviewed GraphML must not automatically launch Runtime")
        src=exported_source(page)
        require([x["type"] for x in src["resources"]]==["network.router","network.switch"],
                "Reviewed roles not preserved in actual exported Builder")
        require([(x["from"]["resource"],x["to"]["resource"]) for x in src["connections"]]==[
                ("graph_node_1","graph_node_2")],"One graph edge was invented or omitted")
        require(src["connections"][0]["properties"]=={},
                "Selected graph edge was presented as measured physical truth")
        require(src["completion"]["path"]=="graphml_manual_verification",
                "Source import automatically passed verification")
        checks(page,errors,outside)
        return {"case":"reviewed_graphml_fresh_original_into_builder","status":"PASS",
                "sourceReread":True,"chosenModeledEdges":1,"noRuntimeActivation":True}
    finally:page.close()

def case_source_swap(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        inject_read_gate(page,"swap")
        open_dialog(page)
        choose(page)
        allow_modeled_edge(page)
        page.locator('[data-graphml-map-confirm]').click()
        err=page.locator('[data-graphml-error="BLOCKED"]')
        expect(err).to_contain_text("IC030_P1_SOURCE_CHANGED",timeout=45000)
        require(page.evaluate("window.__ic030_original_reads")>=2,
                "Same-length mutated original was not reread")
        require(page.locator('[data-graphml-panel]').count()==1,
                "Source swapped but GraphML dialog closed as if accepted")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")==before["scenarioId"],
                "Rejected original swap changed active scenario before dialog close")
        close(page)
        require(exported_source(page)==before,
                "Source swap mutated active Builder instead of failing closed")
        checks(page,errors,outside)
        return {"case":"same_length_original_substitution_blocked","status":"PASS",
                "sameSizeSourceSwap":True,"builderUnchanged":True}
    finally:page.close()

def case_competing_workspace(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        inject_read_gate(page,"workspace")
        open_dialog(page)
        choose(page)
        allow_modeled_edge(page)
        page.locator('[data-graphml-map-confirm]').click()
        err=page.locator('[data-graphml-error="BLOCKED"]')
        expect(err).to_contain_text("IC030_P1_WORKSPACE_CHANGED",timeout=45000)
        require(page.evaluate("window.__ic030_interruption")==1,
                "No real UI workspace change was triggered while reading original")
        require(page.evaluate("window.__ic030_original_reads")>=2,
                "Changed workspace was not detected after original file reread")
        require(page.locator('.app-frame').get_attribute("data-runtime-scenario-id")!="graphml_reviewed",
                "Stale GraphML overwrote a more recent Builder")
        close(page)
        require(exported_source(page)!=before,
                "Competing user workspace action did not actually occur")
        checks(page,errors,outside)
        return {"case":"concurrent_real_workspace_change_prevents_stale_graphml_commit",
                "status":"PASS","staleGraphRejected":True}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
    args=p.parse_args()
    loc=urlsplit(args.url)
    require(loc.scheme=="http" and loc.hostname=="127.0.0.1" and
            loc.port is not None and loc.path=="/" and not loc.query and
            not loc.fragment and not loc.username and not loc.password,
            "GraphML browser acceptance must use local compiled app only")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as driver:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=driver.chromium.launch(headless=True,args=flags)
        try:
            cases=[case_cancel(browser,args.url),case_fresh(browser,args.url),
                   case_source_swap(browser,args.url),case_competing_workspace(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"Actual compiled Chromium GraphML P1 original SHA reread and workspace race",
            "environment":"Ubuntu GitHub Actions; native Parrot and physical network NOT_RUN",
            "cases":cases,"realNetworkProbes":False}
    (args.evidence_dir/"ic030-p1-graphml-original-workspace-real-browser.json").write_text(
       json.dumps(report,indent=2)+"\n")
    print("PASS IC-030 P1 actual compiled Chromium GraphML original rereread, same-size swap and live Builder race denial",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL IC-030 P1 real Chromium: "+str(exc),file=sys.stderr)
        raise

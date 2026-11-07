#!/usr/bin/env python3
"""IC-020 P2a: real compiled Chromium dual explicit link-source review, no inference."""
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
SOURCE=(ROOT/"tests/fixtures/import/ic020-p2a-consultant-dual-source.json").read_bytes()
SOURCE_SHA=hashlib.sha256(SOURCE).hexdigest()
CANARY="SECRET_IC020_P2A_CANARY_NOT_REAL"
INDEPENDENT_SHEET={
  ("fw01","rtr01"),("sw01","fw01"),("sw02","fw01"),
  ("win01","sw01"),("lin01","sw02"),("win02","sw01")
}
INDEPENDENT_INLINE={
  ("fw01","rtr01"),("sw01","fw01"),("sw02","sw01"),
  ("win01","sw01"),("lin01","sw02"),("win02","sw01"),("lin02","sw02")
}

def file_picker(page,data=SOURCE,name="consultant.json"):
  with page.expect_file_chooser(timeout=10000) as task:
    page.locator('[data-network-import-primary="true"]').click()
  task.value.set_files({"name":name,"mimeType":"application/json","buffer":data})
  expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=25000)

def pending(page):
  expect(page.locator('[data-network-import-preview="BLOCKED"]')).to_be_visible(timeout=25000)
  expect(page.locator('[data-network-import-link-review="REVIEW_REQUIRED"]')).to_be_visible()
  require(not page.locator('[data-network-import-activate]').is_enabled(),
    "Competing declared links activated without operator selection")
  require(not page.locator('[data-network-import-runtime]').is_enabled(),
    "Competing declared links activated modeled Runtime without review")
  require(page.locator('[data-network-import-link-source-sheet]').is_enabled(),
    "Links-sheet choice missing")
  require(page.locator('[data-network-import-link-source-inline]').is_enabled(),
    "Connected To choice missing")
  require("Links table 6" in page.locator('[data-network-import-link-review]').inner_text(),
    "Incorrect bounded source link count")
  require("Connected To 7" in page.locator('[data-network-import-link-review]').inner_text(),
    "Incorrect bounded inline link count")
  require(SOURCE_SHA in page.locator('[data-network-import-sha]').inner_text(),
    "Original source full SHA not shown in unresolved review")
  require(CANARY not in page.locator('[data-network-import-panel]').inner_html(),
    "Private source field leaked in preview or conflict review")

def choose(page,kind):
  button="sheet" if kind=="LINKS_SHEET" else "inline"
  page.locator('[data-network-import-link-source-'+button+']').click()
  expect(page.locator('[data-network-import-link-review="REVIEWED"]')).to_be_visible(timeout=35000)
  expect(page.locator('[data-network-import-link-choice="'+kind+'"]')).to_be_visible()
  expect(page.locator('[data-network-import-preview="READY"]')).to_be_visible()
  want=6 if kind=="LINKS_SHEET" else 7
  require(f"Devices: 8 · Explicit links: {want}" in page.locator('[data-network-import-preview]').inner_text(),
          "Declared source link count did not match chosen original")
  require(SOURCE_SHA in page.locator('[data-network-import-sha]').inner_text(),
          "Re-parsed original source SHA changed after review")
  require(page.locator('[data-network-import-activate]').is_enabled(),"Reviewed source cannot enter Builder")
  require(page.locator('[data-network-import-runtime]').is_enabled(),"Reviewed source cannot enter modeled Runtime")
  require(CANARY not in page.locator('[data-network-import-panel]').inner_html(),
          "Private source content exposed by reviewed result")
  require(page.locator('[data-network-import-link-source-sheet]').count()==0,
          "Source choice can be changed without a fresh source review")

def edges(source):
  return {(x["from"]["resource"],x["to"]["resource"]) for x in source["connections"]}

def case_builder(browser,url,choice):
  page,errors,outside=setup(browser,url)
  try:
    baseline=exported_source(page)
    baselineId=page.locator('.app-frame').get_attribute('data-runtime-scenario-id')
    file_picker(page)
    pending(page)
    require(page.locator('.app-frame').get_attribute('data-runtime-scenario-id')==baselineId,
            "Blocked conflicting source changed current Builder identity")
    choose(page,choice)
    page.locator('[data-network-import-activate]').click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
    source=exported_source(page)
    expected=INDEPENDENT_SHEET if choice=="LINKS_SHEET" else INDEPENDENT_INLINE
    require(len(source.get("resources",[]))==8,
            "Review path omitted/added an unexplained resource")
    require(edges(source)==expected,
            "Review activated unselected source links or merged source edges")
    require(len(source["connections"])==len(expected),"Unexpected physical cable inference")
    require(set(x["id"] for x in source["resources"])==
      {"rtr01","fw01","sw01","sw02","win01","lin01","win02","lin02"},
      "Imported network IDs not grounded in original inventory")
    require(not errors,"Browser threw error "+repr(errors))
    require(not outside,"Outside browser network requests "+repr(outside))
    return {"case":"manual_review_"+choice+"_into_Builder","status":"PASS",
      "sourcesAvailable":2,"selected":choice,"devices":8,"explicitLinks":len(expected),
      "originalSha256":SOURCE_SHA,"noUnreviewedBuilderMutation":True,
      "outsideRequests":0}
  finally:page.close()

def case_runtime(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    file_picker(page)
    pending(page)
    choose(page,"INLINE_CONNECTED_TO")
    page.locator('[data-network-import-runtime]').click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
    page.wait_for_function(
      "document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-hash') !== 'builder'",
      timeout=30000)
    pane=page.locator('[data-active-probe-engine]').first
    expect(pane).to_be_visible(timeout=20000)
    require(pane.get_attribute("open") is not None,
            "Modeled probe panel not opened after reviewed Runtime")
    pane.get_by_role("button",name="Kör modellerad aktiv probe").click()
    transcript=page.locator('[data-active-probe-transcript]').first
    expect(transcript).to_be_visible(timeout=18000)
    txt=transcript.inner_text()
    require("NO_GUEST_COMMAND_EXECUTION" in txt,"False real probe claim")
    require("Engine " in txt,"No modeled Engine truth")
    require(transcript.get_attribute("data-active-probe-scenario-hash")==
            page.locator('.app-frame').get_attribute('data-runtime-scenario-hash'),
            "Transcript is from stale or different Runtime")
    require(not errors,"Runtime errors "+repr(errors))
    require(not outside,"Outside network requests "+repr(outside))
    return {"case":"manual_review_connected_to_into_modeled_Engine",
      "status":"PASS","boundary":"NO_GUEST_COMMAND_EXECUTION",
      "transcriptHashMatchesActualRuntime":True,"outsideRequests":0}
  finally:page.close()

def patch_file_after_read(page,threshold,altered):
  page.evaluate("""({threshold, changed}) => {
    const original=File.prototype.arrayBuffer;
    window.__ic020P2aReads={};
    const newBuffer=new Uint8Array(changed).buffer;
    File.prototype.arrayBuffer=function(){
      if(this.name==="consultant.json"){
        const n=(window.__ic020P2aReads[this.name]||0)+1;
        window.__ic020P2aReads[this.name]=n;
        if(n>=threshold)return Promise.resolve(newBuffer.slice(0));
      }
      return original.call(this);
    };
  }""",{"threshold":threshold,"changed":list(altered)})

def case_tamper(browser,url,threshold):
  page,errors,outside=setup(browser,url)
  try:
    baseline=exported_source(page)
    altered=SOURCE.replace(b'"sw02"',b'"sw99"',1)
    require(len(altered)==len(SOURCE),"Mutation oracle must preserve original byte length")
    patch_file_after_read(page,threshold,altered)
    file_picker(page)
    pending(page)
    if threshold==2:
      page.locator('[data-network-import-link-source-sheet]').click()
      expect(page.locator('[data-network-import-panel] [role="alert"]')).to_contain_text(
        "IC020_P2A_SOURCE_CHANGED",timeout=35000)
      require(page.locator('[data-network-import-link-review="REVIEWED"]').count()==0,
              "Changed source obtained a reviewed decision")
    else:
      choose(page,"LINKS_SHEET")
      page.locator('[data-network-import-activate]').click()
      expect(page.locator('[data-network-import-panel] [role="alert"]')).to_contain_text(
        "IC020_P1_SOURCE_CHANGED",timeout=40000)
      require(page.locator('[data-network-import-panel]').count()==1,
              "Changed original silently closed modal after Builder activation")
    require(page.evaluate("window.__ic020P2aReads['consultant.json']")>=threshold,
            "Source was not reread at actual reviewed stage")
    page.get_by_role("button",name="Close network import").click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0)
    require(exported_source(page)==baseline,
            "Changed source mutated existing Builder")
    require(not errors,"Browser errors "+repr(errors))
    require(not outside,"Outside network requests "+repr(outside))
    return {"case":"same_size_original_mutation_on_read_"+str(threshold),
        "status":"PASS","changedOriginalBlocked":True,
        "originalRereadCount":threshold,"builderUnchanged":True,
        "outsideRequests":0}
  finally:page.close()

def case_close_reopen(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    baseline=exported_source(page)
    file_picker(page)
    pending(page)
    choose(page,"LINKS_SHEET")
    page.get_by_role("button",name="Close network import").click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0)
    file_picker(page)
    pending(page)
    require(page.locator('[data-network-import-link-review="REVIEWED"]').count()==0,
            "Explicit choice improperly persisted across modal close/reopen")
    page.get_by_role("button",name="Close network import").click()
    require(exported_source(page)==baseline,"Close/reopen mutated original Builder")
    require(not errors and not outside,"Console/HTTP errors")
    return {"case":"close_reopen_resets_operator_choice","status":"PASS",
        "consentNotReused":True,"builderUnchanged":True,"outsideRequests":0}
  finally:page.close()

def main():
  p=argparse.ArgumentParser()
  p.add_argument("--url",required=True)
  p.add_argument("--evidence-dir",type=Path,required=True)
  a=p.parse_args()
  target=urlsplit(a.url)
  require(target.scheme=="http" and target.hostname=="127.0.0.1" and
      target.port is not None and target.path=="/" and
      not target.query and not target.fragment and
      not target.username and not target.password,
      "Only original compiled app at local browser HTTP origin")
  a.evidence_dir.mkdir(parents=True,exist_ok=True)
  with sync_playwright() as p:
    opts=["--disable-dev-shm-usage","--disable-background-networking"]
    if hasattr(os,"geteuid") and os.geteuid()==0:opts.append("--no-sandbox")
    browser=p.chromium.launch(headless=True,args=opts)
    try:
      cases=[case_builder(browser,a.url,"LINKS_SHEET"),
             case_builder(browser,a.url,"INLINE_CONNECTED_TO"),
             case_runtime(browser,a.url),
             case_tamper(browser,a.url,2),
             case_tamper(browser,a.url,3),
             case_close_reopen(browser,a.url)]
    finally:browser.close()
  report={"status":"PASS","kind":"Actual compiled YadiLab Chromium dual declared-source operator review",
          "environment":"GitHub Actions Ubuntu; Parrot-native and physical links NOT_RUN",
          "cases":cases,"autoMerge":False,"inferredLinks":False,"realNetworkTraffic":False}
  (a.evidence_dir/"ic020-p2a-dual-link-source-real-browser.json").write_text(
    json.dumps(report,indent=2)+"\n")
  print("PASS IC-020 P2a actual compiled Chromium dual-source explicit review and stale-original blocking",flush=True)
  print(json.dumps(report,indent=2))

if __name__=="__main__":
  try:main()
  except Exception as exc:
    print("FAIL IC-020 P2a real Chromium: "+str(exc),file=sys.stderr)
    raise

#!/usr/bin/env python3
"""P2b: actual compiled Chromium; two consecutive core network inventories,
read-only live Builder comparison, separate approval, original SHA rechecks.
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
CSV=(ROOT/"examples/enterprise-import/network-devices-example.csv").read_bytes()
lines=CSV.decode().strip().splitlines()
keys=lines[0].split(",")
original=[dict(zip(keys,line.split(","))) for line in lines[1:]]
changed=[
  original[0],
  original[1],
  {**original[2],"Hostname":"Reception PC revised"},
  {**original[3],"Asset ID":"linux01","Device Type":"Linux","Hostname":"New Linux Support"}
]
JSON_REV=json.dumps({"Devices":changed},separators=(",",":")).encode()
JSON_TAMPER=json.dumps({"Devices":[
  ({**x,"Hostname":"Source changed after approval"} if x["Asset ID"]=="linux01" else x)
  for x in changed
]},separators=(",",":")).encode()
D=hashlib.sha256(JSON_REV).hexdigest()

def begin(page,name,data):
  with page.expect_file_chooser(timeout=11000) as chooser:
    page.locator('[data-network-import-primary="true"]').click()
  chooser.value.set_files({"name":name,"mimeType":"application/octet-stream","buffer":data})
  expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=12000)
  expect(page.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=25000)

def base(page):
  begin(page,"baseline.csv",CSV)
  require(page.locator('[data-network-reimport-review]').count()==0,
    "Initial import from welcome scenario incorrectly requires reimport approval")
  page.locator('[data-network-import-activate]').click()
  expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
  old=exported_source(page)
  require(len(old.get("resources",[]))==4 and len(old.get("connections",[]))==3,
    "Actual initial CSV baseline not imported")
  return old

def ready_for_reimport(page):
  begin(page,"revision.json",JSON_REV)
  expect(page.locator('[data-network-reimport-review="REVIEW_REQUIRED"]')).to_be_visible()
  require(page.locator('[data-network-import-activate]').is_disabled(),
    "Reimport Builder action activated without comparison")
  require(page.locator('[data-network-import-runtime]').is_disabled(),
    "Reimport Runtime action activated without comparison")
  require(D in page.locator('[data-network-import-sha]').inner_text(),
    "New original incoming SHA not bound to review")
  require(page.locator('[data-network-reimport-diff]').count()==0,
    "Diff appeared before explicit review")

def review(page):
  page.locator('[data-network-reimport-compare]').click()
  expect(page.locator('[data-network-reimport-review="REVIEWED"]')).to_be_visible(timeout=35000)
  block=page.locator('[data-network-reimport-diff]')
  require("added 1, removed 1, changed 1, unchanged 2" in
    block.locator('[data-network-reimport-resource-counts]').inner_text(),
    "Independent expected resource diff lost or falsely inferred")
  require("added 0, removed 0, changed 1, unchanged 2" in
    block.locator('[data-network-reimport-link-counts]').inner_text(),
    "Independent expected explicit link diff lost or falsely inferred")
  previous=block.locator('[data-network-reimport-workspace-sha]').inner_text()
  incoming=block.locator('[data-network-reimport-original-sha]').inner_text()
  require("NOT an original-file SHA" in previous,
    "Live Builder snapshot incorrectly claimed previous file original SHA")
  require(D in incoming,"New original byte SHA mismatch")
  require("192.168" not in block.inner_text() and "New Linux Support" not in block.inner_text(),
    "Reimport report leaked raw source IP or hostnames")
  require(page.locator('[data-network-import-activate]').is_disabled(),
    "Read-only compare silently enabled replacement without distinct approval")
  return previous,incoming

def approve(page):
  page.locator('[data-network-reimport-approve]').click()
  expect(page.locator('[data-network-reimport-review="APPROVED"]')).to_be_visible()
  require(page.locator('[data-network-import-activate]').is_enabled(),
    "Explicit reimport approval did not expose separate Builder action")
  require(page.locator('[data-network-import-runtime]').is_enabled(),
    "Explicit reimport approval did not expose separate Runtime action")

def close(page):
  page.get_by_role("button",name="Close network import").click()
  expect(page.locator('[data-network-import-panel]')).to_have_count(0)

def case_read_only_then_replace(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    old=base(page)
    ready_for_reimport(page)
    require(page.locator('[data-network-reimport-review="REVIEW_REQUIRED"]').count()==1,
      "Second preview should require review while Builder remains behind the modal")
    before,digest=review(page)
    require(page.locator('[data-network-reimport-review="REVIEWED"]').count()==1,
      "Read-only comparison must remain a review, not a committed import")
    approve(page)
    require(page.locator('[data-network-import-panel]').count()==1,
      "Approval alone must not close the dialog or activate Builder")
    page.locator('[data-network-import-activate]').click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
    new=exported_source(page)
    ids={x["id"] for x in new["resources"]}
    require(ids=={"router01","switch01","pc01","linux01"},
      "After approved reimport new and removed devices did not match original")
    require(len(new["connections"])==3,"No extra links should have been inferred")
    require(new["resources"][2]["label"]=="Reception PC revised",
      "Changed source label was not imported after operator approval")
    require(not errors and not outside,"Browser or external requests failed")
    return {"case":"nonmutating_compare_then_separate_approval_and_reimport_builder",
      "status":"PASS","oldDevices":4,"newDevices":4,"linkChanges":1,
      "newIncomingOriginalSha256":D,"previousWorkspaceShaIsNotFileSha":True,
      "reimportOnlyAfterSeparateApproval":True,"outsideRequests":0}
  finally:page.close()

def case_deny_tampered_after_approval(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    old=base(page)
    page.evaluate("""changed => {
      const prior=File.prototype.arrayBuffer;
      window.__p2b_reads={};
      const bytes=new Uint8Array(changed).buffer;
      File.prototype.arrayBuffer=function(){
        if(this.name==="revision.json"){
          const n=(window.__p2b_reads[this.name]||0)+1;
          window.__p2b_reads[this.name]=n;
          if(n>=3)return Promise.resolve(bytes.slice(0));
        }
        return prior.call(this);
      }
    }""",list(JSON_TAMPER))
    ready_for_reimport(page)
    review(page)
    approve(page)
    page.locator('[data-network-import-activate]').click()
    expect(page.locator('[data-network-import-panel] [role="alert"]')).to_contain_text(
      "IC020_P1_SOURCE_CHANGED",timeout=42000)
    require(page.evaluate("window.__p2b_reads['revision.json']")>=3,
      "Original was not independently reread AFTER review+approval")
    close(page)
    require(exported_source(page)==old,
      "Tampered source overwrote active Builder after approval")
    require(not errors and not outside,"Browser/outside network failures")
    return {"case":"original_changed_after_diff_approval_before_commit",
      "status":"PASS","sourceReopenedThreeTimes":True,
      "builderUnchanged":True,"outsideRequests":0}
  finally:page.close()

def case_close_and_switch(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    old=base(page)
    ready_for_reimport(page)
    review(page)
    approve(page)
    close(page)
    ready_for_reimport(page)
    require(page.locator('[data-network-reimport-review="REVIEW_REQUIRED"]').count()==1,
      "Approved decision leaked after modal close/reopen")
    require(page.locator('[data-network-reimport-approve]').count()==0,
      "Approved decision leaked into new source")
    review(page)
    approve(page)
    page.locator('[data-network-import-file]').set_input_files({
      "name":"revision.csv","mimeType":"text/csv","buffer":CSV})
    expect(page.locator('[data-network-reimport-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
    require(page.locator('[data-network-import-activate]').is_disabled(),
      "File switch retained approved replacement for previous source")
    close(page)
    require(exported_source(page)==old,"Canceled or switched source mutated Builder")
    require(not errors and not outside,"Browser/outside request errors")
    return {"case":"close_reopen_file_switch_drops_source_bound_review",
      "status":"PASS","builderUnchanged":True,
      "approvalNotReused":True,"outsideRequests":0}
  finally:page.close()

def case_approved_runtime(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    base(page)
    ready_for_reimport(page)
    review(page)
    approve(page)
    page.locator('[data-network-import-runtime]').click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
    page.wait_for_function(
      "document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-hash') !== 'builder'",
      timeout=30000)
    pane=page.locator('[data-active-probe-engine]').first
    expect(pane).to_be_visible(timeout=20000)
    pane.get_by_role("button",name="Kör modellerad aktiv probe").click()
    transcript=page.locator('[data-active-probe-transcript]').first
    expect(transcript).to_be_visible(timeout=20000)
    txt=transcript.inner_text()
    require("NO_GUEST_COMMAND_EXECUTION" in txt,
      "Reimported Runtime was falsely presented as guest command execution")
    require(transcript.get_attribute("data-active-probe-scenario-hash")==
       page.locator('.app-frame').get_attribute("data-runtime-scenario-hash"),
      "Probe transcript stale or from a different reimport source")
    require(not errors and not outside,"Browser/outside HTTP errors")
    return {"case":"explicitly_approved_reimport_to_modeled_runtime",
      "status":"PASS","boundary":"NO_GUEST_COMMAND_EXECUTION",
      "scenarioBound":True,"outsideRequests":0}
  finally:page.close()

def main():
  p=argparse.ArgumentParser()
  p.add_argument("--url",required=True)
  p.add_argument("--evidence-dir",type=Path,required=True)
  args=p.parse_args()
  target=urlsplit(args.url)
  require(target.scheme=="http" and target.hostname=="127.0.0.1" and
    target.port is not None and target.path=="/" and not target.query and
    not target.fragment and not target.username and not target.password,
    "Only local compiled Chromium browser acceptance")
  args.evidence_dir.mkdir(parents=True,exist_ok=True)
  with sync_playwright() as p:
    opts=["--disable-dev-shm-usage","--disable-background-networking"]
    if hasattr(os,"geteuid") and os.geteuid()==0:opts.append("--no-sandbox")
    browser=p.chromium.launch(headless=True,args=opts)
    try:
      cases=[
        case_read_only_then_replace(browser,args.url),
        case_deny_tampered_after_approval(browser,args.url),
        case_close_and_switch(browser,args.url),
        case_approved_runtime(browser,args.url),
      ]
    finally:browser.close()
  report={"status":"PASS","kind":"Actual compiled Chromium explicit core reimport review and source-bound approval",
    "environment":"Ubuntu GitHub Actions; native Parrot and physical network NOT_RUN",
    "cases":cases,"unreviewedMutation":False,"liveNetworkProbe":False}
  (args.evidence_dir/"ic020-p2b-source-bound-reimport-real-browser.json").write_text(
    json.dumps(report,indent=2)+"\n")
  print("PASS IC-020 P2b actual compiled Chromium reimport diff, approval and stale source rejection",flush=True)
  print(json.dumps(report,indent=2))
if __name__=="__main__":
  try:main()
  except Exception as exc:
    print("FAIL IC-020 P2b real Chromium: "+str(exc),file=sys.stderr)
    raise

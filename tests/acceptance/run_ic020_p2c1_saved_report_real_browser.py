#!/usr/bin/env python3
"""IC-020 P2c1: compiled Chromium read-only saved diff export, strict fresh replay,
no approval reuse and no live-network/Builder mutation before explicit consent.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require
from run_ic020_p2b_reimport_real_browser import (
  base,ready_for_reimport,review,approve,close,JSON_REV,JSON_TAMPER,D
)

FORMAT="yadilab.core-network-reimport-review.v1"
def send_saved(page,data,name="saved-reimport.json"):
  page.locator('[data-network-reimport-replay-file]').set_input_files({
    "name":name,"mimeType":"application/json","buffer":data,
  })

def capture(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    before=base(page)
    ready_for_reimport(page)
    review(page)
    with page.expect_download(timeout=18000) as wait:
      page.locator('[data-network-reimport-export-report]').click()
    download=wait.value
    path=download.path()
    require(path is not None,"Saved read-only report was not downloaded")
    raw=Path(path).read_bytes()
    record=json.loads(raw.decode("utf-8"))
    require(len(raw)<16*1024,"Portable report exceeded frozen 16KiB bound")
    require(download.suggested_filename.startswith("yadilab-core-reimport-") and
      download.suggested_filename.endswith(".json"),"Nonportable download name")
    require(record.get("formatId")==FORMAT and record.get("schemaVersion")==1 and
      record.get("status")=="REVIEW_ONLY","Sidecar was not the fixed versioned read-only format")
    require(record.get("canActivate") is False and
      record.get("engineVerified") is False and
      record.get("physicalTopologyVerified") is False,
      "Saved report claimed verified Engine/physical truth or autoactivation")
    require(record["incomingOriginalSourceSha256"]==D,
      "Saved sidecar original SHA was not the selected file")
    require(record["currentWorkspaceSourceSha256"]!=D,
      "Saved sidecar incorrectly claimed live Builder digest was old file original")
    require(record["resources"]=={"added":1,"removed":1,"changed":1,"unchanged":2},
      "Downloaded changed resources do not match actual P2b diff")
    require(record["connections"]=={"added":0,"removed":0,"changed":1,"unchanged":2},
      "Downloaded changed connections do not match actual P2b diff")
    for secret in ["New Linux Support","Reception PC","192.168","Hostname",
        "IP Address","fileName","SECRET","password","rawCell","linux01"]:
      require(secret not in raw.decode("utf-8"),"Raw source or private information leaked: "+secret)
    require(page.locator('[data-network-import-activate]').is_disabled(),
      "Downloading sidecar automatically approved replacement")
    close(page)
    require(exported_source(page)==before,"Sidecar export mutated active Builder")
    require(not errors and not outside,"Console errors or external HTTP")
    return raw,{"case":"real_download_of_strict_only_aggregate_report",
      "status":"PASS","sizeBytes":len(raw),"originalSha256":D,
      "workspaceShaDistinctFromOriginal":True,"approvalNotGranted":True,
      "builderUnchanged":True,"outsideRequests":0}
  finally:page.close()

def case_replay_fresh(browser,url,saved):
  page,errors,outside=setup(browser,url)
  try:
    old=base(page)
    ready_for_reimport(page)
    require(page.locator('[data-network-reimport-replay-file]').get_attribute("accept")==".json",
      "Saved report file picker not distinct and format bounded")
    require(page.locator('[data-network-import-activate]').is_disabled(),
      "Reimport active before saved report was checked")
    send_saved(page,saved)
    expect(page.locator('[data-network-reimport-replay-status="MATCHED_REVIEW_ONLY"]')).to_be_visible(
      timeout=30000)
    expect(page.locator('[data-network-reimport-review="REVIEWED"]')).to_be_visible()
    require(page.locator('[data-network-import-runtime]').is_disabled() and
      page.locator('[data-network-import-activate]').is_disabled(),
      "Old saved report silently restored replacement approval")
    require(page.locator('[data-network-import-panel]').count()==1,
      "Report replay must leave review modal open and both activation actions blocked")
    require(page.locator('[data-network-reimport-approve]').count()==1,
      "No separate explicit review approval after saved replay")
    approve(page)
    require(page.locator('[data-network-import-panel]').count()==1,
      "Approval on its own should not replace workspace")
    page.locator('[data-network-import-activate]').click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
    new=exported_source(page)
    require({x["id"] for x in new["resources"]}=={"router01","switch01","pc01","linux01"},
      "New original inventory not actually imported after separate review and approval")
    require(len(new["connections"])==3,"Inferred or missing core connections after saved replay")
    require(not errors and not outside,"Browser console / outside network")
    return {"case":"saved_report_matched_only_after_fresh_source_and_live_builder",
      "status":"PASS","replayState":"MATCHED_REVIEW_ONLY",
      "newApprovalStillMandatory":True,"builderChangedOnlyAfterExplicitActivation":True,
      "outsideRequests":0}
  finally:page.close()

def case_invalid_and_tampered(browser,url,saved):
  page,errors,outside=setup(browser,url)
  try:
    old=base(page)
    ready_for_reimport(page)
    for i,change in enumerate([
      {"incomingOriginalSourceSha256":"a"*64},
      {"resources":{"added":4,"removed":0,"changed":0,"unchanged":2}},
      {"canActivate":True},
      {"hostName":"SECRET_CANARY_NOT_REAL"},
      {"currentWorkspaceRevision":-1},
    ]):
      data=json.loads(saved.decode("utf-8"))
      data.update(change)
      send_saved(page,json.dumps(data).encode(),name="tampered.json")
      code="IC020_P2C1_REPLAY_MISMATCH" if i in (0,1) else "IC020_P2C1_SIDECAR_INVALID"
      expect(page.locator('[data-network-import-panel] [role="alert"]')).to_contain_text(
        code,timeout=25000)
      require(page.locator('[data-network-reimport-replay-status]').count()==0,
        "Invalid/unmatched saved report accepted")
      require(page.locator('[data-network-import-activate]').is_disabled(),
        "Invalid sidecar granted Builder activation")
      require(page.locator('[data-network-import-activate]').is_disabled(),
        "Tampered report must not enable activation while dialog blocks the Builder")
    send_saved(page,b"x"*(16*1024+1),name="huge.json")
    expect(page.locator('[data-network-import-panel] [role="alert"]')).to_contain_text(
      "IC020_P2C1_SIDECAR_INVALID",timeout=25000)
    require(page.locator('[data-network-import-activate]').is_disabled(),
      "Oversize saved report approved source")
    close(page)
    require(exported_source(page)==old,"Malformed imported report mutated Builder")
    require(not errors and not outside,"Browser errors / outside HTTP")
    return {"case":"malicious_and_unmatched_saved_reports_are_only_denied",
      "status":"PASS","tamperedVariants":6,"builderUnchanged":True,"outsideRequests":0}
  finally:page.close()

def case_changed_source_at_replay(browser,url,saved):
  page,errors,outside=setup(browser,url)
  try:
    old=base(page)
    page.evaluate("""changed=>{
      const prior=File.prototype.arrayBuffer;
      const modified=new Uint8Array(changed).buffer;
      window.__p2c1Reads=0;
      File.prototype.arrayBuffer=function(){
        if(this.name==="revision.json"){
          const n=++window.__p2c1Reads;
          if(n>=2)return Promise.resolve(modified.slice(0));
        }
        return prior.call(this);
      };
    }""",list(JSON_TAMPER))
    ready_for_reimport(page)
    send_saved(page,saved)
    expect(page.locator('[data-network-import-panel] [role="alert"]')).to_contain_text(
      "IC020_P2C1_REPLAY_MISMATCH",timeout=30000)
    require(page.evaluate("window.__p2c1Reads")>=2,
      "No independent original source byte recheck on saved report replay")
    require(page.locator('[data-network-reimport-replay-status]').count()==0,
      "Changed original falsely matched saved report")
    require(page.locator('[data-network-import-activate]').is_disabled(),
      "Source change granted workspace replacement")
    close(page)
    require(exported_source(page)==old,"Stale changed original mutated Builder")
    require(not errors and not outside,"Browser/outside network errors")
    return {"case":"source_changed_between_selection_and_saved_report_replay",
      "status":"PASS","originalReread":True,"builderUnchanged":True,
      "outsideRequests":0}
  finally:page.close()

def case_close_reopen_approval_not_reused(browser,url,saved):
  page,errors,outside=setup(browser,url)
  try:
    old=base(page)
    ready_for_reimport(page)
    send_saved(page,saved)
    expect(page.locator('[data-network-reimport-replay-status="MATCHED_REVIEW_ONLY"]')).to_be_visible(
      timeout=30000)
    approve(page)
    close(page)
    ready_for_reimport(page)
    require(page.locator('[data-network-reimport-replay-status]').count()==0,
      "Previously matched report leaked across close/reopen")
    require(page.locator('[data-network-reimport-review="REVIEW_REQUIRED"]').count()==1,
      "Previously approved saved report retained after close")
    require(page.locator('[data-network-import-activate]').is_disabled(),
      "Saved approval persisted without reselection")
    close(page)
    require(exported_source(page)==old,"Canceled reimport mutated Builder")
    require(not errors and not outside,"Browser network or console errors")
    return {"case":"saved_report_approval_not_reused_after_dialog_reopen",
      "status":"PASS","previousApprovalCleared":True,
      "builderUnchanged":True,"outsideRequests":0}
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
    "Run only on original compiled localhost web app")
  args.evidence_dir.mkdir(parents=True,exist_ok=True)
  with sync_playwright() as p:
    opts=["--disable-dev-shm-usage","--disable-background-networking"]
    if hasattr(os,"geteuid") and os.geteuid()==0:opts.append("--no-sandbox")
    browser=p.chromium.launch(headless=True,args=opts)
    try:
      saved,first=capture(browser,args.url)
      cases=[first,case_replay_fresh(browser,args.url,saved),
        case_invalid_and_tampered(browser,args.url,saved),
        case_changed_source_at_replay(browser,args.url,saved),
        case_close_reopen_approval_not_reused(browser,args.url,saved)]
    finally:browser.close()
  summary={"status":"PASS","kind":"Actual compiled Chromium strict source-bound saved reimport report",
    "environment":"GitHub Actions Ubuntu; Parrot-native/physical live network NOT_RUN",
    "cases":cases,"autoApproval":False,"physicalConnectivityVerified":False,"outsideRequests":0}
  (args.evidence_dir/"ic020-p2c1-saved-original-replay-real-browser.json").write_text(
    json.dumps(summary,indent=2)+"\n")
  print("PASS IC-020 P2c1 actual compiled Chromium saved report source replay and no auto approval",flush=True)
  print(json.dumps(summary,indent=2))
if __name__=="__main__":
  try:main()
  except Exception as e:
    print("FAIL IC-020 P2c1 actual Chromium: "+str(e),file=sys.stderr)
    raise

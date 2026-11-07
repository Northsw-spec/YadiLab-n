#!/usr/bin/env python3
"""P3d: real compiled Chromium eight-source semantic truth and review lifecycle."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from run_ic010_p2_shared_xml_real_browser import (
  setup, exported_source, open_panel, choose, consent_inspect, invariant, require,
  graph_bytes, nmap_bytes, nessus_bytes, drawio_bytes
)
from run_docx_p2_real_browser import make_bytes as make_docx, CANARY as DOCX_SECRET
from run_odt_p2_real_browser import make_odt, CANARY as ODT_SECRET

FIXTURES=Path(__file__).resolve().parents[2]/"tests/fixtures/import"
MEANING={
 "TOPOLOGY_DECLARED":"Topology as described in a source document, not validated physical cabling or Engine truth.",
 "EVIDENCE_OBSERVED":"Historical observations from a report or scan, not a current probe, live inventory or Engine PASS.",
 "CONFIG_DOCUMENTED":"Documented configuration or Office structure, not an independently verified network asset or Engine probe.",
}
SECRETS=[
 "SECRET_INI_HOST_CANARY_DONT_EXPORT","SYNTHETIC_SECRET_CANARY_NOT_REAL",
 "PRIVATE_CUSTOMER_REPORT_203.0.113.99","SENSITIVE_HOST_PRIVATE",
 DOCX_SECRET,ODT_SECRET,"PRIVATE_HOST","SECRET_P3D","ansible_password",
 "SYNTHETIC_TOKEN_CANARY_NOT_REAL","reportedConnectionAddress",
 "word/document.xml","content.xml","textCodeUnits",
]

def state(page,wanted):
  expect(page.locator('[data-ic010-p3d-lifecycle="'+wanted+'"]')).to_be_visible(timeout=26000)

def verified(page,name,source,profile,status,track,kind,review=False):
  choose(page,name,source)
  state(page,"AWAITING_CONSENT")
  require(page.locator('[data-ic010-p2-result]').count()==0,
          "File was parsed before original source consent")
  require(page.locator('[data-ic010-p2-inspect]').is_disabled(),
          "Inspection available without explicit consent")
  consent_inspect(page)
  state(page,status)
  require(page.locator('[data-ic010-p2-profile="'+profile+'"]').count()==1,
          "Incorrect producer profile: "+profile)
  require(page.locator('[data-ic010-p2-status="'+status+'"]').count()==1,
          "Incorrect source review status")
  require(page.locator('[data-ic010-p2-track="'+track+'"]').count()==1,
          "Document classification falsely upgraded to another track")
  require(page.locator('[data-ic010-p2-counts="'+kind+'"]').count()==1,
          "Source summary discriminant differs from verified profile")
  require(page.locator('[data-ic010-p3d-source-meaning="'+track+'"]').inner_text()==MEANING[track],
          "Wrong fixed semantic warning for source classification")
  digest=hashlib.sha256(source).hexdigest()
  require(digest in page.locator('[data-ic010-p2-sha]').inner_text(),
          "Original full file SHA-256 not displayed")
  require(page.locator('[data-ic010-p2-source-locator="source-document"]').count()==1,
          "Missing original SHA-bound source locator")
  require(page.locator('[data-ic010-p2-activation="BLOCKED"]').count()==1,
          "Shared view unexpectedly allows Builder/Engine mutation")
  require(page.locator('[data-ic010-p3b-review]').count()==(1 if review else 0),
          "Ansible-only reviewed association control was incorrectly exposed")
  html=page.locator('[data-ic010-p2-panel]').inner_html()
  for private in SECRETS:
    require(private not in html,"Source content or private original locator leaked: "+private)
  return digest

def case_eight_tracks(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    before=exported_source(page)
    open_panel(page)
    state(page,"NO_SOURCE")
    fixtures=[
      ("topology.graphml",graph_bytes(),"graphml.structural.v1",
       "REVIEW_REQUIRED","TOPOLOGY_DECLARED","GRAPH_STRUCTURE",False),
      ("network.drawio",drawio_bytes(),"diagrams.drawio.v1",
       "PREVIEW_ONLY","TOPOLOGY_DECLARED","DRAWIO_DIAGRAM",False),
      ("scan.xml",nmap_bytes(),"nmap.xml.v1",
       "EVIDENCE_ONLY","EVIDENCE_OBSERVED","NMAP_OBSERVATIONS",False),
      ("report.nessus",nessus_bytes(),"nessus.xml.v1",
       "EVIDENCE_ONLY","EVIDENCE_OBSERVED","NESSUS_REPORT",False),
      ("inventory.yml",(FIXTURES/"ansible-yaml/valid-sensitive-vars.yml").read_bytes(),
       "ansible.inventory.static.yaml.v1","REVIEW_REQUIRED",
       "CONFIG_DOCUMENTED","ANSIBLE_YAML_INVENTORY",True),
      ("inventory.ini",(FIXTURES/"ansible-ini/valid-sensitive-vars.ini").read_bytes(),
       "ansible.inventory.static.ini.v1","REVIEW_REQUIRED",
       "CONFIG_DOCUMENTED","ANSIBLE_INI_INVENTORY",True),
      ("inventory.docx",make_docx(),"office.docx-tables.structural.v1",
       "REVIEW_REQUIRED","CONFIG_DOCUMENTED","DOCX_TABLE_STRUCTURE",False),
      ("inventory.odt",make_odt(),"office.odt-tables.structural.v1",
       "REVIEW_REQUIRED","CONFIG_DOCUMENTED","ODT_TABLE_STRUCTURE",False),
    ]
    digests=[]
    for item in fixtures:
      digests.append(verified(page,*item))
    # Withdrawing consent destroys trusted status and original-source metadata.
    page.locator('[data-ic010-p2-consent]').uncheck()
    state(page,"AWAITING_CONSENT")
    require(page.locator('[data-ic010-p2-sha]').count()==0,
            "Previously validated original-source SHA survived consent withdrawal")
    require(page.locator('[data-ic010-p3b-review]').count()==0,
            "Reviewed association controls survived consent withdrawal")
    # A wrongly tagged XML/ZIP cannot leave a trusted status or original locator.
    choose(page,"wrong.odt",make_docx())
    state(page,"AWAITING_CONSENT")
    consent_inspect(page)
    state(page,"BLOCKED")
    require(page.locator('[data-ic010-p2-result="BLOCKED"]').count()==1,
            "Wrong-source Office ZIP did not block")
    require(page.locator('[data-ic010-p2-sha]').count()==0,
            "Wrong-source ZIP claimed validated original bytes")
    choose(page,"invalid.graphml",b"<wrong/>")
    state(page,"AWAITING_CONSENT")
    consent_inspect(page)
    state(page,"BLOCKED")
    require(page.locator('[data-ic010-p2-result="BLOCKED"]').count()==1,
            "Malformed XML falsely granted a topology declaration")
    page.locator('[data-ic010-p2-close]').click()
    expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
    invariant(page,before,errors,outside)
    return {"case":"eight_profile_producer_status_and_semantic_track",
       "status":"PASS","profiles":8,"statusTracks":3,
       "allOriginalSHA256Confirmed":all(len(d)==64 for d in digests),
       "wrongSourceDenied":True,"consentWithdrawalResets":True,
       "builderUnchanged":True,"externalRequests":0}
  finally:page.close()

def case_delayed_switch_escape(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    before=exported_source(page)
    open_panel(page)
    page.evaluate("""() => {
      const original=File.prototype.arrayBuffer;
      window.__ic010P3dPending=[];
      File.prototype.arrayBuffer=function() {
        if(this.name==="delayed.graphml"){
          return new Promise((resolve,reject)=>{
            window.__ic010P3dPending.push(()=>original.call(this).then(resolve,reject))
          })
        }
        return original.call(this);
      };
    }""")
    choose(page,"delayed.graphml",graph_bytes())
    state(page,"AWAITING_CONSENT")
    consent_inspect(page)
    state(page,"INSPECTING")
    page.wait_for_function("window.__ic010P3dPending.length===1",timeout=12000)
    verified(page,"report.nessus",nessus_bytes(),
      "nessus.xml.v1","EVIDENCE_ONLY","EVIDENCE_OBSERVED","NESSUS_REPORT",False)
    page.evaluate("() => window.__ic010P3dPending.shift()()")
    page.wait_for_timeout(300)
    state(page,"EVIDENCE_ONLY")
    require(page.locator('[data-ic010-p2-profile="graphml.structural.v1"]').count()==0,
            "Late GraphML result overwrote current Nessus observations")
    choose(page,"delayed.graphml",graph_bytes())
    consent_inspect(page)
    page.wait_for_function("window.__ic010P3dPending.length===1",timeout=12000)
    page.keyboard.press("Escape")
    expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
    page.evaluate("() => window.__ic010P3dPending.shift()()")
    open_panel(page)
    state(page,"NO_SOURCE")
    require(page.locator('[data-ic010-p2-sha]').count()==0,
      "Late source hash appeared after Escape/reopen")
    require(page.locator('[data-ic010-p2-consent]').is_disabled(),
      "Prior source consent leaked across close/reopen")
    page.locator('[data-ic010-p2-close]').click()
    invariant(page,before,errors,outside)
    return {"case":"async_old_source_cannot_cross_new_profile_or_escape",
      "status":"PASS","staleDiscarded":True,"builderUnchanged":True,
      "externalRequests":0}
  finally:page.close()

def main():
  parser=argparse.ArgumentParser()
  parser.add_argument("--url",required=True)
  parser.add_argument("--evidence-dir",type=Path,required=True)
  args=parser.parse_args()
  u=urlsplit(args.url)
  require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
    and u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
    "Use only exactly served original compiled Chromium on localhost")
  args.evidence_dir.mkdir(parents=True,exist_ok=True)
  with sync_playwright() as p:
    flags=["--disable-dev-shm-usage","--disable-background-networking"]
    if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
    browser=p.chromium.launch(headless=True,args=flags)
    try:cases=[case_eight_tracks(browser,args.url),
               case_delayed_switch_escape(browser,args.url)]
    finally:browser.close()
  summary={"status":"PASS","kind":"Actual compiled YadiLab Chromium, source status/track truth",
    "platform":"GitHub Actions Ubuntu, native Parrot NOT_RUN",
    "cases":cases,"engineOrBuilderMutated":False}
  (args.evidence_dir/"ic010-p3d-source-track-real-browser.json").write_text(
    json.dumps(summary,indent=2)+"\n")
  print("PASS IC-010 P3d compiled Chromium eight-source status/provenance lifecycle",flush=True)
  print(json.dumps(summary,indent=2))

if __name__=="__main__":
  try:main()
  except Exception as error:
    print("FAIL IC-010 P3d actual Chromium: "+str(error),file=sys.stderr)
    raise

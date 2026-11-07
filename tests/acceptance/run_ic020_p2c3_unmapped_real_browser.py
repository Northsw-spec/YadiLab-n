#!/usr/bin/env python3
"""IC-020 P2c3: actual compiled Chromium, ambiguous inventory blocked, unsupported
nonempty source headers declared UNMAPPED without leaking private source data."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require

SECRET="SYNTHETIC_PRIVATE_UNMAPPED_COLUMN_4783_NOT_REAL"
DEVICES=[
 {"Asset ID":"rtr01","Hostname":"Router","Device Type":"Router","IP Address":"10.7.0.1",
  "Connected To":"","Private Token":SECRET,"Cost Centre":"Operations","Blank Evidence":""},
 {"Asset ID":"sw01","Hostname":"Switch","Device Type":"Switch","IP Address":"10.7.0.2",
  "Connected To":"rtr01","Private-Token":SECRET,"Cost Centre":"Operations","Blank Evidence":" "},
 {"Asset ID":"win01","Hostname":"Windows Host","Device Type":"Windows","IP Address":"10.7.0.20",
  "Connected To":"sw01","Private Token":SECRET,"Cost Centre":"","Blank Evidence":""},
]
JSON_SOURCE=json.dumps({"Devices":DEVICES},ensure_ascii=False,separators=(",",":")).encode()
CSV_HEADER=["Asset ID","Hostname","Device Type","IP Address","Connected To","Private Token","Cost Centre","Blank Evidence"]
CSV_SOURCE=("\n".join([",".join(CSV_HEADER)] +[
 ",".join(str(row.get(key, "")) for key in CSV_HEADER) for row in DEVICES])+"\n").encode()
COMPETING=json.dumps({"Devices":DEVICES,"records":DEVICES[:1]},separators=(",",":")).encode()
CANONICAL_COMPETING=json.dumps({
 "Metadata":[{"scenarioId":"imported_network","title":"Documented Network"}],
 "Nodes":[{"nodeId":"rtr01","displayName":"Router","type":"network.router"}],
 "Devices":DEVICES},separators=(",",":")).encode()

def pick(page,name,content):
  with page.expect_file_chooser(timeout=13000) as future:
    page.locator('[data-network-import-primary="true"]').click()
  future.value.set_files({"name":name,"mimeType":"application/octet-stream","buffer":content})
  expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=25000)

def accepted(page,name,data):
  panel=page.locator('[data-network-import-preview="READY"]')
  expect(panel).to_be_visible(timeout=35000)
  sha=hashlib.sha256(data).hexdigest()
  require(sha in page.locator('[data-network-import-sha]').inner_text(),
    "Full raw source SHA must be displayed "+name)
  expect(page.locator('[data-network-import-unmapped-status="UNMAPPED"]')).to_be_visible()
  require(page.locator('[data-network-import-unmapped]').get_attribute(
    'data-network-import-unmapped')=="2","Unsupported populated headings must count as 2")
  require("Unmapped source columns: 2" in page.locator(
    '[data-network-import-unmapped]').inner_text(),"Unmapped status not legible")
  text=panel.inner_text()
  require("Devices: 3" in text and "Explicit links: 2" in text,
    "Unmapped content invented device or physical link")
  require("NETWORK_IMPORT_COLUMNS_UNMAPPED" in text,
    "Missing fixed review warning for unsupported source")
  require(page.locator('[data-network-import-activate]').is_enabled(),
    "Warnings on unsupported content must not block existing safe explicit links")
  require(page.locator('[data-network-import-runtime]').is_enabled(),
    "Warnings on unsupported content should not disable explicit OS-modeled Runtime")
  require(SECRET not in page.locator('[data-network-import-panel]').inner_html(),
    "Private unrecognized source data leaked into review UI")
  require("Private Token" not in page.locator('[data-network-import-panel]').inner_text(),
    "Unmapped source column title displayed")
  return sha

def close(page):
  page.get_by_role("button",name="Close network import").click()
  expect(page.locator('[data-network-import-panel]')).to_have_count(0)

def case_positive(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    before=exported_source(page)
    digests={}
    for name,data in [("unmapped.json",JSON_SOURCE),("unmapped.csv",CSV_SOURCE)]:
      pick(page,name,data)
      digests[name]=accepted(page,name,data)
      close(page)
      require(exported_source(page)==before,"Preview/close mutated Builder "+name)
    pick(page,"unmapped.json",JSON_SOURCE)
    accepted(page,"unmapped.json",JSON_SOURCE)
    page.locator('[data-network-import-activate]').click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
    doc=exported_source(page)
    require(set(x['id'] for x in doc['resources'])=={"rtr01","sw01","win01"},
      "Extra unknown source columns fabricated assets")
    require({(x['from']['resource'],x['to']['resource']) for x in doc['connections']}==
      {("sw01","rtr01"),("win01","sw01")},
      "Unsupported source content fabricated a cable")
    require(SECRET not in json.dumps(doc),"Private source field entered Builder")
    require(not errors,"Unexpected compiled JS browser errors "+repr(errors))
    require(not outside,"Unexpected outside HTTP requests "+repr(outside))
    return {"case":"json_and_csv_explicit_unmapped_warning_then_json_builder",
      "status":"PASS","sources":2,"unmappedColumns":2,"devices":3,
      "explicitConnections":2,"sourceSHA256":digests,
      "noUnreviewedMutation":True,"outsideRequests":0}
  finally:page.close()

def blocked(page,name,data):
  pane=page.locator('[data-network-import-preview="BLOCKED"]')
  expect(pane).to_be_visible(timeout=20000)
  require("NETWORK_IMPORT_DEVICE_TABLE_AMBIGUOUS" in pane.inner_text(),
    "Missing fixed fail-closed competing inventory diagnostic "+name)
  require(hashlib.sha256(data).hexdigest() in page.locator(
    '[data-network-import-sha]').inner_text(),
    "Blocked source lost original byte SHA")
  require(page.locator('[data-network-import-unmapped]').get_attribute(
    'data-network-import-unmapped')=="0",
    "Unresolved candidate must not be treated as mapped source data")
  require(not page.locator('[data-network-import-activate]').is_enabled(),
    "Competing inventory unexpectedly allowed Builder activation")
  require(not page.locator('[data-network-import-runtime]').is_enabled(),
    "Competing inventory unexpectedly allowed Engine activation")
  require(page.locator('[data-network-import-link-source-sheet]').count()==0,
    "P2a source-link choice offered as incorrect bypass for device ambiguity")
  require(SECRET not in pane.inner_html(),"Competing source private data leaked")
  require("Private Token" not in pane.inner_text(),"Header of blocked source leaked")

def case_ambiguous(browser,url):
  page,errors,outside=setup(browser,url)
  try:
    baseline=exported_source(page)
    for name,data in [("competing.json",COMPETING),
                      ("canonical.json",CANONICAL_COMPETING)]:
      pick(page,name,data)
      blocked(page,name,data)
      close(page)
      require(exported_source(page)==baseline,
        "Blocked competing inventory changed live Builder "+name)
    pick(page,"good.json",JSON_SOURCE)
    accepted(page,"good.json",JSON_SOURCE)
    # Native dialog file input is replaced while preview is open.
    page.locator('[data-network-import-file]').set_input_files({
      "name":"switch.json","mimeType":"application/json","buffer":COMPETING})
    blocked(page,"switch.json",COMPETING)
    close(page)
    require(exported_source(page)==baseline,
      "Switch to blocked source kept stale reviewed Builder candidate")
    pick(page,"good.json",JSON_SOURCE)
    accepted(page,"good.json",JSON_SOURCE)
    close(page)
    require(exported_source(page)==baseline,
      "Closed modal from fresh source mutated active Builder")
    require(not errors and not outside,"Unexpected errors or outside requests")
    return {"case":"multiple_competing_tables_and_cancel_or_switch_fail_closed",
      "status":"PASS","blockedCases":2,"noAutomaticTableSelection":True,
      "closeAndSwitchSafe":True,"builderUnchanged":True,"outsideRequests":0}
  finally:page.close()

def main():
  parser=argparse.ArgumentParser()
  parser.add_argument("--url",required=True)
  parser.add_argument("--evidence-dir",type=Path,required=True)
  args=parser.parse_args()
  parsed=urlsplit(args.url)
  require(parsed.scheme=="http" and parsed.hostname=="127.0.0.1" and
    parsed.port is not None and parsed.path=="/" and not parsed.query and
    not parsed.fragment and not parsed.username and not parsed.password,
    "Only actual compiled local YadiLab Chromium source allowed")
  args.evidence_dir.mkdir(parents=True,exist_ok=True)
  with sync_playwright() as p:
    opts=["--disable-dev-shm-usage","--disable-background-networking"]
    if hasattr(os,"geteuid") and os.geteuid()==0:opts.append("--no-sandbox")
    browser=p.chromium.launch(headless=True,args=opts)
    try:cases=[case_positive(browser,args.url),case_ambiguous(browser,args.url)]
    finally:browser.close()
  evidence={"status":"PASS",
    "kind":"Actual compiled YadiLab Chromium P2c3 unmapped-source and ambiguity controls",
    "environment":"GitHub Actions Ubuntu, Parrot-native / physical network NOT_RUN",
    "cases":cases,"rawSecretsLeaked":False,"inferredPhysicalLinks":False}
  (args.evidence_dir/"ic020-p2c3-unmapped-real-browser.json").write_text(
    json.dumps(evidence,indent=2)+"\n")
  print("PASS IC-020 P2c3 actual compiled Chromium unmapped source privacy and competing inventory rejection",flush=True)
  print(json.dumps(evidence,indent=2))

if __name__=="__main__":
  try:main()
  except Exception as error:
    print("FAIL IC-020 P2c3 compiled Chromium: "+str(error),file=sys.stderr)
    raise

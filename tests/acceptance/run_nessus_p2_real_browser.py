#!/usr/bin/env python3
"""NESSUS P2: real compiled Chromium input, privacy and no Builder/Engine mutation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu

CANARY="NEVER_RENDER_VULNERABILITY_PLUGIN_OUTPUT_9385"
def item(level):
    return (f'<ReportItem pluginID="19506" port="443" protocol="tcp" severity="{level}" '
            'pluginName="SECRETPRIVATE-PLUGIN">'
            f'<plugin_output>{CANARY}</plugin_output><description>INTERNAL-CONFIDENTIAL-FINDING</description>'
            '</ReportItem>')
def sample():
    raw=('<?xml version="1.0" encoding="UTF-8"?>'
         '<NessusClientData_v2><Policy><Preferences><ServerPreferences/></Preferences></Policy>'
         '<Report name="SENSITIVE-CUSTOMER">'
         '<ReportHost name="INTERNAL-HOST-192.0.2.44"><HostProperties>'
         '<tag name="host-ip">192.0.2.44</tag></HostProperties>'
         +item(0)+item(2)+'</ReportHost>'
         '<ReportHost name="PRIVATE-SERVER-2">'+item(4)+item(3)+'</ReportHost>'
         '</Report></NessusClientData_v2>')
    return raw.encode("utf-8")
def pick(page,name,data):
    page.locator('[data-nessus-file="true"]').set_input_files({
      "name":name,"mimeType":"application/xml","buffer":data
    })
def open_panel(page):
    menu(page).locator('[data-inspect-nessus="EVIDENCE_ONLY"]').click()
    page.locator('[data-nessus-panel="EVIDENCE_ONLY"]').wait_for(timeout=15000)
def run(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        original=export_source(page)
        source=sample()
        open_panel(page)
        require(page.locator('[data-nessus-summary]').count()==0,
                "Preview must be idle until user selects source")
        pick(page,"scan.nessus",source)
        expect(page.locator('[data-nessus-summary="EVIDENCE_ONLY"]')).to_be_visible(timeout=25000)
        require(page.locator('[data-nessus-host-count="2"]').count()==1,
                "Nessus host count incorrect")
        require(page.locator('[data-nessus-finding-count="4"]').count()==1,
                "Nessus finding count incorrect")
        for sev,count in [(0,1),(1,0),(2,1),(3,1),(4,1)]:
            txt=page.locator(f'[data-nessus-severity="{sev}"]').inner_text()
            require(txt.endswith(": "+str(count)),f"Wrong severity {sev}: {txt}")
        require(hashlib.sha256(source).hexdigest() in
                page.locator('[data-nessus-source-sha]').inner_text(),
                "Nessus source provenance mismatch")
        html=page.locator('[data-nessus-panel]').inner_html()
        for private in [CANARY,"192.0.2.44","INTERNAL-HOST","PRIVATE-SERVER",
                        "SENSITIVE-CUSTOMER","SECRETPRIVATE","INTERNAL-CONFIDENTIAL-FINDING"]:
            require(private not in html,"Private source leaked into DOM "+private)
        require(page.locator('[data-nessus-activation-status="BLOCKED"]').count()==1,
                "Scan data was incorrectly made activatable")
        # Builder export is only accessible after modal closure; overlay correctly blocks clicks.
        # Wrong file selection MUST discard previous valid summary.
        pick(page,"wrong.nessus",b'<?xml version="1.0"?><nmaprun scanner="nmap"/>')
        expect(page.locator('[data-nessus-error="BLOCKED"]')).to_have_text(
            "NESSUS_XML_ROOT_INVALID",timeout=25000)
        require(page.locator('[data-nessus-summary]').count()==0,
                "Stale PASS survived invalid selection")
        pick(page,"xxe.nessus",b'<!DOCTYPE NessusClientData_v2 [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NessusClientData_v2/>')
        expect(page.locator('[data-nessus-error="BLOCKED"]')).to_have_text(
            "IMPORT_XML_DTD_FORBIDDEN",timeout=25000)
        require(page.locator('[data-nessus-summary]').count()==0,"DTD got preview")
        pick(page,"forged.xml",source)
        expect(page.locator('[data-nessus-error="BLOCKED"]')).to_have_text(
            "NESSUS_FILE_EXTENSION_INVALID",timeout=25000)
        require(page.locator('[data-nessus-summary]').count()==0,"Wrong extension got preview")
        pick(page,"scan.nessus",source)
        expect(page.locator('[data-nessus-summary="EVIDENCE_ONLY"]')).to_be_visible(timeout=25000)
        page.locator('[data-nessus-close="true"]').click()
        expect(page.locator('[data-nessus-panel]')).to_have_count(0,timeout=15000)
        require(export_source(page)==original,"Nessus inspection mutated canonical source")
        check_unchanged(page,scenario,errors,external)
        open_panel(page)
        require(page.locator('[data-nessus-summary]').count()==0,
                "Previous summary survived dialog re-opening")
        page.locator('[data-nessus-close="true"]').click()
        return {"case":"compiled_nessus_v2_severity_safe_private_metadata_only",
                "status":"PASS","hostCount":2,"findings":4,
                "rawHostAndPluginDataDisplayed":False,"builderUnchanged":True}
    finally:
        page.close()
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
       and u.path=="/" and not u.query and not u.fragment and not u.username
       and not u.password,"Only compiled loopback YadiLab is allowed")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try: cases=[run(browser,args.url)]
        finally: browser.close()
    result={"status":"PASS","platform":"GitHub Ubuntu Chromium (not user Parrot)",
        "kind":"actual compiled YadiLab Nessus v2 severity-only preview",
        "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"nessus-p1p2-actual-chromium.json").write_text(
        json.dumps(result,indent=2)+"\n")
    print("PASS NESSUS P2 actual Chromium "+cases[0]["case"],flush=True)
    print(json.dumps(result,indent=2))
if __name__=="__main__":
    try: main()
    except Exception as err:
        print("FAIL NESSUS P2 Chromium "+str(err),file=sys.stderr)
        raise

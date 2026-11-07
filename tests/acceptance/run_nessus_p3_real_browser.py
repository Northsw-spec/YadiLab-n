#!/usr/bin/env python3
"""Actual compiled Chromium Nessus P3: synthetic valid v2 source + reviewed metadata sidecar.
No Nessus binary, license, real scan, network, or target machine required.
"""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu
from run_nessus_p2_real_browser import sample, CANARY

def open_panel(page):
    menu(page).locator('[data-inspect-nessus="EVIDENCE_ONLY"]').click()
    page.locator('[data-nessus-panel="EVIDENCE_ONLY"]').wait_for(timeout=20000)

def select(page,name,raw):
    page.locator('[data-nessus-file="true"]').set_input_files({
        "name":name,"mimeType":"application/xml","buffer":raw,
    })

def case(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        raw=sample()
        sha=hashlib.sha256(raw).hexdigest()
        open_panel(page)
        select(page,"valid.nessus",raw)
        expect(page.locator('[data-nessus-summary="EVIDENCE_ONLY"]')).to_be_visible(timeout=25000)
        expect(page.locator('[data-nessus-association-review="REVIEW_REQUIRED"]')).to_be_visible()
        choose=page.locator('[data-nessus-associate-host="0"]')
        targets=choose.locator("option")
        require(targets.count()>=3,"Need two existing Builder resources")
        target_a=targets.nth(1).get_attribute("value")
        target_b=targets.nth(2).get_attribute("value")
        require(target_a and target_b and target_a!=target_b,"Missing distinct Builder targets")
        require(page.locator('[data-nessus-association-export]').is_disabled(),
                "Unselected scan host should not export")
        choose.select_option(target_a)
        require(page.locator('[data-nessus-association-export]').is_disabled(),
                "Unacknowledged source reference exported")
        page.locator('[data-nessus-association-ack]').check()
        with page.expect_download(timeout=25000) as saved:
            page.locator('[data-nessus-association-export]').click()
        sidecar=json.loads(Path(saved.value.path()).read_text())
        require(sidecar["formatId"]=="yadilab.nessus-reviewed-host-references","Wrong format")
        require(sidecar["status"]=="REVIEWED_ASSOCIATIONS_ONLY","False verified status")
        require(sidecar["source"]=={
            "profileId":"nessus.xml.severity-summary.v1",
            "sha256":sha,"semanticTrack":"EVIDENCE_OBSERVED"},
            "Original SHA and source profile mismatch")
        require(sidecar["targetModel"]=={
            "scenarioId":before["scenarioId"],
            "sourceRevision":int(sidecar["targetModel"]["sourceRevision"])},
            "Unexpected Builder identity")
        require(len(sidecar["associations"])==1,"Only manually chosen one host allowed")
        ref=sidecar["associations"][0]
        require(ref["hostLocator"]=={
            "kind":"nessus-report-host","sourceSha256":sha,"hostOrdinal":0},
            "Wrong original host ordinal provenance")
        require(ref["targetResourceId"]==target_a,"Wrong target Builder ID")
        require(ref["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                "Reference falsely claimed verified identity")
        for key in ["engineVerified","physicalTopologyVerified","identityVerified","modelMutated"]:
            require(sidecar[key] is False,"Elevated truth flag: "+key)
        for secret in [CANARY,"192.0.2.44","INTERNAL-HOST","PRIVATE-SERVER",
                       "SENSITIVE-CUSTOMER","SECRETPRIVATE","INTERNAL-CONFIDENTIAL-FINDING",
                       "plugin_output"]:
            require(secret not in json.dumps(sidecar),"Sensitive source in JSON: "+secret)
            require(secret not in page.locator('[data-nessus-panel]').inner_html(),
                    "Sensitive source in DOM: "+secret)
        # Duplicate resource binding must fail before explicit export.
        page.locator('[data-nessus-associate-host="1"]').select_option(target_a)
        expect(page.locator('[data-nessus-association-conflict="BLOCKED"]')).to_be_visible()
        require(page.locator('[data-nessus-association-export]').is_disabled(),
                "Duplicate target incorrectly enabled")
        page.locator('[data-nessus-associate-host="1"]').select_option(target_b)
        require(not page.locator('[data-nessus-association-ack]').is_checked(),
                "Ack reused after a reference change")
        require(page.locator('[data-nessus-association-export]').is_disabled(),
                "Reference changed without new consent")
        # Changed source automatically clears references and consent.
        select(page,"valid.nessus",raw.replace(b"SENSITIVE-CUSTOMER",b"DIFFERENT-REPORT"))
        expect(page.locator('[data-nessus-summary="EVIDENCE_ONLY"]')).to_be_visible(timeout=25000)
        require(page.locator('[data-nessus-selected-count="0"]').count()==1,
                "Previous reference survived file selection")
        require(not page.locator('[data-nessus-association-ack]').is_checked(),
                "Previous consent survived source change")
        select(page,"invalid.nessus",b"<nmaprun scanner=\"nmap\"/>")
        expect(page.locator('[data-nessus-error="BLOCKED"]')).to_have_text(
            "NESSUS_XML_ROOT_INVALID",timeout=25000)
        require(page.locator('[data-nessus-association-review]').count()==0,
                "Review controls survived invalid source")
        page.locator('[data-nessus-close="true"]').click()
        expect(page.locator('[data-nessus-panel]')).to_have_count(0,timeout=15000)
        require(export_source(page)==before,
                "Nessus P3 metadata review mutated canonical Builder source")
        check_unchanged(page,scenario,errors,external)
        open_panel(page)
        require(page.locator('[data-nessus-association-review]').count()==0,
                "Previous source persisted after modal reopen")
        page.locator('[data-nessus-close="true"]').click()
        return {"status":"PASS","case":"synthetic_v2_report_host_ordinal_to_existing_builder",
                "sourceSha256":sha,"exportedReferenceCount":1,
                "manualConsent":True,"noNessusInstallationRequired":True,
                "rawValuesDisplayed":False,"builderUnchanged":True}
    finally:
        page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    url=urlsplit(args.url)
    require(url.scheme=="http" and url.hostname=="127.0.0.1" and
            url.port is not None and url.path=="/" and not url.query and
            not url.fragment and not url.username and not url.password,
            "Only exact localhost compiled YadiLab accepted")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:checks=[case(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"Actual YadiLab Chromium Nessus P3 synthetic local XML",
            "platform":"GitHub Ubuntu Chromium, not user Parrot",
            "cases":checks,"builderOrEngineModified":False}
    (args.evidence_dir/"nessus-p3-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS NESSUS P3 real compiled Chromium",flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as ex:
        print("FAIL NESSUS P3 real Chromium "+str(ex),file=sys.stderr)
        raise

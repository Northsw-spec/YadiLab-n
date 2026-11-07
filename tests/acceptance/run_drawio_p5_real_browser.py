#!/usr/bin/env python3
"""DRAWIO P5: actual compiled YadiLab Chromium replay of genuine P4-exported JSON."""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_docx_p2_real_browser import setup,export_source,check_unchanged,require,menu
from run_drawio_p3_real_browser import source,CANARY
from run_drawio_p4_real_browser import open_panel,choose

def open_replay(page):
    menu(page).locator('[data-inspect-drawio-replay="TOPOLOGY_DECLARED"]').click()
    expect(page.locator('[data-drawio-replay-panel="TOPOLOGY_DECLARED"]')).to_be_visible(timeout=20000)

def select(page,where,name,data):
    page.locator(where).set_input_files({"name":name,"mimeType":"application/octet-stream","buffer":data})

def run(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        original=source()
        sha=hashlib.sha256(original).hexdigest()
        open_panel(page)
        choose(page,"original.drawio",original)
        expect(page.locator('[data-drawio-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=25000)
        options=page.locator('[data-drawio-associate-vertex="0:1"] option')
        require(options.count()>=3,"Expected two Builder resources")
        a=options.nth(1).get_attribute("value")
        b=options.nth(2).get_attribute("value")
        require(a and b and a!=b,"Builder targets missing")
        page.locator('[data-drawio-associate-vertex="0:1"]').select_option(a)
        page.locator('[data-drawio-associate-vertex="1:0"]').select_option(b)
        page.locator('[data-drawio-association-ack]').check()
        with page.expect_download(timeout=25000) as dl:
            page.locator('[data-drawio-association-export]').click()
        report=Path(dl.value.path()).read_bytes()
        saved=json.loads(report)
        require(saved["targetModel"]["scenarioId"]==before["scenarioId"],"Wrong source scenario")
        page.locator('[data-drawio-close]').click()
        expect(page.locator('[data-drawio-panel]')).to_have_count(0)
        open_replay(page)
        select(page,'[data-drawio-replay-original]','original.drawio',original)
        select(page,'[data-drawio-replay-report]','saved-p4.json',report)
        require(page.locator('[data-drawio-replay-verify]').is_disabled(),
                "Auto-replay without explicit consent")
        require(page.locator('[data-drawio-replay-result]').count()==0,
                "Automatically asserted match")
        page.locator('[data-drawio-replay-consent]').check()
        page.locator('[data-drawio-replay-verify]').click()
        expect(page.locator('[data-drawio-replay-result="REFERENCE_REPLAY_MATCH"]')).to_be_visible(timeout=25000)
        require(page.locator('[data-drawio-replay-count="2"]').count()==1,
                "Two source vertex positions not rechecked")
        require(sha in page.locator('[data-drawio-replay-sha]').inner_text(),
                "Original source hash mismatch")
        html=page.locator('[data-drawio-replay-panel]').inner_html()
        for hidden in [CANARY,"10.4.8.12","198.51.100.84","internal_server",
                       "SECRET-CUSTOMER","secret_link","private_monitor"]:
            require(hidden not in html,"Private source leaked into replay DOM")
        # Changing the original must clear both positive status and consent.
        select(page,'[data-drawio-replay-original]','original.drawio',source(compress_b=True))
        require(page.locator('[data-drawio-replay-result]').count()==0,
                "Previous PASS retained after source modification")
        require(not page.locator('[data-drawio-replay-consent]').is_checked(),
                "Consent retained after source modification")
        page.locator('[data-drawio-replay-consent]').check()
        page.locator('[data-drawio-replay-verify]').click()
        expect(page.locator('[data-drawio-replay-error="BLOCKED"]')).to_have_text(
            "DRAWIO_REPLAY_SOURCE_CHANGED",timeout=25000)
        require(page.locator('[data-drawio-replay-result]').count()==0,
                "Changed source reported MATCH")
        select(page,'[data-drawio-replay-original]','original.drawio',original)
        tampered={**saved,"engineVerified":True}
        select(page,'[data-drawio-replay-report]','tampered.json',json.dumps(tampered).encode())
        page.locator('[data-drawio-replay-consent]').check()
        page.locator('[data-drawio-replay-verify]').click()
        expect(page.locator('[data-drawio-replay-error="BLOCKED"]')).to_have_text(
            "DRAWIO_REPLAY_REPORT_MISMATCH",timeout=25000)
        require(page.locator('[data-drawio-replay-result]').count()==0,
                "Forged Engine truth was accepted")
        page.locator('[data-drawio-replay-close]').click()
        expect(page.locator('[data-drawio-replay-panel]')).to_have_count(0)
        require(export_source(page)==before,
                "Reference replay changed canonical Builder source")
        check_unchanged(page,scenario,errors,external)
        open_replay(page)
        require(page.locator('[data-drawio-replay-result]').count()==0,
                "Old MATCH persisted after modal reopen")
        require(page.locator('[data-drawio-replay-verify]').is_disabled(),
                "Old consent persisted after modal reopen")
        page.locator('[data-drawio-replay-close]').click()
        return {"case":"saved_real_p4_json_source_replay",
                "status":"PASS","sourceSha256":sha,"referencesChecked":2,
                "changedSourceBlocked":True,"falseEngineClaimBlocked":True,
                "privateSourceExposed":False,"builderUnchanged":True}
    finally:page.close()
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
            "Only local compiled YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[run(browser,args.url)]
        finally:browser.close()
    evidence={"status":"PASS","kind":"DRAWIO P5 original .drawio and genuine exported P4 JSON actual Chromium",
              "platform":"GitHub Actions Ubuntu, NOT user Parrot","cases":cases,"builderMutated":False}
    (args.evidence_dir/"drawio-p5-real-chromium.json").write_text(json.dumps(evidence,indent=2)+"\n")
    print("PASS DRAWIO P5 actual compiled Chromium",flush=True)
    print(json.dumps(evidence,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL DRAWIO P5 actual Chromium "+str(error),file=sys.stderr)
        raise

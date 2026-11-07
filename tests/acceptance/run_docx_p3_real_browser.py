#!/usr/bin/env python3
"""Real compiled Chromium: opt-in single DOCX cell, secret blocks and unchanged Builder."""
import argparse
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_docx_p2_real_browser import CANARY, make_bytes, setup, inspect, upload, export_source, check_unchanged, require

def password_column_sample():
    raw=io.BytesIO(make_bytes())
    out=io.BytesIO()
    with zipfile.ZipFile(raw,"r") as inp, zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as dest:
        for member in inp.namelist():
            data=inp.read(member)
            if member=="word/document.xml":
                data=data.replace(b"<w:t>IP</w:t>",b"<w:t>Password</w:t>")
                data=data.replace(CANARY.encode(),b"abc123")
            dest.writestr(member,data)
    return out.getvalue()

def run_one(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_source(page)
        inspect(page)
        upload(page,folder,"valid.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=20000)
        controls=page.locator('[data-docx-disclosure="OPERATOR_REVIEW_ONLY"]')
        controls.wait_for(timeout=15000)
        require(page.locator('[data-docx-reveal]').is_disabled(),"Unconsented reveal initially enabled")
        require(page.locator('[data-docx-revealed-value]').count()==0,"Data initially visible")
        require(CANARY not in page.locator('[data-docx-panel]').inner_html(),"Canary leaked before consent")
        # Select a benign non-secret label, acknowledge exactly one selected cell.
        page.locator('[data-docx-select-cell]').select_option("0:1:0")
        require(page.locator('[data-docx-reveal]').is_disabled(),"Cell choice alone enabled reveal")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-revealed-value="true"]')).to_have_text("node01",timeout=22000)
        require(CANARY not in page.locator('[data-docx-panel]').inner_html(),"Other unselected secret leaked")
        require(page.locator('[data-docx-revealed="UNVERIFIED"]').count()==1,"Unverified label missing")
        # Change selection: old value and consent MUST reset, even to sensitive cell.
        page.locator('[data-docx-select-cell]').select_option("0:1:1")
        require(page.locator('[data-docx-revealed-value]').count()==0,"Stale revealed label survived cell switch")
        require(page.locator('[data-docx-reveal]').is_disabled(),"Prior consent reused on new cell")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-disclosure-error="BLOCKED"]')).to_contain_text(
            "DOCX_CELL_SENSITIVE_BLOCKED",timeout=22000)
        require(CANARY not in page.locator('[data-docx-panel]').inner_html(),"Sensitive cell leaked despite blocker")
        require(page.locator('[data-docx-revealed-value]').count()==0,"Blocked cell value visible")
        # A benign-looking password is still blocked when its column is 'Password'.
        upload(page,folder,"password-labeled.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=22000)
        require(page.locator('[data-docx-revealed-value]').count()==0,"Stale value on source change")
        require(page.locator('[data-docx-select-cell]').input_value()=="","Selection not reset")
        require(page.locator('[data-docx-reveal]').is_disabled(),"Consent not reset")
        page.locator('[data-docx-select-cell]').select_option("0:1:1")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-disclosure-error="BLOCKED"]')).to_contain_text(
            "DOCX_CELL_SENSITIVE_BLOCKED",timeout=22000)
        require("abc123" not in page.locator('[data-docx-panel]').inner_html(),"Labeled password leaked")
        # Restore original file, show benign once, hide, close, reopen.
        upload(page,folder,"valid.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=22000)
        page.locator('[data-docx-select-cell]').select_option("0:1:0")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-revealed-value]')).to_have_text("node01",timeout=22000)
        page.locator('[data-docx-hide="true"]').click()
        require(page.locator('[data-docx-revealed-value]').count()==0,"Hide failed")
        require(page.locator('[data-docx-consent]').is_checked()==False,"Hide failed to revoke consent")
        page.locator('[data-docx-close="true"]').click()
        page.locator('[data-docx-panel]').wait_for(state="detached",timeout=12000)
        require(export_source(page)==baseline,"Builder JSON mutated by approved or blocked cell review")
        inspect(page)
        require(page.locator('[data-docx-disclosure]').count()==0,"Reviewer survived dialog reopening")
        require(page.locator('[data-docx-revealed-value]').count()==0,"Old cell value survived reopening")
        page.locator('[data-docx-close="true"]').click()
        check_unchanged(page,scenario,errors,external)
        return {"case":"explicit_one_cell_consent_secret_column_block_recovery_hide_no_builder_mutation",
                "status":"PASS","builderUnchanged":True,"consentReset":True,"secretCanariesAbsent":True}
    finally:
        page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
            and u.path=="/" and not u.query and not u.fragment
            and not u.username and not u.password,"Only exact localhost compiled app is allowed")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yadilab-docx-p3-") as temp:
        folder=Path(temp)
        (folder/"valid.docx").write_bytes(make_bytes())
        (folder/"password-labeled.docx").write_bytes(password_column_sample())
        with sync_playwright() as pw:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
            browser=pw.chromium.launch(headless=True,args=flags)
            try: cases=[run_one(browser,args.url,folder)]
            finally: browser.close()
    report={"status":"PASS","kind":"real compiled YadiLab Chromium P3 one-cell operator review",
      "platform":"GitHub Ubuntu CI, not user Parrot","cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"docx-p3-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    for case in cases: print("PASS DOCX-P3 Chromium "+case["case"],flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try: main()
    except Exception as error:
        print("FAIL DOCX-P3 Chromium: "+str(error),file=sys.stderr)
        raise

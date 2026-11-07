#!/usr/bin/env python3
"""Actual bundled Chromium ODT-P3 source-bound one-cell consent and secret blockers."""
import argparse
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_odt_p2_real_browser import make_odt,CANARY,open_panel,upload
from run_docx_p2_real_browser import setup,export_source,check_unchanged,require

def password_column():
    original=make_odt()
    source=io.BytesIO(original)
    destination=io.BytesIO()
    with zipfile.ZipFile(source,"r") as zin,zipfile.ZipFile(destination,"w") as zout:
        for entry in zin.infolist():
            data=zin.read(entry.filename)
            if entry.filename=="content.xml":
                data=data.replace(b"<text:p>Address</text:p>",
                                  b"<text:p>Password</text:p>")
                data=data.replace(CANARY.encode(),b"abc123")
            # Preserve the first ODF ZIP mimetype as STORED and with no extras.
            entry.extra=b""
            zout.writestr(entry,data)
    return destination.getvalue()

def scenario(browser,url,folder):
    page,scenario_id,errors,external=setup(browser,url)
    try:
        canonical=export_source(page)
        open_panel(page)
        upload(page,folder,"inventory.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        panel=page.locator('[data-odt-disclosure="OPERATOR_REVIEW_ONLY"]')
        panel.wait_for(timeout=15000)
        require(page.locator('[data-odt-revealed-value]').count()==0,
                "ODT source cell disclosed automatically")
        require(page.locator('[data-odt-reveal]').is_disabled(),
                "ODT reveal enabled without selection/consent")
        require(CANARY not in page.locator('[data-odt-panel]').inner_html(),
                "Canary leaked in masked structural preview")
        page.locator('[data-odt-select-cell]').select_option("0:1:0")
        require(page.locator('[data-odt-reveal]').is_disabled(),
                "ODT cell selected without consent but reveal is enabled")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-revealed-value="true"]')).to_have_text(
            "node01",timeout=23000)
        require(page.locator('[data-odt-revealed="UNVERIFIED"]').count()==1,
                "No DOCUMENTED UNVERIFIED marker")
        require(CANARY not in page.locator('[data-odt-panel]').inner_html(),
                "Unselected confidential ODT cell was disclosed")
        # New cell selection instantly hides previously visible text and resets consent.
        page.locator('[data-odt-select-cell]').select_option("0:1:1")
        require(page.locator('[data-odt-revealed-value]').count()==0,
                "Previous cell survived selection switch")
        require(not page.locator('[data-odt-consent]').is_checked(),
                "Old consent reused for new ODT cell")
        require(page.locator('[data-odt-reveal]').is_disabled(),
                "ODT reveal enabled with revoked consent")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-disclosure-error="BLOCKED"]')).to_have_text(
            "ODT_CELL_SENSITIVE_BLOCKED",timeout=23000)
        require(page.locator('[data-odt-revealed-value]').count()==0,
                "Secret cell visible after filter block")
        require(CANARY not in page.locator('[data-odt-panel]').inner_html(),
                "Blocked ODT secret reached DOM")
        # Apparently harmless value still blocked under credential-marked column.
        upload(page,folder,"password-labeled.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        require(page.locator('[data-odt-revealed-value]').count()==0,
                "Old ODT cell survived new source")
        require(page.locator('[data-odt-select-cell]').input_value()=="",
                "Cell selection was not reset for new source")
        require(page.locator('[data-odt-reveal]').is_disabled(),
                "Consent reused for new source")
        page.locator('[data-odt-select-cell]').select_option("0:1:1")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-disclosure-error="BLOCKED"]')).to_have_text(
            "ODT_CELL_SENSITIVE_BLOCKED",timeout=23000)
        require("abc123" not in page.locator('[data-odt-panel]').inner_html(),
                "Benign-looking password value leaked from Password column")
        # Return to valid source, hide, close, re-open without carrying any content.
        upload(page,folder,"inventory.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        page.locator('[data-odt-select-cell]').select_option("0:1:0")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-revealed-value]')).to_have_text("node01",timeout=23000)
        page.locator('[data-odt-hide="true"]').click()
        require(page.locator('[data-odt-revealed-value]').count()==0,
                "Hide ODT cell failed")
        require(not page.locator('[data-odt-consent]').is_checked(),
                "Hide ODT cell did not revoke consent")
        page.locator('[data-odt-close="true"]').click()
        page.locator('[data-odt-panel]').wait_for(state="detached",timeout=12000)
        require(export_source(page)==canonical,"ODT P3 mutated canonical Builder source")
        check_unchanged(page,scenario_id,errors,external)
        open_panel(page)
        require(page.locator('[data-odt-disclosure]').count()==0,
                "ODT reviewer persisted after modal re-open")
        require(page.locator('[data-odt-revealed-value]').count()==0,
                "ODT source text persisted after modal re-open")
        page.locator('[data-odt-close="true"]').click()
        check_unchanged(page,scenario_id,errors,external)
        return {"case":"real_ODT_one_cell_consent_sensitive_header_and_secret_source_change_hide_reopen",
                "status":"PASS","builderUnchanged":True,"secretsRendered":False,
                "consentReset":True}
    finally:
        page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",type=Path,required=True)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
            and u.path=="/" and not u.query and not u.fragment
            and not u.username and not u.password,
            "Only actual loopback compiled YadiLab accepted")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yadilab-odt-p3-") as tmp:
        folder=Path(tmp)
        (folder/"inventory.odt").write_bytes(make_odt())
        (folder/"password-labeled.odt").write_bytes(password_column())
        with sync_playwright() as pw:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
            browser=pw.chromium.launch(headless=True,args=flags)
            try:cases=[scenario(browser,args.url,folder)]
            finally:browser.close()
    report={"status":"PASS","platform":"GitHub Ubuntu Chromium, NOT user Parrot",
      "kind":"real compiled YadiLab ODT-P3 explicit local one-cell review",
      "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"odt-p3-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS ODT P3 actual Chromium "+cases[0]["case"],flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL ODT P3 actual Chromium: "+str(exc),file=sys.stderr)
        raise

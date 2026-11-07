#!/usr/bin/env python3
"""Actual compiled Chromium DOCX-P4 reviewed cell reference export acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_docx_p2_real_browser import make_bytes, setup, inspect, upload, export_source, check_unchanged, require, CANARY
from run_docx_p3_real_browser import password_column_sample

def case(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        inspect(page)
        upload(page,folder,"valid.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=20000)
        require(page.locator('[data-docx-association]').count()==0,
                "P4 association was exposed before P3 cell disclosure")
        page.locator('[data-docx-select-cell]').select_option("0:1:0")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-revealed-value]')).to_have_text("node01",timeout=22000)
        assoc=page.locator('[data-docx-association="REVIEWED_ASSOCIATIONS_ONLY"]')
        assoc.wait_for(timeout=12000)
        targets=page.locator('[data-docx-association-target] option')
        require(targets.count()>1,"Existing Builder model has no selectable resources")
        resource=targets.nth(1).get_attribute("value")
        require(bool(resource),"No stable modeled resource ID")
        require(page.locator('[data-docx-association-export]').is_disabled(),"P4 default exported without consent")
        page.locator('[data-docx-association-target]').select_option(resource)
        require(page.locator('[data-docx-association-export]').is_disabled(),"P4 select alone exported")
        page.locator('[data-docx-association-ack]').check()
        with page.expect_download(timeout=22000) as output:
            page.locator('[data-docx-association-export]').click()
        payload=json.loads(Path(output.value.path()).read_text(encoding="utf-8"))
        require(payload["formatId"]=="yadilab.docx-reviewed-cell-references","Wrong sidecar schema")
        require(payload["status"]=="REVIEWED_ASSOCIATIONS_ONLY","Wrong sidecar status")
        require(payload["engineVerified"] is False and payload["physicalTopologyVerified"] is False,
                "Sidecar asserts verified network truth")
        source=payload["source"]
        expected=hashlib.sha256((folder/"valid.docx").read_bytes()).hexdigest()
        require(source["sha256"]==expected and source["cellLocator"]["sourceSha256"]==expected,
                "Source SHA provenance mismatch")
        require(source["cellLocator"]["tableOrdinal"]==0 and
                source["cellLocator"]["rowOrdinal"]==1 and
                source["cellLocator"]["cellOrdinal"]==0,"Wrong selected original cell")
        require(payload["association"]["targetResourceId"]==resource,"Wrong Builder target")
        require(payload["association"]["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                "Association incorrectly verified")
        packed=json.dumps(payload)
        for secret in [CANARY,"node01","textCodeUnits","cellText",'"text"',"Password"]:
            require(secret not in packed,"Original cell content leaked in sidecar "+secret)
        require(page.locator('[data-docx-association-exported]').count()==1,
                "Export completion missing")
        # Change cell: second acknowledgement and associated target must not survive.
        page.locator('[data-docx-select-cell]').select_option("0:1:1")
        require(page.locator('[data-docx-association]').count()==0,
                "P4 value/reference survived selection of sensitive cell")
        require(page.locator('[data-docx-consent]').is_checked() is False,
                "P3 consent survived source cell switch")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-disclosure-error="BLOCKED"]')).to_contain_text(
            "DOCX_CELL_SENSITIVE_BLOCKED",timeout=22000)
        require(page.locator('[data-docx-association]').count()==0,
                "Sensitive DOCX cell created P4 association")
        require(CANARY not in page.locator('[data-docx-panel]').inner_html(),"Canary leaked")
        upload(page,folder,"password-labeled.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=22000)
        require(page.locator('[data-docx-association]').count()==0,
                "P4 association survived file change")
        require(page.locator('[data-docx-revealed-value]').count()==0,
                "Prior P3 cell visible on new DOCX")
        page.locator('[data-docx-close]').click()
        page.locator('[data-docx-panel]').wait_for(state="detached",timeout=12000)
        require(export_source(page)==before,"Builder source changed after P4 sidecar export")
        check_unchanged(page,scenario,errors,external)
        inspect(page)
        require(page.locator('[data-docx-association]').count()==0,
                "P4 selected target persisted after reopen")
        page.locator('[data-docx-close]').click()
        return {"case":"one_selected_reviewed_cell_export_zero_raw_value_reopen_secret_blocks_builder_unchanged",
            "status":"PASS","sourceSha256":expected,"builderUnchanged":True,
            "secretCanariesAbsent":True,"singleAssociation":True}
    finally:
        page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and
            not u.username and not u.password,"Only actual localhost compiled YadiLab allowed")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="docx-p4-ci-") as tmp:
        folder=Path(tmp)
        (folder/"valid.docx").write_bytes(make_bytes())
        (folder/"password-labeled.docx").write_bytes(password_column_sample())
        with sync_playwright() as pw:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
            browser=pw.chromium.launch(headless=True,args=flags)
            try:cases=[case(browser,args.url,folder)]
            finally:browser.close()
    report={"status":"PASS","platform":"GitHub Ubuntu Chromium, NOT user Parrot",
      "kind":"real bundled YadiLab browser UI P4 reviewed association sidecar",
      "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"docx-p4-real-browser.json").write_text(json.dumps(report,indent=2)+"\n")
    for item in cases:print("PASS DOCX-P4 Chromium "+item["case"],flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL DOCX-P4 actual Chromium: "+str(exc),file=sys.stderr)
        raise

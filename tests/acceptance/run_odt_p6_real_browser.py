#!/usr/bin/env python3
"""Actual compiled YadiLab Chromium P6: replay saved P4/P5 against original ODT + Builder."""
import argparse
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
import zipfile
from playwright.sync_api import sync_playwright, expect
from run_odt_p2_real_browser import make_odt, open_panel, upload, CANARY
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu

def changed_odt(original):
    out=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original),"r") as zin:
        with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data=zin.read(item.filename)
                if item.filename=="content.xml":
                    data=data.replace(b"node01",b"node03")
                zout.writestr(item,data)
    return out.getvalue()

def open_replay(page):
    menu(page).locator('[data-inspect-odt-replay="CONFIG_DOCUMENTED"]').click()
    page.locator('[data-odt-replay-panel="CONFIG_DOCUMENTED"]').wait_for(timeout=15000)

def use_files(page,odt,report):
    page.locator('[data-odt-replay-original]').set_input_files(str(odt))
    page.locator('[data-odt-replay-report]').set_input_files(str(report))

def replay_check(page,folder,name,count):
    open_replay(page)
    use_files(page,folder/"valid.odt",folder/name)
    require(page.locator('[data-odt-replay-verify]').is_disabled(),
      "Verification enabled without explicit consent")
    require(page.locator('[data-odt-replay-result]').count()==0,
      "Saved references verified automatically")
    page.locator('[data-odt-replay-consent]').check()
    page.locator('[data-odt-replay-verify]').click()
    expect(page.locator('[data-odt-replay-result="REFERENCE_REPLAY_MATCH"]')).to_be_visible(timeout=25000)
    require(page.locator('[data-odt-replay-count="'+str(count)+'"]').count()==1,
      "Wrong count for saved "+name)
    actual_sha=__import__("hashlib").sha256((folder/"valid.odt").read_bytes()).hexdigest()
    require(actual_sha in page.locator('[data-odt-replay-sha]').inner_text(),
      "Replay original-document SHA mismatch")
    html=page.locator('[data-odt-replay-panel]').inner_html()
    require(CANARY not in html and "node01" not in html,
      "Raw ODT content leaked into replay")
    require("No cell text is displayed" in page.locator('[data-odt-replay-boundary]').inner_text(),
      "Replay truth boundary is missing")

def test_replay(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        original=export_source(page)
        open_panel(page)
        upload(page,folder,"valid.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=22000)
        # Export original P4 via genuine P3 individual consent and P4 Builder decision.
        page.locator('[data-odt-select-cell]').select_option("0:1:0")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-revealed-value]')).to_have_text("node01",timeout=22000)
        targets=page.locator('[data-odt-association-target] option')
        require(targets.count()>=3,"Two modeled resources needed for P5")
        resource_a=targets.nth(1).get_attribute("value")
        resource_b=targets.nth(2).get_attribute("value")
        require(resource_a and resource_b and resource_a!=resource_b,"Missing distinct Builder IDs")
        page.locator('[data-odt-association-target]').select_option(resource_a)
        page.locator('[data-odt-association-ack]').check()
        with page.expect_download(timeout=22000) as one:
            page.locator('[data-odt-association-export]').click()
        (folder/"review-p4.json").write_bytes(Path(one.value.path()).read_bytes())
        bad=json.loads((folder/"review-p4.json").read_text(encoding="utf-8"))
        bad["engineVerified"]=True
        (folder/"tampered.json").write_text(json.dumps(bad),encoding="utf-8")
        # Stage a genuinely reviewed P5 report with two distinct cell/resource pairs.
        page.locator('[data-odt-multi-stage]').click()
        expect(page.locator('[data-odt-multi-count="1"]')).to_be_visible(timeout=22000)
        page.locator('[data-odt-select-cell]').select_option("0:0:0")
        require(not page.locator('[data-odt-consent]').is_checked(),
                "New cell consent was not revoked")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-revealed-value]')).to_have_text("Host",timeout=22000)
        page.locator('[data-odt-association-target]').select_option(resource_b)
        page.locator('[data-odt-association-ack]').check()
        page.locator('[data-odt-multi-stage]').click()
        expect(page.locator('[data-odt-multi-count="2"]')).to_be_visible(timeout=22000)
        page.locator('[data-odt-multi-ack]').check()
        with page.expect_download(timeout=25000) as many:
            page.locator('[data-odt-multi-export]').click()
        (folder/"review-p5.json").write_bytes(Path(many.value.path()).read_bytes())
        page.locator('[data-odt-close]').click()
        page.locator('[data-odt-panel]').wait_for(state="detached",timeout=12000)
        replay_check(page,folder,"review-p4.json",1)
        # Wrong original document: must clear consent and prior PASS, then fail exact SHA.
        page.locator('[data-odt-replay-original]').set_input_files(str(folder/"changed.odt"))
        require(page.locator('[data-odt-replay-result]').count()==0,"Stale P4 PASS survived changed source")
        require(not page.locator('[data-odt-replay-consent]').is_checked(),"Consent reused on source change")
        page.locator('[data-odt-replay-consent]').check()
        page.locator('[data-odt-replay-verify]').click()
        expect(page.locator('[data-odt-replay-error="BLOCKED"]')).to_have_text(
            "ODT_REPLAY_SOURCE_CHANGED",timeout=22000)
        require(page.locator('[data-odt-replay-result]').count()==0,"Invalid source displayed MATCH")
        # Tampered status flags also fail, even against matching file.
        page.locator('[data-odt-replay-original]').set_input_files(str(folder/"valid.odt"))
        page.locator('[data-odt-replay-report]').set_input_files(str(folder/"tampered.json"))
        page.locator('[data-odt-replay-consent]').check()
        page.locator('[data-odt-replay-verify]').click()
        expect(page.locator('[data-odt-replay-error="BLOCKED"]')).to_have_text(
            "ODT_REPLAY_REPORT_MISMATCH",timeout=22000)
        page.locator('[data-odt-replay-close]').click()
        page.locator('[data-odt-replay-panel]').wait_for(state="detached",timeout=12000)
        replay_check(page,folder,"review-p5.json",2)
        page.locator('[data-odt-replay-close]').click()
        require(export_source(page)==original,"Builder source changed after P4/P5 saved report replay")
        check_unchanged(page,scenario,errors,external)
        open_replay(page)
        require(page.locator('[data-odt-replay-result]').count()==0,
                "Old result persisted after replay dialog reopen")
        require(page.locator('[data-odt-replay-verify]').is_disabled(),
                "Old consent/files persisted on dialog reopen")
        page.locator('[data-odt-replay-close]').click()
        return {"case":"compiled_Chromium_P4_P5_original_ODT_replay_wrong_SHA_tamper_no_builder_edit",
                "status":"PASS","bothReportKinds":True,"savedReferencesChecked":[1,2],
                "builderUnchanged":True,"rawCellValuesDisplayed":False}
    finally:page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    parts=urlsplit(args.url)
    require(parts.scheme=="http" and parts.hostname=="127.0.0.1" and
            parts.port is not None and parts.path=="/" and not parts.query and
            not parts.fragment and not parts.username and not parts.password,
            "Only exact localhost compiled YadiLab allowed")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yadilab-odt-p6-") as tmp:
        folder=Path(tmp)
        bytes_=make_odt()
        (folder/"valid.odt").write_bytes(bytes_)
        (folder/"changed.odt").write_bytes(changed_odt(bytes_))
        with sync_playwright() as pw:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
            browser=pw.chromium.launch(headless=True,args=flags)
            try:
                # Generate P4 with source-independent fixture through true browser in case()
                # Tampered report is created from a valid P4 first: arrange by adapting test
                # callback to create tampered file after P4 download.
                cases=[test_replay(browser,args.url,folder)]
            finally:browser.close()
    result={"status":"PASS","platform":"GitHub Ubuntu Chromium, not user Parrot",
       "kind":"actual compiled YadiLab ODT-P6 saved sidecar replay",
       "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"odt-p6-real-chromium.json").write_text(json.dumps(result,indent=2)+"\n")
    print("PASS ODT P6 "+cases[0]["case"],flush=True)
    print(json.dumps(result,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as ex:
        print("FAIL ODT-P6 real Chromium: "+str(ex),file=sys.stderr);raise

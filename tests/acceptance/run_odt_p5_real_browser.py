#!/usr/bin/env python3
"""Actual compiled YadiLab Chromium: bounded explicit ODT P5 reviewed multi-reference sidecar."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_odt_p2_real_browser import make_odt, CANARY, open_panel, upload
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require

def case(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        open_panel(page)
        upload(page,folder,"valid.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        require(page.locator('[data-odt-multi-count="0"]').count()==1,"ODT P5 queue not initially empty")
        require(page.locator('[data-odt-multi-stage]').count()==0,"Staging before P3 disclosure")
        require(page.locator('[data-odt-multi-export]').is_disabled(),"P5 allowed empty export")
        page.locator('[data-odt-select-cell]').select_option("0:1:0")
        require(page.locator('[data-odt-multi-stage]').count()==0,"Staging without consent")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-revealed-value]')).to_have_text("node01",timeout=23000)
        options=page.locator('[data-odt-association-target] option')
        require(options.count()>=3,"P5 must have two existing distinct Builder resource IDs")
        target_a=options.nth(1).get_attribute("value")
        target_b=options.nth(2).get_attribute("value")
        require(bool(target_a and target_b and target_a!=target_b),"Distinct Builder resource IDs absent")
        require(page.locator('[data-odt-multi-stage]').is_disabled(),"Stage did not require P4 selected target")
        page.locator('[data-odt-association-target]').select_option(target_a)
        require(page.locator('[data-odt-multi-stage]').is_disabled(),"Stage did not require P4 consent")
        page.locator('[data-odt-association-ack]').check()
        page.locator('[data-odt-multi-stage]').click()
        expect(page.locator('[data-odt-multi-count="1"]')).to_be_visible(timeout=23000)
        require(page.locator('[data-odt-multi-export]').is_disabled(),"A single ODT reference exported")
        # Second cell: force a NEW P3 consent and NEW P4 acknowledgement.
        page.locator('[data-odt-select-cell]').select_option("0:0:0")
        require(page.locator('[data-odt-multi-count="1"]').count()==1,"Previously reviewed metadata lost")
        require(not page.locator('[data-odt-consent]').is_checked(),"P3 consent reused across cells")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-revealed-value]')).to_have_text("Host",timeout=23000)
        page.locator('[data-odt-association-target]').select_option(target_b)
        require(page.locator('[data-odt-multi-stage]').is_disabled(),"P4 second consent improperly reused")
        page.locator('[data-odt-association-ack]').check()
        page.locator('[data-odt-multi-stage]').click()
        expect(page.locator('[data-odt-multi-count="2"]')).to_be_visible(timeout=23000)
        require(page.locator('[data-odt-multi-export]').is_disabled(),"Final separate export consent missing")
        queue=page.locator('[data-odt-multi-items]').inner_text()
        for value in [CANARY,"node01","Host","Address"]:
            require(value not in queue,"Raw ODT content in queue: "+value)
        page.locator('[data-odt-multi-ack]').check()
        with page.expect_download(timeout=27000) as exported:
            page.locator('[data-odt-multi-export]').click()
        report=json.loads(Path(exported.value.path()).read_text(encoding="utf-8"))
        require(report["formatId"]=="yadilab.odt-reviewed-multi-references","Wrong ODT multi format")
        require(report["schemaVersion"]=="1.0.0" and report["status"]=="REVIEWED_ASSOCIATIONS_ONLY",
                "ODT P5 asserted wrong schema/verified status")
        require(report["engineVerified"] is False and report["physicalTopologyVerified"] is False,
                "ODT P5 incorrectly claimed Engine/physical truth")
        sha=hashlib.sha256((folder/"valid.odt").read_bytes()).hexdigest()
        require(report["source"]=={"profileId":"office.odt-tables.structural.v1",
                                  "sha256":sha,"semanticTrack":"CONFIG_DOCUMENTED"},
                "Source SHA/original ODT provenance mismatch")
        refs=report["references"]
        require(len(refs)==2,"Wrong number of P5 ODT references")
        require([r["cellLocator"]["rowOrdinal"] for r in refs]==[0,1],
                "ODT references not in original row order")
        require([r["targetResourceId"] for r in refs]==[target_b,target_a],
                "Wrong existing Builder resource IDs")
        require(all(r["cellLocator"]["kind"]=="odt-table-cell" and
                    r["cellLocator"]["part"]=="content.xml" and
                    r["cellLocator"]["sourceSha256"]==sha for r in refs),
                "Incorrect typed original source locator")
        require(all(r["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED" for r in refs),
                "ODT source facts were promoted to verified resource identity")
        text=json.dumps(report)
        for secret in [CANARY,"node01","Host","Address","cellText","textCodeUnits",
                       "password",'"text"',"abc123"]:
            require(secret not in text,"Original ODT value or secret leaked to JSON "+secret)
        page.locator('[data-odt-multi-exported="true"]').wait_for(timeout=12000)
        # A sensitive cell must remain blocked even after the reviewed queue is built.
        page.locator('[data-odt-select-cell]').select_option("0:1:1")
        require(not page.locator('[data-odt-consent]').is_checked(),"Previous P3 consent reused")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-disclosure-error="BLOCKED"]')).to_have_text(
            "ODT_CELL_SENSITIVE_BLOCKED",timeout=23000)
        require(page.locator('[data-odt-multi-stage]').count()==0,"Sensitive source got stage control")
        require(CANARY not in page.locator('[data-odt-panel]').inner_html(),"Confidential ODT data in DOM")
        page.locator('[data-odt-multi-remove="0"]').click()
        expect(page.locator('[data-odt-multi-count="1"]')).to_be_visible()
        require(page.locator('[data-odt-multi-export]').is_disabled(),"Export remained enabled below two references")
        upload(page,folder,"valid.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        expect(page.locator('[data-odt-multi-count="0"]')).to_be_visible()
        require(page.locator('[data-odt-revealed-value]').count()==0,"Old P3 text survived file reselection")
        page.locator('[data-odt-close]').click()
        page.locator('[data-odt-panel]').wait_for(state="detached",timeout=12000)
        require(export_source(page)==before,"ODT P5 mutated Builder canonical JSON")
        check_unchanged(page,scenario,errors,external)
        open_panel(page)
        require(page.locator('[data-odt-multi-count]').count()==0,"Queue survived modal re-opening")
        page.locator('[data-odt-close]').click()
        return {"case":"two_independent_consent_ODT_references_immutable_builder_no_source_values",
                "status":"PASS","sourceSha256":sha,"numReferences":2,
                "builderUnchanged":True,"rawCellValuesExported":False}
    finally:
        page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
       and u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
       "Only actual loopback compiled YadiLab accepted")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yadilab-odt-p5-") as tmp:
        folder=Path(tmp)
        (folder/"valid.odt").write_bytes(make_odt())
        with sync_playwright() as pw:
            args_=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0:args_.append("--no-sandbox")
            browser=pw.chromium.launch(headless=True,args=args_)
            try:cases=[case(browser,args.url,folder)]
            finally:browser.close()
    report={"status":"PASS","platform":"GitHub Ubuntu Chromium (NOT user Parrot)",
       "kind":"compiled YadiLab ODT-P5 metadata-only batch review and download",
       "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"odt-p5-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS ODT-P5 real compiled Chromium "+cases[0]["case"],flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as err:
        print("FAIL ODT-P5 real Chromium: "+str(err),file=sys.stderr)
        raise

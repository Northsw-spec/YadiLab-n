#!/usr/bin/env python3
"""Actual bundled Chromium P5 per-cell consent, two references, metadata-only export."""
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

def case(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        original=export_source(page)
        inspect(page)
        upload(page,folder,"inventory.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=22000)
        queue=page.locator('[data-docx-multi-queue="REVIEWED_ASSOCIATIONS_ONLY"]')
        queue.wait_for(timeout=16000)
        require(page.locator('[data-docx-multi-count="0"]').count()==1,"Nonempty initial P5 queue")
        require(page.locator('[data-docx-multi-export]').is_disabled(),"Final export allowed with no references")
        require(page.locator('[data-docx-multi-stage]').count()==0,"Stage offered without P3 disclosure")
        targets=page.locator('[data-docx-association-target] option')
        # P4 target selector appears only when individual P3 cell is revealed.
        def stage(cell,target):
            page.locator('[data-docx-select-cell]').select_option(cell)
            require(page.locator('[data-docx-multi-stage]').count()==0,"P5 stage exposed without consent")
            page.locator('[data-docx-consent]').check()
            page.locator('[data-docx-reveal]').click()
            page.locator('[data-docx-revealed-value]').wait_for(timeout=22000)
            require(page.locator('[data-docx-multi-stage]').is_disabled(),"P5 stage enabled without P4 target/ack")
            page.locator('[data-docx-association-target]').select_option(target)
            require(page.locator('[data-docx-multi-stage]').is_disabled(),"P5 stage enabled without second consent")
            page.locator('[data-docx-association-ack]').check()
            page.locator('[data-docx-multi-stage]').click()
            page.locator('[data-docx-multi-staged="true"]').wait_for(timeout=22000)

        # Initial chosen cell is benign; choose two distinct existing Builder resources.
        page.locator('[data-docx-select-cell]').select_option("0:1:0")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-revealed-value]')).to_have_text("node01",timeout=22000)
        opts=page.locator('[data-docx-association-target] option')
        require(opts.count()>=3,"P5 needs two existing distinct modeled Builder resources")
        target_a=opts.nth(1).get_attribute("value")
        target_b=opts.nth(2).get_attribute("value")
        require(bool(target_a and target_b and target_a != target_b),"Distinct Builder IDs absent")
        page.locator('[data-docx-association-target]').select_option(target_a)
        require(page.locator('[data-docx-multi-stage]').is_disabled(),"P4 consent missing")
        page.locator('[data-docx-association-ack]').check()
        page.locator('[data-docx-multi-stage]').click()
        expect(page.locator('[data-docx-multi-count="1"]')).to_be_visible(timeout=22000)
        require(page.locator('[data-docx-multi-export]').is_disabled(),"Single ref incorrectly exportable")
        # The next cell is re-reviewed with consent unchecked; queued metadata remains.
        page.locator('[data-docx-select-cell]').select_option("0:0:0")
        require(page.locator('[data-docx-multi-count="1"]').count()==1,"Queue lost on new cell")
        require(page.locator('[data-docx-consent]').is_checked() is False,"P3 consent reused")
        page.locator('[data-docx-consent]').check()
        page.locator('[data-docx-reveal]').click()
        expect(page.locator('[data-docx-revealed-value]')).to_have_text("Host",timeout=22000)
        page.locator('[data-docx-association-target]').select_option(target_b)
        require(page.locator('[data-docx-multi-stage]').is_disabled(),"P4 consent reused")
        page.locator('[data-docx-association-ack]').check()
        page.locator('[data-docx-multi-stage]').click()
        expect(page.locator('[data-docx-multi-count="2"]')).to_be_visible(timeout=22000)
        assert_masked=page.locator('[data-docx-multi-items]').inner_text()
        for text in [CANARY,"node01","Host"]:
            require(text not in assert_masked,"Queue contains raw document text: "+text)
        require(page.locator('[data-docx-multi-export]').is_disabled(),"Final report exported without final ack")
        page.locator('[data-docx-multi-ack]').check()
        with page.expect_download(timeout=25000) as exported:
            page.locator('[data-docx-multi-export]').click()
        report=json.loads(Path(exported.value.path()).read_text(encoding="utf-8"))
        require(report["formatId"]=="yadilab.docx-reviewed-multi-references","Wrong P5 schema")
        require(report["status"]=="REVIEWED_ASSOCIATIONS_ONLY","Wrong review status")
        require(report["engineVerified"] is False and report["physicalTopologyVerified"] is False,
                "Report claims verified physical/Engine fact")
        sha=hashlib.sha256((folder/"inventory.docx").read_bytes()).hexdigest()
        require(report["source"]["sha256"]==sha,"DOCX source SHA mismatch")
        refs=report["references"]
        require(len(refs)==2,"P5 exported wrong number of references")
        require([x["cellLocator"]["rowOrdinal"] for x in refs]==[0,1],"Non-deterministic original locator sorting")
        require([x["targetResourceId"] for x in refs]==[target_b,target_a],"Wrong original Builder targets")
        require(all(x["cellLocator"]["sourceSha256"]==sha for x in refs),"Bad cell origin provenance")
        require(all(x["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED" for x in refs),
                "P5 operator assertions incorrectly verified")
        encoded=json.dumps(report)
        for content in [CANARY,"node01","Host","IP","cellText","password","textCodeUnits"]:
            require(content not in encoded,"DOCX value/content leaked into multi-report: "+content)
        page.locator('[data-docx-multi-exported="true"]').wait_for(timeout=12000)
        # Remove one entry, final multi-report must become blocked.
        page.locator('[data-docx-multi-remove="0"]').click()
        require(page.locator('[data-docx-multi-export]').is_disabled(),
                "P5 export not blocked after dropping below 2 references")
        upload(page,folder,"inventory.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=22000)
        expect(page.locator('[data-docx-multi-count="0"]')).to_be_visible()
        page.locator('[data-docx-close="true"]').click()
        require(export_source(page)==original,"P5 changed canonical Builder JSON")
        check_unchanged(page,scenario,errors,external)
        inspect(page)
        require(page.locator('[data-docx-multi-count]').count()==0,"Old queue survived reopening")
        page.locator('[data-docx-close="true"]').click()
        return {"case":"two_manual_references_two_consents_final_ack_no_values_bounded_export_unchanged_builder",
                "status":"PASS","sourceSha256":sha,"builderUnchanged":True,"numReferences":2}
    finally:page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",required=True,type=Path)
    args=ap.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
        u.path=="/" and not u.query and not u.fragment and
        not u.username and not u.password,"Only actual local compiled YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yadilab-docx-p5-") as folder:
        f=Path(folder);(f/"inventory.docx").write_bytes(make_bytes())
        with sync_playwright() as p:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
            browser=p.chromium.launch(headless=True,args=flags)
            try:cases=[case(browser,args.url,f)]
            finally:browser.close()
    result={"status":"PASS","platform":"GitHub Ubuntu, not Parrot",
        "kind":"real bundled browser DOCX P5", "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"docx-p5-real-chromium.json").write_text(json.dumps(result,indent=2)+"\n")
    print("PASS DOCX-P5 real Chromium: "+cases[0]["case"])
    print(json.dumps(result,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as ex:
        print("FAIL DOCX-P5 actual Chromium: "+str(ex),file=sys.stderr);raise

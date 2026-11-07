#!/usr/bin/env python3
"""IC-010 P3c: real compiled Chromium common DOCX/ODT ZIP structure inspection."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from run_ic010_p2_shared_xml_real_browser import (
    setup, exported_source, open_panel, choose, consent_inspect, invariant, require
)
from run_docx_p2_real_browser import make_bytes as make_docx, CANARY as DOCX_SECRET
from run_odt_p2_real_browser import make_odt, CANARY as ODT_SECRET

SECRET_LIST = [DOCX_SECRET, ODT_SECRET, "node01", "203.0.113.25",
               "<w:document", "<office:document-content", "word/document.xml",
               "content.xml", "textCodeUnits", "cellOrdinal", "rowOrdinal",
               "tableOrdinal", "hostKey", "locators"]

def shared_inspect(page, name, source, profile, kind):
    choose(page, name, source)
    expect(page.locator('[data-ic010-p2-selected="true"]')).to_be_visible()
    require(page.locator('[data-ic010-p2-result]').count()==0,
            "No source parsed before explicit selection consent")
    consent_inspect(page)
    expect(page.locator('[data-ic010-p2-result="REVIEW_REQUIRED"]')).to_be_visible(timeout=26000)
    require(page.locator('[data-ic010-p2-profile="'+profile+'"]').count()==1,
            "Wrong original producer profile")
    require(page.locator('[data-ic010-p2-track="CONFIG_DOCUMENTED"]').count()==1,
            "Office structure wrongly claimed current observation/topology truth")
    actual=page.locator('[data-ic010-p2-counts="'+kind+'"]').inner_text()
    for expected in ["Tables: 1","Rows: 2","Structural cells: 4","Source-bound cell references: 4"]:
        require(expected in actual,"Missing strict ZIP structural aggregate: "+expected)
    expected_hash=hashlib.sha256(source).hexdigest()
    require(expected_hash in page.locator('[data-ic010-p2-sha]').inner_text(),
            "No original complete ZIP SHA")
    require(page.locator('[data-ic010-p2-source-locator="source-document"]').count()==1,
            "Missing source document hash locator")
    require(page.locator('[data-ic010-p2-activation="BLOCKED"]').count()==1,
            "Office source is not an active Engine import")
    require(page.locator('[data-ic010-p3b-review]').count()==0,
            "Office file incorrectly received Ansible host-to-Builder review controls")
    panel=page.locator('[data-ic010-p2-panel]').inner_html()
    for secret in SECRET_LIST:
        require(secret not in panel,"Sensitive source/cell/internal locator leaked: "+secret)
    require(not page.locator('[data-ic010-p2-consent]').is_disabled(),
            "Consent switched off during review")
    return expected_hash

def case_real_office_profiles(browser,url):
    page,errors,external=setup(browser,url)
    try:
        baseline=exported_source(page)
        open_panel(page)
        accept=page.locator('[data-ic010-p2-file]').get_attribute("accept") or ""
        require(accept.endswith(".docx,.odt"),"Shared chooser does not expose two Office subsets")
        docx=make_docx()
        odt=make_odt()
        sha_docx=shared_inspect(page,"inventory.docx",docx,
                     "office.docx-tables.structural.v1","DOCX_TABLE_STRUCTURE")
        sha_odt=shared_inspect(page,"inventory.ODT",odt,
                     "office.odt-tables.structural.v1","ODT_TABLE_STRUCTURE")
        # MIME/extension never justifies interpreting the wrong archive producer.
        for name,contents in [
            ("wrong.docx",odt),("wrong.odt",docx),
            ("malicious.docx",make_docx("dtd")),
            ("external.docx",make_docx("external")),
            ("macro.docx",make_docx("macro")),
            ("script.odt",make_odt("script")),
            ("dtd.odt",make_odt("dtd")),
            ("wrong-mimetype.odt",make_odt("wrong-mime")),
            ("wrong-manifest.odt",make_odt("wrong-manifest")),
        ]:
            choose(page,name,contents)
            require(page.locator('[data-ic010-p2-result]').count()==0,
                    "Prior ZIP metadata remained visible after unsafe file switch")
            consent_inspect(page)
            expect(page.locator('[data-ic010-p2-result="BLOCKED"]')).to_be_visible(timeout=25000)
            require("IC010_P3C_CONTENT_UNRECOGNIZED" in
                    page.locator('[data-ic010-p2-result="BLOCKED"]').inner_text(),
                    "Unsafe/cross-format ZIP source did not fail-closed: "+name)
            require(page.locator('[data-ic010-p2-sha]').count()==0,
                    "Blocked ZIP exposed partial SHA or apparently verified source")
        choose(page,"oversized.docx",b"X"*(16*1024*1024+1))
        consent_inspect(page)
        expect(page.locator('[data-ic010-p2-error="BLOCKED"]')).to_have_text(
            "IC010_P3C_SOURCE_SIZE_INVALID",timeout=18000)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Oversized source returned a valid-looking summary")
        page.locator('[data-ic010-p2-close]').click()
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        invariant(page,baseline,errors,external)
        return {"case":"docx_odt_real_local_zip_structures_and_hostile_rejection",
            "status":"PASS","profiles":2,"hostileArchivesRejected":9,
            "docxOriginalSha256":sha_docx,"odtOriginalSha256":sha_odt,
            "builderUnchanged":True,"outsideRequests":0}
    finally:page.close()

def case_late_office_switch(browser,url):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        open_panel(page)
        page.evaluate("""() => {
          const original = File.prototype.arrayBuffer;
          window.__p3cPending=[];
          File.prototype.arrayBuffer = function() {
            if (this.name === "delayed.docx") {
              return new Promise((resolve,reject) => {
                window.__p3cPending.push(() => original.call(this).then(resolve,reject));
              });
            }
            return original.call(this);
          };
        }""")
        choose(page,"delayed.docx",make_docx())
        consent_inspect(page)
        page.wait_for_function("window.__p3cPending.length === 1",timeout=12000)
        # A newly selected ODT must win over a previously consented ZIP read.
        shared_inspect(page,"new.odt",make_odt(),
            "office.odt-tables.structural.v1","ODT_TABLE_STRUCTURE")
        page.evaluate("() => window.__p3cPending.shift()()")
        page.wait_for_timeout(280)
        require(page.locator('[data-ic010-p2-profile="office.odt-tables.structural.v1"]').count()==1,
                "Late DOCX parse overwrote the new ODT source")
        require(page.locator('[data-ic010-p2-counts="DOCX_TABLE_STRUCTURE"]').count()==0,
                "Stale original ZIP producer remained after replacement")
        choose(page,"delayed.docx",make_docx())
        consent_inspect(page)
        page.wait_for_function("window.__p3cPending.length === 1",timeout=12000)
        page.keyboard.press("Escape")
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        page.evaluate("() => window.__p3cPending.shift()()")
        open_panel(page)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Late closed-source metadata resurfaced after reopen")
        require(page.locator('[data-ic010-p2-consent]').is_disabled(),
                "Old file consent leaked across dialog restart")
        page.locator('[data-ic010-p2-close]').click()
        invariant(page,before,errors,external)
        return {"case":"delayed_zip_read_cross_format_switch_and_escape",
                "status":"PASS","staleDiscarded":True,"builderUnchanged":True,
                "outsideRequests":0}
    finally:page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",required=True,type=Path)
    args=ap.parse_args()
    url=urlsplit(args.url)
    require(url.scheme=="http" and url.hostname=="127.0.0.1" and url.port is not None and
      url.path=="/" and not url.query and not url.fragment and not url.username and not url.password,
      "Only exact locally built app served from loopback is allowed")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        launch=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:launch.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=launch)
        try:
            cases=[case_real_office_profiles(browser,args.url),
                   case_late_office_switch(browser,args.url)]
        finally:browser.close()
    evidence={"status":"PASS","kind":"Actual compiled Chromium and real original Office ZIP files",
              "environment":"GitHub Actions Ubuntu; native Parrot and physical network NOT_RUN",
              "cases":cases,"builderOrEngineMutation":False}
    (args.evidence_dir/"ic010-p3c-office-shared-real-browser.json").write_text(
        json.dumps(evidence,indent=2)+"\n")
    print("PASS IC-010 P3c compiled Chromium shared DOCX/ODT structural source inspection",flush=True)
    print(json.dumps(evidence,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL IC-010 P3c real browser: "+str(error),file=sys.stderr)
        raise

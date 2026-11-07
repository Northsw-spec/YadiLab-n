#!/usr/bin/env python3
"""Compiled Chromium ODT-P4: real ZIP upload, P3 reveal, P4 second consent, downloaded JSON."""
import argparse
import hashlib
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

def mutate_document(original):
    out=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original),"r") as src:
        with zipfile.ZipFile(out,"w") as target:
            for info in src.infolist():
                raw=src.read(info.filename)
                if info.filename=="content.xml":
                    raw=raw.replace(b"node01",b"node02")
                info.extra=b""
                target.writestr(info,raw)
    return out.getvalue()

def scenario(browser,url,folder):
    page,scenario_id,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        open_panel(page)
        upload(page,folder,"valid.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        require(page.locator('[data-odt-association]').count()==0,
                "ODT P4 resource panel appeared before explicit P3 cell disclosure")
        page.locator('[data-odt-select-cell]').select_option("0:1:0")
        require(page.locator('[data-odt-association]').count()==0,
                "ODT P4 resource selection appeared before P3 consent")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-revealed-value]')).to_have_text("node01",timeout=23000)
        panel=page.locator('[data-odt-association="REVIEWED_ASSOCIATIONS_ONLY"]')
        panel.wait_for(timeout=15000)
        require(page.locator('[data-odt-association-export]').is_disabled(),
                "ODT P4 exported with no selected resource or second consent")
        options=page.locator('[data-odt-association-target] option')
        require(options.count()>1,"No existing modeled Builder resources")
        resource=options.nth(1).get_attribute("value")
        require(bool(resource),"No stable Builder resource identity")
        page.locator('[data-odt-association-target]').select_option(resource)
        require(page.locator('[data-odt-association-export]').is_disabled(),
                "ODT P4 resource selection bypassed second consent")
        page.locator('[data-odt-association-ack]').check()
        with page.expect_download(timeout=24000) as dl:
            page.locator('[data-odt-association-export]').click()
        exported=json.loads(Path(dl.value.path()).read_text(encoding="utf-8"))
        sha=hashlib.sha256((folder/"valid.odt").read_bytes()).hexdigest()
        require(exported["formatId"]=="yadilab.odt-reviewed-cell-references",
                "Wrong ODT P4 report identity")
        require(exported["schemaVersion"]=="1.0.0","Wrong ODT P4 schema")
        require(exported["status"]=="REVIEWED_ASSOCIATIONS_ONLY",
                "ODT P4 claimed verified reference")
        require(exported["source"]["profileId"]=="office.odt-tables.structural.v1",
                "Wrong ODT P1 source provenance")
        require(exported["source"]["sha256"]==sha,
                "ODT P4 source SHA256 does not match original file")
        loc=exported["source"]["cellLocator"]
        require(loc["kind"]=="odt-table-cell" and loc["part"]=="content.xml",
                "ODT P4 locator points to wrong document type")
        require(loc["sourceSha256"]==sha,"ODT P4 typed locator SHA mismatch")
        require((loc["tableOrdinal"],loc["rowOrdinal"],loc["cellOrdinal"])==(0,1,0),
                "ODT P4 captured incorrect source cell")
        require(exported["association"]["targetResourceId"]==resource,
                "ODT P4 Builder resource mismatch")
        require(exported["association"]["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                "ODT P4 inferred verified device")
        require(exported["engineVerified"] is False and
                exported["physicalTopologyVerified"] is False,
                "ODT P4 promoted unverified association to physical/Engine truth")
        content=json.dumps(exported)
        for raw in [CANARY,"node01","Host","Address","textCodeUnits",'"text"',
                    "cellText","Password","ssh_private_key"]:
            require(raw not in content,"Raw ODT cell/source content leaked into JSON: "+raw)
        page.locator('[data-odt-association-exported="true"]').wait_for(timeout=12000)
        # Canonical Builder comparison is performed AFTER closing the ODT modal.
        # Switching the original cell must revoke P3+P4 decisions and hide P4.
        page.locator('[data-odt-select-cell]').select_option("0:1:1")
        require(page.locator('[data-odt-association]').count()==0,
                "ODT P4 selection/consent persisted across cell switch")
        require(not page.locator('[data-odt-consent]').is_checked(),
                "P3 ODT consent improperly reused after cell switch")
        page.locator('[data-odt-consent]').check()
        page.locator('[data-odt-reveal]').click()
        expect(page.locator('[data-odt-disclosure-error="BLOCKED"]')).to_have_text(
            "ODT_CELL_SENSITIVE_BLOCKED",timeout=23000)
        require(page.locator('[data-odt-association]').count()==0,
                "Sensitive ODT cell created a P4 association")
        require(CANARY not in page.locator('[data-odt-panel]').inner_html(),
                "Sensitive ODT value exposed in ODT P4 view")
        upload(page,folder,"changed.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        require(page.locator('[data-odt-association]').count()==0,
                "ODT P4 persisted after changed original file")
        require(page.locator('[data-odt-revealed-value]').count()==0,
                "Original P3 cell persisted after changed ODT source")
        require(page.locator('[data-odt-select-cell]').input_value()=="",
                "ODT P4 source switch reused previous selected cell")
        upload(page,folder,"valid.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=23000)
        require(page.locator('[data-odt-association]').count()==0,
                "ODT P4 source reset failed")
        page.locator('[data-odt-close]').click()
        page.locator('[data-odt-panel]').wait_for(state="detached",timeout=12000)
        require(export_source(page)==before,"Builder source changed after all ODT P4 actions")
        check_unchanged(page,scenario_id,errors,external)
        open_panel(page)
        require(page.locator('[data-odt-association]').count()==0,
                "ODT P4 persisted after modal close/reopen")
        page.locator('[data-odt-close]').click()
        return {"case":"one_consented_ODT_cell_existing_Builder_reference_no_value_export",
            "status":"PASS","originalSha256":sha,"singleAssociation":True,
            "builderUnchanged":True,"rawValuesExcluded":True}
    finally:page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
            and u.path=="/" and not u.query and not u.fragment
            and not u.username and not u.password,
            "Only compiled localhost YadiLab is accepted")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="odt-p4-") as folder:
        local=Path(folder)
        actual=make_odt()
        (local/"valid.odt").write_bytes(actual)
        (local/"changed.odt").write_bytes(mutate_document(actual))
        with sync_playwright() as pw:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
            browser=pw.chromium.launch(headless=True,args=flags)
            try:cases=[scenario(browser,args.url,local)]
            finally:browser.close()
    report={"status":"PASS","platform":"GitHub Ubuntu Chromium (not user's Parrot)",
      "kind":"actual compiled YadiLab ODT P4 original ODT + P3/P4 consented reference",
      "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"odt-p4-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS ODT P4 actual compiled Chromium "+cases[0]["case"],flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL ODT P4 Chromium: "+str(exc),file=sys.stderr)
        raise

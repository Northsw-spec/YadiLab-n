#!/usr/bin/env python3
"""FROZEN before P4c3a UI code: true independent 10k/10k DOCX+ODT browser.

Source-only real 200 separately checked row groups and canonical preflight:
never Builder mutation, actual ELK/ReactFlow 10k Office or physical Engine PASS.
"""
import argparse
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect,sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require,menu
from run_scale001_p2b1_office_1000_real_browser import (
    docx_xml,odt_xml,TYPES,MAIN,OPC,OFFICE_REL,ODT_MIME,MANIFEST
)

PREFIX="data-scale-p4c3a-"
N=10000
def device(i):return "dev"+str(i).zfill(6)
def port(i):return "p"+str(i).zfill(6)
PRIVATE_NODE="P4C3A_PRIVATE_NODE_CANARY_"
PRIVATE_LINK="P4C3A_PRIVATE_LINK_CANARY_"

def original(fmt,unknown=False):
    """Genuine ZIP members, all original IDs and independent port-paired Links."""
    nodes=[["Device ID","Canonical role","Private Notes"]]
    links=[["From","To","Source port","Target port","Private Notes"]]
    for i in range(N):
        nodes.append([device(i),"network.switch" if i==0 else "endpoint.windows",
                      PRIVATE_NODE+str(i)])
    for i in range(1,N):
        links.append([device(i),("missing999" if unknown and i==N-1 else device(0)),
                      "eth0",port(i),PRIVATE_LINK+str(i)])
    links.append([device(1),device(0),"eth1",port(N),PRIVATE_LINK+"parallel"])
    require(len(nodes)==len(links)==N+1,
      "P4c3a original source ZIP doesn't have 10k source rows per table")
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as z:
        if fmt=="docx":
            z.writestr("[Content_Types].xml",
              '<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>')
            z.writestr("_rels/.rels",
              '<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+OFFICE_REL+'" Target="word/document.xml"/></Relationships>')
            z.writestr("word/document.xml",docx_xml([nodes,links]))
        else:
            z.writestr("mimetype",ODT_MIME,compress_type=zipfile.ZIP_STORED)
            z.writestr("content.xml",odt_xml([nodes,links]))
            z.writestr("META-INF/manifest.xml",
              '<manifest:manifest xmlns:manifest="'+MANIFEST+'" manifest:version="1.3">'+
              '<manifest:file-entry manifest:full-path="/" manifest:media-type="'+ODT_MIME+'"/>'+
              '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
              '</manifest:manifest>')
    return out.getvalue()

def open_panel(page,fmt,buffer):
    menu(page).locator('[data-review-scaled-office-ten-thousand-preflight="REVIEW_REQUIRED"]').click()
    panel=page.locator('[data-scale-p4c3a-panel="REVIEW_REQUIRED"]')
    expect(panel).to_be_visible(timeout=30000)
    expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_disabled()
    panel.locator('[data-scale-p4c3a-file="true"]').set_input_files({
        "name":"real-original-10000."+fmt,
        "mimeType":"application/octet-stream","buffer":buffer})
    expect(panel.locator('[data-scale-p4c3a-summary="REVIEW_REQUIRED"]')).to_be_visible(timeout=180000)
    require(panel.locator('[data-scale-p4c3a-selection-count="0"]').count()==1,
      "P4c3a source row grants preapproved without user consent")
    require(device(9999) not in panel.inner_html(),"Original source text leaked in structural preview")
    require(PRIVATE_NODE not in panel.inner_html() and
            PRIVATE_LINK not in panel.inner_html(),
      "Unselected private original source value leaked before consent")
    return panel

def mapping(panel):
    panel.locator('[data-scale-p4c3a-node-table]').select_option("0")
    panel.locator('[data-scale-p4c3a-link-table]').select_option("1")
    for key,index in [
      ("node-id",0),("node-role",1),("link-from",0),("link-to",1),
      ("source-port",2),("target-port",3)
    ]:
        panel.locator('[data-scale-p4c3a-'+key+']').select_option(str(index))
    expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_disabled()
    for kind in ("node","link"):
        checkboxes=panel.locator('[data-scale-p4c3a-approve-'+kind+'-batch]')
        require(checkboxes.count()==100,"Expected 100 separately checked "+kind+" batches")
        require(all(not box.is_checked() for box in checkboxes.all()),
          "Default consent was incorrectly set for 10k original "+kind)
    preflight=panel.locator('[data-scale-p4c3a-approve-preflight]')
    require(not preflight.is_checked(),"Preflight final authorization prechecked")
    expect(preflight).to_be_disabled()

def approve(panel):
    for i in range(100):
        panel.locator('[data-scale-p4c3a-approve-node-batch="'+str(i)+'"]').check()
        panel.locator('[data-scale-p4c3a-approve-link-batch="'+str(i)+'"]').check()
    expect(panel.locator('[data-scale-p4c3a-selection-count="20000"]')).to_be_visible()
    expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_disabled()
    preflight=panel.locator('[data-scale-p4c3a-approve-preflight]')
    expect(preflight).to_be_enabled()
    preflight.check()
    expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_enabled()

def reject_missing_grant(panel):
    panel.locator('[data-scale-p4c3a-approve-link-batch="99"]').uncheck()
    expect(panel.locator('[data-scale-p4c3a-selection-count="19900"]')).to_be_visible()
    expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_disabled()
    require(not panel.locator('[data-scale-p4c3a-approve-preflight]').is_checked(),
      "Revoking one original Links batch didn't revoke final approval")
    panel.locator('[data-scale-p4c3a-approve-link-batch="99"]').check()
    expect(panel.locator('[data-scale-p4c3a-approve-preflight]')).to_be_enabled()
    panel.locator('[data-scale-p4c3a-approve-preflight]').check()
    expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_enabled()

def assert_private_absent(page):
    page_html=page.content()
    require(PRIVATE_NODE not in page_html and PRIVATE_LINK not in page_html,
      "P4c3a leaked unselected original private cell text to mounted DOM")

def close(panel):
    panel.locator('[data-scale-p4c3a-cancel]').click()
    expect(panel).to_have_count(0,timeout=30000)

def full_preflight(browser,url,fmt):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=open_panel(page,fmt,original(fmt))
        mapping(panel)
        approve(panel)
        reject_missing_grant(panel)
        panel.locator('[data-scale-p4c3a-confirm]').click()
        result=panel.locator('[data-scale-p4c3a-validated="SOURCE_ONLY_NOT_ACTIVATED"]')
        expect(result).to_be_visible(timeout=240000)
        require("10000" in result.inner_text() and
                "20000" in panel.inner_text(),
          "Preflight result does not show original source-row scope")
        require("physical" in result.inner_text().lower() and
                "unverified" in result.inner_text().lower(),
          "UI suggests physical link or Engine verification")
        assert_private_absent(page)
        close(panel)
        require(exported_source(page)==before,
          "Original Office review-only preflight mutated editable Builder")
        require(not errors and not external,
          "Actual 10k Office Chromium preflight caused JS errors or external network")
        return {"format":fmt,"case":"genuine_10k_office_review_only",
                "status":"PASS","originalSourceDevices":N,
                "originalSourcePortLinks":N,"individuallyApprovedBatches":200,
                "builderMutated":False,"mountedOfficeFullGraphVerified":False,
                "engineVerified":False,"physicalTopologyVerified":False}
    finally:page.close()

def cancel_before_preflight(browser,url):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=open_panel(page,"odt",original("odt"))
        mapping(panel)
        approve(panel)
        close(panel)
        require(exported_source(page)==before,
          "Cancelling a fully approved preflight replaced editable Builder")
        require(not errors and not external,
          "Cancel generated unexpected JS errors/external requests")
        return {"case":"full_consent_then_cancel","status":"PASS","builderMutated":False}
    finally:page.close()

def unknown_endpoint(browser,url):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=open_panel(page,"docx",original("docx",unknown=True))
        mapping(panel)
        approve(panel)
        panel.locator('[data-scale-p4c3a-confirm]').click()
        expect(panel.locator('[data-scale-p4c3a-error="BLOCKED"]')).to_be_visible(timeout=240000)
        expect(panel.locator('[data-scale-p4c3a-validated]')).to_have_count(0)
        assert_private_absent(page)
        close(panel)
        require(exported_source(page)==before,
          "Unknown original link endpoint partially mutated Builder")
        require(not errors and not external,
          "Source endpoint block caused JS errors/external requests")
        return {"case":"unknown_original_endpoint_fail_closed",
                "status":"PASS","builderMutated":False}
    finally:page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    target=urlsplit(args.url)
    require(target.scheme=="http" and target.hostname=="127.0.0.1" and
            target.port is not None and target.path=="/" and
            not target.query and not target.fragment,
      "P4c3a requires real mounted isolated localhost Chromium app")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:
            cases=[full_preflight(browser,args.url,fmt) for fmt in ["docx","odt"]]
            cases.extend([cancel_before_preflight(browser,args.url),
                          unknown_endpoint(browser,args.url)])
        finally:browser.close()
    record={"kind":"SCALE-001 P4c3a actual original 10k Office Chromium review-only preflight",
            "status":"PASS","cases":cases,
            "builderMutationVerified":False,"tenThousandOfficeGraphVerified":False,
            "engineVerified":False,"physicalTopologyVerified":False}
    (args.evidence_dir/"scale001-p4c3a-10000-office-real-browser-preflight.json").write_text(
        json.dumps(record,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P4c3a actual Chromium original 10000/10000 DOCX+ODT "+
          "100+100 independent source consent reviews, real original SHA/port "+
          "preflight, no Builder mutation, cancel and unknown endpoint block")
    print(json.dumps(record,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL SCALE-001 P4c3a true mounted DOCX+ODT 10000 Office review-only: "+
              str(error),file=sys.stderr)
        raise

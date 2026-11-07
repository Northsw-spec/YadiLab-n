#!/usr/bin/env python3
"""DRAWIO P4: actual compiled Chromium manual ordinal references from synthetic mixed XML."""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu
from run_drawio_p3_real_browser import source, CANARY

def open_panel(page):
    menu(page).locator('[data-inspect-drawio="PREVIEW_ONLY"]').click()
    expect(page.locator('[data-drawio-panel="PREVIEW_ONLY"]')).to_be_visible(timeout=20000)
def choose(page,name,raw):
    page.locator('[data-drawio-file="true"]').set_input_files({
        "name":name,"mimeType":"application/xml","buffer":raw})
def case(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        raw=source()
        sha=hashlib.sha256(raw).hexdigest()
        open_panel(page)
        choose(page,"sample.drawio",raw)
        expect(page.locator('[data-drawio-preview="PREVIEW_ONLY"]')).to_be_visible(timeout=25000)
        expect(page.locator('[data-drawio-association-review="REVIEW_REQUIRED"]')).to_be_visible()
        pos0=page.locator('[data-drawio-associate-vertex="0:1"]')
        pos1=page.locator('[data-drawio-associate-vertex="1:0"]')
        opts=pos0.locator("option")
        require(opts.count()>=3,"Need two modeled Builder resources")
        target_a=opts.nth(1).get_attribute("value")
        target_b=opts.nth(2).get_attribute("value")
        require(target_a and target_b and target_a!=target_b,"Need distinct model targets")
        export=page.locator('[data-drawio-association-export]')
        require(export.is_disabled(),"No default automatic mapping allowed")
        pos1.select_option(target_b)
        require(export.is_disabled(),"No unacknowledged export allowed")
        pos0.select_option(target_a)
        require(export.is_disabled(),"Missing explicit consent gate")
        page.locator('[data-drawio-association-ack]').check()
        with page.expect_download(timeout=25000) as downloaded:
            export.click()
        sidecar=json.loads(Path(downloaded.value.path()).read_text())
        require(sidecar["formatId"]=="yadilab.drawio-reviewed-vertex-references",
                "Wrong JSON association format")
        require(sidecar["status"]=="REVIEWED_ASSOCIATIONS_ONLY","False verified status")
        require(sidecar["source"]=={
            "profileId":"diagrams.drawio.uncompressed-structure.v1",
            "sha256":sha,"semanticTrack":"TOPOLOGY_DECLARED"},"Source profile/hash mismatch")
        require(sidecar["targetModel"]["scenarioId"]==before["scenarioId"],
                "Wrong Builder scenario")
        require(len(sidecar["associations"])==2,"Not exactly two manual selections")
        a,b=sidecar["associations"]
        require(a["locator"]=={
            "kind":"drawio-vertex-ordinal","sourceSha256":sha,
            "pageOrdinal":0,"vertexOrdinal":1},"Wrong first source ordinal")
        require(b["locator"]=={
            "kind":"drawio-vertex-ordinal","sourceSha256":sha,
            "pageOrdinal":1,"vertexOrdinal":0},"Wrong second source ordinal")
        require(a["targetResourceId"]==target_a and b["targetResourceId"]==target_b,
                "Wrong manually selected modeled target")
        for ref in sidecar["associations"]:
            require(ref["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                    "Verified identity must never be claimed")
        for key in ["engineVerified","identityVerified","physicalTopologyVerified","modelMutated"]:
            require(sidecar[key] is False,"Truth elevation: "+key)
        encoded=json.dumps(sidecar)
        for private in [CANARY,"10.4.8.12","198.51.100.84","SECRET-CUSTOMER",
                        "internal_server","secret_switch","secret_link",
                        "private_monitor","mxCell"]:
            require(private not in encoded,"Private source in sidecar "+private)
            require(private not in page.locator('[data-drawio-panel]').inner_html(),
                    "Private source in DOM "+private)
        page.locator('[data-drawio-associate-vertex="0:0"]').select_option(target_a)
        expect(page.locator('[data-drawio-association-duplicate="BLOCKED"]')).to_be_visible()
        require(export.is_disabled(),"Duplicate target exported")
        page.locator('[data-drawio-associate-vertex="0:0"]').select_option("")
        require(not page.locator('[data-drawio-association-ack]').is_checked(),
                "Changing mapping should revoke prior acknowledgment")
        require(export.is_disabled(),"Mapping changed without new acknowledgment")
        choose(page,"changed-source.drawio",source(compress_b=True))
        expect(page.locator('[data-drawio-preview="PREVIEW_ONLY"]')).to_be_visible(timeout=25000)
        expect(page.locator('[data-drawio-reference-count="0"]')).to_be_visible(timeout=25000)
        require(not page.locator('[data-drawio-association-ack]').is_checked(),
                "Old acknowledgment survived original source replacement")
        choose(page,"invalid.drawio",b'<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxfile/>')
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "IMPORT_XML_DTD_FORBIDDEN",timeout=25000)
        require(page.locator('[data-drawio-association-review]').count()==0,
                "Previous reviewed controls survived invalid XML")
        page.locator('[data-drawio-close="true"]').click()
        expect(page.locator('[data-drawio-panel]')).to_have_count(0)
        require(export_source(page)==before,"draw.io review modified canonical Builder source")
        check_unchanged(page,scenario,errors,external)
        open_panel(page)
        require(page.locator('[data-drawio-association-review]').count()==0,
                "Old source and consent survived modal reopen")
        page.locator('[data-drawio-close="true"]').click()
        return {"case":"mixed_compressed_ordinal_sidecar_two_resources",
                "status":"PASS","reviewedReferences":2,"sourceSha256":sha,
                "privateSourceExposed":False,"builderChanged":False}
    finally:page.close()
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
        and u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
        "Local compiled YadiLab only")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:checks=[case(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"DRAWIO P4 compiled Chromium synthetic mixed pages",
        "platform":"GitHub Ubuntu Chromium (no Parrot-native test)",
        "cases":checks,"builderOrEngineModified":False}
    (args.evidence_dir/"drawio-p4-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS DRAWIO P4 actual compiled Chromium",flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL DRAWIO P4 actual Chromium "+str(error),file=sys.stderr)
        raise

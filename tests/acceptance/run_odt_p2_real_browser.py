#!/usr/bin/env python3
"""Real compiled YadiLab Chromium ODT structural-only inspection, not simulated UI."""
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
from playwright.sync_api import sync_playwright, expect
from run_docx_p2_real_browser import setup, menu, export_source, check_unchanged, require

MIME="application/vnd.oasis.opendocument.text"
OFFICE="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
TABLE="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
TEXT="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
MANIFEST="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
CANARY="SECRET_ODT_BROWSER_NEVER_RENDER_8945"

def document(row_mark="",extra=""):
    def cell(value):
        return ('<table:table-cell office:value-type="string"><text:p>'+
                value+'</text:p></table:table-cell>')
    def row(cells):
        return '<table:table-row'+row_mark+'>'+''.join(map(cell,cells))+'</table:table-row>'
    tab=('<table:table table:name="Inventory"><table:table-column/>'+
         row(["Host","Address"])+row(["node01",CANARY])+'</table:table>')
    return ('<office:document-content xmlns:office="'+OFFICE+'" xmlns:table="'+TABLE+
            '" xmlns:text="'+TEXT+'" office:version="1.3"><office:body><office:text>'+
            extra+tab+'</office:text></office:body></office:document-content>')

def make_odt(kind="valid"):
    mime = MIME if kind!="wrong-mime" else "application/vnd.oasis.opendocument.spreadsheet"
    content=document()
    if kind=="dtd":
        content=content.replace('<office:body>',
            '<!DOCTYPE office:document-content [<!ENTITY attack SYSTEM "file:///etc/passwd">]><office:body>')
    if kind=="repeated":
        content=document(' table:number-rows-repeated="2"')
    root_media=MIME if kind!="wrong-manifest" else "application/vnd.oasis.opendocument.spreadsheet"
    manifest=('<manifest:manifest xmlns:manifest="'+MANIFEST+'" manifest:version="1.3">'+
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="'+root_media+'"/>'+
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
      '</manifest:manifest>')
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,"w") as package:
        # ODF section 3.3: first ZIP entry STORED with zero extra, not a file extension proxy.
        info=zipfile.ZipInfo("mimetype",(1980,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_STORED
        info.extra=b""
        package.writestr(info,mime.encode("ascii"))
        package.writestr("content.xml",content.encode(),compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("META-INF/manifest.xml",manifest.encode(),compress_type=zipfile.ZIP_DEFLATED)
        if kind=="script":
            package.writestr("Scripts/startup.js",b"alert(1)",compress_type=zipfile.ZIP_DEFLATED)
    return stream.getvalue()

def samples(folder):
    out={"valid.odt":make_odt(),"script.odt":make_odt("script"),
        "dtd.odt":make_odt("dtd"),"repeated.odt":make_odt("repeated"),
        "wrong-mime.odt":make_odt("wrong-mime"),
        "wrong-manifest.odt":make_odt("wrong-manifest"),
        "wrong.txt":make_odt(),"broken.odt":b"notzip"*30}
    for name,data in out.items():
        (folder/name).write_bytes(data)
    return out

def open_panel(page):
    menu(page).locator('[data-inspect-odt="CONFIG_DOCUMENTED"]').click()
    page.locator('[data-odt-panel="CONFIG_DOCUMENTED"]').wait_for(timeout=12000)

def upload(page,folder,name):
    page.locator('[data-odt-file="true"]').set_input_files(str(folder/name))

def case(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        initial=export_source(page)
        open_panel(page)
        require(page.locator('[data-odt-preview]').count()==0,"ODT preview not initially empty")
        upload(page,folder,"valid.odt")
        result=page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]')
        result.wait_for(timeout=22000)
        text=result.inner_text()
        for expected in ["Declared tables: 1","structural cells: 4",
           "Table 1: 2 rows","Row 2: 2 cells","Cell 2: "+str(len(CANARY))+" text code units",
           "CONFIG_DOCUMENTED","REVIEW_REQUIRED"]:
            require(expected in text,"Missing structural fact "+expected)
        require(page.locator('[data-odt-cell]').count()==4,"Incorrect ODT structural cell count")
        require(page.locator('[data-odt-cell="0:1:1"]').count()==1,"Original ODT cell locator wrong")
        original_hash=hashlib.sha256((folder/"valid.odt").read_bytes()).hexdigest()
        require(original_hash in page.locator('[data-odt-source-hash]').inner_text(),
                "ODT original ZIP SHA mismatch")
        html=page.locator('[data-odt-panel]').inner_html()
        for secret in [CANARY,"node01",">Host<",">Address<","<office:document-content"]:
            require(secret not in html,"ODT original cell/source content leaked: "+secret)
        require(page.locator('[data-odt-activation-status="BLOCKED"]').count()==1,
                "ODT inspection lacks read-only truth boundary")
        check_unchanged(page,scenario,errors,external)
        for name,code in [
           ("broken.odt","ODT_PACKAGE_HEADER_INVALID"),
           ("wrong.txt","ODT_FILE_EXTENSION_INVALID"),
           ("script.odt","ODT_UNSUPPORTED_PACKAGE_MEMBER"),
           ("dtd.odt","IMPORT_XML_DTD_FORBIDDEN"),
           ("repeated.odt","ODT_UNSUPPORTED_ATTRIBUTE"),
           ("wrong-mime.odt","ODT_MIMETYPE_VALUE_INVALID"),
           ("wrong-manifest.odt","ODT_MANIFEST_MISMATCH"),
        ]:
            upload(page,folder,name)
            expect(page.locator('[data-odt-error="BLOCKED"]')).to_have_text(code,timeout=22000)
            require(page.locator('[data-odt-preview]').count()==0,"Stale partial ODT preview on "+name)
            require(CANARY not in page.locator('[data-odt-panel]').inner_html(),
                    "ODT content leaked after failure")
            check_unchanged(page,scenario,errors,external)
        upload(page,folder,"valid.odt")
        page.locator('[data-odt-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=22000)
        require(page.locator('[data-odt-error]').count()==0,"Stale error persisted")
        page.locator('[data-odt-close]').click()
        page.locator('[data-odt-panel]').wait_for(state="detached",timeout=12000)
        require(export_source(page)==initial,"ODT preview changed Builder canonical JSON")
        open_panel(page)
        require(page.locator('[data-odt-preview]').count()==0,"Old ODT preview persisted after reopen")
        page.locator('[data-odt-close]').click()
        check_unchanged(page,scenario,errors,external)
        return {"case":"standards_ODT_stored_mimetype_structure_SHA_7_rejections_recovery_no_builder_change",
            "status":"PASS","blockedFiles":7,"originalSha256":original_hash,
            "builderUnchanged":True,"secretCellValuesDisplayed":False}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    parsed=urlsplit(args.url)
    require(parsed.scheme=="http" and parsed.hostname=="127.0.0.1" and
        parsed.port is not None and parsed.path=="/" and not parsed.username and
        not parsed.password and not parsed.query and not parsed.fragment,
        "Only actual loopback YadiLab is accepted")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yadilab-odt-") as tmp:
        folder=Path(tmp)
        samples(folder)
        with sync_playwright() as play:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
            browser=play.chromium.launch(headless=True,args=flags)
            try:cases=[case(browser,args.url,folder)]
            finally:browser.close()
    report={"status":"PASS","platform":"GitHub Ubuntu Chromium (not user Parrot)",
        "kind":"actual built YadiLab ODT file picker table structure acceptance",
        "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"odt-p1-p2-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS ODT P1/P2 real Chromium "+cases[0]["case"],flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as err:
        print("FAIL ODT P1/P2 real Chromium: "+str(err),file=sys.stderr)
        raise

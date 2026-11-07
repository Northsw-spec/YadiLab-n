#!/usr/bin/env python3
"""Real compiled Chromium DOCX structural-only inspection, no mock DOM or network."""
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

WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
OPC_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
OPC_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types"
OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
MAIN_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
CANARY = "SECRET_DOCX_BROWSER_NEVER_DISPLAY_8923"

def require(condition, why):
    if not condition:
        raise AssertionError(why)

def make_bytes(kind="valid"):
    doc = ('<w:document xmlns:w="' + WORD + '"><w:body><w:tbl>' +
           '<w:tr><w:tc><w:p><w:r><w:t>Host</w:t></w:r></w:p></w:tc>' +
           '<w:tc><w:p><w:r><w:t>IP</w:t></w:r></w:p></w:tc></w:tr>' +
           '<w:tr><w:tc><w:p><w:r><w:t>node01</w:t></w:r></w:p></w:tc>' +
           '<w:tc><w:p><w:r><w:t>' + CANARY + '</w:t></w:r></w:p></w:tc></w:tr>' +
           '</w:tbl></w:body></w:document>')
    if kind == "dtd":
        doc = doc.replace("<w:body>", "<!DOCTYPE w:document [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><w:body>")
    types = ('<Types xmlns="' + OPC_TYPES + '"><Override PartName="/word/document.xml" ContentType="' +
             MAIN_TYPE + '"/></Types>')
    rels = ('<Relationships xmlns="' + OPC_REL + '"><Relationship Id="rId1" Type="' +
            OFFICE_REL + '" Target="word/document.xml"/>')
    if kind == "external":
        rels += ('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
                 'TargetMode="External" Target="https://example.invalid/malicious"/>')
    rels += '</Relationships>'
    members = {"[Content_Types].xml":types,"_rels/.rels":rels,"word/document.xml":doc}
    if kind == "macro":
        members["word/vbaProject.bin"] = "evil"
    result=io.BytesIO()
    with zipfile.ZipFile(result,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as package:
        for name,data in members.items():
            package.writestr(name,data)
    return result.getvalue()

def create_files(folder):
    samples={"valid.docx":make_bytes(),"hostile-dtd.docx":make_bytes("dtd"),
             "external-link.docx":make_bytes("external"),"macro.docx":make_bytes("macro"),
             "broken.docx":b"no ZIP container","wrong.doc":make_bytes()}
    for filename, content in samples.items():
        (folder/filename).write_bytes(content)
    return samples

def setup(browser,url):
    page=browser.new_page(accept_downloads=True,viewport={"width":1500,"height":1000})
    errors=[]
    external=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.on("request",lambda request: external.append(request.url) if not (
        request.url.startswith(url) or request.url.startswith("data:") or request.url.startswith("blob:")) else None)
    page.goto(url,wait_until="domcontentloaded",timeout=25000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    return page, page.locator(".app-frame").get_attribute("data-runtime-scenario-id"), errors, external

def menu(page):
    item=page.locator(".workspace-menu",has=page.locator("summary",has_text="Import / Export"))
    require(item.count()==1,"Import / Export menu not unique")
    if item.get_attribute("open") is None: item.locator("summary").click()
    return item

def export_source(page):
    with page.expect_download(timeout=20000) as d:
        menu(page).get_by_role("button",name="Exportera källfil").click()
    return json.loads(Path(d.value.path()).read_text(encoding="utf-8"))

def inspect(page):
    menu(page).locator('[data-inspect-docx="CONFIG_DOCUMENTED"]').click()
    page.locator('[data-docx-panel="CONFIG_DOCUMENTED"]').wait_for(timeout=15000)

def upload(page,folder,name):
    page.locator('[data-docx-file="true"]').set_input_files(str(folder/name))

def check_unchanged(page,scenario,errors,external):
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")==scenario,
            "DOCX inspection altered the scenario")
    require(page.locator('[data-docx-import],[data-docx-activate],[data-docx-export]').count()==0,
            "DOCX panel created an activation/export button")
    require(not errors,"Browser JavaScript error(s) "+repr(errors))
    require(not external,"Unexpected external browser network request(s) "+repr(external))

def test_positive(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_source(page)
        inspect(page)
        upload(page,folder,"valid.docx")
        preview=page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]')
        preview.wait_for(timeout=20000)
        text=preview.inner_text()
        for token in ("Declared tables: 1","structural cells: 4","Table 1: 2 rows",
                      "Row 2: 2 cells","Cell 2: "+str(len(CANARY))+" text code units",
                      "CONFIG_DOCUMENTED","REVIEW_REQUIRED","No cell values"):
            require(token in text,"Missing structural fact "+token)
        require(page.locator('[data-docx-cell]').count()==4,"Wrong exact cell count")
        require(page.locator('[data-docx-cell="0:1:1"]').count()==1,"Typed original cell locator missing")
        digest=hashlib.sha256((folder/"valid.docx").read_bytes()).hexdigest()
        require(digest in page.locator('[data-docx-source-hash]').inner_text(),"Original file SHA256 mismatch")
        html=page.locator('[data-docx-panel]').inner_html()
        for secret in (CANARY,"node01",">Host<","<w:document"):
            require(secret not in html,"Document content leaked into DOM "+secret)
        require(page.locator('[data-docx-activation-status="BLOCKED"]').count()==1,
                "No read-only truth boundary")
        check_unchanged(page,scenario,errors,external)
        page.locator('[data-docx-close="true"]').click()
        page.locator('[data-docx-panel]').wait_for(state="detached",timeout=12000)
        require(export_source(page)==baseline,"Builder JSON changed after DOCX inspection/cancel")
        check_unchanged(page,scenario,errors,external)
        return {"case":"real_docx_structural_cell_lengths_original_sha_no_leak_no_builder_mutation","status":"PASS","builderUnchanged":True}
    finally:page.close()

def test_negative_recovery(browser,url,folder):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_source(page)
        inspect(page)
        for filename,code in [("broken.docx","IMPORT_WORKBOOK_ARCHIVE_INVALID"),
                              ("wrong.doc","DOCX_FILE_EXTENSION_INVALID"),
                              ("hostile-dtd.docx","IMPORT_XML_DTD_FORBIDDEN"),
                              ("external-link.docx","DOCX_EXTERNAL_RELATIONSHIP"),
                              ("macro.docx","DOCX_ACTIVE_OR_EMBEDDED_CONTENT")]:
            upload(page,folder,filename)
            expect(page.locator('[data-docx-error="BLOCKED"]')).to_contain_text(code,timeout=20000)
            require(page.locator('[data-docx-preview]').count()==0,"Partial/stale DOCX preview after "+filename)
            require(CANARY not in page.locator('[data-docx-panel]').inner_html(),"Sensitive DOCX content leaked")
            check_unchanged(page,scenario,errors,external)
        upload(page,folder,"valid.docx")
        page.locator('[data-docx-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=20000)
        require(page.locator('[data-docx-error]').count()==0,"Stale rejection not cleared")
        page.locator('[data-docx-close="true"]').click()
        require(export_source(page)==baseline,"Builder changed during hostile DOCX/recovery")
        inspect(page)
        require(page.locator('[data-docx-preview]').count()==0,"Old DOCX carried into reopened modal")
        page.locator('[data-docx-close="true"]').click()
        check_unchanged(page,scenario,errors,external)
        return {"case":"real_docx_five_negative_recovery_reopen_no_mutation","status":"PASS",
                "rejected":5,"builderUnchanged":True}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
            and u.path=="/" and not u.username and not u.password
            and not u.query and not u.fragment,"Only exact loopback YadiLab is accepted")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="yadilab-docx-p2-") as temp:
        folder=Path(temp)
        create_files(folder)
        with sync_playwright() as p:
            flags=["--disable-background-networking","--disable-dev-shm-usage"]
            if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
            browser=p.chromium.launch(headless=True,args=flags)
            try:
                results=[test_positive(browser,args.url,folder),test_negative_recovery(browser,args.url,folder)]
            finally:browser.close()
    report={"status":"PASS","kind":"actual compiled YadiLab Chromium DOM interactions",
            "platform":"GitHub Ubuntu CI (not Parrot)","cases":results,"builderOrEngineModified":False}
    (args.evidence_dir/"docx-p2-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    for case in results: print("PASS DOCX P2 Chromium "+case["case"],flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try: main()
    except Exception as error:
        print("FAIL DOCX P2 real Chromium: "+str(error),file=sys.stderr)
        raise

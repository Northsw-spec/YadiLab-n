#!/usr/bin/env python3
"""DRAWIO P2 real compiled Chromium; independent synthetic uncompressed diagram bytes."""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu

CANARY="PRIVATE-CUSTOMER-10.44.33.22-DO-NOT-DISPLAY"
def diagram_xml():
    return ('<?xml version="1.0" encoding="UTF-8"?>'
      '<mxfile host="app.diagrams.net" compressed="false">'
      '<diagram id="p1" name="SECRET-PAGE">'+
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      f'<mxCell id="server_secret" vertex="1" parent="1" value="{CANARY}">'
      '<mxGeometry x="10" y="30" width="80" height="45" as="geometry"/></mxCell>'
      '<mxCell id="router_secret" vertex="1" parent="1" value="198.51.100.60"/>'
      '<mxCell id="edge_secret" edge="1" parent="1" source="server_secret" target="router_secret"/>'
      '</root></mxGraphModel></diagram>'
      '<diagram id="p2" name="SECRET-SECOND-PAGE">'
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      '<mxCell id="only_secret" vertex="1" parent="1" value="SECRET_LOCAL"/>'
      '</root></mxGraphModel></diagram></mxfile>').encode("utf-8")
def choose(page,name,data):
    page.locator('[data-drawio-file="true"]').set_input_files({
       "name":name,"mimeType":"application/xml","buffer":data})
def inspect(page):
    menu(page).locator('[data-inspect-drawio="PREVIEW_ONLY"]').click()
    expect(page.locator('[data-drawio-panel="PREVIEW_ONLY"]')).to_be_visible(timeout=15000)
def run(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        valid=diagram_xml()
        inspect(page)
        require(page.locator('[data-drawio-preview]').count()==0,"Must begin empty")
        choose(page,"network.drawio",valid)
        expect(page.locator('[data-drawio-preview="PREVIEW_ONLY"]')).to_be_visible(timeout=20000)
        summary=page.locator('[data-drawio-summary]').inner_text()
        require("Pages: 2" in summary and "vertices: 3" in summary and "edges: 1" in summary,
                "Wrong diagram counts: "+summary)
        require(page.locator('[data-drawio-page="0"]').count()==1 and
                page.locator('[data-drawio-page="1"]').count()==1,
                "Missing page ordinal summaries")
        require(hashlib.sha256(valid).hexdigest() in
                page.locator('[data-drawio-source-sha]').inner_text(),"Wrong original SHA")
        require(page.locator('[data-drawio-activation-status="BLOCKED"]').count()==1,
                "Drawn edges must not auto-activate topology")
        html=page.locator('[data-drawio-panel]').inner_html()
        for text in [CANARY,"SECRET-PAGE","SECRET-SECOND-PAGE",
                     "server_secret","router_secret","edge_secret","198.51.100.60","SECRET_LOCAL"]:
            require(text not in html,"Sensitive diagram source leaked into DOM: "+text)
        # Invalid file replacement must remove a previously valid preview.
        choose(page,"bad.drawio",b'<?xml version="1.0"?><nmaprun scanner="nmap"/>')
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "DRAWIO_ROOT_UNSUPPORTED",timeout=15000)
        require(page.locator('[data-drawio-preview]').count()==0,"Stale valid source survived failure")
        choose(page,"compressed.drawio",b'<mxfile><diagram id="p1">BASE64_DEFLATE_BLOB</diagram></mxfile>')
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "DRAWIO_BASE64_INVALID",timeout=15000)
        require(page.locator('[data-drawio-preview]').count()==0,"Compressed page incorrectly activated")
        choose(page,"xxe.drawio",b'<!DOCTYPE mxfile [<!ENTITY ext SYSTEM "file:///etc/passwd">]><mxfile/>')
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "IMPORT_XML_DTD_FORBIDDEN",timeout=15000)
        choose(page,"false.xml",valid)
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "DRAWIO_FILE_EXTENSION_INVALID",timeout=15000)
        choose(page,"valid.drawio",valid)
        expect(page.locator('[data-drawio-preview="PREVIEW_ONLY"]')).to_be_visible(timeout=15000)
        page.locator('[data-drawio-close="true"]').click()
        expect(page.locator('[data-drawio-panel]')).to_have_count(0,timeout=15000)
        require(export_source(page)==before,"Draw.io inspection mutated canonical Builder")
        check_unchanged(page,scenario,errors,external)
        inspect(page)
        require(page.locator('[data-drawio-preview]').count()==0,
                "Old inspection remained after close/reopen")
        page.locator('[data-drawio-close="true"]').click()
        return {"case":"uncompressed_two_page_private_aggregate_preview",
                "status":"PASS","pages":2,"vertices":3,"edges":1,
                "sourceSha256":hashlib.sha256(valid).hexdigest(),
                "builderUnchanged":True,"externalRequests":0,
                "invalidBase64BlockedConfirmed":True}
    finally:
        page.close()
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
      and u.path=="/" and not u.username and not u.password and not u.query and not u.fragment,
      "Require canonical loopback origin")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[run(browser,args.url)]
        finally:browser.close()
    result={"status":"PASS","kind":"Actual compiled YadiLab Chromium, no diagrams.net installation",
        "platform":"Ubuntu GitHub Actions (not Parrot native)",
        "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"drawio-p1p2-real-chromium.json").write_text(json.dumps(result,indent=2)+"\n")
    print("PASS DRAWIO P2 actual compiled Chromium",flush=True)
    print(json.dumps(result,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL DRAWIO P2 real Chromium "+str(error),file=sys.stderr)
        raise

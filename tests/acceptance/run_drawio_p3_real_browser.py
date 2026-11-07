#!/usr/bin/env python3
"""DRAWIO P3: actual compiled Chromium with independently encoded diagrams.net raw-DEFLATE pages."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote, urlsplit
import zlib

from playwright.sync_api import expect, sync_playwright
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu

CANARY="INTERNAL-IP-10.4.8.12-DO-NOT-RENDER"
ROOT='<mxCell id="0"/><mxCell id="1" parent="0"/>'
def graph(nodes):
    return '<mxGraphModel><root>'+ROOT+nodes+'</root></mxGraphModel>'
def vertex(key, label):
    return f'<mxCell id="{key}" vertex="1" parent="1" value="{label}"/>'
def edge(key,a,b):
    return f'<mxCell id="{key}" edge="1" parent="1" source="{a}" target="{b}"/>'
def compress(xml):
    # Independent Python reference: encodeURIComponent semantics + raw DEFLATE + Base64.
    uri=quote(xml,safe="-_.!~*'()")
    stream=zlib.compressobj(level=9,wbits=-15)
    raw=stream.compress(uri.encode("ascii"))+stream.flush()
    return base64.b64encode(raw).decode("ascii")
def model_a():
    return graph(vertex("internal_server",CANARY)+vertex("secret_switch","198.51.100.84")+
                 edge("secret_link","internal_server","secret_switch"))
def model_b():
    return graph(vertex("private_monitor","CONFIDENTIAL-MONITOR"))
def source(compress_b=False):
    p1=f'<diagram id="page_1" name="SECRET-CUSTOMER-ONE">{compress(model_a())}</diagram>'
    p2=f'<diagram id="page_2" name="SECRET-CUSTOMER-TWO">'+(
        compress(model_b()) if compress_b else model_b())+'</diagram>'
    return ('<?xml version="1.0"?><mxfile host="app.diagrams.net">'+p1+p2+'</mxfile>').encode("utf-8")
def choose(page,filename,data):
    page.locator('[data-drawio-file="true"]').set_input_files({
        "name":filename,"mimeType":"application/xml","buffer":data})
def open_panel(page):
    menu(page).locator('[data-inspect-drawio="PREVIEW_ONLY"]').click()
    expect(page.locator('[data-drawio-panel="PREVIEW_ONLY"]')).to_be_visible(timeout=15000)
def run(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        data=source()
        open_panel(page)
        require(page.locator('[data-drawio-preview]').count()==0,"Must start empty")
        choose(page,"drawn-infrastructure.drawio",data)
        expect(page.locator('[data-drawio-preview="PREVIEW_ONLY"]')).to_be_visible(timeout=25000)
        txt=page.locator('[data-drawio-summary]').inner_text()
        require(all(part in txt for part in
                    ["Pages: 2","vertices: 3","edges: 1","Compressed pages: 1"]),
                "Incorrect mixed compressed/uncompressed summary: "+txt)
        require(hashlib.sha256(data).hexdigest() in
                page.locator('[data-drawio-source-sha]').inner_text(),
                "Wrong original unmodified-byte hash")
        html=page.locator('[data-drawio-panel]').inner_html()
        for private in [CANARY,"10.4.8.12","198.51.100.84","CONFIDENTIAL-MONITOR",
                        "SECRET-CUSTOMER","internal_server","secret_link","private_monitor"]:
            require(private not in html,"Compressed source leaked into DOM: "+private)
        require(page.locator('[data-drawio-activation-status="BLOCKED"]').count()==1,
                "A drawn edge must not activate a network")
        all_pages=source(compress_b=True)
        choose(page,"both-compressed.drawio",all_pages)
        expect(page.locator('[data-drawio-summary]')).to_contain_text("Compressed pages: 2",timeout=25000)
        require(hashlib.sha256(all_pages).hexdigest() in
                page.locator('[data-drawio-source-sha]').inner_text(),
                "All-compressed source hash incorrect")
        choose(page,"broken.drawio",b'<mxfile><diagram id="page1">INVALID--DEFLATE!</diagram></mxfile>')
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "DRAWIO_BASE64_INVALID",timeout=25000)
        require(page.locator('[data-drawio-preview]').count()==0,"Old PASS survived invalid data")
        wrapped='<mxfile><diagram id="page1">'+compress(
            '<!DOCTYPE mxGraphModel [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+model_a())+'</diagram></mxfile>'
        choose(page,"xxe-inside-compressed.drawio",wrapped.encode())
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "IMPORT_XML_DTD_FORBIDDEN",timeout=25000)
        require(page.locator('[data-drawio-preview]').count()==0,"DTD got positive preview")
        inflated='<mxfile><diagram id="page1">'+compress("Z"*(1024*1024+1))+'</diagram></mxfile>'
        choose(page,"zip-bomb.drawio",inflated.encode())
        expect(page.locator('[data-drawio-error="BLOCKED"]')).to_have_text(
            "DRAWIO_INFLATE_LIMIT",timeout=25000)
        require(page.locator('[data-drawio-preview]').count()==0,"Oversized inflate got positive preview")
        choose(page,"valid.drawio",data)
        expect(page.locator('[data-drawio-preview="PREVIEW_ONLY"]')).to_be_visible(timeout=25000)
        page.locator('[data-drawio-close="true"]').click()
        expect(page.locator('[data-drawio-panel]')).to_have_count(0,timeout=15000)
        require(export_source(page)==before,"Compressed draw.io changed canonical Builder")
        check_unchanged(page,scenario,errors,external)
        open_panel(page)
        require(page.locator('[data-drawio-preview]').count()==0,"Old source survived modal re-open")
        page.locator('[data-drawio-close="true"]').click()
        return {"status":"PASS","case":"compiled_chromium_raw_deflate_mixed_all_compressed",
                "pages":2,"vertices":3,"drawnEdges":1,
                "sha256Original":hashlib.sha256(data).hexdigest(),
                "inflationBombRejected":True,"compressedXxeRejected":True,
                "noPrivateText":True,"builderUnchanged":True}
    finally:page.close()
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
            "Only exact YadiLab loopback can be tested")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[run(browser,args.url)]
        finally:browser.close()
    evidence={"status":"PASS","platform":"GitHub Ubuntu actual Chromium (not Parrot)",
        "kind":"Compiled YadiLab raw-DEFLATE .drawio with independent Python generator",
        "cases":cases,"builderOrEngineModified":False}
    (args.evidence_dir/"drawio-p3-compressed-chromium.json").write_text(json.dumps(evidence,indent=2)+"\n")
    print("PASS DRAWIO P3 real compiled Chromium "+cases[0]["case"],flush=True)
    print(json.dumps(evidence,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL DRAWIO P3 actual Chromium "+str(exc),file=sys.stderr)
        raise

#!/usr/bin/env python3
"""Frozen P3c2b real localhost Chromium acceptance, authored before 5k UI code.

Genuine independently authored original DOCX and ODT ZIPs; five thousand
original device rows and five thousand separately original port-paired Links.
This is a real app file-picker → explicit consent → actual Builder → genuine
ReactFlow DOM check, not a JS token test or simulated React/ELK output.
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
    docx_xml,odt_xml,WORD,OPC,TYPES,MAIN,OFFICE_REL,
    ODT_MIME,MANIFEST
)

def device(i): return "dev"+str(i).zfill(6)
def port(i): return "p"+str(i).zfill(6)
PRIVATE_NODE="P3C2_PRIVATE_NODE_CANARY_3701"
PRIVATE_LINK="P3C2_PRIVATE_LINK_CANARY_4901"
P="data-scale-p3c2-"

def original(fmt,invalid=False):
    nodes=[["Device ID","Canonical role","Private Notes"]]
    nodes.extend([[device(i),"network.switch" if i==0 else "endpoint.windows",
                   PRIVATE_NODE+"_"+str(i)] for i in range(5000)])
    links=[["From","To","Source port","Target port","Private Notes"]]
    for i in range(1,5000):
        links.append([device(i),"unknown999" if invalid and i==4999 else device(0),
                      "eth0",port(i),PRIVATE_LINK+"_"+str(i)])
    # Second independently written source row: same pair, different ports.
    links.append([device(1),device(0),"eth1",port(5000),PRIVATE_LINK+"_parallel"])
    require(len(nodes)==len(links)==5001,"Fixture lacks 5000 original rows")
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,"w",compression=zipfile.ZIP_DEFLATED) as z:
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
    return buf.getvalue()

def choose(page,fmt,data):
    menu(page).locator('[data-review-scaled-office-five-thousand-builder="REVIEW_REQUIRED"]').click()
    panel=page.locator('[data-scale-p3c2-panel="REVIEW_REQUIRED"]')
    expect(panel).to_be_visible(timeout=30000)
    expect(panel.locator('[data-scale-p3c2-confirm]')).to_be_disabled()
    panel.locator('[data-scale-p3c2-file="true"]').set_input_files({
      "name":"independent-five-thousand."+fmt,
      "mimeType":"application/octet-stream","buffer":data})
    expect(panel.locator('[data-scale-p3c2-summary="REVIEW_REQUIRED"]')).to_be_visible(timeout=60000)
    require(panel.locator('[data-scale-p3c2-selection-count="0"]').count()==1,
      "P3c2b preapproved original source rows without consent")
    require(device(3401) not in panel.inner_html(),
      "Unselected original source device text disclosed prematurely")
    require(PRIVATE_NODE not in panel.inner_html() and
            PRIVATE_LINK not in panel.inner_html(),
      "Original private source text disclosed prematurely")
    return panel

def consent(panel):
    panel.locator('[data-scale-p3c2-node-table]').select_option("0")
    panel.locator('[data-scale-p3c2-link-table]').select_option("1")
    for key,column in [
      ("node-id",0),("node-role",1),("link-from",0),("link-to",1),
      ("source-port",2),("target-port",3)]:
        panel.locator("[data-scale-p3c2-"+key+"]").select_option(str(column))
    expect(panel.locator("[data-scale-p3c2-confirm]")).to_be_disabled()
    # Fully separate, initially unchecked checkboxes; no 'approve all'.
    for kind in ("node","link"):
        boxes=panel.locator('[data-scale-p3c2-approve-'+kind+'-batch]')
        require(boxes.count()==50,"Expected 50 independent "+kind+" grants")
        require(all(not box.is_checked() for box in boxes.all()),
                "Unexpected default approval of original source data")
    for i in range(50):
        panel.locator('[data-scale-p3c2-approve-node-batch="'+str(i)+'"]').check()
        panel.locator('[data-scale-p3c2-approve-link-batch="'+str(i)+'"]').check()
    expect(panel.locator('[data-scale-p3c2-selection-count="10000"]')).to_be_visible()
    expect(panel.locator("[data-scale-p3c2-confirm]")).to_be_disabled()
    panel.locator("[data-scale-p3c2-approve-model]").check()
    expect(panel.locator("[data-scale-p3c2-confirm]")).to_be_enabled(timeout=15000)

def original_pairs():
    return {
      **{"office_link_t1_r"+str(i):
          (device(i),"eth0",device(0),port(i)) for i in range(1,5000)},
      "office_link_t1_r5000":(device(1),"eth1",device(0),port(5000))
    }

# One atomic DOM read per attempt after actual ReactFlow remount, guarding
# against stale Playwright .all() element handles from separate render frames.
def snapshot(page):
    return page.evaluate("""() => {
      const nodes=[...document.querySelectorAll('.react-flow__node[data-id]')];
      const edges=[...document.querySelectorAll('.react-flow__edge[data-id]')];
      return {nodes:nodes.map(n=>n.getAttribute('data-id')),
        edges:edges.map(e=>{
          const path=e.querySelector('path.react-flow__edge-path.semantic-edge');
          return {id:e.getAttribute('data-id'),pathCount:
            e.querySelectorAll('path.react-flow__edge-path.semantic-edge').length,
            d:path?.getAttribute('d')??null,
            from:path?.getAttribute('data-connection-source')??null,
            sourcePort:path?.getAttribute('data-connection-source-port')??null,
            to:path?.getAttribute('data-connection-target')??null,
            targetPort:path?.getAttribute('data-connection-target-port')??null};
        })};
    }""")

def focused(page,index):
    select=page.locator('[data-scale-p3c2-focus-page]')
    expect(select).to_be_visible(timeout=180000)
    select.select_option(str(index))
    expected_nodes={device(i) for i in range((index-1)*100,index*100)}
    if index!=1: expected_nodes.add(device(0))
    expected_edges=(
      {"office_link_t1_r"+str(i) for i in range(1,100)}|
      {"office_link_t1_r5000"}
      if index==1 else
      {"office_link_t1_r"+str(i) for i in range((index-1)*100,index*100)}
    )
    # Read both sets in one browser turn, not across ReactFlow remounts.
    page.wait_for_function("""args => {
      const n=[...document.querySelectorAll('.react-flow__node[data-id]')];
      const e=[...document.querySelectorAll('.react-flow__edge[data-id]')];
      return n.length===args.n&&e.length===args.e &&
        e.every(x=>x.querySelector('path.react-flow__edge-path.semantic-edge'));
    }""",arg={"n":len(expected_nodes),"e":len(expected_edges)},timeout=180000)
    actual=snapshot(page)
    require(set(actual["nodes"])==expected_nodes and
            len(actual["nodes"])==len(expected_nodes),
            "P3c2b real DOM node ID set mismatch page "+str(index))
    require({x["id"] for x in actual["edges"]}==expected_edges and
            len(actual["edges"])==len(expected_edges),
            "P3c2b DOM omitted, inferred, or collapsed original link")
    truth=original_pairs()
    for edge in actual["edges"]:
        require(edge["pathCount"]==1 and edge["d"] and
                "NaN" not in edge["d"] and "Infinity" not in edge["d"],
                "P3c2b missing or invalid actual source SVG geometry")
        require((edge["from"],edge["sourcePort"],edge["to"],edge["targetPort"])==
                truth[edge["id"]],
                "P3c2b actual SVG original endpoint/port identity changed")
    if index==1:
        require({"office_link_t1_r1","office_link_t1_r5000"}<=expected_edges,
                "Two source-declared parallel port-distinct edges not present")
    return {"page":index,"visibleNodes":len(actual["nodes"]),
            "originalVisibleLinks":len(actual["edges"])}

def assert_source(src):
    require(len(src["resources"])==len(src["connections"])==5000,
      "Actual Builder source lost or added original rows")
    require([r["id"] for r in src["resources"]]==
            [device(i) for i in range(5000)],
            "Original Builder node IDs/order changed")
    truth=original_pairs()
    actual={e["id"]:(e["from"]["resource"],e["from"].get("port"),
                     e["to"]["resource"],e["to"].get("port"))
            for e in src["connections"]}
    require(actual==truth,"Original 5k link IDs or ports changed in Builder")
    require(src["tests"]==[] and
            src["completion"]["path"]=="imported_topology_manual_verification",
            "P3c2b fabricated an Engine/physical network PASS")
    require(PRIVATE_NODE not in json.dumps(src) and
            PRIVATE_LINK not in json.dumps(src),
            "Unselected original private notes reached Builder")

def full_graph(browser,url,fmt):
    page,errors,external=setup(browser,url)
    try:
        panel=choose(page,fmt,original(fmt))
        consent(panel)
        panel.locator('[data-scale-p3c2-confirm]').click()
        expect(page.locator('[data-scale-p3c2-panel]')).to_have_count(0,timeout=240000)
        src=exported_source(page)
        assert_source(src)
        views=[focused(page,i) for i in [1,2,25,50]]
        require(exported_source(page)==src,
                "Changing original row focus modified editable Builder source")
        inp=page.locator('[data-scale-p3c2-exact-id-search]')
        expect(inp).to_be_visible()
        inp.fill(device(4999))
        page.locator('[data-scale-p3c2-exact-id-search-confirm]').click()
        expect(page.locator('[data-scale-p3c2-focus-page]')).to_have_value("50",timeout=180000)
        require(device(4999) in snapshot(page)["nodes"],
                "Last original source device missing after exact-ID focus")
        require(exported_source(page)==src,"Exact-ID search mutated source")
        require(PRIVATE_NODE not in page.content() and PRIVATE_LINK not in page.content(),
                "Private source canaries leaked to UI")
        require(not errors and not external,
                "Unexpected actual browser errors or external network requests")
        return {"format":fmt,"case":"original_5000_5000_exact_dom","status":"PASS",
                "canonicalNodes":5000,"canonicalLinks":5000,
                "views":views,"physicalVerified":False,"engineVerified":False}
    finally: page.close()

def cancel(browser,url,fmt):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=choose(page,fmt,original(fmt))
        consent(panel)
        panel.locator('[data-scale-p3c2-cancel]').click()
        expect(page.locator('[data-scale-p3c2-panel]')).to_have_count(0)
        require(exported_source(page)==before,"Cancel replaced Builder")
        require(not errors and not external,"Cancel caused browser/network errors")
        return {"format":fmt,"case":"cancel_preserves_builder","status":"PASS"}
    finally: page.close()

def missing_endpoint(browser,url):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=choose(page,"docx",original("docx",invalid=True))
        consent(panel)
        panel.locator('[data-scale-p3c2-confirm]').click()
        expect(panel.locator('[data-scale-p3c2-error="BLOCKED"]')).to_be_visible(timeout=240000)
        require(PRIVATE_NODE not in panel.inner_html() and
                PRIVATE_LINK not in panel.inner_html(),"Source private text leaked on block")
        # The error dialog is intentionally modal. Close it before clicking the
        # underlying Builder export menu, rather than bypass pointer safety.
        panel.locator('[data-scale-p3c2-cancel]').click()
        expect(page.locator('[data-scale-p3c2-panel]')).to_have_count(0)
        require(exported_source(page)==before,"Invalid source partially replaced Builder")
        require(not errors and not external,"Invalid source triggered browser/network error")
        return {"format":"docx","case":"unknown_original_endpoint_denied","status":"PASS"}
    finally: page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    addr=urlsplit(args.url)
    require(addr.scheme=="http" and addr.hostname=="127.0.0.1" and
            addr.port is not None and addr.path=="/" and
            not addr.query and not addr.fragment,
            "P3c2b requires the actual isolated mounted localhost app")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:
            cases=[full_graph(browser,args.url,fmt) for fmt in ["docx","odt"]]
            cases.extend([cancel(browser,args.url,"odt"),
                          missing_endpoint(browser,args.url)])
        finally: browser.close()
    report={"kind":"SCALE-001 P3c2b actual mounted 5000/5000 original Office DOM",
            "status":"PASS","cases":cases,
            "physicalNetworkVerified":False,"engineVerified":False,
            "tenThousandDomVerified":False}
    (args.evidence_dir/"scale001-p3c2b-5000-real-dom.json").write_text(
      json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P3c2b actual Chromium original DOCX/ODT 5000/5000 "+
          "editable Builder, bounded pages 1/2/25/50, exact original SVG "+
          "parallel port links, last-node search, cancel and unknown endpoint denial")
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as error:
        print("FAIL SCALE-001 P3c2b mounted original Office 5000/5000: "+str(error),
              file=sys.stderr)
        raise

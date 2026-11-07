#!/usr/bin/env python3
"""SCALE-001 P2b1 FROZEN before production: genuine original Office1000/999
to full editable Builder with real focused ReactFlow DOM, no physical truth.

Original ZIPs here are independently generated using Python zipfile/XML,
NOT the product's ZIP generator or a mocked ReactFlow source.
"""
import argparse
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlsplit
from xml.sax.saxutils import escape
from playwright.sync_api import expect,sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require,menu

WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
OPC="http://schemas.openxmlformats.org/package/2006/relationships"
TYPES="http://schemas.openxmlformats.org/package/2006/content-types"
MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
OFFICE_REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
ODT_MIME="application/vnd.oasis.opendocument.text"
OFFICE="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
TABLE="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
TEXT="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
MANIFEST="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
PRIVATE_NODE="P2B1_PRIVATE_NODE_CANARY_604"
PRIVATE_LINK="P2B1_PRIVATE_LINK_CANARY_719"
device=lambda i:"dev"+str(i).zfill(6)
port=lambda i:"p"+str(i).zfill(6)

def original_rows(bad_endpoint=False):
    nodes=[["Device ID","Device Role","Private Notes"],
           [device(0),"network.switch",PRIVATE_NODE+"_0"]]
    nodes.extend([[device(i),"endpoint.windows",PRIVATE_NODE+"_"+str(i)]
                  for i in range(1,1000)])
    links=[["From","To","Source Port","Target Port","Private Notes"]]
    for i in range(1,1000):
        links.append([device(i),"missing999" if bad_endpoint and i==999 else device(0),
                      "eth0",port(i),PRIVATE_LINK+"_"+str(i)])
    return [nodes,links]

def docx_xml(tables):
    def cell(s):
        return "<w:tc><w:tcPr/><w:p><w:r><w:t>"+escape(s)+"</w:t></w:r></w:p></w:tc>"
    body="".join("<w:tbl><w:tblPr/><w:tblGrid/>"+
        "".join("<w:tr>"+"".join(cell(v) for v in row)+"</w:tr>" for row in rows)+
        "</w:tbl>" for rows in tables)
    return '<w:document xmlns:w="'+WORD+'"><w:body>'+body+"</w:body></w:document>"

def odt_xml(tables):
    def cell(s):
        return '<table:table-cell office:value-type="string"><text:p>'+escape(s)+'</text:p></table:table-cell>'
    result="".join(
        '<table:table table:name="Network'+str(i)+'"><table:table-column/>'+
        "".join("<table:table-row>"+"".join(cell(v) for v in row)+"</table:table-row>" for row in rows)+
        "</table:table>" for i,rows in enumerate(tables))
    return (
        '<office:document-content xmlns:office="'+OFFICE+'" xmlns:table="'+TABLE+'" xmlns:text="'+TEXT+
        '" office:version="1.3"><office:body><office:text>'+result+
        "</office:text></office:body></office:document-content>"
    )

def original(format,bad_endpoint=False):
    rows=original_rows(bad_endpoint)
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED) as z:
        if format=="docx":
            z.writestr("[Content_Types].xml",'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>')
            z.writestr("_rels/.rels",'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+OFFICE_REL+'" Target="word/document.xml"/></Relationships>')
            z.writestr("word/document.xml",docx_xml(rows))
        else:
            z.writestr("mimetype",ODT_MIME,compress_type=zipfile.ZIP_STORED)
            z.writestr("content.xml",odt_xml(rows))
            z.writestr("META-INF/manifest.xml",(
                '<manifest:manifest xmlns:manifest="'+MANIFEST+'" manifest:version="1.3">'+
                '<manifest:file-entry manifest:full-path="/" manifest:media-type="'+ODT_MIME+'"/>'+
                '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
                '</manifest:manifest>'
            ))
    return output.getvalue()

def choose(page,format,raw):
    menu(page).locator('[data-review-scaled-office-thousand-builder="REVIEW_REQUIRED"]').click()
    panel=page.locator('[data-scale-p2b1-panel="REVIEW_REQUIRED"]')
    expect(panel).to_be_visible(timeout=20000)
    expect(panel.locator("[data-scale-p2b1-confirm]")).to_be_disabled()
    panel.locator('[data-scale-p2b1-file="true"]').set_input_files({
      "name":"source-thousand."+format,"mimeType":"application/octet-stream","buffer":raw})
    expect(panel.locator('[data-scale-p2b1-summary="REVIEW_REQUIRED"]')).to_be_visible(timeout=45000)
    require(panel.locator('[data-scale-p2b1-selection-count="0"]').count()==1,
            "P2b1 preapproved original source rows or columns")
    require(device(50) not in panel.inner_html(),"Original device values disclosed before source approval")
    require(PRIVATE_NODE not in panel.inner_html() and PRIVATE_LINK not in panel.inner_html(),
            "Unselected original source canary disclosed")
    return panel

def approve(panel):
    panel.locator("[data-scale-p2b1-node-table]").select_option("0")
    panel.locator("[data-scale-p2b1-link-table]").select_option("1")
    for key,value in [
      ("node-id",0),("node-role",1),
      ("link-from",0),("link-to",1),("source-port",2),("target-port",3)
    ]:
        panel.locator("[data-scale-p2b1-"+key+"]").select_option(str(value))
    expect(panel.locator("[data-scale-p2b1-confirm]")).to_be_disabled()
    for i in range(10):
        panel.locator('[data-scale-p2b1-approve-node-batch="'+str(i)+'"]').check()
        panel.locator('[data-scale-p2b1-approve-link-batch="'+str(i)+'"]').check()
    expect(panel.locator('[data-scale-p2b1-selection-count="1999"]')).to_be_visible()
    expect(panel.locator("[data-scale-p2b1-confirm]")).to_be_disabled()
    panel.locator("[data-scale-p2b1-approve-model]").check()
    expect(panel.locator("[data-scale-p2b1-confirm]")).to_be_enabled(timeout=10000)

def expect_focus(page,page_index):
    focus=page.locator('[data-scale-p2b1-focus-page]')
    expect(focus).to_be_visible(timeout=60000)
    focus.select_option(str(page_index))
    if page_index==1:
        ids={device(i) for i in range(100)}
        expected_indices=range(1,100)
    else:
        ids={device(0)}|{device(i) for i in range((page_index-1)*100,page_index*100)}
        expected_indices=range((page_index-1)*100,page_index*100)
    edge_ids={"office_link_t1_r"+str(i) for i in expected_indices}
    nodes=page.locator(".react-flow__node[data-id]")
    edges=page.locator(".react-flow__edge[data-id]")
    expect(nodes).to_have_count(len(ids),timeout=180000)
    expect(edges).to_have_count(len(edge_ids),timeout=180000)
    require({n.get_attribute("data-id") for n in nodes.all()}==ids,
            "P2b1 actual DOM focus lost/added original source nodes")
    require({x.get_attribute("data-id") for x in edges.all()}==edge_ids,
            "P2b1 actual DOM focus lost/added original source edges")
    for edge in edges.all():
        identity=edge.get_attribute("data-id")
        index=int(identity.rsplit("_r",1)[1])
        path=edge.locator("path.react-flow__edge-path.semantic-edge")
        require(path.count()==1,"Missing source-authored SVG geometry "+identity)
        d=path.get_attribute("d")
        require(bool(d and d.strip()) and "NaN" not in d and "Infinity" not in d,
                "Invalid focused SVG geometry "+identity)
        observed=(path.get_attribute("data-connection-source"),
                  path.get_attribute("data-connection-source-port"),
                  path.get_attribute("data-connection-target"),
                  path.get_attribute("data-connection-target-port"))
        require(observed==(device(index),"eth0",device(0),port(index)),
                "P2b1 SVG endpoint or source port pair changed")
    return {"focusPage":page_index,"drawnNodes":len(ids),"drawnEdges":len(edge_ids)}

def full_graph(browser,url,format):
    page,errors,external=setup(browser,url)
    try:
        panel=choose(page,format,original(format))
        approve(panel)
        panel.locator("[data-scale-p2b1-confirm]").click()
        expect(page.locator("[data-scale-p2b1-panel]")).to_have_count(0,timeout=180000)
        src=exported_source(page)
        require(len(src["resources"])==1000 and len(src["connections"])==999,
                "P2b1 canonical Builder source was silently reduced to focus size")
        require({x["id"] for x in src["resources"]}=={device(i) for i in range(1000)},
                "P2b1 duplicate, missing or invented source IDs")
        require(src["resources"][0]["type"]=="network.switch" and
                all(x["type"]=="endpoint.windows" for x in src["resources"][1:]),
                "P2b1 changed source-declared device role")
        require(src["tests"]==[] and
                src["completion"]["path"]=="imported_topology_manual_verification",
                "P2b1 forged Engine or physical verification")
        expected={
            "office_link_t1_r"+str(i):(device(i),"eth0",device(0),port(i))
            for i in range(1,1000)
        }
        observed={x["id"]:(x["from"]["resource"],x["from"].get("port"),
                           x["to"]["resource"],x["to"].get("port"))
                  for x in src["connections"]}
        require(observed==expected,"P2b1 original 999 exact port pairs changed")
        focus_results=[expect_focus(page,p) for p in (1,2,10)]
        require(exported_source(page)==src,"P2b1 focus projection illegally changed Builder source")
        require(PRIVATE_NODE not in page.content() and PRIVATE_LINK not in page.content(),
                "P2b1 unselected original private text leaked to UI")
        require(not errors and not external,"P2b1 browser errors or outbound requests")
        return {"format":format,"case":"canonical_1000_999_focus_100_101_101",
                "status":"PASS","canonicalNodes":1000,"canonicalLinks":999,
                "focusedViews":focus_results,"physicalVerified":False}
    finally:page.close()

def cancel(browser,url,format):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=choose(page,format,original(format))
        approve(panel)
        panel.locator("[data-scale-p2b1-cancel]").click()
        expect(page.locator("[data-scale-p2b1-panel]")).to_have_count(0,timeout=18000)
        require(exported_source(page)==before,"P2b1 cancel mutated Builder")
        require(not errors and not external,"P2b1 unexpected errors/network cancel")
        return {"format":format,"case":"cancel_preserves_source","status":"PASS"}
    finally:page.close()

def missing_endpoint(browser,url,format):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=choose(page,format,original(format,bad_endpoint=True))
        approve(panel)
        panel.locator("[data-scale-p2b1-confirm]").click()
        expect(panel.locator('[data-scale-p2b1-error="BLOCKED"]')).to_be_visible(timeout=180000)
        require(PRIVATE_NODE not in panel.inner_html() and PRIVATE_LINK not in panel.inner_html(),
                "P2b1 sensitive text in a blocked import")
        panel.locator("[data-scale-p2b1-cancel]").click()
        expect(page.locator("[data-scale-p2b1-panel]")).to_have_count(0,timeout=18000)
        require(exported_source(page)==before,"P2b1 invalid endpoint partially replaced Builder")
        require(not errors and not external,"P2b1 unexpected errors/network invalid endpoint")
        return {"format":format,"case":"missing_endpoint_source_blocked","status":"PASS"}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
    args=p.parse_args()
    address=urlsplit(args.url)
    require(address.scheme=="http" and address.hostname=="127.0.0.1" and
            address.port is not None and address.path=="/" and
            not address.query and not address.fragment,
            "P2b1 must run real isolated localhost Chromium")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:
            flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:
            cases=[]
            for fmt in ["docx","odt"]:
                cases.extend([full_graph(browser,args.url,fmt),
                              cancel(browser,args.url,fmt),
                              missing_endpoint(browser,args.url,fmt)])
        finally:browser.close()
    report={
        "kind":"SCALE-001 P2b1 actual original DOCX/ODT thousand focus",
        "status":"PASS","cases":cases,
        "physicalNetworkTested":False,"fiveThousandDomVerified":False
    }
    (args.evidence_dir/"scale001-p2b1-original-thousand-real-dom.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P2b1 real Chromium: DOCX and ODT exact original 1000/999 Builder, focused real SVG 100/99 and 101/100, cancel and unknown endpoint deny")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL SCALE-001 P2b1 actual Chromium: "+str(error),file=sys.stderr)
        raise

#!/usr/bin/env python3
"""SCALE-001 P2a FROZEN: real compiled Chromium 100 exact original Office nodes, 99 port links.

Source->Builder->drawn ReactFlow DOM is asserted; no simulated DOM or
unproven 1000-device renderer/physical network claim. Source fixtures are
independently built with Python ZIP writer, never through the product reader.
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
OMIME="application/vnd.oasis.opendocument.text"
OFFICE="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
TABLE="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
TEXT="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
MANIFEST="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
CANARY_NODE="PRIVATE_NODE_CANARY_932"
CANARY_LINK="PRIVATE_LINK_CANARY_836"
ident=lambda n:"dev"+str(n).zfill(6)
port=lambda n:"p"+str(n).zfill(6)

def original_rows(invalid=False):
    nodes=[["Device ID","Device Role","Private Notes"],
           [ident(0),"network.switch",CANARY_NODE+"_0"]]
    nodes.extend([[ident(i),"endpoint.windows",CANARY_NODE+"_"+str(i)]
                  for i in range(1,100)])
    links=[["From","To","Source Port","Target Port","Private Notes"]]
    for i in range(1,100):
        links.append([ident(i),"missing999" if invalid and i==99 else ident(0),
                      "eth0",port(i),CANARY_LINK+"_"+str(i)])
    return [nodes,links]

def docx_xml(tables):
    def cell(s):
        return "<w:tc><w:tcPr/><w:p><w:r><w:t>"+escape(s)+"</w:t></w:r></w:p></w:tc>"
    body="".join("<w:tbl><w:tblPr/><w:tblGrid/>"+
        "".join("<w:tr>"+"".join(cell(value) for value in row)+"</w:tr>" for row in rows)+
        "</w:tbl>" for rows in tables)
    return '<w:document xmlns:w="'+WORD+'"><w:body>'+body+"</w:body></w:document>"

def odt_xml(tables):
    def cell(s):
        return '<table:table-cell office:value-type="string"><text:p>'+escape(s)+'</text:p></table:table-cell>'
    tables_xml="".join(
        '<table:table table:name="Network'+str(i)+'"><table:table-column/>'+
        "".join("<table:table-row>"+"".join(cell(value) for value in row)+"</table:table-row>" for row in rows)+
        "</table:table>" for i,rows in enumerate(tables))
    return ('<office:document-content xmlns:office="'+OFFICE+'" xmlns:table="'+TABLE+'" xmlns:text="'+TEXT+
        '" office:version="1.3"><office:body><office:text>'+tables_xml+
        "</office:text></office:body></office:document-content>")

def original(format,invalid=False):
    rows=original_rows(invalid)
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as z:
        if format=="docx":
            z.writestr("[Content_Types].xml",'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>')
            z.writestr("_rels/.rels",'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+OFFICE_REL+'" Target="word/document.xml"/></Relationships>')
            z.writestr("word/document.xml",docx_xml(rows))
        else:
            z.writestr("mimetype",OMIME,compress_type=zipfile.ZIP_STORED)
            z.writestr("content.xml",odt_xml(rows))
            z.writestr("META-INF/manifest.xml",'<manifest:manifest xmlns:manifest="'+MANIFEST+
                '" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="'+OMIME+
                '"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>')
    return out.getvalue()

def choose(page,format,raw):
    menu(page).locator('[data-review-scaled-office-builder="REVIEW_REQUIRED"]').click()
    panel=page.locator('[data-scale-p2a-panel="REVIEW_REQUIRED"]')
    expect(panel).to_be_visible(timeout=16000)
    expect(panel.locator('[data-scale-p2a-confirm]')).to_be_disabled()
    panel.locator('[data-scale-p2a-file="true"]').set_input_files({
        "name":"synthetic-enterprise."+format,"mimeType":"application/octet-stream","buffer":raw})
    expect(panel.locator('[data-scale-p2a-summary="REVIEW_REQUIRED"]')).to_be_visible(timeout=30000)
    require(panel.locator('[data-scale-p2a-selection-count="0"]').count()==1,
            "P2a source preview preapproved unreviewed ranges/columns")
    expect(panel.locator('[data-scale-p2a-confirm]')).to_be_disabled()
    html=panel.inner_html()
    require(CANARY_NODE not in html and CANARY_LINK not in html,
            "Private unselected Office original text leaked into Chromium DOM")
    require(ident(50) not in html,"Original device ID leaked before explicit source disclosure")
    return panel

def approve(panel):
    panel.locator("[data-scale-p2a-node-table]").select_option("0")
    panel.locator("[data-scale-p2a-link-table]").select_option("1")
    for field,value in [
      ("node-id",0),("node-role",1),
      ("link-from",0),("link-to",1),("source-port",2),("target-port",3)
    ]:
        panel.locator('[data-scale-p2a-'+field+']').select_option(str(value))
    expect(panel.locator("[data-scale-p2a-confirm]")).to_be_disabled()
    panel.locator("[data-scale-p2a-approve-range]").check()
    expect(panel.locator("[data-scale-p2a-confirm]")).to_be_disabled()
    panel.locator("[data-scale-p2a-approve-model]").check()
    expect(panel.locator("[data-scale-p2a-confirm]")).to_be_enabled(timeout=10000)

def graph(browser,url,format):
    page,errors,external=setup(browser,url)
    try:
        panel=choose(page,format,original(format))
        approve(panel)
        panel.locator("[data-scale-p2a-confirm]").click()
        expect(page.locator("[data-scale-p2a-panel]")).to_have_count(0,timeout=120000)
        src=exported_source(page)
        require(len(src["resources"])==100,"P2a 100 original devices not retained in Builder")
        require(len(src["connections"])==99,"P2a lost or invented an original link")
        require({v["id"] for v in src["resources"]}=={ident(i) for i in range(100)},
                "Wrong, duplicate or missing original source device IDs")
        require(src["resources"][0]["type"]=="network.switch","Core source role was changed")
        require(all(v["type"]=="endpoint.windows" for v in src["resources"][1:]),
                "Imported host roles not source faithful")
        require(src["tests"]==[],"Unmodeled physical cables self-certified as Engine PASS")
        require(src["completion"]["path"]=="imported_topology_manual_verification",
                "Importer falsely marked topology as manually verified")
        expected={
          "office_link_t1_r"+str(i):(ident(i),"eth0",ident(0),port(i))
          for i in range(1,100)
        }
        observed={v["id"]:(v["from"]["resource"],v["from"].get("port"),
                            v["to"]["resource"],v["to"].get("port"))
                  for v in src["connections"]}
        require(observed==expected,"Original source endpoint/port pairs changed in Builder")
        panelTopo=page.locator(".topology-panel")
        expect(panelTopo).to_have_attribute("data-topology-edge-count","99",timeout=120000)
        nodes=page.locator(".react-flow__node[data-id]")
        edges=page.locator(".react-flow__edge[data-id]")
        expect(nodes).to_have_count(100,timeout=120000)
        expect(edges).to_have_count(99,timeout=120000)
        require({n.get_attribute("data-id") for n in nodes.all()}=={ident(i) for i in range(100)},
                "ReactFlow actual DOM lost source nodes")
        drawn={}
        for edge in edges.all():
            identity=edge.get_attribute("data-id")
            path=edge.locator("path.react-flow__edge-path.semantic-edge")
            require(path.count()==1,"Missing actual SVG geometry on "+str(identity))
            d=path.get_attribute("d")
            require(bool(d and d.strip()) and "NaN" not in d and "Infinity" not in d,
                    "Invalid SVG geometry "+str(identity))
            drawn[identity]=(path.get_attribute("data-connection-source"),
                             path.get_attribute("data-connection-source-port"),
                             path.get_attribute("data-connection-target"),
                             path.get_attribute("data-connection-target-port"))
        require(drawn==expected,"Actual SVG edges differ from original approved port-linked source")
        require(CANARY_NODE not in page.content() and CANARY_LINK not in page.content(),
                "Unselected private source values leaked after Builder projection")
        require(not errors and not external,"Browser errors or outbound requests: "+repr(errors)+repr(external))
        return {"format":format,"case":"100_original_nodes_99_independently_drawn_port_linked_edges",
                "status":"PASS","sourceDevices":100,"sourceLinks":99,"drawnDevices":100,"drawnLinks":99,
                "enginePhysicallyVerified":False}
    finally:page.close()

def cancelled(browser,url,format):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=choose(page,format,original(format))
        approve(panel)
        panel.locator("[data-scale-p2a-cancel]").click()
        expect(page.locator("[data-scale-p2a-panel]")).to_have_count(0,timeout=15000)
        require(exported_source(page)==before,"Cancel silently changed Builder")
        require(not errors and not external,"Unexpected errors/network on cancel")
        return {"format":format,"case":"cancel_preserves_active_builder","status":"PASS"}
    finally:page.close()

def invalid_link(browser,url,format):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        panel=choose(page,format,original(format,invalid=True))
        approve(panel)
        panel.locator("[data-scale-p2a-confirm]").click()
        expect(panel.locator("[data-scale-p2a-error='BLOCKED']")).to_be_visible(timeout=60000)
        require(CANARY_NODE not in panel.inner_html() and CANARY_LINK not in panel.inner_html(),
                "Sensitive source leaked in blocked import")
        # The blocked overlay still captures pointer events, so perform a
        # genuine user cancel before comparing the same live Builder export.
        panel.locator("[data-scale-p2a-cancel]").click()
        expect(page.locator("[data-scale-p2a-panel]")).to_have_count(0,timeout=15000)
        require(exported_source(page)==before,"Invalid endpoint partially replaced Builder")
        require(not errors and not external,"Unexpected errors/network on invalid source")
        return {"format":format,"case":"unknown_source_endpoint_preserves_builder","status":"PASS"}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
    args=p.parse_args()
    parsed=urlsplit(args.url)
    require(parsed.scheme=="http" and parsed.hostname=="127.0.0.1" and
            parsed.port is not None and parsed.path=="/" and
            not parsed.query and not parsed.fragment,"Require real local compiled Chromium")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as play:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=play.chromium.launch(headless=True,args=flags)
        try:
            cases=[]
            for format in ["docx","odt"]:
                cases.extend([graph(browser,args.url,format),
                              cancelled(browser,args.url,format),
                              invalid_link(browser,args.url,format)])
        finally:browser.close()
    report={"kind":"SCALE-001 P2a actual mounted Chromium genuine Office100/99 topology",
            "status":"PASS","cases":cases,"large1000DomVerified":False,"physicalNetworkTested":False}
    (args.evidence_dir/"scale001-p2a-office100-real-dom.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P2a real Chromium: DOCX and ODT actual 100 SVG nodes/99 separate original port-linked SVG paths, cancel, unknown endpoint deny")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL SCALE-001 P2a real Chromium: "+str(exc),file=sys.stderr)
        raise

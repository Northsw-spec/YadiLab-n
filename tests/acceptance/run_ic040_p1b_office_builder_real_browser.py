#!/usr/bin/env python3
"""IC-040 P1b exact compiled Chromium, individual original Office cell Builder decisions."""
import argparse
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_docx_p2_real_browser import make_bytes as docx_bytes, CANARY as DOCX_CANARY, WORD, OPC_REL, OPC_TYPES, OFFICE_REL, MAIN_TYPE
from run_odt_p2_real_browser import make_odt as odt_bytes, CANARY as ODT_CANARY, MIME, OFFICE, TABLE, TEXT, MANIFEST
from run_ic010_p2_shared_xml_real_browser import setup, exported_source, require, menu

def make_changed(original,filename):
    candidates=[]
    for number in "23456789":
        target=("node0"+number).encode()
        out=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(original),"r") as src, zipfile.ZipFile(out,"w") as dest:
            for item in src.infolist():
                body=src.read(item.filename)
                if item.filename==filename:
                    require(b"node01" in body,"Valid original must contain selected node01")
                    body=body.replace(b"node01",target)
                item.extra=b""
                dest.writestr(item,body)
        changed=out.getvalue()
        if len(changed)==len(original) and changed!=original:
            return changed
        candidates.append(len(changed))
    raise AssertionError("Could not produce independent valid same-byte-length Office ZIP "+str(candidates))

def opening(page):
    menu(page).locator('[data-review-office-builder="REVIEW_REQUIRED"]').click()
    expect(page.locator('[data-office-p1b-panel="REVIEW_REQUIRED"]')).to_be_visible(timeout=18000)

def choose(page,ext,data):
    page.locator('[data-office-p1b-file="true"]').set_input_files({
      "name":"reviewed."+ext,"mimeType":"application/octet-stream","buffer":data})
    expect(page.locator('[data-office-p1b-controls="REVIEW_REQUIRED"]')).to_be_visible(timeout=26000)
    require(page.locator('[data-office-p1b-selected-count="0"]').count()==1,
            "Any default node selection must be forbidden")
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "Unconsented Office import enabled")
    for text in [DOCX_CANARY,ODT_CANARY,"node01","Host","Address","<w:t>IP</w:t>"]:
        require(text not in page.locator('[data-office-p1b-panel]').inner_html(),
                "Raw private/original Office cell content leaked into DOM: "+text)

def choose_one(page):
    page.locator('[data-office-p1b-cell-ordinal]').select_option("0:1:0")
    page.locator('[data-office-p1b-add]').click()
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),"Per-cell or global consent absent")
    role=page.locator('[data-office-p1b-role="0:1:0"]')
    role.select_option("network.router")
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),"Role selection implicitly approved cell")
    page.locator('[data-office-p1b-cell-ack="0:1:0"]').check()
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),"Separate modeled acknowledgment absent")
    page.locator('[data-office-p1b-modeled-ack]').check()
    require(page.locator('[data-office-p1b-confirm]').is_enabled(),"Fully consented original node blocked")

def patch_file_reads(page,ext,changed,mode):
    page.evaluate("""({name,changed,mode})=>{
       const original=File.prototype.arrayBuffer;
       const bytes=new Uint8Array(changed);
       window.__ic040_p1b_reads=0;
       window.__ic040_p1b_interrupted=0;
       File.prototype.arrayBuffer=function(){
         if(this.name===name){
           window.__ic040_p1b_reads++;
           if(window.__ic040_p1b_reads>=3 && mode==="swap")
             return Promise.resolve(bytes.buffer.slice(0));
           if(window.__ic040_p1b_reads===3 && mode==="workspace"){
             const button=Array.from(document.querySelectorAll("button"))
               .find(b=>b.textContent?.trim()==="Öppna enterprise i byggläget");
             if(!button || button.disabled) throw new Error("IC040_P1B_WORKSPACE_TRIGGER_MISSING");
             button.click();window.__ic040_p1b_interrupted++;
           }
         }
         return original.call(this);
       };
    }""",{"name":"reviewed."+ext,"changed":list(changed),"mode":mode})

def clean(errors,external):
    require(not errors,"Uncaught actual Chromium errors: "+repr(errors))
    require(not external,"Unexpected outbound browser network request: "+repr(external))

def case_cancel(browser,url,ext,original):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,original);choose_one(page)
        page.locator('[data-office-p1b-cancel]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=12000)
        require(exported_source(page)==before,"Cancel changed current Builder")
        clean(errors,external)
        return {"format":ext,"case":"cancel_without_workspace_changes","status":"PASS"}
    finally:page.close()

def case_success(browser,url,ext,original):
    page,errors,external=setup(browser,url)
    try:
        patch_file_reads(page,ext,original,"count")
        opening(page);choose(page,ext,original);choose_one(page)
        page.locator('[data-office-p1b-confirm]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        require(page.evaluate("window.__ic040_p1b_reads")>=3,
                "Final original re-read must occur after actual compiler and layout")
        src=exported_source(page)
        require(src["scenarioId"]=="office_reviewed","Wrong canonical Builder scenario identity")
        require(len(src["resources"])==1 and src["resources"][0]["id"]=="node01" and
                src["resources"][0]["type"]=="network.router",
                "Only consented original cell and manual role should enter Builder")
        require(src["connections"]==[],"Invented physical links from Office cell")
        require(src["tests"]==[],"Invented Engine probes from Office cell")
        require(src["completion"]["path"]=="office_manual_verification",
                "Unfulfilled independent verification objective missing")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "Office import unexpectedly activated Runtime")
        require(DOCX_CANARY not in json.dumps(src) and ODT_CANARY not in json.dumps(src),
                "Non-selected private Office cell copied into Builder")
        clean(errors,external)
        return {"format":ext,"case":"one_consented_original_node_only_builder","status":"PASS","reread":True}
    finally:page.close()

def case_swap(browser,url,ext,original,changed):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        patch_file_reads(page,ext,changed,"swap")
        opening(page);choose(page,ext,original);choose_one(page)
        page.locator('[data-office-p1b-confirm]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(
            "IC040_P1B_SOURCE_CHANGED",timeout=45000)
        require(page.evaluate("window.__ic040_p1b_reads")>=3,
                "Same-size independent original ZIP mutation was not actually re-read")
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,"Swapped Office ZIP overwrote Builder")
        clean(errors,external)
        return {"format":ext,"case":"valid_same_size_modified_original_rejected","status":"PASS"}
    finally:page.close()

def case_workspace(browser,url,ext,original):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        patch_file_reads(page,ext,original,"workspace")
        opening(page);choose(page,ext,original);choose_one(page)
        page.locator('[data-office-p1b-confirm]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(
            "IC040_P1B_WORKSPACE_CHANGED",timeout=45000)
        require(page.evaluate("window.__ic040_p1b_interrupted")==1,
                "No real competing Builder action triggered during final source read")
        page.locator('[data-office-p1b-cancel]').click()
        src=exported_source(page)
        require(src!=before and src["scenarioId"]!="office_reviewed",
                "Competing latest Builder was replaced by stale Office import")
        clean(errors,external)
        return {"format":ext,"case":"real_competing_builder_change_blocks_old_file","status":"PASS"}
    finally:page.close()

def case_invalid(browser,url,ext,original):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,original);choose_one(page)
        page.locator('[data-office-p1b-file="true"]').set_input_files({
            "name":"invalid."+ext,"mimeType":"application/octet-stream","buffer":b"not a zip!"})
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_be_visible(timeout=20000)
        require(page.locator('[data-office-p1b-controls]').count()==0,
                "Old individual consents survived invalid file replacement")
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,"Invalid Office source changed Builder")
        clean(errors,external)
        return {"format":ext,"case":"invalid_new_zip_clears_old_consents","status":"PASS"}
    finally:page.close()


# P2 uses the same actual compiled Chromium and original-source reread chain.
# An explicitly selected original peer cell is NOT proof of physical cabling.
def make_reviewed_peers(original,part,ext,missing=False,reciprocal=False):
    require(not (missing and reciprocal),"Mutually exclusive source fixture variants")
    second_peer=b"fw01" if reciprocal else b"rt01"
    target=b"ghost" if missing else b"sw01"
    if ext=="docx":
        def xmlcell(value):
            return b"<w:tc><w:tcPr/><w:p><w:r><w:t>"+value+b"</w:t></w:r></w:p></w:tc>"
        additions=b"".join(b"<w:tr>"+xmlcell(a)+xmlcell(b)+b"</w:tr>" for a,b in
                           [(b"sw01",second_peer),(b"rt01",b"")])
        closing=b"</w:tbl>"
        canary=DOCX_CANARY.encode()
    else:
        def xmlcell(value):
            return b'<table:table-cell office:value-type="string"><text:p>'+value+b"</text:p></table:table-cell>"
        additions=b"".join(b"<table:table-row>"+xmlcell(a)+xmlcell(b)+b"</table:table-row>" for a,b in
                           [(b"sw01",second_peer),(b"rt01",b"")])
        closing=b"</table:table>"
        canary=ODT_CANARY.encode()
    out=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original),"r") as src,zipfile.ZipFile(out,"w") as dest:
        for item in src.infolist():
            data=src.read(item.filename)
            if item.filename==part:
                require(b"node01" in data and canary in data and closing in data,
                        "P2 original document must contain exact source rows")
                data=data.replace(b"node01",b"fw01").replace(canary,target)
                data=data.replace(closing,additions+closing,1)
            item.extra=b""
            dest.writestr(item,data)
    return out.getvalue()

def choose_reviewed_peers(page):
    for offset,role in enumerate(["network.firewall","network.switch","network.router"]):
        key="0:"+str(offset+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(key)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+key+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+key+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="3"]')).to_be_visible(timeout=10000)
    for key in ["0:1","1:1"]:
        page.locator('[data-office-p2-peer-choice="true"]').select_option(key)
        page.locator('[data-office-p2-add="true"]').click()
        page.locator('[data-office-p2-peer-ack="'+key+'"]').check()
    expect(page.locator('[data-office-p2-selected-count="2"]')).to_be_visible()
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P2 enabled commit before both independent modeled acknowledgments")
    page.locator('[data-office-p2-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p2_real_links(browser,url,ext,original):
    page,errors,external=setup(browser,url)
    try:
        opening(page);choose(page,ext,original);choose_reviewed_peers(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        require(source["scenarioId"]=="office_reviewed","Wrong Office Builder scenario")
        types={x["id"]:x["type"] for x in source["resources"]}
        require(types=={"fw01":"network.firewall","sw01":"network.switch","rt01":"network.router"},
                "P2 wrong or missing original node IDs/roles")
        pairs={(x["from"]["resource"],x["to"]["resource"]) for x in source["connections"]}
        require(pairs=={("fw01","sw01"),("sw01","rt01")} and len(source["connections"])==2,
                "P2 wrong/extra/silent missing original documented peer link")
        require(all(not x["from"].get("port") and not x["to"].get("port")
                    for x in source["connections"]),"P2 invented source-absent ports")
        require(source["tests"]==[] and source["completion"]["path"]=="office_manual_verification",
                "P2 self-certified Engine PASS from documented peer text")
        panel=page.locator(".topology-panel")
        expect(panel).to_have_attribute("data-topology-edge-count","2",timeout=30000)
        nodes=panel.locator('.react-flow__node[data-id]')
        expect(nodes).to_have_count(3,timeout=30000)
        seen={}
        for i in range(nodes.count()):
            node=nodes.nth(i)
            key=node.get_attribute("data-id")
            shape=node.locator(".resource-node[data-device-family]")
            require(shape.count()==1 and key not in seen,"P2 duplicate or missing drawn node")
            seen[key]=shape.get_attribute("data-device-family")
        require(seen=={"fw01":"firewall","sw01":"switch","rt01":"router"},
                "P2 actual drawn device identities/families wrong")
        edges=panel.locator('.react-flow__edge[data-id]')
        expect(edges).to_have_count(2,timeout=30000)
        actual=set()
        for i in range(edges.count()):
            path=edges.nth(i).locator("path.react-flow__edge-path.semantic-edge")
            require(path.count()==1,"P2 missing drawn SVG edge path")
            require(path.get_attribute("data-connection-kind")=="network","P2 wrong drawn edge kind")
            actual.add((path.get_attribute("data-connection-source"),
                        path.get_attribute("data-connection-target")))
        require(actual==pairs,
                "P2 visible ReactFlow link endpoints differ from document; "+
                "observed="+repr(sorted(actual))+" expected="+repr(sorted(pairs))+
                " edge_elements="+repr([
                    {"id":edge.get_attribute("data-id"),
                     "source":edge.get_attribute("data-source"),
                     "target":edge.get_attribute("data-target"),
                     "path_source":edge.locator("path.semantic-edge").get_attribute("data-connection-source"),
                     "path_target":edge.locator("path.semantic-edge").get_attribute("data-connection-target")}
                    for edge in edges.all()]))
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P2 unexpectedly entered Engine Runtime")
        clean(errors,external)
        return {"format":ext,"case":"actual_drawn_three_nodes_two_source_peer_edges","status":"PASS"}
    finally:page.close()

def case_p2_unknown_peer(browser,url,ext,original):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,original);choose_reviewed_peers(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(
            "IC040_P2_LINK_ENDPOINT_UNKNOWN",timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,"P2 unknown document peer replaced existing Builder")
        clean(errors,external)
        return {"format":ext,"case":"unknown_peer_blocked_workspace_unchanged","status":"PASS"}
    finally:page.close()

def case_p2_reciprocal_peer(browser,url,ext,original):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,original);choose_reviewed_peers(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(
            "IC040_P2_DUPLICATE_CONNECTION",timeout=45000)
        # A rejected modal deliberately remains open and intercepts pointer
        # events; dismiss it before opening the underlying export menu.
        page.locator('[data-office-p1b-cancel]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=12000)
        require(exported_source(page)==before,
                "Reciprocal document declaration silently created two parallel cables")
        clean(errors,external)
        return {"format":ext,"case":"reciprocal_peer_pair_blocked_without_phantom_cable","status":"PASS"}
    finally:page.close()

P3_PRIVATE_CANARY="PRIVATE_PORTS_ORIGINAL_NOT_DISCLOSED_3001"
P3_ROWS=[
    ["Device","Peer","Local Port","Remote Port","Private"],
    ["fw01","sw01","eth0","eth1",P3_PRIVATE_CANARY],
    ["sw01","rt01","eth2","eth0","SECOND_PRIVATE_PORTS_3002"],
    ["rt01","","","","THIRD_PRIVATE_PORTS_3003"],
]

def make_p3_office(ext,rows=None):
    rows=rows or P3_ROWS
    if ext=="docx":
        cell=lambda s:'<w:tc><w:tcPr/><w:p><w:r><w:t>'+s+'</w:t></w:r></w:p></w:tc>'
        body=('<w:document xmlns:w="'+WORD+'"><w:body><w:tbl><w:tblPr/><w:tblGrid/>'+
             ''.join('<w:tr>'+''.join(cell(value) for value in row)+'</w:tr>' for row in rows)+
             '</w:tbl></w:body></w:document>')
        types=('<Types xmlns="'+OPC_TYPES+'"><Override PartName="/word/document.xml" ContentType="'+
               MAIN_TYPE+'"/></Types>')
        rels=('<Relationships xmlns="'+OPC_REL+'"><Relationship Id="rId1" Type="'+
              OFFICE_REL+'" Target="word/document.xml"/></Relationships>')
        out=io.BytesIO()
        with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as package:
            for name,data in [("[Content_Types].xml",types),
                              ("_rels/.rels",rels),("word/document.xml",body)]:
                package.writestr(name,data)
        return out.getvalue()
    cell=lambda s:'<table:table-cell office:value-type="string"><text:p>'+s+'</text:p></table:table-cell>'
    table=('<table:table table:name="Inventory"><table:table-column/>'+
           ''.join('<table:table-row>'+''.join(cell(value) for value in row)+
                   '</table:table-row>' for row in rows)+'</table:table>')
    body=('<office:document-content xmlns:office="'+OFFICE+
          '" xmlns:table="'+TABLE+'" xmlns:text="'+TEXT+
          '" office:version="1.3"><office:body><office:text>'+
          table+'</office:text></office:body></office:document-content>')
    manifest=('<manifest:manifest xmlns:manifest="'+MANIFEST+'" manifest:version="1.3">'+
              '<manifest:file-entry manifest:full-path="/" manifest:media-type="'+MIME+'"/>'+
              '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
              '</manifest:manifest>')
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w") as package:
        info=zipfile.ZipInfo("mimetype",(1980,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_STORED
        info.extra=b""
        package.writestr(info,MIME.encode("ascii"))
        package.writestr("content.xml",body.encode(),compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("META-INF/manifest.xml",manifest.encode(),compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()

def choose_p3_ports(page):
    choose_reviewed_peers(page)
    for index in range(2):
        index_text=str(index)
        page.locator('[data-office-p3-link-choice="true"]').select_option(index_text)
        page.locator('[data-office-p3-source-choice="true"]').select_option("2")
        page.locator('[data-office-p3-peer-choice="true"]').select_option("3")
        page.locator('[data-office-p3-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P3 allowed import before explicit separate port-cell consent")
        page.locator('[data-office-p3-source-ack="'+index_text+'"]').check()
        page.locator('[data-office-p3-peer-ack="'+index_text+'"]').check()
    require(page.locator('[data-office-p3-selected-count="2"]').count()==1,
            "P3 did not review exactly two port pairs")
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P3 missing modeled-port acknowledgment enabled import")
    page.locator('[data-office-p2-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    page.locator('[data-office-p3-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p3_real_ports(browser,url,ext):
    page,errors,external=setup(browser,url)
    try:
        original=make_p3_office(ext)
        opening(page);choose(page,ext,original);choose_p3_ports(page)
        require(P3_PRIVATE_CANARY not in page.locator('[data-office-p1b-panel]').inner_html(),
                "Unselected original port-document private cell was exposed")
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        require({x["id"]:x["type"] for x in source["resources"]}==
                {"fw01":"network.firewall","sw01":"network.switch","rt01":"network.router"},
                "P3 source IDs/roles not source and review accurate")
        ifaces={x["id"]:sorted(i["id"] for i in x.get("interfaces",[]))
                for x in source["resources"]}
        require(ifaces=={"fw01":["eth0"],"sw01":["eth1","eth2"],"rt01":["eth0"]},
                "P3 invented, lost or reassigned port interface IDs")
        actual={c["id"]:(c["from"]["resource"],c["from"].get("port"),
                        c["to"]["resource"],c["to"].get("port"))
                for c in source["connections"]}
        require(len(actual)==2 and set(actual.values())==
                {("fw01","eth0","sw01","eth1"),("sw01","eth2","rt01","eth0")},
                "P3 real Builder source endpoint ports differ from original Office cells")
        require(source["completion"]["path"]=="office_manual_verification" and source["tests"]==[],
                "P3 falsely certified Engine completion or probes")
        require(all(secret not in json.dumps(source) for secret in
                [P3_PRIVATE_CANARY,"SECOND_PRIVATE_PORTS_3002","THIRD_PRIVATE_PORTS_3003"]),
                "P3 copied unreviewed private Office original cell")
        panel=page.locator(".topology-panel")
        expect(panel.locator('.react-flow__node[data-id]')).to_have_count(3,timeout=30000)
        expect(panel.locator('.react-flow__edge[data-id]')).to_have_count(2,timeout=30000)
        seen={}
        for edge in panel.locator('.react-flow__edge[data-id]').all():
            path=edge.locator("path.react-flow__edge-path.semantic-edge")
            require(path.count()==1,"P3 missing actual rendered semantic edge")
            geom=path.get_attribute("d")
            require(bool(geom and geom.strip()) and "NaN" not in geom,
                    "P3 invalid drawn SVG edge geometry")
            seen[edge.get_attribute("data-id")]=(
                path.get_attribute("data-connection-source"),
                path.get_attribute("data-connection-source-port"),
                path.get_attribute("data-connection-target"),
                path.get_attribute("data-connection-target-port"))
        require(seen==actual,"P3 actual ReactFlow SVG port/endpoint identities differ from source")
        handles={(node.get_attribute("data-id"),
                   handle.get_attribute("data-interface-id"))
                 for node in panel.locator('.react-flow__node[data-id]').all()
                 for handle in node.locator('[data-interface-id]').all()}
        require(all((node,port) in handles for node,ports in ifaces.items() for port in ports),
                "P3 actual visible resource node missing original interface handle")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P3 silently activated Engine/Runtime")
        clean(errors,external)
        return {"format":ext,"case":"original_four_ports_two_exact_drawn_endpoints","status":"PASS"}
    finally:page.close()

def case_p3_bad_port(browser,url,ext,mode):
    page,errors,external=setup(browser,url)
    try:
        rows=[list(row) for row in P3_ROWS]
        if mode=="reused":
            rows[2][2]="eth1"
            expected="IC040_P3_PORT_REUSED"
        elif mode=="invalid":
            rows[1][2]="Eth0"
            expected="IC040_P3_PORT_INVALID"
        elif mode=="sensitive":
            rows[1][2]="PASSWORD=canary"
            expected="DOCX_CELL_SENSITIVE_BLOCKED" if ext=="docx" else "ODT_CELL_SENSITIVE_BLOCKED"
        else:raise AssertionError("Unknown P3 fixture "+mode)
        before=exported_source(page)
        opening(page);choose(page,ext,make_p3_office(ext,rows));choose_p3_ports(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(expected,timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,"P3 blocked port decision replaced workspace")
        clean(errors,external)
        return {"format":ext,"case":mode+"_original_port_denied","status":"PASS"}
    finally:page.close()


# P4: source-grounded separate Nodes / Links table rows in real DOCX/ODT.
P4_PRIVATE="PRIVATE_NOT_SELECTED_P4_501"
P4_DEVICES=[
    ["Device","Private"],
    ["sw01",P4_PRIVATE],
    ["fw01","PRIVATE_NOT_SELECTED_P4_502"],
    ["rt01","PRIVATE_NOT_SELECTED_P4_503"],
    ["srv01","PRIVATE_NOT_SELECTED_P4_504"],
]
P4_LINKS=[
    ["From","To","Local Port","Peer Port"],
    ["sw01","fw01","eth1","eth0"],
    ["sw01","rt01","eth2","eth0"],
    ["sw01","srv01","eth3","eth0"],
]

def make_p4_office(ext,links=None,devices=None):
    source_links=links if links is not None else P4_LINKS
    tables=[devices if devices is not None else P4_DEVICES,source_links]
    if ext=="docx":
        cell=lambda value:'<w:tc><w:tcPr/><w:p><w:r><w:t>'+value+'</w:t></w:r></w:p></w:tc>'
        body=('<w:document xmlns:w="'+WORD+'"><w:body>'+
              ''.join('<w:tbl><w:tblPr/><w:tblGrid/>'+
                ''.join('<w:tr>'+''.join(cell(v) for v in row)+'</w:tr>' for row in rows)+
                '</w:tbl>' for rows in tables)+'</w:body></w:document>')
        types=('<Types xmlns="'+OPC_TYPES+'"><Override PartName="/word/document.xml" ContentType="'+
               MAIN_TYPE+'"/></Types>')
        rels=('<Relationships xmlns="'+OPC_REL+'"><Relationship Id="rId1" Type="'+
              OFFICE_REL+'" Target="word/document.xml"/></Relationships>')
        out=io.BytesIO()
        with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as package:
            for name,data in [("[Content_Types].xml",types),
                              ("_rels/.rels",rels),("word/document.xml",body)]:
                package.writestr(name,data)
        return out.getvalue()
    cell=lambda v:'<table:table-cell office:value-type="string"><text:p>'+v+'</text:p></table:table-cell>'
    table_xml=''.join('<table:table table:name="'+("DeviceRows" if i==0 else "LinkRows")+'">'+
      '<table:table-column/>'+
      ''.join('<table:table-row>'+''.join(cell(v) for v in row)+'</table:table-row>' for row in rows)+
      '</table:table>' for i,rows in enumerate(tables))
    body=('<office:document-content xmlns:office="'+OFFICE+
          '" xmlns:table="'+TABLE+'" xmlns:text="'+TEXT+
          '" office:version="1.3"><office:body><office:text>'+
          table_xml+'</office:text></office:body></office:document-content>')
    manifest=('<manifest:manifest xmlns:manifest="'+MANIFEST+'" manifest:version="1.3">'+
              '<manifest:file-entry manifest:full-path="/" manifest:media-type="'+MIME+'"/>'+
              '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'+
              '</manifest:manifest>')
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w") as package:
        info=zipfile.ZipInfo("mimetype",(1980,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_STORED
        info.extra=b""
        package.writestr(info,MIME.encode("ascii"))
        package.writestr("content.xml",body.encode(),compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("META-INF/manifest.xml",manifest.encode(),compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()

def choose_p4_link_rows(page,with_ports=True):
    for offset,role in enumerate(["network.switch","network.firewall","network.router","server.generic"]):
        key="0:"+str(offset+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(key)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+key+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+key+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="4"]')).to_be_visible(timeout=10000)
    for row in range(1,4):
        key="1:"+str(row)
        page.locator('[data-office-p4-row-choice="true"]').select_option(key)
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        if with_ports:
            page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
            page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P4 prematurely enabled source-unreviewed endpoint")
        page.locator('[data-office-p4-from-ack="'+key+'"]').check()
        page.locator('[data-office-p4-to-ack="'+key+'"]').check()
        if with_ports:
            page.locator('[data-office-p4-source-port-ack="'+key+'"]').check()
            page.locator('[data-office-p4-target-port-ack="'+key+'"]').check()
    expect(page.locator('[data-office-p4-count="3"]')).to_be_visible(timeout=10000)
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P4 lacked separate modeled link row consent")
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p4_separate_rows(browser,url,ext,with_ports=True):
    page,errors,external=setup(browser,url)
    try:
        opening(page);choose(page,ext,make_p4_office(ext))
        choose_p4_link_rows(page,with_ports)
        require(P4_PRIVATE not in page.locator('[data-office-p1b-panel]').inner_html(),
                "Unselected private Office text leaked through link-row review UI")
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        require({r["id"]:r["type"] for r in source["resources"]}=={
                "sw01":"network.switch","fw01":"network.firewall",
                "rt01":"network.router","srv01":"server.generic"},
                "P4 missing/retyped actual separate-table nodes")
        expected={("sw01","fw01"),("sw01","rt01"),("sw01","srv01")}
        endpoints={(c["from"]["resource"],c["to"]["resource"]) for c in source["connections"]}
        require(len(source["connections"])==3 and endpoints==expected,
                "P4 source lost or invented independent switch Links rows")
        expected_ports={
            ("sw01","eth1","fw01","eth0"),
            ("sw01","eth2","rt01","eth0"),
            ("sw01","eth3","srv01","eth0"),
        } if with_ports else {
            ("sw01",None,"fw01",None),
            ("sw01",None,"rt01",None),
            ("sw01",None,"srv01",None),
        }
        actual_ports={(c["from"]["resource"],c["from"].get("port"),
                       c["to"]["resource"],c["to"].get("port"))
                      for c in source["connections"]}
        require(actual_ports==expected_ports,"P4 source port IDs mismatched actual original cells")
        require(source["completion"]["path"]=="office_manual_verification" and source["tests"]==[],
                "P4 falsely completed imported topology without modeled Engine verification")
        require(all(row[1] not in json.dumps(source) for row in P4_DEVICES[1:]),
                "P4 copied nonselected private original node cells into Builder")
        panel=page.locator(".topology-panel")
        expect(panel.locator('.react-flow__node[data-id]')).to_have_count(4,timeout=30000)
        visible_families={}
        for drawn in panel.locator('.react-flow__node[data-id]').all():
            element=drawn.locator(".resource-node[data-device-family]")
            require(element.count()==1,"P4 actual rendered node missing visible device family")
            node_id=drawn.get_attribute("data-id")
            require(node_id not in visible_families,"P4 duplicate drawn node ID")
            visible_families[node_id]=element.get_attribute("data-device-family")
        require(visible_families=={
            "sw01":"switch","fw01":"firewall","rt01":"router","srv01":"server"},
            "P4 rendered device types differ from individually reviewed original IDs and roles")
        expect(panel.locator('.react-flow__edge[data-id]')).to_have_count(3,timeout=30000)
        rendered=set()
        for edge in panel.locator('.react-flow__edge[data-id]').all():
            path=edge.locator("path.react-flow__edge-path.semantic-edge")
            require(path.count()==1 and bool(path.get_attribute("d")),
                    "P4 actual rendered link absent or malformed SVG")
            require(path.get_attribute("data-connection-kind")=="network",
                    "P4 rendered connection kind differs from source")
            rendered.add((path.get_attribute("data-connection-source"),
                          path.get_attribute("data-connection-source-port"),
                          path.get_attribute("data-connection-target"),
                          path.get_attribute("data-connection-target-port")))
        require(rendered==expected_ports,
                "P4 actual rendered SVG endpoint/port identities differ from original Links rows; "+
                "observed="+repr(sorted(rendered))+" expected="+repr(sorted(expected_ports)))
        if with_ports:
            handles={(n.get_attribute("data-id"),h.get_attribute("data-interface-id"))
                for n in panel.locator('.react-flow__node[data-id]').all()
                for h in n.locator('[data-interface-id]').all()}
            required={("sw01","eth1"),("sw01","eth2"),("sw01","eth3"),
                ("fw01","eth0"),("rt01","eth0"),("srv01","eth0")}
            require(required.issubset(handles),"P4 actual rendered node port handles absent")
        else:
            require(all(not r.get("interfaces") for r in source["resources"]),
                    "P4 portless selection invented original-unselected interfaces")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P4 modified Engine Runtime instead of only Builder")
        clean(errors,external)
        return {"format":ext,"case":"separate_link_rows_"+("ports" if with_ports else "portless"),
                "status":"PASS"}
    finally:page.close()

def case_p4_blocked_link(browser,url,ext,kind):
    rows=[list(row) for row in P4_LINKS]
    if kind=="unknown":
        rows[2][1]="ghost"
        expected="IC040_P4_LINK_ENDPOINT_UNKNOWN"
    elif kind=="reuse":
        rows[2][2]="eth1"
        expected="IC040_P4_PORT_REUSED"
    elif kind=="secret":
        rows[2][2]="PASSWORD=canary"
        expected=("DOCX_CELL_SENSITIVE_BLOCKED" if ext=="docx"
                  else "ODT_CELL_SENSITIVE_BLOCKED")
    else:raise AssertionError("Unknown P4 negative case")
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,make_p4_office(ext,rows));choose_p4_link_rows(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(expected,timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,
                "P4 failed review must not mutate current Builder")
        clean(errors,external)
        return {"format":ext,"case":"blocked_separate_link_"+kind,"status":"PASS"}
    finally:page.close()


# P5: same original-document semantics, now explicitly six devices / five links.
P5_DEVICES=P4_DEVICES+[
    ["pc01","PRIVATE_P5_NODE_5605"],["pc02","PRIVATE_P5_NODE_5606"]]
P5_LINKS=P4_LINKS+[
    ["sw01","pc01","eth4","eth0"],["sw01","pc02","eth5","eth0"]]
P5_ROLES=[
    "network.switch","network.firewall","network.router","server.generic",
    "endpoint.windows","endpoint.linux"]

def choose_p5_capacity(page):
    page.locator('[data-office-p5-capacity-toggle="true"]').check()
    require(page.locator('[data-office-p1b-selected-count="0"]').count()==1,
            "P5 mode switch retained stale P4 node IDs or consents")
    for i,role in enumerate(P5_ROLES):
        k="0:"+str(i+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(k)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+k+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="6"]')).to_be_visible(timeout=12000)
    for row in range(1,6):
        k="1:"+str(row)
        page.locator('[data-office-p4-row-choice="true"]').select_option(k)
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
        page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P5 permitted committing original cell values without explicit consent")
        for attr in ["from","to","source-port","target-port"]:
            page.locator('[data-office-p4-'+attr+'-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p4-count="5"]')).to_be_visible(timeout=12000)
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P5 global modeled port/link consent missing")
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p5_six_by_five(browser,url,ext):
    page,errors,external=setup(browser,url)
    try:
        opening(page)
        choose(page,ext,make_p4_office(ext,P5_LINKS,P5_DEVICES))
        choose_p5_capacity(page)
        require(all(row[1] not in page.locator('[data-office-p1b-panel]').inner_html()
                    for row in P5_DEVICES[1:]),
                "P5 private original node column was exposed without selection")
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        roles={x["id"]:x["type"] for x in source["resources"]}
        require(roles==dict(zip(["sw01","fw01","rt01","srv01","pc01","pc02"],P5_ROLES)),
                "P5 wrong six original node IDs or assigned roles")
        expected={
            ("sw01","eth1","fw01","eth0"),("sw01","eth2","rt01","eth0"),
            ("sw01","eth3","srv01","eth0"),("sw01","eth4","pc01","eth0"),
            ("sw01","eth5","pc02","eth0"),
        }
        source_links={(x["from"]["resource"],x["from"].get("port"),
                       x["to"]["resource"],x["to"].get("port"))
                      for x in source["connections"]}
        require(len(source["connections"])==5 and source_links==expected,
                "P5 canonical Builder missing or invented source endpoint port connections")
        require(source["completion"]["path"]=="office_manual_verification" and source["tests"]==[],
                "P5 falsely self-certified Engine objectives/probes")
        require(all(row[1] not in json.dumps(source) for row in P5_DEVICES[1:]),
                "P5 copied unreviewed private original cells to exported Builder")
        panel=page.locator(".topology-panel")
        nodes=panel.locator('.react-flow__node[data-id]')
        edges=panel.locator('.react-flow__edge[data-id]')
        expect(nodes).to_have_count(6,timeout=30000)
        expect(edges).to_have_count(5,timeout=30000)
        family={"sw01":"switch","fw01":"firewall","rt01":"router",
                "srv01":"server","pc01":"client","pc02":"client"}
        displayed={}
        handles=set()
        for node in nodes.all():
            n=node.get_attribute("data-id")
            shape=node.locator('.resource-node[data-device-family]')
            require(shape.count()==1,"P5 missing actual ReactFlow resource shape "+str(n))
            displayed[n]=shape.get_attribute("data-device-family")
            handles.update((n,h.get_attribute("data-interface-id"))
                           for h in node.locator('[data-interface-id]').all())
        require(displayed==family,
                "P5 actual drawn node ID/role family not equal six reviewed source nodes; "+
                "actual="+repr(displayed))
        required_handles={("sw01","eth"+str(i)) for i in range(1,6)}
        required_handles.update((id,"eth0") for id in ["fw01","rt01","srv01","pc01","pc02"])
        require(required_handles.issubset(handles),
                "P5 actual ReactFlow interface handles missing source-declared port")
        rendered=set()
        for edge in edges.all():
            p=edge.locator('path.react-flow__edge-path.semantic-edge')
            require(p.count()==1 and bool(p.get_attribute("d")),
                    "P5 real semantic SVG path absent or malformed")
            require(p.get_attribute("data-connection-kind")=="network",
                    "P5 rendered wrong edge kind")
            rendered.add((p.get_attribute("data-connection-source"),
                          p.get_attribute("data-connection-source-port"),
                          p.get_attribute("data-connection-target"),
                          p.get_attribute("data-connection-target-port")))
        require(rendered==expected,
                "P5 actual drawn SVG endpoints and exact port names mismatch original; "+
                "observed="+repr(sorted(rendered))+" expected="+repr(sorted(expected)))
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P5 accidentally entered Engine Runtime")
        clean(errors,external)
        return {"format":ext,"case":"six_nodes_five_exact_source_and_drawn_port_links",
                "status":"PASS"}
    finally:page.close()


# P7: two original rows independently consented for the same unordered
# switch/firewall pair, using entirely separate original port ID cells.
P7_LINKS=[
    ["From","To","Local Port","Peer Port"],
    ["sw01","fw01","eth1","eth0"],
    ["sw01","fw01","eth2","eth1"],
    ["sw01","rt01","eth3","eth0"],
    ["sw01","srv01","eth4","eth0"],
    ["pc01","pc02","eth0","eth0"],
]
P7_EXPECTED={
    ("sw01","eth1","fw01","eth0"),("sw01","eth2","fw01","eth1"),
    ("sw01","eth3","rt01","eth0"),("sw01","eth4","srv01","eth0"),
    ("pc01","eth0","pc02","eth0"),
}

def choose_p7_capacity(page):
    page.locator('[data-office-p7-capacity-toggle="true"]').check()
    require(page.locator('[data-office-p1b-selected-count="0"]').count()==1,
            "P7 profile toggle retained old P4/P5/P6 consents")
    require(not page.locator('[data-office-p5-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p6-capacity-toggle="true"]').is_checked(),
            "P7 incorrectly left earlier capacity profile selected")
    for i,role in enumerate(P5_ROLES):
        k="0:"+str(i+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(k)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+k+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="6"]')).to_be_visible(timeout=12000)
    for row in range(1,6):
        k="1:"+str(row)
        page.locator('[data-office-p4-row-choice="true"]').select_option(k)
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
        page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P7 permitted unapproved endpoint or port cells")
        for attr in ["from","to","source-port","target-port"]:
            page.locator('[data-office-p4-'+attr+'-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p4-count="5"]')).to_be_visible(timeout=12000)
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P7 lacked global modeled link approval")
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p7_parallel(browser,url,ext):
    page,errors,external=setup(browser,url)
    try:
        opening(page)
        choose(page,ext,make_p4_office(ext,P7_LINKS,P5_DEVICES))
        choose_p7_capacity(page)
        require(all(row[1] not in page.locator('[data-office-p1b-panel]').inner_html()
                    for row in P5_DEVICES[1:]),
                "P7 exposed original private source cells in approval UI")
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        roles={x["id"]:x["type"] for x in source["resources"]}
        require(roles==dict(zip(
            ["sw01","fw01","rt01","srv01","pc01","pc02"],P5_ROLES)),
            "P7 lost one of six original IDs or assigned wrong manually approved role")
        actual={(c["from"]["resource"],c["from"].get("port"),
                 c["to"]["resource"],c["to"].get("port"))
                for c in source["connections"]}
        require(len(source["connections"])==5 and actual==P7_EXPECTED,
                "P7 modeled source deduplicated, swapped or fabricated original port links")
        require(len({c["id"] for c in source["connections"]})==5,
                "P7 source links lacked distinct stable connection IDs")
        interfaces={x["id"]:{p["id"] for p in x.get("interfaces",[])}
                    for x in source["resources"]}
        require(interfaces=={
            "sw01":{"eth1","eth2","eth3","eth4"},"fw01":{"eth0","eth1"},
            "rt01":{"eth0"},"srv01":{"eth0"},"pc01":{"eth0"},"pc02":{"eth0"}},
            "P7 source created unreviewed interfaces or removed reviewed parallel ports")
        require(source["tests"]==[] and
                source["completion"]["path"]=="office_manual_verification",
                "P7 falsely self-certified Engine tests or imported Engine PASS")
        require(all(row[1] not in json.dumps(source) for row in P5_DEVICES[1:]),
                "P7 exported a confidential original source cell")
        panel=page.locator(".topology-panel")
        nodes=panel.locator('.react-flow__node[data-id]')
        edges=panel.locator('.react-flow__edge[data-id]')
        expect(nodes).to_have_count(6,timeout=30000)
        expect(edges).to_have_count(5,timeout=30000)
        rendered_roles={}
        handles=set()
        for node in nodes.all():
            n=node.get_attribute("data-id")
            shape=node.locator('.resource-node[data-device-family]')
            require(shape.count()==1,"P7 missing real ReactFlow node shape "+str(n))
            rendered_roles[n]=shape.get_attribute("data-device-family")
            handles.update((n,h.get_attribute("data-interface-id"))
                           for h in node.locator('[data-interface-id]').all())
        require(rendered_roles=={
            "sw01":"switch","fw01":"firewall","rt01":"router",
            "srv01":"server","pc01":"client","pc02":"client"},
            "P7 drawn ReactFlow device roles differ from source")
        expected_handles={(n,p) for n,ports in interfaces.items() for p in ports}
        require(expected_handles.issubset(handles),
                "P7 visual ReactFlow missing one of the two parallel source ports")
        seen_ids=set(); rendered=set(); parallel_paths=[]
        for edge in edges.all():
            edge_id=edge.get_attribute("data-id")
            require(edge_id and edge_id not in seen_ids,
                    "P7 two original parallel rows collapsed to same ReactFlow edge id")
            seen_ids.add(edge_id)
            p=edge.locator('path.react-flow__edge-path.semantic-edge')
            path=p.get_attribute("d") if p.count()==1 else None
            require(path,"P7 actual SVG network path absent or malformed")
            require(p.get_attribute("data-connection-kind")=="network",
                    "P7 SVG connection kind is not a network link")
            exact=(p.get_attribute("data-connection-source"),
                   p.get_attribute("data-connection-source-port"),
                   p.get_attribute("data-connection-target"),
                   p.get_attribute("data-connection-target-port"))
            rendered.add(exact)
            if exact[0]=="sw01" and exact[2]=="fw01":
                parallel_paths.append(path)
        require(len(rendered)==5 and rendered==P7_EXPECTED,
                "P7 actual visible SVG lost or invented a distinct port-parallel link: "+
                repr(rendered))
        require(len(parallel_paths)==2 and len(set(parallel_paths))==2,
                "P7 two actual SVG paths between switch and firewall overlap indistinguishably")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P7 imported real Engine Runtime instead of unverified modeled Builder")
        clean(errors,external)
        return {"format":ext,"case":"p7_five_exact_svg_links_two_parallel_distinct_paths","status":"PASS"}
    finally:page.close()

def case_p7_bad_parallel(browser,url,ext,kind):
    links=[list(row) for row in P7_LINKS]
    if kind=="reversed":
        links[2]=["fw01","sw01","eth0","eth1"]
        code="IC040_P7_DUPLICATE_PORT_PAIR"
    elif kind=="reused":
        links[2][2]="eth1";code="IC040_P4_PORT_REUSED"
    elif kind=="unknown":
        links[5][1]="ghost";code="IC040_P4_LINK_ENDPOINT_UNKNOWN"
    else:raise AssertionError("Unknown P7 negative "+kind)
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,make_p4_office(ext,links,P5_DEVICES))
        choose_p7_capacity(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(code,timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,
                "P7 invalid original link mutated existing Builder before denial")
        clean(errors,external)
        return {"format":ext,"case":"p7_reject_"+kind,"status":"PASS"}
    finally:page.close()

# IC-040 P8 bounded to eight individually selected original device IDs and
# seven original two-port Links rows. Older P7/6/5 roles remain unchanged.
P8_DEVICES=P5_DEVICES+[
    ["ap01","PRIVATE_P8_NODE_5807"],["db01","PRIVATE_P8_NODE_5808"]]
P8_ROLES=P5_ROLES+["network.switch","server.generic"]

# P8: two original rows independently consented for the same unordered
# switch/firewall pair, using entirely separate original port ID cells.
P8_LINKS=[
    ["From","To","Local Port","Peer Port"],
    ["sw01","fw01","eth1","eth0"],
    ["sw01","fw01","eth2","eth1"],
    ["sw01","rt01","eth3","eth0"],
    ["sw01","srv01","eth4","eth0"],
    ["pc01","pc02","eth0","eth0"],
    ["sw01","ap01","eth5","eth0"],
    ["srv01","db01","eth1","eth0"],
]
P8_EXPECTED={
    ("sw01","eth1","fw01","eth0"),("sw01","eth2","fw01","eth1"),
    ("sw01","eth3","rt01","eth0"),("sw01","eth4","srv01","eth0"),
    ("pc01","eth0","pc02","eth0"),
    ("sw01","eth5","ap01","eth0"),
    ("srv01","eth1","db01","eth0"),
}

def choose_p8_capacity(page):
    page.locator('[data-office-p8-capacity-toggle="true"]').check()
    require(page.locator('[data-office-p1b-selected-count="0"]').count()==1,
            "P8 profile toggle retained old P4/P5/P6 consents")
    require(not page.locator('[data-office-p5-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p6-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p7-capacity-toggle="true"]').is_checked(),
            "P8 incorrectly left earlier capacity profile selected")
    for i,role in enumerate(P8_ROLES):
        k="0:"+str(i+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(k)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+k+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="8"]')).to_be_visible(timeout=12000)
    for row in range(1,8):
        k="1:"+str(row)
        page.locator('[data-office-p4-row-choice="true"]').select_option(k)
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
        page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P8 permitted unapproved endpoint or port cells")
        for attr in ["from","to","source-port","target-port"]:
            page.locator('[data-office-p4-'+attr+'-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p4-count="7"]')).to_be_visible(timeout=12000)
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P8 lacked global modeled link approval")
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p8_parallel(browser,url,ext):
    page,errors,external=setup(browser,url)
    try:
        opening(page)
        choose(page,ext,make_p4_office(ext,P8_LINKS,P8_DEVICES))
        choose_p8_capacity(page)
        require(all(row[1] not in page.locator('[data-office-p1b-panel]').inner_html()
                    for row in P8_DEVICES[1:]),
                "P8 exposed original private source cells in approval UI")
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        roles={x["id"]:x["type"] for x in source["resources"]}
        require(roles==dict(zip(
            ["sw01","fw01","rt01","srv01","pc01","pc02","ap01","db01"],P8_ROLES)),
            "P8 lost one of six original IDs or assigned wrong manually approved role")
        actual={(c["from"]["resource"],c["from"].get("port"),
                 c["to"]["resource"],c["to"].get("port"))
                for c in source["connections"]}
        require(len(source["connections"])==7 and actual==P8_EXPECTED,
                "P8 modeled source deduplicated, swapped or fabricated original port links")
        require(len({c["id"] for c in source["connections"]})==7,
                "P8 source links lacked distinct stable connection IDs")
        interfaces={x["id"]:{p["id"] for p in x.get("interfaces",[])}
                    for x in source["resources"]}
        require(interfaces=={
            "sw01":{"eth1","eth2","eth3","eth4","eth5"},
            "fw01":{"eth0","eth1"},"rt01":{"eth0"},
            "srv01":{"eth0","eth1"},"pc01":{"eth0"},"pc02":{"eth0"},
            "ap01":{"eth0"},"db01":{"eth0"}},
            "P8 source created unreviewed interfaces or removed reviewed parallel ports")
        require(source["tests"]==[] and
                source["completion"]["path"]=="office_manual_verification",
                "P8 falsely self-certified Engine tests or imported Engine PASS")
        require(all(row[1] not in json.dumps(source) for row in P8_DEVICES[1:]),
                "P8 exported a confidential original source cell")
        panel=page.locator(".topology-panel")
        nodes=panel.locator('.react-flow__node[data-id]')
        edges=panel.locator('.react-flow__edge[data-id]')
        expect(nodes).to_have_count(8,timeout=30000)
        expect(edges).to_have_count(7,timeout=30000)
        rendered_roles={}
        handles=set()
        for node in nodes.all():
            n=node.get_attribute("data-id")
            shape=node.locator('.resource-node[data-device-family]')
            require(shape.count()==1,"P8 missing real ReactFlow node shape "+str(n))
            rendered_roles[n]=shape.get_attribute("data-device-family")
            handles.update((n,h.get_attribute("data-interface-id"))
                           for h in node.locator('[data-interface-id]').all())
        require(rendered_roles=={
            "sw01":"switch","fw01":"firewall","rt01":"router",
            "srv01":"server","pc01":"client","pc02":"client",
            "ap01":"switch","db01":"server"},
            "P8 drawn ReactFlow device roles differ from source")
        expected_handles={(n,p) for n,ports in interfaces.items() for p in ports}
        require(expected_handles.issubset(handles),
                "P8 visual ReactFlow missing one of the two parallel source ports")
        seen_ids=set(); rendered=set(); parallel_paths=[]
        for edge in edges.all():
            edge_id=edge.get_attribute("data-id")
            require(edge_id and edge_id not in seen_ids,
                    "P8 two original parallel rows collapsed to same ReactFlow edge id")
            seen_ids.add(edge_id)
            p=edge.locator('path.react-flow__edge-path.semantic-edge')
            path=p.get_attribute("d") if p.count()==1 else None
            require(path,"P8 actual SVG network path absent or malformed")
            require(p.get_attribute("data-connection-kind")=="network",
                    "P8 SVG connection kind is not a network link")
            exact=(p.get_attribute("data-connection-source"),
                   p.get_attribute("data-connection-source-port"),
                   p.get_attribute("data-connection-target"),
                   p.get_attribute("data-connection-target-port"))
            rendered.add(exact)
            if exact[0]=="sw01" and exact[2]=="fw01":
                parallel_paths.append(path)
        require(len(rendered)==7 and rendered==P8_EXPECTED,
                "P8 actual visible SVG lost or invented a distinct port-parallel link: "+
                repr(rendered))
        require(len(parallel_paths)==2 and len(set(parallel_paths))==2,
                "P8 two actual SVG paths between switch and firewall overlap indistinguishably")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P8 imported real Engine Runtime instead of unverified modeled Builder")
        clean(errors,external)
        return {"format":ext,"case":"p8_seven_exact_svg_links_two_parallel_distinct_paths","status":"PASS"}
    finally:page.close()

def case_p8_bad_parallel(browser,url,ext,kind):
    links=[list(row) for row in P8_LINKS]
    if kind=="reversed":
        links[2]=["fw01","sw01","eth0","eth1"]
        code="IC040_P7_DUPLICATE_PORT_PAIR"
    elif kind=="reused":
        links[2][2]="eth1";code="IC040_P4_PORT_REUSED"
    elif kind=="unknown":
        links[7][1]="ghost";code="IC040_P4_LINK_ENDPOINT_UNKNOWN"
    else:raise AssertionError("Unknown P8 negative "+kind)
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,make_p4_office(ext,links,P8_DEVICES))
        choose_p8_capacity(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(code,timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,
                "P8 invalid original link mutated existing Builder before denial")
        clean(errors,external)
        return {"format":ext,"case":"p8_reject_"+kind,"status":"PASS"}
    finally:page.close()

# IC-040 P9 bounded to TEN individually reviewed source IDs and NINE
# two-sided-port Links rows. Previous P4-P8 profiles remain independent.
P9_DEVICES=P8_DEVICES+[
    ["nas01","PRIVATE_P9_NODE_5909"],["vpn01","PRIVATE_P9_NODE_5910"]]
P9_ROLES=P8_ROLES+["server.generic","network.router"]

# P9: two original rows independently consented for the same unordered
# switch/firewall pair, using entirely separate original port ID cells.
P9_LINKS=[
    ["From","To","Local Port","Peer Port"],
    ["sw01","fw01","eth1","eth0"],
    ["sw01","fw01","eth2","eth1"],
    ["sw01","rt01","eth3","eth0"],
    ["sw01","srv01","eth4","eth0"],
    ["pc01","pc02","eth0","eth0"],
    ["sw01","ap01","eth5","eth0"],
    ["srv01","db01","eth1","eth0"],
    ["sw01","nas01","eth6","eth0"],
    ["rt01","vpn01","eth1","eth0"],
]
P9_EXPECTED={
    ("sw01","eth1","fw01","eth0"),("sw01","eth2","fw01","eth1"),
    ("sw01","eth3","rt01","eth0"),("sw01","eth4","srv01","eth0"),
    ("pc01","eth0","pc02","eth0"),
    ("sw01","eth5","ap01","eth0"),
    ("srv01","eth1","db01","eth0"),
    ("sw01","eth6","nas01","eth0"),
    ("rt01","eth1","vpn01","eth0"),
}

def choose_p9_capacity(page):
    page.locator('[data-office-p9-capacity-toggle="true"]').check()
    require(page.locator('[data-office-p1b-selected-count="0"]').count()==1,
            "P9 profile toggle retained old P4/P5/P6 consents")
    require(not page.locator('[data-office-p5-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p6-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p7-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p8-capacity-toggle="true"]').is_checked(),
            "P9 incorrectly left earlier capacity profile selected")
    for i,role in enumerate(P9_ROLES):
        k="0:"+str(i+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(k)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+k+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="10"]')).to_be_visible(timeout=12000)
    for row in range(1,10):
        k="1:"+str(row)
        page.locator('[data-office-p4-row-choice="true"]').select_option(k)
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
        page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P9 permitted unapproved endpoint or port cells")
        for attr in ["from","to","source-port","target-port"]:
            page.locator('[data-office-p4-'+attr+'-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p4-count="9"]')).to_be_visible(timeout=12000)
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P9 lacked global modeled link approval")
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p9_parallel(browser,url,ext):
    page,errors,external=setup(browser,url)
    try:
        opening(page)
        choose(page,ext,make_p4_office(ext,P9_LINKS,P9_DEVICES))
        choose_p9_capacity(page)
        require(all(row[1] not in page.locator('[data-office-p1b-panel]').inner_html()
                    for row in P9_DEVICES[1:]),
                "P9 exposed original private source cells in approval UI")
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        roles={x["id"]:x["type"] for x in source["resources"]}
        require(roles==dict(zip(
            ["sw01","fw01","rt01","srv01","pc01","pc02","ap01","db01","nas01","vpn01"],P9_ROLES)),
            "P9 lost one of ten exact original IDs or assigned wrong operator-approved role")
        actual={(c["from"]["resource"],c["from"].get("port"),
                 c["to"]["resource"],c["to"].get("port"))
                for c in source["connections"]}
        require(len(source["connections"])==9 and actual==P9_EXPECTED,
                "P9 modeled source deduplicated, swapped or fabricated original port links")
        require(len({c["id"] for c in source["connections"]})==9,
                "P9 source links lacked distinct stable connection IDs")
        interfaces={x["id"]:{p["id"] for p in x.get("interfaces",[])}
                    for x in source["resources"]}
        require(interfaces=={
            "sw01":{"eth1","eth2","eth3","eth4","eth5","eth6"},
            "fw01":{"eth0","eth1"},"rt01":{"eth0","eth1"},
            "srv01":{"eth0","eth1"},"pc01":{"eth0"},"pc02":{"eth0"},
            "ap01":{"eth0"},"db01":{"eth0"},
            "nas01":{"eth0"},"vpn01":{"eth0"}},
            "P9 source created unreviewed interfaces or removed reviewed parallel ports")
        require(source["tests"]==[] and
                source["completion"]["path"]=="office_manual_verification",
                "P9 falsely self-certified Engine tests or imported Engine PASS")
        require(all(row[1] not in json.dumps(source) for row in P9_DEVICES[1:]),
                "P9 exported a confidential original source cell")
        panel=page.locator(".topology-panel")
        nodes=panel.locator('.react-flow__node[data-id]')
        edges=panel.locator('.react-flow__edge[data-id]')
        expect(nodes).to_have_count(10,timeout=30000)
        expect(edges).to_have_count(9,timeout=30000)
        rendered_roles={}
        handles=set()
        for node in nodes.all():
            n=node.get_attribute("data-id")
            shape=node.locator('.resource-node[data-device-family]')
            require(shape.count()==1,"P9 missing real ReactFlow node shape "+str(n))
            rendered_roles[n]=shape.get_attribute("data-device-family")
            handles.update((n,h.get_attribute("data-interface-id"))
                           for h in node.locator('[data-interface-id]').all())
        require(rendered_roles=={
            "sw01":"switch","fw01":"firewall","rt01":"router",
            "srv01":"server","pc01":"client","pc02":"client",
            "ap01":"switch","db01":"server",
            "nas01":"server","vpn01":"router"},
            "P9 drawn ReactFlow device roles differ from source")
        expected_handles={(n,p) for n,ports in interfaces.items() for p in ports}
        require(expected_handles.issubset(handles),
                "P9 visual ReactFlow missing one of the two parallel source ports")
        seen_ids=set(); rendered=set(); parallel_paths=[]
        for edge in edges.all():
            edge_id=edge.get_attribute("data-id")
            require(edge_id and edge_id not in seen_ids,
                    "P9 two original parallel rows collapsed to same ReactFlow edge id")
            seen_ids.add(edge_id)
            p=edge.locator('path.react-flow__edge-path.semantic-edge')
            path=p.get_attribute("d") if p.count()==1 else None
            require(path,"P9 actual SVG network path absent or malformed")
            require(p.get_attribute("data-connection-kind")=="network",
                    "P9 SVG connection kind is not a network link")
            exact=(p.get_attribute("data-connection-source"),
                   p.get_attribute("data-connection-source-port"),
                   p.get_attribute("data-connection-target"),
                   p.get_attribute("data-connection-target-port"))
            rendered.add(exact)
            if exact[0]=="sw01" and exact[2]=="fw01":
                parallel_paths.append(path)
        require(len(rendered)==9 and rendered==P9_EXPECTED,
                "P9 actual visible SVG lost or invented a distinct port-parallel link: "+
                repr(rendered))
        require(len(parallel_paths)==2 and len(set(parallel_paths))==2,
                "P9 two actual SVG paths between switch and firewall overlap indistinguishably")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P9 imported real Engine Runtime instead of unverified modeled Builder")
        clean(errors,external)
        return {"format":ext,"case":"p9_nine_exact_svg_links_two_parallel_distinct_paths","status":"PASS"}
    finally:page.close()

def case_p9_bad_parallel(browser,url,ext,kind):
    links=[list(row) for row in P9_LINKS]
    if kind=="reversed":
        links[2]=["fw01","sw01","eth0","eth1"]
        code="IC040_P7_DUPLICATE_PORT_PAIR"
    elif kind=="reused":
        links[2][2]="eth1";code="IC040_P4_PORT_REUSED"
    elif kind=="unknown":
        links[9][1]="ghost";code="IC040_P4_LINK_ENDPOINT_UNKNOWN"
    else:raise AssertionError("Unknown P9 negative "+kind)
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,make_p4_office(ext,links,P9_DEVICES))
        choose_p9_capacity(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(code,timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,
                "P9 invalid original link mutated existing Builder before denial")
        clean(errors,external)
        return {"format":ext,"case":"p9_reject_"+kind,"status":"PASS"}
    finally:page.close()

# IC-040 P10 bounded to TWELVE separately consented original IDs and ELEVEN
# original two-sided-port Links rows. Earlier P4-P9 contracts stay unchanged.
P10_DEVICES=P9_DEVICES+[
    ["sw02","PRIVATE_P10_NODE_6011"],["log01","PRIVATE_P10_NODE_6012"]]
P10_ROLES=P9_ROLES+["network.switch","server.generic"]

# P10: two original rows independently consented for the same unordered
# switch/firewall pair, using entirely separate original port ID cells.
P10_LINKS=[
    ["From","To","Local Port","Peer Port"],
    ["sw01","fw01","eth1","eth0"],
    ["sw01","fw01","eth2","eth1"],
    ["sw01","rt01","eth3","eth0"],
    ["sw01","srv01","eth4","eth0"],
    ["pc01","pc02","eth0","eth0"],
    ["sw01","ap01","eth5","eth0"],
    ["srv01","db01","eth1","eth0"],
    ["sw01","nas01","eth6","eth0"],
    ["rt01","vpn01","eth1","eth0"],
    ["sw02","fw01","eth0","eth2"],
    ["sw02","log01","eth1","eth0"],
]
P10_EXPECTED={
    ("sw01","eth1","fw01","eth0"),("sw01","eth2","fw01","eth1"),
    ("sw01","eth3","rt01","eth0"),("sw01","eth4","srv01","eth0"),
    ("pc01","eth0","pc02","eth0"),
    ("sw01","eth5","ap01","eth0"),
    ("srv01","eth1","db01","eth0"),
    ("sw01","eth6","nas01","eth0"),
    ("rt01","eth1","vpn01","eth0"),
    ("sw02","eth0","fw01","eth2"),
    ("sw02","eth1","log01","eth0"),
}

def choose_p10_capacity(page):
    page.locator('[data-office-p10-capacity-toggle="true"]').check()
    require(page.locator('[data-office-p1b-selected-count="0"]').count()==1,
            "P10 profile toggle retained old P4/P5/P6 consents")
    require(not page.locator('[data-office-p5-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p6-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p7-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p8-capacity-toggle="true"]').is_checked() and
            not page.locator('[data-office-p9-capacity-toggle="true"]').is_checked(),
            "P10 incorrectly left earlier capacity profile selected")
    for i,role in enumerate(P10_ROLES):
        k="0:"+str(i+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(k)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+k+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="12"]')).to_be_visible(timeout=12000)
    for row in range(1,12):
        k="1:"+str(row)
        page.locator('[data-office-p4-row-choice="true"]').select_option(k)
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
        page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P10 permitted unapproved endpoint or port cells")
        for attr in ["from","to","source-port","target-port"]:
            page.locator('[data-office-p4-'+attr+'-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p4-count="11"]')).to_be_visible(timeout=12000)
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P10 lacked global modeled link approval")
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p10_parallel(browser,url,ext):
    page,errors,external=setup(browser,url)
    try:
        opening(page)
        choose(page,ext,make_p4_office(ext,P10_LINKS,P10_DEVICES))
        choose_p10_capacity(page)
        require(all(row[1] not in page.locator('[data-office-p1b-panel]').inner_html()
                    for row in P10_DEVICES[1:]),
                "P10 exposed original private source cells in approval UI")
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        roles={x["id"]:x["type"] for x in source["resources"]}
        require(roles==dict(zip(
            ["sw01","fw01","rt01","srv01","pc01","pc02","ap01","db01","nas01","vpn01","sw02","log01"],P10_ROLES)),
            "P10 lost one of twelve exact original IDs or assigned wrong reviewed role")
        actual={(c["from"]["resource"],c["from"].get("port"),
                 c["to"]["resource"],c["to"].get("port"))
                for c in source["connections"]}
        require(len(source["connections"])==11 and actual==P10_EXPECTED,
                "P10 modeled source deduplicated, swapped or fabricated original port links")
        require(len({c["id"] for c in source["connections"]})==11,
                "P10 source links lacked distinct stable connection IDs")
        interfaces={x["id"]:{p["id"] for p in x.get("interfaces",[])}
                    for x in source["resources"]}
        require(interfaces=={
            "sw01":{"eth1","eth2","eth3","eth4","eth5","eth6"},
            "fw01":{"eth0","eth1","eth2"},"rt01":{"eth0","eth1"},
            "srv01":{"eth0","eth1"},"pc01":{"eth0"},"pc02":{"eth0"},
            "ap01":{"eth0"},"db01":{"eth0"},
            "nas01":{"eth0"},"vpn01":{"eth0"},
            "sw02":{"eth0","eth1"},"log01":{"eth0"}},
            "P10 source created unreviewed interfaces or removed reviewed parallel ports")
        require(source["tests"]==[] and
                source["completion"]["path"]=="office_manual_verification",
                "P10 falsely self-certified Engine tests or imported Engine PASS")
        require(all(row[1] not in json.dumps(source) for row in P10_DEVICES[1:]),
                "P10 exported a confidential original source cell")
        panel=page.locator(".topology-panel")
        nodes=panel.locator('.react-flow__node[data-id]')
        edges=panel.locator('.react-flow__edge[data-id]')
        expect(nodes).to_have_count(12,timeout=30000)
        expect(edges).to_have_count(11,timeout=30000)
        rendered_roles={}
        handles=set()
        for node in nodes.all():
            n=node.get_attribute("data-id")
            shape=node.locator('.resource-node[data-device-family]')
            require(shape.count()==1,"P10 missing real ReactFlow node shape "+str(n))
            rendered_roles[n]=shape.get_attribute("data-device-family")
            handles.update((n,h.get_attribute("data-interface-id"))
                           for h in node.locator('[data-interface-id]').all())
        require(rendered_roles=={
            "sw01":"switch","fw01":"firewall","rt01":"router",
            "srv01":"server","pc01":"client","pc02":"client",
            "ap01":"switch","db01":"server",
            "nas01":"server","vpn01":"router",
            "sw02":"switch","log01":"server"},
            "P10 drawn ReactFlow device roles differ from source")
        expected_handles={(n,p) for n,ports in interfaces.items() for p in ports}
        require(expected_handles.issubset(handles),
                "P10 visual ReactFlow missing one of the two parallel source ports")
        seen_ids=set(); rendered=set(); parallel_paths=[]
        for edge in edges.all():
            edge_id=edge.get_attribute("data-id")
            require(edge_id and edge_id not in seen_ids,
                    "P10 two original parallel rows collapsed to same ReactFlow edge id")
            seen_ids.add(edge_id)
            p=edge.locator('path.react-flow__edge-path.semantic-edge')
            path=p.get_attribute("d") if p.count()==1 else None
            require(path,"P10 actual SVG network path absent or malformed")
            require(p.get_attribute("data-connection-kind")=="network",
                    "P10 SVG connection kind is not a network link")
            exact=(p.get_attribute("data-connection-source"),
                   p.get_attribute("data-connection-source-port"),
                   p.get_attribute("data-connection-target"),
                   p.get_attribute("data-connection-target-port"))
            rendered.add(exact)
            if exact[0]=="sw01" and exact[2]=="fw01":
                parallel_paths.append(path)
        require(len(rendered)==11 and rendered==P10_EXPECTED,
                "P10 actual visible SVG lost or invented a distinct port-parallel link: "+
                repr(rendered))
        require(len(parallel_paths)==2 and len(set(parallel_paths))==2,
                "P10 two actual SVG paths between switch and firewall overlap indistinguishably")
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P10 imported real Engine Runtime instead of unverified modeled Builder")
        clean(errors,external)
        return {"format":ext,"case":"p10_eleven_exact_svg_links_two_parallel_distinct_paths","status":"PASS"}
    finally:page.close()

def case_p10_bad_parallel(browser,url,ext,kind):
    links=[list(row) for row in P10_LINKS]
    if kind=="reversed":
        links[2]=["fw01","sw01","eth0","eth1"]
        code="IC040_P7_DUPLICATE_PORT_PAIR"
    elif kind=="reused":
        links[2][2]="eth1";code="IC040_P4_PORT_REUSED"
    elif kind=="unknown":
        links[11][1]="ghost";code="IC040_P4_LINK_ENDPOINT_UNKNOWN"
    else:raise AssertionError("Unknown P10 negative "+kind)
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,make_p4_office(ext,links,P10_DEVICES))
        choose_p10_capacity(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(code,timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,
                "P10 invalid original link mutated existing Builder before denial")
        clean(errors,external)
        return {"format":ext,"case":"p10_reject_"+kind,"status":"PASS"}
    finally:page.close()

# P6: same six documented devices and five original Links rows, but rows
# two and four have no approved port-cell evidence. Never invent these ports.
def choose_p6_optional_ports(page):
    page.locator('[data-office-p6-capacity-toggle="true"]').check()
    require(page.locator('[data-office-p1b-selected-count="0"]').count()==1,
            "P6 profile change retained stale previous source-cell approvals")
    for i,role in enumerate(P5_ROLES):
        k="0:"+str(i+1)+":0"
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(k)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator('[data-office-p1b-role="'+k+'"]').select_option(role)
        page.locator('[data-office-p1b-cell-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p1b-selected-count="6"]')).to_be_visible(timeout=12000)
    for row in range(1,6):
        k="1:"+str(row)
        page.locator('[data-office-p4-row-choice="true"]').select_option(k)
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        if row not in (2,4):
            page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
            page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        require(page.locator('[data-office-p1b-confirm]').is_disabled(),
                "P6 skipped one of the mandatory original endpoint consents")
        attrs=["from","to"]+(["source-port","target-port"] if row not in (2,4) else [])
        for attr in attrs:
            page.locator('[data-office-p4-'+attr+'-ack="'+k+'"]').check()
    expect(page.locator('[data-office-p4-count="5"]')).to_be_visible(timeout=12000)
    require(page.locator('[data-office-p1b-confirm]').is_disabled(),
            "P6 missing global modeled-link consent was incorrectly accepted")
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()
    expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

def case_p6_optional_ports(browser,url,ext):
    page,errors,external=setup(browser,url)
    try:
        opening(page)
        # Actual file contains the port text in every row. P6 selectively
        # authorizes ports for rows 1/3/5, not 2/4.
        choose(page,ext,make_p4_office(ext,P5_LINKS,P5_DEVICES))
        choose_p6_optional_ports(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        expected={
            ("sw01","eth1","fw01","eth0"),
            ("sw01",None,"rt01",None),
            ("sw01","eth3","srv01","eth0"),
            ("sw01",None,"pc01",None),
            ("sw01","eth5","pc02","eth0"),
        }
        identities={x["id"]:x["type"] for x in source["resources"]}
        require(identities==dict(zip(
            ["sw01","fw01","rt01","srv01","pc01","pc02"],P5_ROLES)),
            "P6 exact six reviewed original IDs or manually assigned roles changed")
        actual={(x["from"]["resource"],x["from"].get("port"),
                 x["to"]["resource"],x["to"].get("port"))
                for x in source["connections"]}
        require(actual==expected and len(source["connections"])==5,
                "P6 Builder source lost, swapped or invented a portless/source link")
        interfaces={x["id"]:{i["id"] for i in x.get("interfaces",[])}
                    for x in source["resources"]}
        require(interfaces=={
            "sw01":{"eth1","eth3","eth5"},"fw01":{"eth0"},"rt01":set(),
            "srv01":{"eth0"},"pc01":set(),"pc02":{"eth0"}},
            "P6 original source had unapproved ports or missing approved ports")
        require(source["tests"]==[] and
                source["completion"]["path"]=="office_manual_verification",
                "P6 imported false Engine PASS or automatic modeled probes")
        require(all(x[1] not in json.dumps(source) for x in P5_DEVICES[1:]),
                "P6 disclosed private unselected original device column")
        panel=page.locator(".topology-panel")
        nodes=panel.locator('.react-flow__node[data-id]')
        edges=panel.locator('.react-flow__edge[data-id]')
        expect(nodes).to_have_count(6,timeout=30000)
        expect(edges).to_have_count(5,timeout=30000)
        families={}
        handles=set()
        for node in nodes.all():
            n=node.get_attribute("data-id")
            shape=node.locator('.resource-node[data-device-family]')
            require(shape.count()==1,"P6 missing actual node-role DOM family "+str(n))
            families[n]=shape.get_attribute("data-device-family")
            handles.update((n,h.get_attribute("data-interface-id"))
                           for h in node.locator('[data-interface-id]').all())
        require(families=={"sw01":"switch","fw01":"firewall","rt01":"router",
                          "srv01":"server","pc01":"client","pc02":"client"},
                "P6 real mounted node roles do not match approved source")
        expected_handles={
            ("sw01","eth1"),("sw01","eth3"),("sw01","eth5"),
            ("fw01","eth0"),("srv01","eth0"),("pc02","eth0")}
        require(expected_handles.issubset(handles),
                "P6 visible ReactFlow missing individually approved source port handles")
        require(not {("sw01","eth2"),("sw01","eth4"),
                     ("rt01","eth0"),("pc01","eth0")}.intersection(handles),
                "P6 fabricated unselected original port handles")
        rendered=set()
        for edge in edges.all():
            p=edge.locator('path.react-flow__edge-path.semantic-edge')
            require(p.count()==1 and bool(p.get_attribute("d")),
                    "P6 real SVG network edge is missing")
            require(p.get_attribute("data-connection-kind")=="network",
                    "P6 real SVG connection had incorrect kind")
            rendered.add((p.get_attribute("data-connection-source"),
                          p.get_attribute("data-connection-source-port"),
                          p.get_attribute("data-connection-target"),
                          p.get_attribute("data-connection-target-port")))
        require(rendered==expected,
                "P6 actual SVG node/port endpoints diverged from selected original rows: "+
                repr(rendered))
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
                "P6 import unexpectedly activated Engine Runtime")
        clean(errors,external)
        return {"format":ext,"case":"p6_six_by_five_mixed_approved_and_portless_svg","status":"PASS"}
    finally:page.close()

def case_p5_bad_six_by_five(browser,url,ext,mode):
    links=[list(row) for row in P5_LINKS]
    if mode=="unknown":
        links[5][1]="ghost";code="IC040_P4_LINK_ENDPOINT_UNKNOWN"
    elif mode=="reused":
        links[5][2]="eth1";code="IC040_P4_PORT_REUSED"
    elif mode=="secret":
        links[5][2]="PASSWORD=canary"
        code="DOCX_CELL_SENSITIVE_BLOCKED" if ext=="docx" else "ODT_CELL_SENSITIVE_BLOCKED"
    else:raise AssertionError("Unknown P5 bad fixture "+mode)
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        opening(page);choose(page,ext,make_p4_office(ext,links,P5_DEVICES))
        choose_p5_capacity(page)
        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_contain_text(code,timeout=45000)
        page.locator('[data-office-p1b-cancel]').click()
        require(exported_source(page)==before,
                "P5 failed original source decision overwrote current Builder")
        clean(errors,external)
        return {"format":ext,"case":"six_by_five_"+mode+"_blocked","status":"PASS"}
    finally:page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",type=Path,required=True)
    args=ap.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and
            u.port is not None and u.path=="/" and not u.query and
            not u.fragment and not u.username and not u.password,
            "Only real loopback compiled YadiLab permitted")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:
            cases=[]
            for ext,raw,part in [
                ("docx",docx_bytes(),"word/document.xml"),
                ("odt",odt_bytes(),"content.xml"),
            ]:
                changed=make_changed(raw,part)
                # P2 must use independently valid original ZIPs and real SVG endpoint proof.
                peers=make_reviewed_peers(raw,part,ext)
                unknown=make_reviewed_peers(raw,part,ext,missing=True)
                reciprocal=make_reviewed_peers(raw,part,ext,reciprocal=True)
                # Independent release previously failed here while PR CI passed.
                # Repeat distinct actual browser imports to expose nondeterministic
                # rendered-graph identity, NOT merely static source parity.
                for stability_run in range(4):
                    result=case_p2_real_links(browser,args.url,ext,peers)
                    cases.append({**result,"stability_run":stability_run+1})
                cases.append(case_p2_unknown_peer(browser,args.url,ext,unknown))
                cases.append(case_p3_real_ports(browser,args.url,ext))
                cases.append(case_p4_separate_rows(browser,args.url,ext,True))
                cases.append(case_p5_six_by_five(browser,args.url,ext))
                cases.append(case_p6_optional_ports(browser,args.url,ext))
                cases.append(case_p7_parallel(browser,args.url,ext))
                for p7kind in ["reversed","reused","unknown"]:
                    cases.append(case_p7_bad_parallel(browser,args.url,ext,p7kind))
                cases.append(case_p8_parallel(browser,args.url,ext))
                for p8kind in ["reversed","reused","unknown"]:
                    cases.append(case_p8_bad_parallel(browser,args.url,ext,p8kind))
                cases.append(case_p9_parallel(browser,args.url,ext))
                for p9kind in ["reversed","reused","unknown"]:
                    cases.append(case_p9_bad_parallel(browser,args.url,ext,p9kind))
                cases.append(case_p10_parallel(browser,args.url,ext))
                for p10kind in ["reversed","reused","unknown"]:
                    cases.append(case_p10_bad_parallel(browser,args.url,ext,p10kind))
                for p5mode in ["unknown","reused","secret"]:
                    cases.append(case_p5_bad_six_by_five(browser,args.url,ext,p5mode))
                cases.append(case_p4_separate_rows(browser,args.url,ext,False))
                for p4kind in ["unknown","reuse","secret"]:
                    cases.append(case_p4_blocked_link(browser,args.url,ext,p4kind))
                for mode in ["reused","invalid","sensitive"]:
                    cases.append(case_p3_bad_port(browser,args.url,ext,mode))
                cases.append(case_p2_reciprocal_peer(browser,args.url,ext,reciprocal))
                for run in [
                    lambda:case_cancel(browser,args.url,ext,raw),
                    lambda:case_success(browser,args.url,ext,raw),
                    lambda:case_swap(browser,args.url,ext,raw,changed),
                    lambda:case_workspace(browser,args.url,ext,raw),
                    lambda:case_invalid(browser,args.url,ext,raw),
                ]:
                    cases.append(run())
        finally:browser.close()
    report={"status":"PASS","kind":"IC-040 P1b actual compiled Chromium reviewed Office nodes",
      "platform":"GitHub Actions Ubuntu; Parrot and physical network NOT_RUN",
      "cases":cases,"runtimeActivated":False,"physicalTopologyVerified":False}
    (args.evidence_dir/"ic040-p1b-office-builder-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS IC-040 P1b actual compiled Chromium DOCX/ODT original-cell consent, final reread and live Builder race denial")
    print("PASS IC-040 P2 actual compiled Chromium DOCX/ODT exact SVG peer links, unknown and reciprocal peer duplicates blocked")
    print("PASS IC-040 P3 actual DOCX/ODT Chromium source, port handles, exact drawn endpoint port identities and negative denial")
    print("PASS IC-040 P4 actual compiled DOCX/ODT separate Links rows, three switch links, source/rendered endpoints/ports and no-guess negatives")
    print("PASS IC-040 P5 actual compiled DOCX/ODT six source-selected devices/five source-declared links, exact rendered role/port/endpoint SVG parity and block cases")
    print("PASS IC-040 P6 actual compiled DOCX/ODT six exact source devices/five links, selected versus portless real SVG endpoint parity")
    print("PASS IC-040 P7 actual compiled DOCX/ODT six typed nodes and five exact SVG links, two port-distinct visible parallel paths and negative denials")
    print("PASS IC-040 P8 actual compiled DOCX/ODT eight typed nodes/seven original SVG links with two distinct parallel paths and conflict denials")
    print("PASS IC-040 P9 actual compiled DOCX/ODT TEN exact typed nodes/NINE original SVG links, two different port-parallel SVG paths and conflict denials")
    print("PASS IC-040 P10 actual compiled DOCX/ODT TWELVE typed nodes/ELEVEN original SVG links, two distinct port-parallel SVG paths and conflict denials")
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL IC-040 P1b real compiled Chromium: "+str(exc),file=sys.stderr)
        raise

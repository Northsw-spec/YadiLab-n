#!/usr/bin/env python3
"""AUDIT-007 P9: real mounted Chromium, exact source -> visible topology parity."""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup, exported_source, require

SOURCE="\n".join((
    "Asset ID,Hostname,Device Type,IP Address,Connected To,Default Gateway",
    "fw01,Edge Firewall,Firewall,10.42.0.1,rt01,",
    "rt01,WAN Router,Router,10.42.0.2,sw01,",
    "sw01,Core Switch,Switch,10.42.0.3,,",
    "srv01,File Server,Server,10.42.0.10,sw01,",
    "win01,Office Windows,Windows,10.42.0.20,sw01,10.42.0.2",
    "lnx01,Linux Workstation,Linux,10.42.0.21,sw01,",
))+"\n"
ISOLATED="\n".join((
    "Asset ID,Hostname,Device Type,IP Address,Default Gateway",
    "sw01,Isolated Switch,Switch,10.7.1.2,10.7.1.1",
    "rt01,Isolated Router,Router,10.7.1.1,",
))+"\n"
INVALID="\n".join((
    "Asset ID,Hostname,Device Type,Connected To",
    "sw01,Main Switch,Switch,missing01",
))+"\n"
ROLES={
    "fw01":("network.firewall","firewall","Edge Firewall"),
    "rt01":("network.router","router","WAN Router"),
    "sw01":("network.switch","switch","Core Switch"),
    "srv01":("server.generic","server","File Server"),
    "win01":("endpoint.windows","client","Office Windows"),
    "lnx01":("endpoint.linux","client","Linux Workstation"),
}
PEERS={("fw01","rt01"),("rt01","sw01"),("srv01","sw01"),
       ("win01","sw01"),("lnx01","sw01")}

def pick(page,contents):
    with page.expect_file_chooser(timeout=15000) as openfile:
        page.locator('[data-network-import-primary="true"]').click()
    openfile.value.set_files({"name":"documented-network.csv","mimeType":"text/csv",
                              "buffer":contents.encode("utf-8")})
    expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=30000)
    return page.locator('[data-network-import-preview]')

def activate(page):
    expect(page.locator('[data-network-import-activate]')).to_be_enabled(timeout=30000)
    page.locator('[data-network-import-activate]').click()
    expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash")=="builder",
            "Import falsely activated Runtime/Engine instead of editable Builder")
    source=exported_source(page)
    require(source["scenarioId"]=="imported_network","Wrong imported ScenarioSource identity")
    return source

def dom_snapshot(page,expected_count):
    panel=page.locator(".topology-panel")
    expect(panel).to_have_attribute("data-topology-edge-count",str(expected_count),timeout=30000)
    expect(page.locator(".react-flow__edge[data-id]")).to_have_count(expected_count,timeout=30000)
    return panel

def clean(errors,external):
    require(not errors,"Unexpected compiled Chromium page errors: "+repr(errors))
    require(not external,"Unexpected external browser requests: "+repr(external))

def connected(browser,url):
    page,errors,external=setup(browser,url)
    try:
        preview=pick(page,SOURCE)
        expect(preview).to_have_attribute("data-network-import-preview","READY",timeout=30000)
        require("Devices: 6" in preview.inner_text() and "Explicit links: 5" in preview.inner_text(),
                "Six source devices / five explicit links were not recognized")
        source=activate(page)
        role_ids={r["id"]:(r["type"],r["label"]) for r in source["resources"]}
        require(role_ids=={id:(t,label) for id,(t,f,label) in ROLES.items()},
                "Real Builder lost or changed source node IDs, labels or roles")
        source_links={e["id"]:(e["from"]["resource"],e["to"]["resource"]) for e in source["connections"]}
        require(len(source_links)==5 and set(source_links.values())==PEERS,
                "Real Builder lost, swapped or invented a documented source link")
        require(not any(e["from"].get("port") or e["to"].get("port") for e in source["connections"]),
                "Unsupported original CSV source must not invent interface ports")
        panel=dom_snapshot(page,5)
        dom_nodes=panel.locator('.react-flow__node[data-id]')
        expect(dom_nodes).to_have_count(6,timeout=30000)
        seen={}
        for i in range(dom_nodes.count()):
            node=dom_nodes.nth(i)
            identity=node.get_attribute("data-id")
            require(identity not in seen,"Duplicate rendered node "+str(identity))
            shape=node.locator(".resource-node[data-device-family]")
            require(shape.count()==1,"Rendered node missing device family "+str(identity))
            seen[identity]={"family":shape.get_attribute("data-device-family"),
                            "label":shape.locator(".device-identity strong").inner_text().strip()}
            bounds=node.bounding_box()
            require(bounds is not None and bounds["width"]>0 and bounds["height"]>0,
                    "A declared imported node has no drawn box: "+str(identity))
        require(set(seen)==set(ROLES),"Rendered node identities differ from original source")
        for identity,(_,family,label) in ROLES.items():
            require(seen[identity]=={"family":family,"label":label},
                    "Wrong rendered icon class or name for "+identity+": "+repr(seen[identity]))
        dom_edges=panel.locator(".react-flow__edge[data-id]")
        seen_edges={}
        for i in range(dom_edges.count()):
            edge=dom_edges.nth(i)
            identity=edge.get_attribute("data-id")
            require(identity not in seen_edges,"Duplicate rendered semantic edge "+str(identity))
            path=edge.locator("path.react-flow__edge-path.semantic-edge")
            require(path.count()==1,"No actual drawn semantic path: "+str(identity))
            geom=path.get_attribute("d")
            require(bool(geom and geom.strip()) and "NaN" not in geom,
                    "Missing/invalid actual SVG edge geometry: "+str(identity))
            require(path.get_attribute("data-link-enabled")=="true",
                    "Documented link was drawn disabled: "+str(identity))
            require(path.get_attribute("data-connection-kind")=="network",
                    "Documented network link rendered with wrong semantic kind")
            source_id=path.get_attribute("data-connection-source")
            target_id=path.get_attribute("data-connection-target")
            require(source_id is not None and target_id is not None,
                    "DOM edge does not expose its actual ReactFlow endpoints: "+str(identity))
            seen_edges[identity]=(source_id,target_id)
        require(seen_edges==source_links,
                "Actual drawn ReactFlow edge IDs/endpoints differ from original CSV: "
                +repr(seen_edges)+" vs "+repr(source_links))
        displayed=panel.get_attribute("data-topology-edge-ids")
        require(set(filter(None,displayed.split(",")))==set(source_links),
                "Graph panel's edge-identity ledger diverged from the drawn SVG edges")
        clean(errors,external)
        return {"case":"six_source_devices_five_exact_drawn_links","status":"PASS",
                "ids":sorted(seen),"roles":seen,"edges":seen_edges,
                "physicalNetworkTested":False}
    finally:
        page.close()

def disconnected(browser,url):
    page,errors,external=setup(browser,url)
    try:
        preview=pick(page,ISOLATED)
        expect(preview).to_have_attribute("data-network-import-preview","READY")
        require("Devices: 2" in preview.inner_text() and "Explicit links: 0" in preview.inner_text(),
                "Intentionally isolated inventory silently created a link")
        source=activate(page)
        require(set(r["id"] for r in source["resources"])=={"sw01","rt01"},
                "Isolated network lost nodes")
        require(source["connections"]==[],"Source invented physical cables from gateway")
        panel=dom_snapshot(page,0)
        expect(panel.locator(".react-flow__node[data-id]")).to_have_count(2,timeout=30000)
        require(panel.get_attribute("data-topology-edge-ids")=="","No source edge means no UI edge ID")
        require(panel.locator(".react-flow__edge").count()==0,"Phantom SVG cable drawn from gateway")
        clean(errors,external)
        return {"case":"two_isolated_nodes_zero_drawn_links","status":"PASS"}
    finally:
        page.close()

def invalid(browser,url):
    page,errors,external=setup(browser,url)
    try:
        before=exported_source(page)
        preview=pick(page,INVALID)
        expect(preview).to_have_attribute("data-network-import-preview","BLOCKED")
        require("WORKBOOK_LINK_ENDPOINT_UNKNOWN" in preview.inner_text(),
                "Missing source endpoint was not diagnosed")
        require(not page.locator('[data-network-import-activate]').is_enabled(),
                "Missing source link endpoint allowed Builder replacement")
        page.get_by_role("button",name="Close network import").click()
        require(exported_source(page)==before,
                "Failed import silently changed the active Builder")
        clean(errors,external)
        return {"case":"missing_source_endpoint_preserves_builder","status":"PASS"}
    finally:
        page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",type=Path,required=True)
    args=ap.parse_args()
    endpoint=urlsplit(args.url)
    require(endpoint.scheme=="http" and endpoint.hostname=="127.0.0.1"
            and endpoint.port is not None and endpoint.path=="/"
            and not endpoint.query and not endpoint.fragment,
            "Only actual local compiled Chromium is an accepted test endpoint")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:
            cases=[connected(browser,args.url),disconnected(browser,args.url),
                   invalid(browser,args.url)]
        finally:
            browser.close()
    result={"kind":"AUDIT-007 P9 real compiled Chromium source-to-drawn-topology fidelity",
            "status":"PASS","cases":cases,"physicalCablingVerified":False}
    (args.evidence_dir/"audit007-p9-rendered-topology-parity.json").write_text(
        json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print("PASS AUDIT-007 P9 actual Chromium: 6 drawn device identities and roles, "
          "5 exact drawn SVG link endpoints, isolated zero-link graph, unknown peer BLOCKED")
    print(json.dumps(result,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL AUDIT-007 P9 real Chromium: "+str(error),file=sys.stderr)
        raise

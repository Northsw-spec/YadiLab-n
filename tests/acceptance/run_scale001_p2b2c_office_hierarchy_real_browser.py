#!/usr/bin/env python3
"""SCALE-001 P2b2C independently frozen real Chromium acceptance.
Real original DOCX/ODT 1000/999 approved Builder, user-authorized geography,
site→building→floor graph drilling, original port-pair ledger, cross-site
ID search, and immutable Builder exports. No fake Engine/physical PASS.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect,sync_playwright,TimeoutError as PlaywrightTimeoutError
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require
from run_scale001_p2b1_office_1000_real_browser import (
    choose,approve,original,device,port,PRIVATE_NODE,PRIVATE_LINK,
    expect_focus
)
from run_scale001_p2b2b_office_hierarchy_real_browser import add_definition

def assert_dom(page,expected_nodes,expected_links):
    """Atomically await exact node/edge IDs and semantic SVG port links.

    The source-backed hierarchy label can render before its remounted ReactFlow
    finishes drawing. Counts alone are not sufficient; separate locator calls
    can observe different DOM generations. A missing or wrong edge cannot pass.
    """
    wanted={"nodes":sorted(expected_nodes),"edges":sorted(expected_links)}
    atomic_check="""(target) => {
      const nodeIds=[...document.querySelectorAll(".react-flow__node[data-id]")]
        .map(node=>node.getAttribute("data-id")).sort();
      const edges=[...document.querySelectorAll(".react-flow__edge[data-id]")]
        .map(node=>{
          const paths=node.querySelectorAll("path.react-flow__edge-path.semantic-edge");
          const path=paths.length===1?paths[0]:null;
          return {
            id:node.getAttribute("data-id"),
            pathCount:paths.length,
            d:path?.getAttribute("d")??null,
            source:path?.getAttribute("data-connection-source")??null,
            sourcePort:path?.getAttribute("data-connection-source-port")??null,
            target:path?.getAttribute("data-connection-target")??null,
            targetPort:path?.getAttribute("data-connection-target-port")??null
          };
        });
      const ids=edges.map(edge=>edge.id).sort();
      const projected=document.querySelector("[data-topology-edge-ids]")
        ?.getAttribute("data-topology-edge-ids")??null;
      if(JSON.stringify(nodeIds)!==JSON.stringify(target.nodes) ||
         JSON.stringify(ids)!==JSON.stringify(target.edges) ||
         projected!==target.edges.join(",") ||
         edges.some(edge=>edge.pathCount!==1 ||
           !edge.d?.trim() || edge.d.includes("NaN") ||
           edge.d.includes("Infinity")))return false;
      return {nodeIds,edges,projected};
    }"""
    try:
        # One JS task produces an immutable DOM snapshot. No count-only PASS.
        snapshot=page.wait_for_function(
            atomic_check,arg=wanted,timeout=180000,polling=100
        ).json_value()
    except PlaywrightTimeoutError as cause:
        actual=page.evaluate("""() => ({
          nodes:[...document.querySelectorAll(".react-flow__node[data-id]")]
            .map(node=>node.getAttribute("data-id")).sort(),
          edges:[...document.querySelectorAll(".react-flow__edge[data-id]")]
            .map(node=>node.getAttribute("data-id")).sort(),
          projection:document.querySelector("[data-topology-edge-ids]")
            ?.getAttribute("data-topology-edge-ids")??null
        })""")
        raise AssertionError(
            "P2b2C exact real ReactFlow source/DOM identity never mounted; "
            +"observed="+repr(actual)+"; expected="+repr(wanted)
        ) from cause
    require(snapshot["nodeIds"]==wanted["nodes"],
            "P2b2C real ReactFlow device IDs differ from approved originals")
    require(sorted(x["id"] for x in snapshot["edges"])==wanted["edges"],
            "P2b2C real ReactFlow source-bound edge IDs differ")
    require(snapshot["projected"]==",".join(wanted["edges"]),
            "P2b2C mounted edges diverge from original source projection")
    for edge in snapshot["edges"]:
        link_id=edge["id"]
        i=int(link_id.rsplit("_r",1)[1])
        require(edge["pathCount"]==1 and
                bool(edge["d"] and edge["d"].strip()) and
                "NaN" not in edge["d"] and "Infinity" not in edge["d"],
                "P2b2C missing or invalid semantic SVG path for "+link_id)
        observed=(edge["source"],edge["sourcePort"],
                  edge["target"],edge["targetPort"])
        require(observed==(device(i),"eth0",device(0),port(i)),
                "P2b2C exact source/target port quartet changed: "+link_id)


def select_and_verify(page,kind,identifier,ids,edges):
    page.locator("[data-scale-p2b2-"+kind+"-select]").select_option(identifier)
    expected=page.locator(
        '[data-scale-p2b2-focus-kind="'+kind+'"][data-scale-p2b2-focus-id="'+identifier+'"]')
    expect(expected).to_be_visible(timeout=180000)
    assert_dom(page,ids,edges)
    require(expected.get_attribute("data-scale-p2b2-physical")=="false",
            "P2b2C site membership was promoted to real physical topology PASS")

def scenario(browser,url,fmt):
    page,errors,external=setup(browser,url)
    try:
        p=choose(page,fmt,original(fmt))
        approve(p)
        p.locator("[data-scale-p2b1-confirm]").click()
        expect(page.locator("[data-scale-p2b1-panel]")).to_have_count(0,timeout=180000)
        original_source=exported_source(page)
        require(len(original_source["resources"])==1000 and
                len(original_source["connections"])==999,"P2b2C original Builder missing")
        hierarchy=page.locator('[data-scale-p2b2-summary="READY_FOR_PRESENTATION"]')
        require(hierarchy.count()==0,"P2b2C geography invented before user approval")
        page.locator("[data-scale-p2b2-open]").click()
        panel=page.locator('[data-scale-p2b2-panel="REVIEW_REQUIRED"]')
        expect(panel).to_be_visible()
        for suffix in ("a","b"):
            add_definition(panel,"site","site_"+suffix,"USER CAMPUS "+suffix.upper())
        for suffix in ("a","b"):
            add_definition(panel,"building","building_"+suffix,
                           "USER BUILDING "+suffix.upper(),"site_"+suffix)
        for suffix in ("a","b"):
            add_definition(panel,"floor","floor_"+suffix,
                           "USER FLOOR "+suffix.upper(),"building_"+suffix)
        for n,floor in [(0,"floor_a"),(1,"floor_a"),(2,"floor_a"),(500,"floor_b")]:
            panel.locator("[data-scale-p2b2-device-id]").fill(device(n))
            panel.locator("[data-scale-p2b2-device-floor]").select_option(floor)
            panel.locator("[data-scale-p2b2-add-assignment]").click()
            panel.locator('[data-scale-p2b2-ack-assignment="'+device(n)+'"]').check()
        panel.locator("[data-scale-p2b2-approve-definition]").check()
        panel.locator("[data-scale-p2b2-approve-assignment]").check()
        expect(panel.locator("[data-scale-p2b2-confirm]")).to_be_enabled()
        panel.locator("[data-scale-p2b2-confirm]").click()
        expect(panel).to_have_count(0,timeout=30000)
        expect(hierarchy).to_be_visible()
        require(hierarchy.get_attribute("data-scale-p2b2-member-count")=="4","Wrong original membership")
        require(hierarchy.get_attribute("data-scale-p2b2-unassigned-count")=="996","Lost unassigned nodes")
        require(hierarchy.get_attribute("data-scale-p2b2-cross-site-count")=="1","Lost original intersite link")
        expect(page.locator("[data-scale-p2b2-site-select]")).to_be_visible()
        site_a={device(i) for i in (0,1,2)}
        edges_a={"office_link_t1_r1","office_link_t1_r2"}
        select_and_verify(page,"site","site_a",site_a,edges_a)
        select_and_verify(page,"building","building_a",site_a,edges_a)
        select_and_verify(page,"floor","floor_a",site_a,edges_a)
        select_and_verify(page,"site","site_b",{device(500)},set())
        # Frozen rapid site A/B transitions: no stale same-count SVG edges.
        # Keep this an immediate exact-ID check; a wait for *count* is insufficient.
        for _ in range(3):
            select_and_verify(page,"site","site_a",site_a,edges_a)
            select_and_verify(page,"site","site_b",{device(500)},set())
        ledger=page.locator('[data-scale-p2b2-ledger-row="office_link_t1_r500"]')
        expect(ledger).to_be_visible()
        require(ledger.get_attribute("data-scale-p2b2-from")==device(500) and
                ledger.get_attribute("data-scale-p2b2-from-port")=="eth0" and
                ledger.get_attribute("data-scale-p2b2-to")==device(0) and
                ledger.get_attribute("data-scale-p2b2-to-port")==port(500),
                "Cross-site ledger omitted or altered approved original endpoint-port quartet")
        require("No aggregate physical cable" in page.locator(
                "[data-scale-p2b2-link-ledger]").inner_text(),
                "Intersite presentation incorrectly depicts aggregate as physical cable")
        page.locator("[data-scale-p2b2-search]").fill(device(1))
        page.locator("[data-scale-p2b2-search-go]").click()
        focused=page.locator('[data-scale-p2b2-focus-selected="'+device(1)+'"]')
        expect(focused).to_be_visible(timeout=180000)
        assert_dom(page,site_a,edges_a)
        require(page.locator('[data-scale-p2b2-focus-kind="floor"][data-scale-p2b2-focus-id="floor_a"]').count()==1,
                "Exact device ID search did not navigate across user-declared sites")
        require(exported_source(page)==original_source,
                "Hierarchy navigation silently changed full Builder canonical source")
        require(PRIVATE_NODE not in page.content() and PRIVATE_LINK not in page.content(),
                "P2b2C original private Office column leaked in browser DOM")
        page.locator("[data-scale-p2b2-restore-row-focus]").click()
        expect(page.locator('[data-scale-p2b2-focus-kind="floor"]')).to_have_count(0)
        expect_focus(page,1)
        require(exported_source(page)==original_source,
                "Returning to P2b1 source-row focus changed canonical source")
        require(not errors and not external,"P2b2C browser errors or external network calls")
        return {"format":fmt,"status":"PASS","canonicalNodes":1000,
                "canonicalLinks":999,"manuallyApproved":4,
                "unassignedOriginalDevices":996,"exactCrossSiteOriginalLinks":1,
                "focusSiteA":[3,2],"focusSiteB":[1,0],"engineVerified":False,
                "physicalNetworkVerified":False}
    finally:page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",type=Path,required=True)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and
            u.port is not None and u.path=="/" and not u.query and not u.fragment,
            "P2b2C must use isolated localhost real Chromium")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:
            flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[scenario(browser,args.url,f) for f in ("docx","odt")]
        finally:browser.close()
    evidence={"kind":"SCALE-001 P2b2C original-source hierarchy real Chromium",
              "status":"PASS","cases":cases,
              "originalPhysicalNetworkVerified":False,
              "runtimeEnginePassFromImport":False}
    (args.evidence_dir/"scale001-p2b2c-real-chromium.json").write_text(
        json.dumps(evidence,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P2b2C real Chromium DOCX/ODT 1000/999, explicit site/building/floor ReactFlow exact SVG IDs and ports, cross-site ledger, exact device search, unchanged Builder")
    print(json.dumps(evidence,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL SCALE-001 P2b2C actual Chromium: "+str(exc),file=sys.stderr)
        raise

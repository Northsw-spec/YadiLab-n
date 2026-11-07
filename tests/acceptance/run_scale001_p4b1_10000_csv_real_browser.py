#!/usr/bin/env python3
"""Frozen FIRST. Genuine source CSV 10000/10000 through existing import
picker, explicit bounded consent, production Builder and 100 real source
row pages; only selected bounded ELK graph reaches actual Chromium ReactFlow.
No physical cabling or Engine truth inferred from an imported document.
"""
import argparse,hashlib,json,os,sys,time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect,sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup,menu,require,exported_source
from run_scale001_p3c2b_office_5000_real_browser import snapshot
from run_scale001_p3d2_edited_5000_real_browser import create_extra

N=10000
def node(i): return "core0000" if i==0 else "host"+str(i).zfill(6)
def source_csv():
    rows=["Asset ID,Hostname,Device Type,Connected To"]
    for i in range(N):
        rows.append(",".join((node(i),"Core Switch" if i==0 else "Device "+str(i),
            "Switch" if i==0 else "Windows",node(N-1 if i==0 else i-1))))
    return ("\n".join(rows)+"\n").encode("utf-8")
def focus_expected(page_number):
    start=(page_number-1)*100
    last=start+99
    nodes={node(i) for i in range(start,start+100)}
    nodes.add(node((start-1)%N))
    nodes.add(node((last+1)%N))
    links={"link_row_"+str(i+1) for i in range(start,start+100)}
    links.add("link_row_"+str(((last+1)%N)+1))
    return nodes,links
def verify_mounted_page(page,index):
    picker=page.locator('[data-scale-p4b1-focus-page="true"]')
    expect(picker).to_be_visible(timeout=180000)
    picker.select_option(str(index))
    expect(page.locator('[data-scale-p4b1-active-page]')).to_have_attribute(
        "data-scale-p4b1-active-page",str(index),timeout=180000)
    expected_nodes,expected_links=focus_expected(index)
    # Do not approve old same-count DOM under updated page label.
    page.wait_for_function("""expected => {
      const n=[...document.querySelectorAll('.react-flow__node[data-id]')];
      const e=[...document.querySelectorAll('.react-flow__edge[data-id]')];
      return n.length===expected.nodes.length && e.length===expected.links.length &&
        n.every(x=>expected.nodes.includes(x.getAttribute('data-id'))) &&
        e.every(x=>expected.links.includes(x.getAttribute('data-id')) &&
          x.querySelectorAll('path.react-flow__edge-path.semantic-edge').length===1);
    }""",arg={"nodes":sorted(expected_nodes),"links":sorted(expected_links)},timeout=180000)
    actual=snapshot(page)
    require(set(actual["nodes"])==expected_nodes and len(actual["nodes"])==102,
      "Wrong actual original CSV source rows or peer context on page "+str(index))
    require({e["id"] for e in actual["edges"]}==expected_links and
      len(actual["edges"])==101,"Missing, phantom or duplicated real CSV links")
    for edge in actual["edges"]:
        from_index=int(edge["id"].removeprefix("link_row_"))-1
        require(edge["from"]==node(from_index) and
            edge["to"]==node((from_index-1)%N),
            "Actual source-declared edge endpoint changed")
        require(edge["sourcePort"] is None and edge["targetPort"] is None,
            "Imported CSV with no port declarations gained invented ports")
        require(edge["pathCount"]==1 and edge["d"] and
            "NaN" not in edge["d"] and "Infinity" not in edge["d"],
            "Missing actual finite ReactFlow SVG geometry")
    return {"page":index,"drawnNodes":len(actual["nodes"]),"originalDrawnLinks":len(actual["edges"])}

def case(browser,url):
    page,errors,external=setup(browser,url)
    start=time.monotonic()
    try:
        original=source_csv()
        original_sha=hashlib.sha256(original).hexdigest()
        menu(page).locator('[data-import-network-action="true"]').click()
        panel=page.locator('[data-network-import-panel="ready"]')
        expect(panel).to_be_visible(timeout=30000)
        picker=panel.locator('[data-network-import-file="true"]')
        picker.set_input_files({"name":"p4b1-10000-original-source.csv",
          "mimeType":"text/csv","buffer":original})
        expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(
          timeout=180000)
        expect(panel.locator('[data-network-import-sha="true"]')).to_contain_text(
          original_sha,timeout=30000)
        require("Devices: 10000 · Explicit links: 10000" in panel.inner_text(),
          "Preview did not import the real 10000 source declarations")
        consent=panel.locator('[data-scale-p4b1-consent="true"]')
        expect(consent).to_be_visible(timeout=30000)
        require(not consent.is_checked(),
          "Large-graph display consent was preapproved")
        require(panel.locator('[data-network-import-activate="true"]').is_disabled(),
          "No-consent 10k graph could activate")
        require(panel.locator('[data-network-import-runtime="true"]').is_disabled(),
          "10k CSV source improperly offered Runtime/Engine")
        consent.check()
        expect(panel.locator('[data-network-import-activate="true"]')).to_be_enabled(
            timeout=30000)
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0,timeout=240000)
        view=page.locator('[data-scale-p4b1-focus-view="SOURCE_ROW_NOT_SITE"]')
        expect(view).to_be_visible(timeout=180000)
        expect(view.locator('[data-scale-p4b1-source-counts="true"]')).to_contain_text(
            "10000",timeout=30000)
        approved=exported_source(page)
        require(len(approved["resources"])==N and len(approved["connections"])==N,
            "Actual editable Builder failed to retain 10k/10k canonical source")
        require(approved["resources"][0]["id"]==node(0) and
                approved["resources"][-1]["id"]==node(N-1),
                "CSV original source identity/order lost")
        require([e["id"] for e in approved["connections"]]==
            ["link_row_"+str(i+1) for i in range(N)],
            "Full editable Builder source lost original distinct link IDs")
        for i,e in enumerate(approved["connections"]):
            require((e["from"]["resource"],e["to"]["resource"])==
                    (node(i),node((i-1)%N)) and
                    not e["from"].get("port") and not e["to"].get("port"),
                    "Full editable Builder source invented or lost link endpoint/port")
        require(approved["tests"]==[] and
                approved["completion"]["path"]=="imported_topology_manual_verification",
                "Imported source fabricated a real network or Engine PASS")
        views=[verify_mounted_page(page,i) for i in [1,2,50,100]]
        exact=page.locator('[data-scale-p4b1-focus-search="true"]')
        exact.fill(node(7777))
        page.locator('[data-scale-p4b1-focus-search-go="true"]').click()
        expect(page.locator('[data-scale-p4b1-active-page="78"]')).to_be_visible(
            timeout=180000)
        verify_mounted_page(page,78)
        require(exported_source(page)==approved,
            "Merely navigating bounded source row pages changed whole Builder")
        require(len(page.locator('.react-flow__node[data-id]').all())<=116,
            "Unbounded 10k actual ReactFlow DOM was constructed")
        create_extra(page,"p4b1_unreviewed_new_device")
        expect(page.locator('[data-scale-p4b1-stale="BLOCKED"]')).to_be_visible(
            timeout=30000)
        require(not snapshot(page)["nodes"] and not snapshot(page)["edges"],
            "Edited canonical source retained old graph or unbounded fallback")
        after=exported_source(page)
        require(len(after["resources"])==N+1 and
                after["resources"][:N]==approved["resources"] and
                after["connections"]==approved["connections"],
                "One local edit changed original imported source or link identities")
        # Existing Builder compile UI must be compiler-only and remain blank.
        builder_menu=page.locator('.workspace-menu').filter(
            has=page.locator('summary').filter(has_text='Builder'))
        if builder_menu.get_attribute('open') is None:
            builder_menu.locator('summary').click()
        builder_menu.get_by_role('button',name='Kompilera + layout').click()
        expect(page.locator('[data-scale-p4b1-stale="BLOCKED"]')).to_be_visible(
            timeout=180000)
        require(not snapshot(page)["nodes"] and not snapshot(page)["edges"],
            "Edited 10001 source was silently laid out in full")
        require(exported_source(page)==after,
            "Compiler-only edit validation modified canonical original source")
        require(not errors and not external,
            "Actual mounted Chromium exception or external network request "+repr((errors,external)))
        duration_ms=round((time.monotonic()-start)*1000)
        heap=page.evaluate("() => performance.memory?.usedJSHeapSize ?? null")
        return {"status":"PASS","sourceSha256":original_sha,"sourceBytes":len(original),
                "originalNodes":N,"originalLinks":N,"sourcePages":100,
                "observedViews":views,"exactSourceSearch":True,
                "mutationInvalidatesView":True,"runtimeVerified":False,
                "engineVerified":False,"physicalTopologyVerified":False,
                "maxOriginalDOMNodes":116,"maxOriginalDOMEdges":250,
                "observedTotalMs":duration_ms,
                "observedBrowserUsedJSHeapBytes":heap}
    finally:
        page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",type=Path,required=True)
    args=ap.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
        and u.path=="/" and not u.query and not u.fragment,
        "Only isolated local mounted actual Linux release may be tested")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try: result=case(browser,args.url)
        finally: browser.close()
    report={"kind":"SCALE-001 P4b1 real CSV 10000/10000 bounded original source DOM",
            "status":"PASS","cases":[result],
            "realPhysicalNetworkVerified":False,"runtimeVerified":False,
            "engineVerified":False}
    (args.evidence_dir/"scale001-p4b1-10000-csv-real-dom.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS SCALE-001 P4b1 genuine CSV 10000 original nodes / 10000 explicit original links into real bounded Chromium Builder; 100 source-row pages, 10k full-source retention, no Engine/physical truth")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL SCALE-001 P4b1 genuine mounted Chromium:",str(exc),file=sys.stderr)
        raise

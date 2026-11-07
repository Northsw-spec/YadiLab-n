#!/usr/bin/env python3
"""IC-010 P2 actual compiled Chromium: shared read-only XML chooser + consent, stale gates."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/import"
SECRET = "PRIVATE_CUSTOMER_REPORT_203.0.113.99"

def require(ok, message):
    if not ok:
        raise AssertionError(message)

def graph_bytes():
    return (FIXTURES / "graphml/valid-two-nodes.graphml").read_bytes()

def nmap_bytes():
    return (FIXTURES / "nmap-xml/valid-observed-hosts.xml").read_bytes()

def nessus_bytes():
    return ('<NessusClientData_v2><Report name="' + SECRET + '">'
        '<ReportHost name="SENSITIVE_HOST_PRIVATE">'
        '<ReportItem severity="4" pluginID="100" port="443" protocol="tcp"/>'
        '</ReportHost></Report></NessusClientData_v2>').encode()

def drawio_bytes():
    return (b'<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      b'<mxCell id="a" vertex="1" parent="1"/><mxCell id="b" vertex="1" parent="1"/>'
      b'<mxCell id="ab" edge="1" parent="1" source="a" target="b"/>'
      b'</root></mxGraphModel>')

def setup(browser,url):
    page=browser.new_page(accept_downloads=True)
    errors=[]
    outside=[]
    page.on("pageerror",lambda exc:errors.append(str(exc)))
    page.on("request",lambda req: outside.append(req.url)
        if not (req.url.startswith(url) or req.url.startswith("data:") or req.url.startswith("blob:")) else None)
    page.goto(url,wait_until="domcontentloaded",timeout=25000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    return page,errors,outside

def menu(page):
    item=page.locator(".workspace-menu",has=page.locator("summary",has_text="Import / Export"))
    require(item.count()==1,"Expected unique Import / Export menu")
    if item.get_attribute("open") is None:
        item.locator("summary").click()
    return item

def exported_source(page):
    with page.expect_download(timeout=20000) as incoming:
        menu(page).get_by_role("button",name="Exportera källfil").click()
    return json.loads(Path(incoming.value.path()).read_text())

def open_panel(page):
    menu(page).locator('[data-ic010-p2-open="true"]').click()
    expect(page.locator('[data-ic010-p2-panel="READ_ONLY"]')).to_be_visible(timeout=12000)

def choose(page,name,data):
    page.locator('[data-ic010-p2-file="true"]').set_input_files({
      "name":name,"mimeType":"application/xml","buffer":data
    })

def consent_inspect(page):
    consent=page.locator('[data-ic010-p2-consent="true"]')
    require(not consent.is_checked(),"Consent unexpectedly persisted")
    require(page.locator('[data-ic010-p2-inspect]').is_disabled(),"Inspection enabled without consent")
    consent.check()
    page.locator('[data-ic010-p2-inspect]').click()

def inspect_and_check(page,name,data,profile,status,counts):
    choose(page,name,data)
    expect(page.locator('[data-ic010-p2-selected="true"]')).to_be_visible()
    require(page.locator('[data-ic010-p2-result]').count()==0,
      "File selection parsed source before consent")
    consent_inspect(page)
    expect(page.locator('[data-ic010-p2-result="'+status+'"]')).to_be_visible(timeout=20000)
    require(page.locator('[data-ic010-p2-profile="'+profile+'"]').count()==1,
      "Actual XML producer detection failed: "+profile)
    sha=hashlib.sha256(data).hexdigest()
    require(sha in page.locator('[data-ic010-p2-sha]').inner_text(),"Original SHA mismatch")
    require(counts in page.locator('[data-ic010-p2-counts]').inner_text(),"Wrong source counts")
    require(page.locator('[data-ic010-p2-activation="BLOCKED"]').count()==1,
      "No explicit truth barrier")
    return sha

def invariant(page,before,errors,outside):
    require(exported_source(page)==before,"Shared inspection changed canonical Builder source")
    require(not errors,"Uncaught browser JS exception: "+repr(errors))
    require(not outside,"Unexpected remote request: "+repr(outside))

def test_flow(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        open_panel(page)
        require(page.locator('[data-ic010-p2-result]').count()==0,"Panel started with stale data")
        sha=inspect_and_check(page,"site.graphml",graph_bytes(),
             "graphml.structural.v1","REVIEW_REQUIRED","Nodes: 2 · Graph edges: 1")
        require(sha==hashlib.sha256(graph_bytes()).hexdigest(),"Graph SHA mismatch")
        require(page.locator('[data-ic010-p2-panel]').get_by_role("button",name="Create topology").count()==0,
                "Shared view offered unauthorized activation")
        inspect_and_check(page,"report.nessus",nessus_bytes(),
             "nessus.xml.v1","EVIDENCE_ONLY","Report hosts: 1 · Findings: 1")
        html=page.locator('[data-ic010-p2-panel]').inner_html()
        for canary in [SECRET,"SENSITIVE_HOST_PRIVATE","203.0.113.99"]:
            require(canary not in html,"Nessus secret leaked: "+canary)
        inspect_and_check(page,"network.drawio",drawio_bytes(),
             "diagrams.drawio.v1","PREVIEW_ONLY","Pages: 1 · Drawn vertices: 2")
        inspect_and_check(page,"scan.xml",nmap_bytes(),
             "nmap.xml.v1","EVIDENCE_ONLY","Reported hosts: 2 · Scan-time ports: 2")
        # Selecting a new file does not inspect; consent must be explicitly re-given.
        choose(page,"xxe.xml",(FIXTURES/"nmap-xml/adversarial-xxe.xml").read_bytes())
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Old valid scan survived file switch")
        consent_inspect(page)
        expect(page.locator('[data-ic010-p2-result="BLOCKED"]')).to_be_visible(timeout=16000)
        require("IC010_XML_CONTENT_UNRECOGNIZED" in
            page.locator('[data-ic010-p2-result="BLOCKED"]').inner_text(),
            "XXE did not fail closed")
        require(page.locator('[data-ic010-p2-sha]').count()==0,
                "Malformed input exposed partial source success")
        choose(page,"scan.xml",nmap_bytes())
        consent_inspect(page)
        expect(page.locator('[data-ic010-p2-result="EVIDENCE_ONLY"]')).to_be_visible(timeout=16000)
        page.locator('[data-ic010-p2-consent="true"]').uncheck()
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Withdrawing consent retained an old result")
        require(page.locator('[data-ic010-p2-inspect]').is_disabled(),
                "Withdrawing consent did not block action")
        page.locator('[data-ic010-p2-close]').click()
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        invariant(page,before,errors,outside)
        open_panel(page)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Close/reopen retained original source")
        require(page.locator('[data-ic010-p2-consent]').is_disabled(),
                "Close/reopen retained file consent")
        page.keyboard.press("Escape")
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        invariant(page,before,errors,outside)
        return {"case":"four_positive_profiles_and_hostile_xml","status":"PASS",
                "builderUnchanged":True,"outsideRequests":0,"explicitConsent":True,
                "sourceSha256":sha}
    finally:
        page.close()

def test_delayed_read(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        open_panel(page)
        page.evaluate("""() => {
          const original = File.prototype.arrayBuffer;
          window.__ic010Release = [];
          File.prototype.arrayBuffer = function() {
            if (this.name === "slow.xml") {
              return new Promise((resolve,reject) => {
                window.__ic010Release.push(() => original.call(this).then(resolve,reject));
              });
            }
            return original.call(this);
          };
        }""")
        choose(page,"slow.xml",nmap_bytes())
        consent_inspect(page)
        page.wait_for_function("window.__ic010Release.length === 1",timeout=10000)
        # New valid source takes priority even if prior ArrayBuffer completes later.
        inspect_and_check(page,"site.graphml",graph_bytes(),
             "graphml.structural.v1","REVIEW_REQUIRED","Nodes: 2")
        page.evaluate("() => window.__ic010Release.shift()()")
        page.wait_for_timeout(350)
        require(page.locator('[data-ic010-p2-profile="graphml.structural.v1"]').count()==1,
                "Late Nmap read overwrote newer valid GraphML")
        require(page.locator('[data-ic010-p2-result="EVIDENCE_ONLY"]').count()==0,
                "Stale Nmap result reappeared")
        # Another delayed read must be ignored after closing a busy dialog.
        choose(page,"slow.xml",nmap_bytes())
        consent_inspect(page)
        page.wait_for_function("window.__ic010Release.length === 1",timeout=10000)
        page.locator('[data-ic010-p2-close-top]').click()
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        page.evaluate("() => window.__ic010Release.shift()()")
        open_panel(page)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Late response resurrected closed dialog")
        require(page.locator('[data-ic010-p2-consent]').is_disabled(),
                "Late response reintroduced prior consent")
        page.locator('[data-ic010-p2-close]').click()
        invariant(page,before,errors,outside)
        return {"case":"late_read_switch_close_and_reopen","status":"PASS",
                "lateResponsesDiscarded":True,"builderUnchanged":True,"outsideRequests":0}
    finally:
        page.close()

def test_workspace_switch_invalidates_pending(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        original_source=exported_source(page)
        initial_scenario=page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
        open_panel(page)
        page.evaluate("""() => {
          const original = File.prototype.arrayBuffer;
          window.__ic010ReleaseWorkspace = [];
          File.prototype.arrayBuffer = function() {
            if (this.name === "workspace-slow.xml") {
              return new Promise((resolve,reject) => {
                window.__ic010ReleaseWorkspace.push(() => original.call(this).then(resolve,reject));
              });
            }
            return original.call(this);
          };
        }""")
        choose(page,"workspace-slow.xml",nmap_bytes())
        consent_inspect(page)
        page.wait_for_function("window.__ic010ReleaseWorkspace.length === 1",timeout=10000)
        # A legitimate, independent Builder command replaces the current
        # workspace while a source read is still pending. We invoke its actual
        # existing React click handler, not a test-only workspace setter.
        page.evaluate("""() => {
          const action = [...document.querySelectorAll(".workspace-menu button")]
            .find(button => button.textContent.trim() === "Öppna enterprise i byggläget");
          if (!action || action.disabled) throw Error("Expected enabled Builder action");
          action.click();
        }""")
        page.wait_for_function("""initial =>
          document.querySelector(".app-frame")?.getAttribute("data-runtime-scenario-id") !== initial
        """,arg=initial_scenario,timeout=25000)
        expect(page.locator('[data-ic010-p2-consent]')).to_be_disabled(timeout=10000)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Old source survived legitimate Builder replacement")
        require(page.locator('[data-ic010-p2-selected]').count()==0,
                "Old selected file survived Builder replacement")
        page.evaluate("() => window.__ic010ReleaseWorkspace.shift()()")
        page.wait_for_timeout(350)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Pending read repopulated a different workspace")
        page.locator('[data-ic010-p2-close]').click()
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        new_source=exported_source(page)
        require(new_source!=original_source,
                "Independent Builder command did not change the source (test invalid)")
        require(not errors,"Browser errors: "+repr(errors))
        require(not outside,"Remote requests: "+repr(outside))
        return {"case":"live_workspace_replacement_invalidates_pending_source",
                "status":"PASS","oldSourceDiscarded":True,
                "workspaceChangedByIndependentAction":True,"outsideRequests":0}
    finally:
        page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",required=True,type=Path)
    args=ap.parse_args()
    target=urlsplit(args.url)
    require(target.scheme=="http" and target.hostname=="127.0.0.1" and
            target.port is not None and target.path=="/" and
            not target.query and not target.fragment and not target.username and not target.password,
            "Actual Chromium requires canonical loopback origin")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:
            flags.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=flags)
        try:
            cases=[test_flow(browser,args.url),test_delayed_read(browser,args.url),
                   test_workspace_switch_invalidates_pending(browser,args.url)]
        finally:
            browser.close()
    report={"status":"PASS","kind":"Actual compiled Chromium UI, original file chooser & source validation",
            "platform":"Ubuntu GitHub Actions, not native Parrot",
            "cases":cases,"builderOrEngineModifiedByInspection":False}
    (args.evidence_dir/"ic010-p2-shared-xml-real-browser.json").write_text(
        json.dumps(report,indent=2)+"\n")
    print("PASS IC-010 P2 actual compiled Chromium shared XML inspection",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL IC-010 P2 Chromium: "+str(exc),file=sys.stderr)
        raise

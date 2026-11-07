#!/usr/bin/env python3
"""NMAP XML P5: real P4 association JSON exported then source-bound replay in actual compiled Chromium."""
import argparse,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_nmap_xml_p2_real_browser import setup,inspect,export_builder_source,confirm_unchanged,require
from run_nmap_xml_p3_real_browser import original,upload,goto

def open_replay(page):
    menu=page.locator(".workspace-menu",has=page.locator("summary",has_text="Import / Export"))
    require(menu.count()==1,"Import / Export must exist")
    if menu.get_attribute("open") is None:menu.locator("summary").click()
    menu.locator('[data-inspect-nmap-replay="EVIDENCE_OBSERVED"]').click()
    expect(page.locator('[data-nmap-replay-panel="EVIDENCE_OBSERVED"]')).to_be_visible(timeout=25000)

def choose(page,selector,name,raw):
    page.locator(selector).set_input_files({"name":name,"mimeType":"application/octet-stream","buffer":raw})

def test(browser,url):
    page,errors,external,scenario=setup(browser,url)
    try:
        before=export_builder_source(page)
        source=original(161);sha=hashlib.sha256(source).hexdigest()
        inspect(page);upload(page,source)
        goto(page,'[data-nmap-association-next]','data-nmap-association-page',3)
        expect(page.locator('[data-nmap-associate-host="160"]')).to_be_visible()
        page.locator('[data-nmap-associate-host="160"]').select_option("rds01")
        page.locator('[data-nmap-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nmap-association-export]').click()
        saved=Path(download.value.path()).read_bytes()
        report=json.loads(saved)
        require(report["source"]["sha256"]==sha,"P4 original SHA not present")
        require(report["associations"][0]["hostLocator"]["hostOrdinal"]==160,"Wrong P4 source host")
        page.locator('[data-nmap-close]').click()
        expect(page.locator('[data-nmap-panel]')).to_have_count(0)

        open_replay(page)
        choose(page,'[data-nmap-replay-original]','original.xml',source)
        choose(page,'[data-nmap-replay-report]','saved.json',saved)
        verify=page.locator('[data-nmap-replay-verify]')
        require(verify.is_disabled(),"Replay without consent")
        require(page.locator('[data-nmap-replay-result]').count()==0,"Automatic MATCH before consent")
        page.locator('[data-nmap-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-nmap-replay-result="REFERENCE_REPLAY_MATCH"]')).to_be_visible(timeout=30000)
        require(page.locator('[data-nmap-replay-count="1"]').count()==1,"Incorrect replay count")
        require(sha in page.locator('[data-nmap-replay-sha]').inner_text(),"Original scan SHA lost")
        for value in ["CONFIDENTIAL_NMAP_HOST_160","node160.example.test",
                      "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED","TCP/443"]:
            require(value not in page.locator('[data-nmap-replay-panel]').inner_html(),
                "Raw scan or saved association data exposed in replay UI")

        # Same original filename but changed XML observations: no stale MATCH permitted.
        changed=source.replace(b'node0.example.test',b'changed0.example.test')
        require(changed!=source,"Must actually change original bytes")
        choose(page,'[data-nmap-replay-original]','original.xml',changed)
        require(page.locator('[data-nmap-replay-result]').count()==0,"Previous MATCH persisted")
        require(not page.locator('[data-nmap-replay-consent]').is_checked(),"Consent persisted across original change")
        page.locator('[data-nmap-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-nmap-replay-error="BLOCKED"]')).to_have_text(
            "NMAP_REPLAY_SOURCE_CHANGED",timeout=25000)

        choose(page,'[data-nmap-replay-original]','original.xml',source)
        forged={**report,"engineVerified":True}
        choose(page,'[data-nmap-replay-report]','forged.json',json.dumps(forged).encode())
        require(not page.locator('[data-nmap-replay-consent]').is_checked(),"Forged report retained consent")
        page.locator('[data-nmap-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-nmap-replay-error="BLOCKED"]')).to_have_text(
            "NMAP_REPLAY_REPORT_MISMATCH",timeout=25000)
        require(page.locator('[data-nmap-replay-result]').count()==0,"Forged Engine PASS created MATCH")

        page.locator('[data-nmap-replay-close]').click()
        expect(page.locator('[data-nmap-replay-panel]')).to_have_count(0)
        require(export_builder_source(page)==before,"Replay changed canonical Builder")
        confirm_unchanged(page,scenario,errors,external)
        open_replay(page)
        require(page.locator('[data-nmap-replay-result]').count()==0,"MATCH persisted after close")
        require(page.locator('[data-nmap-replay-verify]').is_disabled(),"Old file choices persisted after reopen")
        page.locator('[data-nmap-replay-close]').click()
        return {"status":"PASS","case":"actual_p4_export_p5_original_xml_sidecar_replay",
                "sourceSha256":sha,"referencesChecked":1,"lastOrdinal":160,
                "changedSourceBlocked":True,"forgedEngineTruthBlocked":True,
                "builderMutated":False,"externalRequests":0}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
       u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
       "Only compiled loopback YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:results=[test(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"NMAP XML P5 real compiled Chromium saved P4 reference replay",
            "platform":"GitHub Ubuntu Chromium; native Parrot NOT_RUN",
            "cases":results,"builderMutated":False}
    (args.evidence_dir/"nmap-xml-p5-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS NMAP XML P5 real compiled Chromium")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as ex:
        print("FAIL NMAP XML P5 real Chromium "+str(ex),file=sys.stderr)
        raise

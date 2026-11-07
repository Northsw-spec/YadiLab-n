#!/usr/bin/env python3
"""NMAP XML P4 actual compiled Chromium: reread original on export and reject changed source."""
import argparse,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_nmap_xml_p2_real_browser import setup,inspect,export_builder_source,confirm_unchanged,require
from run_nmap_xml_p3_real_browser import original,upload,goto,ip

def ordinary(browser,url):
    page,errors,external,scenario=setup(browser,url)
    try:
        before=export_builder_source(page)
        raw=original(161);sha=hashlib.sha256(raw).hexdigest()
        inspect(page);upload(page,raw)
        goto(page,'[data-nmap-association-next]','data-nmap-association-page',3)
        expect(page.locator('[data-nmap-associate-host="160"]')).to_be_visible()
        page.locator('[data-nmap-associate-host="160"]').select_option("rds01")
        require(page.locator('[data-nmap-association-export]').is_disabled(),"No consent yet")
        page.locator('[data-nmap-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nmap-association-export]').click()
        sidecar=json.loads(Path(download.value.path()).read_text("utf-8"))
        require(sidecar["schemaVersion"]=="1.0.0" and
                sidecar["formatId"]=="yadilab.nmap-observation-associations","P2 schema changed")
        require(sidecar["source"]["sha256"]==sha,"P4 did not reread the original source")
        require(sidecar["associations"][0]["hostLocator"]=={
                "kind":"nmap-host","sourceSha256":sha,"hostOrdinal":160},"Original late source locator wrong")
        require(sidecar["associations"][0]["observedIpv4"]==ip(160),"Observed IP changed")
        require(not sidecar["engineVerified"] and not sidecar["physicalTopologyVerified"],
                "False verified physical/Engine status")
        upload(page,raw)
        expect(page.locator('[data-nmap-association-page="1"]')).to_be_visible()
        require(not page.locator('[data-nmap-association-ack]').is_checked(),"Old consent retained")
        require(page.locator('[data-nmap-association-export]').is_disabled(),"Old export consent retained")
        page.locator('[data-nmap-close]').click()
        require(export_builder_source(page)==before,"P4 original source export changed Builder")
        confirm_unchanged(page,scenario,errors,external)
        return {"case":"genuine_original_161_host_export_sha_and_ordinal160","status":"PASS",
                "sha256":sha,"builderUnchanged":True}
    finally:page.close()

def changed_during_export(browser,url):
    page,errors,external,scenario=setup(browser,url)
    try:
        before=export_builder_source(page)
        # Test-only controlled I/O boundary: actual file input returns the original
        # XML once, then a syntactically valid but changed XML buffer on the export
        # re-read. This deliberately proves production rejects a changed source.
        page.evaluate("""() => {
          const originalRead = File.prototype.arrayBuffer;
          window.__nmapP4Reads = 0;
          File.prototype.arrayBuffer = async function() {
            const bytes = await originalRead.call(this);
            if (this.name === "modified.xml") {
              window.__nmapP4Reads++;
              if (window.__nmapP4Reads >= 2) {
                const text = new TextDecoder().decode(bytes);
                const changed = text.replace("10.0.0.10","10.0.0.99");
                if (changed === text) throw new Error("Synthetic canary not found");
                return new TextEncoder().encode(changed).buffer;
              }
            }
            return bytes;
          };
        }""")
        inspect(page)
        raw=original(2)
        page.locator('[data-nmap-file="true"]').set_input_files({
          "name":"modified.xml","mimeType":"application/xml","buffer":raw})
        expect(page.locator('[data-nmap-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=25000)
        require(page.evaluate("window.__nmapP4Reads")==1,"Initial preview must read only once")
        downloads=[]
        page.on("download",lambda d:downloads.append(d.suggested_filename))
        page.locator('[data-nmap-associate-host="0"]').select_option("rds01")
        page.locator('[data-nmap-association-ack]').check()
        page.locator('[data-nmap-association-export]').click()
        expect(page.locator('[data-nmap-association-error="BLOCKED"]')).to_contain_text(
            "NMAP_P4_SOURCE_CHANGED",timeout=25000)
        require(page.evaluate("window.__nmapP4Reads")>=2,"Export did not re-read original File")
        require(not downloads,"Changed XML created a downloaded JSON sidecar")
        require(page.locator('[data-nmap-association-exported]').count()==0,"False exported success")
        page.locator('[data-nmap-close]').click()
        require(export_builder_source(page)==before,"Rejected export modified Builder")
        confirm_unchanged(page,scenario,errors,external)
        return {"case":"file_io_changed_between_inspection_and_export","status":"PASS",
                "blockedCode":"NMAP_P4_SOURCE_CHANGED","downloaded":False,"builderUnchanged":True}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    url=urlsplit(args.url)
    require(url.scheme=="http" and url.hostname=="127.0.0.1" and url.port is not None and
      url.path=="/" and not url.query and not url.fragment and
      not url.username and not url.password,"Only compiled localhost YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:cases=[ordinary(browser,args.url),changed_during_export(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"NMAP XML P4 real Chromium source-byte re-read and mutation denial",
            "platform":"Ubuntu GitHub Actions; native Parrot NOT_RUN",
            "cases":cases,"builderMutated":False}
    (args.evidence_dir/"nmap-xml-p4-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS NMAP XML P4 compiled Chromium")
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL NMAP XML P4 Chromium "+str(error),file=sys.stderr)
        raise

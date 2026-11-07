#!/usr/bin/env python3
"""NESSUS P5 actual compiled Chromium: original source-byte and live model export gate."""
import argparse,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_nessus_p4_real_browser import original,inspect,upload,next_page,targets,ensure_secrets_absent
from run_docx_p2_real_browser import setup,export_source,check_unchanged,require

def allowed(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        raw=original(41);sha=hashlib.sha256(raw).hexdigest()
        inspect(page);upload(page,raw)
        next_page(page,2);next_page(page,3)
        expect(page.locator('[data-nessus-associate-host="40"]')).to_be_visible()
        target=targets(page,40)
        page.locator('[data-nessus-associate-host="40"]').select_option(target)
        page.locator('[data-nessus-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nessus-association-export]').click()
        sidecar=json.loads(Path(download.value.path()).read_text("utf-8"))
        require(sidecar["formatId"]=="yadilab.nessus-reviewed-host-references" and
                sidecar["schemaVersion"]=="1.0.0","P3 sidecar schema changed")
        require(sidecar["source"]["sha256"]==sha,"Original Nessus SHA not preserved")
        require(sidecar["associations"][0]["hostLocator"]["hostOrdinal"]==40,
                "Late original ordinal changed")
        require(sidecar["associations"][0]["targetResourceId"]==target,
                "Wrong operator-reviewed Builder target")
        require(all(sidecar[k] is False for k in ("engineVerified","identityVerified",
                "physicalTopologyVerified","modelMutated")),"False physical/Engine/identity verification")
        ensure_secrets_absent(page)
        page.locator('[data-nessus-close]').click()
        require(export_source(page)==before,"Nessus successful source export changed Builder")
        check_unchanged(page,scenario,errors,external)
        return {"case":"41_source_original_ordinal40_export","status":"PASS","sourceSha256":sha,
                "builderMutated":False,"secretLeak":False}
    finally:page.close()

def changed_during_export(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        # Deliberately alter actual returned file bytes only on the second read.
        # Private host name changes, but ReportHost count/severity histogram remain equal.
        page.evaluate("""() => {
          const reader=File.prototype.arrayBuffer;
          window.__nessusP5Reads=0;
          File.prototype.arrayBuffer=async function(){
            const bytes=await reader.call(this);
            if(this.name==="altered.nessus"){
              window.__nessusP5Reads++;
              if(window.__nessusP5Reads>=2){
                const text=new TextDecoder().decode(bytes);
                const changed=text.replace("NESSUS_P4_PRIVATE_HOST_CANARY_0",
                  "NESSUS_P5_CHANGED_HOST_CANARY_0");
                if(changed===text)throw new Error("Test canary not in original Nessus");
                return new TextEncoder().encode(changed).buffer;
              }
            }
            return bytes;
          };
        }""")
        raw=original(2)
        inspect(page)
        page.locator('[data-nessus-file="true"]').set_input_files({
            "name":"altered.nessus","mimeType":"application/xml","buffer":raw})
        expect(page.locator('[data-nessus-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=25000)
        require(page.evaluate("window.__nessusP5Reads")==1,"Original inspection should read once")
        page.locator('[data-nessus-associate-host="0"]').select_option(targets(page,0))
        page.locator('[data-nessus-association-ack]').check()
        downloads=[]
        page.on("download",lambda d:downloads.append(d.suggested_filename))
        page.locator('[data-nessus-association-export]').click()
        expect(page.locator('[data-nessus-association-error="BLOCKED"]')).to_have_text(
            "NESSUS_P5_SOURCE_CHANGED",timeout=25000)
        require(page.evaluate("window.__nessusP5Reads")>=2,"Did not reread original File")
        require(not downloads,"Stale Nessus XML generated JSON download")
        require(page.locator('[data-nessus-association-exported]').count()==0,
                "False export success on modified source")
        ensure_secrets_absent(page)
        page.locator('[data-nessus-close]').click()
        require(export_source(page)==before,"Denied Nessus export changed Builder")
        check_unchanged(page,scenario,errors,external)
        return {"case":"altered_original_file_during_async_export","status":"PASS",
                "blocked":"NESSUS_P5_SOURCE_CHANGED","downloaded":False,"builderMutated":False}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and
            not u.username and not u.password,"Only compiled loopback YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:cases=[allowed(browser,args.url),changed_during_export(browser,args.url)]
        finally:browser.close()
    result={"status":"PASS","kind":"NESSUS P5 actual Chromium strict source and live Builder export gate",
        "platform":"Ubuntu GitHub Actions compiled Chromium; Parrot native NOT_RUN",
        "cases":cases,"builderMutated":False}
    (args.evidence_dir/"nessus-p5-chromium.json").write_text(json.dumps(result,indent=2)+"\n")
    print("PASS NESSUS P5 actual compiled Chromium")
    print(json.dumps(result,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as e:
        print("FAIL NESSUS P5 Chromium "+str(e),file=sys.stderr)
        raise

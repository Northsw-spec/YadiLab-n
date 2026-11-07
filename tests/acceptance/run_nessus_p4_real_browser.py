#!/usr/bin/env python3
"""NESSUS P4: actual compiled Chromium ReportHost 41/256 ordinal window and original export gates."""
import argparse,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_docx_p2_real_browser import setup,export_source,check_unchanged,require,menu

CANARY="NESSUS_P4_PRIVATE_HOST_CANARY"
def original(count):
    hosts="".join(
        f'<ReportHost name="{CANARY}_{i}"><HostProperties><tag name="host-ip">192.0.2.88</tag></HostProperties>'
        f'<ReportItem pluginID="19506" port="443" protocol="tcp" severity="3">'
        f'<plugin_output>DO_NOT_EXPOSE_SECRET_FINDING</plugin_output></ReportItem></ReportHost>'
        for i in range(count))
    return ('<?xml version="1.0" encoding="UTF-8"?><NessusClientData_v2>'
            '<Report name="SECRET_NESSUS_REPORT">'+hosts+'</Report></NessusClientData_v2>').encode()

def inspect(page):
    menu(page).locator('[data-inspect-nessus="EVIDENCE_ONLY"]').click()
    expect(page.locator('[data-nessus-panel="EVIDENCE_ONLY"]')).to_be_visible(timeout=25000)

def upload(page,raw):
    page.locator('[data-nessus-file="true"]').set_input_files({
        "name":"source.nessus","mimeType":"application/xml","buffer":raw})
    expect(page.locator('[data-nessus-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=25000)

def next_page(page,number):
    page.locator('[data-nessus-page-next="true"]').click()
    expect(page.locator(f'[data-nessus-association-page="{number}"]')).to_be_visible(timeout=15000)

def targets(page,ordinal):
    opts=page.locator(f'[data-nessus-associate-host="{ordinal}"] option')
    require(opts.count()>=2,"Existing Builder model target missing")
    value=opts.nth(1).get_attribute("value")
    require(value and value!="", "Nonempty resource target missing")
    return value

def ensure_secrets_absent(page):
    html=page.locator('[data-nessus-panel="EVIDENCE_ONLY"]').inner_html()
    for token in (CANARY,"192.0.2.88","19506","DO_NOT_EXPOSE_SECRET_FINDING","SECRET_NESSUS_REPORT"):
        require(token not in html,"Nessus raw source in DOM "+token)

def case_41(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        raw=original(41);sha=hashlib.sha256(raw).hexdigest()
        inspect(page);upload(page,raw)
        require(page.locator('[data-nessus-associate-host]').count()==20,"Expected 20 selectors on page1")
        require(page.locator('[data-nessus-associate-host="20"]').count()==0,"Next page unexpectedly rendered")
        require(page.locator('[data-nessus-page-previous]').is_disabled(),"Prev should be disabled")
        ensure_secrets_absent(page)
        next_page(page,2)
        expect(page.locator('[data-nessus-associate-host="20"]')).to_be_visible()
        require(page.locator('[data-nessus-associate-host="0"]').count()==0,"Old page remained")
        next_page(page,3)
        expect(page.locator('[data-nessus-associate-host="40"]')).to_be_visible()
        require(page.locator('[data-nessus-associate-host]').count()==1,"Final 41-host page should have one")
        require(page.locator('[data-nessus-page-next]').is_disabled(),"Next enabled beyond source end")
        selected_target=targets(page,40)
        page.locator('[data-nessus-associate-host="40"]').select_option(selected_target)
        require(page.locator('[data-nessus-association-export]').is_disabled(),"No default consent")
        page.locator('[data-nessus-page-previous]').click()
        page.locator('[data-nessus-page-previous]').click()
        expect(page.locator('[data-nessus-association-page="1"]')).to_be_visible()
        page.locator('[data-nessus-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nessus-association-export]').click()
        raw_json=Path(download.value.path()).read_text("utf-8")
        report=json.loads(raw_json)
        require(report["formatId"]=="yadilab.nessus-reviewed-host-references","Changed P3 schema")
        require(report["schemaVersion"]=="1.0.0" and report["status"]=="REVIEWED_ASSOCIATIONS_ONLY",
                "Source association report falsely verified")
        require(report["source"]=={
           "profileId":"nessus.xml.severity-summary.v1","sha256":sha,
           "semanticTrack":"EVIDENCE_OBSERVED"}, "Wrong original SHA-256 or source profile")
        require(report["targetModel"]["scenarioId"]==before["scenarioId"],"Changed Builder identity")
        require(report["associations"]==[{
           "hostLocator":{"kind":"nessus-report-host","sourceSha256":sha,"hostOrdinal":40},
           "targetResourceId":selected_target,
           "assertion":"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"}],"Wrong late ReportHost provenance")
        for key in ("engineVerified","physicalTopologyVerified","identityVerified","modelMutated"):
            require(report[key] is False,"False verification flag")
        for token in (CANARY,"192.0.2.88","19506","DO_NOT_EXPOSE_SECRET_FINDING","SECRET_NESSUS_REPORT"):
            require(token not in raw_json,"Private Nessus XML leaked to sidecar")
        ensure_secrets_absent(page)
        # Same original file selection must reset page, prior selections and acknowledgment.
        upload(page,raw)
        expect(page.locator('[data-nessus-association-page="1"]')).to_be_visible()
        require(page.locator('[data-nessus-selected-count="0"]').count()==1,"Previous mapping carried over")
        require(not page.locator('[data-nessus-association-ack]').is_checked(),"Consent carried over")
        require(page.locator('[data-nessus-association-export]').is_disabled(),"Source change authorized export")
        page.locator('[data-nessus-close]').click()
        require(export_source(page)==before,"Nessus P4 changed Builder")
        check_unchanged(page,scenario,errors,external)
        return {"case":"41_host_late_ordinal40_p3_source_gate","status":"PASS",
                "sourceSha256":sha,"selectedOrdinal":40,"secretLeak":False,"builderMutated":False}
    finally:page.close()

def case_256(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        raw=original(256)
        inspect(page);upload(page,raw)
        for number in range(2,14):next_page(page,number)
        expect(page.locator('[data-nessus-associate-host="255"]')).to_be_visible()
        require(page.locator('[data-nessus-associate-host]').count()==16,"Last page must show 16 hosts")
        require(page.locator('[data-nessus-page-next]').is_disabled(),"Beyond 256 source positions")
        target=targets(page,255)
        page.locator('[data-nessus-associate-host="255"]').select_option(target)
        page.locator('[data-nessus-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nessus-association-export]').click()
        report=json.loads(Path(download.value.path()).read_text("utf-8"))
        require(len(report["associations"])==1,"No unmapped source hosts may be added")
        require(report["associations"][0]["hostLocator"]["hostOrdinal"]==255,
                "Last valid original source ordinal missing")
        for key in ("engineVerified","physicalTopologyVerified","identityVerified","modelMutated"):
            require(report[key] is False,"Physical/Engine truth fabricated")
        ensure_secrets_absent(page)
        page.locator('[data-nessus-close]').click()
        require(export_source(page)==before,"256-host review mutated Builder")
        check_unchanged(page,scenario,errors,external)
        return {"case":"256_host_final_ordinal255","status":"PASS","selectedOrdinal":255,
                "secretLeak":False,"builderMutated":False}
    finally:page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    url=urlsplit(args.url)
    require(url.scheme=="http" and url.hostname=="127.0.0.1" and url.port is not None and
            url.path=="/" and not url.query and not url.fragment and
            not url.username and not url.password,"Only compiled local YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[case_41(browser,args.url),case_256(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"NESSUS P4 real compiled Chromium original ReportHost ordinal navigation",
        "platform":"GitHub Ubuntu Chromium; native Parrot NOT_RUN",
        "cases":cases,"builderMutated":False}
    (args.evidence_dir/"nessus-p4-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS NESSUS P4 compiled real Chromium")
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL NESSUS P4 compiled Chromium "+str(error),file=sys.stderr)
        raise

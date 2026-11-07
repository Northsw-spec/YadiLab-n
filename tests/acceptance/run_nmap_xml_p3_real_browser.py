#!/usr/bin/env python3
"""NMAP XML P3: genuine compiled Chromium pagination through source host ordinal 999."""
import argparse,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_nmap_xml_p2_real_browser import setup,inspect,export_builder_source,confirm_unchanged,require

def ip(index):
    return f"10.{index//256}.{index%256}.10"

def original(n):
    hosts="".join(
        '<host><status state="up"/><address addrtype="ipv4" addr="'+ip(i)+'"/>'
        '<hostnames><hostname name="node'+str(i)+'.example.test" type="user"/></hostnames>'+
        ('<ports><port protocol="tcp" portid="443"><state state="open"/>'
         '<service name="https" method="probed" conf="7"/></port></ports>' if i==160 else '')+
        '</host>' for i in range(n))
    return ('<?xml version="1.0"?><nmaprun scanner="nmap" version="7.94">'+hosts+'</nmaprun>').encode()

def upload(page,raw):
    page.locator('[data-nmap-file="true"]').set_input_files({
        "name":"original.xml","mimeType":"application/xml","buffer":raw})
    expect(page.locator('[data-nmap-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=25000)

def goto(page,selector,attr,n):
    for i in range(2,n+1):
        page.locator(selector).click()
        expect(page.locator(f'[{attr}="{i}"]')).to_be_visible(timeout=20000)

def test_161(browser,url):
    page,errors,external,scenario=setup(browser,url)
    try:
        before=export_builder_source(page)
        raw=original(161);sha=hashlib.sha256(raw).hexdigest()
        inspect(page);upload(page,raw)
        require(page.locator('[data-nmap-host]').count()==80,"Initial observations must render 80 hosts")
        require(page.locator('[data-nmap-associate-host]').count()==80,"Initial reviewer shows 80 hosts")
        require(page.locator('[data-nmap-host="160"]').count()==0,"Hidden observed host appeared on page1")
        require(page.locator('[data-nmap-associate-host="160"]').count()==0,"Hidden mapping appeared on page1")
        require(page.locator('[data-nmap-observation-previous]').is_disabled(),"Prev observations enabled on page1")
        require(page.locator('[data-nmap-association-previous]').is_disabled(),"Prev review enabled on page1")
        goto(page,'[data-nmap-observation-next]','data-nmap-observation-page',3)
        require(page.locator('[data-nmap-host]').count()==1,"Last observation page must show 1 host")
        expect(page.locator('[data-nmap-host="160"]')).to_be_visible()
        require(ip(160) in page.locator('[data-nmap-host="160"]').inner_text(),"Original IPv4 lost")
        require("TCP/443 — observed open" in page.locator('[data-nmap-host="160"]').inner_text(),
                "Late host's original open port missing")
        require(page.locator('[data-nmap-observation-next]').is_disabled(),"Next past end allowed")
        goto(page,'[data-nmap-association-next]','data-nmap-association-page',3)
        expect(page.locator('[data-nmap-associate-host="160"]')).to_be_visible()
        require(page.locator('[data-nmap-associate-host]').count()==1,"Last reviewer page must show 1 host")
        require(page.locator('[data-nmap-association-next]').is_disabled(),"Next review beyond source")
        page.locator('[data-nmap-associate-host="160"]').select_option("rds01")
        require(page.locator('[data-nmap-association-export]').is_disabled(),"Export without consent")
        page.locator('[data-nmap-association-previous]').click()
        page.locator('[data-nmap-association-previous]').click()
        expect(page.locator('[data-nmap-association-page="1"]')).to_be_visible()
        page.locator('[data-nmap-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nmap-association-export]').click()
        sidecar=json.loads(Path(download.value.path()).read_text("utf-8"))
        require(sidecar["schemaVersion"]=="1.0.0" and
                sidecar["formatId"]=="yadilab.nmap-observation-associations","Existing schema changed")
        require(sidecar["source"]["sha256"]==sha,"Original source SHA mismatch")
        require(sidecar["targetModel"]["scenarioId"]==before["scenarioId"],"Wrong Builder source")
        require(len(sidecar["associations"])==1,"Extra automatic host mappings")
        host=sidecar["associations"][0]
        require(host["hostLocator"]=={"kind":"nmap-host","sourceSha256":sha,"hostOrdinal":160},
                "Absolute original host 160 locator wrong")
        require(host["observedIpv4"]==ip(160) and host["observedStatus"]=="up" and
                host["observedPortCount"]==1,"Late scan-time evidence changed")
        require(host["targetResourceId"]=="rds01" and
                host["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                "Human unverified association lost")
        require(sidecar["engineVerified"] is False and sidecar["physicalTopologyVerified"] is False,
                "Observation promoted to verified physical/Engine truth")
        # Source reselection of same bytes must reset both observation and review page/consent.
        upload(page,raw)
        expect(page.locator('[data-nmap-observation-page="1"]')).to_be_visible()
        expect(page.locator('[data-nmap-association-page="1"]')).to_be_visible()
        require(page.locator('[data-nmap-associate-host="0"]').input_value()=="",
                "Old association survived same-source re-selection")
        require(not page.locator('[data-nmap-association-ack]').is_checked(),
                "Old consent carried into next review")
        require(page.locator('[data-nmap-association-export]').is_disabled(),
                "Automatic re-export after reselection")
        page.locator('[data-nmap-close="true"]').click()
        expect(page.locator('[data-nmap-panel]')).to_have_count(0)
        require(export_builder_source(page)==before,"Nmap source review mutated Builder")
        confirm_unchanged(page,scenario,errors,external)
        return {"case":"161_source_hosts_ordinal160_real_ui_export","status":"PASS",
                "sha256":sha,"lateOrdinal":160,"builderMutated":False,"externalRequests":0}
    finally:page.close()

def test_1000(browser,url):
    page,errors,external,scenario=setup(browser,url)
    try:
        before=export_builder_source(page)
        raw=original(1000)
        inspect(page);upload(page,raw)
        goto(page,'[data-nmap-observation-next]','data-nmap-observation-page',13)
        expect(page.locator('[data-nmap-host="999"]')).to_be_visible()
        require(page.locator('[data-nmap-host]').count()==40,"Last 1000-host observation page must show 40")
        require(ip(999) in page.locator('[data-nmap-host="999"]').inner_text(),"Original #999 IP lost")
        require(page.locator('[data-nmap-observation-next]').is_disabled(),"Observation page exceeds host budget")
        goto(page,'[data-nmap-association-next]','data-nmap-association-page',13)
        expect(page.locator('[data-nmap-associate-host="999"]')).to_be_visible()
        require(page.locator('[data-nmap-associate-host]').count()==40,"Last association page must show 40")
        page.locator('[data-nmap-associate-host="999"]').select_option("rds01")
        page.locator('[data-nmap-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nmap-association-export]').click()
        sidecar=json.loads(Path(download.value.path()).read_text("utf-8"))
        require(sidecar["associations"][0]["hostLocator"]["hostOrdinal"]==999,"Final host ordinal lost")
        require(sidecar["associations"][0]["observedIpv4"]==ip(999),"Final host original IPv4 wrong")
        require(sidecar["engineVerified"] is False,"Unverified last source elevated to Engine PASS")
        page.locator('[data-nmap-close="true"]').click()
        require(export_builder_source(page)==before,"1000-host review modified Builder")
        confirm_unchanged(page,scenario,errors,external)
        return {"case":"1000_source_hosts_final_ordinal999","status":"PASS",
                "lateOrdinal":999,"builderMutated":False,"externalRequests":0}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    url=urlsplit(args.url)
    require(url.scheme=="http" and url.hostname=="127.0.0.1" and url.port is not None and
            url.path=="/" and not url.query and not url.fragment and
            not url.username and not url.password,"Only compiled loopback YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:cases=[test_161(browser,args.url),test_1000(browser,args.url)]
        finally:browser.close()
    result={"status":"PASS","kind":"NMAP XML P3 compiled real Chromium 1000-host observation/reference windows",
            "platform":"Ubuntu GitHub Actions Chromium; native Parrot NOT_RUN",
            "cases":cases,"builderMutated":False}
    (args.evidence_dir/"nmap-xml-p3-chromium.json").write_text(json.dumps(result,indent=2)+"\n")
    print("PASS NMAP XML P3 actual Chromium")
    print(json.dumps(result,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("FAIL NMAP XML P3 Chromium "+str(exc),file=sys.stderr)
        raise

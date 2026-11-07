#!/usr/bin/env python3
"""ANSIBLE YAML P6: real compiled Chromium all 500 source positions with bounded UI and saved P5 replay."""
import argparse,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_ansible_yaml_p2_real_browser import setup,inspect,export_builder_source,unchanged,require

def inventory(count):
    return ("all:\n  hosts:\n"+"".join(f"    node{i:03d}: null\n" for i in range(count))).encode()

def source_file(page,raw):
    page.locator('[data-ansible-file="true"]').set_input_files({
       "name":"site.yml","mimeType":"text/plain","buffer":raw})
    expect(page.locator('[data-ansible-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=25000)

def next_page(page,expected):
    page.locator('[data-ansible-page-next="true"]').click()
    expect(page.locator('[data-ansible-association-page="'+str(expected)+'"]')).to_be_visible(timeout=15000)

def choose(page,selector,name,raw):
    page.locator(selector).set_input_files({"name":name,"mimeType":"application/octet-stream","buffer":raw})

def open_replay(page):
    menu=page.locator(".workspace-menu",has=page.locator("summary",has_text="Import / Export"))
    require(menu.count()==1,"Import/Export menu must be unique")
    if menu.get_attribute("open") is None:menu.locator("summary").click()
    menu.locator('[data-inspect-ansible-yaml-replay="CONFIG_DOCUMENTED"]').click()
    expect(page.locator('[data-ansible-yaml-replay-panel="CONFIG_DOCUMENTED"]')).to_be_visible(timeout=25000)

def test_late_and_replay(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_builder_source(page)
        raw=inventory(161);sha=hashlib.sha256(raw).hexdigest()
        inspect(page);source_file(page,raw)
        require(page.locator('[data-ansible-associate-host]').count()==80,
                "First window must render exactly 80 selectors")
        require(page.locator('[data-ansible-associate-host="80"]').count()==0,
                "Hidden source ordinal leaked into first window")
        require(page.locator('[data-ansible-page-previous]').is_disabled(),"Previous should be disabled")
        next_page(page,2)
        require(page.locator('[data-ansible-associate-host="80"]').count()==1,
                "Source ordinal 80 not reachable")
        require(page.locator('[data-ansible-associate-host="0"]').count()==0,
                "Previous window still rendered")
        next_page(page,3)
        expect(page.locator('[data-ansible-associate-host="160"]')).to_be_visible()
        require(page.locator('[data-ansible-associate-host]').count()==1,
                "Final window should show only last source host")
        require(page.locator('[data-ansible-page-next]').is_disabled(),
                "Next enabled past final host")
        page.locator('[data-ansible-associate-host="160"]').select_option("rds01")
        require(page.locator('[data-ansible-association-export]').is_disabled(),
                "Export without consent")
        # Navigation does not lose chosen late ordinal.
        page.locator('[data-ansible-page-previous]').click()
        page.locator('[data-ansible-page-previous]').click()
        expect(page.locator('[data-ansible-association-page="1"]')).to_be_visible()
        require(page.locator('[data-ansible-association-export]').is_disabled(),
                "Navigating cannot authorize export")
        page.locator('[data-ansible-association-ack]').check()
        with page.expect_download(timeout=25000) as dl:
            page.locator('[data-ansible-association-export]').click()
        saved=Path(dl.value.path()).read_bytes()
        sidecar=json.loads(saved)
        require(sidecar["formatId"]=="yadilab.ansible-inventory-associations","Format changed")
        require(sidecar["schemaVersion"]=="1.0.0" and sidecar["source"]["sha256"]==sha,
                "Original source identity lost")
        require(sidecar["targetModel"]["scenarioId"]==baseline["scenarioId"],"Model changed")
        require(not sidecar["engineVerified"] and not sidecar["physicalTopologyVerified"],
                "Source report gained unearned Engine truth")
        require(len(sidecar["associations"])==1 and sidecar["associations"][0]["hostOrdinal"]==160,
                "Late host ordinal was truncated or changed")
        host=sidecar["associations"][0]
        require(host["inventoryName"]=="node160","Wrong late source host identity")
        require(host["targetResourceId"]=="rds01" and host["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                "Missing explicit operator reference")
        require([loc["groupPath"] for loc in host["hostLocators"]]==["all"],
                "Late source group locator wrong")
        # Same file re-selection must revoke consent and mappings.
        source_file(page,raw)
        require(page.locator('[data-ansible-association-page="1"]').count()==1,
                "Source reselection did not reset pagination")
        require(not page.locator('[data-ansible-association-ack]').is_checked(),
                "Old consent retained")
        require(page.locator('[data-ansible-association-export]').is_disabled(),
                "Old consent allowed export")
        page.locator('[data-ansible-close="true"]').click()
        require(export_builder_source(page)==baseline,"Export changed original Builder")

        open_replay(page)
        choose(page,'[data-ansible-yaml-replay-original]','original.yml',raw)
        choose(page,'[data-ansible-yaml-replay-report]','late-p6.json',saved)
        require(page.locator('[data-ansible-yaml-replay-verify]').is_disabled(),"No automatic replay")
        page.locator('[data-ansible-yaml-replay-consent]').check()
        page.locator('[data-ansible-yaml-replay-verify]').click()
        expect(page.locator('[data-ansible-yaml-replay-result="REFERENCE_REPLAY_MATCH"]')).to_be_visible(timeout=25000)
        require(page.locator('[data-ansible-yaml-replay-count="1"]').count()==1,"Wrong late replay count")
        require(sha in page.locator('[data-ansible-yaml-replay-sha]').inner_text(),"Late replay SHA wrong")
        choose(page,'[data-ansible-yaml-replay-original]','original.yml',inventory(160))
        require(page.locator('[data-ansible-yaml-replay-result]').count()==0,"Stale MATCH not cleared")
        require(not page.locator('[data-ansible-yaml-replay-consent]').is_checked(),"Consent not reset")
        page.locator('[data-ansible-yaml-replay-consent]').check()
        page.locator('[data-ansible-yaml-replay-verify]').click()
        expect(page.locator('[data-ansible-yaml-replay-error="BLOCKED"]')).to_have_text(
            "ANSIBLE_YAML_REPLAY_SOURCE_CHANGED",timeout=25000)
        page.locator('[data-ansible-yaml-replay-close]').click()
        require(export_builder_source(page)==baseline,"Replay changed original Builder")
        unchanged(page,scenario,errors,external)
        return {"case":"161_host_late_ordinal_p4_export_p5_replay","status":"PASS","lateOrdinal":160,
                "sourceGroupPath":"all","sourceSha256":sha,"builderUnchanged":True}
    finally:page.close()

def test_maximum(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_builder_source(page)
        raw=inventory(500)
        inspect(page);source_file(page,raw)
        for expected in range(2,8):next_page(page,expected)
        require(page.locator('[data-ansible-associate-host]').count()==20,
                "500-host last window must have 20 selectors")
        expect(page.locator('[data-ansible-associate-host="499"]')).to_be_visible()
        require(page.locator('[data-ansible-page-next]').is_disabled(),"Page exceeded parser maximum")
        page.locator('[data-ansible-associate-host="499"]').select_option("rds01")
        page.locator('[data-ansible-association-ack]').check()
        with page.expect_download(timeout=25000) as dl:
            page.locator('[data-ansible-association-export]').click()
        sidecar=json.loads(Path(dl.value.path()).read_bytes())
        require(sidecar["associations"][0]["hostOrdinal"]==499 and
                sidecar["associations"][0]["hostLocators"][0]["groupPath"]=="all",
                "Last valid host source identity lost")
        page.locator('[data-ansible-close="true"]').click()
        require(export_builder_source(page)==baseline,"500-host export mutated Builder")
        unchanged(page,scenario,errors,external)
        return {"case":"500_host_final_window_last_ordinal","status":"PASS",
                "lateOrdinal":499,"sourceGroupPath":"all","builderUnchanged":True}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
            "Only compiled local YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[test_late_and_replay(browser,args.url),test_maximum(browser,args.url)]
        finally:browser.close()
    out={"status":"PASS","kind":"ANSIBLE-YAML-P6 real compiled Chromium 161/500 host paging P4/P5",
         "platform":"Ubuntu GitHub Actions Chromium, Parrot NOT_RUN","cases":cases,"builderMutated":False}
    (args.evidence_dir/"ansible-yaml-p6-chromium.json").write_text(json.dumps(out,indent=2)+"\n")
    print("PASS ANSIBLE YAML P6 compiled Chromium")
    print(json.dumps(out,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as err:
        print("FAIL ANSIBLE YAML P6 Chromium "+str(err),file=sys.stderr)
        raise

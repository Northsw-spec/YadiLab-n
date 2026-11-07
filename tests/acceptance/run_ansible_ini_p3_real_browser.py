#!/usr/bin/env python3
"""Actual Chromium against compiled YadiLab: reviewed INI sidecar, consent and no mutation."""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from target_platform_identity import describe_local_host

ROOT=Path(__file__).resolve().parents[2]
FIXTURES=ROOT/"tests/fixtures/import/ansible-ini"
def require(x,msg):
    if not x: raise AssertionError(msg)
def setup(browser,url):
    page=browser.new_page(accept_downloads=True,viewport={"width":1500,"height":1000})
    errors=[];external=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.on("request",lambda request:external.append(request.url) if not (
        request.url.startswith(url) or request.url.startswith("data:") or request.url.startswith("blob:")) else None)
    page.goto(url,wait_until="domcontentloaded",timeout=25000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    return page,page.locator(".app-frame").get_attribute("data-runtime-scenario-id"),errors,external
def menu(page):
    m=page.locator(".workspace-menu",has=page.locator("summary",has_text="Import / Export"))
    require(m.count()==1,"Import/Export menu unavailable")
    if m.get_attribute("open") is None:m.locator("summary").click()
    return m
def export_source(page):
    with page.expect_download(timeout=20000) as d:menu(page).get_by_role("button",name="Exportera källfil").click()
    return json.loads(Path(d.value.path()).read_text())
def inspect(page):
    menu(page).locator('[data-inspect-ansible-ini="CONFIG_DOCUMENTED"]').click()
    page.locator('[data-ansible-ini-panel="CONFIG_DOCUMENTED"]').wait_for(timeout=16000)
def upload(page,name):
    page.locator('[data-ansible-ini-file="true"]').set_input_files(str(FIXTURES/name))
def unchanged(page,scenario,errors,external):
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")==scenario,"Scenario mutated")
    require(not errors,"Browser page errors "+repr(errors))
    require(not external,"External requests "+repr(external))
    require(page.locator('[data-ansible-ini-activate], [data-ansible-ini-import]').count()==0,"Activation path appeared")
def case_download(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_source(page)
        require(any(r["id"]=="rds01" for r in baseline["resources"]),"Existing modeled target missing")
        inspect(page);upload(page,"valid-multigroup.ini")
        page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]').wait_for(timeout=15000)
        select=page.locator('[data-ansible-ini-associate-host="0"]')
        button=page.locator('[data-ansible-ini-association-export]')
        require(select.input_value()=="" and button.is_disabled(),"Default not unlinked or export enabled")
        select.select_option("rds01")
        require(button.is_disabled(),"Export allowed before consent")
        page.locator('[data-ansible-ini-association-ack]').check()
        require(button.is_enabled(),"Export not allowed after explicit consent")
        with page.expect_download(timeout=20000) as d:button.click()
        sidecar=json.loads(Path(d.value.path()).read_text())
        sha=hashlib.sha256((FIXTURES/"valid-multigroup.ini").read_bytes()).hexdigest()
        require(sidecar["formatId"]=="yadilab.ansible-ini-inventory-associations","Wrong JSON format")
        require(sidecar["schemaVersion"]=="1.0.0" and sidecar["status"]=="REVIEWED_ASSOCIATIONS_ONLY","Wrong version/status")
        require(sidecar["engineVerified"] is False and sidecar["physicalTopologyVerified"] is False,"False verified Engine assertion")
        require(sidecar["source"]=={"profileId":"ansible.inventory.static.ini.v1","sha256":sha,
            "semanticTrack":"CONFIG_DOCUMENTED"},"Original source hash wrong")
        require(sidecar["targetModel"]["scenarioId"]==scenario,"Wrong target scenario")
        require(len(sidecar["associations"])==1,"Automated association without selection")
        h=sidecar["associations"][0]
        require(h["hostOrdinal"]==0 and h["inventoryName"]=="app01","Wrong original host")
        require(h["addressTruth"]=="REPORTED_NOT_VERIFIED" and h["reportedConnectionAddress"]=="203.0.113.10","Address falsely verified")
        require(h["directGroups"]==["east","west"],"Lost original direct groups")
        require(h["hostLocators"]==[
            {"kind":"ansible-ini-host","sourceSha256":sha,"lineNumber":2,"section":"east","hostKey":"app01"},
            {"kind":"ansible-ini-host","sourceSha256":sha,"lineNumber":6,"section":"west","hostKey":"app01"}],
            "Original typed source locators wrong")
        require(h["targetResourceId"]=="rds01" and h["assertion"]=="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED","Human decision missing")
        for key in ("resources","connections","links","scenario","engineState","vars","tasks","credentials"):
            require(key not in sidecar,"Prohibited raw source or Engine data: "+key)
        page.locator('[data-ansible-ini-associate-host="1"]').select_option("rds01")
        require(page.locator('[data-ansible-ini-association-conflict="BLOCKED"]').count()==1,"Duplicate resource conflict not blocked")
        require(button.is_disabled(),"Duplicate target export still enabled")
        unchanged(page,scenario,errors,external)
        page.locator('[data-ansible-ini-close="true"]').click()
        require(export_source(page)==baseline,"Original Builder scenario changed")
        return {"case":"sidecar_download_multigroup_original_sha_duplicate_block","status":"PASS","builderUnchanged":True}
    finally:page.close()
def case_secrets_switch(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_source(page)
        inspect(page);upload(page,"valid-sensitive-vars.ini")
        page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]').wait_for(timeout=15000)
        for token in ("SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
                      "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary"):
            require(token not in page.locator('[data-ansible-ini-panel]').inner_html(),"DOM leaked secret "+token)
        page.locator('[data-ansible-ini-associate-host="0"]').select_option("rds01")
        page.locator('[data-ansible-ini-association-ack]').check()
        with page.expect_download(timeout=20000) as d:
            page.locator('[data-ansible-ini-association-export]').click()
        raw=Path(d.value.path()).read_text()
        for token in ("SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
                      "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary"):
            require(token not in raw,"Exported JSON leaked secret "+token)
        upload(page,"valid-ungrouped.ini")
        expect(page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=15000)
        require(page.locator('[data-ansible-ini-associate-host="0"]').input_value()=="","Source switch leaked previous choice")
        require(not page.locator('[data-ansible-ini-association-ack]').is_checked(),"Previous consent survived new file")
        require(page.locator('[data-ansible-ini-association-export]').is_disabled(),"New source implicitly approved")
        unchanged(page,scenario,errors,external)
        page.locator('[data-ansible-ini-close="true"]').click()
        require(export_source(page)==baseline,"Original Builder changed in sensitive source test")
        return {"case":"secret_exclusion_and_file_switch_resets_consent","status":"PASS","builderUnchanged":True}
    finally:page.close()
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",type=Path,required=True)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
      and u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,"Only local Chromium")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    results=[]
    with sync_playwright() as p:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=flags)
        try:
            for test in (case_download,case_secrets_switch):
                result=test(browser,args.url)
                results.append(result)
                print("PASS ANSIBLE-INI-P3 real Chromium "+result["case"],flush=True)
        finally:browser.close()
    host=describe_local_host()
    report={"status":"PASS","kind":"actual compiled YadiLab interactive Chromium",
      "platform":host["osPrettyName"],"osId":host["osId"],
      "actualParrotHost":host["actualParrotHost"],"cases":results}
    (args.evidence_dir/"ansible-ini-p3-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as err:
        print("FAIL ANSIBLE-INI-P3 Chromium: "+str(err),file=sys.stderr)
        raise

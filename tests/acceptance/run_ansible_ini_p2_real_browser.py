#!/usr/bin/env python3
"""Actual compiled-YadiLab Chromium acceptance for isolated Ansible INI read-only UI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from target_platform_identity import describe_local_host

ROOT=Path(__file__).resolve().parents[2]
FIXTURES=ROOT/"tests/fixtures/import/ansible-ini"
ORACLES=json.loads((FIXTURES/"oracles.json").read_text())

def require(condition, message):
    if not condition:
        raise AssertionError(message)

def setup(browser,url):
    page=browser.new_page(accept_downloads=True,viewport={"width":1500,"height":1000})
    errors=[]
    external=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.on("request",lambda request: external.append(request.url) if not (
        request.url.startswith(url) or request.url.startswith("data:") or
        request.url.startswith("blob:")) else None)
    page.goto(url,wait_until="domcontentloaded",timeout=25000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    scenario=page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
    return page,scenario,errors,external

def menu(page):
    item=page.locator(".workspace-menu",has=page.locator("summary",has_text="Import / Export"))
    require(item.count()==1,"Import / Export menu missing or ambiguous")
    if item.get_attribute("open") is None:
        item.locator("summary").click()
    return item

def export_builder_source(page):
    with page.expect_download(timeout=20000) as d:
        menu(page).get_by_role("button",name="Exportera källfil").click()
    return json.loads(Path(d.value.path()).read_text())

def inspect(page):
    menu(page).locator('[data-inspect-ansible-ini="CONFIG_DOCUMENTED"]').click()
    page.locator('[data-ansible-ini-panel="CONFIG_DOCUMENTED"]').wait_for(timeout=15000)

def upload(page,filename):
    page.locator('[data-ansible-ini-file="true"]').set_input_files(str(FIXTURES/filename))

def unchanged(page,scenario,errors,external):
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")==scenario,
            "INI inventory inspection changed active scenario")
    require(page.locator('[data-ansible-ini-import], [data-ansible-ini-activate], [data-ansible-ini-associate]').count()==0,
            "INI UI exposes forbidden scenario/association action")
    require(not errors,"Browser JS error(s): "+repr(errors))
    require(not external,"Unexpected external request(s): "+repr(external))

def case_ungrouped_and_cancel(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_builder_source(page)
        inspect(page)
        upload(page,"valid-ungrouped.ini")
        preview=page.locator('[data-ansible-ini-preview="CONFIG_DOCUMENTED"]')
        preview.wait_for(timeout=16000)
        require(page.locator('[data-ansible-ini-host]').count()==4,"Wrong host count")
        data=preview.inner_text()
        for token in ["Declared hosts: 4","declared groups: 2","jump01","app01","app02",
                      "db01","192.0.2.11","203.0.113.10","198.51.100.7",
                      "Direct inventory groups: ungrouped","Address status: UNKNOWN",
                      "Original source lines: 2","NOT verified physical assets"]:
            require(token in data,"Missing frozen INI fact "+token)
        require(hashlib.sha256((FIXTURES/"valid-ungrouped.ini").read_bytes()).hexdigest()
                in page.locator('[data-ansible-ini-source-hash]').inner_text(),"Original bytes SHA missing")
        require(page.locator('[data-ansible-ini-activation-status="BLOCKED"]').count()==1,
                "No read-only epistemic boundary")
        unchanged(page,scenario,errors,external)
        page.locator('[data-ansible-ini-close="true"]').click()
        page.locator('[data-ansible-ini-panel]').wait_for(state="detached")
        after=export_builder_source(page)
        require(after==baseline,"Builder export mutated by INI preview/cancel")
        unchanged(page,scenario,errors,external)
        return {"case":"ungrouped_exact_preview_and_cancel","status":"PASS","builderUnchanged":True}
    finally: page.close()

def case_hierarchy_multigroup(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        inspect(page)
        upload(page,"valid-hierarchy.ini")
        preview=page.locator('[data-ansible-ini-preview="CONFIG_DOCUMENTED"]')
        expect(page.locator('[data-ansible-ini-host]')).to_have_count(3,timeout=15000)
        for token in ["site","child groups: routers, servers","rtr01","app01","app02",
                      "192.0.2.1","192.0.2.20","Address status: UNKNOWN"]:
            require(token in preview.inner_text(),"Missing hierarchy datum "+token)
        unchanged(page,scenario,errors,external)
        upload(page,"valid-multigroup.ini")
        expect(page.locator('[data-ansible-ini-host]')).to_have_count(2,timeout=15000)
        require("Direct inventory groups: east, west" in page.locator('[data-ansible-ini-host="0"]').inner_text(),
                "Duplicate inventory group membership lost")
        require("Original source lines: 2, 6" in page.locator('[data-ansible-ini-host="0"]').inner_text(),
                "Typed source provenance lines wrong")
        require("rtr01" not in page.locator('[data-ansible-ini-preview]').inner_text(),
                "Stale hierarchy preview survived file switch")
        unchanged(page,scenario,errors,external)
        page.locator('[data-ansible-ini-close="true"]').click()
        return {"case":"declared_group_hierarchy_and_multigroup","status":"PASS","autoLinks":0}
    finally:page.close()

def case_redaction_negative_and_recovery(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        baseline=export_builder_source(page)
        inspect(page)
        upload(page,"valid-sensitive-vars.ini")
        preview=page.locator('[data-ansible-ini-preview="CONFIG_DOCUMENTED"]')
        preview.wait_for(timeout=15000)
        require("203.0.113.25" in preview.inner_text(),"Reported address omitted")
        html=page.locator('[data-ansible-ini-panel]').inner_html()
        for secret in ["SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
                       "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary"]:
            require(secret not in html,"Sensitive source value leaked to DOM "+secret)
        require("ANSIBLE_INI_VARIABLES_NOT_IMPORTED" in html,"Redaction diagnostic missing")
        unchanged(page,scenario,errors,external)
        for item in ORACLES["negatives"]:
            upload(page,item["file"])
            err=page.locator('[data-ansible-ini-error="BLOCKED"]')
            expect(err).to_contain_text(item["code"],timeout=14000)
            require(page.locator('[data-ansible-ini-preview]').count()==0,
                    "Partial/stale preview survived rejected INI source "+item["file"])
            unchanged(page,scenario,errors,external)
        upload(page,"valid-comments.ini")
        expect(page.locator('[data-ansible-ini-preview="CONFIG_DOCUMENTED"]')).to_be_visible(timeout=15000)
        require(page.locator('[data-ansible-ini-error]').count()==0,"Stale error remains on recovery")
        require(page.locator('[data-ansible-ini-host]').count()==2,"Valid recovery host count wrong")
        page.locator('[data-ansible-ini-close="true"]').click()
        after=export_builder_source(page)
        require(after==baseline,"Builder export changed after hostile input/recovery")
        unchanged(page,scenario,errors,external)
        return {"case":"secret_redaction_all_12_negative_and_recovery","status":"PASS","rejected":12,"builderUnchanged":True}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
    a=p.parse_args()
    origin=urlsplit(a.url)
    require(origin.scheme=="http" and origin.hostname=="127.0.0.1" and origin.port is not None
            and origin.path=="/" and not origin.query and not origin.fragment
            and not origin.username and not origin.password,"Chromium MUST test loopback localhost application")
    a.evidence_dir.mkdir(parents=True,exist_ok=True)
    checks=[]
    with sync_playwright() as playwright:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:
            for fn in (case_ungrouped_and_cancel,case_hierarchy_multigroup,case_redaction_negative_and_recovery):
                outcome=fn(browser,a.url)
                checks.append(outcome)
                print("PASS ANSIBLE-INI-P2 real Chromium "+outcome["case"],flush=True)
        finally:browser.close()
    host=describe_local_host()
    report={"status":"PASS","kind":"real compiled YadiLab app and Chromium interaction",
            "environment":host["osPrettyName"],"osId":host["osId"],
            "actualParrotHost":host["actualParrotHost"],"cases":checks,
            "builderOrEngineModified":False}
    (a.evidence_dir/"ansible-ini-p2-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL ANSIBLE-INI-P2 real Chromium: "+str(error),file=sys.stderr)
        raise

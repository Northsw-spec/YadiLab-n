#!/usr/bin/env python3
"""Ansible INI P4: real compiled Chromium original source and live Builder export gate."""
import argparse,hashlib,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_ansible_ini_p3_real_browser import setup,menu,inspect,upload,export_source,unchanged,FIXTURES,require

def run(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        inspect(page);upload(page,"valid-multigroup.ini")
        expect(page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        first=page.locator('[data-ansible-ini-associate-host="0"]')
        require(first.input_value()=="","Automatic association forbidden")
        first.select_option("rds01")
        require(page.locator('[data-ansible-ini-association-export]').is_disabled(),"Consent required")
        page.locator('[data-ansible-ini-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-ansible-ini-association-export]').click()
        sidecar=json.loads(Path(download.value.path()).read_text(encoding="utf-8"))
        sha=hashlib.sha256((FIXTURES/"valid-multigroup.ini").read_bytes()).hexdigest()
        require(sidecar["formatId"]=="yadilab.ansible-ini-inventory-associations","Wrong P3 sidecar")
        require(sidecar["schemaVersion"]=="1.0.0" and sidecar["status"]=="REVIEWED_ASSOCIATIONS_ONLY","Changed schema")
        require(sidecar["source"]["sha256"]==sha,"Not exact original source hash")
        require(sidecar["targetModel"]["scenarioId"]==before["scenarioId"],"Wrong Builder")
        require(not sidecar["engineVerified"] and not sidecar["physicalTopologyVerified"],"False Engine or physical truth")
        require(len(sidecar["associations"])==1,"Unreviewed host was associated")
        require(sidecar["associations"][0]["targetResourceId"]=="rds01","Wrong target ID")
        require([x["lineNumber"] for x in sidecar["associations"][0]["hostLocators"]]==[2,6],
                "Original source line provenance changed")
        # Same filename/hash must still revoke all prior human choices.
        upload(page,"valid-multigroup.ini")
        expect(page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        require(first.input_value()=="","Old mapping carried into identical new selection")
        require(not page.locator('[data-ansible-ini-association-ack]').is_checked(),
                "Old consent retained for identical source bytes")
        require(page.locator('[data-ansible-ini-association-export]').is_disabled(),
                "Old association exported on same source reselection")
        upload(page,"valid-ungrouped.ini")
        expect(page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        require(first.input_value()=="","Changing source retained old target")
        require(not page.locator('[data-ansible-ini-association-ack]').is_checked(),
                "Changing source retained old consent")
        upload(page,"invalid-duplicate-section.ini")
        expect(page.locator('[data-ansible-ini-error="BLOCKED"]')).to_contain_text(
            "ANSIBLE_INI_SECTION_DUPLICATE",timeout=20000)
        require(page.locator('[data-ansible-ini-association-review]').count()==0,
                "Invalid input retained prior valid source")
        upload(page,"valid-sensitive-vars.ini")
        expect(page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        for token in ["SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
                      "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary"]:
            require(token not in page.locator('[data-ansible-ini-panel]').inner_html(),
                    "Sensitive variable leaked to DOM")
        page.locator('[data-ansible-ini-associate-host="0"]').select_option("rds01")
        page.locator('[data-ansible-ini-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-ansible-ini-association-export]').click()
        raw=Path(download.value.path()).read_text(encoding="utf-8")
        for token in ["SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
                      "SECRET_INI_BECOME_CANARY_DONT_EXPORT","private_key_canary"]:
            require(token not in raw,"Private data leaked into P4 sidecar")
        unchanged(page,scenario,errors,external)
        page.locator('[data-ansible-ini-close="true"]').click()
        require(export_source(page)==before,"P4 mutated original Builder")
        inspect(page)
        require(page.locator('[data-ansible-ini-association-review]').count()==0,
                "Old source persisted after modal close/reopen")
        page.locator('[data-ansible-ini-close="true"]').click()
        return {"case":"p4_original_byte_bound_reselection_invalid_sources_redaction",
                "status":"PASS","originalSourceSha256":sha,
                "sameSourceReplacementClearsConsent":True,
                "duplicateINISectionBlocked":True,"privateVarsExported":False,
                "builderUnchanged":True,"externalRequests":0}
    finally:page.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",required=True)
    parser.add_argument("--evidence-dir",required=True,type=Path)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
            "Only local compiled YadiLab allowed")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[run(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"Ansible INI P4 actual compiled Chromium source revalidation",
            "platform":"GitHub Ubuntu Chromium, NOT user Parrot","cases":cases,"builderMutated":False}
    (args.evidence_dir/"ansible-ini-p4-chromium.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS ANSIBLE INI P4 real Chromium")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as err:
        print("FAIL ANSIBLE INI P4 Chromium "+str(err),file=sys.stderr)
        raise

#!/usr/bin/env python3
"""ANSIBLE YAML P4 exact-source export gate in compiled real YadiLab Chromium."""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from run_ansible_yaml_p2_real_browser import (
    setup, inspect, select, unchanged, export_builder_source, FIXTURES, require
)

def test_case(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_builder_source(page)
        sha=hashlib.sha256((FIXTURES/"valid-nested.yml").read_bytes()).hexdigest()
        inspect(page)
        select(page,"valid-nested.yml")
        expect(page.locator('[data-ansible-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        original=page.locator('[data-ansible-associate-host="0"]')
        require(original.input_value()=="","Unexpected automatic match")
        original.select_option("rds01")
        require(page.locator('[data-ansible-association-export]').is_disabled(),"Consent required")
        page.locator('[data-ansible-association-ack]').check()
        with page.expect_download(timeout=25000) as dl:
            page.locator('[data-ansible-association-export]').click()
        report=json.loads(Path(dl.value.path()).read_text(encoding="utf-8"))
        require(report["formatId"]=="yadilab.ansible-inventory-associations","Wrong sidecar schema")
        require(report["status"]=="REVIEWED_ASSOCIATIONS_ONLY","False verification claim")
        require(report["source"]["sha256"]==sha,"Original full source SHA changed")
        require(report["targetModel"]["scenarioId"]==before["scenarioId"],"Builder identity mismatch")
        require(len(report["associations"])==1,"Unexpected source-side associations")
        require(report["associations"][0]["targetResourceId"]=="rds01","Lost explicit target")
        for key in ["engineVerified","physicalTopologyVerified"]:
            require(report[key] is False,"False Engine/network verification")
        select(page,"valid-nested.yml")
        expect(page.locator('[data-ansible-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        require(page.locator('[data-ansible-associate-host="0"]').input_value()=="",
                "Replacing same SHA/source retained earlier reference")
        require(not page.locator('[data-ansible-association-ack]').is_checked(),
                "Replacing identical source retained consent")
        require(page.locator('[data-ansible-association-export]').is_disabled(),
                "Replacing identical source retained export")
        select(page,"valid-repeated-host.yml")
        expect(page.locator('[data-ansible-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        require(page.locator('[data-ansible-associate-host="0"]').input_value()=="",
                "Changed-source selection retained old target")
        require(not page.locator('[data-ansible-association-ack]').is_checked(),
                "Changing original source retained consent")
        select(page,"invalid-alias.yml")
        expect(page.locator('[data-ansible-error="BLOCKED"]')).to_contain_text(
            "ANSIBLE_YAML_ALIAS_FORBIDDEN",timeout=25000)
        require(page.locator('[data-ansible-association-review]').count()==0,
                "Previous valid source survived hostile YAML")
        select(page,"valid-sensitive-vars.yml")
        expect(page.locator('[data-ansible-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=20000)
        html=page.locator('[data-ansible-panel]').inner_html()
        for token in ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
                      "SYNTHETIC_TOKEN_CANARY_NOT_REAL","ansible_password"]:
            require(token not in html,"Confidential YAML value reached DOM "+token)
        page.locator('[data-ansible-associate-host="0"]').select_option("firewall01")
        page.locator('[data-ansible-association-ack]').check()
        with page.expect_download(timeout=25000) as dl2:
            page.locator('[data-ansible-association-export]').click()
        private_report=Path(dl2.value.path()).read_text(encoding="utf-8")
        for token in ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
                      "SYNTHETIC_TOKEN_CANARY_NOT_REAL","ansible_password"]:
            require(token not in private_report,"Credential leaked to report "+token)
        page.locator('[data-ansible-close="true"]').click()
        expect(page.locator('[data-ansible-panel]')).to_have_count(0)
        require(export_builder_source(page)==before,"YAML P4 mutated canonical Builder source")
        unchanged(page,scenario,errors,external)
        inspect(page)
        require(page.locator('[data-ansible-association-review]').count()==0,
                "Old source/consent survived modal reopening")
        page.locator('[data-ansible-close="true"]').click()
        return {"case":"yaml_p4_original_source_rechecked_reselection_consent_redaction",
                "status":"PASS","originalSha256":sha,"originalBuilderUnchanged":True,
                "sourceReplacementClearsConsent":True,"credentialDataExported":False,
                "externalNetworkRequests":0}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
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
        try:cases=[test_case(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"ANSIBLE-YAML-P4 compiled Chromium original-byte source-bound associations",
      "platform":"GitHub Ubuntu Chromium, not user Parrot","cases":cases,"builderMutated":False}
    (args.evidence_dir/"ansible-yaml-p4-real-chromium.json").write_text(
      json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS ANSIBLE YAML P4 compiled Chromium",flush=True)
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    try: main()
    except Exception as error:
        print("FAIL ANSIBLE YAML P4 compiled Chromium "+str(error),file=sys.stderr)
        raise

#!/usr/bin/env python3
"""Actual Chromium / React acceptance: static Ansible inventory read-only import.

No source-only assertions, mock UI, remote Ansible execution or created links.
Real file upload and change/cancel tests against a built YadiLab release.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/import/ansible-yaml"


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def setup(browser, url):
    page = browser.new_page(accept_downloads=True, viewport={"width": 1500, "height": 1000})
    errors = []
    external = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request:
        external.append(request.url) if not (
            request.url.startswith(url) or request.url.startswith("data:") or
            request.url.startswith("blob:")) else None)
    page.goto(url, wait_until="domcontentloaded", timeout=25000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    scenario = page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
    return page, scenario, errors, external


def inspect(page):
    menu = page.locator(".workspace-menu", has=page.locator("summary", has_text="Import / Export"))
    require(menu.count() == 1, "Expected a unique Import / Export menu")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    menu.locator('[data-inspect-ansible="CONFIG_DOCUMENTED"]').click()
    page.locator('[data-ansible-panel="CONFIG_DOCUMENTED"]').wait_for(timeout=12000)


def select(page, name):
    page.locator('[data-ansible-file="true"]').set_input_files(str(FIXTURES / name))


def unchanged(page, base, errors, external):
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id") == base,
            "YAML inspection changed active scenario")
    require(page.locator('[data-ansible-import], [data-ansible-activate]').count() == 0,
            "Unexpected activation route")
    require(not errors, "Browser JS errors " + repr(errors))
    require(not external, "External request from YAML inspection " + repr(external))


def case_nested_cancel(browser, url):
    page, base, errors, external = setup(browser,url)
    try:
        inspect(page)
        select(page,"valid-nested.yml")
        page.locator('[data-ansible-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=12000)
        summary = page.locator('[data-ansible-summary="true"]').inner_text()
        require("Declared hosts: 4" in summary and "declared groups: 3" in summary,
                "Inventory host/group count did not match frozen oracle")
        require(page.locator('[data-ansible-host]').count() == 4, "All four host rows required")
        data=page.locator('[data-ansible-preview]').inner_text()
        for token in ["control01","rtr01","app01","app02","192.0.2.10",
                      "198.51.100.20","all/routers","all/servers","Address status: UNKNOWN"]:
            require(token in data, "Missing declared inventory datum " + token)
        expectedHash=hashlib.sha256((FIXTURES/"valid-nested.yml").read_bytes()).hexdigest()
        require(expectedHash in page.locator('[data-ansible-source-hash]').inner_text(),
                "Original source byte identity was not preserved")
        require(page.locator('[data-ansible-activation-status="BLOCKED"]').count() == 1,
                "Read-only epistemic boundary absent")
        unchanged(page,base,errors,external)
        page.locator('[data-ansible-close="true"]').click()
        page.locator('[data-ansible-panel]').wait_for(state="detached")
        unchanged(page,base,errors,external)
        return {"case":"nested_preview_and_cancel","status":"PASS","workspaceUnchanged":True}
    finally:
        page.close()


def case_redaction_and_repeated_membership(browser, url):
    page, base, errors, external=setup(browser,url)
    try:
        inspect(page)
        select(page,"valid-sensitive-vars.yml")
        page.locator('[data-ansible-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=12000)
        data=page.locator('[data-ansible-panel]').inner_text()
        require("203.0.113.10" in data,"Reported declared address missing")
        for secret in ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
                       "SYNTHETIC_TOKEN_CANARY_NOT_REAL","synthetic_admin"]:
            require(secret not in data,"Sensitive Ansible var leaked to React text: " + secret)
            require(secret not in page.locator('[data-ansible-panel]').inner_html(),
                    "Sensitive Ansible var leaked to DOM HTML: " + secret)
        require("ANSIBLE_YAML_VARIABLES_NOT_IMPORTED" in data,
                "Variable-redaction diagnostic missing")
        unchanged(page,base,errors,external)
        select(page,"valid-repeated-host.yml")
        page.locator('[data-ansible-preview="CONFIG_DOCUMENTED"]').wait_for(timeout=12000)
        require(page.locator('[data-ansible-host]').count()==2,
                "Repeated same host must not create duplicate assets")
        require("all/east, all/west" in page.locator('[data-ansible-host="0"]').inner_text(),
                "Legitimate multi-group membership was lost")
        unchanged(page,base,errors,external)
        page.locator('[data-ansible-close="true"]').click()
        return {"case":"redaction_and_multi_group","status":"PASS","externalRequests":0}
    finally:
        page.close()


def case_invalid_sources(browser,url):
    page,base,errors,external=setup(browser,url)
    try:
        inspect(page)
        for filename, expected in [
            ("invalid-dynamic-plugin.yml","ANSIBLE_YAML_ROOT_INVALID"),
            ("invalid-playbook.yml","ANSIBLE_YAML_EXPECTED_MAPPING"),
            ("invalid-duplicate-key.yml","ANSIBLE_YAML_PARSE_INVALID"),
            ("invalid-alias.yml","ANSIBLE_YAML_ALIAS_FORBIDDEN"),
            ("invalid-nonscalar-address.yml","ANSIBLE_YAML_ADDRESS_UNSUPPORTED"),
        ]:
            select(page,filename)
            err=page.locator('[data-ansible-error="BLOCKED"]')
            err.wait_for(timeout=12000)
            require(expected in err.inner_text(),
                    "Wrong error for " + filename + ": " + err.inner_text())
            require(page.locator('[data-ansible-preview]').count()==0,
                    "Stale/partial valid preview leaked when unsafe YAML rejected")
            unchanged(page,base,errors,external)
        page.locator('[data-ansible-close="true"]').click()
        page.locator('[data-ansible-panel]').wait_for(state="detached")
        unchanged(page,base,errors,external)
        return {"case":"unsafe_yaml_blocked","status":"PASS","workspaceUnchanged":True}
    finally:
        page.close()


def export_builder_source(page):
    menu = page.locator(".workspace-menu", has=page.locator("summary", has_text="Import / Export"))
    require(menu.count() == 1, "Import / Export menu not found")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    export = menu.get_by_role("button", name="Exportera källfil")
    export.wait_for(state="visible", timeout=15000)
    with page.expect_download(timeout=15000) as downloaded:
        export.click()
    return json.loads(Path(downloaded.value.path()).read_text())


def case_reviewed_sidecar(browser, url):
    page, base, errors, external = setup(browser, url)
    try:
        before = export_builder_source(page)
        require(before["scenarioId"] == base, "Builder source does not match loaded scenario")
        require(any(x["id"] == "rds01" for x in before["resources"]),
                "Existing target resource rds01 is missing; cannot run independent test")
        inspect(page)
        select(page, "valid-nested.yml")
        page.locator('[data-ansible-association-review="REVIEW_REQUIRED"]').wait_for(timeout=15000)
        require(page.locator('[data-ansible-associate-host="0"]').input_value() == "",
                "Ansible inventory host was associated without explicit user choice")
        require(page.locator('[data-ansible-association-export]').is_disabled(),
                "Association export must initially be disabled")
        page.locator('[data-ansible-associate-host="0"]').select_option("rds01")
        require(page.locator('[data-ansible-association-export]').is_disabled(),
                "Association without unverified-identity consent was allowed")
        page.locator('[data-ansible-association-ack]').check()
        require(page.locator('[data-ansible-association-export]').is_enabled(),
                "Explicitly reviewed association cannot be exported")
        with page.expect_download(timeout=20000) as downloaded:
            page.locator('[data-ansible-association-export]').click()
        sidecar = json.loads(Path(downloaded.value.path()).read_text())
        require(sidecar["formatId"] == "yadilab.ansible-inventory-associations", "Wrong sidecar format")
        require(sidecar["schemaVersion"] == "1.0.0", "Wrong sidecar schema")
        require(sidecar["status"] == "REVIEWED_ASSOCIATIONS_ONLY", "Sidecar was promoted to Engine")
        require(sidecar["engineVerified"] is False and sidecar["physicalTopologyVerified"] is False,
                "Source declarations must NOT become verified infrastructure truth")
        require(sidecar["source"]["sha256"] == hashlib.sha256(
            (FIXTURES / "valid-nested.yml").read_bytes()).hexdigest(),
            "Original YAML source SHA-256 was lost")
        require(sidecar["source"]["semanticTrack"] == "CONFIG_DOCUMENTED",
                "Ansible inventory was classified as verified topology")
        require(sidecar["targetModel"]["scenarioId"] == base,
                "Destination Builder model identity mismatched")
        require(len(sidecar["associations"]) == 1, "Unreviewed inventory hosts were associated")
        association = sidecar["associations"][0]
        require(association["hostOrdinal"] == 0 and association["inventoryName"] == "control01",
                "Wrong original inventory host")
        require(association["reportedConnectionAddress"] == "192.0.2.10",
                "Declared connection address was changed")
        require(association["addressTruth"] == "REPORTED_NOT_VERIFIED", "IP was falsely verified")
        require(association["hostLocators"] == [{
            "kind": "ansible-yaml-host", "sourceSha256": sidecar["source"]["sha256"],
            "groupPath": "all", "hostKey": "control01"
        }], "Original typed host YAML locator was not preserved")
        require(association["targetResourceId"] == "rds01", "Wrong selected modeled resource")
        require(association["assertion"] == "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                "Unverified-identity assertion missing")
        for key in ["connections", "resources", "engineState", "vars", "tasks"]:
            require(key not in sidecar, "ScenarioSource/Ansible secrets leaked to sidecar: " + key)
        page.locator('[data-ansible-associate-host="1"]').select_option("rds01")
        require(page.locator('[data-ansible-association-conflict="BLOCKED"]').count() == 1,
                "Two hosts assigned to same resource were not rejected")
        require(page.locator('[data-ansible-association-export]').is_disabled(),
                "Duplicate resource conflict did not disable export")
        unchanged(page,base,errors,external)
        page.locator('[data-ansible-close="true"]').click()
        page.locator('[data-ansible-panel]').wait_for(state="detached")
        after = export_builder_source(page)
        require(after == before, "Inventory review mutated the original Builder scenario")
        unchanged(page,base,errors,external)
        return {"case":"reviewed_sidecar_export_and_conflict","status":"PASS",
                "originalBuilderUnchanged":True,"associations":1,"autoLinks":0}
    finally:
        page.close()


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",type=Path,required=True)
    args=ap.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
            and u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
            "Browser test must run on loopback origin")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    results=[]
    with sync_playwright() as playwright:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:
            for check in (case_nested_cancel,case_redaction_and_repeated_membership,case_invalid_sources,case_reviewed_sidecar):
                outcome=check(browser,args.url)
                results.append(outcome)
                print("PASS ANSIBLE-YAML-P2 real Chromium:",outcome["case"],flush=True)
        finally:
            browser.close()
    report={"status":"PASS","kind":"actual Chromium interactive built YadiLab",
            "platform":"GitHub Ubuntu (NOT target Parrot)","cases":results,
            "builderOrEngineModified":False}
    dest=args.evidence_dir/"ansible-yaml-p2-browser-acceptance.json"
    dest.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))


if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL ANSIBLE-YAML-P2 real Chromium acceptance:",exc,file=sys.stderr)
        raise

#!/usr/bin/env python3
"""IC-010 P3a: actual compiled Chromium, source-bound static Ansible shared inspection."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_ic010_p2_shared_xml_real_browser import (
    setup, exported_source, open_panel, choose, consent_inspect, invariant, require
)

FIXTURES=Path(__file__).resolve().parents[2]/"tests/fixtures/import"
CANARIES=[
  "SYNTHETIC_SECRET_CANARY_NOT_REAL",
  "SYNTHETIC_TOKEN_CANARY_NOT_REAL",
  "SYNTHETIC_PRIVATE_PATH",
  "SECRET_INI_HOST_CANARY_DONT_EXPORT",
  "SECRET_INI_GROUP_CANARY_DONT_EXPORT",
  "SECRET_INI_BECOME_CANARY_DONT_EXPORT",
]

def source(relative):
    return (FIXTURES/relative).read_bytes()

def validated(page, filename, data, profile, expected, counts):
    choose(page,filename,data)
    expect(page.locator('[data-ic010-p2-selected="true"]')).to_be_visible(timeout=12000)
    require(page.locator('[data-ic010-p2-result]').count()==0,
            "File parsed before explicit consent")
    consent_inspect(page)
    expect(page.locator('[data-ic010-p2-result="REVIEW_REQUIRED"]')).to_be_visible(timeout=18000)
    require(page.locator('[data-ic010-p2-profile="'+profile+'"]').count()==1,
            "Wrong validated producer profile: "+profile)
    require(page.locator('[data-ic010-p2-track="CONFIG_DOCUMENTED"]').count()==1,
            "Ansible source incorrectly claimed other evidence type")
    require(page.locator('[data-ic010-p2-counts="'+expected+'"]').count()==1,
            "Wrong aggregated parser data")
    actual=page.locator('[data-ic010-p2-counts]').inner_text()
    require(counts in actual,"Incorrect aggregate counts: "+actual)
    original_sha=hashlib.sha256(data).hexdigest()
    require(original_sha in page.locator('[data-ic010-p2-sha]').inner_text(),
            "Original source SHA mismatch")
    require(page.locator('[data-ic010-p2-source-locator="source-document"]').count()==1,
            "Document source locator missing")
    require(page.locator('[data-ic010-p2-activation="BLOCKED"]').count()==1,
            "Builder and Engine must remain blocked")
    html=page.locator('[data-ic010-p2-panel]').inner_html()
    for secret in CANARIES + ["203.0.113.25", "203.0.113.10", "app01", "protected01",
                              "ansible_password=", "internal_token", "private_key_file"]:
        require(secret not in html,"Original source identifier/secret exposed: "+secret)
    return original_sha

def case_positive_and_adversarial(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        open_panel(page)
        require(".yml,.yaml,.ini" in page.locator('[data-ic010-p2-file]').get_attribute("accept"),
                "Shared file chooser missing Ansible profiles")
        yaml=source("ansible-yaml/valid-nested.yml")
        valid_sha=validated(page,"inventory.yaml",yaml,
               "ansible.inventory.static.yaml.v1","ANSIBLE_YAML_INVENTORY",
               "Documented hosts: 4 · Groups: 3 · Source-bound host references: 4")
        validated(page,"sensitive.yml",source("ansible-yaml/valid-sensitive-vars.yml"),
               "ansible.inventory.static.yaml.v1","ANSIBLE_YAML_INVENTORY",
               "Documented hosts: 1 · Groups: 1 · Source-bound host references: 1")
        validated(page,"inventory.ini",source("ansible-ini/valid-multigroup.ini"),
               "ansible.inventory.static.ini.v1","ANSIBLE_INI_INVENTORY",
               "Documented hosts: 2 · Groups: 2 · Source-bound host references: 3")
        validated(page,"sensitive.INI",source("ansible-ini/valid-sensitive-vars.ini"),
               "ansible.inventory.static.ini.v1","ANSIBLE_INI_INVENTORY",
               "Documented hosts: 1 · Groups: 1 · Source-bound host references: 1")
        for filename,content in [
            ("alias.yml",source("ansible-yaml/invalid-alias.yml")),
            ("dynamic.yaml",source("ansible-yaml/invalid-dynamic-plugin.yml")),
            ("host.ini",source("ansible-ini/invalid-ini-command.ini")),
            ("wrong.ini",yaml),
            ("wrong.yaml",source("ansible-ini/valid-multigroup.ini")),
        ]:
            choose(page,filename,content)
            require(page.locator('[data-ic010-p2-result]').count()==0,
                    "Stale valid result survived invalid switch")
            consent_inspect(page)
            expect(page.locator('[data-ic010-p2-result="BLOCKED"]')).to_be_visible(timeout=14000)
            require("IC010_STATIC_CONTENT_UNRECOGNIZED" in
                    page.locator('[data-ic010-p2-result="BLOCKED"]').inner_text(),
                    "Unsafe or wrong producer content did not fail closed: "+filename)
            require(page.locator('[data-ic010-p2-sha]').count()==0,
                    "Failed source retained a validated SHA")
        # A local source larger than the static inventory limit never passes.
        choose(page,"large.ini",b"#"*(256*1024+1))
        consent_inspect(page)
        expect(page.locator('[data-ic010-p2-error="BLOCKED"]')).to_have_text(
            "IC010_P3_SOURCE_SIZE_INVALID",timeout=14000)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Oversized file produced an apparent valid source")
        page.locator('[data-ic010-p2-close]').click()
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        invariant(page,before,errors,outside)
        return {"case":"static_yaml_ini_positive_and_unsafe_files","status":"PASS",
                "profiles":2,"malformedDenied":5,"maxBytes":256*1024,
                "sourceSha256":valid_sha,"builderUnchanged":True,"outsideRequests":0}
    finally:
        page.close()

def case_delayed_cross_format_read(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        open_panel(page)
        page.evaluate("""() => {
          const original = File.prototype.arrayBuffer;
          window.__ic010P3Release = [];
          File.prototype.arrayBuffer = function() {
            if (this.name === "slow.yaml") {
              return new Promise((resolve,reject) => {
                window.__ic010P3Release.push(() => original.call(this).then(resolve,reject));
              });
            }
            return original.call(this);
          };
        }""")
        choose(page,"slow.yaml",source("ansible-yaml/valid-nested.yml"))
        consent_inspect(page)
        page.wait_for_function("window.__ic010P3Release.length === 1",timeout=10000)
        validated(page,"faster.ini",source("ansible-ini/valid-multigroup.ini"),
               "ansible.inventory.static.ini.v1","ANSIBLE_INI_INVENTORY",
               "Documented hosts: 2")
        page.evaluate("() => window.__ic010P3Release.shift()()")
        page.wait_for_timeout(250)
        require(page.locator('[data-ic010-p2-profile="ansible.inventory.static.ini.v1"]').count()==1,
                "Late YAML source changed current INI profile")
        require(page.locator('[data-ic010-p2-counts="ANSIBLE_YAML_INVENTORY"]').count()==0,
                "Late YAML source replaced newer inventory summary")
        choose(page,"slow.yaml",source("ansible-yaml/valid-nested.yml"))
        consent_inspect(page)
        page.wait_for_function("window.__ic010P3Release.length === 1",timeout=10000)
        page.keyboard.press("Escape")
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        page.evaluate("() => window.__ic010P3Release.shift()()")
        open_panel(page)
        require(page.locator('[data-ic010-p2-result]').count()==0,
                "Late closed-file read resurfaced after reopen")
        require(page.locator('[data-ic010-p2-consent]').is_disabled(),
                "Consent leaked across close/reopen")
        page.locator('[data-ic010-p2-close]').click()
        invariant(page,before,errors,outside)
        return {"case":"cross_format_late_read_and_escape","status":"PASS",
                "staleDiscarded":True,"builderUnchanged":True,"outsideRequests":0}
    finally:
        page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",required=True,type=Path)
    args=ap.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
            "Real Chromium must test canonical loopback only")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=flags)
        try:
            cases=[case_positive_and_adversarial(browser,args.url),
                   case_delayed_cross_format_read(browser,args.url)]
        finally: browser.close()
    report={"status":"PASS","kind":"Compiled YadiLab Chromium, actual local file selection",
            "platform":"Ubuntu Actions (Parrot-native NOT_RUN)","cases":cases,
            "sharedViewBuilderOrEngineModified":False}
    (args.evidence_dir/"ic010-p3a-ansible-shared-real-browser.json").write_text(
        json.dumps(report,indent=2)+"\n")
    print("PASS IC-010 P3a actual compiled Chromium static Ansible inventory inspection",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("FAIL IC-010 P3a actual Chromium: "+str(exc),file=sys.stderr)
        raise

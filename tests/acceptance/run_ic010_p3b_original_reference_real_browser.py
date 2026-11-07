#!/usr/bin/env python3
"""IC-010 P3b real compiled Chromium: one unverified source-ordinal Builder reference."""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_ic010_p2_shared_xml_real_browser import (
    setup, exported_source, open_panel, choose, consent_inspect, invariant, require
)

ROOT=Path(__file__).resolve().parents[2]
FIXTURES=ROOT/"tests/fixtures/import"
CANARIES=["SECRET_INI_HOST_CANARY_DONT_EXPORT",
 "SECRET_INI_GROUP_CANARY_DONT_EXPORT","SYNTHETIC_SECRET_CANARY_NOT_REAL",
 "SYNTHETIC_TOKEN_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
 "203.0.113.25","203.0.113.10","protected01","app01",
 "reportedConnectionAddress","hostKey","groupPath","inventoryName"]

def load(name):
    return (FIXTURES/name).read_bytes()

def select(page,ordinal="0"):
    panel=page.locator('[data-ic010-p3b-review="REVIEW_REQUIRED"]')
    expect(panel).to_be_visible(timeout=16000)
    assert page.locator('[data-ic010-p3b-export]').is_disabled()
    resourceOptions=page.locator('[data-ic010-p3b-resource] option')
    require(resourceOptions.count()>1,"Builder must contain modeled resources")
    resource=resourceOptions.nth(1).get_attribute("value")
    require(bool(resource),"Review requires an explicit real Builder resource ID")
    page.locator('[data-ic010-p3b-host]').select_option(ordinal)
    page.locator('[data-ic010-p3b-resource]').select_option(resource)
    assert page.locator('[data-ic010-p3b-export]').is_disabled()
    ack=page.locator('[data-ic010-p3b-ack]')
    require(not ack.is_checked(),"Review cannot start pre-acknowledged")
    ack.check()
    expect(page.locator('[data-ic010-p3b-export]')).to_be_enabled()
    return resource

def read_sidecar(page):
    with page.expect_download(timeout=25000) as received:
        page.locator('[data-ic010-p3b-export]').click()
    return json.loads(Path(received.value.path()).read_text())

def case_one_reference(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        sourceBefore=exported_source(page)
        original=load("ansible-ini/valid-multigroup.ini")
        sha=hashlib.sha256(original).hexdigest()
        open_panel(page)
        choose(page,"inventory.ini",original)
        consent_inspect(page)
        expect(page.locator('[data-ic010-p3b-review="REVIEW_REQUIRED"]')).to_be_visible()
        resource=select(page,"0")
        sidecar=read_sidecar(page)
        require(sidecar=={
            "formatId":"yadilab.ic010.shared-static-ansible-reference",
            "schemaVersion":"1.0.0","status":"REVIEWED_REFERENCE_ONLY",
            "semanticTrack":"CONFIG_DOCUMENTED","canActivate":False,
            "modelMutated":False,"engineVerified":False,
            "physicalTopologyVerified":False,
            "source":{"profileId":"ansible.inventory.static.ini.v1","sha256":sha},
            "sourceItem":{"kind":"ansible-ini-host-ordinal","sourceSha256":sha,
                "hostOrdinal":0,"originalLocatorCount":2},
            "targetModel":{"scenarioId":sourceBefore["scenarioId"],
                "sourceRevision":sidecar["targetModel"]["sourceRevision"],
                "resourceId":resource},
            "assertion":"USER_ASSERTED_REFERENCE_NOT_VERIFIED"},
            "Unexpected redacted source-bound one-ordinal reference")
        for token in CANARIES+["ansible_password","internal_token"]:
            require(token not in json.dumps(sidecar),"Private source identifier leaked into sidecar: "+token)
            require(token not in page.locator('[data-ic010-p2-panel]').inner_html(),
                "Private source identifier leaked into shared DOM: "+token)
        expect(page.locator('[data-ic010-p3b-exported]')).to_be_visible()
        # Canonical Builder export must be checked AFTER the modal closes;
        # its overlay deliberately prevents clicking background menu controls.
        # Switching original source also revokes review and acknowledgement.
        choose(page,"sensitive.yml",load("ansible-yaml/valid-sensitive-vars.yml"))
        require(page.locator('[data-ic010-p3b-review]').count()==0,
                "Prior reviewed mapping remained after original source switch")
        consent_inspect(page)
        expect(page.locator('[data-ic010-p3b-review="REVIEW_REQUIRED"]')).to_be_visible()
        require(page.locator('[data-ic010-p3b-host]').input_value()=="",
                "Old source ordinal leaked into new YAML")
        require(not page.locator('[data-ic010-p3b-ack]').is_checked(),
                "Old manual acknowledgement leaked into new source")
        resourceYaml=select(page,"0")
        yaml=read_sidecar(page)
        require(yaml["sourceItem"]["kind"]=="ansible-yaml-host-ordinal" and
            yaml["sourceItem"]["originalLocatorCount"]==1 and
            yaml["targetModel"]["resourceId"]==resourceYaml,
            "YAML ordinal/source locator not verified")
        require(yaml["source"]["sha256"]==hashlib.sha256(
            load("ansible-yaml/valid-sensitive-vars.yml")).hexdigest(),
            "YAML original bytes SHA mismatch")
        for token in CANARIES:
            require(token not in json.dumps(yaml),"Private YAML token in sidecar")
        page.locator('[data-ic010-p2-close]').click()
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        invariant(page,sourceBefore,errors,outside)
        return {"case":"real_builder_one_ordinal_ini_yaml_export","status":"PASS",
            "sources":2,"builderUnchanged":True,"sourceHashConfirmed":True,
            "noExternalRequests":True}
    finally: page.close()

def case_late_export_discard(browser,url):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        exports=[]
        page.on("download",lambda download:exports.append(download.suggested_filename))
        open_panel(page)
        page.evaluate("""() => {
          const native = File.prototype.arrayBuffer;
          window.__ic010P3bPending=[];
          let count=0;
          File.prototype.arrayBuffer = function() {
            if (this.name === "slow.ini" && ++count > 1) {
              return new Promise((resolve,reject) => {
                window.__ic010P3bPending.push(() => native.call(this).then(resolve,reject));
              });
            }
            return native.call(this);
          };
        }""")
        choose(page,"slow.ini",load("ansible-ini/valid-multigroup.ini"))
        consent_inspect(page)
        expect(page.locator('[data-ic010-p3b-review="REVIEW_REQUIRED"]')).to_be_visible()
        select(page)
        page.locator('[data-ic010-p3b-export]').click()
        page.wait_for_function("window.__ic010P3bPending.length===1",timeout=15000)
        # A newly chosen file clears source consent and invalidates the
        # previously pending export even if its original File read resolves.
        choose(page,"replacement.yml",load("ansible-yaml/valid-nested.yml"))
        require(page.locator('[data-ic010-p3b-review]').count()==0,
                "Old original source selection survived")
        page.evaluate("() => window.__ic010P3bPending.shift()()")
        page.wait_for_timeout(350)
        require(len(exports)==0,"Stale source review triggered local JSON download")
        require(page.locator('[data-ic010-p3b-exported]').count()==0,
                "Late sidecar success appeared after file replacement")
        page.locator('[data-ic010-p2-close]').click()
        expect(page.locator('[data-ic010-p2-panel]')).to_have_count(0)
        invariant(page,before,errors,outside)
        return {"case":"late_original_file_review_replaced_source","status":"PASS",
            "staleDownloadPrevented":True,"builderUnchanged":True,"outsideRequests":0}
    finally:page.close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",required=True,type=Path)
    args=ap.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None
      and u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
      "P3b actual Chromium requires canonical loopback only")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:cases=[case_one_reference(browser,args.url),case_late_export_discard(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"Actually compiled YadiLab Chromium with original File + sidecar download",
      "platform":"Ubuntu GitHub Actions, Parrot-native NOT_RUN",
      "cases":cases,"builderOrEngineModifiedByReference":False}
    (args.evidence_dir/"ic010-p3b-source-ordinal-review-real-browser.json").write_text(
      json.dumps(report,indent=2)+"\n")
    print("PASS IC-010 P3b compiled Chromium original-source ordinal reference review",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL IC-010 P3b real Chromium "+str(error),file=sys.stderr)
        raise

#!/usr/bin/env python3
"""ANSIBLE INI P5: genuine compiled-browser P4 sidecar original-source replay."""
import argparse, hashlib, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from run_ansible_ini_p3_real_browser import setup,inspect,upload,unchanged,export_source,FIXTURES,require

def open_replay(page):
    menu=page.locator(".workspace-menu",has=page.locator("summary",has_text="Import / Export"))
    require(menu.count()==1,"Import/Export menu is missing")
    if menu.get_attribute("open") is None:menu.locator("summary").click()
    menu.locator('[data-inspect-ansible-ini-replay="CONFIG_DOCUMENTED"]').click()
    expect(page.locator('[data-ansible-ini-replay-panel="CONFIG_DOCUMENTED"]')).to_be_visible(timeout=25000)

def choose(page,selector,name,raw):
    page.locator(selector).set_input_files({"name":name,"mimeType":"application/octet-stream","buffer":raw})

def run(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        original=(FIXTURES/"valid-multigroup.ini").read_bytes()
        sha=hashlib.sha256(original).hexdigest()
        inspect(page)
        upload(page,"valid-multigroup.ini")
        expect(page.locator('[data-ansible-ini-association-review="REVIEW_REQUIRED"]')).to_be_visible(timeout=25000)
        options=page.locator('[data-ansible-ini-associate-host="0"] option')
        require(options.count()>=3,"Need existing Builder resource")
        target=options.nth(1).get_attribute("value")
        require(bool(target),"Missing first modeled target")
        require(page.locator('[data-ansible-ini-association-export]').is_disabled(),
                "Default unreviewed association exported")
        page.locator('[data-ansible-ini-associate-host="0"]').select_option(target)
        page.locator('[data-ansible-ini-association-ack]').check()
        with page.expect_download(timeout=25000) as dl:
            page.locator('[data-ansible-ini-association-export]').click()
        saved=Path(dl.value.path()).read_bytes()
        sidecar=json.loads(saved)
        require(sidecar["formatId"]=="yadilab.ansible-ini-inventory-associations","Not real P4 source report")
        require(sidecar["source"]["sha256"]==sha,"P4 lost exact original SHA")
        require(sidecar["targetModel"]["scenarioId"]==before["scenarioId"],"Wrong model")
        page.locator('[data-ansible-ini-close="true"]').click()
        expect(page.locator('[data-ansible-ini-panel]')).to_have_count(0)

        open_replay(page)
        choose(page,'[data-ansible-ini-replay-original]','original.ini',original)
        choose(page,'[data-ansible-ini-replay-report]','exported-p4.json',saved)
        verify=page.locator('[data-ansible-ini-replay-verify]')
        require(verify.is_disabled(),"Saved report auto-validated without consent")
        require(page.locator('[data-ansible-ini-replay-result]').count()==0,
                "Stale positive match shown before verification")
        page.locator('[data-ansible-ini-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-ansible-ini-replay-result="REFERENCE_REPLAY_MATCH"]')).to_be_visible(timeout=25000)
        require(page.locator('[data-ansible-ini-replay-count="1"]').count()==1,
                "Wrong number of verified source references")
        require(sha in page.locator('[data-ansible-ini-replay-sha]').inner_text(),
                "Wrong original SHA in replay")
        for token in ["SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_PRIVATE_PATH",
                       "ansible_password","USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"]:
            require(token not in page.locator('[data-ansible-ini-replay-panel]').inner_html(),
                    "Raw report/INI leaked "+token)

        choose(page,'[data-ansible-ini-replay-original]','original.ini',
               (FIXTURES/"valid-ungrouped.ini").read_bytes())
        require(page.locator('[data-ansible-ini-replay-result]').count()==0,
                "Old MATCH survived original replacement")
        require(not page.locator('[data-ansible-ini-replay-consent]').is_checked(),
                "Old consent survived changed source")
        page.locator('[data-ansible-ini-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-ansible-ini-replay-error="BLOCKED"]')).to_have_text(
            "ANSIBLE_INI_REPLAY_SOURCE_CHANGED",timeout=25000)

        choose(page,'[data-ansible-ini-replay-original]','original.ini',original)
        forged={**sidecar,"engineVerified":True}
        choose(page,'[data-ansible-ini-replay-report]','forged.json',json.dumps(forged).encode())
        require(not page.locator('[data-ansible-ini-replay-consent]').is_checked(),
                "Forged report retained prior consent")
        page.locator('[data-ansible-ini-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-ansible-ini-replay-error="BLOCKED"]')).to_have_text(
            "ANSIBLE_INI_REPLAY_REPORT_MISMATCH",timeout=25000)
        require(page.locator('[data-ansible-ini-replay-result]').count()==0,
                "Forged Engine truth created MATCH")
        page.locator('[data-ansible-ini-replay-close]').click()
        expect(page.locator('[data-ansible-ini-replay-panel]')).to_have_count(0)
        require(export_source(page)==before,"INI saved replay mutated canonical Builder")
        unchanged(page,scenario,errors,external)
        open_replay(page)
        require(page.locator('[data-ansible-ini-replay-result]').count()==0,
                "Old MATCH persisted after modal reopening")
        require(verify.is_disabled(),"Previous file inputs/consent carried into new dialog")
        page.locator('[data-ansible-ini-replay-close]').click()
        return {"case":"p4_actual_export_p5_replay_original_ini_and_saved_json",
                "status":"PASS","sourceSha256":sha,"referencesChecked":1,
                "changedSourceBlocked":True,"forgedEngineTruthBlocked":True,
                "privateSourceDisplayed":False,"builderMutated":False}
    finally:page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",required=True,type=Path)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
      u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
      "Only compiled loopback YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try:checks=[run(browser,args.url)]
        finally:browser.close()
    report={"status":"PASS","kind":"ANSIBLE-INI-P5 compiled Chromium original-file P4 JSON replay",
            "platform":"GitHub Ubuntu Chromium, not Parrot","cases":checks,"builderMutated":False}
    (args.evidence_dir/"ansible-ini-p5-real-chromium.json").write_text(
        json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("PASS ANSIBLE INI P5 compiled Chromium",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as error:
        print("FAIL ANSIBLE INI P5 compiled Chromium "+str(error),file=sys.stderr)
        raise

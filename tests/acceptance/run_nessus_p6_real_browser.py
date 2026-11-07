#!/usr/bin/env python3
"""NESSUS P6: real P5 export rechecked against original Nessus and live Builder."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from run_nessus_p4_real_browser import original, inspect, upload, next_page, targets
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu


def open_replay(page):
    menu(page).locator('[data-inspect-nessus-replay="EVIDENCE_OBSERVED"]').click()
    expect(page.locator('[data-nessus-replay-panel="EVIDENCE_OBSERVED"]')).to_be_visible(timeout=25000)


def choose(page, selector, name, content):
    page.locator(selector).set_input_files({
        "name": name, "mimeType": "application/octet-stream", "buffer": content
    })


def test(browser, url):
    page, scenario, errors, external = setup(browser, url)
    try:
        before = export_source(page)
        scan = original(41)
        source_hash = hashlib.sha256(scan).hexdigest()
        inspect(page)
        upload(page, scan)
        next_page(page, 2)
        next_page(page, 3)
        expect(page.locator('[data-nessus-associate-host="40"]')).to_be_visible()
        target = targets(page, 40)
        page.locator('[data-nessus-associate-host="40"]').select_option(target)
        page.locator('[data-nessus-association-ack]').check()
        with page.expect_download(timeout=25000) as download:
            page.locator('[data-nessus-association-export]').click()
        saved = Path(download.value.path()).read_bytes()
        parsed = json.loads(saved)
        require(parsed["source"]["sha256"] == source_hash, "P5 saved SHA not original scan")
        require(len(parsed["associations"]) == 1, "Incorrect association count")
        require(parsed["associations"][0]["hostLocator"]["hostOrdinal"] == 40,
                "Source ordinal 40 lost in P5")
        require(parsed["associations"][0]["targetResourceId"] == target,
                "P5 operator target incorrect")
        page.locator('[data-nessus-close]').click()
        expect(page.locator('[data-nessus-panel]')).to_have_count(0)

        open_replay(page)
        choose(page, '[data-nessus-replay-original]', "original.nessus", scan)
        choose(page, '[data-nessus-replay-report]', "saved.json", saved)
        verify = page.locator('[data-nessus-replay-verify]')
        require(verify.is_disabled(), "Replay enabled before explicit consent")
        require(page.locator('[data-nessus-replay-result]').count() == 0,
                "Auto-MATCH without operator consent")
        page.locator('[data-nessus-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-nessus-replay-result="REFERENCE_REPLAY_MATCH"]')).to_be_visible(timeout=30000)
        require(page.locator('[data-nessus-replay-count="1"]').count() == 1,
                "Incorrect P6 count")
        require(source_hash in page.locator('[data-nessus-replay-sha]').inner_text(),
                "Original Nessus SHA not shown")
        for secret in ("NESSUS_P4_PRIVATE_HOST_CANARY", "192.0.2.88",
                       "DO_NOT_EXPOSE_SECRET_FINDING", "SECRET_NESSUS_REPORT",
                       "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"):
            require(secret not in page.locator('[data-nessus-replay-panel]').inner_html(),
                    "Sensitive source or association details in replay panel")

        # Aggregate severity counts are unchanged, but the exact original bytes differ.
        modified = scan.replace(b'NESSUS_P4_PRIVATE_HOST_CANARY_0',
                                b'NESSUS_P6_CHANGED_PRIVATE_HOST_0')
        require(modified != scan, "Source mutation fixture ineffective")
        choose(page, '[data-nessus-replay-original]', "original.nessus", modified)
        require(page.locator('[data-nessus-replay-result]').count() == 0,
                "Previous MATCH survived changed file")
        require(not page.locator('[data-nessus-replay-consent]').is_checked(),
                "Consent survived changed original source")
        page.locator('[data-nessus-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-nessus-replay-error="BLOCKED"]')).to_have_text(
            "NESSUS_REPLAY_SOURCE_CHANGED", timeout=25000)

        choose(page, '[data-nessus-replay-original]', "original.nessus", scan)
        forged = dict(parsed)
        forged["engineVerified"] = True
        choose(page, '[data-nessus-replay-report]', "forged.json",
               json.dumps(forged).encode())
        require(not page.locator('[data-nessus-replay-consent]').is_checked(),
                "Consent persisted after report replaced")
        page.locator('[data-nessus-replay-consent]').check()
        verify.click()
        expect(page.locator('[data-nessus-replay-error="BLOCKED"]')).to_have_text(
            "NESSUS_REPLAY_REPORT_MISMATCH", timeout=25000)
        require(page.locator('[data-nessus-replay-result]').count() == 0,
                "Forged Engine verification created MATCH")

        page.locator('[data-nessus-replay-close]').click()
        expect(page.locator('[data-nessus-replay-panel]')).to_have_count(0)
        require(export_source(page) == before, "Replay changed Builder")
        check_unchanged(page, scenario, errors, external)
        open_replay(page)
        require(page.locator('[data-nessus-replay-result]').count() == 0,
                "MATCH persisted across dialog closing")
        require(page.locator('[data-nessus-replay-verify]').is_disabled(),
                "File selections carried over across dialog closing")
        page.locator('[data-nessus-replay-close]').click()
        return {
            "status": "PASS",
            "case": "actual_p5_export_p6_original_nessus_and_builder_replay",
            "sourceSha256": source_hash,
            "checkedOrdinal": 40,
            "referencesChecked": 1,
            "changedSourceBlocked": True,
            "forgedEngineTruthBlocked": True,
            "builderMutated": False,
            "externalRequests": 0,
        }
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    url = urlsplit(args.url)
    require(url.scheme == "http" and url.hostname == "127.0.0.1"
            and url.port is not None and url.path == "/"
            and not url.query and not url.fragment
            and not url.username and not url.password,
            "Only locally compiled YadiLab on loopback")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        browser = pw.chromium.launch(headless=True, args=flags)
        try:
            results = [test(browser, args.url)]
        finally:
            browser.close()
    result = {
        "status": "PASS",
        "kind": "NESSUS P6 real Chromium saved P5 source-bound sidecar replay",
        "platform": "Ubuntu GitHub Actions Chromium; native Parrot NOT_RUN",
        "cases": results,
        "builderMutated": False
    }
    (args.evidence_dir / "nessus-p6-real-chromium.json").write_text(
        json.dumps(result, indent=2) + "\n")
    print("PASS NESSUS P6 actual compiled Chromium")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL NESSUS P6 actual Chromium " + str(exc), file=sys.stderr)
        raise

#!/usr/bin/env python3
"""NMAP-XML-P2: REAL Chromium acceptance against actual YadiLab browser build.

Ubuntu CI is not Parrot acceptance. All tests use actual user input and React
DOM: no mock network engine, DOM replacement, or source-only PASS.
"""
import argparse
import hashlib
import json
from pathlib import Path
import os
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/import/nmap-xml"


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def setup(browser, url):
    page = browser.new_page(accept_downloads=True, viewport={"width": 1500, "height": 1000})
    errors, external = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: external.append(request.url) if
            not (request.url.startswith(url) or request.url.startswith("data:")
                 or request.url.startswith("blob:")) else None)
    page.goto(url, wait_until="domcontentloaded", timeout=25000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    return page, errors, external, page.locator(".app-frame").get_attribute("data-runtime-scenario-id")


def inspect(page):
    menu = page.locator(".workspace-menu", has=page.locator("summary", has_text="Import / Export"))
    require(menu.count() == 1, "Import / Export menu missing")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    menu.locator('[data-inspect-nmap="EVIDENCE_ONLY"]').click()
    page.locator('[data-nmap-panel="EVIDENCE_ONLY"]').wait_for(timeout=12000)


def choose(page, name):
    page.locator('[data-nmap-file="true"]').set_input_files(str(FIXTURES / name))


def confirm_unchanged(page, base, errors, external):
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id") == base,
            "Inspection changed the active scenario")
    require(page.locator('[data-nmap-activate], [data-nmap-confirm]').count() == 0,
            "Unexpected Nmap activation control")
    require(not errors, "JavaScript exceptions: " + repr(errors))
    require(not external, "Unexpected external request while inspecting XML: " + repr(external))


def export_builder_source(page):
    menu = page.locator(".workspace-menu", has=page.locator("summary", has_text="Import / Export"))
    require(menu.count() == 1, "Import / Export menu must be unique")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    export = menu.get_by_role("button", name="Exportera källfil")
    export.wait_for(state="visible", timeout=15000)
    with page.expect_download(timeout=15000) as downloaded:
        export.click()
    return json.loads(Path(downloaded.value.path()).read_text())


def case_reviewed_association(browser, url):
    page, errors, external, base = setup(browser, url)
    try:
        before = export_builder_source(page)
        require(before["scenarioId"] == base, "Unexpected initial Builder")
        require(any(resource["id"] == "rds01" for resource in before["resources"]),
                "Expected existing resource for explicit association")
        inspect(page)
        choose(page, "valid-observed-hosts.xml")
        page.locator('[data-nmap-association-review="REVIEW_REQUIRED"]').wait_for(timeout=15000)
        require(page.locator('[data-nmap-associate-host="0"]').input_value() == "",
                "Observed host must not be linked automatically")
        require(page.locator('[data-nmap-association-export]').is_disabled(),
                "Unreviewed evidence export must be blocked")
        page.locator('[data-nmap-associate-host="0"]').select_option("rds01")
        require(page.locator('[data-nmap-association-export]').is_disabled(),
                "Missing explicit unverified-identity acknowledgment did not block export")
        page.locator('[data-nmap-association-ack]').check()
        require(page.locator('[data-nmap-association-export]').is_enabled(),
                "Fully reviewed evidence association cannot be exported")
        with page.expect_download(timeout=20000) as downloaded:
            page.locator('[data-nmap-association-export]').click()
        sidecar = json.loads(Path(downloaded.value.path()).read_text())
        require(sidecar["formatId"] == "yadilab.nmap-observation-associations", "Wrong sidecar format")
        require(sidecar["status"] == "REVIEWED_ASSOCIATIONS_ONLY", "Observed evidence was promoted into Engine truth")
        require(sidecar["engineVerified"] is False and sidecar["physicalTopologyVerified"] is False,
                "Sidecar incorrectly claims verified network state")
        require(sidecar["source"]["sha256"] == hashlib.sha256(
            (FIXTURES / "valid-observed-hosts.xml").read_bytes()).hexdigest(),
            "Original Nmap source provenance lost")
        require(sidecar["targetModel"]["scenarioId"] == base, "Target model identity differs")
        require(len(sidecar["associations"]) == 1, "Nonselected hosts were associated")
        association = sidecar["associations"][0]
        require(association["targetResourceId"] == "rds01", "Unreviewed target resource used")
        require(association["hostLocator"]["kind"] == "nmap-host"
                and association["hostLocator"]["hostOrdinal"] == 0, "Original host locator lost")
        require(association["assertion"] == "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
                "Association truth boundary lost")
        require("connections" not in sidecar and "resources" not in sidecar and "engineState" not in sidecar,
                "Imported observation was confused with ScenarioSource")
        page.locator('[data-nmap-associate-host="1"]').select_option("rds01")
        require(page.locator('[data-nmap-association-conflict="BLOCKED"]').count() == 1,
                "Conflicting duplicate target not shown")
        require(page.locator('[data-nmap-association-export]').is_disabled(),
                "Conflicting duplicate target did not block export")
        confirm_unchanged(page, base, errors, external)
        page.locator('[data-nmap-close="true"]').click()
        page.locator('[data-nmap-panel]').wait_for(state="detached")
        after = export_builder_source(page)
        require(after == before, "Evidence association changed canonical Builder source")
        confirm_unchanged(page, base, errors, external)
        return {"case": "reviewed_sidecar_export", "status": "PASS",
                "sourceUnchanged": True, "associations": 1, "autoLinks": 0}
    finally:
        page.close()


def case_valid(browser, url):
    page, errors, external, base = setup(browser, url)
    try:
        inspect(page)
        choose(page, "valid-observed-hosts.xml")
        observed = page.locator('[data-nmap-observations="EVIDENCE_ONLY"]')
        observed.wait_for(timeout=15000)
        text = observed.inner_text()
        require("Hosts observed: 2 · Port observations: 2" in text, "Wrong scan observation counts")
        require("192.0.2.10 — observed UP" in text, "Missing UP scan record")
        require("192.0.2.11 — observed DOWN" in text, "Missing DOWN scan record")
        require("TCP/22 — observed open" in text, "Missing open TCP observation")
        require("TCP/443 — observed closed" in text, "Missing closed port observation")
        require("service hint: ssh" in text, "Service hint missing")
        sha = hashlib.sha256((FIXTURES / "valid-observed-hosts.xml").read_bytes()).hexdigest()
        require(sha in page.locator('[data-nmap-source-hash]').inner_text(),
                "Original source hash mismatched")
        require(page.locator('[data-nmap-activation-status="BLOCKED"]').count() == 1,
                "No explicit observed-only boundary")
        confirm_unchanged(page, base, errors, external)
        page.locator('[data-nmap-close="true"]').click()
        page.locator('[data-nmap-panel]').wait_for(state="detached")
        confirm_unchanged(page, base, errors, external)
        return {"case": "valid_and_cancel", "status": "PASS", "unchanged": True}
    finally:
        page.close()


def case_invalid(browser, url):
    page, errors, external, base = setup(browser, url)
    try:
        inspect(page)
        for fixture, expected in [
            ("invalid-wrong-root.xml", "NMAP_XML_ROOT_INVALID"),
            ("invalid-port-range.xml", "NMAP_XML_NUMBER_INVALID"),
            ("adversarial-xxe.xml", "IMPORT_XML_DTD_FORBIDDEN"),
            ("adversarial-external-dtd.xml", "IMPORT_XML_DTD_FORBIDDEN"),
        ]:
            choose(page, fixture)
            alert = page.locator('[data-nmap-error="BLOCKED"]')
            alert.wait_for(timeout=15000)
            require(expected in alert.inner_text(),
                    f"Expected {expected} rejection for {fixture}: {alert.inner_text()}")
            require(page.locator('[data-nmap-observations]').count() == 0,
                    "Stale valid scan leaked into invalid-file result")
            confirm_unchanged(page, base, errors, external)
        page.locator('[data-nmap-close="true"]').click()
        page.locator('[data-nmap-panel]').wait_for(state="detached")
        confirm_unchanged(page, base, errors, external)
        return {"case": "invalid_and_xxe_blocked", "status": "PASS", "unchanged": True}
    finally:
        page.close()


def case_stylesheet_and_escape(browser, url):
    page, errors, external, base = setup(browser, url)
    try:
        inspect(page)
        choose(page, "valid-stylesheet-reference.xml")
        page.locator('[data-nmap-observations="EVIDENCE_ONLY"]').wait_for(timeout=15000)
        sha = hashlib.sha256((FIXTURES / "valid-stylesheet-reference.xml").read_bytes()).hexdigest()
        require(sha in page.locator('[data-nmap-source-hash]').inner_text(),
                "Source hash must include the ignored stylesheet PI")
        require("198.51.100.50" in page.locator('[data-nmap-host="0"]').inner_text(),
                "Missing observation after ignored stylesheet")
        confirm_unchanged(page, base, errors, external)
        # Actual browser file-selection of attacker-controlled XML text, NOT
        # injection into DOM from the test harness.
        malicious = b'''<?xml version="1.0"?>
<nmaprun scanner="nmap" version="7.94">
<host><status state="up"/><address addrtype="ipv4" addr="203.0.113.21"/>
<hostnames><hostname name="&lt;img src=x onerror=alert(1)&gt;" type="user"/></hostnames>
<ports><port protocol="tcp" portid="80"><state state="open"/>
<service name="&lt;script&gt;alert(2)&lt;/script&gt;" method="table" conf="1"/>
</port></ports></host></nmaprun>'''
        page.locator('[data-nmap-file="true"]').set_input_files({
            "name": "synthetic.xml", "mimeType": "application/xml", "buffer": malicious
        })
        page.locator('[data-nmap-host="0"]').get_by_text("203.0.113.21", exact=False).wait_for(timeout=12000)
        require("<img src=x" in page.locator('[data-nmap-host="0"]').inner_text(),
                "Escaped string should be visible as text")
        require(page.locator('[data-nmap-host="0"] img').count() == 0,
                "Untrusted Nmap hostname created an actual image element")
        require(page.locator('[data-nmap-host="0"] script').count() == 0,
                "Untrusted Nmap service hint created executable script element")
        confirm_unchanged(page, base, errors, external)
        page.locator('[data-nmap-close="true"]').click()
        return {"case": "stylesheet_and_untrusted_html", "status": "PASS", "externalRequests": 0}
    finally:
        page.close()


def main():
    arg = argparse.ArgumentParser()
    arg.add_argument("--url", required=True)
    arg.add_argument("--evidence-dir", type=Path, required=True)
    args = arg.parse_args()
    parsed = urlsplit(args.url)
    require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
            and parsed.port is not None and parsed.path == "/"
            and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
            "Acceptance must use a canonical loopback origin")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    result = []
    with sync_playwright() as playwright:
        flags = ["--disable-dev-shm-usage", "--disable-background-networking"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        browser = playwright.chromium.launch(headless=True, args=flags)
        try:
            for check in (case_valid, case_invalid, case_stylesheet_and_escape, case_reviewed_association):
                outcome = check(browser, args.url)
                result.append(outcome)
                print("PASS NMAP-XML-P2 real Chromium:", outcome["case"], flush=True)
        finally:
            browser.close()
    report = {
        "status": "PASS", "type": "real Chromium and YadiLab browser bundle",
        "platform": Path("/etc/os-release").read_text().splitlines()[0] if Path("/etc/os-release").exists() else "unknown",
        "cases": result, "noBuilderOrEngineMutation": True
    }
    destination = args.evidence_dir / "nmap-xml-p2-browser-acceptance.json"
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try: main()
    except Exception as error:
        print("FAIL NMAP-XML-P2 real Chromium acceptance:", error, file=sys.stderr)
        raise

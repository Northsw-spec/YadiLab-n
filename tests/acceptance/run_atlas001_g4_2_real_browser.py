#!/usr/bin/env python3
"""ATLAS-001 G4.2: real compiled Chromium proof for NORMAL/BOUNDED/BLOCKED."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import exported_source, require, setup

ROOT = Path(__file__).resolve().parents[2]
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FIXTURES = {
    "normal": (ROOT / "tests/fixtures/import/atlas001-g4-2-normal-10.xlsx", "dccddcf8c675bf86192865137a8fcf754b27299d38645c39a10edc48677c1a", 10, 9),
    "bounded": (ROOT / "tests/fixtures/import/atlas001-g4-500.xlsx", "84a32fb149903e89488ec656d036622b5b81b7086c84b8352f24138273e48fde", 500, 499),
    "blocked": (ROOT / "tests/fixtures/import/atlas001-g4-2-blocked-1200.xlsx", "286fd2aaee26e80c426e8bd35bb8100fbc22d494190da7ed83f7550e8bee34d7", 1200, 1200),
}


def open_import(page, fixture, expected_resources, expected_links):
    payload = fixture.read_bytes()
    page.locator('[data-network-import-primary="true"]').click()
    panel = page.locator('[data-network-import-panel="ready"]')
    expect(panel).to_be_visible(timeout=20000)
    panel.locator('[data-network-import-file="true"]').set_input_files({"name": fixture.name, "mimeType": MIME, "buffer": payload})
    expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=180000)
    expect(panel).to_contain_text(f"Devices: {expected_resources} · Explicit links: {expected_links}", timeout=180000)
    return panel, payload


def run_normal(browser, url, evidence_dir):
    page, errors, outside = setup(browser, url)
    try:
        fixture, sha, resources, links = FIXTURES["normal"]
        panel, payload = open_import(page, fixture, resources, links)
        require(panel.get_attribute("data-network-import-decision") == "NORMAL", "small source was not classified NORMAL")
        require(panel.locator('[data-network-import-layout-blocked="true"]').count() == 0, "normal source was incorrectly blocked")
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=180000)
        expect(page.locator('[data-topology-mode="normal"][aria-pressed="true"]')).to_be_visible(timeout=180000)
        trace = page.evaluate("window.__yadilabNetworkImportActivationTrace")
        require(trace["globalLayoutCalls"] == 1 and trace["lastDecision"] == "NORMAL", f"NORMAL global-layout trace mismatch: {trace!r}")
        source = exported_source(page)
        require(len(source["resources"]) == resources and len(source["connections"]) == links, "NORMAL canonical counts changed")
        require(source.get("networkImportProvenance", {}).get("source", {}).get("sha256") == sha, "NORMAL source provenance SHA missing")
        require(not errors and not outside, f"NORMAL Chromium errors/remote requests: {errors!r} {outside!r}")
        page.screenshot(path=str(evidence_dir / "atlas001-g4-2-normal.png"), full_page=True)
        return {"case": "NORMAL", "resources": resources, "links": links, "sourceSha256": sha, "globalLayoutCalls": trace["globalLayoutCalls"], "pageErrors": errors, "outsideRequests": outside, "screenshot": "atlas001-g4-2-normal.png"}
    finally:
        page.close()


def run_bounded(browser, url, evidence_dir):
    page, errors, outside = setup(browser, url)
    try:
        fixture, sha, resources, links = FIXTURES["bounded"]
        panel, payload = open_import(page, fixture, resources, links)
        require(panel.get_attribute("data-network-import-decision") == "BOUNDED_ATLAS", "500-resource source was not classified BOUNDED_ATLAS")
        consent = panel.locator('[data-atlas-bounded-consent="true"]')
        require(not consent.is_checked(), "bounded consent was prechecked")
        require(panel.locator('[data-network-import-activate="true"]').is_disabled(), "bounded activation enabled before consent")
        consent.check()
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=180000)
        expect(page.get_by_role("button", name="ATLAS PAGES")).to_be_visible(timeout=180000)
        trace = page.evaluate("window.__yadilabNetworkImportActivationTrace")
        require(trace["globalLayoutCalls"] == 0, f"BOUNDED unexpectedly called global layout: {trace!r}")
        source = exported_source(page)
        require(len(source["resources"]) == resources and len(source["connections"]) == links, "BOUNDED canonical counts changed")
        require(source.get("networkImportProvenance", {}).get("source", {}).get("sha256") == sha, "BOUNDED source provenance SHA missing")
        require(not errors and not outside, f"BOUNDED Chromium errors/remote requests: {errors!r} {outside!r}")
        page.screenshot(path=str(evidence_dir / "atlas001-g4-2-bounded.png"), full_page=True)
        return {"case": "BOUNDED_ATLAS", "resources": resources, "links": links, "sourceSha256": sha, "globalLayoutCalls": trace["globalLayoutCalls"], "pageErrors": errors, "outsideRequests": outside, "screenshot": "atlas001-g4-2-bounded.png"}
    finally:
        page.close()


def run_blocked(browser, url, evidence_dir):
    page, errors, outside = setup(browser, url)
    try:
        fixture, sha, resources, links = FIXTURES["blocked"]
        before = exported_source(page)
        panel, payload = open_import(page, fixture, resources, links)
        require(panel.get_attribute("data-network-import-decision") == "BLOCKED", "1200-resource source was not classified BLOCKED")
        expect(panel.locator('[data-network-import-layout-blocked="true"]')).to_be_visible()
        expect(panel.locator('[data-network-import-layout-blocked="true"]')).to_contain_text("not truncated or changed")
        activate = panel.locator('[data-network-import-activate="true"]')
        require(activate.is_disabled(), "BLOCKED activation button was enabled")
        # Remove only the DOM disabled attribute to exercise the real handler's
        # fail-closed guard, not merely its presentation-level disabled state.
        page.evaluate("document.querySelector('[data-network-import-activate=\\\"true\\\"]').removeAttribute('disabled')")
        activate.click()
        expect(panel.locator('[role="alert"]').filter(has_text="NETWORK_IMPORT_LAYOUT_CAPACITY_BLOCKED")).to_be_visible(timeout=30000)
        trace = page.evaluate("window.__yadilabNetworkImportActivationTrace")
        require(trace["globalLayoutCalls"] == 0, f"BLOCKED source reached global layout: {trace!r}")
        require(exported_source(page) == before, "BLOCKED import changed the active Builder source")
        require(not errors and not outside, f"BLOCKED Chromium errors/remote requests: {errors!r} {outside!r}")
        page.screenshot(path=str(evidence_dir / "atlas001-g4-2-blocked.png"), full_page=True)
        return {"case": "BLOCKED", "resources": resources, "links": links, "sourceSha256": sha, "globalLayoutCalls": trace["globalLayoutCalls"], "pageErrors": errors, "outsideRequests": outside, "screenshot": "atlas001-g4-2-blocked.png"}
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and target.port and target.path == "/", "Only loopback compiled app is authorized")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            results = [run_normal(browser, args.url, args.evidence_dir), run_bounded(browser, args.url, args.evidence_dir), run_blocked(browser, args.url, args.evidence_dir)]
        finally:
            browser.close()
    manifest = {"status": "PASS", "commitSha": os.environ.get("G4_2_COMMIT_SHA", "unknown"), "results": results}
    (args.evidence_dir / "atlas001-g4-2-real-chromium.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("PASS ATLAS-001 G4.2 NORMAL/BOUNDED/BLOCKED Chromium acceptance")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

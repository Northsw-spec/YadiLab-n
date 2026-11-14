#!/usr/bin/env python3
"""PROJECT-089: compiled Chromium import detection and consent UX."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_project087_enterprise_topology_real_browser import MIME, canonical_rows, require, synthetic_xlsx
from run_ic010_p2_shared_xml_real_browser import exported_source


EXPECTED = {
    "A": "23fb1ad480d15326f696c19955151a9182a87b4f52bac2ef92f697ebde574dbe",
    "B": "895602de3b97509eacc28428b9f6207c687e5f242c3961bfc7034538368c5bd7",
}


def source_bytes(profile, key):
    path = os.environ.get(f"PROJECT089_XLSX_{key}")
    if path:
        payload = Path(path).read_bytes()
        require(hashlib.sha256(payload).hexdigest() == EXPECTED[key], f"Unexpected SHA-256 for original workbook {path}")
        return payload, "uploaded-original"
    return synthetic_xlsx("legacy-six" if key == "A" else "legacy-src-22"), "synthetic-ci-fixture"


def open_import(page, payload, filename):
    page.locator('[data-network-import-primary="true"]').click()
    panel = page.locator('[data-network-import-panel="ready"]')
    expect(panel).to_be_visible(timeout=20000)
    panel.locator('[data-network-import-file="true"]').set_input_files({
        "name": filename, "mimeType": MIME, "buffer": payload,
    })
    expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=120000)
    return panel


def exercise(browser, url, key, evidence_dir):
    payload, source_kind = source_bytes("legacy-six" if key == "A" else "legacy-src-22", key)
    page = browser.new_page(accept_downloads=True, viewport={"width": 1366, "height": 768})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        panel = open_import(page, payload, f"PROJECT-089-{key}.xlsx")
        expect(panel).to_contain_text("Devices: 47 · Explicit links: 46", timeout=120000)
        expect(panel.locator('[data-network-import-detected]')).to_be_visible()
        confirmation = panel.locator('[data-network-import-confirmation="true"]')
        expect(confirmation).to_be_visible()
        button = panel.locator('[data-network-import-activate="true"]')
        if key == "B":
            consent = panel.locator('[data-legacy-workbook-consent="true"]')
            expect(consent).to_be_visible()
            require(not consent.is_checked(), "SRC consent was prechecked")
            require(button.is_disabled(), "SRC activation was enabled before consent")
            consent.focus()
            page.keyboard.press("Space")
            expect(consent).to_be_checked()
            expect(button).to_be_enabled()
            consent_box = consent.bounding_box()
            button_box = button.bounding_box()
            require(consent_box and consent_box["width"] >= 24 and consent_box["height"] >= 24, "Consent checkbox is not 24x24")
            require(button_box and button_box["y"] + button_box["height"] <= 768, "Sticky activation buttons are inaccessible at 1366x768")
        else:
            require(panel.locator('[data-legacy-workbook-consent="true"]').count() == 0, "Six-sheet workbook showed SRC-22 consent")
            expect(button).to_be_enabled()
        button.click()
        expect(panel).to_have_count(0, timeout=180000)
        exported = exported_source(page)
        require(len(exported["resources"]) == 47, f"{key}: activation changed canonical resources")
        require(len(exported["connections"]) == 46, f"{key}: activation changed canonical links")
        page.set_viewport_size({"width": 390, "height": 844})
        require(page.evaluate("document.documentElement.scrollWidth") <= 392, f"{key}: mobile import overflow")
        result = {"key": key, "sourceKind": source_kind, "sourceSha256": hashlib.sha256(payload).hexdigest(), "devices": 47, "links": 46, "pageErrors": errors}
        (evidence_dir / f"project089-{key}.json").write_text(json.dumps(result, indent=2) + "\n")
        return result
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
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        launch = {"headless": True, "args": flags}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        browser = playwright.chromium.launch(**launch)
        try:
            results = [exercise(browser, args.url, key, args.evidence_dir) for key in ("A", "B")]
        finally:
            browser.close()
    print("PASS PROJECT-089 compiled Chromium import detection and consent acceptance")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

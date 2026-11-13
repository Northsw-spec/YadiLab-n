#!/usr/bin/env python3
"""ATLAS-001 G4: real synthetic XLSX import through bounded Atlas Chromium."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_atlas001_real_browser import capture_page_evidence, require_loopback, wait_for_final_layout
from run_ic010_p2_shared_xml_real_browser import exported_source


ROOT = Path(__file__).resolve().parents[2]
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
VIEWPORTS = ((1366, 768), (1280, 800), (1920, 1080), (390, 844))
CASES = (
    {"key": "g4-a", "fixture": ROOT / "tests/fixtures/import/atlas001-g4-500.xlsx", "sha256": "84a32fb149903e89488ec656d036622b5b81b7086c84b8352f24138273e48fde", "resources": 500, "connections": 499, "zones": 10, "node_prefix": "g4_node_", "link_prefix": "g4_link_", "page_count": 10},
    {"key": "g4-b", "fixture": ROOT / "tests/fixtures/import/atlas001-g4b-500.xlsx", "sha256": "9dabeae5901931845059bba4a380b7b543192f06948d270a615fdf765031e8ed", "resources": 500, "connections": 500, "zones": 4, "node_prefix": "b4_device_", "link_prefix": "b4_link_", "page_count": 11},
)


def require(ok, message):
    if not ok:
        raise AssertionError(message)


def import_fixture(page, case):
    fixture = case["fixture"]
    payload = fixture.read_bytes()
    require(hashlib.sha256(payload).hexdigest() == case["sha256"], f'{case["key"]} fixture SHA-256 changed')
    page.locator('[data-network-import-primary="true"]').click()
    panel = page.locator('[data-network-import-panel="ready"]')
    expect(panel).to_be_visible(timeout=20000)
    panel.locator('[data-network-import-file="true"]').set_input_files({"name": fixture.name, "mimeType": MIME, "buffer": payload})
    expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=120000)
    expect(panel).to_contain_text(f'Devices: {case["resources"]} · Explicit links: {case["connections"]}', timeout=120000)
    expect(panel.locator('[data-atlas-bounded-profile="REVIEW_REQUIRED"]')).to_be_visible()
    consent = panel.locator('[data-atlas-bounded-consent="true"]')
    require(not consent.is_checked(), "bounded Atlas consent was prechecked")
    activate = panel.locator('[data-network-import-activate="true"]')
    require(activate.is_disabled(), "G4 activation was enabled before consent")
    consent.check()
    expect(activate).to_be_enabled()
    activate.click()
    expect(panel).to_have_count(0, timeout=180000)
    source = exported_source(page)
    require(len(source["resources"]) == case["resources"], "canonical resource count changed after activation")
    require(len(source["connections"]) == case["connections"], "canonical link count changed after activation")
    resource_ids = {resource["id"] for resource in source["resources"]}
    require(resource_ids == {f'{case["node_prefix"]}{index:03d}' for index in range(1, case["resources"] + 1)}, "canonical resource IDs changed")
    connection_ids = {connection["id"] for connection in source["connections"]}
    require(connection_ids == {f'{case["link_prefix"]}{index:03d}' for index in range(1, case["connections"] + 1)}, "canonical link IDs changed")
    require(all(connection["from"].get("port") and connection["to"].get("port") for connection in source["connections"]), "canonical endpoints lost declared ports")
    require(len(source.get("zones", [])) == case["zones"], "canonical zones changed")
    require(source.get("networkImportProvenance", {}).get("source", {}).get("sha256") == case["sha256"], "source provenance SHA missing")
    return source


def focus_resource(page, panel, resource_id):
    search = page.get_by_label("Sök i topology")
    search.fill(resource_id)
    result = page.get_by_role("option").filter(has_text=resource_id).first
    expect(result).to_be_visible(timeout=15000)
    result.click()
    wait_for_final_layout(page, panel, panel.get_attribute("data-atlas-active-page"))
    page.evaluate("document.querySelector('.topology-panel')?.scrollIntoView({block: 'center', inline: 'nearest'})")
    page.wait_for_timeout(400)


def exercise(browser, url, evidence_dir, viewport, case):
    width, height = viewport
    page = browser.new_page(accept_downloads=True, viewport={"width": width, "height": height}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        source = import_fixture(page, case)
        page.get_by_role("button", name="ATLAS PAGES").click()
        panel = page.locator(".topology-panel")
        expect(panel).to_have_attribute("data-atlas-active-page", timeout=30000)
        page_count = int(panel.get_attribute("data-atlas-page-count") or "0")
        require(page_count == case["page_count"], f'Expected {case["page_count"]} derived Atlas pages from the fixture, got {page_count}')
        page_options = page.locator("[data-atlas-page-option]")
        require(page_options.count() == page_count, "Atlas page list count differs from derived page count")
        first_page = panel.get_attribute("data-atlas-active-page")
        first_resources = json.loads(panel.get_attribute("data-atlas-page-resource-ids"))
        first_resource = first_resources[len(first_resources) // 2]
        focus_resource(page, panel, first_resource)
        first = capture_page_evidence(page, panel, first_page, viewport)
        page.screenshot(path=str(evidence_dir / f'atlas001-{case["key"]}-{width}x{height}-first.png'), full_page=True)

        middle_page = page_options.nth(page_count // 2).get_attribute("data-atlas-page-option")
        page_options.nth(page_count // 2).click()
        middle_resources = json.loads(panel.get_attribute("data-atlas-page-resource-ids"))
        middle_resource = middle_resources[len(middle_resources) // 2]
        focus_resource(page, panel, middle_resource)
        middle = capture_page_evidence(page, panel, middle_page, viewport)
        page.screenshot(path=str(evidence_dir / f'atlas001-{case["key"]}-{width}x{height}-middle.png'), full_page=True)

        last_page = page_options.nth(page_count - 1).get_attribute("data-atlas-page-option")
        page_options.nth(page_count - 1).click()
        last_resources = json.loads(panel.get_attribute("data-atlas-page-resource-ids"))
        last_resource = last_resources[len(last_resources) // 2]
        focus_resource(page, panel, last_resource)
        last = capture_page_evidence(page, panel, last_page, viewport)
        page.screenshot(path=str(evidence_dir / f'atlas001-{case["key"]}-{width}x{height}-last.png'), full_page=True)

        # Search is canonical/global and must open the page containing a remote
        # resource, rather than merely filtering the current bounded canvas.
        search = page.get_by_label("Sök i topology")
        target_id = f'{case["node_prefix"]}{case["resources"]:03d}'
        search.fill(target_id)
        result = page.get_by_role("option").filter(has_text=target_id).first
        expect(result).to_be_visible(timeout=15000)
        result.click()
        wait_for_final_layout(page, panel, last_page)
        require(panel.get_attribute("data-atlas-active-page") == last_page, "global search opened the wrong Atlas page")

        # Exercise the stale-result guard with immediate page changes.
        page_options.nth(1).click()
        page_options.nth(page_count - 1).click()
        page_options.nth(0).click()
        wait_for_final_layout(page, panel, first_page)
        boundary = page.locator("[data-atlas-boundary-connection]").first
        expect(boundary).to_be_visible(timeout=15000)
        destination = boundary.get_attribute("data-atlas-destination-page")
        connection_id = boundary.get_attribute("data-atlas-boundary-connection")
        require(destination and connection_id, "boundary reference lacks destination or canonical connection")
        boundary.click()
        destination_evidence = capture_page_evidence(page, panel, destination, viewport)
        require(destination_evidence["page"] != first_page, "boundary navigation did not change page")
        page.get_by_role("button", name="Tillbaka").click()
        wait_for_final_layout(page, panel, first_page)
        require(not errors, f"Chromium page errors: {errors!r}")
        require(panel.get_attribute("data-atlas-global-builder-layout") == "NOT_RUN", "bounded Atlas activation did not prove no global Builder layout")
        return {"case": case["key"], "viewport": [width, height], "pageCount": page_count, "sourceSha256": case["sha256"], "canonicalResources": len(source["resources"]), "canonicalLinks": len(source["connections"]), "first": first, "middle": middle, "last": last, "boundaryConnection": connection_id, "boundaryDestination": destination, "destination": destination_evidence, "screenshots": [f'atlas001-{case["key"]}-{width}x{height}-first.png', f'atlas001-{case["key"]}-{width}x{height}-middle.png', f'atlas001-{case["key"]}-{width}x{height}-last.png'], "pageErrors": errors}
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    require_loopback(args.url)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            results = [exercise(browser, args.url, args.evidence_dir, viewport, case) for case in CASES for viewport in VIEWPORTS]
        finally:
            browser.close()
    manifest = {"status": "PASS", "commitSha": os.environ.get("G4_COMMIT_SHA", "unknown"), "fixtures": [{"kind": "synthetic-xlsx-fixture", "path": str(case["fixture"]), "sha256": case["sha256"], "resources": case["resources"], "connections": case["connections"]} for case in CASES], "results": results}
    (args.evidence_dir / "atlas001-g4-real-chromium.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("PASS ATLAS-001 G4.1 independent XLSX imports and bounded Chromium navigation")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

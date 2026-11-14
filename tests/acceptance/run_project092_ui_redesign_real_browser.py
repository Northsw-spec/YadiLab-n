#!/usr/bin/env python3
"""PROJECT-092: real Chromium proof for the topology-first toolbar and active counts."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import menu, require, setup
from run_project086_hierarchical_xlsx_real_browser import access_id, dist_id, hierarchical_xlsx
from run_project090_hierarchical_stability_real_browser import activate, search_and_open
from run_project091_arvidsjaur_layout_real_browser import open_access


def toolbar_case(browser, url, evidence_dir, width, height):
    page, errors, outside = setup(browser, url)
    page.set_viewport_size({"width": width, "height": height})
    # set_viewport_size after navigation is intentional: this verifies the
    # already-mounted compiled Chromium UI at the required desktop/mobile sizes.
    page.reload(wait_until="domcontentloaded")
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    try:
        toolbar = page.locator('[data-primary-toolbar="true"]')
        expect(toolbar).to_be_visible()
        expect(page.get_by_role("button", name="Importera", exact=True)).to_be_visible()
        expect(page.locator(".workspace-menu-export > summary")).to_contain_text("Exportera")
        expect(page.locator(".workspace-menu-advanced > summary")).to_contain_text("Avancerade verktyg")
        if width == 390:
            require(page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth"), "390px toolbar has horizontal overflow")
        page.screenshot(path=str(evidence_dir / f"project092-toolbar-{width}x{height}.png"), full_page=True)
        return {
            "viewport": f"{width}x{height}",
            "screenshot": f"project092-toolbar-{width}x{height}.png",
            "pageErrors": errors,
            "outsideRequests": outside,
        }
    finally:
        page.close()


def case(browser, url, evidence_dir):
    toolbar_reports = [
        toolbar_case(browser, url, evidence_dir, 1920, 1080),
        toolbar_case(browser, url, evidence_dir, 1366, 768),
        toolbar_case(browser, url, evidence_dir, 1280, 800),
        toolbar_case(browser, url, evidence_dir, 390, 844),
    ]
    page, errors, outside = setup(browser, url)
    page.set_viewport_size({"width": 1366, "height": 768})
    page.reload(wait_until="domcontentloaded")
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    try:
        # Export and advanced tools are anchored popovers. Their open state must
        # not change the document position of the primary workspace.
        workspace = page.locator(".workspace-grid")
        before_y = workspace.bounding_box()["y"]
        export_menu = page.locator(".workspace-menu-export")
        export_menu.locator("summary").click()
        expect(export_menu).to_have_attribute("open", "")
        after_y = workspace.bounding_box()["y"]
        require(abs(after_y - before_y) < 1, "Export popover reflowed the workspace")
        expect(export_menu.get_by_role("button", name="Exportera källfil")).to_be_visible()
        page.screenshot(path=str(evidence_dir / "project092-export-popover-1366x768.png"), full_page=False)
        page.keyboard.press("Escape")
        expect(export_menu).not_to_have_attribute("open", "")

        advanced = page.locator(".workspace-menu-advanced")
        advanced.locator("summary").click()
        expect(advanced).to_have_attribute("open", "")
        require(advanced.locator("summary").count() == 1, "Advanced popover leaked nested summary controls into the legacy menu contract")
        expect(advanced.locator('[data-advanced-tools-search="true"]')).to_be_visible()
        advanced_search = advanced.locator('[data-advanced-tools-search="true"]')
        advanced_search.fill("GraphML")
        expect(advanced.get_by_role("button", name="Inspect GraphML (read-only preview)")).to_be_visible()
        page.screenshot(path=str(evidence_dir / "project092-advanced-tools-1366x768.png"), full_page=False)
        advanced_search.fill("")
        page.mouse.click(4, 4)
        expect(advanced).not_to_have_attribute("open", "")

        source, devices, links = hierarchical_xlsx()
        activate(page, source)
        panel = page.locator(".topology-panel")
        device_count = page.locator('[data-topology-active-device-count]')
        link_count = page.locator('[data-topology-active-link-count]')
        group_count = page.locator('[data-topology-active-group-count]')
        expect(device_count).to_have_attribute("data-topology-active-device-count", "34", timeout=180000)
        require(device_count.get_attribute("data-topology-active-device-count") == "34", "Overview active device count is not 34")
        require(link_count.get_attribute("data-topology-active-link-count") == "34", "Overview active link count is not 34")
        require(group_count.get_attribute("data-topology-active-group-count") == "5", "Overview presentation group count is not 5")
        canonical_counts = page.locator('[data-topology-canonical-counts="true"]')
        # Pinned Chromium can publish the active-count attributes before the
        # canonical-count text nodes have painted. Wait for the source-derived
        # text explicitly so this is a real rendered assertion, not a timing
        # sample of an intermediate React commit.
        expect(canonical_counts).to_contain_text("10000 · 10000", timeout=180000)
        page.screenshot(path=str(evidence_dir / "project092-overview-1366x768.png"), full_page=False)

        search_and_open(page, dist_id(4))
        expect(device_count).to_have_attribute("data-topology-active-device-count", "10", timeout=180000)
        require(device_count.get_attribute("data-topology-active-device-count") == "10", "Distribution active device count is not 10")
        require(link_count.get_attribute("data-topology-active-link-count") == "9", "Distribution active link count is not 9")
        require(group_count.get_attribute("data-topology-active-group-count") == "3", "Distribution presentation group count is not 3")
        page.screenshot(path=str(evidence_dir / "project092-distribution-1366x768.png"), full_page=False)

        open_access(page, panel, access_id(25))
        expect(device_count).to_have_attribute("data-topology-active-device-count", "40", timeout=180000)
        require(device_count.get_attribute("data-topology-active-device-count") == "40", "Access active device count is not 40")
        require(link_count.get_attribute("data-topology-active-link-count") == "39", "Access active link count is not 39")
        require(group_count.get_attribute("data-topology-active-group-count") == "7", "Access presentation group count is not 7")
        page.screenshot(path=str(evidence_dir / "project092-access-1366x768.png"), full_page=False)

        require(not errors, f"Uncaught Chromium page errors: {errors!r}")
        require(not outside, f"Unexpected external requests: {outside!r}")
        return {
            "status": "PASS",
            "sourceKind": "synthetic-ci-fixture",
            "canonicalDevices": len(devices),
            "canonicalLinks": len(links),
            "activeCounts": {
                "overview": [34, 34, 5],
                "distribution-0004": [10, 9, 3],
                "access-0025": [40, 39, 7],
            },
            "toolbar": toolbar_reports,
            "screenshots": sorted(path.name for path in evidence_dir.glob("project092-*.png")),
            "pageErrors": errors,
            "outsideRequests": outside,
        }
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
            report = case(browser, args.url, args.evidence_dir)
        finally:
            browser.close()
    (args.evidence_dir / "project092-ui-redesign.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS PROJECT-092 topology-first UI Chromium acceptance")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

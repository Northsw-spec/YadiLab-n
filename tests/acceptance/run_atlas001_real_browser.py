#!/usr/bin/env python3
"""ATLAS-001 G3: compiled Chromium page navigation and screenshot evidence."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


VIEWPORTS = ((1366, 768), (1280, 800), (1920, 1080), (390, 844))


def require_loopback(url: str) -> None:
    target = urlsplit(url)
    if target.scheme != "http" or target.hostname != "127.0.0.1" or not target.port or target.path != "/" or target.query or target.fragment:
        raise AssertionError("ATLAS-001 must exercise the compiled app on loopback without query or fragment")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    require_loopback(args.url)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    screenshots = []
    errors = []
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            for width, height in VIEWPORTS:
                page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
                page_errors = []
                page.on("pageerror", lambda error, bucket=page_errors: bucket.append(str(error)))
                page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
                expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=30000)
                page.locator('[data-guided-lab-start="direct"]').click()
                page.wait_for_function("document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id')", timeout=45000)
                page.get_by_role("button", name="ATLAS PAGES").click()
                panel = page.locator(".topology-panel")
                expect(panel).to_have_attribute("data-atlas-active-page", timeout=30000)
                page_count = int(panel.get_attribute("data-atlas-page-count") or "0")
                if page_count < 2:
                    raise AssertionError(f"Expected at least two Atlas pages, got {page_count}")
                first_page = panel.get_attribute("data-atlas-active-page")
                expect(page.locator('[data-atlas-page-list]')).to_be_visible(timeout=15000)
                expect(page.locator('.atlas-page-status [data-atlas-layout-status="PENDING"], .atlas-page-status [data-atlas-layout-quality]')).to_have_count(1, timeout=30000)
                screenshot_name = f"atlas001-{width}x{height}-page-a.png"
                page.screenshot(path=str(args.evidence_dir / screenshot_name), full_page=True)
                screenshots.append({"viewport": [width, height], "page": first_page, "path": screenshot_name})

                boundary = page.locator("[data-atlas-boundary-connection]").first
                expect(boundary).to_be_visible(timeout=15000)
                destination = boundary.get_attribute("data-atlas-destination-page")
                connection_id = boundary.get_attribute("data-atlas-boundary-connection")
                boundary.click()
                expect(panel).to_have_attribute("data-atlas-active-page", destination, timeout=30000)
                if panel.get_attribute("data-atlas-active-page") == first_page:
                    raise AssertionError("Boundary navigation did not change Atlas page")
                screenshot_name = f"atlas001-{width}x{height}-page-b.png"
                page.screenshot(path=str(args.evidence_dir / screenshot_name), full_page=True)
                screenshots.append({"viewport": [width, height], "page": destination, "path": screenshot_name, "fromConnection": connection_id})

                page.get_by_role("button", name="Tillbaka").click()
                expect(panel).to_have_attribute("data-atlas-active-page", first_page, timeout=30000)
                if page_errors:
                    errors.extend(page_errors)
                page.close()
            if errors:
                raise AssertionError("Chromium page errors: " + repr(errors))
        finally:
            browser.close()
    evidence = {"status": "PASS", "viewports": [list(item) for item in VIEWPORTS], "screenshots": screenshots, "pageErrors": errors}
    (args.evidence_dir / "atlas001-real-chromium.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("PASS ATLAS-001 G3 compiled Chromium navigation")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""PROJECT-088: real Chromium proof that manageable imports open as normal topology."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import exported_source, require
from run_project087_enterprise_topology_real_browser import MIME, fixture_bytes, setup


def attr_values(locator, attribute):
    return locator.evaluate_all("(els, attribute) => els.map(el => el.getAttribute(attribute)).filter(Boolean)", attribute)


def run_case(browser, url, evidence_dir, profile, env_name):
    page, errors, outside = setup(browser, url)
    try:
        source, source_kind = fixture_bytes(profile, env_name)
        source_sha = hashlib.sha256(source).hexdigest()
        page.locator('[data-network-import-primary="true"]').click()
        panel = page.locator('[data-network-import-panel="ready"]')
        expect(panel).to_be_visible(timeout=15000)
        panel.locator('[data-network-import-file="true"]').set_input_files({
            "name": "PROJECT-088-Arvidsjaur-A.xlsx", "mimeType": MIME, "buffer": source,
        })
        expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=120000)
        if profile == "legacy-src-22":
            panel.locator('[data-legacy-workbook-consent="true"]').check()
        panel.locator('[data-network-import-activate="true"]').click()
        expect(panel).to_have_count(0, timeout=180000)
        expect(page.locator('[data-topology-mode="normal"][aria-pressed="true"]')).to_be_visible(timeout=180000)
        require(page.locator('section[data-topology-overview]').count() == 0, "normal mode opened an inventory group projection")

        exported = exported_source(page)
        canonical_resources = {resource["id"] for resource in exported["resources"]}
        canonical_links = {connection["id"]: (connection["from"]["resource"], connection["to"]["resource"]) for connection in exported["connections"]}
        resource_nodes = page.locator('.react-flow__node-resource:not(:has([data-overview-group]))')
        require(resource_nodes.count() == 47, f"normal mode rendered {resource_nodes.count()} resources, expected 47")
        rendered_resource_ids = set(attr_values(resource_nodes, "data-id"))
        require(rendered_resource_ids == canonical_resources, "rendered resource IDs differ from canonical export")

        canvas = page.locator(".topology-panel")
        require(canvas.get_attribute("data-topology-edge-count") == "46", "normal mode did not render 46 declared links")
        rendered_edges = page.locator('path[data-connection-source][data-connection-target]')
        require(rendered_edges.count() == 46, f"normal mode rendered {rendered_edges.count()} SVG semantic edges")
        edge_ids = set(attr_values(rendered_edges, "id"))
        require(edge_ids == set(canonical_links), "rendered link IDs differ from canonical export")
        rendered_pairs = {
            edge_id: (source_id, target_id)
            for edge_id, source_id, target_id in rendered_edges.evaluate_all(
                "els => els.map(el => [el.id, el.getAttribute('data-connection-source'), el.getAttribute('data-connection-target')])"
            )
        }
        require(rendered_pairs == canonical_links, "rendered endpoint pairs differ from canonical export")
        require(all((edge.get_attribute("d") or "").startswith("M") for edge in rendered_edges.all()), "one or more semantic edges has no SVG path")
        route_paths = [edge.get_attribute("d") or "" for edge in rendered_edges.all()]
        require(all(" C " not in path for path in route_paths), "normal topology fell back to generic Bezier routing")
        require(not errors, f"Chromium page errors: {errors!r}")
        require(not outside, f"Unexpected external requests: {outside!r}")
        suffix = "legacy-six" if profile == "legacy-six" else "legacy-src-22"
        page.screenshot(path=str(evidence_dir / f"project088-arvidsjaur-normal-{suffix}-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        require(page.evaluate("document.documentElement.scrollWidth") <= 392, "normal topology overflows 390px viewport")
        page.screenshot(path=str(evidence_dir / f"project088-arvidsjaur-normal-{suffix}-390px.png"), full_page=True)
        return {
            "status": "PASS",
            "sourceKind": source_kind,
            "sourceSha256": source_sha,
            "canonicalResources": len(canonical_resources),
            "canonicalLinks": len(canonical_links),
            "renderedResources": len(rendered_resource_ids),
            "renderedLinks": rendered_edges.count(),
            "desktopScreenshot": f"project088-arvidsjaur-normal-{suffix}-desktop.png",
            "mobileScreenshot": f"project088-arvidsjaur-normal-{suffix}-390px.png",
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
            report = [
                run_case(browser, args.url, args.evidence_dir, "legacy-six", "PROJECT088_XLSX_A"),
                run_case(browser, args.url, args.evidence_dir, "legacy-src-22", "PROJECT088_XLSX_B"),
            ]
        finally:
            browser.close()
    (args.evidence_dir / "project088-normal-topology-real-browser.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS PROJECT-088 normal topology Chromium acceptance")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

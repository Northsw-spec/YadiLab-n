#!/usr/bin/env python3
"""PROJECT-093: compiled Chromium proof for the semantic topology explorer."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import exported_source, require, setup
from run_project086_hierarchical_xlsx_real_browser import access_id, client_id, dist_id, hierarchical_xlsx
from run_project090_hierarchical_stability_real_browser import activate, search_and_open
from run_project091_arvidsjaur_layout_real_browser import open_access


def orthogonal_path(path_data):
    require(path_data and not re.search(r"[CQSAZcqsa]", path_data), f"Non-orthogonal SVG command: {path_data}")
    points = [(float(x), float(y)) for command, x, y in re.findall(r"([ML])\s*(-?[0-9.]+)\s+(-?[0-9.]+)", path_data)]
    require(len(points) >= 2, f"SVG path has no usable polyline: {path_data}")
    for before, after in zip(points, points[1:]):
        require(before[0] == after[0] or before[1] == after[1], f"SVG path has a diagonal segment: {path_data}")


def canonical_rows(page):
    return page.locator(
        'path[data-connection-source][data-connection-target][data-hierarchy-visual="true"]'
    ).evaluate_all(
        "els => els.map(path => ({id: path.id, source: path.getAttribute('data-connection-source'), "
        "target: path.getAttribute('data-connection-target'), sourcePort: path.getAttribute('data-connection-source-port'), "
        "targetPort: path.getAttribute('data-connection-target-port'), vlan: path.getAttribute('data-link-vlan'), "
        "routeKind: path.getAttribute('data-route-kind'), d: path.getAttribute('d') || ''}))"
    )


def assert_canonical_access(page, expected_links, expected_endpoints):
    paths = page.locator('path[data-connection-source][data-connection-target][data-hierarchy-visual="true"]')
    expect(paths).to_have_count(len(expected_links), timeout=180000)
    rows = canonical_rows(page)
    ids = [row["id"] for row in rows]
    counts = Counter(ids)
    require(not (set(ids) - expected_links), f"Fabricated canonical links: {set(ids) - expected_links}")
    require(not (expected_links - set(ids)), f"Missing canonical links: {expected_links - set(ids)}")
    require(not [link_id for link_id, count in counts.items() if count != 1], f"Duplicate canonical SVG paths: {counts}")
    for row in rows:
        require((row["source"], row["target"]) == expected_endpoints[row["id"]], f"Endpoint mismatch: {row}")
        require(row["routeKind"] == "orthogonal", f"Canonical link route is not orthogonal: {row}")
        require(row["vlan"] is not None, f"VLAN metadata missing from canonical path: {row}")
        orthogonal_path(row["d"])
    require(page.locator('path[id^="link-"][data-connection-source][data-connection-target]').count() == len(expected_links),
            "Canonical SVG path count is not one per source link")
    return rows


def assert_no_card_crossings(page):
    result = page.evaluate(
        """() => {
          const pointList = d => [...(d || '').matchAll(/([ML])\\s*(-?[0-9.]+)\\s+(-?[0-9.]+)/g)]
            .map(match => ({ x: Number(match[2]), y: Number(match[3]) }));
          const toScreen = (point, ctm) => {
            const transformed = new DOMPoint(point.x, point.y).matrixTransform(ctm);
            return { x: transformed.x, y: transformed.y };
          };
          const cards = [...document.querySelectorAll('.react-flow__node-resource[data-id]')]
            .map(node => { const rect = node.getBoundingClientRect(); return { id: node.getAttribute('data-id'), rect }; });
          const crosses = (from, to, rect) => {
            const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x);
            const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y);
            // A route that terminates exactly on a card border is valid. Keep
            // a small screen-space interior margin so floating-point transform
            // noise cannot report a border touch as card penetration.
            const margin = 3;
            if (from.x === to.x) return from.x > rect.left + margin && from.x < rect.right - margin && maxY > rect.top + margin && minY < rect.bottom - margin;
            if (from.y === to.y) return from.y > rect.top + margin && from.y < rect.bottom - margin && maxX > rect.left + margin && minX < rect.right - margin;
            return true;
          };
          const hits = [];
          for (const path of document.querySelectorAll('path[data-connection-source][data-connection-target][data-hierarchy-visual="true"]')) {
            const source = path.getAttribute('data-connection-source');
            const target = path.getAttribute('data-connection-target');
            // Include React Flow's nested viewport transform. Using the root
            // SVG CTM alone maps routes into the wrong coordinate system and
            // reports false intersections with unrelated resource cards.
            const ctm = path.getScreenCTM?.();
            if (!ctm) continue;
            const points = pointList(path.getAttribute('d')).map(point => toScreen(point, ctm));
            for (let index = 1; index < points.length; index += 1) {
              for (const card of cards) {
                if (card.id !== source && card.id !== target && crosses(points[index - 1], points[index], card.rect)) hits.push({ link: path.id, card: card.id });
              }
            }
          }
          return { resourceCards: cards.length, crossings: hits };
        }"""
    )
    require(not result["crossings"], f"Canonical cable crosses an unrelated resource card: {result}")
    return result


def access_contract(page, evidence_dir):
    panel = page.locator(".topology-panel")
    expect(panel).to_have_attribute("data-topology-hierarchy", access_id(25), timeout=180000)
    require(panel.get_attribute("data-topology-hierarchy-node-count") == "40", "Access-0025 is not the exact 40-node view")
    require(panel.get_attribute("data-topology-hierarchy-link-count") == "39", "Access-0025 is not the exact 39-link view")
    page.wait_for_timeout(500)
    visible_ids = set(page.locator('.react-flow__node[data-id]').evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('data-id')).filter(Boolean)"
    ))
    _, _, source_links = hierarchical_xlsx()
    expected_links = {link_id for link_id, source, target in source_links if source in visible_ids and target in visible_ids}
    expected_endpoints = {link_id: (source, target) for link_id, source, target in source_links}
    require(expected_links == {"link-00059", *{f"link-{index:05d}" for index in range(1185, 1223)}},
            f"Access-0025 canonical link set changed: {sorted(expected_links)}")
    rows = assert_canonical_access(page, expected_links, expected_endpoints)
    geometry = assert_no_card_crossings(page)
    require(page.locator('[data-topology-camera="read"]').get_attribute("aria-pressed") == "true",
            "Access branch did not default to readable camera mode")
    label_box = page.locator('.react-flow__node-resource .device-identity strong').first.bounding_box()
    require(label_box and label_box["height"] >= 10,
            f"Default readable camera shrank resource labels below 10 CSS pixels: {label_box}")
    require(page.locator('.semantic-edge-label').count() == 0,
            "Unselected canonical links rendered permanent metadata labels")
    target = next(row for row in rows if row["id"] == "link-01211")
    require((target["source"], target["target"]) == (access_id(25), client_id(921)), f"link-01211 endpoint changed: {target}")
    link_path = page.locator('path#link-01211[data-connection-source][data-connection-target]')
    expect(link_path).to_have_count(1)
    # React Flow's SVG path is selectable on its stroke. Dispatching the
    # bubbled click on the exact canonical path avoids Playwright choosing the
    # empty centre of a long orthogonal bounding box.
    link_path.dispatch_event("click", {"bubbles": True, "cancelable": True})
    inspector = page.locator('[data-topology-selected-link="link-01211"]')
    expect(inspector).to_be_visible(timeout=30000)
    text = inspector.inner_text()
    require("access-0025 → client-00921" in text, f"Inspector omitted exact link endpoints: {text}")
    require("Källport: NOT DOCUMENTED" in text and "Målport: NOT DOCUMENTED" in text, f"Inspector omitted port provenance: {text}")
    require("VLAN: NOT DOCUMENTED" in text, f"Inspector fabricated VLAN metadata: {text}")
    expect(page.locator('[data-topology-focus-link="link-01211"]')).to_be_visible()
    page.screenshot(path=str(evidence_dir / "project093-access-0025-link-01211.png"), full_page=True)
    page.locator('[data-topology-camera="overview"]').click()
    expect(page.locator('[data-topology-camera="overview"]')).to_have_attribute("aria-pressed", "true")
    page.screenshot(path=str(evidence_dir / "project093-access-0025-overview-camera.png"), full_page=False)
    page.locator('[data-topology-camera="read"]').click()
    expect(page.locator('[data-topology-camera="read"]')).to_have_attribute("aria-pressed", "true")
    export_menu = page.locator(".workspace-menu-export")
    export_menu.locator("summary").click()
    expect(export_menu).to_have_attribute("open", "")
    page.screenshot(path=str(evidence_dir / "project093-export-open.png"), full_page=False)
    page.keyboard.press("Escape")
    advanced_menu = page.locator(".workspace-menu-advanced")
    advanced_menu.locator("summary").click()
    expect(advanced_menu).to_have_attribute("open", "")
    page.screenshot(path=str(evidence_dir / "project093-advanced-open.png"), full_page=False)
    page.keyboard.press("Escape")
    return {
        "expectedLinkCount": len(expected_links),
        "renderedLinkCount": len(rows),
        "expectedLinkIds": sorted(expected_links),
        "selectedLink": {"id": target["id"], "source": target["source"], "target": target["target"]},
        "inspectorText": text,
        "geometry": geometry,
    }


def case(browser, url, evidence_dir):
    page, errors, outside = setup(browser, url)
    page.set_viewport_size({"width": 1366, "height": 768})
    page.reload(wait_until="domcontentloaded")
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
    source, devices, links = hierarchical_xlsx()
    try:
        activate(page, source)
        panel = page.locator(".topology-panel")
        exported = exported_source(page)
        require(len(exported["resources"]) == 10000 and len(exported["connections"]) == 10000, "Canonical inventory counts changed")
        require([row[0] for row in devices] == [row["id"] for row in exported["resources"]], "Canonical device IDs changed")
        require([row[0] for row in links] == [row["id"] for row in exported["connections"]], "Canonical link IDs changed")
        require([(row[1], row[2]) for row in links] == [(row["from"]["resource"], row["to"]["resource"]) for row in exported["connections"]], "Canonical endpoints changed")
        require(panel.bounding_box()["y"] <= 240, f"Topology canvas is below first viewport: {panel.bounding_box()}")
        expect(page.locator('[data-topology-icon-overview="true"]')).to_be_visible()
        require(page.locator('[data-icon-overview-key]').count() >= 12, "Icon overview is incomplete")
        require(page.locator('.react-flow__node-resource .semantic-icon[data-icon-key]').count() >= 34, "Resource icons are not rendered")
        require(page.locator('.legacy-workspace-menus, .legacy-network-import-button').count() == 0, "Hidden legacy interactive rail still exists")
        page.screenshot(path=str(evidence_dir / "project093-overview-1366x768.png"), full_page=False)

        search_and_open(page, dist_id(4))
        require(panel.get_attribute("data-topology-hierarchy") == dist_id(4), "Distribution navigation failed")
        page.screenshot(path=str(evidence_dir / "project093-distribution-0004-1366x768.png"), full_page=False)

        open_access(page, panel, access_id(25))
        access_report = access_contract(page, evidence_dir)
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        require(page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth"),
                "390px topology layout has horizontal overflow")
        page.screenshot(path=str(evidence_dir / "project093-access-0025-390x844.png"), full_page=True)
        require(not errors, f"Uncaught Chromium page errors: {errors!r}")
        require(not outside, f"Unexpected external requests: {outside!r}")
        return {
            "status": "PASS",
            "sourceKind": "synthetic-ci-fixture",
            "canonicalDevices": len(devices),
            "canonicalLinks": len(links),
            "access": access_report,
            "screenshots": sorted(path.name for path in evidence_dir.glob("project093-*.png")),
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
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and target.port and target.path == "/",
            "Only loopback compiled app is authorized")
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
    (args.evidence_dir / "project093-semantic-explorer.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS PROJECT-093 semantic topology explorer Chromium acceptance")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

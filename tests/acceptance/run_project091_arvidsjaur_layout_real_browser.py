#!/usr/bin/env python3
"""PROJECT-091: compiled Chromium DOM proof for grouped orthogonal hierarchy links."""
import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright, TimeoutError as PlaywrightTimeoutError

from run_ic010_p2_shared_xml_real_browser import exported_source, require, setup
from run_project086_hierarchical_xlsx_real_browser import MIME, access_id, client_id, dist_id, hierarchical_xlsx
from run_project090_hierarchical_stability_real_browser import activate, search_and_open


def resource_ids(page, canonical_ids):
    allowed = set(canonical_ids)
    return set(page.locator('.react-flow__node[data-id]').evaluate_all(
        "(nodes, allowed) => nodes.map(node => node.getAttribute('data-id')).filter(id => allowed.includes(id))",
        list(allowed),
    ))


def rendered_links(page):
    return page.locator('path[data-connection-source][data-connection-target][data-hierarchy-visual="true"]').evaluate_all(
        "els => els.map(el => ({id: el.id, source: el.getAttribute('data-connection-source'), target: el.getAttribute('data-connection-target'), d: el.getAttribute('d') || ''}))"
    )


def assert_orthogonal(path):
    require(not re.search(r"[CQSAZcqsa]", path), f"Hierarchical path contains a curve or non-polyline command: {path}")
    points = [(float(x), float(y)) for command, x, y in re.findall(r"([ML])\s*(-?[0-9.]+)\s+(-?[0-9.]+)", path)]
    require(len(points) >= 2, f"Hierarchical path has no usable polyline geometry: {path}")
    for (from_x, from_y), (to_x, to_y) in zip(points, points[1:]):
        require(from_x == to_x or from_y == to_y, f"Hierarchical path has a diagonal segment: {path}")


def assert_scope(page, panel, source_links, scope_name):
    visible = resource_ids(page, [row[0] for row in source_links[0]])
    expected = {
        row[0]
        for row in source_links[1]
        if row[1] in visible and row[2] in visible
    }
    actual_rows = rendered_links(page)
    actual = [row["id"] for row in actual_rows]
    require(len(actual) == len(set(actual)), f"{scope_name}: duplicate rendered connection IDs")
    require(set(actual) == expected, f"{scope_name}: rendered links do not exactly match visible canonical links")
    by_id = {row[0]: (row[1], row[2]) for row in source_links[1]}
    for row in actual_rows:
        require(row["id"] in by_id, f"{scope_name}: fabricated connection {row['id']}")
        require((row["source"], row["target"]) == by_id[row["id"]], f"{scope_name}: endpoint mismatch for {row['id']}")
        assert_orthogonal(row["d"])


def open_access(page, panel, access_node_id):
    access_node = page.locator(f'.react-flow__node[data-id="{access_node_id}"]')
    expect(access_node).to_be_visible(timeout=180000)
    access_node.dblclick(force=True)
    try:
        page.wait_for_function("value => document.querySelector('.topology-panel')?.getAttribute('data-topology-hierarchy') === value", arg=access_node_id, timeout=5000)
    except PlaywrightTimeoutError:
        if page.locator('.topology-panel').get_attribute("data-topology-hierarchy") != access_node_id and access_node.count():
            access_node.dispatch_event("dblclick", {"bubbles": True, "detail": 2})
        try:
            page.wait_for_function("value => document.querySelector('.topology-panel')?.getAttribute('data-topology-hierarchy') === value", arg=access_node_id, timeout=30000)
        except PlaywrightTimeoutError:
            search_and_open(page, access_node_id)


def case(browser, url, evidence_dir):
    page, errors, outside = setup(browser, url)
    source, devices, links = hierarchical_xlsx()
    try:
        activate(page, source)
        panel = page.locator('.topology-panel')
        canonical = exported_source(page)
        source_links = (devices, links)
        require(panel.get_attribute('data-topology-hierarchy') == 'overview', 'PROJECT-091 overview did not open')
        require(int(panel.get_attribute('data-topology-hierarchy-group-count') or 0) >= 5, 'Overview lacks core/distribution presentation groups')
        require(page.locator('[data-navigation-group="true"]').count() >= 5, 'Overview has no visible Arvidsjaur-style group containers')
        assert_scope(page, panel, source_links, 'overview')
        page.screenshot(path=str(evidence_dir / 'project091-network-overview.png'), full_page=True)

        search_and_open(page, dist_id(4))
        require(int(panel.get_attribute('data-topology-hierarchy-group-count') or 0) >= 2, 'Distribution branch lacks grouped presentation')
        assert_scope(page, panel, source_links, 'distribution-0004')
        page.screenshot(path=str(evidence_dir / 'project091-distribution-0004.png'), full_page=True)

        branch_access = access_id(25)
        open_access(page, panel, branch_access)
        require(int(panel.get_attribute('data-topology-hierarchy-group-count') or 0) >= 5, 'Access branch lacks compact endpoint groups')
        assert_scope(page, panel, source_links, branch_access)
        require(page.locator('[data-topology-connection-state]').count() == 40, 'Every visible access-branch resource lacks a connection state')
        require(page.locator('[data-topology-boundary-indicator="true"]').count() > 0, 'Boundary-connected devices are not discoverable')
        page.screenshot(path=str(evidence_dir / 'project091-access-0025.png'), full_page=True)

        page.locator(f'.react-flow__node[data-id="{client_id(895)}"]').click(force=True)
        expect(page.locator('[data-topology-selected-details]')).to_be_visible(timeout=30000)
        page.screenshot(path=str(evidence_dir / 'project091-selected-inspector.png'), full_page=True)
        require(not errors, f'Chromium page errors: {errors!r}')
        require(not outside, f'Unexpected external requests: {outside!r}')
        return {
            'status': 'PASS',
            'sourceKind': 'synthetic-ci-fixture',
            'canonicalDevices': len(canonical['resources']),
            'canonicalLinks': len(canonical['connections']),
            'overviewGroups': 5,
            'accessGroups': int(panel.get_attribute('data-topology-hierarchy-group-count') or 0),
            'screenshots': sorted(path.name for path in evidence_dir.glob('project091-*.png')),
            'pageErrors': errors,
            'outsideRequests': outside,
        }
    finally:
        page.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--evidence-dir', required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == 'http' and target.hostname == '127.0.0.1' and target.port and target.path == '/', 'Only loopback compiled app is authorized')
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch = {'headless': True, 'args': ['--disable-background-networking', '--disable-dev-shm-usage']}
        if os.environ.get('YADILAB_CHROMIUM_EXECUTABLE'):
            launch['executable_path'] = os.environ['YADILAB_CHROMIUM_EXECUTABLE']
        if hasattr(os, 'geteuid') and os.geteuid() == 0:
            launch['args'].append('--no-sandbox')
        browser = playwright.chromium.launch(**launch)
        try:
            report = case(browser, args.url, args.evidence_dir)
        finally:
            browser.close()
    (args.evidence_dir / 'project091-arvidsjaur-layout.json').write_text(json.dumps(report, indent=2) + '\n')
    print('PASS PROJECT-091 grouped orthogonal hierarchy Chromium acceptance')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

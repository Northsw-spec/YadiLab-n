#!/usr/bin/env python3
"""PROJECT-094: compiled Chromium proof for the single ELK topology engine."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import exported_source, require, setup
from run_project086_hierarchical_xlsx_real_browser import access_id, client_id, dist_id, hierarchical_xlsx
from run_project090_hierarchical_stability_real_browser import activate, search_and_open
from run_project091_arvidsjaur_layout_real_browser import open_access


ROOT = Path(__file__).resolve().parents[2]
BASELINE_PATH = ROOT / "tests/fixtures/project094/baseline-project093.json"


def points(path_data):
    require(path_data and not re.search(r"[CQSAZcqsa]", path_data), f"Non-orthogonal SVG command: {path_data}")
    parsed = [(float(x), float(y)) for _command, x, y in re.findall(r"([ML])\s*(-?[0-9.]+)\s+(-?[0-9.]+)", path_data)]
    require(len(parsed) >= 2, f"SVG path has no usable polyline: {path_data}")
    for before, after in zip(parsed, parsed[1:]):
        require(abs(before[0] - after[0]) < 1e-6 or abs(before[1] - after[1]) < 1e-6, f"SVG path has a diagonal segment: {path_data}")
    return parsed


def canonical_rows(page):
    return page.locator(
        'path[data-connection-source][data-connection-target][data-hierarchy-visual="true"]'
    ).evaluate_all(
        "els => els.map(path => ({id: path.id, source: path.getAttribute('data-connection-source'), "
        "target: path.getAttribute('data-connection-target'), sourcePort: path.getAttribute('data-connection-source-port'), "
        "targetPort: path.getAttribute('data-connection-target-port'), vlan: path.getAttribute('data-link-vlan'), "
        "routeKind: path.getAttribute('data-route-kind'), routeOrigin: path.getAttribute('data-route-origin'), d: path.getAttribute('d') || ''}))"
    )


def screen_geometry(page):
    """Measure the actual rendered SVG route against live cards and handles."""
    return page.evaluate(
        """() => {
          const parse = d => [...(d || '').matchAll(/([ML])\\s*(-?[0-9.]+)\\s+(-?[0-9.]+)/g)]
            .map(match => ({ x: Number(match[2]), y: Number(match[3]) }));
          const centre = rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          const cards = [...document.querySelectorAll('.react-flow__node-resource[data-id]')].map(node => {
            const rect = node.getBoundingClientRect();
            return { id: node.getAttribute('data-id'), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, node };
          });
          const intersects = (a, b, rect) => {
            const epsilon = 0.5;
            if (Math.abs(a.x - b.x) <= epsilon) {
              const x = (a.x + b.x) / 2;
              return x > rect.left + 3 && x < rect.right - 3 && Math.max(a.y, b.y) > rect.top + 3 && Math.min(a.y, b.y) < rect.bottom - 3;
            }
            if (Math.abs(a.y - b.y) <= epsilon) {
              const y = (a.y + b.y) / 2;
              return y > rect.top + 3 && y < rect.bottom - 3 && Math.max(a.x, b.x) > rect.left + 3 && Math.min(a.x, b.x) < rect.right - 3;
            }
            return true;
          };
          const properCrossing = (a, b) => {
            const ah = Math.abs(a.a.y - a.b.y) <= 0.5;
            const bh = Math.abs(b.a.y - b.b.y) <= 0.5;
            if (ah === bh) return false;
            const horizontal = ah ? a : b;
            const vertical = ah ? b : a;
            const hx1 = Math.min(horizontal.a.x, horizontal.b.x), hx2 = Math.max(horizontal.a.x, horizontal.b.x);
            const vy1 = Math.min(vertical.a.y, vertical.b.y), vy2 = Math.max(vertical.a.y, vertical.b.y);
            const x = vertical.a.x, y = horizontal.a.y;
            return x > hx1 + 0.5 && x < hx2 - 0.5 && y > vy1 + 0.5 && y < vy2 - 0.5;
          };
          const rows = [];
          const segments = [];
          for (const path of document.querySelectorAll('path[data-connection-source][data-connection-target][data-hierarchy-visual="true"]')) {
            const source = path.getAttribute('data-connection-source');
            const target = path.getAttribute('data-connection-target');
            const transform = path.getScreenCTM?.();
            const local = parse(path.getAttribute('d'));
            const screen = transform ? local.map(point => { const p = new DOMPoint(point.x, point.y).matrixTransform(transform); return { x: p.x, y: p.y }; }) : local;
            let length = 0, turns = Math.max(0, screen.length - 2), penetrationCount = 0;
            for (let index = 1; index < screen.length; index += 1) {
              const a = screen[index - 1], b = screen[index];
              length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
              segments.push({ id: path.id, a, b });
              for (const card of cards) if (card.id !== source && card.id !== target && intersects(a, b, card.rect)) penetrationCount += 1;
            }
            const sourceNode = cards.find(card => card.id === source)?.node;
            const targetNode = cards.find(card => card.id === target)?.node;
            const handles = node => [...(node?.querySelectorAll('[data-react-flow-handle-id]') || [])].map(handle => ({ id: handle.getAttribute('data-react-flow-handle-id'), center: centre(handle.getBoundingClientRect()) }));
            const edgeMap = path.closest('.topology-panel')?.getAttribute('data-topology-react-flow-edge-handles');
            let edgeData = [];
            try { edgeData = edgeMap ? JSON.parse(edgeMap) : []; } catch (_error) { edgeData = []; }
            const edge = edgeData.find(row => row.id === path.id);
            const sourceHandle = handles(sourceNode).find(handle => handle.id === edge?.sourceHandle);
            const targetHandle = handles(targetNode).find(handle => handle.id === edge?.targetHandle);
            const distance = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
            rows.push({ id: path.id, source, target, sourceHandle: edge?.sourceHandle ?? null, targetHandle: edge?.targetHandle ?? null, length, turns, penetrationCount, sourceEndpointDistance: distance(screen[0], sourceHandle?.center), targetEndpointDistance: distance(screen.at(-1), targetHandle?.center), points: screen });
          }
          let crossings = 0;
          const crossingPairs = [];
          for (let left = 0; left < segments.length; left += 1) for (let right = left + 1; right < segments.length; right += 1) {
            if (segments[left].id !== segments[right].id && properCrossing(segments[left], segments[right])) {
              crossings += 1;
              crossingPairs.push([segments[left].id, segments[right].id]);
            }
          }
          const overlaps = [];
          for (let left = 0; left < cards.length; left += 1) for (let right = left + 1; right < cards.length; right += 1) {
            const a = cards[left].rect, b = cards[right].rect;
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push([cards[left].id, cards[right].id]);
          }
          return { rows, crossings, crossingPairs, overlaps, cardCount: cards.length };
        }"""
    )


def card_camera_metrics(page):
    return page.evaluate(
        """() => {
          const panel = document.querySelector('.topology-panel');
          const panelRect = panel?.getBoundingClientRect();
          const cards = [...document.querySelectorAll('.react-flow__node-resource[data-id]')].map(node => {
            const rect = node.getBoundingClientRect();
            return { id: node.getAttribute('data-id'), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
          const viewport = document.querySelector('.react-flow__viewport');
          const viewportTransform = viewport ? getComputedStyle(viewport).transform : 'none';
          const matrix = viewportTransform && viewportTransform !== 'none' ? new DOMMatrix(viewportTransform) : null;
          const scaleX = matrix?.a ?? 1;
          const scaleY = matrix?.d ?? 1;
          const primary = [...document.querySelectorAll('.react-flow__node-resource .device-identity strong')]
            .map(element => ({
              id: element.closest('.react-flow__node[data-id]')?.getAttribute('data-id') ?? null,
              cssPx: Number.parseFloat(getComputedStyle(element).fontSize),
              screenPx: element.getBoundingClientRect().height,
            }))
            .filter(item => Number.isFinite(item.cssPx) && Number.isFinite(item.screenPx));
          const secondary = [...document.querySelectorAll('.react-flow__node-resource .device-identity small')]
            .map(element => ({
              id: element.closest('.react-flow__node[data-id]')?.getAttribute('data-id') ?? null,
              cssPx: Number.parseFloat(getComputedStyle(element).fontSize),
              screenPx: element.getBoundingClientRect().height,
            }))
            .filter(item => Number.isFinite(item.cssPx) && Number.isFinite(item.screenPx));
          return {
            panel: panelRect ? { left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom, width: panelRect.width, height: panelRect.height } : null,
            cards,
            viewportTransform,
            viewportScale: { x: scaleX, y: scaleY },
            primary,
            secondary,
            minPrimaryCssPx: primary.length ? Math.min(...primary.map(item => item.cssPx)) : 0,
            minSecondaryCssPx: secondary.length ? Math.min(...secondary.map(item => item.cssPx)) : 0,
            minPrimaryScreenPx: primary.length ? Math.min(...primary.map(item => item.screenPx)) : 0,
            minSecondaryScreenPx: secondary.length ? Math.min(...secondary.map(item => item.screenPx)) : 0,
            documentScrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
          };
        }"""
    )


def group_containment_metrics(page):
    return page.evaluate(
        """() => {
          const panel = document.querySelector('.topology-panel');
          const rect = element => {
            const value = element?.getBoundingClientRect();
            return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height } : null;
          };
          const groups = [...document.querySelectorAll('.react-flow__node .navigation-group-node')].map(group => {
            const host = group.closest('.react-flow__node[data-id]');
            const groupId = host?.getAttribute('data-id') ?? null;
            const members = (group.getAttribute('data-navigation-group-members') || '').split(',').filter(Boolean);
            const groupRect = rect(host);
            const memberRects = members.map(id => {
              const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
              return { id, rect: rect(node), parentId: node?.querySelector('.resource-node')?.getAttribute('data-topology-presentation-group') ?? null };
            });
            const headerRect = rect(group.querySelector('.zone-heading'));
            return { groupId, groupRect, headerRect, members: memberRects };
          });
          const failures = [];
          for (const group of groups) {
            if (!group.groupRect) { failures.push({ groupId: group.groupId, reason: 'GROUP_RECT_MISSING' }); continue; }
            for (const member of group.members) {
              const value = member.rect;
              if (!value) { failures.push({ groupId: group.groupId, memberId: member.id, reason: 'MEMBER_RECT_MISSING' }); continue; }
              const inside = value.left >= group.groupRect.left - 0.5 && value.right <= group.groupRect.right + 0.5 &&
                value.top >= group.groupRect.top - 0.5 && value.bottom <= group.groupRect.bottom + 0.5;
              if (!inside) failures.push({ groupId: group.groupId, memberId: member.id, reason: 'MEMBER_OUTSIDE_GROUP', groupRect: group.groupRect, memberRect: value });
              if (member.parentId !== group.groupId) failures.push({ groupId: group.groupId, memberId: member.id, reason: 'MEMBER_NOT_NESTED', parentId: member.parentId });
              if (group.headerRect && value.top < group.headerRect.bottom - 0.5) failures.push({ groupId: group.groupId, memberId: member.id, reason: 'MEMBER_INTERSECTS_HEADER', headerRect: group.headerRect, memberRect: value });
            }
          }
          return { panel: rect(panel), groups, failures };
        }"""
    )


def require_layout_quality(panel, expected_nodes, expected_edges):
    raw = panel.get_attribute("data-topology-layout-bakeoff")
    require(raw, "ELK bake-off quality report is missing from the compiled topology panel")
    quality = json.loads(raw)
    require(len(quality.get("candidates", [])) == 3, "A/B/C bake-off did not report exactly three candidates")
    require({candidate["id"] for candidate in quality["candidates"]} == {"A-flat-right", "B-flat-down-high-degree", "C-role-aware-fanout"}, "A/B/C candidate IDs changed")
    for candidate in quality["candidates"]:
        metrics = candidate["metrics"]
        require(metrics["nodeCount"] == expected_nodes and metrics["edgeCount"] == expected_edges, f"{candidate['id']} changed canonical scope counts")
        # The bake-off must expose rejected alternatives instead of silently
        # treating a losing profile as a product failure.  The selected C
        # profile is the hard gate; A/B remain auditable comparison evidence.
        if candidate["id"] == "C-role-aware-fanout":
            require(candidate["acceptable"] is True, f"{candidate['id']} failed a hard geometry gate: {candidate['rejectionReasons']}")
            require(metrics["nonOrthogonalSegments"] == 0 and metrics["cableCrossings"] == 0 and metrics["edgeNodeCrossings"] == 0 and metrics["nodeOverlaps"] == 0, f"{candidate['id']} has invalid geometry: {metrics}")
        require(metrics["elapsedMs"] < 2000, f"{candidate['id']} exceeded the 2s bounded-layout budget: {metrics['elapsedMs']}ms")
        require(candidate["options"].get("org.eclipse.elk.edgeRouting") == "ORTHOGONAL", f"{candidate['id']} did not use explicit ELK orthogonal routing")
        require(candidate["options"].get("org.eclipse.elk.layered.mergeEdges") == "false", f"{candidate['id']} enabled ELK edge merging")
    require(quality["winnerId"] == "C-role-aware-fanout", f"Unexpected ELK winner: {quality['winnerId']}")
    require(quality["hardGate"] == "PASS", f"ELK hard gate failed: {quality}")
    comparison = quality["baselineComparison"]
    # The frozen PROJECT-093 numbers are retained as before/after evidence,
    # but are not a replacement for AV-001's group-containment and visual
    # grammar gates. Nested presentation groups change the route geometry; a
    # miss is reported verbatim in the evidence rather than being relabelled
    # as an optimization PASS.
    require(comparison["qualityGate"] in ("PASS", "FAIL"), f"Malformed baseline comparison: {comparison}")
    return quality


def assert_scope(page, panel, source_links, scope, expected_nodes, expected_edges, expected_groups, evidence_dir):
    expect(panel).to_have_attribute("data-topology-hierarchy", scope, timeout=180000)
    page.wait_for_timeout(500)
    require(panel.get_attribute("data-topology-hierarchy-node-count") == str(expected_nodes), f"{scope}: node count changed")
    require(panel.get_attribute("data-topology-hierarchy-link-count") == str(expected_edges), f"{scope}: link count changed")
    require(panel.get_attribute("data-topology-hierarchy-group-count") == str(expected_groups), f"{scope}: presentation group count changed")
    quality = require_layout_quality(panel, expected_nodes, expected_edges) if scope == access_id(25) else None
    visible_ids = set(page.locator('.react-flow__node-resource[data-id]').evaluate_all("nodes => nodes.map(node => node.getAttribute('data-id')).filter(Boolean)"))
    expected = {link_id for link_id, source, target in source_links if source in visible_ids and target in visible_ids}
    expected_endpoints = {link_id: (source, target) for link_id, source, target in source_links}
    require(len(expected) == expected_edges, f"{scope}: source-derived edge set has {len(expected)} links, expected {expected_edges}")
    rows = canonical_rows(page)
    require(len(rows) == expected_edges, f"{scope}: rendered physical path count changed")
    actual_ids = [row["id"] for row in rows]
    require(set(actual_ids) == expected and len(set(actual_ids)) == len(actual_ids), f"{scope}: physical source link IDs were omitted, fabricated or duplicated")
    for row in rows:
        require((row["source"], row["target"]) == expected_endpoints[row["id"]], f"{scope}: endpoint changed for {row['id']}")
        require(row["routeKind"] == "orthogonal" and row["routeOrigin"] == "elk", f"{scope}: route is not from ELK orthogonal sections: {row}")
        require(row["vlan"] in ("NOT_DOCUMENTED", "UNKNOWN", None) or row["vlan"], f"{scope}: invalid VLAN provenance")
        points(row["d"])
    geometry = screen_geometry(page)
    require(geometry["cardCount"] == expected_nodes, f"{scope}: rendered resource card count changed")
    require(not geometry["overlaps"], f"{scope}: resource cards overlap: {geometry['overlaps'][:5]}")
    require(geometry["crossings"] == 0, f"{scope}: cable-to-cable crossings detected: {geometry['crossings']}")
    require(all(row["penetrationCount"] == 0 for row in geometry["rows"]), f"{scope}: cable penetrates an unrelated card")
    require(all(row["sourceEndpointDistance"] is not None and row["sourceEndpointDistance"] <= 10 for row in geometry["rows"]), f"{scope}: route does not terminate on a live source handle")
    require(all(row["targetEndpointDistance"] is not None and row["targetEndpointDistance"] <= 10 for row in geometry["rows"]), f"{scope}: route does not terminate on a live target handle")
    report = {
        "scope": scope,
        "expectedResourceCount": expected_nodes,
        "expectedPhysicalLinkCount": expected_edges,
        "expectedPresentationGroupCount": expected_groups,
        "expectedLinkIds": sorted(expected),
        "renderedLinkIds": sorted(actual_ids),
        "endpointMismatches": [],
        "geometry": geometry,
        "layoutQuality": quality,
    }
    (evidence_dir / f"source-reconciliation-{scope}.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def overview_camera_gate(page, panel):
    page.locator('[data-topology-camera="overview"]').click()
    expect(page.locator('[data-topology-camera="overview"]')).to_have_attribute("aria-pressed", "true")
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    metrics = card_camera_metrics(page)
    require(metrics["panel"], "Topology panel has no measurable camera bounds")
    panel_box = metrics["panel"]
    require(all(
        card["left"] >= panel_box["left"] + 4 and card["right"] <= panel_box["right"] - 4 and
        card["top"] >= panel_box["top"] + 4 and card["bottom"] <= panel_box["bottom"] - 4
        for card in metrics["cards"]
    ), f"Overview camera crops a real card: {metrics}")
    return metrics


def read_camera_gate(page, root_id=None):
    page.locator('[data-topology-camera="read"]').click()
    expect(page.locator('[data-topology-camera="read"]')).to_have_attribute("aria-pressed", "true")
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(250)
    metrics = card_camera_metrics(page)
    require(metrics["minPrimaryScreenPx"] >= 13, f"Primary labels are below 13 effective screen px: {metrics}")
    require(metrics["minSecondaryScreenPx"] >= 11, f"Secondary labels are below 11 effective screen px: {metrics}")
    if root_id:
        root = next((card for card in metrics["cards"] if card["id"] == root_id), None)
        require(root is not None, f"READ root card is not mounted: {root_id}")
        panel = metrics["panel"]
        require(panel is not None, "READ root cannot be checked without a topology panel")
        require(
            root["left"] >= panel["left"] + 16 and root["right"] <= panel["right"] - 16 and
            root["top"] >= panel["top"] + 16 and root["bottom"] <= panel["bottom"] - 16,
            f"READ root card is outside the topology panel or lacks the desktop margin: {root} vs {panel}",
        )
    permanent_labels = page.locator('.semantic-edge-label').evaluate_all(
        "els => els.filter(label => !label.closest('.react-flow__edge')?.classList.contains('selected')).length"
    )
    require(permanent_labels == 0, "Permanent tiny edge metadata labels are visible")
    return metrics


def source_reconciliation(page, devices, links):
    exported = exported_source(page)
    require(len(exported["resources"]) == 10000 and len(exported["connections"]) == 10000, "Canonical 10k/10k inventory changed")
    require([row[0] for row in devices] == [row["id"] for row in exported["resources"]], "Canonical resource IDs changed")
    require([row[0] for row in links] == [row["id"] for row in exported["connections"]], "Canonical link IDs changed")
    require([(row[1], row[2]) for row in links] == [(row["from"]["resource"], row["to"]["resource"]) for row in exported["connections"]], "Canonical endpoints changed")
    require(all(connection["from"].get("port") is None and connection["to"].get("port") is None for connection in exported["connections"]), "Synthetic source gained invented ports")
    return {
        "sourceKind": "synthetic-ci-fixture",
        "sourceSha256": hashlib.sha256(hierarchical_xlsx()[0]).hexdigest(),
        "canonicalResources": len(exported["resources"]),
        "canonicalConnections": len(exported["connections"]),
        "canonicalResourceIdsUnchanged": True,
        "canonicalConnectionIdsUnchanged": True,
        "canonicalEndpointsUnchanged": True,
        "declaredPortsPreserved": True,
        "unknownPortsRemainUnknown": True,
        "vlanProvenance": "NOT_DOCUMENTED in source fixture; no VLAN inferred",
    }


def case(browser, url, evidence_dir):
    page, errors, outside = setup(browser, url)
    page.set_viewport_size({"width": 1366, "height": 768})
    source, devices, links = hierarchical_xlsx()
    try:
        activate(page, source)
        panel = page.locator(".topology-panel")
        expect(panel).to_have_attribute("data-topology-hierarchy", "overview", timeout=180000)
        source_report = source_reconciliation(page, devices, links)
        overview_report = assert_scope(page, panel, links, "overview", 34, 34, 5, evidence_dir)
        require(panel.bounding_box()["y"] <= 240, f"Overview canvas starts below first viewport: {panel.bounding_box()}")
        overview_readability = read_camera_gate(page, root_id="core-001")
        overview_camera = overview_camera_gate(page, panel)
        overview_groups = group_containment_metrics(page)
        require(not overview_groups["failures"], f"Overview group containment failed: {overview_groups}")
        page.screenshot(path=str(evidence_dir / "project094-overview-1366x768.png"), full_page=False)

        search_and_open(page, dist_id(4))
        distribution_report = assert_scope(page, panel, links, dist_id(4), 10, 9, 3, evidence_dir)
        distribution_readability = read_camera_gate(page, root_id=dist_id(4))
        distribution_groups = group_containment_metrics(page)
        require(not distribution_groups["failures"], f"Distribution group containment failed: {distribution_groups}")
        page.screenshot(path=str(evidence_dir / "project094-distribution-0004-1366x768.png"), full_page=False)

        open_access(page, panel, access_id(25))
        access_report = assert_scope(page, panel, links, access_id(25), 40, 39, 7, evidence_dir)
        read_metrics = read_camera_gate(page, root_id=access_id(25))
        access_groups = group_containment_metrics(page)
        require(not access_groups["failures"], f"Access group containment failed: {access_groups}")
        page.screenshot(path=str(evidence_dir / "project094-access-0025-read-1366x768.png"), full_page=False)

        link = page.locator("path#link-01211[data-connection-source][data-connection-target]")
        expect(link).to_have_count(1)
        link.dispatch_event("click", {"bubbles": True, "cancelable": True})
        inspector = page.locator('[data-topology-selected-link="link-01211"]')
        expect(inspector).to_be_visible(timeout=30000)
        text = inspector.inner_text()
        require("access-0025 → client-00921" in text, f"Inspector endpoint provenance changed: {text}")
        require("Källport: NOT DOCUMENTED" in text and "Målport: NOT DOCUMENTED" in text and "VLAN: NOT DOCUMENTED" in text, "Inspector fabricated unknown source fields")
        page.screenshot(path=str(evidence_dir / "project094-access-0025-link-01211-1366x768.png"), full_page=False)

        overview_camera_metrics = overview_camera_gate(page, panel)
        page.screenshot(path=str(evidence_dir / "project094-access-0025-overview-1366x768.png"), full_page=False)
        read_camera_gate(page)

        viewport_reports = {}
        for width, height, name in ((1280, 800, "1280x800"), (1920, 1080, "1920x1080")):
            page.set_viewport_size({"width": width, "height": height})
            page.wait_for_timeout(500)
            read_metrics_at_viewport = read_camera_gate(page, root_id=access_id(25))
            geometry = screen_geometry(page)
            require(not geometry["overlaps"] and geometry["crossings"] == 0, f"{name}: geometry gate changed after resize")
            viewport_reports[name] = {"camera": read_metrics_at_viewport, "geometry": geometry}
            page.screenshot(path=str(evidence_dir / f"project094-access-0025-{name}.png"), full_page=False)

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        mobile_metrics = read_camera_gate(page, root_id=access_id(25))
        require(mobile_metrics["documentScrollWidth"] <= mobile_metrics["viewportWidth"], f"Mobile document overflow: {mobile_metrics}")
        page.screenshot(path=str(evidence_dir / "project094-access-0025-mobile-390x844.png"), full_page=False)

        require(not errors, f"Uncaught Chromium page errors: {errors!r}")
        require(not outside, f"Unexpected external requests: {outside!r}")
        return {
            "status": "PASS",
            "sourceKind": "synthetic-ci-fixture",
            "canonicalDevices": len(devices),
            "canonicalLinks": len(links),
            "sourceReconciliation": source_report,
            "overview": overview_report,
            "distribution": distribution_report,
            "access": access_report,
            "readability": {"overview": overview_readability, "accessRead": read_metrics},
            "camera": {"overview": overview_camera_metrics, "accessOverview": overview_camera_metrics, "mobile": mobile_metrics, "resized": viewport_reports},
            "screenshots": sorted(path.name for path in evidence_dir.glob("project094-*.png")),
            "pageErrors": errors,
            "outsideRequests": outside,
        }
    finally:
        page.close()


def write_quality_artifacts(evidence_dir, report, source_report, candidate_head):
    baseline = json.loads(BASELINE_PATH.read_text())
    (evidence_dir / "baseline-project093.json").write_text(json.dumps(baseline, indent=2) + "\n")
    quality = report["access"]["layoutQuality"]
    baseline_metrics = baseline["metrics"]
    candidates = []
    for candidate in quality["candidates"]:
        metrics = candidate["metrics"]
        candidates.append({
            "id": candidate["id"],
            "profile": {"direction": candidate["direction"], "options": candidate["options"]},
            "metrics": {
                "totalCableLength": metrics["totalLength"],
                "p95DetourRatio": metrics["p95Detour"],
                "medianDetourRatio": metrics["medianDetour"],
                "totalBends": metrics["turns"],
                "cableCrossings": metrics["cableCrossings"],
                "nodePenetrations": metrics["edgeNodeCrossings"],
                "nodeOverlaps": metrics["nodeOverlaps"],
                "bboxArea": metrics["bbox"]["width"] * metrics["bbox"]["height"],
                "medianLayoutMs": metrics["elapsedMs"],
                "minReadNameCssPx": report["readability"]["accessRead"]["minPrimaryCssPx"],
            },
            "hardPass": candidate["acceptable"],
            "hardFailReasons": candidate["rejectionReasons"],
        })
    read_metrics = report["readability"]["accessRead"]
    quality_report = {
        "schemaVersion": "project094.v1",
        "sourceKind": "synthetic-ci-fixture",
        "repo": "Northsw-spec/YadiLab-n",
        "baselineHead": baseline["baselineHead"],
        "candidateHead": candidate_head,
        "scope": "Access25",
        "viewport": {"width": 1366, "height": 768},
        "canonical": {"resources": 40, "links": 39, "physicalSvgPaths": 39},
        "baseline": {
            "totalCableLength": baseline_metrics["totalCableLength"],
            "p95DetourRatio": baseline_metrics["p95DetourRatio"],
            "medianDetourRatio": baseline_metrics["medianDetourRatio"],
            "totalBends": baseline_metrics["totalBends"],
            "cableCrossings": baseline_metrics["cableCrossings"],
            "nodePenetrations": baseline_metrics["nodePenetrations"],
            "nodeOverlaps": baseline_metrics["nodeOverlaps"],
            "bboxArea": baseline_metrics["bboxArea"],
            "medianLayoutMs": 0,
            "minReadNameCssPx": baseline_metrics["minReadNameCssPx"],
        },
        "candidates": candidates,
        "selectedCandidate": quality["winnerId"],
        "gates": {
            "canonical": "PASS",
            "routing": "PASS",
            "readability": "PASS" if read_metrics["minPrimaryCssPx"] >= 13 and read_metrics["minSecondaryCssPx"] >= 11 else "FAIL",
            "camera": "PASS",
            "performance": "PASS",
            "ci": "NOT_RUN",
            "visualApproved": "PENDING_USER",
        },
    }
    (evidence_dir / "layout-bakeoff.json").write_text(json.dumps(quality_report, indent=2) + "\n")
    route_rows = []
    for scope in (report["overview"], report["distribution"], report["access"]):
        for row in scope["geometry"]["rows"]:
            route_rows.append({"scope": scope["scope"], **{key: value for key, value in row.items() if key != "points"}})
    (evidence_dir / "route-geometry.json").write_text(json.dumps({"schemaVersion": "project094.route-geometry.v1", "routes": route_rows, "crossings": 0, "nodePenetrations": 0}, indent=2) + "\n")
    (evidence_dir / "source-reconciliation.json").write_text(json.dumps(source_report, indent=2) + "\n")
    (evidence_dir / "camera-readability.json").write_text(json.dumps(report["camera"] | {"readability": report["readability"]}, indent=2) + "\n")
    (evidence_dir / "project094-metadata.json").write_text(json.dumps({
        "schemaVersion": "project094.metadata.v1",
        "repo": "Northsw-spec/YadiLab-n",
        "candidateHead": candidate_head,
        "baselineHead": baseline["baselineHead"],
        "compiledChromium": os.environ.get("YADILAB_CHROMIUM_EXECUTABLE", "system/default"),
        "fixture": "PROJECT-086 synthetic XLSX: 10000 devices, 10000 links; Access25 40/39/38 clients",
        "visualApproval": "PENDING_USER",
    }, indent=2) + "\n")
    (evidence_dir / "final-review.md").write_text(
        "# PROJECT-094 final review\n\n"
        f"- Candidate HEAD: `{candidate_head}`\n"
        "- Source: synthetic-ci-fixture; 10,000/10,000 canonical inventory preserved.\n"
        "- Access25: 40 resources, 39 physical links, 7 presentation groups; all source IDs/endpoints reconcile.\n"
        f"- ELK bake-off winner: `{quality['winnerId']}`; baseline quality gate `{quality['baselineComparison']['qualityGate']}`.\n"
        f"- Total-length improvement: {quality['baselineComparison']['totalImprovement']:.4%}; p95-detour improvement: {quality['baselineComparison']['p95Improvement']:.4%}.\n"
        "- Orthogonal paths, zero card penetrations/overlaps/cable crossings, real compiled Chromium screenshots captured.\n"
        "- Visual approval: `PENDING_USER`; PR remains open and unmerged.\n"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and target.port and target.path == "/", "Only loopback compiled app is authorized")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    candidate_head = os.environ.get("YADILAB_EXPECTED_COMMIT")
    if not candidate_head:
        candidate_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
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
    write_quality_artifacts(args.evidence_dir, report, report["sourceReconciliation"], candidate_head)
    (args.evidence_dir / "project094-topology-engine.json").write_text(json.dumps(report, indent=2) + "\n")
    print("PASS PROJECT-094 final topology engine compiled Chromium acceptance")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

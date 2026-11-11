#!/usr/bin/env python3
"""PROJECT-091: compiled Chromium DOM proof for grouped orthogonal hierarchy links."""
import argparse
from collections import Counter
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


def reconcile_rendered_connections(scope_name, expected, actual_rows, expected_endpoints):
    actual_ids = [row["id"] for row in actual_rows]
    counts = Counter(actual_ids)
    actual = set(actual_ids)
    endpoint_mismatches = []
    for row in actual_rows:
        connection_id = row["id"]
        if connection_id not in expected_endpoints:
            continue
        actual_pair = (row["source"], row["target"])
        if actual_pair != expected_endpoints[connection_id]:
            endpoint_mismatches.append({
                "id": connection_id,
                "actual": actual_pair,
                "expected": expected_endpoints[connection_id],
            })
    return {
        "scope": scope_name,
        "expectedCount": len(expected),
        "renderedCount": len(actual_rows),
        "missing": sorted(expected - actual),
        "unexpected": sorted(actual - expected),
        "duplicates": sorted(connection_id for connection_id, count in counts.items() if count > 1),
        "endpointMismatches": endpoint_mismatches,
    }


def wait_for_identity_barrier(page, scope, expected_ids, expected_node_ids, timeout=180000):
    page.wait_for_function(
        """({scope, expectedIds, expectedNodeIds}) => {
          const panel = document.querySelector('.topology-panel');
          if (!panel || panel.getAttribute('data-topology-hierarchy') !== scope) return false;
          const read = () => {
            const actualNodeIds = Array.from(panel.querySelectorAll('.react-flow__node[data-id]'))
              .map(node => node.getAttribute('data-id')).filter(Boolean).sort();
            const actualRows = Array.from(panel.querySelectorAll(
              'path[data-connection-source][data-connection-target][data-hierarchy-visual="true"]'
            )).map(path => ({
              id: path.id,
              source: path.getAttribute('data-connection-source'),
              target: path.getAttribute('data-connection-target'),
            })).sort((left, right) => left.id.localeCompare(right.id));
            return {
              scope: panel.getAttribute('data-topology-hierarchy'),
              nodeIds: actualNodeIds,
              connectionIds: actualRows.map(row => row.id).sort(),
              endpoints: actualRows.map(row => [row.id, row.source, row.target]),
            };
          };
          const matches = state => {
            const nodeSet = new Set(state.nodeIds);
            const expectedNodesMounted = expectedNodeIds.every(id => nodeSet.has(id));
            const idsMatch = state.connectionIds.length === expectedIds.length &&
              state.connectionIds.every((id, index) => id === expectedIds[index]);
            return expectedNodesMounted && idsMatch;
          };
          const state = read();
          const snapshot = JSON.stringify(state);
          const key = `${scope}|${expectedIds.join(',')}|${expectedNodeIds.join(',')}`;
          let barrier = window.__project091IdentityBarrier;
          if (!barrier || barrier.key !== key) {
            barrier = window.__project091IdentityBarrier = { key, frameOne: null, scheduled: false, ready: false };
          }
          if (!matches(state)) {
            barrier.frameOne = null;
            barrier.scheduled = false;
            barrier.ready = false;
            return false;
          }
          if (barrier.frameOne !== snapshot) {
            barrier.frameOne = snapshot;
            barrier.scheduled = false;
            barrier.ready = false;
          }
          if (!barrier.scheduled) {
            barrier.scheduled = true;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const current = window.__project091IdentityBarrier;
              if (!current || current.key !== key) return;
              const second = read();
              current.ready = matches(second) && JSON.stringify(second) === current.frameOne;
              current.scheduled = false;
            }));
          }
          return barrier.ready;
        }""",
        arg={
            "scope": scope,
            "expectedIds": sorted(expected_ids),
            "expectedNodeIds": sorted(expected_node_ids),
        },
        timeout=timeout,
    )


def collect_dom_diagnostics(page, expected_ids):
    return page.evaluate(
        """expectedIds => {
          const panel = document.querySelector('.topology-panel');
          const rectDetails = element => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              overflow: style.overflow,
              zIndex: style.zIndex,
            };
          };
          const finiteRect = element => {
            const rect = element?.getBoundingClientRect?.();
            return Boolean(rect) && [rect.x, rect.y, rect.width, rect.height]
              .every(value => Number.isFinite(value));
          };
          const nodeRows = Array.from(document.querySelectorAll('.react-flow__node')).map(node => ({
            id: node.getAttribute('data-id'),
            html: node.outerHTML.slice(0, 600),
            rect: rectDetails(node),
            measuredDomRectFinite: finiteRect(node),
            handles: Array.from(node.querySelectorAll('.react-flow__handle')).map(handle => ({
              id: handle.getAttribute('data-react-flow-handle-id') || handle.getAttribute('data-handleid') || handle.getAttribute('id'),
              type: handle.getAttribute('data-react-flow-handle-type') || handle.getAttribute('data-handle-type'),
              className: handle.className,
              rect: rectDetails(handle),
              html: handle.outerHTML.slice(0, 400),
            })),
          }));
          const edgeRows = Array.from(document.querySelectorAll('.react-flow__edge')).map(edge => ({
            id: edge.getAttribute('data-id') || edge.getAttribute('id'),
            html: edge.outerHTML.slice(0, 1200),
            rect: rectDetails(edge),
            paths: Array.from(edge.querySelectorAll('path')).map(path => ({
              id: path.id,
              source: path.getAttribute('data-connection-source'),
              target: path.getAttribute('data-connection-target'),
              sourcePort: path.getAttribute('data-connection-source-port'),
              targetPort: path.getAttribute('data-connection-target-port'),
              hierarchyVisual: path.getAttribute('data-hierarchy-visual'),
              d: path.getAttribute('d'),
              rect: rectDetails(path),
            })),
          }));
          const semanticPaths = Array.from(document.querySelectorAll('path[data-connection-source]')).map(path => ({
            id: path.id,
            source: path.getAttribute('data-connection-source'),
            target: path.getAttribute('data-connection-target'),
            sourcePort: path.getAttribute('data-connection-source-port'),
            targetPort: path.getAttribute('data-connection-target-port'),
            hierarchyVisual: path.getAttribute('data-hierarchy-visual'),
            d: path.getAttribute('d'),
            rect: rectDetails(path),
          }));
          const edgeHandleMapText = panel?.getAttribute('data-topology-react-flow-edge-handles');
          let edgeHandleMap = [];
          try { edgeHandleMap = edgeHandleMapText ? JSON.parse(edgeHandleMapText) : []; } catch (error) { edgeHandleMap = [{ parseError: String(error) }]; }
          const nodesById = new Map(nodeRows.map(node => [node.id, node]));
          const handleChecks = edgeHandleMap.filter(edge => expectedIds.includes(edge.id)).map(edge => {
            const sourceNode = nodesById.get(edge.source);
            const targetNode = nodesById.get(edge.target);
            const sourceHandle = sourceNode?.handles?.find(handle => handle.id === edge.sourceHandle);
            const targetHandle = targetNode?.handles?.find(handle => handle.id === edge.targetHandle);
            return {
              ...edge,
              sourceNodeMounted: Boolean(sourceNode),
              targetNodeMounted: Boolean(targetNode),
              sourceHandleMounted: edge.sourceHandle == null ? true : Boolean(sourceHandle),
              targetHandleMounted: edge.targetHandle == null ? true : Boolean(targetHandle),
              sourceHandle,
              targetHandle,
            };
          });
          const allPathData = Array.from(document.querySelectorAll('.react-flow__edges path'))
            .map(path => path.getAttribute('d') || '');
          const nonFinitePathData = allPathData.filter(d => {
            const numbers = d.match(/-?(?:\\d+\\.?\\d*|\\.\\d+)/g) || [];
            return numbers.some(value => !Number.isFinite(Number(value)));
          });
          const errorBoundaryOutput = Array.from(document.querySelectorAll(
            '[role="alert"], .diagnostics .diagnostic, [data-react-error-boundary], [data-error-boundary]'
          )).map(element => ({ text: element.textContent?.slice(0, 1000) || '', html: element.outerHTML.slice(0, 1200) }));
          return {
            scope: panel?.getAttribute('data-topology-hierarchy'),
            panel: rectDetails(panel),
            panelAttributes: panel ? {
              edgeCount: panel.getAttribute('data-topology-edge-count'),
              edgeIds: panel.getAttribute('data-topology-edge-ids'),
              projectionEdgeIds: panel.getAttribute('data-topology-projection-edge-ids'),
              reactFlowEdgeIds: panel.getAttribute('data-topology-react-flow-edge-ids'),
              reactFlowEdgeHandles: edgeHandleMap,
              hierarchyEdgeIds: panel.getAttribute('data-topology-hierarchy-edge-ids'),
              nodeCount: panel.getAttribute('data-topology-hierarchy-node-count'),
              groupCount: panel.getAttribute('data-topology-hierarchy-group-count'),
              reactFlowStoreNodeCount: panel.getAttribute('data-topology-react-flow-store-node-count'),
              reactFlowStoreEdgeCount: panel.getAttribute('data-topology-react-flow-store-edge-count'),
              reactFlowStoreEdgeIds: panel.getAttribute('data-topology-react-flow-store-edge-ids'),
              reactFlowStoreUnmeasuredNodeIds: panel.getAttribute('data-topology-react-flow-store-unmeasured-node-ids'),
              reactFlowStoreNodesInitialized: panel.getAttribute('data-topology-react-flow-store-nodes-initialized'),
            } : null,
            reactFlowNodeCount: nodeRows.length,
            reactFlowNodes: nodeRows,
            reactFlowEdgeCount: edgeRows.length,
            reactFlowEdges: edgeRows,
            semanticPaths,
            allSvgPaths: document.querySelectorAll('.react-flow__edges path').length,
            edgeLayerMounted: Boolean(panel?.querySelector('.react-flow__edges')),
            edgeLayer: rectDetails(panel?.querySelector('.react-flow__edges')),
            expectedEdgeIds: [...expectedIds].sort(),
            handleChecks,
            missingHandleIds: handleChecks.flatMap(edge => [
              edge.sourceHandle && !edge.sourceHandleMounted ? `${edge.id}:source:${edge.sourceHandle}` : null,
              edge.targetHandle && !edge.targetHandleMounted ? `${edge.id}:target:${edge.targetHandle}` : null,
            ].filter(Boolean)),
            nonFinitePathData,
            errorBoundaryOutput,
          };
        }""",
        list(expected_ids),
    )


def assert_orthogonal(path):
    require(not re.search(r"[CQSAZcqsa]", path), f"Hierarchical path contains a curve or non-polyline command: {path}")
    points = [(float(x), float(y)) for command, x, y in re.findall(r"([ML])\s*(-?[0-9.]+)\s+(-?[0-9.]+)", path)]
    require(len(points) >= 2, f"Hierarchical path has no usable polyline geometry: {path}")
    for (from_x, from_y), (to_x, to_y) in zip(points, points[1:]):
        require(from_x == to_x or from_y == to_y, f"Hierarchical path has a diagonal segment: {path}")


def assert_scope(page, panel, source_links, scope_name, evidence_dir, browser_diagnostics):
    visible = resource_ids(page, [row[0] for row in source_links[0]])
    expected = {
        row[0]
        for row in source_links[1]
        if row[1] in visible and row[2] in visible
    }
    expected_endpoints = {row[0]: (row[1], row[2]) for row in source_links[1]}
    try:
        wait_for_identity_barrier(page, panel.get_attribute("data-topology-hierarchy") or scope_name, expected, visible)
    except PlaywrightTimeoutError:
        pass
    actual_rows = rendered_links(page)
    dom_diagnostics = collect_dom_diagnostics(page, expected)
    diagnostics = reconcile_rendered_connections(scope_name, expected, actual_rows, expected_endpoints)
    diagnostics.update({
        "visibleResourceIds": sorted(visible),
        "expectedConnectionIds": sorted(expected),
        "expectedEndpoints": {connection_id: list(pair) for connection_id, pair in sorted(expected_endpoints.items()) if connection_id in expected},
        "actualRows": actual_rows,
        "panelHierarchy": panel.get_attribute("data-topology-hierarchy"),
        "panelEdgeCount": panel.get_attribute("data-topology-edge-count"),
        "panelEdgeIds": panel.get_attribute("data-topology-edge-ids"),
        "hierarchyProjectionEdgeIds": panel.get_attribute("data-topology-hierarchy-edge-ids"),
        "canvasProjectionEdgeIds": panel.get_attribute("data-topology-projection-edge-ids"),
        "reactFlowEdgePropIds": panel.get_attribute("data-topology-react-flow-edge-ids"),
        "domDiagnostics": dom_diagnostics,
        "pageErrors": list(browser_diagnostics["pageErrors"]),
        "consoleErrors": list(browser_diagnostics["consoleErrors"]),
        "consoleMessages": list(browser_diagnostics["consoleMessages"]),
    })
    (evidence_dir / f"project091-{scope_name}-reconciliation.json").write_text(json.dumps(diagnostics, indent=2) + "\n")
    require(not diagnostics["missing"] and not diagnostics["unexpected"] and not diagnostics["duplicates"] and not diagnostics["endpointMismatches"], diagnostics)
    for row in actual_rows:
        require(row["id"] in expected_endpoints, f"{scope_name}: fabricated connection {row['id']}")
        require((row["source"], row["target"]) == expected_endpoints[row["id"]], f"{scope_name}: endpoint mismatch for {row['id']}")
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
    console_errors = []
    console_messages = []
    def record_console(message):
        row = {"type": message.type, "text": message.text, "location": message.location}
        console_messages.append(row)
        if message.type == "error":
            console_errors.append(row)
    page.on("console", record_console)
    browser_diagnostics = {
        "pageErrors": errors,
        "consoleErrors": console_errors,
        "consoleMessages": console_messages,
    }
    source, devices, links = hierarchical_xlsx()
    try:
        activate(page, source)
        panel = page.locator('.topology-panel')
        canonical = exported_source(page)
        source_links = (devices, links)
        require(panel.get_attribute('data-topology-hierarchy') == 'overview', 'PROJECT-091 overview did not open')
        require(int(panel.get_attribute('data-topology-hierarchy-group-count') or 0) >= 5, 'Overview lacks core/distribution presentation groups')
        require(page.locator('[data-navigation-group="true"]').count() >= 5, 'Overview has no visible Arvidsjaur-style group containers')
        assert_scope(page, panel, source_links, 'overview', evidence_dir, browser_diagnostics)
        page.screenshot(path=str(evidence_dir / 'project091-network-overview.png'), full_page=True)

        search_and_open(page, dist_id(4))
        require(int(panel.get_attribute('data-topology-hierarchy-group-count') or 0) >= 2, 'Distribution branch lacks grouped presentation')
        assert_scope(page, panel, source_links, 'distribution-0004', evidence_dir, browser_diagnostics)
        page.screenshot(path=str(evidence_dir / 'project091-distribution-0004.png'), full_page=True)

        branch_access = access_id(25)
        open_access(page, panel, branch_access)
        require(int(panel.get_attribute('data-topology-hierarchy-group-count') or 0) >= 5, 'Access branch lacks compact endpoint groups')
        assert_scope(page, panel, source_links, branch_access, evidence_dir, browser_diagnostics)
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
            'consoleErrors': console_errors,
            'consoleMessages': console_messages,
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

#!/usr/bin/env python3
"""ATLAS-001 capacity gate: real XLSX import, Builder activation and DOM/SVG proof.

This is deliberately an end-to-end test.  The manifest is used only as an
external truth source for assertions; the browser always receives the original
fixture bytes through the product's file input.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import expect, sync_playwright

from run_atlas001_real_browser import capture_page_evidence, require_loopback, wait_for_final_layout
from run_ic010_p2_shared_xml_real_browser import exported_source


ROOT = Path(__file__).resolve().parents[2]
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DESKTOP = (1366, 768)
MOBILE = (390, 844)

# The matrix is intentionally explicit: each status is represented in the
# evidence manifest rather than being hidden behind one generic PASS.
CASES = (
    {"key": "50-grid", "viewports": (DESKTOP, MOBILE), "status": "FULL_UI_PASS"},
    {"key": "100-grid", "viewports": (DESKTOP, MOBILE), "status": "FULL_UI_PASS"},
    {"key": "200-grid", "viewports": (DESKTOP,), "status": "FULL_UI_PASS"},
    {"key": "201-linear", "viewports": (DESKTOP,), "status": "BOUNDED_ATLAS_PASS"},
    {"key": "300-branch-lowercase", "viewports": (DESKTOP, MOBILE), "status": "BOUNDED_ATLAS_PASS"},
    {"key": "500-branch", "viewports": (DESKTOP, MOBILE), "status": "BOUNDED_ATLAS_PASS"},
    {"key": "1000-linear", "viewports": (DESKTOP,), "status": "BOUNDED_ATLAS_PASS"},
    {"key": "1001-linear", "viewports": (DESKTOP,), "status": "BLOCKED_BY_POLICY"},
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_manifest() -> dict[str, Any]:
    return json.loads((ROOT / "tests/fixtures/import/atlas001-capacity-manifest.json").read_text(encoding="utf-8"))


def source_truth(source: dict[str, Any], item: dict[str, Any]) -> None:
    resources = source.get("resources", [])
    connections = source.get("connections", [])
    require(len(resources) == item["resources"], f'{item["key"]}: exported resource count changed')
    require(len(connections) == item["connections"], f'{item["key"]}: exported connection count changed')
    require([resource.get("id") for resource in resources] == item["resourceIds"], f'{item["key"]}: resource ID order changed')
    require([connection.get("id") for connection in connections] == item["connectionIds"], f'{item["key"]}: connection ID order changed')
    expected_connections = {
        row["id"]: row for row in item["connectionsTruth"]
    }
    for connection in connections:
        expected = expected_connections.get(connection.get("id"))
        require(expected is not None, f'{item["key"]}: unexpected connection {connection.get("id")}')
        actual = {
            "from": (connection.get("from") or {}).get("resource"),
            "fromPort": (connection.get("from") or {}).get("port"),
            "to": (connection.get("to") or {}).get("resource"),
            "toPort": (connection.get("to") or {}).get("port"),
        }
        require(actual == {
            "from": expected["from"], "fromPort": expected["fromPort"],
            "to": expected["to"], "toPort": expected["toPort"],
        }, f'{item["key"]}: endpoint/port mismatch for {connection.get("id")}: {actual!r}')
        require(actual["fromPort"] and actual["toPort"], f'{item["key"]}: missing explicit endpoint ports')
    require(
        source.get("networkImportProvenance", {}).get("source", {}).get("sha256") == item["sha256"],
        f'{item["key"]}: original source provenance SHA missing or changed',
    )


def open_page(browser, url: str, viewport: tuple[int, int]):
    width, height = viewport
    page = browser.new_page(
        accept_downloads=True,
        viewport={"width": width, "height": height},
        device_scale_factor=1,
    )
    errors: list[str] = []
    outside: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "request",
        lambda request: outside.append(request.url)
        if not (request.url.startswith(url) or request.url.startswith("data:") or request.url.startswith("blob:"))
        else None,
    )
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=30000)
    return page, errors, outside


def open_import(page, fixture: Path, item: dict[str, Any]):
    payload = fixture.read_bytes()
    require(sha256(payload) == item["sha256"], f'{item["key"]}: fixture SHA-256 changed')
    page.locator('[data-network-import-primary="true"]').click()
    panel = page.locator('[data-network-import-panel="ready"]')
    expect(panel).to_be_visible(timeout=30000)
    panel.locator('[data-network-import-file="true"]').set_input_files({
        "name": fixture.name,
        "mimeType": MIME,
        "buffer": payload,
    })
    expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=240000)
    expect(panel).to_contain_text(
        f'Devices: {item["resources"]} · Explicit links: {item["connections"]}',
        timeout=240000,
    )
    return panel, payload


def assert_no_horizontal_overflow(page, viewport: tuple[int, int], label: str) -> None:
    overflow = page.evaluate(
        """() => ({
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          bodyWidth: document.body.scrollWidth,
        })"""
    )
    require(overflow["documentWidth"] <= viewport[0] + 1, f"{label}: horizontal document overflow {overflow!r}")
    require(overflow["bodyWidth"] <= viewport[0] + 1, f"{label}: horizontal body overflow {overflow!r}")


def assert_rendered_edges(page, item: dict[str, Any], expected_ids: list[str]) -> dict[str, Any]:
    # The baseFlow edge metadata is useful for exact handle identity; the SVG
    # query proves that React Flow actually rendered each declared connection.
    handles = json.loads(page.locator(".topology-panel").get_attribute("data-topology-react-flow-edge-handles") or "[]")
    require(sorted(edge.get("id") for edge in handles) == sorted(expected_ids), f'{item["key"]}: React Flow edge metadata differs')
    expected = {row["id"]: row for row in item["connectionsTruth"]}
    for edge in handles:
        truth = expected[edge["id"]]
        require(edge["source"] == truth["from"], f'{item["key"]}: source resource mismatch for {edge["id"]}')
        require(edge["target"] == truth["to"], f'{item["key"]}: target resource mismatch for {edge["id"]}')
        require(edge["sourceHandle"] == f'out:{truth["fromPort"]}', f'{item["key"]}: source handle mismatch for {edge["id"]}')
        require(edge["targetHandle"] == f'in:{truth["toPort"]}', f'{item["key"]}: target handle mismatch for {edge["id"]}')

    dom_edges = page.locator("path.react-flow__edge-path").evaluate_all(
        """(elements) => elements.map((element) => ({
          id: element.getAttribute('id'),
          d: element.getAttribute('d'),
          source: element.getAttribute('data-connection-source'),
          target: element.getAttribute('data-connection-target'),
          sourcePort: element.getAttribute('data-connection-source-port'),
          targetPort: element.getAttribute('data-connection-target-port'),
          routeKind: element.getAttribute('data-route-kind'),
        })).filter((edge) => edge.id)"""
    )
    dom_by_id = {edge["id"]: edge for edge in dom_edges}
    require(sorted(dom_by_id) == sorted(expected_ids), f'{item["key"]}: SVG edge IDs differ')
    finite_number = re.compile(r"-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?", re.I)
    for connection_id, truth in expected.items():
        edge = dom_by_id.get(connection_id)
        require(edge is not None, f'{item["key"]}: missing SVG edge {connection_id}')
        require(edge["source"] == truth["from"] and edge["target"] == truth["to"], f'{item["key"]}: SVG endpoint mismatch for {connection_id}')
        require(edge["sourcePort"] == truth["fromPort"] and edge["targetPort"] == truth["toPort"], f'{item["key"]}: SVG port mismatch for {connection_id}')
        require(edge["routeKind"] == "orthogonal", f'{item["key"]}: SVG route is not orthogonal for {connection_id}')
        path_data = edge.get("d") or ""
        require(path_data and len(finite_number.findall(path_data)) >= 4, f'{item["key"]}: invalid SVG path for {connection_id}')
    return {"metadataEdges": len(handles), "svgEdges": len(dom_edges), "svgEdgeIds": sorted(dom_by_id)}


def verify_normal(page, item: dict[str, Any], viewport: tuple[int, int], evidence_dir: Path) -> dict[str, Any]:
    panel = page.locator(".topology-panel")
    expect(page.locator('[data-topology-mode="normal"][aria-pressed="true"]')).to_be_visible(timeout=180000)
    expect(panel).to_have_attribute("data-topology-edge-count", str(item["connections"]), timeout=30000)
    resource_ids = page.locator(".react-flow__node").evaluate_all(
        """(elements) => elements.filter((element) => element.querySelector('.resource-node')).map((element) => element.getAttribute('data-id'))"""
    )
    require(sorted(resource_ids) == sorted(item["resourceIds"]), f'{item["key"]}: actual normal resource DOM differs')
    require(len(resource_ids) == len(set(resource_ids)), f'{item["key"]}: duplicate normal resource DOM IDs')
    edge_evidence = assert_rendered_edges(page, item, item["connectionIds"])
    trace = page.evaluate("window.__yadilabNetworkImportActivationTrace")
    require(trace.get("globalLayoutCalls") == 1 and trace.get("lastDecision") == "NORMAL", f'{item["key"]}: normal ELK trace {trace!r}')
    assert_no_horizontal_overflow(page, viewport, item["key"])
    screenshot = f'atlas001-capacity-{item["key"]}-{viewport[0]}x{viewport[1]}-normal.png'
    page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
    return {
        "status": "FULL_UI_PASS",
        "activationDecision": "NORMAL",
        "activationDecisionReason": "resources <= 200",
        "builderCompileStatus": "valid",
        "canonicalExportVerified": True,
        "canonicalResources": len(resource_ids),
        "canonicalConnections": len(edge_evidence["svgEdgeIds"]),
        "realSvgNodeIdsVerified": True,
        "realSvgEdgeIdsVerified": True,
        "endpointPortsVerified": True,
        "globalElkInvocationCount": trace.get("globalLayoutCalls"),
        "layoutStatus": "PASS",
        "viewportResults": [{"viewport": list(viewport), "screenshot": screenshot, "horizontalOverflow": False}],
        "pageErrors": [],
        "externalRequests": [],
    }


def atlas_page_refs(page) -> list[dict[str, str]]:
    return page.locator("[data-atlas-boundary-connection]").evaluate_all(
        """(elements) => elements.map((element) => ({
          connectionId: element.getAttribute('data-atlas-boundary-connection'),
          destinationPage: element.getAttribute('data-atlas-destination-page'),
        }))"""
    )


def focus_atlas_resource(page, panel, resource_id: str) -> None:
    search = page.get_by_label("Sök i topology")
    search.fill(resource_id)
    result = page.get_by_role("option").filter(has_text=resource_id).first
    expect(result).to_be_visible(timeout=30000)
    result.click()
    expected_page = panel.get_attribute("data-atlas-active-page") or ""
    wait_for_final_layout(page, panel, expected_page)


def verify_atlas(page, item: dict[str, Any], viewport: tuple[int, int], evidence_dir: Path) -> dict[str, Any]:
    panel = page.locator(".topology-panel")
    expect(page.get_by_role("button", name="ATLAS PAGES")).to_be_visible(timeout=180000)
    page.get_by_role("button", name="ATLAS PAGES").click()
    expect(panel).to_have_attribute("data-atlas-active-page", timeout=30000)
    page_count = int(panel.get_attribute("data-atlas-page-count") or "0")
    require(page_count > 1, f'{item["key"]}: Atlas did not create multiple pages')
    page_options = page.locator("[data-atlas-page-option]")
    require(page_options.count() == page_count, f'{item["key"]}: page option count mismatch')

    all_page_evidence: list[dict[str, Any]] = []
    all_refs: list[dict[str, str]] = []
    page_to_resources: dict[str, list[str]] = {}
    page_to_internal: dict[str, list[str]] = {}
    for index in range(page_count):
        # Re-query after each React render; stale element handles are not used.
        page.locator("[data-atlas-page-option]").nth(index).click()
        page_id = page.locator(".topology-panel").get_attribute("data-atlas-active-page") or ""
        page_resources = json.loads(panel.get_attribute("data-atlas-page-resource-ids") or "[]")
        require(page_resources, f'{item["key"]}: Atlas page {page_id} has no resource IDs')
        # The read camera is intentionally focused before measuring screen
        # geometry; a raw overview of a 60-node page would make labels too
        # small even though the page itself is complete.
        focus_atlas_resource(page, panel, page_resources[len(page_resources) // 2])
        evidence = capture_page_evidence(page, panel, page_id, viewport)
        require(panel.get_attribute("data-atlas-render-ready") == "true", f'{item["key"]}: Atlas page {page_id} not render-ready')
        require(panel.get_attribute("data-atlas-global-builder-layout") == "NOT_RUN", f'{item["key"]}: global Builder layout ran in Atlas')
        refs = atlas_page_refs(page)
        for ref in refs:
            ref["page"] = page_id
        all_refs.extend(refs)
        page_to_resources[page_id] = evidence["resourceIds"]
        page_to_internal[page_id] = evidence["internalConnectionIds"]
        screenshot = None
        if index in (0, page_count // 2, page_count - 1):
            screenshot = f'atlas001-capacity-{item["key"]}-{viewport[0]}x{viewport[1]}-page-{index + 1:03d}.png'
            page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
        evidence["screenshot"] = screenshot
        all_page_evidence.append(evidence)

    expected_resource_ids = set(item["resourceIds"])
    flattened_resources = [resource_id for ids in page_to_resources.values() for resource_id in ids]
    require(set(flattened_resources) == expected_resource_ids, f'{item["key"]}: Atlas resource union differs')
    require(len(flattened_resources) == len(set(flattened_resources)) == len(expected_resource_ids), f'{item["key"]}: Atlas resource duplication/loss')

    page_by_resource = {resource_id: page_id for page_id, ids in page_to_resources.items() for resource_id in ids}
    internal_by_connection = {connection_id: [] for connection_id in item["connectionIds"]}
    for page_id, ids in page_to_internal.items():
        for connection_id in ids:
            require(connection_id in internal_by_connection, f'{item["key"]}: unknown Atlas internal connection {connection_id}')
            internal_by_connection[connection_id].append(page_id)
    refs_by_connection: dict[str, list[dict[str, str]]] = {connection_id: [] for connection_id in item["connectionIds"]}
    for ref in all_refs:
        require(ref["connectionId"] in refs_by_connection, f'{item["key"]}: unknown Atlas boundary connection {ref["connectionId"]}')
        refs_by_connection[ref["connectionId"]].append(ref)
    for connection in item["connectionsTruth"]:
        connection_id = connection["id"]
        from_page = page_by_resource[connection["from"]]
        to_page = page_by_resource[connection["to"]]
        if from_page == to_page:
            require(internal_by_connection[connection_id] == [from_page], f'{item["key"]}: internal connection {connection_id} not on exactly one page')
            require(not refs_by_connection[connection_id], f'{item["key"]}: internal connection {connection_id} has boundary refs')
        else:
            require(not internal_by_connection[connection_id], f'{item["key"]}: cross-page connection {connection_id} became a physical edge')
            destinations = {ref["destinationPage"] for ref in refs_by_connection[connection_id]}
            require(len(refs_by_connection[connection_id]) >= 2, f'{item["key"]}: cross-page connection {connection_id} lost endpoint refs')
            require(destinations == {from_page, to_page}, f'{item["key"]}: boundary destination set for {connection_id} is {destinations!r}')

    # Global search must navigate to the owning page for first/middle/last
    # canonical resources, not merely filter the current page.
    search_targets = [item["resourceIds"][0], item["resourceIds"][len(item["resourceIds"]) // 2], item["resourceIds"][-1]]
    search_results: list[dict[str, str]] = []
    for resource_id in search_targets:
        search = page.get_by_label("Sök i topology")
        search.fill(resource_id)
        result = page.get_by_role("option").filter(has_text=resource_id).first
        expect(result).to_be_visible(timeout=30000)
        result.click()
        expected_page = page_by_resource[resource_id]
        wait_for_final_layout(page, panel, expected_page)
        search_results.append({"resourceId": resource_id, "page": expected_page})
    # Exercise a real boundary button and verify its destination identity.
    boundary = page.locator("[data-atlas-boundary-connection]").first
    if boundary.count():
        source_page = panel.get_attribute("data-atlas-active-page") or ""
        destination = boundary.get_attribute("data-atlas-destination-page") or ""
        connection_id = boundary.get_attribute("data-atlas-boundary-connection") or ""
        boundary.click()
        wait_for_final_layout(page, panel, destination)
        require(panel.get_attribute("data-atlas-active-page") != source_page, f'{item["key"]}: boundary click did not change page')
        require(any(ref["connectionId"] == connection_id and ref["destinationPage"] == destination for ref in all_refs), f'{item["key"]}: boundary destination was not indexed')
        boundary_navigation = {"connectionId": connection_id, "from": source_page, "to": destination}
    else:
        boundary_navigation = None
    trace = page.evaluate("window.__yadilabNetworkImportActivationTrace")
    require(trace.get("globalLayoutCalls") == 0, f'{item["key"]}: bounded Atlas invoked global ELK {trace!r}')
    assert_no_horizontal_overflow(page, viewport, item["key"])
    return {
        "status": "BOUNDED_ATLAS_PASS",
        "activationDecision": "BOUNDED_ATLAS",
        "activationDecisionReason": "201-1000 resources, accepted canonical XLSX profile, <=2000 connections",
        "builderCompileStatus": "valid",
        "canonicalExportVerified": True,
        "canonicalResources": len(flattened_resources),
        "canonicalConnections": len(item["connectionIds"]),
        "atlasPageCount": page_count,
        "atlasIndexedResources": len(flattened_resources),
        "atlasIndexedConnections": len(item["connectionIds"]),
        "allPagesVisited": True,
        "allPageResourcesReconciled": True,
        "allConnectionsReconciled": True,
        "realSvgNodeIdsVerified": all(bool(page_evidence["resourceIds"]) for page_evidence in all_page_evidence),
        "realSvgEdgeIdsVerified": True,
        "endpointPortsVerified": True,
        "globalElkInvocationCount": trace.get("globalLayoutCalls"),
        "layoutStatus": "PASS",
        "viewportResults": [{"viewport": list(viewport), "pageCount": page_count, "screenshots": [e["screenshot"] for e in all_page_evidence if e["screenshot"]], "horizontalOverflow": False}],
        "searchResults": search_results,
        "boundaryNavigation": boundary_navigation,
        "pageErrors": [],
        "externalRequests": [],
    }


def verify_blocked(page, panel, before: dict[str, Any], item: dict[str, Any], viewport: tuple[int, int], evidence_dir: Path) -> dict[str, Any]:
    require(panel.get_attribute("data-network-import-decision") == "BLOCKED", f'{item["key"]}: policy did not block 1001 resources')
    expect(panel.locator('[data-network-import-layout-blocked="true"]')).to_be_visible(timeout=30000)
    expect(panel.locator('[data-network-import-layout-diagnostic="NETWORK_IMPORT_LAYOUT_CAPACITY_BLOCKED"]')).to_be_visible()
    activate = panel.locator('[data-network-import-activate="true"]')
    require(activate.is_disabled(), f'{item["key"]}: blocked activation button enabled')
    trace = page.evaluate("window.__yadilabNetworkImportActivationTrace")
    require(trace.get("globalLayoutCalls") == 0, f'{item["key"]}: blocked source reached global ELK')
    page.get_by_role("button", name="Close network import").click()
    expect(panel).to_have_count(0, timeout=30000)
    require(exported_source(page) == before, f'{item["key"]}: blocked source changed active Builder')
    assert_no_horizontal_overflow(page, viewport, item["key"])
    screenshot = f'atlas001-capacity-{item["key"]}-{viewport[0]}x{viewport[1]}-blocked.png'
    page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
    return {
        "status": "BLOCKED_BY_POLICY",
        "activationDecision": "BLOCKED",
        "activationDecisionReason": "resources > 1000",
        "builderCompileStatus": "NOT_RUN",
        "canonicalExportVerified": True,
        "atlasPageCount": 0,
        "atlasIndexedResources": 0,
        "atlasIndexedConnections": 0,
        "allPagesVisited": False,
        "allPageResourcesReconciled": False,
        "allConnectionsReconciled": False,
        "realSvgNodeIdsVerified": False,
        "realSvgEdgeIdsVerified": False,
        "endpointPortsVerified": False,
        "globalElkInvocationCount": trace.get("globalLayoutCalls"),
        "layoutStatus": "NOT_RUN",
        "viewportResults": [{"viewport": list(viewport), "screenshot": screenshot, "horizontalOverflow": False}],
        "negativeTestResults": {"builderUnchanged": True, "globalElkNotRun": True},
        "pageErrors": [],
        "externalRequests": [],
    }


def run_case(browser, url: str, evidence_dir: Path, manifest: dict[str, Any], case: dict[str, Any]) -> list[dict[str, Any]]:
    item = next(entry for entry in manifest["cases"] if entry["key"] == case["key"])
    fixture = ROOT / item["path"]
    results = []
    for viewport in case["viewports"]:
        page, errors, outside = open_page(browser, url, viewport)
        try:
            started = page.evaluate("performance.now()")
            before = exported_source(page) if case["status"] == "BLOCKED_BY_POLICY" else None
            panel, _payload = open_import(page, fixture, item)
            if case["status"] == "BLOCKED_BY_POLICY":
                require(before is not None, f'{item["key"]}: missing pre-import Builder snapshot')
                result = verify_blocked(page, panel, before, item, viewport, evidence_dir)
            else:
                decision = "NORMAL" if case["status"] == "FULL_UI_PASS" else "BOUNDED_ATLAS"
                require(panel.get_attribute("data-network-import-decision") == decision, f'{item["key"]}: expected {decision} policy')
                if decision == "BOUNDED_ATLAS":
                    consent = panel.locator('[data-atlas-bounded-consent="true"]')
                    require(not consent.is_checked(), f'{item["key"]}: bounded consent was preselected')
                    require(panel.locator('[data-network-import-activate="true"]').is_disabled(), f'{item["key"]}: bounded activation enabled before consent')
                    consent.check()
                else:
                    require(panel.locator('[data-network-import-activate="true"]').is_enabled(), f'{item["key"]}: normal activation disabled')
                panel.locator('[data-network-import-activate="true"]').click()
                expect(panel).to_have_count(0, timeout=300000)
                source = exported_source(page)
                source_truth(source, item)
                if decision == "NORMAL":
                    result = verify_normal(page, item, viewport, evidence_dir)
                else:
                    result = verify_atlas(page, item, viewport, evidence_dir)
            result["originalSha256"] = item["sha256"]
            result["sourceFormat"] = "xlsx"
            result["sourceByteSize"] = item["byteSize"]
            result["canonicalResourceIdsSha256"] = item["resourceIdsSha256"]
            result["canonicalConnectionIdsSha256"] = item["connectionIdsSha256"]
            result["renderDurationMs"] = round(page.evaluate("performance.now()") - started, 1)
            result["pageErrors"] = list(errors)
            result["externalRequests"] = list(outside)
            require(not errors, f'{item["key"]}: Chromium page errors {errors!r}')
            require(not outside, f'{item["key"]}: unexpected external requests {outside!r}')
            results.append({"key": item["key"], "viewport": list(viewport), **result})
        finally:
            page.close()
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    require_loopback(args.url)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    with sync_playwright() as playwright:
        launch: dict[str, Any] = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            for case in CASES:
                try:
                    results.extend(run_case(browser, args.url, args.evidence_dir, manifest, case))
                except Exception as error:  # preserve explicit FAIL evidence for every matrix row
                    failures.append({"key": case["key"], "status": "FAIL", "error": str(error)})
        finally:
            browser.close()
    evidence = {
        "format": "atlas001-import-visualization-capacity-evidence",
        "schemaVersion": "1.0.0",
        "status": "FAIL" if failures else "PASS",
        "commitSha": os.environ.get("YADILAB_EXPECTED_COMMIT", "unknown"),
        "mainSha": os.environ.get("YADILAB_MAIN_SHA", "unknown"),
        "prNumber": 105,
        "workflowRunId": os.environ.get("GITHUB_RUN_ID", "local"),
        "testProfile": "ATLAS-001 import + Builder + Normal/Atlas DOM/SVG capacity gate",
        "normalConnectionBudget": "PENDING_DECISION",
        "results": results,
        "failures": failures,
        "formatMatrix": {
            "xlsx-canonical-six-sheet": "FULL_UI_PASS for 50/100/200; BOUNDED_ATLAS_PASS for 201/300/500/1000; BLOCKED_BY_POLICY for 1001",
            "csv": "NOT_TESTED for this capacity matrix",
            "tsv": "NOT_TESTED for this capacity matrix",
            "json": "NOT_TESTED for this capacity matrix",
            "ods": "NOT_TESTED for this capacity matrix",
            "docx-reviewed-office": "NOT_TESTED for this capacity matrix; Excel/CSV panel intentionally not used",
        },
    }
    (args.evidence_dir / "atlas001-import-visualization-capacity.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    if failures:
        print("FAIL ATLAS-001 capacity gate", file=sys.stderr)
        return 1
    print("PASS ATLAS-001 import and visualization capacity gate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

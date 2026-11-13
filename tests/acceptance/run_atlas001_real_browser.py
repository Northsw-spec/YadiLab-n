#!/usr/bin/env python3
"""ATLAS-001 G3: compiled Chromium page navigation and geometry evidence."""
import argparse
import json
import math
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


VIEWPORTS = ((1366, 768), (1280, 800), (1920, 1080), (390, 844))


def require_loopback(url: str) -> None:
    target = urlsplit(url)
    if target.scheme != "http" or target.hostname != "127.0.0.1" or not target.port or target.path != "/" or target.query or target.fragment:
        raise AssertionError("ATLAS-001 must exercise the compiled app on loopback without query or fragment")


def json_attribute(locator, name: str):
    raw = locator.get_attribute(name)
    if raw is None:
        raise AssertionError(f"Missing required attribute {name}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise AssertionError(f"Invalid JSON in {name}: {raw!r}") from error


def wait_for_final_layout(page, panel, expected_page: str) -> str:
    """Wait for a final identity-matched layout; PENDING is never accepted."""
    expect(panel).to_have_attribute("data-atlas-active-page", expected_page, timeout=30000)
    expect(panel).to_have_attribute("data-atlas-layout-page-id", expected_page, timeout=30000)
    expect(panel).to_have_attribute("data-atlas-layout-quality", "PASS", timeout=60000)
    expect(panel).to_have_attribute("data-atlas-layout-quality-gate", "PASS", timeout=60000)
    expect(panel).to_have_attribute("data-atlas-layout-error-count", "0", timeout=30000)
    expect(panel.locator('.atlas-page-status [data-atlas-layout-status="PENDING"]')).to_have_count(0, timeout=30000)
    request_key = panel.get_attribute("data-atlas-layout-request-key") or ""
    source_identity = panel.get_attribute("data-atlas-layout-source-identity") or ""
    if not source_identity or expected_page not in request_key:
        raise AssertionError(f"Layout identity mismatch: page={expected_page!r}, source={source_identity!r}, request={request_key!r}")
    return request_key


def rect_snapshot(page, panel):
    panel_box = panel.bounding_box()
    if not panel_box:
        raise AssertionError("Topology panel has no screen rectangle")
    nodes = page.locator(".react-flow__node").evaluate_all(
        """
        (elements) => Object.fromEntries(elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const heading = element.querySelector('.zone-heading')?.getBoundingClientRect();
          const resource = Boolean(element.querySelector('.resource-node'));
          const compact = (value) => value ? {x: value.x, y: value.y, width: value.width, height: value.height} : null;
          return [element.getAttribute('data-id'), {rect: compact(rect), heading: compact(heading), resource}];
        }).filter(([id]) => id));
        """
    )
    return panel_box, nodes


def assert_geometry(page, panel, resource_ids, parent_map, routes, viewport):
    panel_box, nodes = rect_snapshot(page, panel)
    actual_resource_ids = sorted(node_id for node_id, value in nodes.items() if value["resource"])
    if actual_resource_ids != sorted(resource_ids):
        raise AssertionError(f"Rendered resource IDs differ: expected={sorted(resource_ids)!r}, actual={actual_resource_ids!r}")

    margin = 16 if viewport[0] >= 600 else 4
    root_id = sorted(resource_ids)[0] if resource_ids else None
    if root_id:
        root_rect = nodes[root_id]["rect"]
        if not root_rect:
            raise AssertionError(f"Focused Atlas resource {root_id} has no screen rectangle")
        if not (
            root_rect["x"] >= panel_box["x"] + margin
            and root_rect["y"] >= panel_box["y"] + margin
            and root_rect["x"] + root_rect["width"] <= panel_box["x"] + panel_box["width"] - margin
            and root_rect["y"] + root_rect["height"] <= panel_box["y"] + panel_box["height"] - margin
        ):
            raise AssertionError(f"Focused Atlas resource {root_id} is outside the usable panel: root={root_rect!r}, panel={panel_box!r}")

    for resource_id, parent_id in parent_map.items():
        if parent_id is None:
            continue
        child = nodes.get(resource_id, {}).get("rect")
        parent = nodes.get(parent_id, {}).get("rect")
        if not child or not parent:
            raise AssertionError(f"Missing containment geometry for {resource_id} -> {parent_id}")
        if not (
            child["x"] >= parent["x"]
            and child["y"] >= parent["y"]
            and child["x"] + child["width"] <= parent["x"] + parent["width"]
            and child["y"] + child["height"] <= parent["y"] + parent["height"]
        ):
            raise AssertionError(f"Resource {resource_id} escapes group {parent_id}: child={child!r}, parent={parent!r}")
        heading = nodes.get(parent_id, {}).get("heading")
        if heading and (
            child["x"] < heading["x"] + heading["width"]
            and child["x"] + child["width"] > heading["x"]
            and child["y"] < heading["y"] + heading["height"]
            and child["y"] + child["height"] > heading["y"]
        ):
            raise AssertionError(f"Resource {resource_id} overlaps group header {parent_id}")

    for route_item in routes:
        route = route_item.get("route")
        if not isinstance(route, list) or len(route) < 2:
            raise AssertionError(f"Missing final orthogonal route for {route_item.get('id')}")
        for left, right in zip(route, route[1:]):
            if not all(math.isfinite(float(point.get(axis, float("nan")))) for point in (left, right) for axis in ("x", "y")):
                raise AssertionError(f"Non-finite route for {route_item.get('id')}: {route!r}")
            if float(left["x"]) != float(right["x"]) and float(left["y"]) != float(right["y"]):
                raise AssertionError(f"Non-orthogonal segment for {route_item.get('id')}: {left!r} -> {right!r}")

    primary = page.locator(f'.react-flow__node[data-id="{root_id}"] .device-identity strong') if root_id else None
    if primary and primary.count():
        primary_box = primary.bounding_box()
        if viewport[0] >= 600 and primary_box and primary_box["height"] < 13:
            raise AssertionError(f"Rendered primary label is below 13 screen px: {primary_box!r}")
    return {"panelRect": panel_box, "nodes": nodes, "focusedResourceId": root_id}


def capture_page_evidence(page, panel, expected_page: str, viewport):
    request_key = wait_for_final_layout(page, panel, expected_page)
    resource_ids = json_attribute(panel, "data-atlas-page-resource-ids")
    internal_ids = json_attribute(panel, "data-atlas-page-internal-connection-ids")
    internal_connections = json_attribute(panel, "data-atlas-page-internal-connections")
    parent_map = json_attribute(panel, "data-atlas-resource-parent-map")
    routes = json_attribute(panel, "data-atlas-layout-routes")
    flow_edges = json.loads(panel.get_attribute("data-topology-react-flow-edge-handles") or "[]")
    boundary_ids = [value for value in (panel.get_attribute("data-atlas-boundary-connection-ids") or "").split(",") if value]

    rendered_edge_ids = sorted(edge.get("id") for edge in flow_edges)
    if rendered_edge_ids != sorted(internal_ids):
        raise AssertionError(f"Rendered connection IDs differ: expected={sorted(internal_ids)!r}, actual={rendered_edge_ids!r}")
    if set(rendered_edge_ids) & set(boundary_ids):
        raise AssertionError("A boundary connection was rendered as a physical edge")
    route_ids = sorted(route.get("id") for route in routes)
    if route_ids != sorted(internal_ids):
        raise AssertionError(f"Final route IDs differ: expected={sorted(internal_ids)!r}, actual={route_ids!r}")

    expected_by_id = {connection["id"]: connection for connection in internal_connections}
    flow_by_id = {edge["id"]: edge for edge in flow_edges}
    for connection_id, connection in expected_by_id.items():
        edge = flow_by_id.get(connection_id)
        if not edge:
            raise AssertionError(f"Missing React Flow edge {connection_id}")
        expected_source = connection["from"]["resource"]
        expected_target = connection["to"]["resource"]
        expected_source_handle = f"out:{connection['from']['port']}" if connection["from"].get("port") else None
        expected_target_handle = f"in:{connection['to']['port']}" if connection["to"].get("port") else None
        for field, expected in (("source", expected_source), ("target", expected_target), ("sourceHandle", expected_source_handle), ("targetHandle", expected_target_handle)):
            if edge.get(field) != expected:
                raise AssertionError(f"Endpoint mismatch for {connection_id} {field}: expected={expected!r}, actual={edge.get(field)!r}")

    dom_edges = page.locator("path.react-flow__edge-path").evaluate_all(
        """
        (elements) => elements.map((element) => ({
          id: element.getAttribute('id'),
          source: element.getAttribute('data-connection-source'),
          target: element.getAttribute('data-connection-target'),
          sourcePort: element.getAttribute('data-connection-source-port'),
          targetPort: element.getAttribute('data-connection-target-port'),
          routeKind: element.getAttribute('data-route-kind'),
        })).filter((edge) => edge.id)
        """
    )
    dom_by_id = {edge["id"]: edge for edge in dom_edges}
    if sorted(dom_by_id) != sorted(internal_ids):
        raise AssertionError(f"Final DOM edge IDs differ: expected={sorted(internal_ids)!r}, actual={sorted(dom_by_id)!r}")
    for connection_id, connection in expected_by_id.items():
        edge = dom_by_id[connection_id]
        if edge["source"] != connection["from"]["resource"] or edge["target"] != connection["to"]["resource"]:
            raise AssertionError(f"DOM endpoint mismatch for {connection_id}: {edge!r}")
        if edge["sourcePort"] != connection["from"].get("port") or edge["targetPort"] != connection["to"].get("port"):
            raise AssertionError(f"DOM port mismatch for {connection_id}: {edge!r}")
        if edge["routeKind"] != "orthogonal":
            raise AssertionError(f"Rendered edge {connection_id} is not orthogonal: {edge!r}")

    geometry = assert_geometry(page, panel, resource_ids, parent_map, routes, viewport)
    return {
        "page": expected_page,
        "sourceIdentity": panel.get_attribute("data-atlas-layout-source-identity"),
        "requestKey": request_key,
        "resourceIds": resource_ids,
        "internalConnectionIds": internal_ids,
        "boundaryConnectionIds": boundary_ids,
        "internalEndpoints": internal_connections,
        "routeIds": route_ids,
        "focusedResourceId": geometry["focusedResourceId"],
        "panelRect": geometry["panelRect"],
        "nodeRects": geometry["nodes"],
    }


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
                viewport = (width, height)
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
                first_evidence = capture_page_evidence(page, panel, first_page, viewport)
                screenshot_name = f"atlas001-{width}x{height}-page-a.png"
                page.screenshot(path=str(args.evidence_dir / screenshot_name), full_page=True)
                screenshots.append({"viewport": [width, height], "path": screenshot_name, "evidence": first_evidence})

                # Exercise the async identity guard with two immediate page
                # requests; the final result must still belong to the last one.
                page_options = page.locator("[data-atlas-page-option]")
                if page_options.count() >= 2:
                    page_options.nth(1).click()
                    page_options.nth(0).click()
                    wait_for_final_layout(page, panel, first_page)

                boundary = page.locator("[data-atlas-boundary-connection]").first
                expect(boundary).to_be_visible(timeout=15000)
                destination = boundary.get_attribute("data-atlas-destination-page")
                connection_id = boundary.get_attribute("data-atlas-boundary-connection")
                if not destination or not connection_id:
                    raise AssertionError("Boundary reference lacks destination page or canonical connection ID")
                boundary.click()
                destination_evidence = capture_page_evidence(page, panel, destination, viewport)
                if destination_evidence["page"] == first_page:
                    raise AssertionError("Boundary navigation did not change Atlas page")
                if destination_evidence["requestKey"] == first_evidence["requestKey"]:
                    raise AssertionError("Atlas request identity did not change across pages")
                screenshot_name = f"atlas001-{width}x{height}-page-b.png"
                page.screenshot(path=str(args.evidence_dir / screenshot_name), full_page=True)
                screenshots.append({"viewport": [width, height], "path": screenshot_name, "fromConnection": connection_id, "evidence": destination_evidence})

                page.get_by_role("button", name="Tillbaka").click()
                back_evidence = capture_page_evidence(page, panel, first_page, viewport)
                if back_evidence["page"] != first_page:
                    raise AssertionError("Back navigation did not restore the original Atlas page")
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

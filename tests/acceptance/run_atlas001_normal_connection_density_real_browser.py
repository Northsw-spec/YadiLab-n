#!/usr/bin/env python3
"""ATLAS-001 NORMAL connection-density gate in compiled Chromium.

The XLSX files are independent source controls.  The browser receives the
original bytes through the product file input; this script never synthesizes
canonical source or uses the importer to generate its fixtures.

This is a bounded measurement harness, not a performance certification.  A
missing browser metric is recorded as ``NOT_EXPOSED`` rather than inferred.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import expect, sync_playwright

from run_atlas001_real_browser import require_loopback
from run_ic010_p2_shared_xml_real_browser import exported_source


ROOT = Path(__file__).resolve().parents[2]
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
VIEWPORT = (1366, 768)
# The default bound is deliberately finite and explicit.  Local investigators
# may tighten it for a quick failure scan with ATLAS001_CASE_TIMEOUT_MS, while
# CI/archival runs retain the documented 180-second ceiling.
CASE_TIMEOUT_MS = int(os.environ.get("ATLAS001_CASE_TIMEOUT_MS", "180000"))
EVENT_LOOP_PROBE_MS = 250
FINITE_NUMBER = re.compile(r"-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?", re.I)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_manifest() -> dict[str, Any]:
    return json.loads(
        (ROOT / "tests/fixtures/import/atlas001-normal-density-manifest.json").read_text(
            encoding="utf-8"
        )
    )


def open_page(browser, url: str):
    page = browser.new_page(
        accept_downloads=True,
        viewport={"width": VIEWPORT[0], "height": VIEWPORT[1]},
        device_scale_factor=1,
    )
    page_errors: list[str] = []
    console_errors: list[str] = []
    outside: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on(
        "request",
        lambda request: outside.append(request.url)
        if not (
            request.url.startswith(url)
            or request.url.startswith("data:")
            or request.url.startswith("blob:")
        )
        else None,
    )
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=30_000)
    return page, page_errors, console_errors, outside


def open_import(page, fixture: Path, item: dict[str, Any]):
    payload = fixture.read_bytes()
    require(sha256(payload) == item["sha256"], f'{item["key"]}: fixture SHA-256 changed')
    page.locator('[data-network-import-primary="true"]').click()
    panel = page.locator('[data-network-import-panel="ready"]')
    expect(panel).to_be_visible(timeout=30_000)
    import_started = time.perf_counter()
    panel.locator('[data-network-import-file="true"]').set_input_files(
        {"name": fixture.name, "mimeType": MIME, "buffer": payload}
    )
    expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(
        timeout=CASE_TIMEOUT_MS
    )
    expect(panel).to_contain_text(
        f'Devices: {item["resources"]} · Explicit links: {item["connections"]}',
        timeout=CASE_TIMEOUT_MS,
    )
    return panel, payload, round((time.perf_counter() - import_started) * 1000, 1)


def source_truth(source: dict[str, Any], item: dict[str, Any]) -> None:
    resources = source.get("resources", [])
    connections = source.get("connections", [])
    require(len(resources) == item["resources"], f'{item["key"]}: exported resource count changed')
    require(len(connections) == item["connections"], f'{item["key"]}: exported connection count changed')
    require(
        [resource.get("id") for resource in resources] == item["resourceIds"],
        f'{item["key"]}: resource IDs changed',
    )
    require(
        [connection.get("id") for connection in connections] == item["connectionIds"],
        f'{item["key"]}: connection IDs changed',
    )
    expected = {row["id"]: row for row in item["connectionsTruth"]}
    for connection in connections:
        truth = expected.get(connection.get("id"))
        require(truth is not None, f'{item["key"]}: unexpected connection {connection.get("id")}')
        actual = {
            "from": (connection.get("from") or {}).get("resource"),
            "fromPort": (connection.get("from") or {}).get("port"),
            "to": (connection.get("to") or {}).get("resource"),
            "toPort": (connection.get("to") or {}).get("port"),
        }
        require(
            actual
            == {
                "from": truth["from"],
                "fromPort": truth["fromPort"],
                "to": truth["to"],
                "toPort": truth["toPort"],
            },
            f'{item["key"]}: endpoint/port mismatch for {connection.get("id")}',
        )
        require(actual["fromPort"] and actual["toPort"], f'{item["key"]}: missing explicit port')
    require(
        source.get("networkImportProvenance", {}).get("source", {}).get("sha256")
        == item["sha256"],
        f'{item["key"]}: original source provenance SHA changed',
    )


def wait_for_normal_render(page, item: dict[str, Any]) -> float:
    panel = page.locator(".topology-panel")
    page.wait_for_function(
        """(expected) => {
          const panel = document.querySelector('.topology-panel');
          const nodes = [...document.querySelectorAll('.react-flow__node .resource-node')];
          const edges = [...document.querySelectorAll('path.react-flow__edge-path')];
          return panel?.getAttribute('data-topology-edge-count') === String(expected.connections)
            && nodes.length === expected.resources
            && edges.length === expected.connections
            && panel?.getAttribute('data-topology-layout-quality') !== 'PENDING';
        }""",
        arg={"resources": item["resources"], "connections": item["connections"]},
        timeout=CASE_TIMEOUT_MS,
    )
    # A second animation-frame observation prevents recording the first
    # partially committed React Flow tree as the final render.
    page.wait_for_function(
        """(expected) => new Promise(resolve => requestAnimationFrame(() => {
          const nodes = document.querySelectorAll('.react-flow__node .resource-node').length;
          const edges = document.querySelectorAll('path.react-flow__edge-path').length;
          resolve(nodes === expected.resources && edges === expected.connections);
        }))""",
        arg={"resources": item["resources"], "connections": item["connections"]},
        timeout=30_000,
    )
    _ = panel
    return 0.0


def wait_for_activation_outcome(page, panel) -> bool:
    """Return True when the import panel closed, False for a visible failure."""
    page.wait_for_function(
        """() => !document.querySelector('[data-network-import-panel]') ||
          Boolean(document.querySelector('[data-network-import-panel] [role="alert"]'))""",
        timeout=CASE_TIMEOUT_MS,
    )
    return panel.count() == 0


def measure_dom(page, item: dict[str, Any]) -> dict[str, Any]:
    evidence = page.evaluate(
        """() => {
          const rect = element => {
            const value = element?.getBoundingClientRect();
            return value ? {x:value.x, y:value.y, width:value.width, height:value.height,
              right:value.right, bottom:value.bottom} : null;
          };
          const intersects = (a, b) => Boolean(a && b && a.x < b.right && a.right > b.x &&
            a.y < b.bottom && a.bottom > b.y);
          const nodes = [...document.querySelectorAll('.react-flow__node')];
          const resources = nodes.filter(node => node.querySelector('.resource-node'));
          const zones = nodes.filter(node => node.querySelector('.zone-node'));
          let overlapPairs = 0;
          for (let i = 0; i < resources.length; i += 1) {
            const left = rect(resources[i]);
            for (let j = i + 1; j < resources.length; j += 1) {
              if (intersects(left, rect(resources[j]))) overlapPairs += 1;
            }
          }
          const zoneHeaders = zones.map(zone => rect(zone.querySelector('.zone-heading'))).filter(Boolean);
          const resourceRects = resources.map(node => ({id: node.getAttribute('data-id'), rect: rect(node)}));
          const headerOverlaps = resourceRects.filter(item => zoneHeaders.some(header => intersects(item.rect, header))).length;
          const handles = JSON.parse(document.querySelector('.topology-panel')?.getAttribute('data-topology-react-flow-edge-handles') || '[]');
          const paths = [...document.querySelectorAll('path.react-flow__edge-path')].map(path => ({
            id: path.getAttribute('id'),
            source: path.getAttribute('data-connection-source'),
            target: path.getAttribute('data-connection-target'),
            sourcePort: path.getAttribute('data-connection-source-port'),
            targetPort: path.getAttribute('data-connection-target-port'),
            routeKind: path.getAttribute('data-route-kind'),
            pathData: path.getAttribute('d') || '',
          }));
          const memory = performance.memory ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          } : 'NOT_EXPOSED';
          return {
            resourceCount: resources.length,
            zoneCount: zones.length,
            edgeCount: paths.length,
            handles,
            paths,
            overlapPairs,
            zoneHeaderOverlaps: headerOverlaps,
            resourceRects,
            memory,
            panel: {
              edgeCount: document.querySelector('.topology-panel')?.getAttribute('data-topology-edge-count'),
              connectedExplorerGeometry: document.querySelector('.topology-panel')?.getAttribute('data-connected-explorer-geometry'),
              layoutQuality: document.querySelector('.topology-panel')?.getAttribute('data-topology-layout-quality') || 'NOT_EXPOSED',
              layoutQualityGate: document.querySelector('.topology-panel')?.getAttribute('data-topology-layout-quality-gate') || 'NOT_EXPOSED',
              hierarchy: document.querySelector('.topology-panel')?.getAttribute('data-topology-hierarchy') || 'NOT_EXPOSED',
            },
          };
        }"""
    )
    require(
        evidence["resourceCount"] == item["resources"],
        f'{item["key"]}: rendered resource count {evidence["resourceCount"]}',
    )
    require(
        evidence["edgeCount"] == item["connections"],
        f'{item["key"]}: rendered SVG edge count {evidence["edgeCount"]}',
    )
    require(
        evidence["zoneCount"] == len(item["zoneIds"]),
        f'{item["key"]}: rendered zone count {evidence["zoneCount"]}',
    )
    expected = {row["id"]: row for row in item["connectionsTruth"]}
    handles = {edge.get("id"): edge for edge in evidence["handles"]}
    paths = {edge.get("id"): edge for edge in evidence["paths"]}
    require(set(handles) == set(item["connectionIds"]), f'{item["key"]}: React Flow edge IDs differ')
    require(set(paths) == set(item["connectionIds"]), f'{item["key"]}: SVG edge IDs differ')
    bad_ports: list[str] = []
    bad_routes: list[str] = []
    bad_paths: list[str] = []
    for connection_id, truth in expected.items():
        handle = handles[connection_id]
        if handle.get("source") != truth["from"] or handle.get("target") != truth["to"]:
            bad_ports.append(f"{connection_id}:endpoint")
        if handle.get("sourceHandle") != f"out:{truth['fromPort']}" or handle.get("targetHandle") != f"in:{truth['toPort']}":
            bad_ports.append(connection_id)
        path = paths[connection_id]
        if path.get("source") != truth["from"] or path.get("target") != truth["to"]:
            bad_ports.append(f"{connection_id}:svg-endpoint")
        if path.get("sourcePort") != truth["fromPort"] or path.get("targetPort") != truth["toPort"]:
            bad_ports.append(f"{connection_id}:svg-port")
        if path.get("routeKind") != "orthogonal":
            bad_routes.append(connection_id)
        if len(FINITE_NUMBER.findall(path.get("pathData") or "")) < 4:
            bad_paths.append(connection_id)
    require(not bad_ports, f'{item["key"]}: endpoint/port errors {bad_ports[:5]!r}')
    require(not bad_routes, f'{item["key"]}: non-orthogonal routes {bad_routes[:5]!r}')
    require(not bad_paths, f'{item["key"]}: malformed SVG paths {bad_paths[:5]!r}')
    return {
        "renderedResourceCount": evidence["resourceCount"],
        "renderedZoneCount": evidence["zoneCount"],
        "renderedSvgEdgeCount": evidence["edgeCount"],
        "overlapPairs": evidence["overlapPairs"],
        "zoneHeaderOverlaps": evidence["zoneHeaderOverlaps"],
        "endpointPortErrors": len(bad_ports),
        "nonOrthogonalRoutes": len(bad_routes),
        "malformedSvgPaths": len(bad_paths),
        "memory": evidence["memory"],
        "topologyPanel": evidence["panel"],
    }


def event_loop_probe(page) -> dict[str, Any]:
    return page.evaluate(
        """(duration) => new Promise(resolve => {
          const start = performance.now();
          let ticks = 0;
          let maxDelay = 0;
          let previous = start;
          const timer = setInterval(() => {
            const now = performance.now();
            maxDelay = Math.max(maxDelay, Math.max(0, now - previous - 16));
            previous = now;
            ticks += 1;
          }, 16);
          setTimeout(() => {
            clearInterval(timer);
            resolve({durationMs: Math.round(performance.now() - start), ticks, maxDelayMs: Math.round(maxDelay)});
          }, duration);
        })""",
        EVENT_LOOP_PROBE_MS,
    )


def close_failed_import_and_verify_builder(page, panel, baseline_source: dict[str, Any]) -> bool:
    """Dismiss a failed modal before using the Advanced export control."""
    if panel.count():
        close_button = panel.get_by_role("button", name="Close network import")
        if close_button.count():
            close_button.click()
            expect(panel).to_have_count(0, timeout=30_000)
    return exported_source(page) == baseline_source


def run_case(browser, url: str, evidence_dir: Path, item: dict[str, Any]) -> dict[str, Any]:
    page, page_errors, console_errors, outside = open_page(browser, url)
    case_started = time.perf_counter()
    try:
        baseline_source = exported_source(page)
        panel, _payload, import_ms = open_import(page, ROOT / item["path"], item)
        preview_decision = panel.get_attribute("data-network-import-decision")
        require(preview_decision == "NORMAL", f'{item["key"]}: expected current NORMAL reproduction, got {preview_decision!r}')
        activation_started = time.perf_counter()
        try:
            panel.locator('[data-network-import-activate="true"]').click(timeout=CASE_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            trace = None
            try:
                trace = page.evaluate("window.__yadilabNetworkImportActivationTrace") or {}
            except Exception:
                trace = {}
            return {
                "key": item["key"], "topology": item["topology"],
                "resources": item["resources"], "connections": item["connections"],
                "status": "FAIL", "failureKind": "TIMEOUT",
                "failureDiagnostic": "Activation click did not return within the explicit case bound; Chromium responsiveness/layout completion is UNKNOWN",
                "activationDecision": preview_decision,
                "importPreviewMs": import_ms,
                "activationToBuilderCommitMs": round((time.perf_counter() - activation_started) * 1000, 1),
                "canonicalCompileMs": "NOT_EXPOSED",
                "globalElkDurationMs": "NOT_EXPOSED",
                "globalElkInvocationCount": trace.get("globalLayoutCalls"),
                "globalElkLastDecision": trace.get("lastDecision"),
                "timeouts": ["activation-click"], "abortedLayout": True,
                "builderUnchanged": "UNKNOWN",
                "pageErrors": page_errors, "consoleErrors": console_errors,
                "externalRequests": outside,
                "caseElapsedMs": round((time.perf_counter() - case_started) * 1000, 1),
            }
        try:
            closed = wait_for_activation_outcome(page, panel)
        except PlaywrightTimeoutError:
            activation_ms = round((time.perf_counter() - activation_started) * 1000, 1)
            trace = page.evaluate("window.__yadilabNetworkImportActivationTrace") or {}
            return {
                "key": item["key"], "topology": item["topology"],
                "resources": item["resources"], "connections": item["connections"],
                "status": "FAIL", "failureKind": "TIMEOUT",
                "failureDiagnostic": "NORMAL activation did not close or expose a failure within the explicit case bound",
                "activationDecision": preview_decision,
                "importPreviewMs": import_ms,
                "activationToBuilderCommitMs": activation_ms,
                "canonicalCompileMs": "NOT_EXPOSED",
                "globalElkDurationMs": "NOT_EXPOSED",
                "globalElkInvocationCount": trace.get("globalLayoutCalls"),
                "globalElkLastDecision": trace.get("lastDecision"),
                "timeouts": ["activation"], "abortedLayout": True,
                "builderUnchanged": close_failed_import_and_verify_builder(page, panel, baseline_source),
                "pageErrors": page_errors, "consoleErrors": console_errors,
                "externalRequests": outside,
                "caseElapsedMs": round((time.perf_counter() - case_started) * 1000, 1),
            }
        activation_ms = round((time.perf_counter() - activation_started) * 1000, 1)
        if not closed:
            trace = page.evaluate("window.__yadilabNetworkImportActivationTrace") or {}
            diagnostic_values, alert_values = page.evaluate(
                """() => [
                  [...document.querySelectorAll('.diagnostics .diagnostic')]
                    .map(element => element.textContent?.trim() || '').filter(Boolean),
                  [...document.querySelectorAll('[role="alert"]')]
                    .map(element => element.textContent?.trim() || '').filter(Boolean),
                ]"""
            )
            diagnostic_values = list(dict.fromkeys(diagnostic_values))
            alert_values = list(dict.fromkeys(alert_values))
            visible_values = diagnostic_values or alert_values
            failure_text = " | ".join(visible_values[:6]) or "Activation failed without a diagnostic"
            if len(visible_values) > 6:
                failure_text += f" | (+{len(visible_values) - 6} additional diagnostics omitted)"
            screenshot = f'atlas001-normal-density-{item["key"]}-{VIEWPORT[0]}x{VIEWPORT[1]}-failure.png'
            page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
            require(close_failed_import_and_verify_builder(page, panel, baseline_source), f'{item["key"]}: failed activation changed the Builder source')
            return {
                "key": item["key"], "topology": item["topology"],
                "resources": item["resources"], "connections": item["connections"],
                "status": "FAIL", "failureKind": "ACTIVATION_BLOCKED",
                "failureDiagnostic": failure_text,
                "failureCodes": list(dict.fromkeys(value.split(":", 1)[0] for value in diagnostic_values)),
                "activationDecision": preview_decision,
                "importPreviewMs": import_ms,
                "activationToBuilderCommitMs": activation_ms,
                "canonicalCompileMs": "NOT_EXPOSED",
                "globalElkDurationMs": "NOT_EXPOSED",
                "globalElkInvocationCount": trace.get("globalLayoutCalls"),
                "globalElkLastDecision": trace.get("lastDecision"),
                "timeouts": [], "abortedLayout": False,
                "builderUnchanged": True,
                "screenshot": screenshot,
                "pageErrors": page_errors, "consoleErrors": console_errors,
                "externalRequests": outside,
                "caseElapsedMs": round((time.perf_counter() - case_started) * 1000, 1),
            }
        render_started = time.perf_counter()
        page.locator(".topology-panel").wait_for(timeout=CASE_TIMEOUT_MS)
        wait_for_normal_render(page, item)
        render_ms = round((time.perf_counter() - render_started) * 1000, 1)
        source = exported_source(page)
        source_truth(source, item)
        dom = measure_dom(page, item)
        trace = page.evaluate("window.__yadilabNetworkImportActivationTrace") or {}
        responsiveness = event_loop_probe(page)
        screenshot = f'atlas001-normal-density-{item["key"]}-{VIEWPORT[0]}x{VIEWPORT[1]}.png'
        page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
        require(not page_errors, f'{item["key"]}: Chromium page errors {page_errors!r}')
        require(not console_errors, f'{item["key"]}: Chromium console errors {console_errors!r}')
        require(not outside, f'{item["key"]}: unexpected external requests {outside!r}')
        return {
            "key": item["key"],
            "topology": item["topology"],
            "resources": item["resources"],
            "connections": item["connections"],
            "status": "PASS",
            "activationDecision": preview_decision,
            "importPreviewMs": import_ms,
            "activationToBuilderCommitMs": activation_ms,
            "renderReadyMs": render_ms,
            "canonicalCompileMs": "NOT_EXPOSED",
            "globalElkDurationMs": "NOT_EXPOSED",
            "globalElkInvocationCount": trace.get("globalLayoutCalls"),
            "globalElkLastDecision": trace.get("lastDecision"),
            "responsiveness": responsiveness,
            "pageErrors": page_errors,
            "consoleErrors": console_errors,
            "externalRequests": outside,
            "timeouts": [],
            "abortedLayout": False,
            "screenshot": screenshot,
            "sourceProvenanceVerified": True,
            **dom,
            "caseElapsedMs": round((time.perf_counter() - case_started) * 1000, 1),
        }
    finally:
        try:
            page.close(run_before_unload=False, timeout=5_000)
        except Exception:
            # A renderer that exceeded the explicit activation bound may not
            # answer a close RPC.  The browser/context teardown below remains
            # bounded; the case is already recorded as FAIL/UNKNOWN.
            pass


def run_isolated_matrix(args, manifest: dict[str, Any]) -> int:
    """Run every density case in a killable Chromium child process.

    ELK executes on the Chromium renderer thread.  If that thread stops
    answering the Playwright RPC (as the 200/1600 case can), a timeout in the
    parent must be able to terminate the complete child process group rather
    than waiting on an unbounded browser close.
    """
    selected = [item for item in manifest["cases"] if not args.cases or item["key"] in args.cases]
    require(selected, "no density cases selected")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    process_bound_ms = CASE_TIMEOUT_MS + 10_000
    for item in selected:
        case_dir = args.evidence_dir / f"case-{item['key']}"
        case_dir.mkdir(parents=True, exist_ok=True)
        command = [
            sys.executable,
            str(Path(__file__).resolve()),
            "--url",
            args.url,
            "--evidence-dir",
            str(case_dir),
            "--case",
            item["key"],
            "--child",
        ]
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
            env=os.environ.copy(),
        )
        try:
            stdout, stderr = process.communicate(timeout=process_bound_ms / 1000)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
            failure = {
                "key": item["key"],
                "status": "FAIL",
                "error": f"isolated Chromium process exceeded {process_bound_ms} ms and was terminated",
                "failureKind": "PROCESS_TIMEOUT",
            }
            failures.append(failure)
            continue
        child_path = case_dir / "atlas001-normal-connection-density.json"
        if child_path.exists():
            child = json.loads(child_path.read_text(encoding="utf-8"))
            results.extend(child.get("results", []))
            failures.extend(child.get("failures", []))
            for screenshot in case_dir.glob("*.png"):
                shutil.copy2(screenshot, args.evidence_dir / screenshot.name)
        else:
            detail = (stderr or stdout or "child produced no evidence").strip().splitlines()[-1]
            failures.append({"key": item["key"], "status": "FAIL", "error": detail})

    evidence = {
        "format": "atlas001-normal-connection-density-evidence",
        "schemaVersion": "1.0.0",
        "status": "FAIL" if failures else "PASS",
        "commitSha": os.environ.get("YADILAB_EXPECTED_COMMIT", "unknown"),
        "mainSha": os.environ.get("YADILAB_MAIN_SHA", "unknown"),
        "prNumber": 105,
        "testProfile": "Compiled Chromium · independent XLSX · NORMAL 50/100/200 connection-density matrix",
        "viewport": list(VIEWPORT),
        "caseTimeoutMs": CASE_TIMEOUT_MS,
        "processBoundMs": process_bound_ms,
        "eventLoopProbeMs": EVENT_LOOP_PROBE_MS,
        "normalConnectionBudget": "PENDING_DECISION",
        "resourceAndConnectionPointsAreNotProposedLimits": True,
        "isolatedChromiumPerCase": True,
        "results": results,
        "failures": failures,
        "memoryMetricFallback": "NOT_EXPOSED",
        "canonicalCompileMetric": "NOT_EXPOSED: product exposes no compile-only timing marker",
        "globalElkDurationMetric": "NOT_EXPOSED: activation trace exposes invocation count only",
    }
    output = args.evidence_dir / "atlas001-normal-connection-density.json"
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    if failures:
        print("FAIL ATLAS-001 normal connection-density measurements", file=sys.stderr)
        return 1
    print("PASS ATLAS-001 normal connection-density measurements")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    parser.add_argument("--case", action="append", dest="cases", help="Run only the named manifest case (repeatable)")
    parser.add_argument("--child", action="store_true", help="Run one case in the isolated child process")
    args = parser.parse_args()
    require_loopback(args.url)
    manifest = load_manifest()
    if not args.child:
        return run_isolated_matrix(args, manifest)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    with sync_playwright() as playwright:
        launch: dict[str, Any] = {
            "headless": True,
            "args": [
                "--disable-background-networking",
                "--disable-dev-shm-usage",
                "--enable-precise-memory-info",
            ],
        }
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            selected = [item for item in manifest["cases"] if not args.cases or item["key"] in args.cases]
            require(selected, "no density cases selected")
            for item in selected:
                try:
                    result = run_case(browser, args.url, args.evidence_dir, item)
                    results.append(result)
                    if result.get("status") != "PASS":
                        failures.append({
                            "key": item["key"],
                            "status": result.get("status", "FAIL"),
                            "error": result.get("failureDiagnostic", "density case did not pass"),
                        })
                except Exception as error:
                    failures.append({"key": item["key"], "status": "FAIL", "error": str(error)})
        finally:
            browser.close()
    evidence = {
        "format": "atlas001-normal-connection-density-evidence",
        "schemaVersion": "1.0.0",
        "status": "FAIL" if failures else "PASS",
        "commitSha": os.environ.get("YADILAB_EXPECTED_COMMIT", "unknown"),
        "mainSha": os.environ.get("YADILAB_MAIN_SHA", "unknown"),
        "prNumber": 105,
        "testProfile": "Compiled Chromium · independent XLSX · NORMAL 50/100/200 connection-density matrix",
        "viewport": list(VIEWPORT),
        "caseTimeoutMs": CASE_TIMEOUT_MS,
        "eventLoopProbeMs": EVENT_LOOP_PROBE_MS,
        "normalConnectionBudget": "PENDING_DECISION",
        "resourceAndConnectionPointsAreNotProposedLimits": True,
        "results": results,
        "failures": failures,
        "memoryMetricFallback": "NOT_EXPOSED",
        "canonicalCompileMetric": "NOT_EXPOSED: product exposes no compile-only timing marker",
        "globalElkDurationMetric": "NOT_EXPOSED: activation trace exposes invocation count only",
    }
    (args.evidence_dir / "atlas001-normal-connection-density.json").write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(evidence, indent=2))
    if failures:
        for failure in failures:
            print(
                f"::error title=ATLAS001 normal density::{failure['key']}: {failure['error']}",
                file=sys.stderr,
            )
        print("FAIL ATLAS-001 normal connection-density gate", file=sys.stderr)
        return 1
    print("PASS ATLAS-001 normal connection-density measurements")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

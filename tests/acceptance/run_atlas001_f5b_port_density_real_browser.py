#!/usr/bin/env python3
"""ATLAS-001 F5B port-density safety matrix in compiled Chromium.

The 200/199 linear fixture is the positive regression.  Dense star and
redundant fixtures are deliberately expected to remain fail-closed until the
browser proves cable-level readability, not merely DOM counts.  The script
records measured handle/SVG geometry and bounded timeout outcomes without
turning an unsafe presentation into a PASS.  The functional matrix can be
green while the evidence status remains PARTIAL when the retained linear
projection exposes legacy cable-density observations; those observations are
reported rather than silently discarded.
"""
from __future__ import annotations

import argparse
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
from playwright.sync_api import sync_playwright

import run_atlas001_normal_connection_density_real_browser as density
from run_atlas001_normal_connection_density_real_browser import (
    close_failed_import_and_verify_builder,
    event_loop_probe,
    exported_source,
    load_manifest,
    open_import,
    open_page,
    require,
    source_truth,
    wait_for_activation_outcome,
    wait_for_normal_render,
)
from run_atlas001_real_browser import require_loopback


ROOT = Path(__file__).resolve().parents[2]
VIEWPORTS = ((1366, 768), (1280, 800), (1920, 1080), (390, 844))
POSITIVE = "200-linear"
PORT_DENSITY_NEGATIVES = ("50-star", "100-star", "200-star", "50-redundant")
BOUNDED_CASES = ("100-redundant", "200-redundant")
CASE_TIMEOUT_MS = int(os.environ.get("ATLAS001_CASE_TIMEOUT_MS", "45000"))
FINITE_NUMBER = re.compile(r"-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?", re.I)


def launch_options() -> dict[str, Any]:
    options: dict[str, Any] = {
        "headless": True,
        "args": [
            "--disable-background-networking",
            "--disable-dev-shm-usage",
            "--enable-precise-memory-info",
        ],
    }
    executable = os.environ.get("YADILAB_CHROMIUM_EXECUTABLE")
    if executable:
        options["executable_path"] = executable
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        options["args"].append("--no-sandbox")
    return options


def capture_geometry(page) -> dict[str, Any]:
    """Measure live React Flow handles and rendered SVG, in screen and flow units."""
    return page.evaluate(
        """() => {
          const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
          const rect = element => {
            const value = element?.getBoundingClientRect();
            return value ? {x:value.x,y:value.y,width:value.width,height:value.height,right:value.right,bottom:value.bottom} : null;
          };
          const parsePoints = d => [...String(d || '').matchAll(/[ML]\\s*(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)/g)].map(match => ({x:Number(match[1]),y:Number(match[2])}));
          const screenPoint = (point, matrix) => matrix ? {x:matrix.a*point.x+matrix.c*point.y+matrix.e,y:matrix.b*point.x+matrix.d*point.y+matrix.f} : null;
          const viewportStyle = document.querySelector('.react-flow__viewport')?.getAttribute('style') || '';
          const zoomMatch = viewportStyle.match(/scale\\(([-+0-9.eE]+)\\)/);
          const zoom = number(zoomMatch?.[1]) || 1;
          const resources = [...document.querySelectorAll('.react-flow__node')].filter(node => node.querySelector('.resource-node'));
          const resourceRects = new Map(resources.map(node => [node.dataset.id, {id:node.dataset.id,rect:rect(node)}]));
          const handles = [];
          for (const node of resources) for (const handle of node.querySelectorAll('.interface-handle')) {
            const value = rect(handle);
            if (!value) continue;
            handles.push({nodeId:node.dataset.id,handleId:handle.dataset.reactFlowHandleId,interfaceId:handle.dataset.interfaceId,side:handle.dataset.interfaceSide || 'UNDECLARED',type:handle.dataset.reactFlowHandleType,center:{x:value.x+value.width/2,y:value.y+value.height/2}});
          }
          const paths = [];
          const segments = [];
          for (const path of document.querySelectorAll('path.react-flow__edge-path')) {
            const matrix = path.getScreenCTM();
            const flowPoints = parsePoints(path.getAttribute('d'));
            const screenPoints = flowPoints.map(point => screenPoint(point,matrix)).filter(Boolean);
            const item = {id:path.id,source:path.dataset.connectionSource,target:path.dataset.connectionTarget,sourcePort:path.dataset.connectionSourcePort,targetPort:path.dataset.connectionTargetPort,routeKind:path.dataset.routeKind,pathData:path.getAttribute('d') || '',flowPoints,screenPoints};
            paths.push(item);
            for (let index=1; index<screenPoints.length; index += 1) segments.push({edgeId:path.id,a:screenPoints[index-1],b:screenPoints[index]});
          }
          const properCrossing = (left,right) => {
            const leftHorizontal = left.a.y === left.b.y;
            const rightHorizontal = right.a.y === right.b.y;
            if (leftHorizontal === rightHorizontal) return false;
            const horizontal = leftHorizontal ? left : right;
            const vertical = leftHorizontal ? right : left;
            const x = vertical.a.x, y = horizontal.a.y;
            return x > Math.min(horizontal.a.x,horizontal.b.x)+1 && x < Math.max(horizontal.a.x,horizontal.b.x)-1 && y > Math.min(vertical.a.y,vertical.b.y)+1 && y < Math.max(vertical.a.y,vertical.b.y)-1;
          };
          const collinearOverlap = (left,right) => {
            const leftHorizontal = left.a.y === left.b.y;
            const rightHorizontal = right.a.y === right.b.y;
            if (leftHorizontal !== rightHorizontal) return false;
            if (leftHorizontal) {
              if (Math.abs(left.a.y-right.a.y)>1) return false;
              return Math.min(Math.max(left.a.x,left.b.x),Math.max(right.a.x,right.b.x))-Math.max(Math.min(left.a.x,left.b.x),Math.min(right.a.x,right.b.x))>2;
            }
            if (Math.abs(left.a.x-right.a.x)>1) return false;
            return Math.min(Math.max(left.a.y,left.b.y),Math.max(right.a.y,right.b.y))-Math.max(Math.min(left.a.y,left.b.y),Math.min(right.a.y,right.b.y))>2;
          };
          const conflictPairs = (predicate) => { const pairs = new Set(); for (let i=0;i<segments.length;i += 1) for (let j=i+1;j<segments.length;j += 1) { const left=segments[i],right=segments[j]; if (left.edgeId===right.edgeId || !predicate(left,right)) continue; pairs.add([left.edgeId,right.edgeId].sort().join(':')); } return pairs.size; };
          // Count only a segment that actually enters a foreign card's
          // interior.  Bounding-box intersection alone reports ordinary
          // endpoint-adjacent lanes as crossings, especially after the
          // React Flow viewport scale transform.
          const crossesResourceInterior = (a,b,resource) => {
            if (!a || !b || !resource) return false;
            const epsilon = 0.5;
            if (Math.abs(a.x - b.x) <= epsilon) {
              const x = a.x;
              return x > resource.x + epsilon && x < resource.right - epsilon
                && Math.max(Math.min(a.y,b.y), resource.y + epsilon) < Math.min(Math.max(a.y,b.y), resource.bottom - epsilon);
            }
            if (Math.abs(a.y - b.y) <= epsilon) {
              const y = a.y;
              return y > resource.y + epsilon && y < resource.bottom - epsilon
                && Math.max(Math.min(a.x,b.x), resource.x + epsilon) < Math.min(Math.max(a.x,b.x), resource.right - epsilon);
            }
            return true;
          };
          let foreignResourceCrossings = 0;
          for (const item of paths) {
            for (let index=1; index<item.screenPoints.length; index += 1) {
              const a=item.screenPoints[index-1], b=item.screenPoints[index];
              for (const resource of resourceRects.values()) if (resource.id!==item.source && resource.id!==item.target && crossesResourceInterior(a,b,resource.rect)) foreignResourceCrossings += 1;
            }
          }
          const minSeparations = {};
          for (const handle of handles) {
            const key = `${handle.nodeId}:${handle.type}:${handle.side}`;
            const group = handles.filter(candidate => candidate.nodeId===handle.nodeId && candidate.type===handle.type && candidate.side===handle.side).map(candidate => candidate.side==='NORTH'||candidate.side==='SOUTH' ? candidate.center.x : candidate.center.y).sort((a,b)=>a-b);
            if (group.length < 2) continue;
            let minimum = Infinity; for (let index=1; index<group.length; index += 1) minimum=Math.min(minimum,group[index]-group[index-1]);
            minSeparations[key] = Math.min(minSeparations[key] ?? Infinity, minimum);
          }
          const endpointPortErrors = [];
          for (const path of paths) {
            if (path.screenPoints.length < 2) { endpointPortErrors.push(`${path.id}:malformed`); continue; }
            const sourceHandle = handles.find(handle => handle.nodeId===path.source && handle.type==='source' && handle.interfaceId===path.sourcePort);
            const targetHandle = handles.find(handle => handle.nodeId===path.target && handle.type==='target' && handle.interfaceId===path.targetPort);
            if (sourceHandle && Math.hypot(path.screenPoints[0].x-sourceHandle.center.x,path.screenPoints[0].y-sourceHandle.center.y)>2) endpointPortErrors.push(`${path.id}:source`);
            if (targetHandle && Math.hypot(path.screenPoints.at(-1).x-targetHandle.center.x,path.screenPoints.at(-1).y-targetHandle.center.y)>2) endpointPortErrors.push(`${path.id}:target`);
          }
          let routeLengthPx=0, diagonalSegments=0, malformedPaths=0;
          for (const path of paths) {
            if (path.flowPoints.length < 2 || FINITE_NUMBER_PLACEHOLDER(path.pathData) < 4) malformedPaths += 1;
            for (let index=1; index<path.screenPoints.length; index += 1) { const a=path.screenPoints[index-1],b=path.screenPoints[index]; routeLengthPx += Math.abs(a.x-b.x)+Math.abs(a.y-b.y); if (a.x!==b.x && a.y!==b.y) diagonalSegments += 1; }
          }
          function FINITE_NUMBER_PLACEHOLDER(value) { return String(value || '').match(/-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?/gi)?.length || 0; }
          const memory = performance.memory ? {usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize,jsHeapSizeLimit:performance.memory.jsHeapSizeLimit} : 'NOT_EXPOSED';
          return {renderedResourceCount:resources.length,renderedSvgEdgeCount:paths.length,paths:paths.map(path=>({id:path.id,source:path.source,target:path.target,sourcePort:path.sourcePort,targetPort:path.targetPort,routeKind:path.routeKind,pathData:path.pathData})),handleCount:handles.length,minPortSeparationPx:minSeparations,minPortSeparationFlowPx:Object.fromEntries(Object.entries(minSeparations).map(([key,value])=>[key,value/zoom])),cableCrossingPairs:conflictPairs(properCrossing),cableOverlapPairs:conflictPairs(collinearOverlap),foreignResourceCrossings,endpointPortErrors:endpointPortErrors.length,diagonalSegments,malformedSvgPaths:malformedPaths,routeLengthPx,routeLengthFlowPx:routeLengthPx/zoom,memory,zoom};
        }"""
    )


def screenshot_name(prefix: str, viewport: tuple[int, int]) -> str:
    return f"{prefix}-{viewport[0]}x{viewport[1]}.png"


def run_linear_viewport(browser, url: str, evidence_dir: Path, item: dict[str, Any], viewport: tuple[int, int]) -> dict[str, Any]:
    density.VIEWPORT = viewport
    page, page_errors, console_errors, outside = open_page(browser, url)
    started = time.perf_counter()
    panel = None
    try:
        baseline_source = exported_source(page)
        panel, _payload, import_ms = open_import(page, ROOT / item["path"], item)
        require(panel.get_attribute("data-network-import-decision") == "NORMAL", f"{item['key']}: expected NORMAL preview")
        activation_started = time.perf_counter()
        panel.locator('[data-network-import-activate="true"]').click(timeout=CASE_TIMEOUT_MS)
        closed = wait_for_activation_outcome(page, panel)
        activation_ms = round((time.perf_counter() - activation_started) * 1000, 1)
        if not closed:
            return {"status": "FAIL", "failureKind": "ACTIVATION_BLOCKED", "builderUnchanged": close_failed_import_and_verify_builder(page, panel, baseline_source)}
        wait_for_normal_render(page, item)
        page.locator('[data-topology-camera="overview"]').click()
        page.wait_for_timeout(500)
        source_truth(exported_source(page), item)
        geometry = capture_geometry(page)
        responsiveness = event_loop_probe(page)
        screenshot = screenshot_name(f"atlas001-f5b-{item['key']}-full", viewport)
        page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
        require(not page_errors, f"{item['key']} {viewport}: page errors {page_errors!r}")
        require(not console_errors, f"{item['key']} {viewport}: console errors {console_errors!r}")
        require(not outside, f"{item['key']} {viewport}: external requests {outside!r}")
        return {"key": item["key"], "viewport": list(viewport), "status": "PASS", "importPreviewMs": import_ms, "activationToBuilderCommitMs": activation_ms, "layoutMetrics": page.evaluate("globalThis.__yadilabNetworkImportLayoutMetrics || 'NOT_EXPOSED'"), "responsiveness": responsiveness, "screenshot": screenshot, "sourceProvenanceVerified": True, "pageErrors": page_errors, "consoleErrors": console_errors, "externalRequests": outside, "caseElapsedMs": round((time.perf_counter()-started)*1000, 1), **geometry}
    except PlaywrightTimeoutError as error:
        unchanged = close_failed_import_and_verify_builder(page, panel, baseline_source) if panel is not None else "UNKNOWN"
        return {"key": item["key"], "viewport": list(viewport), "status": "FAIL", "failureKind": "TIMEOUT", "failureDiagnostic": str(error), "builderUnchanged": unchanged, "pageErrors": page_errors, "consoleErrors": console_errors, "externalRequests": outside, "caseElapsedMs": round((time.perf_counter()-started)*1000, 1)}
    finally:
        try:
            page.close(run_before_unload=False, timeout=5_000)
        except Exception:
            pass


def run_guarded_case(url: str, evidence_dir: Path, item: dict[str, Any]) -> dict[str, Any]:
    case_dir = evidence_dir / f"case-{item['key']}"
    case_dir.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, str(Path(__file__).with_name("run_atlas001_normal_connection_density_real_browser.py")), "--url", url, "--evidence-dir", str(case_dir), "--case", item["key"], "--child"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True, env=os.environ.copy())
    try:
        stdout, stderr = process.communicate(timeout=(CASE_TIMEOUT_MS + 15_000) / 1000)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
        return {"key": item["key"], "status": "FAIL", "failureKind": "PROCESS_TIMEOUT", "failureDiagnostic": f"isolated Chromium case exceeded {CASE_TIMEOUT_MS + 15_000}ms and was terminated", "builderUnchanged": "UNKNOWN"}
    evidence_path = case_dir / "atlas001-normal-connection-density.json"
    if evidence_path.exists():
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        result = next((candidate for candidate in evidence.get("results", []) if candidate.get("key") == item["key"]), None)
        if result:
            result = dict(result)
            result["guardedProcessExit"] = process.returncode
            for screenshot in case_dir.glob("*.png"):
                shutil.copy2(screenshot, evidence_dir / screenshot.name)
            return result
    return {"key": item["key"], "status": "FAIL", "failureKind": "UNKNOWN", "failureDiagnostic": (stderr or stdout or "no child evidence").strip()[-2000:], "builderUnchanged": "UNKNOWN"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    require_loopback(args.url)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    by_key = {item["key"]: item for item in manifest["cases"]}
    results: list[dict[str, Any]] = []
    failures: list[str] = []
    visual_observations: list[str] = []
    missing = [key for key in (POSITIVE, *PORT_DENSITY_NEGATIVES, *BOUNDED_CASES) if key not in by_key]
    require(not missing, f"F5B manifest missing cases: {missing}")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch_options())
        try:
            for viewport in VIEWPORTS:
                try:
                    result = run_linear_viewport(browser, args.url, args.evidence_dir, by_key[POSITIVE], viewport)
                except Exception as error:
                    result = {"key": POSITIVE, "viewport": list(viewport), "status": "ERROR", "failureDiagnostic": f"{type(error).__name__}: {error}"}
                results.append(result)
                if result.get("status") != "PASS": failures.append(f"{POSITIVE} {viewport}: expected PASS, observed {result.get('status')}")
                elif result.get("renderedResourceCount") != 200 or result.get("renderedSvgEdgeCount") != 199:
                    failures.append(f"{POSITIVE} {viewport}: rendered canonical counts changed")
                elif result.get("foreignResourceCrossings") or result.get("endpointPortErrors") or result.get("diagonalSegments") or result.get("malformedSvgPaths"):
                    failures.append(f"{POSITIVE} {viewport}: structural geometry safety metrics are non-zero")
                elif result.get("cableCrossingPairs") or result.get("cableOverlapPairs"):
                    visual_observations.append(
                        f"{POSITIVE} {viewport}: retained projection measured "
                        f"{result.get('cableCrossingPairs', 0)} cable-crossing pairs and "
                        f"{result.get('cableOverlapPairs', 0)} cable-overlap pairs; "
                        "this remains a visual F5B limitation, not a PASS claim"
                    )
            for key in PORT_DENSITY_NEGATIVES:
                result = run_guarded_case(args.url, args.evidence_dir, by_key[key])
                results.append(result)
                if result.get("status") != "FAIL" or result.get("failureKind") != "ACTIVATION_BLOCKED" or result.get("builderUnchanged") is not True:
                    failures.append(f"{key}: expected safe activation block with unchanged Builder, observed {result.get('status')}/{result.get('failureKind')}/{result.get('builderUnchanged')}")
                if not any(code in (result.get("failureCodes") or []) for code in ("TOPOLOGY_FINAL_CABLE_CROSSING", "TOPOLOGY_FINAL_CABLE_OVERLAP", "TOPOLOGY_FINAL_PORT_SEPARATION_UNSAFE")):
                    failures.append(f"{key}: no explicit final geometry blocker was recorded")
            for key in BOUNDED_CASES:
                result = run_guarded_case(args.url, args.evidence_dir, by_key[key])
                results.append(result)
                if result.get("failureKind") not in {"TIMEOUT", "PROCESS_TIMEOUT", "ACTIVATION_BLOCKED"}:
                    failures.append(f"{key}: no bounded timeout/block outcome observed")
        finally:
            browser.close()
    evidence = {
        "format": "atlas001-f5b-port-density-evidence",
        "schemaVersion": "1.0.0",
        "status": "FAIL" if failures else ("PARTIAL" if visual_observations else "PASS"),
        "phaseStatus": "F5B_BLOCKED" if failures else ("F5B_PARTIAL" if visual_observations else "F5B_PASS"),
        "prNumber": 105,
        "viewportCoverage": [list(viewport) for viewport in VIEWPORTS],
        "positiveRegression": POSITIVE,
        "portDensityNegatives": list(PORT_DENSITY_NEGATIVES),
        "boundedCases": list(BOUNDED_CASES),
        "minimumPortSeparationFlowPx": 10,
        "normalConnectionBudget": "PENDING_DECISION",
        "results": results,
        "failures": failures,
        "visualObservations": visual_observations,
        "actualBrowser": "Chromium via Playwright",
    }
    output = args.evidence_dir / "atlas001-f5b-port-density-evidence.json"
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    if failures:
        print("FAIL ATLAS-001 F5B port-density safety matrix", file=sys.stderr)
        return 1
    if visual_observations:
        print("PASS FUNCTIONAL MATRIX; F5B evidence remains PARTIAL because visual observations were recorded")
    else:
        print("PASS ATLAS-001 F5B port-density safety matrix")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

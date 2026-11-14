#!/usr/bin/env python3
"""ATLAS-001 F4B: product-level ELK Worker abort and re-import proof.

This test deliberately drives the compiled application's real network-import
file input.  It does not call the Worker adapter directly: a dense 200/1600
source must enter the product NORMAL path, reach the bounded Worker deadline
or operator Cancel, leave the active Builder untouched, and then allow a
fresh 50/49 import to complete.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import exported_source

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/import"
VIEWPORT = (1366, 768)
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TIMEOUT_MS = int(os.environ.get("ATLAS001_F4B_TIMEOUT_MS", "45_000"))
# XLSX parse/compile remain on the product main thread; the measured bound is
# intentionally separate from the 15 s ELK Worker deadline and records that
# bounded import work can produce a sub-second scheduling gap.
MAX_MAIN_THREAD_DELAY_MS = 2_000


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def manifest_case(key: str) -> dict[str, Any]:
    manifest = json.loads((FIXTURES / "atlas001-normal-density-manifest.json").read_text())
    return next(item for item in manifest["cases"] if item["key"] == key)


def fixture_path(item: dict[str, Any]) -> Path:
    return ROOT / item["path"]


def open_page(browser, url: str):
    page = browser.new_page(accept_downloads=True, viewport={"width": VIEWPORT[0], "height": VIEWPORT[1]}, device_scale_factor=1)
    page_errors: list[str] = []
    console_errors: list[str] = []
    external_requests: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("request", lambda request: external_requests.append(request.url)
            if not (request.url.startswith(url) or request.url.startswith("data:") or request.url.startswith("blob:")) else None)
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=30_000)
    return page, page_errors, console_errors, external_requests


def open_import(page, url: str, fixture: Path, expected: dict[str, Any]):
    payload = fixture.read_bytes()
    require(sha256(payload) == expected["sha256"], f'{expected["key"]}: fixture SHA changed')
    page.locator('[data-network-import-primary="true"]').click()
    panel = page.locator('[data-network-import-panel="ready"]')
    expect(panel).to_be_visible(timeout=30_000)
    panel.locator('[data-network-import-file="true"]').set_input_files({
        "name": fixture.name, "mimeType": MIME, "buffer": payload,
    })
    expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=TIMEOUT_MS)
    expect(panel).to_contain_text(f'Devices: {expected["resources"]} · Explicit links: {expected["connections"]}', timeout=TIMEOUT_MS)
    require(panel.get_attribute("data-network-import-decision") == "NORMAL", f'{expected["key"]}: expected NORMAL decision')
    return panel, payload


def event_loop_probe_start(page) -> None:
    page.evaluate("""() => {
      window.__atlas001F4BEventLoop = {ticks: 0, maxDelayMs: 0, previous: performance.now()};
      window.__atlas001F4BEventLoopTimer = setInterval(() => {
        const probe = window.__atlas001F4BEventLoop;
        const now = performance.now();
        probe.maxDelayMs = Math.max(probe.maxDelayMs, Math.max(0, now - probe.previous - 16));
        probe.previous = now;
        probe.ticks += 1;
      }, 16);
    }""")


def event_loop_probe_read(page) -> dict[str, int]:
    return page.evaluate("""() => {
      const probe = window.__atlas001F4BEventLoop || {ticks: 0, maxDelayMs: 0};
      if (window.__atlas001F4BEventLoopTimer) clearInterval(window.__atlas001F4BEventLoopTimer);
      return {ticks: probe.ticks, maxDelayMs: Math.round(probe.maxDelayMs)};
    }""")


def wait_for_worker_outcome(panel, outcome: str) -> None:
    expect(panel).to_have_attribute("data-network-import-layout-worker-outcome", outcome, timeout=TIMEOUT_MS)
    expect(panel.locator('[data-network-import-layout-status="RUNNING"]')).to_have_count(0, timeout=10_000)


def close_panel(page, panel) -> None:
    if panel.count():
        panel.get_by_role("button", name="Close network import").click()
        expect(panel).to_have_count(0, timeout=30_000)


def reimport_small(page, url: str, expected: dict[str, Any]) -> dict[str, Any]:
    panel, payload = open_import(page, url, fixture_path(expected), expected)
    panel.locator('[data-network-import-activate="true"]').click(timeout=TIMEOUT_MS)
    expect(panel).to_have_count(0, timeout=TIMEOUT_MS)
    page.wait_for_function("""(expected) => {
      const panel = document.querySelector('.topology-panel');
      return panel?.getAttribute('data-topology-edge-count') === String(expected.connections) &&
        document.querySelectorAll('.react-flow__node .resource-node').length === expected.resources &&
        document.querySelectorAll('path.react-flow__edge-path').length === expected.connections;
    }""", arg={"resources": expected["resources"], "connections": expected["connections"]}, timeout=TIMEOUT_MS)
    source = exported_source(page)
    require(len(source.get("resources", [])) == expected["resources"], "post-abort resource count changed")
    require(len(source.get("connections", [])) == expected["connections"], "post-abort connection count changed")
    require(source.get("networkImportProvenance", {}).get("source", {}).get("sha256") == expected["sha256"], "post-abort source SHA changed")
    return {"resources": expected["resources"], "connections": expected["connections"], "sha256": expected["sha256"], "payloadBytes": len(payload)}


def run_case(page, url: str, mode: str, dense: dict[str, Any], small: dict[str, Any], evidence_dir: Path) -> dict[str, Any]:
    baseline = exported_source(page)
    panel, _payload = open_import(page, url, fixture_path(dense), dense)
    event_loop_probe_start(page)
    started = time.perf_counter()
    panel.locator('[data-network-import-activate="true"]').click(timeout=TIMEOUT_MS)
    if mode == "cancel":
        expect(panel.locator('[data-network-import-layout-status="RUNNING"]')).to_be_visible(timeout=TIMEOUT_MS)
        panel.locator('[data-network-import-layout-cancel="true"]').click(timeout=10_000)
        wait_for_worker_outcome(panel, "ABORTED")
    else:
        wait_for_worker_outcome(panel, "TIMEOUT")
    elapsed = round((time.perf_counter() - started) * 1000, 1)
    worker_request = panel.get_attribute("data-network-import-layout-worker-request") or ""
    require(worker_request, f"{mode}: missing request identity")
    first_snapshot = panel.get_attribute("data-network-import-layout-worker-outcome")
    page.wait_for_timeout(500)
    require(panel.get_attribute("data-network-import-layout-worker-outcome") == first_snapshot, f"{mode}: late Worker result changed outcome")
    close_panel(page, panel)
    require(exported_source(page) == baseline, f"{mode}: active Builder changed after abort/timeout")
    small_result = reimport_small(page, url, small)
    responsiveness = event_loop_probe_read(page)
    require(responsiveness["ticks"] >= 1, f"{mode}: event loop did not tick")
    require(responsiveness["maxDelayMs"] < MAX_MAIN_THREAD_DELAY_MS, f"{mode}: main-thread delay was {responsiveness['maxDelayMs']} ms")
    screenshot = f"atlas001-f4b-{mode}-post-reimport-{VIEWPORT[0]}x{VIEWPORT[1]}.png"
    page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
    return {
        "mode": mode,
        "dense": {"key": dense["key"], "resources": dense["resources"], "connections": dense["connections"]},
        "workerOutcome": first_snapshot,
        "workerRequestId": worker_request,
        "abortOrTimeoutElapsedMs": elapsed,
        "builderUnchanged": True,
        "postAbortReimport": small_result,
        "mainThreadResponsiveness": responsiveness,
        "screenshot": screenshot,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    dense = manifest_case("200-redundant")
    small = manifest_case("50-linear")
    results: list[dict[str, Any]] = []
    failures: list[str] = []
    with sync_playwright() as playwright:
        launch: dict[str, Any] = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage", "--enable-precise-memory-info"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            for mode in ("timeout", "cancel"):
                page, page_errors, console_errors, external_requests = open_page(browser, args.url)
                try:
                    result = run_case(page, args.url, mode, dense, small, args.evidence_dir)
                    result["pageErrors"] = page_errors
                    result["consoleErrors"] = console_errors
                    result["externalRequests"] = external_requests
                    require(not page_errors, f"{mode}: page errors {page_errors!r}")
                    require(not console_errors, f"{mode}: console errors {console_errors!r}")
                    require(not external_requests, f"{mode}: external requests {external_requests!r}")
                    results.append(result)
                except Exception as error:
                    failures.append(f"{mode}: {error}")
                finally:
                    try:
                        page.close(run_before_unload=False, timeout=5_000)
                    except Exception:
                        pass
        finally:
            browser.close()
    evidence = {
        "format": "atlas001-f4b-worker-product-evidence",
        "schemaVersion": "1.0.0",
        "status": "PASS" if not failures else "FAIL",
        "prNumber": 105,
        "normalConnectionBudget": "PENDING_DECISION",
        "denseProfile": "200 resources / 1600 explicit links",
        "operationalTimeoutMs": 15_000,
        "results": results,
        "failures": failures,
    }
    (args.evidence_dir / "atlas001-f4b-worker-product.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))
    if failures:
        return 1
    print("PASS ATLAS-001 F4B product Worker abort, timeout and post-abort re-import")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

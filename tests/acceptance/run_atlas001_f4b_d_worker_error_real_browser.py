#!/usr/bin/env python3
"""ATLAS-001 F4B-D: product-path ELK Worker failure recovery.

Each case injects one deterministic failure at the browser's native Worker
boundary.  The compiled product still owns import, compile, layout validation
and Builder publication; the injection never changes normal Worker behavior
after the failure is observed.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_atlas001_f4b_c_product_real_browser import manifest_case, open_import, reimport_small
from run_ic010_p2_shared_xml_real_browser import exported_source
from run_project_file_real_browser import require


ROOT = Path(__file__).resolve().parents[2]
VIEWPORT = (1366, 768)


WORKER_FAULT_INIT = r"""
(() => {
  const NativeWorker = window.Worker;
  const state = {
    mode: "__MODE__",
    faultInstances: 0,
    nativeInstances: 0,
    terminated: 0,
    postMessages: 0,
  };
  window.__atlas001F4BDWorkerFault = state;
  const schedule = (fn) => setTimeout(fn, 0);
  const envelopeFor = (message, mode) => {
    if (mode === "envelope" && message.cmd === "layout") {
      return { ...message.__yadilabLayout, requestId: `${message.__yadilabLayout.requestId}-stale` };
    }
    return message.__yadilabLayout;
  };
  const validOutput = (graph) => {
    const children = (graph.children || []).map((node, index) => ({
      ...node,
      x: index * 260,
      y: 0,
      ports: (node.ports || []).map((port) => ({
        ...port,
        x: node.id === "a" ? (node.width || 180) - 8 : 0,
        y: 36,
      })),
    }));
    const edges = (graph.edges || []).map((edge) => ({
      ...edge,
      sections: [{
        id: `${edge.id}_s0`,
        startPoint: { x: 180, y: 40 },
        endPoint: { x: 260, y: 40 },
      }],
    }));
    return { ...graph, children, edges };
  };
  function FaultWorker(url, mode) {
    this.url = url;
    this.mode = mode;
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    state.faultInstances += 1;
  }
  FaultWorker.prototype.postMessage = function (message) {
    if (this.terminated) return;
    state.postMessages += 1;
    const self = this;
    if (this.mode === "runtime" && message.cmd === "layout") {
      schedule(() => self.onerror?.({ message: "F4B-D simulated Worker runtime failure" }));
      return;
    }
    const envelope = envelopeFor(message, this.mode);
    if (message.cmd === "register") {
      schedule(() => self.onmessage?.({ data: { id: message.id, data: {}, __yadilabLayout: envelope } }));
      return;
    }
    if (message.cmd !== "layout") return;
    let data = validOutput(message.graph || {});
    if (this.mode === "malformed") {
      data = { ...data, children: [{ id: "bad", x: Number.NaN, y: 0, width: 1, height: 1, ports: [] }], edges: [] };
    } else if (this.mode === "incomplete") {
      data = { ...data, edges: (message.graph?.edges || []).map((edge) => ({ ...edge, sections: [] })) };
    }
    schedule(() => self.onmessage?.({ data: { id: message.id, data, __yadilabLayout: envelope } }));
  };
  FaultWorker.prototype.terminate = function () {
    if (this.terminated) return;
    this.terminated = true;
    state.terminated += 1;
  };
  function F4BDWorker(url, options) {
    const mode = state.mode;
    if (mode === "blocked") throw new Error("F4B-D simulated missing Worker script");
    if (mode === "none") {
      state.nativeInstances += 1;
      return new NativeWorker(url, options);
    }
    return new FaultWorker(url, mode);
  }
  F4BDWorker.prototype = NativeWorker.prototype;
  Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: F4BDWorker });
})();
"""


def open_fault_page(browser, url: str, mode: str):
    context = browser.new_context(service_workers="block", accept_downloads=True, viewport={"width": VIEWPORT[0], "height": VIEWPORT[1]})
    page = context.new_page()
    page.add_init_script(WORKER_FAULT_INIT.replace('"__MODE__"', json.dumps(mode)))
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=45_000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=30_000)
    return context, page


def topology_snapshot(page) -> dict:
    panel = page.locator("[data-topology-edge-count]")
    return {
        "panelCount": panel.count(),
        "edgeCount": panel.get_attribute("data-topology-edge-count") if panel.count() else None,
        "nodeCount": page.locator(".react-flow__node .resource-node").count(),
        "edgePathCount": page.locator("path.react-flow__edge-path").count(),
    }


def run_case(page, mode: str, expected: str, label: str) -> dict:
    dense = manifest_case("50-linear")
    baseline = exported_source(page)
    before_topology = topology_snapshot(page)
    panel, _payload = open_import(page, dense)
    panel.locator('[data-network-import-activate="true"]').click(timeout=45_000)
    expect(panel.locator('[data-network-import-layout-status="RUNNING"]')).to_have_count(0, timeout=45_000)
    outcome = panel.get_attribute("data-network-import-layout-worker-outcome")
    require(outcome == "ERROR", f"{label}: expected ERROR outcome, got {outcome!r}")
    diagnostic = panel.locator('[role="alert"]').text_content(timeout=10_000) or ""
    panel_text = panel.text_content() or ""
    require(expected in diagnostic or expected in panel_text, f"{label}: expected diagnostic {expected}, got {diagnostic!r}")
    require(exported_source(page) == baseline, f"{label}: active Builder changed after Worker failure")
    after_topology = topology_snapshot(page)
    require(after_topology == before_topology, f"{label}: partial topology was published: {before_topology} -> {after_topology}")
    page.evaluate("window.__atlas001F4BDWorkerFault.mode = 'none'")
    panel.locator('[aria-label="Close network import"]').click()
    expect(panel).to_have_count(0, timeout=30_000)
    recovered = reimport_small(page, dense)
    state = page.evaluate("window.__atlas001F4BDWorkerFault")
    require(state["nativeInstances"] >= 1, f"{label}: valid recovery did not create a native Worker")
    if mode != "blocked":
        require(state["terminated"] >= 1, f"{label}: failed Worker was not terminated")
    return {
        "status": "PASS",
        "mode": mode,
        "workerOutcome": outcome,
        "diagnostic": diagnostic,
        "builderUnchanged": True,
        "partialLayoutPublished": False,
        "workerTerminated": state["terminated"],
        "nativeWorkersAfterRecovery": state["nativeInstances"],
        "postFailureReimport": recovered,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and parsed.port and parsed.path == "/", "loopback compiled app required")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    cases = [
        ("blocked", "LAYOUT_WORKER_UNAVAILABLE", "blocked-script"),
        ("runtime", "LAYOUT_WORKER_RUNTIME_ERROR", "runtime-error"),
        ("envelope", "LAYOUT_WORKER_ENVELOPE_INVALID", "identity-envelope"),
        ("malformed", "TOPOLOGY_LAYOUT_ELK_INVALID_NODE", "malformed-result"),
        ("incomplete", "TOPOLOGY_LAYOUT_EDGE_SECTION_MISSING", "incomplete-result"),
    ]
    results = {}
    page_errors = []
    console_errors = []
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage", "--enable-precise-memory-info"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            for mode, expected, label in cases:
                context, page = open_fault_page(browser, args.url, mode)
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
                try:
                    results[label] = run_case(page, mode, expected, label)
                finally:
                    page.close(run_before_unload=False)
                    context.close()
        finally:
            browser.close()
    evidence = {
        "format": "atlas001-f4b-d-worker-error-product-evidence",
        "schemaVersion": "1.0.0",
        "status": "PASS" if not page_errors and not console_errors else "FAIL",
        "prNumber": 105,
        "cases": results,
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
        "normalConnectionBudget": "PENDING_DECISION",
    }
    output = args.evidence_dir / "atlas001-f4b-d-worker-error-product-evidence.json"
    output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))
    require(not page_errors and not console_errors, "compiled browser reported page/console errors")
    print("PASS ATLAS-001 F4B-D product Worker error recovery")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

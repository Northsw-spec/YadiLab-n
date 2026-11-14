#!/usr/bin/env python3
"""ATLAS-001 F4B-C: final product Worker safety regressions.

This acceptance file deliberately exercises the compiled application, not the
Worker adapter in isolation.  It keeps the stress cases bounded and records
SAFE_BLOCKED/TIMEOUT_CONTROLLED distinctly instead of treating either as a
successful full-graph render.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from run_ic010_p2_shared_xml_real_browser import exported_source
from run_project_file_real_browser import MOCK, fill_value, require

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/import"
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
VIEWPORT = (1366, 768)
TIMEOUT_MS = int(os.environ.get("ATLAS001_F4B_C_TIMEOUT_MS", "45_000"))
MAX_MAIN_THREAD_DELAY_MS = 2_000


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def manifest_case(key: str) -> dict:
    manifest = json.loads((FIXTURES / "atlas001-normal-density-manifest.json").read_text())
    return next(item for item in manifest["cases"] if item["key"] == key)


def open_page(browser, url: str, mock_files: bool = False):
    context = browser.new_context(
        service_workers="block",
        accept_downloads=True,
    )
    page = context.new_page()
    if mock_files:
        page.add_init_script(MOCK)
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=45_000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=30_000)
    return context, page


def open_import(page, item: dict):
    fixture = ROOT / item["path"]
    payload = fixture.read_bytes()
    require(sha256(payload) == item["sha256"], f"{item['key']}: fixture SHA changed")
    page.locator('[data-network-import-primary="true"]').click()
    panel = page.locator('[data-network-import-panel="ready"]')
    expect(panel).to_be_visible(timeout=30_000)
    panel.locator('[data-network-import-file="true"]').set_input_files({
        "name": fixture.name,
        "mimeType": MIME,
        "buffer": payload,
    })
    expect(panel.locator('[data-network-import-preview="READY"]')).to_be_visible(timeout=TIMEOUT_MS)
    expect(panel).to_contain_text(
        f"Devices: {item['resources']} · Explicit links: {item['connections']}",
        timeout=TIMEOUT_MS,
    )
    require(panel.get_attribute("data-network-import-decision") == "NORMAL", f"{item['key']}: not NORMAL")
    return panel, payload


def start_probe(page) -> None:
    page.evaluate("""() => {
      window.__f4bCProbe = {ticks: 0, maxDelayMs: 0, previous: performance.now()};
      window.__f4bCTimer = setInterval(() => {
        const probe = window.__f4bCProbe;
        const now = performance.now();
        probe.maxDelayMs = Math.max(probe.maxDelayMs, Math.max(0, now - probe.previous - 16));
        probe.previous = now;
        probe.ticks += 1;
      }, 16);
    }""")


def read_probe(page) -> dict:
    return page.evaluate("""() => {
      const probe = window.__f4bCProbe || {ticks: 0, maxDelayMs: 0};
      if (window.__f4bCTimer) clearInterval(window.__f4bCTimer);
      return {ticks: probe.ticks, maxDelayMs: Math.round(probe.maxDelayMs)};
    }""")


def close_panel(page, panel) -> None:
    if panel.count():
        button = panel.get_by_role("button", name="Close network import")
        if button.count():
            expect(button).to_be_enabled(timeout=30_000)
            button.click()
            expect(panel).to_have_count(0, timeout=30_000)


def reimport_small(page, item: dict) -> dict:
    panel, payload = open_import(page, item)
    panel.locator('[data-network-import-activate="true"]').click(timeout=TIMEOUT_MS)
    expect(panel).to_have_count(0, timeout=TIMEOUT_MS)
    page.wait_for_function("""(expected) => {
      const panel = document.querySelector('.topology-panel');
      return panel?.getAttribute('data-topology-edge-count') === String(expected.connections)
        && document.querySelectorAll('.react-flow__node .resource-node').length === expected.resources
        && document.querySelectorAll('path.react-flow__edge-path').length === expected.connections;
    }""", arg={"resources": item["resources"], "connections": item["connections"]}, timeout=TIMEOUT_MS)
    source = exported_source(page)
    require(len(source.get("resources", [])) == item["resources"], "post-recovery resource count changed")
    require(len(source.get("connections", [])) == item["connections"], "post-recovery connection count changed")
    require(source.get("networkImportProvenance", {}).get("source", {}).get("sha256") == item["sha256"], "post-recovery source SHA changed")
    return {"resources": item["resources"], "connections": item["connections"], "sha256": item["sha256"], "payloadBytes": len(payload)}


def run_100_800(page, evidence_dir: Path) -> dict:
    dense = manifest_case("100-redundant")
    small = manifest_case("50-linear")
    baseline = exported_source(page)
    panel, _payload = open_import(page, dense)
    start_probe(page)
    started = time.perf_counter()
    panel.locator('[data-network-import-activate="true"]').click(timeout=TIMEOUT_MS)
    expect(panel.locator('[data-network-import-layout-status="RUNNING"]')).to_have_count(0, timeout=TIMEOUT_MS)
    elapsed = round((time.perf_counter() - started) * 1000, 1)
    outcome = panel.get_attribute("data-network-import-layout-worker-outcome")
    # Chromium 1187 can return an empty inner_text for an alert whose text is
    # visually present while a bounded Worker failure is settling. The DOM
    # text content is the stable evidence channel across the pinned Chromium
    # versions used locally and in CI.
    diagnostic = panel.locator('[role="alert"]').text_content(timeout=10_000) or ""
    require(outcome == "TIMEOUT", f"100/800 expected Worker TIMEOUT, got {outcome!r}")
    require("LAYOUT_TIMEOUT_ABORTED" in diagnostic, "100/800 timeout diagnostic was not preserved")
    require(panel.get_attribute("data-network-import-layout-worker-serialization-ms") not in (None, ""), "missing serialization metric")
    require(panel.get_attribute("data-network-import-layout-worker-start-ms") not in (None, ""), "missing Worker-start metric")
    worker_metrics = {
        "serializationMs": panel.get_attribute("data-network-import-layout-worker-serialization-ms"),
        "workerStartMs": panel.get_attribute("data-network-import-layout-worker-start-ms"),
        "roundTripMs": panel.get_attribute("data-network-import-layout-worker-roundtrip-ms"),
        "validationMs": panel.get_attribute("data-network-import-layout-worker-validation-ms"),
    }
    close_panel(page, panel)
    require(exported_source(page) == baseline, "100/800 timeout changed active Builder")
    recovered = reimport_small(page, small)
    responsiveness = read_probe(page)
    require(responsiveness["ticks"] >= 1, "100/800 event loop did not tick")
    require(responsiveness["maxDelayMs"] < MAX_MAIN_THREAD_DELAY_MS, "100/800 main-thread bound exceeded")
    screenshot = "atlas001-f4b-c-100-800-timeout-recovery.png"
    page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
    return {
        "status": "TIMEOUT_CONTROLLED",
        "profile": {"key": dense["key"], "resources": dense["resources"], "connections": dense["connections"]},
        "workerOutcome": outcome,
        "elapsedMs": elapsed,
        "builderUnchanged": True,
        "postAbortReimport": recovered,
        "mainThreadResponsiveness": responsiveness,
        "workerMetrics": worker_metrics,
        "screenshot": screenshot,
    }


def run_project_switch(page, evidence_dir: Path) -> dict:
    dense = manifest_case("200-redundant")
    small = manifest_case("50-linear")
    old_source = exported_source(page)
    old_frame = page.locator(".app-frame")
    old_id = old_frame.get_attribute("data-runtime-scenario-id")
    old_generation = old_frame.get_attribute("data-project-generation")
    panel, _payload = open_import(page, dense)
    panel.locator('[data-network-import-activate="true"]').click(timeout=TIMEOUT_MS)
    expect(panel.locator('[data-network-import-layout-status="RUNNING"]')).to_be_visible(timeout=10_000)
    page.locator('[data-project-action="new"]').evaluate("element => element.click()")
    expect(panel).to_have_count(0, timeout=30_000)
    page.wait_for_function("""(previous) => {
      const frame = document.querySelector('.app-frame');
      return frame && frame.getAttribute('data-runtime-scenario-id') !== previous.id
        && frame.getAttribute('data-project-generation') !== previous.generation;
    }""", arg={"id": old_id, "generation": old_generation}, timeout=30_000)
    page.wait_for_timeout(750)
    new_source = exported_source(page)
    require(new_source != old_source, "New project did not replace the old Builder source")
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id") != old_id, "old project identity survived New")
    # New projects are intentionally unpersisted; the next explicit import
    # must acknowledge the existing manual Save/Open discard guard.
    page.once("dialog", lambda dialog: dialog.accept())
    recovered = reimport_small(page, small)
    screenshot = "atlas001-f4b-c-project-switch-recovery.png"
    page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
    return {
        "status": "PASS",
        "oldScenarioId": old_id,
        "oldProjectGeneration": old_generation,
        "newScenarioId": page.locator(".app-frame").get_attribute("data-runtime-scenario-id"),
        "newProjectGeneration": page.locator(".app-frame").get_attribute("data-project-generation"),
        "lateWorkerDidNotPublish": True,
        "postSwitchReimport": recovered,
        "screenshot": screenshot,
    }


def run_builder_edit(page, evidence_dir: Path) -> dict:
    dense = manifest_case("200-redundant")
    baseline = exported_source(page)
    panel, _payload = open_import(page, dense)
    panel.locator('[data-network-import-activate="true"]').click(timeout=TIMEOUT_MS)
    expect(panel.locator('[data-network-import-layout-status="RUNNING"]')).to_be_visible(timeout=10_000)
    title = page.locator('[data-builder-inspector="mission"] label.inspector-field input').first
    page.evaluate("""() => {
      const details = document.querySelector('[data-builder-inspector="mission"]')?.closest('details');
      if (details) details.open = true;
    }""")
    expect(title).to_be_visible(timeout=15_000)
    fill_value(title, "F4B-C edit during Worker layout")
    controls = page.locator('[data-project-file-controls="ready"]')
    expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15_000)
    panel.locator('[data-network-import-layout-cancel="true"]').click(timeout=10_000)
    expect(panel).to_have_attribute("data-network-import-layout-worker-outcome", "ABORTED", timeout=15_000)
    close_panel(page, panel)
    expect(title).to_have_value("F4B-C edit during Worker layout")
    expect(controls).to_have_attribute("data-project-pending-drafts", "true")
    screenshot = "atlas001-f4b-c-builder-edit-cancel.png"
    page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator('[data-builder-inspector="mission"]').get_by_role("button", name="Förkasta inspektörsutkast").click()
    expect(controls).to_have_attribute("data-project-pending-drafts", "false", timeout=15_000)
    require(exported_source(page) == baseline, "Builder canonical source changed during cancelled layout")
    return {
        "status": "PASS",
        "builderCanonicalSourceUnchanged": True,
        "unappliedDraftRetained": True,
        "workerOutcome": "ABORTED",
        "screenshot": screenshot,
    }


def run_save_open(page, evidence_dir: Path) -> dict:
    dense = manifest_case("200-redundant")
    small = manifest_case("50-linear")
    controls = page.locator('[data-project-file-controls="ready"]')
    controls.locator('[data-project-action="save-as"]').click()
    expect(controls.locator('[data-project-message="true"]')).to_contain_text("Saved and read back", timeout=30_000)
    writes_before = page.evaluate("window.__yadilabProjectStore.writes")
    panel, _payload = open_import(page, dense)
    panel.locator('[data-network-import-activate="true"]').click(timeout=TIMEOUT_MS)
    expect(panel.locator('[data-network-import-layout-status="RUNNING"]')).to_be_visible(timeout=10_000)
    panel.locator('[data-network-import-layout-cancel="true"]').click(timeout=10_000)
    expect(panel).to_have_attribute("data-network-import-layout-worker-outcome", "ABORTED", timeout=15_000)
    close_panel(page, panel)
    controls.locator('[data-project-action="save"]').click()
    expect(controls.locator('[data-project-message="true"]')).to_contain_text("Saved and read back", timeout=30_000)
    require(page.evaluate("window.__yadilabProjectStore.writes") == writes_before + 1, "Save after Cancel was not verified")
    controls.locator('[data-project-action="open"]').click()
    expect(controls.locator('[data-project-message="true"]')).to_contain_text("Opened editable source", timeout=30_000)
    recovered = reimport_small(page, small)
    screenshot = "atlas001-f4b-c-save-open-recovery.png"
    page.screenshot(path=str(evidence_dir / screenshot), full_page=True)
    return {
        "status": "PASS_MOCK_FILE_SYSTEM",
        "saveAfterCancelVerified": True,
        "openAfterCancelVerified": True,
        "postOpenReimport": recovered,
        "durableDiskWrite": "NOT_PROVEN_BY_BROWSER_MOCK",
        "screenshot": screenshot,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and parsed.port and parsed.path == "/", "loopback compiled app required")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    page_errors: list[str] = []
    console_errors: list[str] = []
    results: dict[str, object] = {}
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage", "--enable-precise-memory-info"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            for name, runner, mock in (
                ("product100_800", run_100_800, False),
                ("projectSwitch", run_project_switch, False),
                ("builderEdit", run_builder_edit, False),
                ("saveOpen", run_save_open, True),
            ):
                context, page = open_page(browser, args.url, mock_files=mock)
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
                try:
                    results[name] = runner(page, args.evidence_dir)
                finally:
                    page.close(run_before_unload=False)
                    context.close()
        finally:
            browser.close()
    evidence = {
        "format": "atlas001-f4b-c-product-evidence",
        "schemaVersion": "1.0.0",
        "status": "PASS" if not page_errors and not console_errors else "FAIL",
        "prNumber": 105,
        "results": results,
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
        "normalConnectionBudget": "PENDING_DECISION",
    }
    (args.evidence_dir / "atlas001-f4b-c-product-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))
    if page_errors or console_errors:
        return 1
    print("PASS ATLAS-001 F4B-C product Worker verification")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

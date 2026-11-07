#!/usr/bin/env python3
"""GRAPHML-P2C: REAL Chromium+Playwright acceptance against the actual built YadiLab UI.

No test doubles, source scans, mocked DOM, or test-only crypto shims. This
tests actual user events and exported Builder JSON on a loopback origin.
Never mark the test PASS if Chromium/Playwright/server is unavailable.
"""
import argparse
import hashlib
import json
from pathlib import Path
import os
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/import/graphml"


def require(condition, detail):
    if not condition:
        raise AssertionError(detail)


def open_dialog(page):
    page.locator(".workspace-menu > summary", has_text="Import / Export").click()
    page.locator('[data-inspect-graphml="PREVIEW_ONLY"]').click()
    page.locator('[data-graphml-panel="PREVIEW_ONLY"]').wait_for(timeout=15000)


def choose(page, filename):
    page.locator('[data-graphml-file="true"]').set_input_files(str(FIXTURES / filename))


def wait_preview(page):
    page.locator('[data-graphml-mapping="REVIEW_REQUIRED"]').wait_for(timeout=12000)
    require(page.locator('[data-graphml-preview="REVIEW_REQUIRED"]').count() == 1,
            "validated graph preview not displayed")


def close_dialog(page):
    page.locator('[data-graphml-cancel="true"]').click()
    page.locator('[data-graphml-panel]').wait_for(state="detached", timeout=10000)


def assert_base(page, base_id):
    require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id") == base_id,
            "active workspace changed before explicit reviewed confirmation")


def export_scenario(page):
    # The menu may still be open after closing the GraphML dialog.
    # Clicking an already-open details summary would CLOSE it and hide export.
    menu = page.locator(".workspace-menu", has=page.locator("summary", has_text="Import / Export"))
    require(menu.count() == 1, "expected exactly one Import / Export menu")
    if menu.get_attribute("open") is None:
        menu.locator("summary").click()
    export = menu.get_by_role("button", name="Exportera källfil")
    export.wait_for(state="visible", timeout=10000)
    with page.expect_download(timeout=20000) as download:
        export.click()
    return json.loads(Path(download.value.path()).read_text())


def case_cancel(browser, url):
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
        base = page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
        open_dialog(page)
        choose(page, "valid-two-nodes.graphml")
        wait_preview(page)
        require(page.locator('[data-graphml-source-hash]').inner_text().endswith(
            hashlib.sha256((FIXTURES / "valid-two-nodes.graphml").read_bytes()).hexdigest()
        ), "source hash not independently verified")
        require(page.locator('[data-graphml-role="0"]').input_value() == "resource.generic",
                "GraphML roles must default to generic")
        require(page.locator('[data-graphml-edge-decision="0"]').is_checked() is False,
                "No edges should be selected by default")
        page.locator('[data-graphml-role="0"]').select_option("network.router")
        page.locator('[data-graphml-edge-decision="0"]').check()
        require(page.locator('[data-graphml-map-confirm]').is_disabled(),
                "Selected edge must require independent acknowledgement")
        close_dialog(page)
        assert_base(page, base)
        assert not errors, f"browser JS errors during cancelled GraphML: {errors}"
        return {"case": "cancel", "status": "PASS", "workspaceUnchanged": True}
    finally:
        page.close()


def case_malicious(browser, url):
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
        base = page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
        open_dialog(page)
        choose(page, "invalid-wrong-namespace.graphml")
        err = page.locator('[data-graphml-error="BLOCKED"]')
        err.wait_for(timeout=12000)
        require("GRAPHML_" in err.inner_text(), "wrong namespace must produce a diagnostic")
        require(page.locator('[data-graphml-map-confirm]').count() == 0, "malformed source must have no confirmation")
        assert_base(page, base)
        choose(page, "adversarial-xxe.graphml")
        page.locator('[data-graphml-error="BLOCKED"]').wait_for(timeout=12000)
        require("DTD" in page.locator('[data-graphml-error]').inner_text().upper()
                or "DOCTYPE" in page.locator('[data-graphml-error]').inner_text().upper(),
                "DTD/XXE must be blocked and labelled")
        assert_base(page, base)
        close_dialog(page)
        assert_base(page, base)
        assert not errors, f"browser JS errors during hostile GraphML: {errors}"
        return {"case": "hostile", "status": "PASS", "workspaceUnchanged": True}
    finally:
        page.close()


def case_confirm(browser, url, select_edge):
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
        base = page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
        open_dialog(page)
        choose(page, "valid-two-nodes.graphml")
        wait_preview(page)
        assert_base(page, base)
        require(page.locator('[data-graphml-edge-decision="0"]').is_checked() is False,
                "graph relation unexpectedly preselected")
        page.locator('[data-graphml-role="0"]').select_option("network.router")
        page.locator('[data-graphml-role="1"]').select_option("network.switch")
        if select_edge:
            page.locator('[data-graphml-edge-decision="0"]').check()
            require(page.locator('[data-graphml-map-confirm]').is_disabled(), "edge consent not enforced")
            page.locator('[data-graphml-edge-ack="true"]').check()
        require(page.locator('[data-graphml-map-confirm]').is_enabled(), "valid reviewed draft cannot be confirmed")
        page.locator('[data-graphml-map-confirm]').click()
        page.locator('[data-graphml-panel]').wait_for(state="detached", timeout=35000)
        page.wait_for_function(
            'document.querySelector(".app-frame")?.getAttribute("data-runtime-scenario-id") === "graphml_reviewed"',
            timeout=15000)
        require(page.locator(".app-frame").get_attribute("data-runtime-scenario-hash") == "builder",
                "GraphML import must NOT activate a Runtime")
        scenario = export_scenario(page)
        resources = scenario["resources"]
        require(len(resources) == 2, "expected exact two reviewed resources")
        require([r["type"] for r in resources] == ["network.router", "network.switch"],
                "reviewed roles not faithfully exported")
        edges = scenario["connections"]
        require(len(edges) == (1 if select_edge else 0),
                "unselected GraphML graph edge converted to a network link")
        if select_edge:
            edge = edges[0]
            require((edge["from"]["resource"], edge["to"]["resource"]) ==
                    ("graph_node_1", "graph_node_2"), "selected source endpoints were not preserved")
            require(edge["properties"] == {}, "fabricated connectivity property was introduced")
        require(scenario["completion"].get("path") == "graphml_manual_verification",
                "tautological auto-green verification objective leaked")
        require(not any("VERIFIED" in str(r.get("properties", {})) for r in resources),
                "import must not assert an independently verified topology")
        require(not errors, f"browser JS errors during reviewed GraphML import: {errors}")
        return {"case": "confirm_link" if select_edge else "confirm_nodes_only",
                "status": "PASS", "resources": len(resources),
                "modeledConnections": len(edges), "runtimeActivated": False}
    finally:
        page.close()


def case_directed(browser, url):
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    try:
        page.goto(url, wait_until="domcontentloaded")
        page.locator('[data-network-import-primary="true"]').wait_for(timeout=25000)
        base = page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
        open_dialog(page)
        choose(page, "valid-mixed-directed.graphml")
        wait_preview(page)
        require(not page.locator('[data-graphml-edge-decision="0"]').is_disabled(),
                "explicitly undirected override should be selectable")
        require(page.locator('[data-graphml-edge-decision="1"]').is_disabled(),
                "directed graph edge must never be coerced into an undirected link")
        close_dialog(page)
        assert_base(page, base)
        assert not errors, f"browser JS errors during directed-edge rejection: {errors}"
        return {"case": "directed", "status": "PASS", "coercionBlocked": True}
    finally:
        page.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--evidence-dir", type=Path, required=True)
    args = ap.parse_args()
    require(args.url.startswith("http://127.0.0.1:") and args.url.endswith("/"),
            "real browser acceptance must use loopback origin only")
    from urllib.parse import urlparse
    parsed = urlparse(args.url)
    require(parsed.hostname == "127.0.0.1" and parsed.port is not None and parsed.path == "/",
            "noncanonical loopback URL is forbidden")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        # Browser downloaded in CI and running as an actual headless Chromium process.
        chromium_args = ["--disable-dev-shm-usage", "--disable-background-networking"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            chromium_args.append("--no-sandbox")
        browser = playwright.chromium.launch(headless=True, args=chromium_args)
        try:
            for test in (case_cancel, case_malicious,
                         lambda b, u: case_confirm(b, u, False),
                         lambda b, u: case_confirm(b, u, True), case_directed):
                outcome = test(browser, args.url)
                results.append(outcome)
                print("PASS real Chromium GraphML:", outcome["case"], flush=True)
        finally:
            browser.close()
    os_release = Path("/etc/os-release")
    os_identity = "UNKNOWN"
    if os_release.exists():
        for line in os_release.read_text().splitlines():
            if line.startswith("PRETTY_NAME="):
                os_identity = line.partition("=")[2].strip().strip('"')
                break
    report = {"status": "PASS", "testType": "real Chromium UI + actual compiled YadiLab bundle",
              "platform": os_identity, "cases": results}
    path = args.evidence_dir / "graphml-p2c-real-browser-acceptance.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL GRAPHML-P2C real browser acceptance: {exc}", file=sys.stderr)
        raise

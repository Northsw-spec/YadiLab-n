#!/usr/bin/env python3
"""PROJECT-083: topology hosts expose an explicit click-to-diagnose path."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def start_lab(page, scenario_id):
    page.locator('[data-guided-lab-catalog="wave1"]').select_option(scenario_id)
    page.locator('[data-guided-lab-start="direct"]').click()
    page.wait_for_function(
        "scenario => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id') === scenario",
        arg=scenario_id,
        timeout=45000,
    )


def open_probe_panel(page):
    panel = page.locator('[data-active-probe-engine="wave2"]')
    if panel.get_attribute("open") is None:
        panel.locator("summary").click()
    expect(panel).to_have_attribute("open", "", timeout=10000)
    return panel


def field(panel, label_text):
    labels = panel.locator("label.inspector-field")
    for index in range(labels.count()):
        label = labels.nth(index)
        if label.inner_text().splitlines()[0].strip() == label_text:
            return label.locator("select")
    raise AssertionError(f"Missing field: {label_text}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(
        target.scheme == "http"
        and target.hostname == "127.0.0.1"
        and target.port
        and target.path == "/"
        and not target.query
        and not target.fragment,
        "PROJECT-083 must exercise the compiled app on loopback",
    )
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    errors = []
    evidence = {}
    with sync_playwright() as playwright:
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        launch = {"headless": True, "args": flags}
        executable = os.environ.get("YADILAB_CHROMIUM_EXECUTABLE")
        if executable:
            launch["executable_path"] = executable
        browser = playwright.chromium.launch(**launch)
        try:
            context = browser.new_context(service_workers="block", viewport={"width": 1280, "height": 900})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=30000)

            # A normal topology selection remains selection-only until the
            # learner explicitly invokes the contextual diagnose action.
            start_lab(page, "guided_win_gateway")
            client = page.locator('.react-flow__node[data-id="client1"]')
            client.click()
            expect(page.locator('[data-diagnose-from-source="client1"]')).to_be_visible(timeout=10000)
            require(page.locator('[data-diagnose-from-source="r1"]').count() == 0,
                    "Router received a misleading diagnose-from-host action")
            evidence["ordinarySelection"] = {"selected": "client1", "contextualAction": True, "routerAction": False}

            # Explicit action opens the existing panel, selects/focuses the
            # exact source, and performs no probe by itself.
            page.locator('[data-diagnose-from-source="client1"]').click()
            panel = open_probe_panel(page)
            source = panel.locator('[data-active-probe-source="client1"]')
            expect(source).to_have_value("client1")
            expect(source).to_be_focused()
            require(panel.locator('[data-active-probe-transcript="ready"]').count() == 0,
                    "Click-to-diagnose ran a probe automatically")
            evidence["explicitDiagnose"] = {"panelOpen": True, "source": "client1", "sourceFocused": True, "autoProbe": False}

            # Manual source choice is authoritative; a later ordinary topology
            # selection must not overwrite it.
            field(panel, "Källvärd").select_option("server1")
            page.locator('.react-flow__node[data-id="client1"]').click()
            expect(panel.locator('[data-active-probe-source="server1"]')).to_have_value("server1")
            evidence["manualSourcePreserved"] = {"manualSource": "server1", "laterTopologySelection": "client1"}

            # Switch scenario and repeat on Linux to cover reset/scenario
            # identity guards and the second supported host family.
            start_lab(page, "guided_linux_gateway")
            require(page.locator('[data-active-probe-source="server1"]').count() == 0,
                    "Scenario switch retained the old source selector")
            linux = page.locator('.react-flow__node[data-id="client1"]')
            linux.click()
            expect(page.locator('[data-diagnose-from-source="client1"]')).to_be_visible(timeout=10000)
            page.locator('[data-diagnose-from-source="client1"]').click()
            linux_panel = open_probe_panel(page)
            expect(linux_panel.locator('[data-active-probe-source="client1"]')).to_have_value("client1")
            require(linux_panel.locator('[data-active-probe-transcript="ready"]').count() == 0,
                    "Linux click-to-diagnose ran a probe automatically")
            evidence["scenarioGuard"] = {"scenario": "guided_linux_gateway", "source": "client1", "platform": "linux", "autoProbe": False}

            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence.update({"status": "PASS", "pageErrors": []})
            (args.evidence_dir / "project083-click-to-diagnose.json").write_text(
                json.dumps(evidence, indent=2) + "\n"
            )
            print("PASS PROJECT-083: topology click-to-diagnose uses the existing Active Probe panel")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

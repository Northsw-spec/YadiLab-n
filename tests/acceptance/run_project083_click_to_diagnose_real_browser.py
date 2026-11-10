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


def field_value(panel, label_text, control="input"):
    labels = panel.locator("label.inspector-field")
    for index in range(labels.count()):
        label = labels.nth(index)
        if label.inner_text().splitlines()[0].strip() == label_text:
            return label.locator(control)
    raise AssertionError(f"Missing field: {label_text}")


def click_host(page, source_id):
    node = page.locator(f'.react-flow__node[data-id="{source_id}"]')
    node.scroll_into_view_if_needed()
    node.click()
    expect(page.locator(f'[data-diagnose-from-source="{source_id}"]')).to_be_visible(timeout=10000)


def run_probe(page, probe_id, expected_truth, source_id="client1", destination_id="server1", port=None, save=True):
    panel = open_probe_panel(page)
    field(panel, "Källvärd").select_option(source_id)
    field(panel, "Aktiv probe").select_option(probe_id)
    if destination_id:
        field(panel, "Destination").select_option(destination_id)
    if port is not None:
        field_value(panel, "TCP port").fill(str(port))
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    transcript = panel.locator('[data-active-probe-transcript="ready"]')
    expect(transcript).to_contain_text(f"verdict {expected_truth}", timeout=15000)
    if save:
        transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript


def runtime_revision(page, revision):
    expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text(
        f"Tillståndsrevision: {revision}", timeout=15000
    )


def apply_gateway_remediation(page):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    panel.locator("summary").click() if panel.get_attribute("open") is None else None
    field(panel, "Target").select_option("client1")
    field(panel, "Typed remediation action").select_option("change_default_gateway")
    field_value(panel, "Gateway IPv4 address").fill("10.78.1.1")
    panel.get_by_role("button", name="Preview remediation").click()
    expect(panel).to_contain_text("0 → 1", timeout=10000)
    panel.get_by_role("button", name="Commit remediation").click()
    expect(panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)


def open_inspector(page):
    inspector = page.locator("details.inspector-disclosure")
    inspector.evaluate("el => { el.open = true; }")
    return inspector


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
            click_host(page, "client1")
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

            # Full gateway proof: the result must come from the current Engine
            # and be attached to the current scenario/revision and journey.
            before = run_probe(page, "windows.ping", "FALSE", save=False)
            expect(before).to_have_attribute("data-active-probe-scenario-id", "guided_win_gateway")
            require(before.get_attribute("data-active-probe-scenario-hash"), "Missing scenario hash on failed probe")
            expect(before).to_contain_text("Runtime revision 0")
            expect(page.locator('[data-visual-journey="ready"]')).to_be_visible(timeout=15000)
            before.get_by_role("button", name="Spara evidens i anteckningar").click()
            notebook = page.locator('[data-troubleshooting-notebook="v0.75"]')
            notebook.evaluate("el => { el.open = true; }")
            expect(notebook.locator('[data-notebook-entry="active_probe"]')).to_have_count(1, timeout=15000)
            expect(notebook.locator('[data-notebook-entry="active_probe"]').first).to_contain_text("FALSE")
            expect(notebook.locator('[data-notebook-entry="active_probe"]').first).to_contain_text("Runtime rev 0")
            runtime_revision(page, 0)
            evidence["gatewayBefore"] = {
                "source": "client1", "destination": "server1", "probe": "windows.ping",
                "engine": "FALSE", "runtimeRevision": 0, "visualJourney": True,
            }

            apply_gateway_remediation(page)
            runtime_revision(page, 1)
            require(page.locator('[data-runtime-panel="progress"]').inner_text().find("10.78.1.1") == -1,
                    "Runtime progress exposed a stale or hidden remediation mutation")

            after = run_probe(page, "windows.ping", "TRUE", save=True)
            expect(after).to_have_attribute("data-active-probe-scenario-id", "guided_win_gateway")
            expect(after).to_contain_text("Runtime revision 1")
            expect(notebook.locator('[data-notebook-entry="active_probe"]')).to_have_count(2, timeout=15000)
            summary = page.locator('[data-troubleshooting-summary="v0.82"]')
            expect(summary.locator('[data-troubleshooting-summary-status]')).to_have_attribute(
                "data-troubleshooting-summary-status", "VERIFIED_IMPROVEMENT", timeout=15000
            )
            expect(summary).to_contain_text("FALSE → TRUE")
            evidence["gatewayAfter"] = {
                "engine": "TRUE", "runtimeRevision": 1, "notebookProbeEntries": 2,
                "reportStatus": "VERIFIED_IMPROVEMENT",
            }

            # Manual source choice is authoritative; a later ordinary topology
            # selection must not overwrite it.
            field(panel, "Källvärd").select_option("server1")
            click_host(page, "client1")
            expect(panel.locator('[data-active-probe-source="server1"]')).to_have_value("server1")
            evidence["manualSourcePreserved"] = {"manualSource": "server1", "laterTopologySelection": "client1"}

            # Runtime links remain selectable and expose their semantic
            # inspector, but never get a host-only diagnostic action.
            edge = page.locator('.react-flow__edge[data-id="client_r1"]')
            edge.scroll_into_view_if_needed()
            edge.click()
            inspector = open_inspector(page)
            expect(inspector.locator("pre.inspector")).to_contain_text('"id": "client_r1"')
            require(page.locator('[data-diagnose-from-source]').count() == 0,
                    "Runtime link exposed a host diagnostic action")
            evidence["runtimeLinkSelection"] = {"id": "client_r1", "diagnoseAction": False}

            # Explicitly selecting the host again still works after a link;
            # clicking empty canvas clears selection without mutation.
            click_host(page, "client1")
            page.locator('[data-diagnose-from-source="client1"]').click()
            expect(open_probe_panel(page).locator('[data-active-probe-source="client1"]')).to_have_value("client1")
            pane = page.locator(".react-flow__pane")
            pane.scroll_into_view_if_needed()
            pane.click(position={"x": 20, "y": 20})
            expect(page.locator(".side-panel .status-grid").first).to_contain_text("Vald\n—")
            evidence["paneClear"] = True

            # Switch scenario and run the actual Linux SSH TCP/22 probe. The
            # interpretation must preserve service-vs-policy-vs-unknown truth.
            start_lab(page, "guided_linux_ssh")
            require(page.locator('[data-active-probe-source="server1"]').count() == 0,
                    "Scenario switch retained the old source selector")
            require(page.locator('[data-active-probe-transcript="ready"]').count() == 0,
                    "Scenario switch retained an old active-probe transcript")
            click_host(page, "client1")
            page.locator('[data-diagnose-from-source="client1"]').click()
            linux_panel = open_probe_panel(page)
            expect(linux_panel.locator('[data-active-probe-source="client1"]')).to_have_value("client1")
            require(linux_panel.locator('[data-active-probe-transcript="ready"]').count() == 0,
                    "Linux click-to-diagnose ran a probe automatically")
            ssh = run_probe(page, "linux.nc_tcp", "FALSE", source_id="client1", destination_id="server1", port=22, save=False)
            expect(ssh).to_have_attribute("data-active-probe-scenario-id", "guided_linux_ssh")
            expect(ssh).to_contain_text("Runtime revision 0")
            expect(page.locator('[data-tcp-probe-interpretation="SERVICE_DISABLED"]')).to_contain_text("tjänst", timeout=15000)
            require("POLICY_BLOCKED" not in page.locator('[data-tcp-probe-interpretation="SERVICE_DISABLED"]').inner_text(),
                    "Service-disabled interpretation claimed policy blocking")
            evidence["linuxSsh"] = {"scenario": "guided_linux_ssh", "source": "client1", "destination": "server1", "port": 22, "engine": "FALSE", "interpretation": "SERVICE_DISABLED"}

            # Reset is a new run: no old transcript or source request leaks.
            page.get_by_role("button", name="Återställ scenario").click()
            runtime_revision(page, 0)
            require(page.locator('[data-active-probe-transcript="ready"]').count() == 0,
                    "Reset retained an old Linux transcript")
            click_host(page, "client1")
            page.locator('[data-diagnose-from-source="client1"]').click()
            expect(open_probe_panel(page).locator('[data-active-probe-source="client1"]')).to_have_value("client1")
            evidence["reset"] = {"revision": 0, "transcriptCleared": True, "diagnosticSource": "client1"}

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

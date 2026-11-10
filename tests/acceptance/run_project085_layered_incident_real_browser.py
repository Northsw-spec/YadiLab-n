#!/usr/bin/env python3
"""PROJECT-085: layered Linux incident proof through real Chromium."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def open_details(page, selector):
    page.locator(selector).evaluate("el => { el.open = true; }")


def field(panel, label_text, control="select"):
    labels = panel.locator("label.inspector-field")
    for index in range(labels.count()):
        label = labels.nth(index)
        if label.inner_text().splitlines()[0].strip() == label_text:
            return label.locator(control)
    raise AssertionError(f"Missing field: {label_text}")


def start_lab(page, scenario_id):
    page.locator('[data-guided-lab-catalog="wave1"]').select_option(scenario_id)
    page.locator('[data-guided-lab-start="direct"]').click()
    page.wait_for_function(
        "scenario => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id') === scenario",
        arg=scenario_id,
        timeout=45000,
    )
    open_details(page, '[data-guided-troubleshooting="v0.77"]')


def click_to_diagnose(page, source_id):
    node = page.locator(f'.react-flow__node[data-id="{source_id}"]')
    node.scroll_into_view_if_needed()
    node.click()
    action = page.locator(f'[data-diagnose-from-source="{source_id}"]')
    expect(action).to_be_visible(timeout=10000)
    action.click()
    panel = page.locator('[data-active-probe-engine="wave2"]')
    open_details(page, '[data-active-probe-engine="wave2"]')
    expect(field(panel, "Källvärd")).to_have_value(source_id)
    expect(field(panel, "Källvärd")).to_be_focused()
    require(panel.locator('[data-active-probe-transcript="ready"]').count() == 0, "click-to-diagnose ran a probe automatically")
    return panel


def run_probe(page, probe_id, expected_truth, save=True, source_id="client1", destination_id="server1", port=None):
    panel = page.locator('[data-active-probe-engine="wave2"]')
    open_details(page, '[data-active-probe-engine="wave2"]')
    field(panel, "Källvärd").select_option(source_id)
    field(panel, "Aktiv probe").select_option(probe_id)
    if destination_id:
        field(panel, "Destination").select_option(destination_id)
    if port is not None:
        field(panel, "TCP port", "input").fill(str(port))
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    transcript = panel.locator('[data-active-probe-transcript="ready"]')
    expect(transcript).to_contain_text(f"verdict {expected_truth}", timeout=15000)
    if save:
        transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript


def run_observation(page, target_id, command_id, expected_text):
    panel = page.locator('[data-observation-engine="wave1"]')
    open_details(page, '[data-observation-engine="wave1"]')
    field(panel, "Mål").select_option(target_id)
    field(panel, "Modellerat kommando").select_option(command_id)
    panel.get_by_role("button", name="Kör modellerad observation").click()
    transcript = panel.locator('[data-observation-transcript="ready"]')
    expect(transcript).to_contain_text(expected_text, timeout=15000)
    transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript


def add_hypothesis(page, text):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    field(panel, "Learner note", "textarea").fill(text)
    panel.get_by_role("button", name="Add note to proof chain").click()


def apply_remediation(page, target_id, action_id, value=None):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    field(panel, "Target").select_option(target_id)
    field(panel, "Typed remediation action").select_option(action_id)
    if action_id == "change_default_gateway":
        field(panel, "Gateway IPv4 address", "input").fill(value)
    elif action_id == "set_service_enabled":
        field(panel, "Service").select_option("ssh")
        field(panel, "Service state").select_option(value)
    else:
        raise AssertionError(f"Unsupported action {action_id}")
    panel.get_by_role("button", name="Preview remediation").click()
    expect(panel).to_contain_text("0 → 1", timeout=10000)
    panel.get_by_role("button", name="Commit remediation").click()
    expect(panel.locator('[data-notebook-entry="remediation_action"]').first).to_be_visible(timeout=15000)


def revision(page, number):
    expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text(
        f"Tillståndsrevision: {number}", timeout=15000
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and target.port and target.path == "/" and not target.query and not target.fragment,
            "PROJECT-085 must exercise compiled app on loopback")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    errors = []
    evidence = {}
    with sync_playwright() as playwright:
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        launch = {"headless": True, "args": flags}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        browser = playwright.chromium.launch(**launch)
        try:
            context = browser.new_context(service_workers="block", viewport={"width": 390, "height": 844})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=30000)

            # Scenario A: click-to-diagnose, gateway first, then SSH.
            start_lab(page, "guided_linux_layered_ssh")
            probe_panel = click_to_diagnose(page, "client1")
            expect(probe_panel.locator('[data-active-probe-source="client1"]')).to_have_value("client1")
            run_observation(page, "client1", "linux.ip_route", "Modeled default gateway")
            run_probe(page, "linux.ping", "FALSE")
            run_observation(page, "server1", "linux.systemctl_status", "sshd: inactive")
            run_probe(page, "linux.nc_tcp", "FALSE", port=22)
            add_hypothesis(page, "Nätvägen kan ha fel gateway.")
            apply_remediation(page, "client1", "change_default_gateway", "10.78.5.1")
            revision(page, 1)
            run_probe(page, "linux.ping", "TRUE")
            run_probe(page, "linux.nc_tcp", "FALSE", port=22)
            summary = page.locator('[data-troubleshooting-summary="v0.82"]')
            expect(summary).to_contain_text("Slutfört labb: FALSE", timeout=15000)
            check = page.locator('[data-next-check]')
            expect(check).to_contain_text("Fortsätt")
            expect(check).to_contain_text("Förbered samma TCP-test igen")
            expect(check).not_to_contain_text("Granska verifieringsresultatet")
            add_hypothesis(page, "Gatewayen är nu verifierad; SSH-tjänsten kan fortfarande vara avstängd.")
            apply_remediation(page, "server1", "set_service_enabled", "true")
            revision(page, 2)
            run_probe(page, "linux.nc_tcp", "TRUE", port=22)
            run_probe(page, "linux.ping", "TRUE")
            expect(summary).to_contain_text("Slutfört labb: TRUE", timeout=15000)
            expect(summary.locator('[data-troubleshooting-summary-status]')).to_have_attribute("data-troubleshooting-summary-status", "VERIFIED_IMPROVEMENT", timeout=15000)
            expect(page.locator('[data-guided-phase="VERIFICATION_COMPLETE"]')).to_be_visible(timeout=15000)
            evidence["gatewayFirst"] = {"initial": ["FALSE", "FALSE"], "afterGateway": ["TRUE", "FALSE"], "final": ["TRUE", "TRUE"]}

            # Undo both operations and prove the Engine returns to both faults.
            page.get_by_role("button", name="Ångra").click()
            revision(page, 1)
            expect(summary).to_contain_text("Slutfört labb: FALSE", timeout=15000)
            page.get_by_role("button", name="Ångra").click()
            revision(page, 0)
            run_probe(page, "linux.ping", "FALSE", save=False)
            run_probe(page, "linux.nc_tcp", "FALSE", save=False, port=22)
            evidence["undo"] = {"revision": 0, "matrix": ["FALSE", "FALSE"]}

            # Scenario B: same authored fault, SSH remediation first.
            page.get_by_role("button", name="Återställ scenario").click()
            revision(page, 0)
            run_observation(page, "server1", "linux.systemctl_status", "sshd: inactive")
            run_probe(page, "linux.nc_tcp", "FALSE", port=22)
            add_hypothesis(page, "SSH-tjänsten kan vara avstängd.")
            apply_remediation(page, "server1", "set_service_enabled", "true")
            revision(page, 1)
            run_probe(page, "linux.nc_tcp", "FALSE", port=22)
            run_observation(page, "client1", "linux.ip_route", "Modeled default gateway")
            run_probe(page, "linux.ping", "FALSE")
            add_hypothesis(page, "Efter tjänstekontrollen kvarstår ett separat gatewayfel.")
            apply_remediation(page, "client1", "change_default_gateway", "10.78.5.1")
            revision(page, 2)
            run_probe(page, "linux.nc_tcp", "TRUE", port=22)
            run_probe(page, "linux.ping", "TRUE")
            expect(summary).to_contain_text("Slutfört labb: TRUE", timeout=15000)
            evidence["sshFirst"] = {"afterSsh": ["FALSE", "FALSE"], "final": ["TRUE", "TRUE"]}

            # Reset/switch must clear the layered notebook and expose no hidden solution.
            page.get_by_role("button", name="Återställ scenario").click()
            revision(page, 0)
            require(page.locator('[data-notebook-entry]').count() == 0, "reset retained layered notebook entries")
            start_lab(page, "guided_linux_ssh")
            require("canonicalSolution" not in page.locator("body").inner_text(), "UI exposed canonical solution material")
            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence.update({"status": "PASS", "viewport": {"width": 390, "height": 844}, "pageErrors": []})
            (args.evidence_dir / "project085-layered-incident.json").write_text(json.dumps(evidence, indent=2) + "\n")
            print("PASS PROJECT-085: layered incident remains incomplete after one repair and completes after both")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

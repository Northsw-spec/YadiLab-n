#!/usr/bin/env python3
"""PROJECT-081: first-click and next-step navigation through real Chromium."""
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
    panel = page.locator(selector)
    if panel.get_attribute("open") is None:
        panel.locator("summary").click()
    expect(panel).to_have_attribute("open", "", timeout=10000)
    return panel


def field(panel, label_text, control="select"):
    labels = panel.locator("label.inspector-field")
    for index in range(labels.count()):
        label = labels.nth(index)
        if label.inner_text().splitlines()[0].strip() == label_text:
            return label.locator(control)
    raise AssertionError(f"Missing field: {label_text}")


def start_selected_lab(page, scenario_id):
    page.locator('[data-guided-lab-catalog="wave1"]').select_option(scenario_id)
    button = page.locator('[data-guided-lab-start="direct"]')
    expect(button).to_be_visible()
    expect(button).to_contain_text("Starta valt labb")
    button.click()
    page.wait_for_function(
        "scenario => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id') === scenario",
        arg=scenario_id,
        timeout=45000,
    )


def click_next_tool(page, tool):
    guided = open_details(page, '[data-guided-troubleshooting="v0.77"]')
    button = guided.locator(f'[data-guided-next-tool="{tool}"]')
    expect(button).to_be_visible(timeout=15000)
    button.click()
    selectors = {
        "observations": '[data-observation-engine="wave1"]',
        "probes": '[data-active-probe-engine="wave2"]',
        "notebook": '[data-troubleshooting-notebook="v0.75"]',
        "remediation": '[data-troubleshooting-notebook="v0.75"]',
    }
    panel = open_details(page, selectors[tool])
    expect(panel.locator("select, textarea, button:not([disabled])").first).to_be_focused()
    expect(guided.locator('[data-guided-navigation-feedback="true"]')).to_contain_text(
        "öppnades", timeout=10000
    )
    return panel


def run_observation(page, target_id, command_id, expected_text):
    panel = open_details(page, '[data-observation-engine="wave1"]')
    field(panel, "Mål").select_option(target_id)
    field(panel, "Modellerat kommando").select_option(command_id)
    panel.get_by_role("button", name="Kör modellerad observation").click()
    transcript = panel.locator('[data-observation-transcript="ready"]')
    expect(transcript).to_contain_text(expected_text, timeout=15000)
    transcript.get_by_role("button", name="Spara evidens i anteckningar").click()


def run_probe(page, probe_id, expected_truth):
    panel = open_details(page, '[data-active-probe-engine="wave2"]')
    field(panel, "Källvärd").select_option("client1")
    field(panel, "Aktiv probe").select_option(probe_id)
    field(panel, "Destination").select_option("server1")
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    transcript = panel.locator('[data-active-probe-transcript="ready"]')
    expect(transcript).to_contain_text(f"verdict {expected_truth}", timeout=15000)
    transcript.get_by_role("button", name="Spara evidens i anteckningar").click()


def add_hypothesis(page):
    panel = open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    field(panel, "Learner note", "textarea").fill(
        "Routing evidence points to the client default gateway; I will test that hypothesis."
    )
    panel.get_by_role("button", name="Add note to proof chain").click()


def apply_gateway_remediation(page):
    panel = open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    field(panel, "Target").select_option("client1")
    field(panel, "Typed remediation action").select_option("change_default_gateway")
    field(panel, "Gateway IPv4 address", "input").fill("10.78.1.1")
    panel.get_by_role("button", name="Preview remediation").click()
    expect(panel).to_contain_text("0 → 1", timeout=10000)
    panel.get_by_role("button", name="Commit remediation").click()
    expect(panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)


def workflow_phase(page, phase):
    guided = open_details(page, '[data-guided-troubleshooting="v0.77"]')
    expect(guided.locator(f'[data-guided-phase="{phase}"]')).to_be_visible(timeout=15000)


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
        "PROJECT-081 must exercise the compiled app on loopback",
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
            require(page.locator('[data-curriculum-wave]').count() == 0, "Welcome page showed guided curriculum")

            # P1: select + direct Starta valt labb, without opening Lab & Scenario.
            page.locator('[data-guided-lab-catalog="wave1"]').select_option("guided_win_gateway")
            direct_start = page.locator('[data-guided-lab-start="direct"]')
            expect(direct_start).to_be_visible()
            expect(direct_start).to_contain_text("Windows · fel standard-gateway")
            direct_start.click()
            page.wait_for_function(
                "() => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id') === 'guided_win_gateway'",
                timeout=45000,
            )
            expect(page.locator('[data-curriculum-wave]')).to_contain_text("Inbyggd guidad labb 1/8")
            evidence["directStartActions"] = 2

            # P2: guidance opens the existing workspace and focuses the next control.
            workflow_phase(page, "COLLECT_EVIDENCE")
            click_next_tool(page, "observations")
            run_observation(page, "client1", "windows.route_print", "default")
            click_next_tool(page, "probes")
            run_probe(page, "windows.ping", "FALSE")
            workflow_phase(page, "FORM_HYPOTHESIS")
            click_next_tool(page, "notebook")
            add_hypothesis(page)
            workflow_phase(page, "REMEDIATE")
            click_next_tool(page, "remediation")
            apply_gateway_remediation(page)
            workflow_phase(page, "COLLECT_AFTER_EVIDENCE")
            click_next_tool(page, "probes")
            run_probe(page, "windows.ping", "TRUE")
            workflow_phase(page, "VERIFICATION_COMPLETE")
            evidence["gateway"] = {
                "before": "windows.ping FALSE",
                "after": "windows.ping TRUE",
                "remediation": "change_default_gateway client1 -> 10.78.1.1",
            }

            # Reset clears proof and returns guidance to the new run's first phase.
            page.get_by_role("button", name="Återställ scenario").click()
            expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text(
                "Tillståndsrevision: 0", timeout=15000
            )
            workflow_phase(page, "COLLECT_EVIDENCE")
            notebook = open_details(page, '[data-troubleshooting-notebook="v0.75"]')
            expect(notebook.locator('[data-notebook-entry]')).to_have_count(0, timeout=10000)
            evidence["reset"] = "COLLECT_EVIDENCE, revision 0, empty notebook"

            # Scenario switch clears the old lab context and does not reuse its transcript.
            start_selected_lab(page, "guided_win_dns")
            expect(page.locator('[data-curriculum-wave]')).to_contain_text("Inbyggd guidad labb 2/8")
            expect(page.locator('[data-curriculum-wave]')).to_contain_text("DNS:")
            workflow_phase(page, "COLLECT_EVIDENCE")
            require(page.locator('[data-active-probe-transcript="ready"]').count() == 0,
                    "Scenario switch retained an old active-probe transcript")
            evidence["scenarioSwitch"] = "guided_win_dns with fresh COLLECT_EVIDENCE"

            # Keyboard/focus and narrow viewport: the direct start remains usable.
            page.set_viewport_size({"width": 390, "height": 844})
            direct_start = page.locator('[data-guided-lab-start="direct"]')
            expect(direct_start).to_be_visible()
            box = direct_start.bounding_box()
            require(box and box["width"] <= 390, "Direct start control overflows narrow viewport")
            selector = page.locator('[data-guided-lab-catalog="wave1"]')
            selector.focus()
            page.keyboard.press("Tab")
            expect(direct_start).to_be_focused()
            evidence["narrowViewport"] = {"width": 390, "keyboardFocus": True}

            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence.update({"status": "PASS", "pageErrors": []})
            (args.evidence_dir / "project081-first-click.json").write_text(
                json.dumps(evidence, indent=2) + "\n"
            )
            print("PASS PROJECT-081: direct lab start and actionable next-step navigation")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

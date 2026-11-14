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
        expect(label).to_be_visible(timeout=15000)
        title = label.evaluate("el => Array.from(el.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || '').join(' ').trim()")
        if title == label_text:
            return label.locator(control)
    raise AssertionError(f"Missing field: {label_text}")


def fill_value(control, value):
    control.fill(value)
    if control.input_value() != value:
        control.evaluate(
            """(element, nextValue) => {
                const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
                setter.call(element, nextValue);
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }""",
            value,
        )


def choose(control, value):
    expect(control.locator(f'option[value="{value}"]')).to_have_count(1, timeout=120000)
    return control.select_option(value)


def start_lab(page, scenario_id):
    choose(page.locator('[data-guided-lab-catalog="wave1"]'), scenario_id)
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
    choose(field(panel, "Källvärd"), source_id)
    choose(field(panel, "Aktiv probe"), probe_id)
    if destination_id:
        choose(field(panel, "Destination"), destination_id)
    if port is not None:
        fill_value(field(panel, "TCP port", "input"), str(port))
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    transcript = panel.locator('[data-active-probe-transcript="ready"]')
    expect(transcript).to_contain_text(f"verdict {expected_truth}", timeout=15000)
    if save:
        transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript


def run_observation(page, target_id, command_id, expected_text):
    panel = page.locator('[data-observation-engine="wave1"]')
    open_details(page, '[data-observation-engine="wave1"]')
    choose(field(panel, "Mål"), target_id)
    choose(field(panel, "Modellerat kommando"), command_id)
    panel.get_by_role("button", name="Kör modellerad observation").click()
    transcript = panel.locator('[data-observation-transcript="ready"]')
    expect(transcript).to_contain_text(expected_text, timeout=15000)
    transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript


def add_hypothesis(page, text):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    fill_value(field(panel, "Learner note", "textarea"), text)
    panel.get_by_role("button", name="Add note to proof chain").click()


def apply_remediation(page, target_id, action_id, value=None):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    choose(field(panel, "Target"), target_id)
    choose(field(panel, "Typed remediation action"), action_id)
    if action_id == "change_default_gateway":
        fill_value(field(panel, "Gateway IPv4 address", "input"), value)
    elif action_id == "set_service_enabled":
        choose(field(panel, "Service"), "ssh")
        choose(field(panel, "Service state"), value)
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


def require_phase(page, phase):
    marker = page.locator(f'[data-guided-phase="{phase}"]')
    expect(marker).to_have_count(1, timeout=15000)
    require((marker.text_content() or "").strip() == phase, f"Unexpected workflow phase marker for {phase}")


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
            expect(summary).to_contain_text("Slutfört labb: TRUE", timeout=15000)
            expect(page.locator('[data-guided-phase="VERIFICATION_COMPLETE"]')).not_to_be_visible(timeout=15000)
            final_check = page.locator('[data-next-check]')
            expect(final_check).to_contain_text("Verifiera återstående funktion")
            expect(final_check).to_contain_text("Förbered ICMP-kontroll")
            final_check.get_by_role("button", name="Förbered ICMP-kontroll").click()
            expect(field(probe_panel, "Aktiv probe")).to_have_value("linux.ping")
            expect(field(probe_panel, "Destination")).to_have_value("server1")
            require(probe_panel.locator('[data-active-probe-transcript="ready"]').count() == 0, "final-probe preparation executed or retained a transcript")
            run_probe(page, "linux.ping", "TRUE")
            expect(summary).to_contain_text("Slutfört labb: TRUE", timeout=15000)
            expect(summary.locator('[data-troubleshooting-summary-status]')).to_have_attribute("data-troubleshooting-summary-status", "VERIFIED_IMPROVEMENT", timeout=15000)
            require_phase(page, "VERIFICATION_COMPLETE")
            expect(summary.locator('[data-summary-action]')).to_have_count(2, timeout=15000)
            expect(summary.locator('[data-summary-remediation-verification]')).to_have_count(2, timeout=15000)
            expect(summary.locator('[data-summary-final-verification]')).to_have_attribute("data-summary-final-verification", "TRUE")
            expect(summary).to_contain_text("Change default gateway")
            expect(summary).to_contain_text("Enable or disable service")
            markdown = summary.locator('[data-summary-markdown]')
            markdown_text = markdown.input_value()
            require("Genomförda åtgärder" in markdown_text and "Change default gateway" in markdown_text and "Enable or disable service" in markdown_text, "downloadable report omitted one remediation")
            with page.expect_download() as download_info:
                summary.get_by_role("button", name="Ladda ner sammanfattning (.md)").click()
            downloaded = download_info.value
            downloaded_text = Path(downloaded.path()).read_text()
            require("Change default gateway" in downloaded_text and "Enable or disable service" in downloaded_text and "Slutfört labb: TRUE" in downloaded_text, "downloaded Markdown omitted the complete incident chain")
            evidence["gatewayFirst"] = {"initial": ["FALSE", "FALSE"], "afterGateway": ["TRUE", "FALSE"], "completionBeforeFinalIcmp": "TRUE", "final": ["TRUE", "TRUE"], "actionsInReport": 2}

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
            run_probe(page, "linux.ping", "FALSE", save=False)
            require(page.locator('[data-active-probe-transcript="ready"]').count() == 1, "reset control probe was not produced")
            start_lab(page, "guided_linux_ssh")
            require(page.locator('[data-active-probe-transcript="ready"]').count() == 0, "scenario switch retained stale layered transcript")
            require("canonicalSolution" not in (page.locator("body").text_content() or ""), "UI exposed canonical solution material")
            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence.update({"status": "PASS", "viewport": {"width": 390, "height": 844}, "pageErrors": []})
            (args.evidence_dir / "project085-layered-incident.json").write_text(json.dumps(evidence, indent=2) + "\n")
            print("PASS PROJECT-085: layered incident remains incomplete after one repair and completes after both")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

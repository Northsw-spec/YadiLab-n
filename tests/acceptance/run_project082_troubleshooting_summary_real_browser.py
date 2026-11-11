#!/usr/bin/env python3
"""PROJECT-082: proof-oriented IT handoff summary through real Chromium."""
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
    button = page.locator('[data-guided-lab-start="direct"]')
    expect(button).to_be_visible()
    button.click()
    page.wait_for_function(
        "scenario => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id') === scenario",
        arg=scenario_id,
        timeout=45000,
    )


def summary(page):
    panel = page.locator('[data-troubleshooting-summary="v0.82"]')
    expect(panel).to_be_visible(timeout=15000)
    return panel


def wait_summary_status(page, expected):
    panel = summary(page)
    status = panel.locator('[data-troubleshooting-summary-status]')
    expect(status).to_have_attribute("data-troubleshooting-summary-status", expected, timeout=15000)
    return panel


def run_observation(page, target_id, command_id, expected_text):
    panel = page.locator('[data-observation-engine="wave1"]')
    open_details(page, '[data-observation-engine="wave1"]')
    choose(field(panel, "Mål"), target_id)
    choose(field(panel, "Modellerat kommando"), command_id)
    panel.get_by_role("button", name="Kör modellerad observation").click()
    transcript = panel.locator('[data-observation-transcript="ready"]')
    expect(transcript).to_contain_text(expected_text, timeout=15000)
    transcript.get_by_role("button", name="Spara evidens i anteckningar").click()


def run_probe(page, probe_id, expected_truth, save=True):
    panel = page.locator('[data-active-probe-engine="wave2"]')
    open_details(page, '[data-active-probe-engine="wave2"]')
    choose(field(panel, "Källvärd"), "client1")
    choose(field(panel, "Aktiv probe"), probe_id)
    if probe_id == "windows.ping":
        choose(field(panel, "Destination"), "server1")
    elif probe_id == "linux.nc_tcp":
        choose(field(panel, "Destination"), "server1")
        fill_value(field(panel, "TCP port", "input"), "22")
    else:
        fill_value(field(panel, "DNS-namn", "input"), "app.lab.test")
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    transcript = panel.locator('[data-active-probe-transcript="ready"]')
    expect(transcript).to_contain_text(f"verdict {expected_truth}", timeout=15000)
    if save:
        transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript.text_content() or ""


def add_hypothesis(page, text):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    fill_value(field(panel, "Learner note", "textarea"), text)
    panel.get_by_role("button", name="Add note to proof chain").click()


def apply_remediation(page, target_id, action_id, value):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    choose(field(panel, "Target"), target_id)
    choose(field(panel, "Typed remediation action"), action_id)
    if action_id == "set_windows_network_profile":
        choose(field(panel, "Windows network profile"), value)
    else:
        raise AssertionError(f"Unsupported acceptance action: {action_id}")
    panel.get_by_role("button", name="Preview remediation").click()
    expect(panel).to_contain_text("0 → 1", timeout=10000)
    panel.get_by_role("button", name="Commit remediation").click()
    expect(panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)


def reset(page):
    page.get_by_role("button", name="Återställ scenario").click()
    expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text("Tillståndsrevision: 0", timeout=15000)
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    expect(panel.locator("[data-notebook-entry]")).to_have_count(0, timeout=10000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and target.port and target.path == "/" and not target.query and not target.fragment, "PROJECT-082 must exercise the compiled app on loopback")
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
            context = browser.new_context(service_workers="block", permissions=["clipboard-read", "clipboard-write"], viewport={"width": 1280, "height": 900})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=30000)

            # Positive Gateway proof and IT handoff.
            start_lab(page, "guided_win_gateway")
            wait_summary_status(page, "INSUFFICIENT_EVIDENCE")
            run_observation(page, "client1", "windows.route_print", "default")
            run_probe(page, "windows.ping", "FALSE")
            add_hypothesis(page, "Klientens standard-gateway kan vara felaktig.")
            panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
            choose(field(panel, "Target"), "client1")
            choose(field(panel, "Typed remediation action"), "change_default_gateway")
            fill_value(field(panel, "Gateway IPv4 address", "input"), "10.78.1.1")
            panel.get_by_role("button", name="Preview remediation").click()
            expect(panel).to_contain_text("0 → 1", timeout=10000)
            panel.get_by_role("button", name="Commit remediation").click()
            expect(panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)
            run_probe(page, "windows.ping", "TRUE")
            report = wait_summary_status(page, "VERIFIED_IMPROVEMENT")
            expect(report).to_contain_text("FALSE → TRUE")
            expect(report.locator('[data-summary-verification="RESTORED"]')).to_be_visible()
            markdown = report.locator('[data-summary-markdown="true"]').input_value()
            expect(report.locator('[data-summary-copy="true"]')).to_be_visible()
            report.locator('[data-summary-copy="true"]').click()
            expect(report.locator('[data-summary-copy-feedback="true"]')).to_contain_text("kopierades", timeout=10000)
            copied = page.evaluate("navigator.clipboard.readText()")
            require(copied == markdown, "Clipboard text differed from visible report model")
            with page.expect_download() as download_info:
                report.locator('[data-summary-download="true"]').click()
            download = download_info.value
            downloaded_path = args.evidence_dir / download.suggested_filename
            download.save_as(str(downloaded_path))
            require(downloaded_path.read_text() == markdown, "Markdown download differed from visible report model")
            evidence["gateway"] = {"status": "VERIFIED_IMPROVEMENT", "copyMatches": True, "downloadMatches": True}

            # Undo must restore the fault and make the old verification historical.
            page.get_by_role("button", name="Ångra").click()
            expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text("Tillståndsrevision: 0", timeout=15000)
            require("FALSE" in run_probe(page, "windows.ping", "FALSE", save=False), "Undo did not restore the failed gateway probe")
            historical = wait_summary_status(page, "HISTORICAL_VERIFIED_NEEDS_RECHECK")
            expect(historical).to_contain_text("Ny verifiering behövs")
            historical_markdown = historical.locator('[data-summary-markdown="true"]').input_value()
            require("Historisk förbättring" in historical_markdown, "Markdown did not carry the historical status")
            historical.locator('[data-summary-copy="true"]').click()
            expect(historical.locator('[data-summary-copy-feedback="true"]')).to_contain_text("kopierades", timeout=10000)
            require(page.evaluate("navigator.clipboard.readText()") == historical_markdown, "Undo clipboard text differed from visible historical report")
            with page.expect_download() as historical_download_info:
                historical.locator('[data-summary-download="true"]').click()
            historical_download = historical_download_info.value
            historical_download_path = args.evidence_dir / f"after-undo-{historical_download.suggested_filename}"
            historical_download.save_as(str(historical_download_path))
            require(historical_download_path.read_text() == historical_markdown, "Undo Markdown download differed from visible historical report")
            evidence["gateway"]["afterUndo"] = {"status": "HISTORICAL_VERIFIED_NEEDS_RECHECK", "copyMatches": True, "downloadMatches": True}

            # Reset and scenario switch must clear the current report identity.
            reset(page)
            wait_summary_status(page, "INSUFFICIENT_EVIDENCE")
            require("FALSE → TRUE" not in summary(page).locator('[data-summary-markdown="true"]').input_value(), "Reset left stale gateway verification in summary")
            start_lab(page, "guided_win_dns")
            wait_summary_status(page, "INSUFFICIENT_EVIDENCE")
            run_probe(page, "windows.resolve_dnsname", "UNKNOWN")
            add_hypothesis(page, "Resolvern behöver undersökas vidare.")
            apply_remediation(page, "client1", "set_windows_network_profile", "public")
            run_probe(page, "windows.resolve_dnsname", "UNKNOWN")
            dns_report = wait_summary_status(page, "NO_VERIFIED_IMPROVEMENT")
            require("VERIFIED_IMPROVEMENT" not in (dns_report.text_content() or ""), "UNKNOWN DNS result was presented as verified success")
            expect(dns_report).to_contain_text("UNKNOWN")
            evidence["dns"] = {"status": "NO_VERIFIED_IMPROVEMENT", "unknownPreserved": True}

            # Other fault category: Linux SSH evidence is shown without a fabricated diagnosis.
            start_lab(page, "guided_linux_ssh")
            wait_summary_status(page, "INSUFFICIENT_EVIDENCE")
            run_observation(page, "server1", "linux.systemctl_status", "sshd: inactive")
            run_probe(page, "linux.nc_tcp", "FALSE")
            ssh_report = wait_summary_status(page, "INVESTIGATION_IN_PROGRESS")
            expect(ssh_report).to_contain_text("sshd: inactive")
            require("canonicalSolution" not in ssh_report.locator('[data-summary-markdown="true"]').input_value(), "Summary exposed hidden solution material")
            evidence["linuxSsh"] = {"status": "INVESTIGATION_IN_PROGRESS", "serviceEvidence": True}

            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence.update({"status": "PASS", "pageErrors": []})
            (args.evidence_dir / "project082-troubleshooting-summary.json").write_text(json.dumps(evidence, indent=2) + "\n")
            print("PASS PROJECT-082: evidence-derived troubleshooting summary supports IT handoff")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""PROJECT-084: evidence-backed next-check guidance through real Chromium."""
import argparse
import json
import os
import re
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


def guided(page):
    panel = page.locator('[data-guided-troubleshooting="v0.77"]')
    expect(panel).to_be_visible(timeout=15000)
    return panel


def next_check(page):
    panel = guided(page).locator('[data-next-check]')
    expect(panel).to_be_visible(timeout=15000)
    return panel


def save_transcript(panel, selector):
    transcript = panel.locator(selector)
    expect(transcript).to_be_visible(timeout=15000)
    transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript


def run_observation(page):
    panel = page.locator('[data-observation-engine="wave1"]')
    open_details(page, '[data-observation-engine="wave1"]')
    panel.get_by_role("button", name="Kör modellerad observation").click()
    return save_transcript(panel, '[data-observation-transcript="ready"]')


def run_probe(page):
    panel = page.locator('[data-active-probe-engine="wave2"]')
    open_details(page, '[data-active-probe-engine="wave2"]')
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    return panel, save_transcript(panel, '[data-active-probe-transcript="ready"]')


def add_hypothesis(page, text):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    field(panel, "Learner note", "textarea").fill(text)
    panel.get_by_role("button", name="Add note to proof chain").click()


def apply_gateway_remediation(page):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    field(panel, "Target").select_option("client1")
    field(panel, "Typed remediation action").select_option("change_default_gateway")
    field(panel, "Gateway IPv4 address", "input").fill("10.78.1.1")
    panel.get_by_role("button", name="Preview remediation").click()
    expect(panel).to_contain_text("0 → 1", timeout=10000)
    panel.get_by_role("button", name="Commit remediation").click()
    expect(panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and target.port and target.path == "/" and not target.query and not target.fragment, "PROJECT-084 must exercise compiled app on loopback")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence = {}
    errors = []
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

            # Gateway: recommendation -> observation -> ICMP -> remediation -> comparable retest.
            start_lab(page, "guided_win_gateway")
            check = next_check(page)
            expect(check).to_contain_text("Kontrollera routing")
            expect(check).to_contain_text("0 av 2 obligatoriska kontroller")
            check.get_by_role("button", name="Öppna observation för Windows client").click()
            observation_panel = page.locator('[data-observation-engine="wave1"]')
            expect(observation_panel).to_have_attribute("open", "", timeout=10000)
            expect(field(observation_panel, "Mål")).to_have_value("client1")
            expect(field(observation_panel, "Modellerat kommando")).to_have_value("windows.route_print")
            require(observation_panel.locator('[data-observation-transcript="ready"]').count() == 0, "Next check executed an observation automatically")
            expect(field(observation_panel, "Modellerat kommando")).to_be_focused()
            run_observation(page)

            check = next_check(page)
            expect(check).to_contain_text("Undersök anslutningen mellan")
            check.get_by_role("button", name="Förbered anslutningstest").click()
            probe_panel = page.locator('[data-active-probe-engine="wave2"]')
            expect(probe_panel).to_have_attribute("open", "", timeout=10000)
            expect(field(probe_panel, "Källvärd")).to_have_value("client1")
            expect(field(probe_panel, "Aktiv probe")).to_have_value("windows.ping")
            expect(field(probe_panel, "Destination")).to_have_value("server1")
            require(probe_panel.locator('[data-active-probe-transcript="ready"]').count() == 0, "Next check executed a probe automatically")
            expect(field(probe_panel, "Källvärd")).to_be_focused()
            field(probe_panel, "Källvärd").select_option("server1")
            page.locator('.react-flow__node[data-id="client1"]').click()
            expect(field(probe_panel, "Källvärd")).to_have_value("server1")
            field(probe_panel, "Källvärd").select_option("client1")
            transcript = run_probe(page)[1]
            expect(transcript).to_contain_text("verdict FALSE")
            add_hypothesis(page, "Gatewayen kan vara felaktig.")
            apply_gateway_remediation(page)
            check = next_check(page)
            expect(check).to_contain_text("Verifiera ändringen")
            check.get_by_role("button", name="Förbered samma ping igen").click()
            probe_panel = page.locator('[data-active-probe-engine="wave2"]')
            require(probe_panel.locator('[data-active-probe-transcript="ready"]').count() == 0, "Retest preparation executed a probe automatically")
            after = run_probe(page)[1]
            expect(after).to_contain_text("verdict TRUE")
            expect(page.locator('[data-troubleshooting-summary-status]')).to_have_attribute("data-troubleshooting-summary-status", "VERIFIED_IMPROVEMENT", timeout=15000)
            expect(guided(page).locator('[data-guided-phase="VERIFICATION_COMPLETE"]')).to_be_visible(timeout=15000)
            page.get_by_role("button", name="Ångra").click()
            expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text("Tillståndsrevision: 0", timeout=15000)
            expect(page.locator('[data-troubleshooting-summary-status]')).to_have_attribute("data-troubleshooting-summary-status", "HISTORICAL_VERIFIED_NEEDS_RECHECK", timeout=15000)
            expect(guided(page).locator('[data-guided-phase="COLLECT_AFTER_EVIDENCE"]')).to_be_visible(timeout=15000)
            expect(next_check(page)).to_contain_text("Ny verifiering behövs")
            evidence["gateway"] = {"before": "FALSE", "after": "TRUE", "afterUndo": "HISTORICAL_VERIFIED_NEEDS_RECHECK", "mobileWidth": 390}

            # DNS: the UNKNOWN verdict is preserved and does not become a diagnosis.
            start_lab(page, "guided_win_dns")
            check = next_check(page)
            check.get_by_role("button", name=re.compile("Öppna observation")).click()
            observation_panel = page.locator('[data-observation-engine="wave1"]')
            expect(field(observation_panel, "Mål")).to_have_value("client1")
            expect(field(observation_panel, "Modellerat kommando")).to_have_value("windows.ipconfig_all")
            run_observation(page)
            check = next_check(page)
            expect(check).to_contain_text("namnuppslag")
            check.get_by_role("button", name="Förbered anslutningstest").click()
            probe_panel = page.locator('[data-active-probe-engine="wave2"]')
            expect(field(probe_panel, "Källvärd")).to_have_value("client1")
            expect(field(probe_panel, "Aktiv probe")).to_have_value("windows.resolve_dnsname")
            expect(field(probe_panel, "DNS-namn", "input")).to_have_value("app.lab.test")
            require(probe_panel.locator('[data-active-probe-transcript="ready"]').count() == 0, "DNS preparation executed automatically")
            dns_transcript = run_probe(page)[1]
            expect(dns_transcript).to_contain_text("verdict UNKNOWN")
            require("10.78.102.53" not in next_check(page).inner_text(), "Next check exposed hidden DNS solution material")
            evidence["dns"] = {"verdict": "UNKNOWN", "hiddenSolutionExposed": False}

            # Linux SSH: service evidence is separate from TCP reachability.
            start_lab(page, "guided_linux_ssh")
            check = next_check(page)
            check.get_by_role("button", name=re.compile("Öppna observation")).click()
            observation_panel = page.locator('[data-observation-engine="wave1"]')
            expect(field(observation_panel, "Mål")).to_have_value("server1")
            expect(field(observation_panel, "Modellerat kommando")).to_have_value("linux.systemctl_status")
            service_transcript = run_observation(page)
            expect(service_transcript).to_contain_text("sshd: inactive")
            check = next_check(page)
            check.get_by_role("button", name="Förbered anslutningstest").click()
            probe_panel = page.locator('[data-active-probe-engine="wave2"]')
            expect(field(probe_panel, "Källvärd")).to_have_value("client1")
            expect(field(probe_panel, "Aktiv probe")).to_have_value("linux.nc_tcp")
            expect(field(probe_panel, "Destination")).to_have_value("server1")
            expect(field(probe_panel, "TCP port", "input")).to_have_value("22")
            ssh_transcript = run_probe(page)[1]
            expect(ssh_transcript).to_contain_text("verdict FALSE")
            require("canonicalSolution" not in next_check(page).inner_text(), "Linux next check exposed hidden solution material")
            evidence["linuxSsh"] = {"serviceEvidence": True, "tcpPort": 22, "verdict": "FALSE"}

            # Reset and scenario switch clear old runtime evidence UI.
            page.get_by_role("button", name="Återställ scenario").click()
            expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text("Tillståndsrevision: 0", timeout=15000)
            require(page.locator('[data-active-probe-transcript="ready"]').count() == 0, "Reset retained old probe transcript")
            start_lab(page, "guided_win_gateway")
            expect(next_check(page)).to_contain_text("Kontrollera routing")
            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence.update({"status": "PASS", "pageErrors": []})
            (args.evidence_dir / "project084-next-check.json").write_text(json.dumps(evidence, indent=2) + "\n")
            print("PASS PROJECT-084: next-check guidance prepares existing tools without execution")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

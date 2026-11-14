#!/usr/bin/env python3
"""PROJECT-080: distinguish a disabled SSH service from blocked traffic in Chromium."""
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


def choose(control, value):
    expect(control.locator(f'option[value="{value}"]')).to_have_count(1, timeout=120000)
    return control.select_option(value)


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


def start_lab(page, scenario_id):
    choose(page.locator('[data-guided-lab-catalog="wave1"]'), scenario_id)
    page.locator(".workspace-menu-advanced").evaluate("el => { el.open = true; }")
    page.get_by_role("button", name="Starta guidad labb").click()
    page.wait_for_function(
        """scenario => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id') === scenario""",
        arg=scenario_id,
        timeout=45000,
    )


def run_probe(page, probe_id, expected_truth, save=True):
    panel = page.locator('[data-active-probe-engine="wave2"]')
    open_details(page, '[data-active-probe-engine="wave2"]')
    choose(field(panel, "Källvärd"), "client1")
    choose(field(panel, "Aktiv probe"), probe_id)
    if probe_id in ("linux.nc_tcp",):
        choose(field(panel, "Destination"), "server1")
        fill_value(field(panel, "TCP port", "input"), "22")
    elif probe_id == "linux.ping":
        choose(field(panel, "Destination"), "server1")
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    transcript = panel.locator('[data-active-probe-transcript="ready"]')
    expect(transcript).to_contain_text(f"verdict {expected_truth}", timeout=15000)
    if save:
        transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript.text_content() or ""


def run_observation(page, target_id, command_id, expected_text, save=True):
    panel = page.locator('[data-observation-engine="wave1"]')
    open_details(page, '[data-observation-engine="wave1"]')
    choose(field(panel, "Mål"), target_id)
    choose(field(panel, "Modellerat kommando"), command_id)
    panel.get_by_role("button", name="Kör modellerad observation").click()
    transcript = panel.locator('[data-observation-transcript="ready"]')
    expect(transcript).to_contain_text(expected_text, timeout=15000)
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
    if action_id == "set_service_enabled":
        choose(field(panel, "Service"), "ssh")
        choose(field(panel, "Service state"), value)
    elif action_id == "set_firewall_default_action":
        choose(field(panel, "Firewall default policy"), value)
    elif action_id == "change_dns_servers":
        fill_value(field(panel, "DNS servers (comma-separated IPv4)", "input"), value)
    else:
        raise AssertionError(f"Unsupported acceptance action: {action_id}")
    panel.get_by_role("button", name="Preview remediation").click()
    expect(panel).to_contain_text("0 → 1", timeout=10000)
    panel.get_by_role("button", name="Commit remediation").click()
    expect(panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)


def review_status(page):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    panel.locator('[data-notebook-entry="remediation_action"]').get_by_role(
        "button", name="Verify before/after evidence"
    ).click()
    review = panel.locator("[data-remediation-review-status]")
    expect(review).to_be_visible(timeout=15000)
    return review.get_attribute("data-remediation-review-status")


def reset(page):
    page.get_by_role("button", name="Återställ scenario").click()
    expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text(
        "Tillståndsrevision: 0", timeout=15000
    )
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    expect(panel.locator("[data-notebook-entry]")).to_have_count(0, timeout=10000)
    require(page.locator("[data-remediation-review-status]").count() == 0,
            "Scenario reset left stale remediation review")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1"
            and target.port and target.path == "/" and not target.query and not target.fragment,
            "PROJECT-080 must exercise the compiled app on loopback")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    errors = []
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
            context = browser.new_context(service_workers="block")
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=30000)

            # SSH lab: TCP symptom, healthy IP path, disabled destination service.
            start_lab(page, "guided_linux_ssh")
            ssh_tcp = run_probe(page, "linux.nc_tcp", "FALSE", save=False)
            require("Blocking point: server1" in ssh_tcp, "SSH symptom did not identify the destination")
            expect(page.locator('[data-tcp-probe-interpretation="SERVICE_DISABLED"]')).to_contain_text(
                "destinationens modellerade tjänst är avstängd", timeout=30000
            )
            ssh_ping = run_probe(page, "linux.ping", "TRUE", save=False)
            require("REQUEST_PATH_REACHABLE" in ssh_ping, "SSH lab did not prove the separate IP path")
            ssh_service = run_observation(page, "server1", "linux.systemctl_status", "sshd: inactive")
            ssh_tcp = run_probe(page, "linux.nc_tcp", "FALSE")
            add_hypothesis(page, "IP-vägen fungerar; TCP/22 stoppas av serverns sshd-status.")

            # SSH negative control: unrelated DNS change cannot solve the service fault.
            apply_remediation(page, "client1", "change_dns_servers", "10.78.8.53")
            ssh_wrong = run_probe(page, "linux.nc_tcp", "FALSE")
            require("Matching service(s) on 'server1' are explicitly disabled" in ssh_wrong,
                    "SSH negative control changed the service diagnosis")
            require(review_status(page) != "VERIFIED_IMPROVEMENT",
                    "SSH unrelated remediation was reported as verified")
            reset(page)

            # SSH positive control: enable exactly server1.ssh, then rerun TCP/22.
            run_observation(page, "server1", "linux.systemctl_status", "sshd: inactive")
            run_probe(page, "linux.nc_tcp", "FALSE")
            add_hypothesis(page, "IP-vägen fungerar; TCP/22 stoppas av serverns sshd-status.")
            apply_remediation(page, "server1", "set_service_enabled", "true")
            ssh_after = run_probe(page, "linux.nc_tcp", "TRUE")
            require("Runtime revision 1" in ssh_after, "SSH remediation did not advance Runtime revision")
            require(review_status(page) == "VERIFIED_IMPROVEMENT", "SSH remediation did not verify improvement")
            reset(page)
            require("Blocking point: server1" in run_probe(page, "linux.nc_tcp", "FALSE", save=False),
                    "SSH reset did not restore the service fault")

            # Firewall lab: same TCP symptom, but the client policy blocks first.
            start_lab(page, "guided_linux_firewall")
            fw_tcp = run_probe(page, "linux.nc_tcp", "FALSE", save=False)
            require("Blocking point: client1" in fw_tcp, "Firewall symptom did not identify the blocking client")
            expect(page.locator('[data-tcp-probe-interpretation="POLICY_BLOCKED"]')).to_contain_text(
                "trafikpolicyn blockerade", timeout=30000
            )
            fw_ping = run_probe(page, "linux.ping", "FALSE", save=False)
            require("POLICY_BLOCKED" in fw_ping, "Firewall lab did not expose policy-blocked IP evidence")
            fw_policy = run_observation(page, "client1", "linux.nft_list_ruleset", "default action: deny")
            fw_service = run_observation(page, "server1", "linux.systemctl_status", "sshd: active")
            fw_tcp = run_probe(page, "linux.nc_tcp", "FALSE")
            add_hypothesis(page, "SSH är aktivt; klientens default-policy blockerar trafik före servern.")

            # Firewall negative control: unrelated DNS change cannot solve policy blocking.
            apply_remediation(page, "client1", "change_dns_servers", "10.78.7.53")
            fw_wrong = run_probe(page, "linux.nc_tcp", "FALSE")
            require("ACL default action on 'client1' blocks unmatched traffic" in fw_wrong,
                    "Firewall negative control changed the policy diagnosis")
            require(review_status(page) != "VERIFIED_IMPROVEMENT",
                    "Firewall unrelated remediation was reported as verified")
            reset(page)

            # Firewall positive control: allow the modeled client default policy.
            run_observation(page, "client1", "linux.nft_list_ruleset", "default action: deny")
            run_observation(page, "server1", "linux.systemctl_status", "sshd: active")
            run_probe(page, "linux.nc_tcp", "FALSE")
            add_hypothesis(page, "SSH är aktivt; klientens default-policy blockerar trafik före servern.")
            apply_remediation(page, "client1", "set_firewall_default_action", "allow")
            fw_after = run_probe(page, "linux.nc_tcp", "TRUE")
            require("Runtime revision 1" in fw_after, "Firewall remediation did not advance Runtime revision")
            require(review_status(page) == "VERIFIED_IMPROVEMENT", "Firewall remediation did not verify improvement")
            reset(page)
            fw_reset = run_probe(page, "linux.nc_tcp", "FALSE", save=False)
            require("Blocking point: client1" in fw_reset, "Firewall reset did not restore policy blocking")

            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence = {
                "status": "PASS",
                "ssh": {
                    "tcpBefore": "FALSE/SERVICE_DISABLED",
                    "ipPath": "TRUE",
                    "serviceObservation": "sshd: inactive",
                    "wrongRemediation": "FALSE",
                    "correctRemediation": "TRUE",
                    "reset": "FALSE/SERVICE_DISABLED",
                },
                "firewall": {
                    "tcpBefore": "FALSE/POLICY_BLOCKED",
                    "ipPath": "FALSE/POLICY_BLOCKED",
                    "policyObservation": "default action: deny",
                    "serviceObservation": "sshd: active",
                    "wrongRemediation": "FALSE",
                    "correctRemediation": "TRUE",
                    "reset": "FALSE/POLICY_BLOCKED",
                },
                "pageErrors": [],
            }
            (args.evidence_dir / "project080-root-cause.json").write_text(
                json.dumps(evidence, indent=2) + "\n"
            )
            print("PASS PROJECT-080: TCP symptom is separated into service-disabled and policy-blocked root causes")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

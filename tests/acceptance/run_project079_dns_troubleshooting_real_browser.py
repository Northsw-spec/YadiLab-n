#!/usr/bin/env python3
"""PROJECT-079: real Chromium DNS troubleshooting with negative controls."""
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


def run_observation(page, save=True):
    panel = page.locator('[data-observation-engine="wave1"]')
    open_details(page, '[data-observation-engine="wave1"]')
    choose(field(panel, "Mål"), "client1")
    choose(field(panel, "Modellerat kommando"), "windows.ipconfig_all")
    panel.get_by_role("button", name="Kör modellerad observation").click()
    transcript = panel.locator('[data-observation-transcript="ready"]')
    expect(transcript).to_contain_text("DNS Servers: 10.78.102.99", timeout=15000)
    if save:
        transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript.text_content() or ""


def run_probe(page, probe_id, expected_truth, save=True):
    panel = page.locator('[data-active-probe-engine="wave2"]')
    open_details(page, '[data-active-probe-engine="wave2"]')
    choose(field(panel, "Källvärd"), "client1")
    choose(field(panel, "Aktiv probe"), probe_id)
    if probe_id == "windows.ping":
        choose(field(panel, "Destination"), "server1")
    else:
        fill_value(field(panel, "DNS-namn", "input"), "app.lab.test")
    panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
    transcript = panel.locator('[data-active-probe-transcript="ready"]')
    expect(transcript).to_contain_text(f"verdict {expected_truth}", timeout=15000)
    if save:
        transcript.get_by_role("button", name="Spara evidens i anteckningar").click()
    return transcript.text_content() or ""


def add_hypothesis(page):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    fill_value(field(panel, "Learner note", "textarea"),
        "IP-vägen fungerar men klientens resolveradress saknar en deklarerad DNS-server."
    )
    panel.get_by_role("button", name="Add note to proof chain").click()


def apply_typed_remediation(page, action_id, value):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    open_details(page, '[data-troubleshooting-notebook="v0.75"]')
    choose(field(panel, "Typed remediation action"), action_id)
    if action_id == "change_dns_servers":
        fill_value(field(panel, "DNS servers (comma-separated IPv4)", "input"), value)
    elif action_id == "set_windows_network_profile":
        choose(field(panel, "Windows network profile"), value)
    else:
        raise AssertionError(f"Unsupported acceptance action: {action_id}")
    panel.get_by_role("button", name="Preview remediation").click()
    expect(panel).to_contain_text("0 → 1", timeout=10000)
    panel.get_by_role("button", name="Commit remediation").click()
    expect(panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)


def review_status(page):
    panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
    entry = panel.locator('[data-notebook-entry="remediation_action"]')
    entry.get_by_role("button", name="Verify before/after evidence").click()
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
            "Scenario reset left stale DNS review state")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1"
            and target.port and target.path == "/" and not target.query and not target.fragment,
            "PROJECT-079 must exercise the compiled app on loopback")
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

            choose(page.locator('[data-guided-lab-catalog="wave1"]'), "guided_win_dns")
            page.locator(".workspace-menu-advanced").locator("summary").click()
            page.get_by_role("button", name="Starta guidad labb").click()
            page.wait_for_function(
                """() => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id')
                    === 'guided_win_dns'""",
                timeout=45000,
            )

            # Positive diagnostic split: modeled IP path TRUE, DNS UNKNOWN.
            ping_text = run_probe(page, "windows.ping", "TRUE", save=False)
            require("REQUEST_PATH_REACHABLE" in ping_text, "IP probe lacked Engine reachability evidence")
            observation_text = run_observation(page)
            dns_before = run_probe(page, "windows.resolve_dnsname", "UNKNOWN")
            require("Resolver 10.78.102.99" in dns_before, "Initial resolver failure was not visible")
            unknown_note = page.locator('[data-dns-probe-interpretation="UNKNOWN"]')
            expect(unknown_note).to_contain_text("Det bevisar inte att IP-vägen generellt är nere")

            # Negative A: a different invalid resolver cannot fabricate success.
            add_hypothesis(page)
            apply_typed_remediation(page, "change_dns_servers", "10.78.102.54")
            dns_wrong = run_probe(page, "windows.resolve_dnsname", "UNKNOWN")
            require("Resolver 10.78.102.54" in dns_wrong, "Wrong resolver was not reflected in Engine output")
            wrong_status = review_status(page) if page.locator('[data-notebook-entry="active_probe"]').count() else "NO_REVIEW"
            require(wrong_status != "VERIFIED_IMPROVEMENT", "Wrong resolver was reported as a verified improvement")
            reset(page)

            # Negative B: an unrelated Windows profile change cannot solve DNS.
            run_observation(page)
            run_probe(page, "windows.resolve_dnsname", "UNKNOWN")
            add_hypothesis(page)
            apply_typed_remediation(page, "set_windows_network_profile", "public")
            dns_irrelevant = run_probe(page, "windows.resolve_dnsname", "UNKNOWN")
            require("Resolver 10.78.102.99" in dns_irrelevant,
                    "Irrelevant remediation changed the resolver evidence")
            irrelevant_status = review_status(page)
            require(irrelevant_status != "VERIFIED_IMPROVEMENT",
                    "Irrelevant remediation was reported as a verified improvement")
            reset(page)

            # Positive remediation: exact resolver, exact same DNS question, new revision.
            run_observation(page)
            run_probe(page, "windows.resolve_dnsname", "UNKNOWN")
            add_hypothesis(page)
            apply_typed_remediation(page, "change_dns_servers", "10.78.102.53")
            dns_after = run_probe(page, "windows.resolve_dnsname", "TRUE")
            require("Resolver: 10.78.102.53 (dns1)" in dns_after,
                    "Correct resolver was not selected by Engine")
            expect(page.locator('[data-dns-probe-interpretation="TRUE"]')).to_contain_text(
                "DNS-svaret verifierades"
            )
            positive_status = review_status(page)
            require(positive_status == "VERIFIED_IMPROVEMENT",
                    f"Correct DNS remediation did not verify improvement: {positive_status}")
            open_details(page, '[data-guided-troubleshooting="v0.77"]')
            phase_marker = page.locator('[data-guided-phase="VERIFICATION_COMPLETE"]')
            expect(phase_marker).to_have_count(1, timeout=15000)
            require((phase_marker.text_content() or "").strip() == "VERIFICATION_COMPLETE", "Guided completion phase marker was not updated")

            # Reset must restore the original resolver, notebook and UNKNOWN result.
            reset(page)
            open_details(page, '[data-guided-troubleshooting="v0.77"]')
            require(page.locator('[data-guided-phase="VERIFICATION_COMPLETE"]').count() == 0,
                    "Reset left guided DNS completion visible")
            dns_reset = run_probe(page, "windows.resolve_dnsname", "UNKNOWN", save=False)
            require("Resolver 10.78.102.99" in dns_reset,
                    "Reset did not restore the original resolver failure")

            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence = {
                "status": "PASS",
                "scenarioId": "guided_win_dns",
                "ipVerdict": "TRUE",
                "dnsBefore": "UNKNOWN",
                "wrongResolver": "UNKNOWN",
                "irrelevantRemediation": "UNKNOWN",
                "correctResolver": "TRUE",
                "correctResolverAddress": "10.78.102.53",
                "resetDns": "UNKNOWN",
                "resetResolverAddress": "10.78.102.99",
                "observation": "DNS Servers: 10.78.102.99",
                "pageErrors": [],
            }
            (args.evidence_dir / "project079-dns-troubleshooting.json").write_text(
                json.dumps(evidence, indent=2) + "\n"
            )
            print("PASS PROJECT-079: DNS troubleshooting distinguishes IP reachability, resolver failure and verified repair")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

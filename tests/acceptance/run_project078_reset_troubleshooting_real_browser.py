#!/usr/bin/env python3
"""PROJECT-078: resetting a guided troubleshooting run clears learner proof."""
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1"
            and target.port and target.path == "/" and not target.query and not target.fragment,
            "PROJECT-078 must exercise the compiled app on loopback")
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

            # Start the real built-in gateway lab through the visible application menu.
            page.locator(".workspace-menu-advanced").locator("summary").click()
            page.get_by_role("button", name="Starta guidad labb").click()
            page.wait_for_function(
                """() => document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-id')
                    === 'guided_win_gateway'""",
                timeout=45000)

            probe_panel = page.locator('[data-active-probe-engine="wave2"]')
            open_details(page, '[data-active-probe-engine="wave2"]')
            choose(field(probe_panel, "Källvärd"), "client1")
            choose(field(probe_panel, "Aktiv probe"), "windows.ping")
            choose(field(probe_panel, "Destination"), "server1")
            probe_panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
            expect(probe_panel.locator('[data-active-probe-transcript="ready"]')).to_contain_text("FALSE", timeout=15000)
            probe_panel.locator('[data-active-probe-transcript="ready"]').get_by_role(
                "button", name="Spara evidens i anteckningar").click()

            notebook_panel = page.locator('[data-troubleshooting-notebook="v0.75"]')
            open_details(page, '[data-troubleshooting-notebook="v0.75"]')
            choose(field(notebook_panel, "Typed remediation action"), "change_default_gateway")
            fill_value(field(notebook_panel, "Gateway IPv4 address", "input"), "10.78.1.1")
            notebook_panel.get_by_role("button", name="Preview remediation").click()
            expect(notebook_panel).to_contain_text("0 → 1", timeout=10000)
            notebook_panel.get_by_role("button", name="Commit remediation").click()
            expect(notebook_panel.locator('[data-notebook-entry="remediation_action"]')).to_have_count(1, timeout=15000)

            open_details(page, '[data-active-probe-engine="wave2"]')
            probe_panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
            expect(probe_panel.locator('[data-active-probe-transcript="ready"]')).to_contain_text("TRUE", timeout=15000)
            probe_panel.locator('[data-active-probe-transcript="ready"]').get_by_role(
                "button", name="Spara evidens i anteckningar").click()
            open_details(page, '[data-troubleshooting-notebook="v0.75"]')
            remediation_entry = notebook_panel.locator('[data-notebook-entry="remediation_action"]')
            remediation_entry.get_by_role("button", name="Verify before/after evidence").click()
            expect(notebook_panel.locator('[data-remediation-review-status="VERIFIED_IMPROVEMENT"]')).to_be_visible(timeout=15000)
            open_details(page, '[data-guided-troubleshooting="v0.77"]')
            phase_marker = page.locator('[data-guided-phase="VERIFICATION_COMPLETE"]')
            expect(phase_marker).to_have_count(1, timeout=15000)
            require((phase_marker.text_content() or "").strip() == "VERIFICATION_COMPLETE", "Guided completion phase marker was not updated")

            # The regression: reset must restart the proof chain, not only Engine state.
            page.get_by_role("button", name="Återställ scenario").click()
            expect(page.locator('[data-runtime-panel="progress"]')).to_contain_text("Tillståndsrevision: 0", timeout=15000)
            expect(notebook_panel.locator('[data-notebook-entry]')).to_have_count(0, timeout=10000)
            require(page.locator('[data-remediation-review-status]').count() == 0,
                    "Reset left a stale remediation review visible")
            open_details(page, '[data-guided-troubleshooting="v0.77"]')
            require(page.locator('[data-guided-phase="VERIFICATION_COMPLETE"]').count() == 0,
                    "Reset left guided troubleshooting in VERIFICATION_COMPLETE")

            # Positive control: the reset really restored the modeled fault.
            open_details(page, '[data-active-probe-engine="wave2"]')
            probe_panel.get_by_role("button", name="Kör modellerad aktiv probe").click()
            expect(probe_panel.locator('[data-active-probe-transcript="ready"]')).to_contain_text("FALSE", timeout=15000)
            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence = {
                "status": "PASS",
                "scenarioId": "guided_win_gateway",
                "beforeVerdict": "FALSE",
                "afterVerdict": "TRUE",
                "resetStateRevision": 0,
                "notebookEntriesAfterReset": 0,
                "staleReviewAfterReset": False,
                "staleGuidedCompletionAfterReset": False,
                "postResetVerdict": "FALSE",
                "pageErrors": [],
            }
            (args.evidence_dir / "project078-reset-troubleshooting.json").write_text(
                json.dumps(evidence, indent=2) + "\n")
            print("PASS PROJECT-078: reset clears guided troubleshooting proof and restores the fault")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

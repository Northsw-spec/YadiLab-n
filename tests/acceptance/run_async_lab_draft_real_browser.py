#!/usr/bin/env python3
"""PROJECT-067: actual Chromium protects form drafts typed during asynchronous lab starts."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_project_file_real_browser import MOCK, require

LAB_BUTTONS = [
    "Starta guidad labb",
    "Starta enterprise-labb",
    "Starta verifierad leveransdemo",
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1"
            and target.port and target.path == "/" and not target.query and not target.fragment,
            "PROJECT-067 must exercise the compiled app on loopback")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as playwright:
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        browser = playwright.chromium.launch(headless=True, args=flags)
        try:
            context = browser.new_context(service_workers="block")
            page = context.new_page()
            page.add_init_script(MOCK)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            controls = page.locator('[data-project-file-controls="ready"]')
            expect(controls).to_be_visible(timeout=45000)
            frame = page.locator(".app-frame")
            starting_id = frame.get_attribute("data-runtime-scenario-id")
            require(starting_id == "foundation_acceptance", "Unexpected starting lab")
            page.evaluate("""() => {
              const el = document.querySelector('[data-builder-inspector="mission"]');
              if (!el) throw new Error('PROJECT067_INSPECTOR_MISSING');
              let parent = el.closest('details');
              while (parent) {
                parent.open = true;
                parent = parent.parentElement?.closest('details') ?? null;
              }
            }""")
            inspector = page.locator('[data-builder-inspector="mission"]')
            title = inspector.locator("label.inspector-field", has_text="Title").locator("input")
            expect(title).to_be_visible(timeout=15000)
            original_title = title.input_value()
            evidence = []
            for index, button_label in enumerate(LAB_BUTTONS):
                draft_value = "PROJECT-067 pending during " + button_label
                # Same JavaScript task: run the real MainActions onClick, then
                # input while its async Compile/ELK has yet to finish.
                page.evaluate("""({ buttonLabel, value }) => {
                  const input = document.querySelector(
                    '[data-builder-inspector="mission"] label.inspector-field input');
                  const menu = document.querySelector('.workspace-menu-advanced');
                  const button = [...(menu?.querySelectorAll('button') ?? [])]
                    .find(el => el.textContent?.trim() === buttonLabel);
                  if (!input || !button || button.disabled)
                    throw new Error('PROJECT067_EXPECTED_ACTION_NOT_READY: ' + buttonLabel);
                  button.click();
                  const setter = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype, 'value').set;
                  setter.call(input, value);
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }""", {"buttonLabel": button_label, "value": draft_value})
                expect(controls).to_have_attribute("data-project-pending-drafts", "true")
                expect(title).to_have_value(draft_value)
                expect(page.locator(".diagnostic")).to_contain_text(
                    "PROJECT_LAB_LATE_UNAPPLIED_DRAFT", timeout=45000)
                expect(frame).to_have_attribute("data-runtime-scenario-id", starting_id)
                expect(title).to_have_value(draft_value)
                require(page.evaluate("window.__yadilabProjectStore.writes") == 0,
                        "Lab start wrote unexpected native project data")
                evidence.append({
                    "button": button_label,
                    "lateDraftProtected": True,
                    "originalBuilderPreserved": True,
                    "nativeWrites": 0,
                })
                page.once("dialog", lambda dialog: dialog.accept())
                inspector.get_by_role("button", name="Förkasta inspektörsutkast").click()
                expect(controls).to_have_attribute("data-project-pending-drafts", "false")
                expect(title).to_have_value(original_title)

            # Positive control: a clean Builder switch must still succeed.
            page.evaluate("""() => {
              const menu = document.querySelector('.workspace-menu-advanced');
              const button = [...(menu?.querySelectorAll('button') ?? [])]
                .find(el => el.textContent?.trim() === 'Öppna labb i byggläget');
              if (!button || button.disabled)
                throw new Error('PROJECT067_CLEAN_LAB_ACTION_UNAVAILABLE');
              button.click();
            }""")
            page.wait_for_function(
                """prior => document.querySelector('.app-frame')
                    ?.getAttribute('data-runtime-scenario-id') !== prior""",
                arg=starting_id, timeout=15000)
            expect(controls).to_have_attribute("data-project-pending-drafts", "false")
            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            (args.evidence_dir / "async-lab-late-drafts.json").write_text(
                json.dumps({
                    "status": "PASS",
                    "blockedTransitions": evidence,
                    "cleanLabSwitch": "PASS",
                }, indent=2) + "\n")
            print("PASS PROJECT-067: all three asynchronous lab entries preserve late drafts, clean switch works")
        finally:
            browser.close()

if __name__ == "__main__":
    main()

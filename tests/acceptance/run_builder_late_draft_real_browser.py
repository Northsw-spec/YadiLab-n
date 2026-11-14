#!/usr/bin/env python3
"""AUDIT-066: real compiled Chromium guards drafts created during async operations."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect
from run_project_file_real_browser import MOCK, fill_value, require

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--evidence-dir", type=Path, required=True)
    args = ap.parse_args()
    u = urlsplit(args.url)
    require(u.scheme == "http" and u.hostname == "127.0.0.1" and u.port
            and u.path == "/" and not u.query and not u.fragment,
            "Only source-built loopback YadiLab may be tested")
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
            page.evaluate("""() => {
              for (const el of [document.querySelector('[data-builder-inspector="mission"]'),
                                document.querySelector('[data-scenario-studio]')]) {
                if (!el) throw new Error('AUDIT066_EDITOR_MISSING');
                let parent = el.closest('details');
                while (parent) {
                  parent.open = true;
                  parent = parent.parentElement?.closest('details') ?? null;
                }
              }
            }""")
            inspector = page.locator('[data-builder-inspector="mission"]')
            title = inspector.locator('label.inspector-field', has_text="Title").locator("input")
            expect(title).to_be_visible(timeout=15000)
            controls.locator('[data-project-action="save-as"]').click()
            expect(controls.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            initial_writes = page.evaluate("window.__yadilabProjectStore.writes")
            require(initial_writes == 1, "Initial native Save As was not verified")

            # Trigger compile and then type in the same task, before its await
            # continuation can replace the Builder.
            page.evaluate("""() => {
              const input = document.querySelector(
                '[data-builder-inspector="mission"] label.inspector-field input');
              const compile = document.querySelector('[data-studio-action="validate-compile"]');
              if (!input || !compile || compile.disabled)
                throw new Error('AUDIT066_COMPILE_OR_TITLE_UNAVAILABLE');
              compile.click();
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype, 'value').set;
              setter.call(input, 'AUDIT-066 typed during compile');
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }""")
            try:
                expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15000)
            except AssertionError:
                # Chromium may finish the compile continuation before the
                # same-task synthetic input event is observed; replay the
                # controlled value through the native setter and assert the
                # draft guard rather than weakening the gate.
                fill_value(title, "AUDIT-066 typed during compile")
                expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15000)
            expect(page.locator(".diagnostic")).to_contain_text(
                "BUILDER_COMPILE_LATE_UNAPPLIED_DRAFT", timeout=20000)
            expect(title).to_have_value("AUDIT-066 typed during compile")
            require("AUDIT-066 typed" not in (page.locator(".mission-strip").text_content() or ""),
                    "Compiler committed unapplied form text")
            page.once("dialog", lambda dialog: dialog.accept())
            inspector.get_by_role("button", name="Förkasta inspektörsutkast").click()
            expect(controls).to_have_attribute("data-project-pending-drafts", "false")

            # Identity check suspends Save As after the initial clean check.
            page.evaluate("""() => {
              const s = window.__yadilabProjectStore;
              s.pauseIdentity = true;
              s.aliasSameEntryOnSaveAs = true;
            }""")
            controls.locator('[data-project-action="save-as"]').click()
            page.wait_for_function("window.__yadilabProjectStore.pendingIdentity === true",
                                   timeout=15000)
            fill_value(title, "AUDIT-066 typed during Save As")
            expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15000)
            page.evaluate("""() => {
              const s = window.__yadilabProjectStore;
              s.pauseIdentity = false;
              s.releaseIdentity();
            }""")
            expect(controls.locator('[data-project-message]')).to_contain_text(
                "PROJECT_UNAPPLIED_DRAFT_DURING_SAVE", timeout=20000)
            require(page.evaluate("window.__yadilabProjectStore.writes") == initial_writes,
                    "Asynchronous Save As wrote after a new draft appeared")
            expect(title).to_have_value("AUDIT-066 typed during Save As")
            page.once("dialog", lambda dialog: dialog.accept())
            inspector.get_by_role("button", name="Förkasta inspektörsutkast").click()
            expect(controls).to_have_attribute("data-project-pending-drafts", "false")

            # If writing is already in progress, the file may be verified but
            # the newer draft must remain unsaved and visible.
            page.evaluate("""() => {
              const s = window.__yadilabProjectStore;
              s.aliasSameEntryOnSaveAs = false;
              s.pauseWritableOpen = true;
            }""")
            controls.locator('[data-project-action="save"]').click()
            page.wait_for_function(
                "window.__yadilabProjectStore.pendingWritableOpen === true",
                timeout=15000)
            fill_value(title, "AUDIT-066 typed during native write")
            expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15000)
            page.evaluate("""() => {
              const s = window.__yadilabProjectStore;
              s.pauseWritableOpen = false;
              s.releaseWritableOpen();
            }""")
            expect(controls.locator('[data-project-message]')).to_contain_text(
                "PROJECT_UNAPPLIED_DRAFT_DURING_SAVE", timeout=20000)
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == initial_writes + 1, "Expected one in-flight native write")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            expect(controls).to_have_attribute("data-project-pending-drafts", "true")
            expect(title).to_have_value("AUDIT-066 typed during native write")
            disk = json.loads(page.evaluate("window.__yadilabProjectStore.text"))
            require(disk["content"]["source"]["metadata"]["title"]
                    != "AUDIT-066 typed during native write",
                    "Native writer serialized unapplied form text")
            page.once("dialog", lambda dialog: dialog.accept())
            inspector.get_by_role("button", name="Förkasta inspektörsutkast").click()
            expect(controls).to_have_attribute("data-project-pending-drafts", "false")
            expect(controls).to_have_attribute("data-project-dirty", "false")
            require(not errors, "Real Chromium JS exceptions: " + repr(errors))
            (args.evidence_dir / "builder-late-draft-real-chromium.json").write_text(
                json.dumps({"status": "PASS",
                            "lateCompileDraftRetained": True,
                            "lateSaveAsDraftBlocksWrite": True,
                            "lateWritableDraftRemainsUnsaved": True,
                            "verifiedWrites": initial_writes + 1}, indent=2) + "\n")
            print("PASS AUDIT-066: late compile and native Save drafts preserved")
        finally:
            browser.close()

if __name__ == "__main__":
    main()

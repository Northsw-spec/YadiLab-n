#!/usr/bin/env python3
"""PROJECT-068: compiled Chromium package download may not omit staged Builder text."""
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
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1"
            and target.port and target.path == "/" and not target.query and not target.fragment,
            "Only source-built YadiLab on localhost is accepted")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    exceptions = []
    with sync_playwright() as playwright:
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        browser = playwright.chromium.launch(headless=True, args=flags)
        try:
            page = browser.new_context(service_workers="block").new_page()
            page.add_init_script(MOCK)
            page.on("pageerror", lambda error: exceptions.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            controls = page.locator('[data-project-file-controls="ready"]')
            expect(controls).to_be_visible(timeout=45000)
            page.evaluate("""() => {
              window.__auditPackageDownloads = [];
              const original = HTMLAnchorElement.prototype.click;
              HTMLAnchorElement.prototype.click = function () {
                if (this.download) {
                  window.__auditPackageDownloads.push(this.download);
                  return;
                }
                return original.call(this);
              };
              const inspector = document.querySelector('[data-builder-inspector="mission"]');
              if (!inspector) throw new Error('PROJECT068_INSPECTOR_MISSING');
              let parent = inspector.closest('details');
              while (parent) {
                parent.open = true;
                parent = parent.parentElement?.closest('details') ?? null;
              }
            }""")
            inspector = page.locator('[data-builder-inspector="mission"]')
            title = inspector.locator("label.inspector-field", has_text="Title").locator("input")
            expect(title).to_be_visible(timeout=15000)
            original_title = title.input_value()
            # Compile the actual welcome scenario; only then does the real
            # package menu offer an export, exactly like production.
            page.evaluate("""() => {
              const button = document.querySelector('[data-studio-action="validate-compile"]');
              if (!button || button.disabled) throw new Error('PROJECT068_COMPILE_MISSING');
              button.click();
            }""")
            page.wait_for_function("""() => {
              const menu = [...document.querySelectorAll('.workspace-menu')]
                .find(el => el.querySelector('summary')?.textContent?.trim()
                  === 'Import / Export');
              const button = [...(menu?.querySelectorAll('button') ?? [])]
                .find(el => el.textContent?.trim() === 'Exportera elevpaket');
              return button && !button.disabled;
            }""", timeout=45000)

            # Positive control: a compiled, clean Builder may produce a package.
            def export_package():
                page.evaluate("""() => {
                  const menu = [...document.querySelectorAll('.workspace-menu')]
                    .find(el => el.querySelector('summary')?.textContent?.trim()
                      === 'Import / Export');
                  const button = [...(menu?.querySelectorAll('button') ?? [])]
                    .find(el => el.textContent?.trim() === 'Exportera elevpaket');
                  if (!button || button.disabled) throw new Error('PROJECT068_EXPORT_UNAVAILABLE');
                  button.click();
                }""")

            export_package()
            page.wait_for_function("window.__auditPackageDownloads.length === 1", timeout=30000)
            before = page.evaluate("window.__auditPackageDownloads.length")
            require(before == 1, "Clean compiled Builder did not export a package")

            # An unapplied form must fail BEFORE package creation or download.
            fill_value(title, "PROJECT-068 pending before package export")
            expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15000)
            export_package()
            expect(page.locator(".diagnostic")).to_contain_text(
                "PROJECT_PACKAGE_EXPORT_UNAPPLIED_DRAFT", timeout=10000)
            require(page.evaluate("window.__auditPackageDownloads.length") == before,
                    "Package downloaded without the visible staged form text")
            expect(title).to_have_value("PROJECT-068 pending before package export")
            page.once("dialog", lambda dialog: dialog.accept())
            inspector.get_by_role("button", name="Förkasta inspektörsutkast").click()
            expect(controls).to_have_attribute("data-project-pending-drafts", "false")
            expect(title).to_have_value(original_title)

            # Same JavaScript task: package I/O starts and only then does a
            # new draft appear. The workspace/source identity is unchanged.
            page.evaluate("""() => {
              const menu = [...document.querySelectorAll('.workspace-menu')]
                .find(el => el.querySelector('summary')?.textContent?.trim()
                  === 'Import / Export');
              const button = [...(menu?.querySelectorAll('button') ?? [])]
                .find(el => el.textContent?.trim() === 'Exportera elevpaket');
              const input = document.querySelector(
                '[data-builder-inspector="mission"] label.inspector-field input');
              if (!button || button.disabled || !input)
                throw new Error('PROJECT068_ASYNC_EXPORT_UNAVAILABLE');
              button.click();
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype, 'value').set;
              setter.call(input, 'PROJECT-068 pending during package export');
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }""")
            try:
                expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15000)
            except AssertionError:
                fill_value(title, "PROJECT-068 pending during package export")
                expect(controls).to_have_attribute("data-project-pending-drafts", "true", timeout=15000)
            expect(page.locator(".diagnostic")).to_contain_text(
                "PROJECT_PACKAGE_EXPORT_LATE_UNAPPLIED_DRAFT", timeout=30000)
            require(page.evaluate("window.__auditPackageDownloads.length") == before,
                    "Async package export included stale canonical source")
            expect(title).to_have_value("PROJECT-068 pending during package export")
            page.once("dialog", lambda dialog: dialog.accept())
            inspector.get_by_role("button", name="Förkasta inspektörsutkast").click()
            expect(controls).to_have_attribute("data-project-pending-drafts", "false")
            export_package()
            page.wait_for_function("window.__auditPackageDownloads.length === 2", timeout=30000)
            require(not exceptions, "Compiled Chromium JS failures: " + repr(exceptions))
            (args.evidence_dir / "package-export-pending-drafts.json").write_text(
                json.dumps({
                    "status": "PASS",
                    "cleanExportWorks": True,
                    "preExistingDraftDeniesExport": True,
                    "draftCreatedDuringExportDeniesExport": True,
                    "recoveryExportWorks": True,
                    "recordedDownloadIntents": 2,
                }, indent=2) + "\n")
            print("PASS PROJECT-068: clean package export works; pre-existing/late form drafts block stale packages")
        finally:
            browser.close()


if __name__ == "__main__":
    main()

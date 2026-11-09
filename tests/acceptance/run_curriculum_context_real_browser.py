#!/usr/bin/env python3
"""PROJECT-077: curriculum guidance follows the active scenario in Chromium."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1"
            and target.port and target.path == "/" and not target.query and not target.fragment,
            "PROJECT-077 must exercise the compiled app on loopback")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "examples/enterprise-import/network-devices-example.csv"
    errors = []
    with sync_playwright() as playwright:
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        executable = os.environ.get("YADILAB_CHROMIUM_EXECUTABLE")
        launch = {"headless": True, "args": flags}
        if executable:
            launch["executable_path"] = executable
        browser = playwright.chromium.launch(**launch)
        try:
            context = browser.new_context(service_workers="block")
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=30000)

            # The initial welcome scenario is not a guided curriculum lab.
            require(page.locator('[data-curriculum-wave]').count() == 0,
                    "Welcome scenario displayed unrelated guided-lab instructions")

            with page.expect_file_chooser(timeout=5000) as chooser:
                page.get_by_role("button", name="Import JSON / Excel / CSV → Network Topology").click()
            chooser.value.set_files(str(csv_path))
            page.get_by_role("button", name="Create topology in Builder (edit only)").click()
            expect(page.locator('.mission-strip')).to_contain_text("Imported Network Topology", timeout=15000)
            require(page.locator('[data-curriculum-wave]').count() == 0,
                    "Imported topology retained unrelated guided-lab instructions")

            # Positive control: opening the selected guided lab still shows its guidance.
            page.get_by_text("Builder", exact=True).click()
            page.once("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Öppna labb i byggläget").click()
            page.wait_for_function(
                """() => document.querySelector('.app-frame')
                    ?.getAttribute('data-runtime-scenario-id') === 'guided_win_gateway'""",
                timeout=45000)
            expect(page.locator('[data-curriculum-wave]')).to_be_visible(timeout=15000)
            expect(page.locator('[data-curriculum-wave]')).to_contain_text("Inbyggd guidad labb 1/8")
            require(not errors, "Real compiled Chromium exceptions: " + repr(errors))
            evidence = {
                "status": "PASS",
                "welcomeGuidanceHidden": True,
                "importedTopologyGuidanceHidden": True,
                "matchingGuidedLabGuidanceVisible": True,
                "pageErrors": [],
            }
            (args.evidence_dir / "curriculum-context-real-chromium.json").write_text(
                json.dumps(evidence, indent=2) + "\n")
            print("PASS PROJECT-077: curriculum guidance follows active scenario")
            print(json.dumps(evidence, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()

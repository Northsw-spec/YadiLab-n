#!/usr/bin/env python3
"""Probe native File System Access support without pretending a mock is durable.

Headless Chromium cannot approve the OS Save/Open picker or attest bytes on a
user-selected path.  The output is intentionally NOT_TESTED when the APIs are
present; the companion manual Parrot procedure is the durable acceptance gate.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect


def require(value, message):
    if not value:
        raise AssertionError(message)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    parsed = urlsplit(args.url)
    require(parsed.scheme == "http" and parsed.hostname == "127.0.0.1" and parsed.port and parsed.path == "/", "loopback compiled app required")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch = {"headless": True, "args": ["--disable-background-networking", "--disable-dev-shm-usage"]}
        if os.environ.get("YADILAB_CHROMIUM_EXECUTABLE"):
            launch["executable_path"] = os.environ["YADILAB_CHROMIUM_EXECUTABLE"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch["args"].append("--no-sandbox")
        browser = playwright.chromium.launch(**launch)
        try:
            context = browser.new_context(service_workers="block", accept_downloads=True)
            page = context.new_page()
            page.goto(args.url, wait_until="domcontentloaded", timeout=30_000)
            expect(page.locator('[data-project-file-controls="ready"]')).to_be_visible(timeout=45_000)
            capability = page.evaluate("""() => ({
              secureContext: isSecureContext,
              showSaveFilePicker: typeof window.showSaveFilePicker === 'function',
              showOpenFilePicker: typeof window.showOpenFilePicker === 'function',
              saveAction: Boolean(document.querySelector('[data-project-action="save-as"]')),
              openAction: Boolean(document.querySelector('[data-project-action="open"]')),
              origin: location.origin,
            })""")
            screenshot = args.evidence_dir / "atlas001-f4b-d-filesystem-capability.png"
            page.screenshot(path=str(screenshot), full_page=True)
        finally:
            context.close()
            browser.close()
    evidence = {
        "format": "atlas001-f4b-d-filesystem-capability-evidence",
        "schemaVersion": "1.0.0",
        "status": "NOT_TESTED",
        "reason": "Native OS picker and durable bytes are not automatable in this headless CI probe; no mock was installed and no durable PASS is claimed.",
        "platform": "GitHub Ubuntu Chromium probe; Parrot native NOT_TESTED",
        "capability": capability,
        "screenshot": screenshot.name,
        "manualProcedure": "docs/design/atlas-001/ATLAS001_F4B_D_MANUAL_ACCEPTANCE.md",
    }
    (args.evidence_dir / "atlas001-f4b-d-filesystem-capability-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

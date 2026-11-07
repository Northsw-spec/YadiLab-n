#!/usr/bin/env python3
"""PROJECT-001: compiled YadiLab Chromium, explicit .yadilab native file I/O and failure denial.

Real browser drives the actual UI. A deterministic File System Access test handle
is injected so bytes/close/readback/cancellation can be asserted without a human OS dialog.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

def require(condition, message):
    if not condition:
        raise AssertionError(message)

MOCK = r"""
(() => {
  const store = { text: "", writes: 0, fail: false, reads: 0 };
  const handle = {
    name: "verified-network.yadilab",
    async createWritable() {
      let pending = "";
      return {
        async write(blob) {
          if (store.fail) throw new Error("DISK_FULL");
          pending = await blob.text();
        },
        async close() { store.text = pending; store.writes++; },
        async abort() {},
      };
    },
    async getFile() {
      store.reads++;
      return new File([store.text], this.name, {type:"application/json"});
    },
  };
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true, value: async () => handle,
  });
  Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true, value: async () => [handle],
  });
  window.__yadilabProjectStore = store;
})();
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--evidence-dir", type=Path, required=True)
    a = ap.parse_args()
    u = urlsplit(a.url)
    require(u.scheme == "http" and u.hostname == "127.0.0.1" and u.port and
            u.path == "/" and not u.query and not u.fragment,
            "Only a loopback-compiled YadiLab app may be tested")
    a.evidence_dir.mkdir(parents=True, exist_ok=True)
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
            page.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            controls = page.locator('[data-project-file-controls="ready"]')
            expect(controls).to_be_visible(timeout=45000)
            require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
                    == "foundation_acceptance", "Unexpected initial Builder source")
            require(controls.get_attribute("data-project-dirty") == "false",
                    "Welcome source unexpectedly dirty")
            require(page.evaluate("window.__yadilabProjectStore.writes") == 0,
                    "Project file was autosaved at startup")
            page.locator('[data-project-action="save-as"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            stored = page.evaluate("window.__yadilabProjectStore.text")
            original = json.loads(stored)
            require(original["formatId"] == "yadilab.project" and
                    original["schemaVersion"] == 1, "New project format missing")
            require(len(original["content"]["source"]["resources"]) == 4 and
                    len(original["content"]["source"]["connections"]) == 3,
                    "Real canonical source lost its nodes or connections")
            require(page.evaluate("window.__yadilabProjectStore.reads") >= 1,
                    "Native Save reported success without reading back saved file")
            require("engineState" not in stored and "compile" not in stored,
                    "Serialized project falsely includes runtime/Engine truth")
            writes = page.evaluate("window.__yadilabProjectStore.writes")
            page.locator('[data-project-action="new"]').click()
            expect(page.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            require(page.evaluate("window.__yadilabProjectStore.writes") == writes,
                    "New project implicitly wrote to disk")
            page.locator('[data-project-action="open"]').click()
            expect(page.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "foundation_acceptance")
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            require(page.locator('[data-project-status="unchanged"]').count() == 1,
                    "Opened project unexpectedly dirty")
            # A tampered stored file is not allowed to mutate the current workspace.
            page.evaluate("""() => {
              window.__yadilabProjectStore.text =
                window.__yadilabProjectStore.text.replace(
                  "foundation_acceptance", "fake_imported_scenario");
            }""")
            page.locator('[data-project-action="open"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Operation failed", timeout=20000)
            require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
                    == "foundation_acceptance",
                    "Corrupt file mutated active Builder workspace")
            require(not errors, "Real browser JS exceptions: " + repr(errors))
            report = {
                "status": "PASS", "format": "yadilab.project", "version": 1,
                "nativeHandleWriteAndReadback": True, "newNoAutosave": True,
                "openRestoresEditableCanonicalSource": True,
                "tamperedSourceRejectedWithoutMutation": True,
                "nodeCount": 4, "connectionCount": 3,
            }
            (a.evidence_dir / "project-file-real-chromium.json").write_text(
                json.dumps(report, indent=2) + "\n")
            print("PASS PROJECT-001 compiled Chromium: Save As native write/readback,"
                  " New no autosave, Open original topology, tamper denied")
        finally:
            browser.close()
if __name__ == "__main__":
    main()

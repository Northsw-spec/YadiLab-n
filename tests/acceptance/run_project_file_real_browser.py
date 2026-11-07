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
  const store = { text: "", writes: 0, fail: false, reads: 0,
    permissionDenied: false, cancelSave: false, cancelOpen: false,
    aliasSameEntryOnSaveAs: false };
  const handle = {
    name: "verified-network.yadilab",
    async createWritable() {
      if (store.permissionDenied) throw new DOMException("Permission denied", "NotAllowedError");
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
  const alias = { ...handle };
  handle.isSameEntry = async other => other === handle || other === alias;
  alias.isSameEntry = async other => other === handle || other === alias;
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true, value: async () => {
      if (store.cancelSave) throw new DOMException("Save cancelled", "AbortError");
      return store.aliasSameEntryOnSaveAs ? alias : handle;
    },
  });
  Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true, value: async () => {
      if (store.cancelOpen) throw new DOMException("Open cancelled", "AbortError");
      return [handle];
    },
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
            context = browser.new_context(service_workers="block", accept_downloads=True)
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
            # Change the actual Builder mission title via its real inspector.
            inspector_section = page.locator("details.control-section").filter(
                has_text="Builder Inspector & Authoring")
            expect(inspector_section).to_have_count(1)
            if inspector_section.get_attribute("open") is None:
                inspector_section.locator("summary").first.click()
            inspector = page.locator('[data-builder-inspector="mission"]')
            expect(inspector).to_be_visible(timeout=15000)
            inspector.locator("label.inspector-field", has_text="Title").locator(
                "input").fill("PROJECT-001 edited in Chromium")
            inspector.get_by_role("button", name="Verkställ inspektörsändringar").click()
            expect(controls).to_have_attribute("data-project-dirty", "true")
            # New must refuse to discard unsaved changes when the operator cancels.
            denied = []
            def decline(dialog):
                denied.append(dialog.type)
                dialog.dismiss()
            page.once("dialog", decline)
            page.locator('[data-project-action="new"]').click()
            require(denied == ["confirm"], "New discarded unsaved changes without consent")
            require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
                    == "foundation_acceptance", "Cancelled New lost current project")
            # Ctrl+S must update the associated native file and verify its readback.
            before_ctrl = page.evaluate("window.__yadilabProjectStore.writes")
            page.keyboard.press("Control+s")
            expect(controls).to_have_attribute("data-project-dirty", "false", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes") == before_ctrl + 1,
                    "Ctrl+S failed to write the existing project file")
            require("PROJECT-001 edited in Chromium" in
                    page.evaluate("window.__yadilabProjectStore.text"),
                    "Ctrl+S lost edited Builder metadata")
            saved_after_ctrl = page.evaluate("window.__yadilabProjectStore.text")
            # Save As can select the same disk file through a DIFFERENT JS handle.
            # The modified bytes must be detected, never silently overwritten.
            page.evaluate("""() => {
              const store = window.__yadilabProjectStore;
              store.aliasSameEntryOnSaveAs = true;
              store.text += " OUTSIDE EDIT";
            }""")
            changed_disk = page.evaluate("window.__yadilabProjectStore.text")
            writes_before_alias = page.evaluate("window.__yadilabProjectStore.writes")
            page.locator('[data-project-action="save-as"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "PROJECT_EXTERNAL_FILE_CHANGED", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes") == writes_before_alias,
                    "Save As through alias handle overwrote an externally modified file")
            require(page.evaluate("window.__yadilabProjectStore.text") == changed_disk,
                    "Save As alias changed disk bytes despite conflict")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            page.evaluate("""(saved) => {
              window.__yadilabProjectStore.text = saved;
              window.__yadilabProjectStore.aliasSameEntryOnSaveAs = false;
            }""", saved_after_ctrl)
            writes = page.evaluate("window.__yadilabProjectStore.writes")
            page.once("dialog", lambda dialog: dialog.accept())
            page.locator('[data-project-action="new"]').click()
            expect(page.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            require(page.evaluate("window.__yadilabProjectStore.writes") == writes,
                    "New project implicitly wrote to disk")
            # No user edits, but this project has NEVER been written to a file.
            # It MUST prompt before any action that would discard it.
            new_rejected = []
            def reject_new(dialog):
                new_rejected.append(dialog.type)
                dialog.dismiss()
            page.once("dialog", reject_new)
            page.locator('[data-project-action="open"]').click()
            require(new_rejected == ["confirm"],
                    "Empty newly created project was treated as saved")
            expect(page.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            def accept_new(dialog):
                dialog.accept()
            page.once("dialog", accept_new)
            page.locator('[data-project-action="open"]').click()
            expect(page.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "foundation_acceptance")
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            require("PROJECT-001 edited in Chromium" in page.locator(".mission-strip").inner_text(),
                    "Open lost the user's saved Builder edits")
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
            # An external file modification must never be overwritten by Ctrl+S.
            page.evaluate("(saved) => { window.__yadilabProjectStore.text = saved; }",
                          saved_after_ctrl)
            inspector = page.locator('[data-builder-inspector="mission"]')
            inspector.locator("label.inspector-field", has_text="Title").locator(
                "input").fill("PROJECT-001 unsaved after external file change")
            inspector.get_by_role("button", name="Verkställ inspektörsändringar").click()
            expect(controls).to_have_attribute("data-project-dirty", "true")
            page.evaluate("window.__yadilabProjectStore.text += ' '")
            expected_external = page.evaluate("window.__yadilabProjectStore.text")
            writes_before_conflict = page.evaluate("window.__yadilabProjectStore.writes")
            page.keyboard.press("Control+s")
            expect(page.locator("[data-project-message]")).to_contain_text(
                "PROJECT_EXTERNAL_FILE_CHANGED", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_conflict,
                    "External edit was overwritten despite optimistic conflict check")
            require(page.evaluate("window.__yadilabProjectStore.text")
                    == expected_external, "File bytes were altered on conflict")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            # Native permission denial and picker cancellation remain fail-closed.
            page.evaluate("window.__yadilabProjectStore.permissionDenied = true")
            page.locator('[data-project-action="save-as"]').click()
            expect(page.locator("[data-project-message]")).to_contain_text(
                "Permission denied", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_conflict,
                    "Permission denial unexpectedly modified existing file")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            page.evaluate("""() => {
                window.__yadilabProjectStore.permissionDenied = false;
                window.__yadilabProjectStore.cancelSave = true;
            }""")
            page.locator('[data-project-action="save-as"]').click()
            expect(page.locator("[data-project-message]")).to_contain_text(
                "Cancelled", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_conflict,
                    "Save-picker cancellation wrote to disk")
            # A non-native browser may download, but must not claim durable success.
            page.evaluate("""() => {
                window.__yadilabProjectStore.cancelSave = false;
                Object.defineProperty(window, "showSaveFilePicker",
                    {configurable:true, value:undefined});
            }""")
            with page.expect_download(timeout=15000) as pending_download:
                page.locator('[data-project-action="save-as"]').click()
            require(pending_download.value.suggested_filename.endswith(".yadilab"),
                    "Fallback download did not use the actual project extension")
            expect(page.locator("[data-project-message]")).to_contain_text(
                "Download initiated", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_conflict,
                    "Fallback download wrote through a native file handle")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            # Runtime preview must preserve the unsaved state, and returning to
            # Builder must restore the actual source, not reconstruct defaults.
            scenario_section = page.locator("details.control-section").filter(
                has_text="Scenario & Builder")
            expect(scenario_section).to_have_count(1)
            if scenario_section.get_attribute("open") is None:
                scenario_section.locator("summary").first.click()
            compile_button = page.locator('[data-studio-action="validate-compile"]')
            expect(compile_button).to_be_visible(timeout=15000)
            compile_button.click()
            expect(compile_button).to_be_disabled(timeout=30000)
            run_menu = page.locator(".workspace-menu", has=page.locator(
                "summary", has_text="Run & Preview"))
            expect(run_menu).to_have_count(1)
            if run_menu.get_attribute("open") is None:
                run_menu.locator("summary").click()
            run_menu.get_by_role("button", name="Förhandsvisa körläge").click()
            expect(page.locator(".app-frame")).not_to_have_attribute(
                "data-runtime-scenario-hash", "builder", timeout=30000)
            expect(controls).to_have_attribute("data-project-dirty", "true")
            if run_menu.get_attribute("open") is None:
                run_menu.locator("summary").click()
            run_menu.get_by_role("button", name="Tillbaka till byggläget").click()
            expect(page.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-hash", "builder", timeout=15000)
            expect(controls).to_have_attribute("data-project-dirty", "true")
            require("PROJECT-001 unsaved after external file change" in
                    page.locator(".mission-strip").inner_text(),
                    "Runtime→Builder lost the user's unsaved editable source")
            # Cancelled native Open must not discard an unsaved project.
            page.evaluate("window.__yadilabProjectStore.cancelOpen = true")
            def accept(dialog):
                dialog.accept()
            page.once("dialog", accept)
            page.locator('[data-project-action="open"]').click()
            expect(page.locator("[data-project-message]")).to_contain_text(
                "Cancelled", timeout=15000)
            expect(controls).to_have_attribute("data-project-dirty", "true")
            require("PROJECT-001 unsaved after external file change" in
                    page.locator(".mission-strip").inner_text(),
                    "Cancelled Open discarded the current Builder edits")
            page.evaluate("window.__yadilabProjectStore.cancelOpen = false")
            # An unrelated built-in Builder must receive a fresh file
            # association after explicit operator discard consent.
            builder_menu = page.locator(".workspace-menu", has=page.locator(
                "summary", has_text="Builder"))
            expect(builder_menu).to_have_count(1)
            if builder_menu.get_attribute("open") is None:
                builder_menu.locator("summary").click()
            declined = []
            def decline_switch(dialog):
                declined.append(dialog.type)
                dialog.dismiss()
            page.once("dialog", decline_switch)
            builder_menu.get_by_role("button", name="Öppna enterprise i byggläget").click()
            require(declined == ["confirm"], "Builder switch lost the unsaved-change warning")
            require("PROJECT-001 unsaved after external file change" in
                    page.locator(".mission-strip").inner_text(),
                    "Cancelled Builder switch altered the current project")
            page.once("dialog", accept)
            builder_menu.get_by_role("button", name="Öppna enterprise i byggläget").click()
            expect(page.locator(".app-frame")).not_to_have_attribute(
                "data-runtime-scenario-id", "foundation_acceptance", timeout=15000)
            expect(controls).not_to_have_attribute(
                "data-project-filename", "verified-network.yadilab", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_conflict,
                    "Switch to unrelated Builder silently wrote old project")
            require(not errors, "Real browser JS exceptions: " + repr(errors))
            report = {
                "status": "PASS", "format": "yadilab.project", "version": 1,
                "nativeHandleWriteAndReadback": True, "newNoAutosave": True,
                "openRestoresEditableCanonicalSource": True,
                "tamperedSourceRejectedWithoutMutation": True,
                "unsavedNewCancellation": True, "neverSavedNewProjectGuard": True,
                "ctrlSSaveReadback": True,
                "externalModificationDenied": True, "permissionDenied": True,
                "pickerCancelNoWrite": True, "fallbackDownloadUnverified": True,
                "runtimeBuilderUnsavedRetained": True,
                "nativeOpenCancelledNoMutation": True,
                "saveAsAliasExternalConflictDenied": True,
                "unrelatedBuilderDetachesFile": True,
                "nodeCount": 4, "connectionCount": 3,
            }
            (a.evidence_dir / "project-file-real-chromium.json").write_text(
                json.dumps(report, indent=2) + "\n")
            print("PASS PROJECT-001 compiled Chromium: native Save/readback, dirty New, Ctrl+S,"
                  " external conflict blocked, permission denial, cancel, fallback download,"
                  " runtime→Builder unsaved restore, tampered file denied")
        finally:
            browser.close()
if __name__ == "__main__":
    main()

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
    aliasSameEntryOnSaveAs: false, editDuringWritableOpen: false, abortedWrites: 0,
    chooseAlternative: false, otherText: "", otherWrites: 0,
    pauseIdentity: false, pendingIdentity: false, releaseIdentity: null,
    pauseOpenPicker: false, pendingOpenPicker: false, releaseOpenPicker: null,
    openPickerCalls: 0, editAfterOpenSnapshot: false,
    pauseWritableOpen: false, pendingWritableOpen: false, releaseWritableOpen: null };
  const handle = {
    name: "verified-network.yadilab",
    async createWritable() {
      if (store.permissionDenied) throw new DOMException("Permission denied", "NotAllowedError");
      if (store.pauseWritableOpen) {
        store.pendingWritableOpen = true;
        await new Promise(resolve => { store.releaseWritableOpen = resolve; });
        store.pendingWritableOpen = false;
        store.releaseWritableOpen = null;
      }
      if (store.editDuringWritableOpen) {
        store.text += " EXTERNAL_MODIFICATION_DURING_OPEN";
        store.editDuringWritableOpen = false;
      }
      let pending = "";
      return {
        async write(blob) {
          if (store.fail) throw new Error("DISK_FULL");
          pending = await blob.text();
        },
        async close() { store.text = pending; store.writes++; },
        async abort() { store.abortedWrites++; },
      };
    },
    async getFile() {
      store.reads++;
      const snapshot = new File([store.text], this.name, {type:"application/json"});
      if (store.editAfterOpenSnapshot) {
        store.editAfterOpenSnapshot = false;
        // Model another OS process changing the physical file after the
        // first native File snapshot was captured, before Open can commit.
        queueMicrotask(() => { store.text += " EXTERNAL_CHANGE_DURING_OPEN"; });
      }
      return snapshot;
    },
  };
  const alias = { ...handle };
  handle.isSameEntry = async other => {
    if (store.pauseIdentity) {
      store.pendingIdentity = true;
      await new Promise(resolve => { store.releaseIdentity = resolve; });
      store.pendingIdentity = false;
      store.releaseIdentity = null;
    }
    return other === handle || other === alias;
  };
  alias.isSameEntry = async other => other === handle || other === alias;
  const alternate = {
    name: "safe-recovery-copy.yadilab",
    async isSameEntry(other) { return other === alternate; },
    async createWritable() {
      if (store.permissionDenied) throw new DOMException("Permission denied", "NotAllowedError");
      let pending = "";
      return {
        async write(blob) { pending = await blob.text(); },
        async close() { store.otherText = pending; store.otherWrites++; },
        async abort() { store.abortedWrites++; },
      };
    },
    async getFile() {
      return new File([store.otherText], this.name, {type:"application/json"});
    },
  };
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true, value: async () => {
      if (store.cancelSave) throw new DOMException("Save cancelled", "AbortError");
      return store.chooseAlternative ? alternate :
             store.aliasSameEntryOnSaveAs ? alias : handle;
    },
  });
  Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true, value: async () => {
      store.openPickerCalls++;
      if (store.pauseOpenPicker) {
        store.pendingOpenPicker = true;
        await new Promise(resolve => { store.releaseOpenPicker = resolve; });
        store.pendingOpenPicker = false;
        store.releaseOpenPicker = null;
      }
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
            # PROJECT-018: browsers without File System Access still need a
            # discard guard and a pinned origin while a normal file-input
            # chooser is open. Test the real Chromium file chooser (not a
            # simulated file-input onChange event) against the compiled app.
            fallback_open = context.new_page()
            fallback_open.add_init_script(MOCK)
            fallback_open.on("pageerror", lambda error: errors.append(str(error)))
            fallback_open.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            foc = fallback_open.locator('[data-project-file-controls="ready"]')
            expect(foc).to_be_visible(timeout=45000)
            require(fallback_open.evaluate("""() => {
                delete window.showOpenFilePicker;
                return typeof window.showOpenFilePicker !== 'function' &&
                    'oncancel' in document.querySelector('[data-project-input]');
            }"""), "PROJECT-018 requires input cancel support in pinned Chromium")
            fallback_open.locator('[data-project-action="save-as"]').click()
            expect(fallback_open.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            fallback_bytes = fallback_open.evaluate(
                "window.__yadilabProjectStore.text")
            fallback_writes = fallback_open.evaluate(
                "window.__yadilabProjectStore.writes")
            chooser_events = []
            fallback_open.on("filechooser", lambda chooser: chooser_events.append(chooser))
            with fallback_open.expect_file_chooser() as fc_info:
                fallback_open.locator('[data-project-action="open"]').click()
            chooser = fc_info.value
            fallback_open.evaluate("""() => {
                document.querySelector('[data-project-action="new"]').click();
                document.querySelector('[data-project-action="save-as"]').click();
                document.querySelector('[data-project-action="open"]').click();
            }""")
            require(fallback_open.locator(".app-frame").get_attribute(
                "data-runtime-scenario-id") == "foundation_acceptance",
                "New replaced Builder while fallback Open chooser was pending")
            require(len(chooser_events) == 1,
                    "A competing action launched a second fallback chooser")
            require(fallback_open.evaluate(
                "window.__yadilabProjectStore.writes") == fallback_writes,
                "Fallback Open chooser allowed an implicit or competing Save")
            chooser.set_files({
                "name": "fallback-selected.yadilab",
                "mimeType": "application/json",
                "buffer": fallback_bytes.encode("utf-8"),
            })
            expect(fallback_open.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            expect(foc).to_have_attribute(
                "data-project-filename", "fallback-selected.yadilab")
            expect(foc).to_have_attribute("data-project-dirty", "false")
            require(fallback_open.evaluate(
                "window.__yadilabProjectStore.writes") == fallback_writes,
                "Fallback Open wrote to a project file")
            # Cancel must release the pending chooser's exclusive lock.
            with fallback_open.expect_file_chooser() as cancel_info:
                fallback_open.locator('[data-project-action="open"]').click()
            cancel_info.value
            fallback_open.evaluate("""() => document.querySelector(
                '[data-project-input]').dispatchEvent(
                  new Event('cancel', { bubbles: true }))""")
            fallback_open.locator('[data-project-action="new"]').click()
            expect(fallback_open.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            expect(foc).to_have_attribute("data-project-dirty", "true")
            chooser_count = len(chooser_events)
            declined = []
            def reject_fallback(dialog):
                declined.append(dialog.type)
                dialog.dismiss()
            fallback_open.once("dialog", reject_fallback)
            fallback_open.locator('[data-project-action="open"]').click()
            require(declined == ["confirm"],
                    "Fallback Open showed picker before unsaved-change guard")
            require(len(chooser_events) == chooser_count,
                    "Declined fallback Open still launched a file chooser")
            expect(fallback_open.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            require(fallback_open.evaluate(
                "window.__yadilabProjectStore.writes") == fallback_writes,
                "Fallback cancel or declined discard performed implicit disk writes")
            fallback_open.close()
            # PROJECT-019: older browsers may not expose input.oncancel.
            # Focus returning from a dismissed chooser must retire its ticket,
            # allowing another explicit Open. Late selection from the old
            # chooser must not activate a project when its ticket is gone.
            legacy_fallback = context.new_page()
            legacy_fallback.add_init_script(MOCK)
            legacy_fallback.on("pageerror", lambda error: errors.append(str(error)))
            legacy_fallback.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            legacy_controls = legacy_fallback.locator(
                '[data-project-file-controls="ready"]')
            expect(legacy_controls).to_be_visible(timeout=45000)
            require(legacy_fallback.evaluate("""() => {
                delete window.showOpenFilePicker;
                const input = document.querySelector('[data-project-input]');
                Object.defineProperty(input, 'oncancel', {
                    configurable: true, value: undefined,
                });
                return typeof window.showOpenFilePicker !== 'function' &&
                    input.oncancel === undefined;
            }"""), "PROJECT-019 legacy input setup failed")
            legacy_writes = legacy_fallback.evaluate(
                "window.__yadilabProjectStore.writes")
            with legacy_fallback.expect_file_chooser() as old_chooser_info:
                legacy_fallback.locator('[data-project-action="open"]').click()
            old_chooser = old_chooser_info.value
            legacy_fallback.evaluate("""() =>
                window.dispatchEvent(new Event('focus'))""")
            expect(legacy_fallback.locator('[data-project-message]')).to_contain_text(
                "File chooser closed without a selection", timeout=10000)
            require(legacy_fallback.evaluate(
                "window.__yadilabProjectStore.writes") == legacy_writes,
                "Legacy fallback chooser cancellation wrote project content")
            # A selection delivered after focus cleanup cannot reopen the
            # old project implicitly or attach a stale native file.
            old_chooser.set_files({
                "name": "stale-legacy.yadilab",
                "mimeType": "application/json",
                "buffer": fallback_bytes.encode("utf-8"),
            })
            expect(legacy_controls).to_have_attribute(
                "data-project-filename", "foundation_acceptance.yadilab")
            require(legacy_fallback.locator(
                '[data-project-message]').inner_text().startswith(
                "File chooser closed without a selection"),
                "Late legacy selection was accepted after cancel recovery")
            with legacy_fallback.expect_file_chooser() as retry_chooser_info:
                legacy_fallback.locator('[data-project-action="open"]').click()
            retry_chooser_info.value.set_files({
                "name": "recovered-legacy.yadilab",
                "mimeType": "application/json",
                "buffer": fallback_bytes.encode("utf-8"),
            })
            expect(legacy_fallback.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            expect(legacy_controls).to_have_attribute(
                "data-project-filename", "recovered-legacy.yadilab")
            require(legacy_fallback.evaluate(
                "window.__yadilabProjectStore.writes") == legacy_writes,
                "Legacy cancellation recovery performed an implicit save")
            legacy_fallback.close()
            # PROJECT-016: beforeunload must request a browser warning when
            # the source is clean but an explicit native Save remains in flight.
            # This test uses a controlled pending writable open, not a timer.
            unload_guard = context.new_page()
            unload_guard.add_init_script(MOCK)
            unload_guard.on("pageerror", lambda error: errors.append(str(error)))
            unload_guard.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            ug_controls = unload_guard.locator('[data-project-file-controls="ready"]')
            expect(ug_controls).to_be_visible(timeout=45000)
            unload_guard.locator('[data-project-action="save-as"]').click()
            expect(unload_guard.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            expect(ug_controls).to_have_attribute("data-project-dirty", "false")
            # One animation-frame boundary allows the first Save's finally to
            # release its lock before the next native action.
            unload_guard.evaluate("""() => new Promise(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)))""")
            baseline_writes = unload_guard.evaluate(
                "window.__yadilabProjectStore.writes")
            idle_warning = unload_guard.evaluate("""() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }""")
            require(idle_warning is False,
                    "An idle clean native project needlessly blocked tab close")
            unload_guard.evaluate("""() => {
                window.__yadilabProjectStore.pauseWritableOpen = true;
            }""")
            unload_guard.locator('[data-project-action="save"]').click()
            unload_guard.wait_for_function(
                "window.__yadilabProjectStore.pendingWritableOpen === true",
                timeout=20000)
            expect(ug_controls).to_have_attribute("data-project-dirty", "false")
            active_warning = unload_guard.evaluate("""() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }""")
            require(active_warning is True,
                    "Active native Save on a clean project did not request an unload warning")
            require(unload_guard.evaluate(
                "window.__yadilabProjectStore.writes") == baseline_writes,
                "A paused writable open unexpectedly committed to disk")
            unload_guard.evaluate("""() => {
                const s = window.__yadilabProjectStore;
                s.pauseWritableOpen = false;
                s.releaseWritableOpen();
            }""")
            expect(unload_guard.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            unload_guard.wait_for_function(
                "window.__yadilabProjectStore.writes > " + str(baseline_writes),
                timeout=15000)
            unload_guard.evaluate("""() => new Promise(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)))""")
            finished_warning = unload_guard.evaluate("""() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }""")
            require(finished_warning is False,
                    "Completed verified Save left the native file unload warning active")
            require(unload_guard.evaluate(
                "window.__yadilabProjectStore.writes") == baseline_writes + 1,
                "Resumed explicit Save was not verified as exactly one disk write")
            unload_guard.close()

            # PROJECT-017: when a write fails after a previously verified
            # clean Save, native file content may be uncertain. Mark the
            # Builder unsaved before permitting any New/Open or tab close.
            # Recovery must require a different explicitly selected file.
            failed_write = context.new_page()
            failed_write.add_init_script(MOCK)
            failed_write.on("pageerror", lambda error: errors.append(str(error)))
            failed_write.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            fw_controls = failed_write.locator('[data-project-file-controls="ready"]')
            expect(fw_controls).to_be_visible(timeout=45000)
            failed_write.locator('[data-project-action="save-as"]').click()
            expect(failed_write.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            expect(fw_controls).to_have_attribute("data-project-dirty", "false")
            original_disk = failed_write.evaluate(
                "window.__yadilabProjectStore.text")
            before_failure_writes = failed_write.evaluate(
                "window.__yadilabProjectStore.writes")
            failed_write.evaluate("""() => {
                window.__yadilabProjectStore.fail = true;
            }""")
            failed_write.keyboard.press("Control+s")
            expect(failed_write.locator('[data-project-message]')).to_contain_text(
                "DISK_FULL", timeout=20000)
            expect(fw_controls).to_have_attribute("data-project-dirty", "true")
            require(failed_write.evaluate("window.__yadilabProjectStore.text")
                    == original_disk, "Failed Save modified original disk contents")
            require(failed_write.evaluate("window.__yadilabProjectStore.writes")
                    == before_failure_writes, "Failed Save counted as committed write")
            failure_unload_warning = failed_write.evaluate("""() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }""")
            require(failure_unload_warning is True,
                    "Failed native write did not protect beforeunload")
            dismissed = []
            failed_write.once("dialog", lambda d: (dismissed.append(d.type), d.dismiss()))
            failed_write.locator('[data-project-action="new"]').click()
            require(dismissed == ["confirm"],
                    "Failed native write allowed New without unsaved confirmation")
            expect(failed_write.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "foundation_acceptance")
            failed_write.evaluate("""() => {
                const s = window.__yadilabProjectStore;
                s.fail = false;
                s.chooseAlternative = true;
            }""")
            failed_write.locator('[data-project-action="save-as"]').click()
            expect(failed_write.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            expect(fw_controls).to_have_attribute("data-project-dirty", "false")
            require(failed_write.evaluate(
                "window.__yadilabProjectStore.otherWrites") == 1,
                "Recovery did not save exactly once to separately selected disk file")
            require(failed_write.evaluate(
                "window.__yadilabProjectStore.text") == original_disk,
                "Recovery unexpectedly overwrote quarantined original project")
            failed_write.close()

            # PROJECT-015: React may batch updates when two explicit
            # project actions fire in one JS task. New MUST publish its
            # unpersisted state synchronously before Open checks the guard;
            # otherwise Open can launch without confirming that the new,
            # never-saved project may be discarded.
            immediate_guard = context.new_page()
            immediate_guard.add_init_script(MOCK)
            immediate_guard.on("pageerror", lambda error: errors.append(str(error)))
            immediate_guard.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            ig_controls = immediate_guard.locator(
                '[data-project-file-controls="ready"]')
            expect(ig_controls).to_be_visible(timeout=45000)
            immediate = immediate_guard.evaluate("""() => {
                const store = window.__yadilabProjectStore;
                const fresh = document.querySelector('[data-project-action="new"]');
                const open = document.querySelector('[data-project-action="open"]');
                if (!fresh || !open || fresh.disabled || open.disabled)
                    throw new Error("PROJECT-015 action controls unavailable");
                let confirmations = 0;
                const originalConfirm = window.confirm;
                try {
                    window.confirm = () => { confirmations++; return false; };
                    fresh.click();
                    open.click();
                    return {
                        confirmations,
                        pickerCalls: store.openPickerCalls,
                        diskWrites: store.writes,
                    };
                } finally {
                    window.confirm = originalConfirm;
                }
            }""")
            require(immediate["confirmations"] == 1,
                    "New→Open in one task bypassed unsaved-change confirmation")
            require(immediate["pickerCalls"] == 0,
                    "Open picker started despite refusal to discard unsaved New")
            require(immediate["diskWrites"] == 0,
                    "New→Open performed an implicit project write")
            expect(immediate_guard.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            expect(ig_controls).to_have_attribute(
                "data-project-dirty", "true")
            require(immediate_guard.evaluate(
                "window.__yadilabProjectStore.writes") == 0,
                "Never-saved new project was silently persisted")
            immediate_guard.close()
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
            # Re-open is the explicit recovery boundary after a failed write;
            # a second Save As to the quarantined physical entry must be blocked.
            page.once("dialog", lambda dialog: dialog.accept())
            page.locator('[data-project-action="open"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=15000)
            page.locator('[data-project-action="save-as"]').click()
            expect(page.locator("[data-project-message]")).to_contain_text(
                "Saved and read back", timeout=15000)
            # Simulate an external writer AFTER initial digest check but while
            # opening the writable stream. No app write may occur.
            page.evaluate("window.__yadilabProjectStore.editDuringWritableOpen = true")
            writes_before_race = page.evaluate("window.__yadilabProjectStore.writes")
            aborts_before_race = page.evaluate("window.__yadilabProjectStore.abortedWrites")
            page.keyboard.press("Control+s")
            expect(page.locator("[data-project-message]")).to_contain_text(
                "PROJECT_EXTERNAL_FILE_CHANGED", timeout=15000)
            require(page.evaluate("window.__yadilabProjectStore.writes") == writes_before_race,
                    "Race during writable open incorrectly completed a project write")
            require(page.evaluate("window.__yadilabProjectStore.abortedWrites") ==
                    aborts_before_race + 1,
                    "Writable stream was not aborted when disk changed during createWritable")
            require(page.evaluate("window.__yadilabProjectStore.text") ==
                    saved_after_ctrl + " EXTERNAL_MODIFICATION_DURING_OPEN",
                    "External writer's content was overwritten despite race detection")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            page.evaluate("(saved) => { window.__yadilabProjectStore.text = saved; }",
                          saved_after_ctrl)
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
            # PROJECT-008: accepted editorial hints have only level/text, not
            # synthetic IDs. Open the exact schema-valid source with two hint
            # levels, then Ctrl+S and read the native persisted file again.
            # This fails in the old validator, which rejected missing hint.id.
            hints = [
                {"level": 1, "text": "Inspect original source evidence."},
                {"level": 2, "text": "Preserve link identity across edits."},
                {"level": 2, "text": "Do not invent verified interfaces."},
            ]
            page.evaluate("""async ([saved, hints]) => {
                const document = JSON.parse(saved);
                document.content.source.hints = hints;
                const payload = new TextEncoder().encode(JSON.stringify(document.content));
                const digest = await crypto.subtle.digest('SHA-256', payload);
                document.contentSha256 = [...new Uint8Array(digest)]
                  .map(x => x.toString(16).padStart(2, '0')).join('');
                window.__yadilabProjectStore.text = JSON.stringify(document);
            }""", [saved_after_ctrl, hints])
            writes_before_hints = page.evaluate("window.__yadilabProjectStore.writes")
            page.locator('[data-project-action="open"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            expect(controls).to_have_attribute("data-project-dirty", "false")
            require(page.evaluate("window.__yadilabProjectStore.writes") == writes_before_hints,
                    "Explicit Open of a project with hints caused an implicit disk write")
            # Observe an actual Builder edit before Ctrl+S. A status message
            # may render before Open's finally releases its private busy flag;
            # editing via the UI also verifies that hints survive normal work.
            inspector.locator("label.inspector-field", has_text="Title").locator(
                "input").fill("PROJECT-008 hints retained after editing")
            inspector.get_by_role(
                "button", name="Verkställ inspektörsändringar").click()
            expect(controls).to_have_attribute("data-project-dirty", "true")
            page.keyboard.press("Control+s")
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            expect(controls).to_have_attribute("data-project-dirty", "false")
            require(page.evaluate("window.__yadilabProjectStore.writes") == writes_before_hints + 1,
                    "Ctrl+S failed to save a valid project with hints")
            saved_hints = json.loads(page.evaluate("window.__yadilabProjectStore.text"))
            require(saved_hints["content"]["source"]["hints"] == hints,
                    "Native Save lost or reordered schema-valid editorial hints")
            require(saved_hints["content"]["source"]["connections"] ==
                    original["content"]["source"]["connections"],
                    "Saving hints unexpectedly changed the original network links")
            page.evaluate("(saved) => { window.__yadilabProjectStore.text = saved; }",
                          saved_after_ctrl)
            page.locator('[data-project-action="open"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            expect(controls).to_have_attribute("data-project-dirty", "false")
            # PROJECT-011: the native Open chooser may stay pending while
            # other buttons/shortcuts are clicked. Open must reserve the
            # same exclusive lock as Save, New, and other native Open calls
            # BEFORE awaiting the chooser. A second action cannot mutate
            # Builder or write an unrelated file during that window.
            page.evaluate("""() => {
                window.__yadilabProjectStore.pauseOpenPicker = true;
            }""")
            writes_before_picker = page.evaluate("window.__yadilabProjectStore.writes")
            picker_calls_before = page.evaluate(
                "window.__yadilabProjectStore.openPickerCalls")
            page.locator('[data-project-action="open"]').click()
            page.wait_for_function(
                "window.__yadilabProjectStore.pendingOpenPicker === true",
                timeout=10000)
            page.locator('[data-project-action="new"]').click()
            require(page.locator(".app-frame").get_attribute(
                "data-runtime-scenario-id") == "foundation_acceptance",
                "New replaced Builder while the native Open picker was pending")
            page.locator('[data-project-action="save-as"]').click()
            page.keyboard.press("Control+s")
            page.locator('[data-project-action="open"]').click()
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_picker,
                    "Save/Save As wrote file while Open picker was pending")
            require(page.evaluate("window.__yadilabProjectStore.openPickerCalls")
                    == picker_calls_before + 1,
                    "Another Open picker was launched while the first was unresolved")
            expect(controls).to_have_attribute("data-project-dirty", "false")
            page.evaluate("""() => {
                const store = window.__yadilabProjectStore;
                store.pauseOpenPicker = false;
                store.releaseOpenPicker();
            }""")
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_picker,
                    "Native Open performed an implicit project save")
            require(page.locator(".app-frame").get_attribute(
                "data-runtime-scenario-id") == "foundation_acceptance",
                "Pending native Open replaced the wrong Builder project")
            expect(controls).to_have_attribute("data-project-dirty", "false")
            # PROJECT-012: another OS writer modifies the underlying
            # physical file immediately after showOpenFilePicker.getFile()
            # returned a valid snapshot. Native Open must verify it still
            # matches the disk at association time, not merely trust the
            # earlier checksum-valid snapshot.
            page.evaluate("""(saved) => {
                const store = window.__yadilabProjectStore;
                store.text = saved;
                store.editAfterOpenSnapshot = true;
            }""", saved_after_ctrl)
            writes_before_swapped_open = page.evaluate(
                "window.__yadilabProjectStore.writes")
            page.locator('[data-project-action="open"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "PROJECT_EXTERNAL_FILE_CHANGED_DURING_OPEN", timeout=20000)
            require(page.locator(".app-frame").get_attribute(
                "data-runtime-scenario-id") == "foundation_acceptance",
                "Externally replaced file unexpectedly changed active Builder")
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_swapped_open,
                    "Opening a swapped project wrote to the physical file")
            require(page.evaluate("window.__yadilabProjectStore.text")
                    == saved_after_ctrl + " EXTERNAL_CHANGE_DURING_OPEN",
                    "Open incorrectly overwrote the external writer's bytes")
            expect(controls).to_have_attribute("data-project-dirty", "false")
            page.evaluate("(saved) => { window.__yadilabProjectStore.text = saved; }",
                          saved_after_ctrl)
            page.locator('[data-project-action="open"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            expect(controls).to_have_attribute("data-project-dirty", "false")
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
            # A file whose SHA-256 was legitimately recomputed can still
            # contain a structurally invalid zone hierarchy. Reject it before
            # mutating Builder, not merely on checksum mismatch.
            page.evaluate("""async (saved) => {
                const forged = JSON.parse(saved);
                const zone = forged.content.source.zones[0];
                zone.parent = zone.id;
                const raw = new TextEncoder().encode(JSON.stringify(forged.content));
                const hash = await crypto.subtle.digest("SHA-256", raw);
                forged.contentSha256 = [...new Uint8Array(hash)]
                    .map(n => n.toString(16).padStart(2, "0")).join("");
                window.__yadilabProjectStore.text = JSON.stringify(forged);
            }""", saved_after_ctrl)
            writes_before_cycle = page.evaluate("window.__yadilabProjectStore.writes")
            page.locator('[data-project-action="open"]').click()
            expect(page.locator('[data-project-message]')).to_contain_text(
                "PROJECT_ZONE_PARENT_CYCLE", timeout=20000)
            require(page.locator(".app-frame").get_attribute("data-runtime-scenario-id")
                    == "foundation_acceptance",
                    "Cyclic zone file changed active Builder workspace")
            require(page.evaluate("window.__yadilabProjectStore.writes") == writes_before_cycle,
                    "Rejected cyclic project unexpectedly wrote to disk")
            expect(controls).to_have_attribute("data-project-dirty", "false")
            page.evaluate("(saved) => { window.__yadilabProjectStore.text = saved; }",
                          saved_after_ctrl)
            # PROJECT-005: even a correctly SHA-256-rehashed file must not
            # open into Builder when a link names an absent interface, or when
            # two interfaces of the same resource share the same identity.
            for corruption, expected_code in (
                ("unknown_port", "PROJECT_UNKNOWN_CONNECTION_PORT"),
                ("duplicate_interface", "PROJECT_DUPLICATE_INTERFACE_ID"),
            ):
                page.evaluate("""async ([saved, corruption]) => {
                    const forged = JSON.parse(saved);
                    const scenario = forged.content.source;
                    if (corruption === 'unknown_port') {
                        scenario.connections[0].from.port = 'ghost_port';
                    } else {
                        scenario.resources[0].interfaces =
                            [{ id: 'eth0' }, { id: 'eth0' }];
                    }
                    const raw = new TextEncoder().encode(JSON.stringify(forged.content));
                    const hash = await crypto.subtle.digest('SHA-256', raw);
                    forged.contentSha256 = [...new Uint8Array(hash)]
                        .map(n => n.toString(16).padStart(2, '0')).join('');
                    window.__yadilabProjectStore.text = JSON.stringify(forged);
                }""", [saved_after_ctrl, corruption])
                before_corrupt_open = page.evaluate(
                    "window.__yadilabProjectStore.writes")
                page.locator('[data-project-action="open"]').click()
                expect(page.locator('[data-project-message]')).to_contain_text(
                    expected_code, timeout=20000)
                require(page.locator(".app-frame").get_attribute(
                    "data-runtime-scenario-id") == "foundation_acceptance",
                    "Invalid network port reference replaced the active workspace")
                require(page.evaluate("window.__yadilabProjectStore.writes")
                        == before_corrupt_open,
                        "Rejected port identity unexpectedly wrote a project file")
                expect(controls).to_have_attribute("data-project-dirty", "false")
                page.evaluate(
                    "(saved) => { window.__yadilabProjectStore.text = saved; }",
                    saved_after_ctrl)
            # PROJECT-006: a valid checksum does not legitimize orphaned
            # evidence or annotations. Neither may replace the active Builder.
            for corruption, expected_code in (
                ("orphan_evidence", "PROJECT_UNKNOWN_EVIDENCE_TEST"),
                ("orphan_note", "PROJECT_UNKNOWN_NOTE_TARGET"),
            ):
                page.evaluate("""async ([saved, corruption]) => {
                    const forged = JSON.parse(saved);
                    const source = forged.content.source;
                    if (corruption === 'orphan_evidence') {
                        source.findings[0].evidenceTests = ['not_a_test'];
                    } else {
                        source.notes = [{ id: 'orphan_note',
                            text: 'Previously reviewed evidence',
                            target: 'not_a_resource' }];
                    }
                    const bytes = new TextEncoder().encode(JSON.stringify(forged.content));
                    const digest = await crypto.subtle.digest('SHA-256', bytes);
                    forged.contentSha256 = [...new Uint8Array(digest)]
                      .map(n => n.toString(16).padStart(2, '0')).join('');
                    window.__yadilabProjectStore.text = JSON.stringify(forged);
                }""", [saved_after_ctrl, corruption])
                before_orphan_open = page.evaluate("window.__yadilabProjectStore.writes")
                page.locator('[data-project-action="open"]').click()
                expect(page.locator('[data-project-message]')).to_contain_text(
                    expected_code, timeout=20000)
                require(page.locator(".app-frame").get_attribute(
                    "data-runtime-scenario-id") == "foundation_acceptance",
                    "Invalid evidence reference replaced the active Builder")
                require(page.evaluate("window.__yadilabProjectStore.writes")
                        == before_orphan_open,
                        "Invalid evidence reference caused an implicit file write")
                expect(controls).to_have_attribute("data-project-dirty", "false")
                page.evaluate(
                    "(saved) => { window.__yadilabProjectStore.text = saved; }",
                    saved_after_ctrl)
            # PROJECT-007: checksum-valid source instructions must not
            # point to missing solution resources, layout objects or zones.
            # Rejected Open cannot replace the active Builder or write bytes.
            for corruption, expected_code in (
                ("solution_target", "PROJECT_UNKNOWN_SOLUTION_TARGET"),
                ("layout_target", "PROJECT_UNKNOWN_LAYOUT_TARGET"),
                ("layout_parent", "PROJECT_UNKNOWN_LAYOUT_PARENT"),
            ):
                page.evaluate("""async ([saved, corruption]) => {
                    const forged = JSON.parse(saved);
                    const source = forged.content.source;
                    if (corruption === 'solution_target')
                        source.canonicalSolution.operations[0].target = 'missing_device';
                    else if (corruption === 'layout_target')
                        source.layoutHints[0].target = 'missing_device';
                    else
                        source.layoutHints[0].parent = 'missing_zone';
                    const bytes = new TextEncoder().encode(JSON.stringify(forged.content));
                    const digest = await crypto.subtle.digest('SHA-256', bytes);
                    forged.contentSha256 = [...new Uint8Array(digest)]
                        .map(n => n.toString(16).padStart(2, '0')).join('');
                    window.__yadilabProjectStore.text = JSON.stringify(forged);
                }""", [saved_after_ctrl, corruption])
                before_orphan_open = page.evaluate("window.__yadilabProjectStore.writes")
                page.locator('[data-project-action="open"]').click()
                expect(page.locator('[data-project-message]')).to_contain_text(
                    expected_code, timeout=20000)
                require(page.locator(".app-frame").get_attribute(
                    "data-runtime-scenario-id") == "foundation_acceptance",
                    "Orphan solution or layout reference replaced the active workspace")
                require(page.evaluate("window.__yadilabProjectStore.writes")
                        == before_orphan_open,
                        "Rejected solution or layout reference wrote a project file")
                expect(controls).to_have_attribute("data-project-dirty", "false")
                page.evaluate(
                    "(saved) => { window.__yadilabProjectStore.text = saved; }",
                    saved_after_ctrl)
            # PROJECT-009: a checksum-valid test referencing a deleted
            # resource, or troubleshooting evidence referencing a missing
            # device, must not replace Builder or trigger a disk write.
            for corruption, expected_code in (
                ("test_resource", "PROJECT_UNKNOWN_TEST_RESOURCE"),
                ("troubleshooting_source", "PROJECT_UNKNOWN_TROUBLESHOOTING_RESOURCE"),
                ("duplicate_requirement", "PROJECT_DUPLICATE_TROUBLESHOOTING_REQUIREMENT_ID"),
            ):
                page.evaluate("""async ([saved, corruption]) => {
                    const forged = JSON.parse(saved);
                    const source = forged.content.source;
                    if (corruption === "test_resource") {
                        source.tests.push({
                            id: "browser_audit", type: "identity.password_audit",
                            params: { target: "missing_device" },
                        });
                    } else {
                        source.troubleshootingObjectives = [{
                            id: "browser_evidence", title: "Network review",
                            required: true, evidenceOrder: "ordered",
                            requirements: [
                                { id: "observe", label: "Observe route",
                                  kind: "observation", targetId: "firewall01" },
                                { id: "probe", label: "Probe service",
                                  kind: "active_probe",
                                  sourceId: corruption === "troubleshooting_source"
                                    ? "missing_device" : "attacker",
                                  destinationId: "rds01" },
                            ],
                        }];
                        if (corruption === "duplicate_requirement") {
                            source.troubleshootingObjectives[0].requirements[1].id =
                                "observe";
                        }
                    }
                    const raw = new TextEncoder().encode(JSON.stringify(forged.content));
                    const sha = await crypto.subtle.digest("SHA-256", raw);
                    forged.contentSha256 = [...new Uint8Array(sha)]
                        .map(n => n.toString(16).padStart(2, "0")).join("");
                    window.__yadilabProjectStore.text = JSON.stringify(forged);
                }""", [saved_after_ctrl, corruption])
                before_blocked_open = page.evaluate(
                    "window.__yadilabProjectStore.writes")
                page.locator('[data-project-action="open"]').click()
                expect(page.locator('[data-project-message]')).to_contain_text(
                    expected_code, timeout=20000)
                require(page.locator(".app-frame").get_attribute(
                    "data-runtime-scenario-id") == "foundation_acceptance",
                    "Unknown test or troubleshooting resource replaced Builder")
                require(page.evaluate("window.__yadilabProjectStore.writes")
                        == before_blocked_open,
                        "Denied test or troubleshooting source caused disk writes")
                expect(controls).to_have_attribute("data-project-dirty", "false")
                page.evaluate(
                    "(saved) => { window.__yadilabProjectStore.text = saved; }",
                    saved_after_ctrl)
            # PROJECT-010: a schema-valid, freshly hashed file with a
            # dangling resource or test in any nested rule must not open.
            for corruption, expected_code in (
                ("missing_completion_resource", "PROJECT_UNKNOWN_RULE_RESOURCE"),
                ("missing_finding_test", "PROJECT_UNKNOWN_RULE_TEST"),
                ("nested_objective_resource", "PROJECT_UNKNOWN_RULE_RESOURCE"),
            ):
                page.evaluate("""async ([saved, corruption]) => {
                    const forged = JSON.parse(saved);
                    const source = forged.content.source;
                    if (corruption === 'missing_completion_resource') {
                        source.completion = {
                            op: 'reachable', from: 'missing_device', to: 'rds01',
                        };
                    } else if (corruption === 'missing_finding_test') {
                        source.findings[0].when = {
                            op: 'test_result', test: 'missing_test', expected: 'TRUE',
                        };
                    } else {
                        source.objectives[0].condition = {
                            op: 'all', rules: [{ op: 'not', rule: {
                                op: 'has_permission', subject: 'attacker',
                                resource: 'missing_device', permission: 'read',
                            } }],
                        };
                    }
                    const raw = new TextEncoder().encode(JSON.stringify(forged.content));
                    const digest = await crypto.subtle.digest('SHA-256', raw);
                    forged.contentSha256 = [...new Uint8Array(digest)]
                        .map(n => n.toString(16).padStart(2, '0')).join('');
                    window.__yadilabProjectStore.text = JSON.stringify(forged);
                }""", [saved_after_ctrl, corruption])
                before_bad_rule = page.evaluate("window.__yadilabProjectStore.writes")
                page.locator('[data-project-action="open"]').click()
                expect(page.locator('[data-project-message]')).to_contain_text(
                    expected_code, timeout=20000)
                require(page.locator(".app-frame").get_attribute(
                    "data-runtime-scenario-id") == "foundation_acceptance",
                    "Dangling rule reference replaced active Builder")
                require(page.evaluate("window.__yadilabProjectStore.writes")
                        == before_bad_rule,
                        "Invalid rule caused implicit disk write")
                expect(controls).to_have_attribute("data-project-dirty", "false")
                page.evaluate(
                    "(saved) => { window.__yadilabProjectStore.text = saved; }",
                    saved_after_ctrl)
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
            page.evaluate("""() => {
                window.__yadilabProjectStore.chooseAlternative = true;
                window.__yadilabProjectStore.permissionDenied = true;
            }""")
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

            # Independent Chromium page: an external conflict must quarantine
            # the file across later Save As attempts and new handle objects.
            recovery = context.new_page()
            recovery.add_init_script(MOCK)
            recovery.on("pageerror", lambda error: errors.append(str(error)))
            recovery.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            rcontrols = recovery.locator('[data-project-file-controls="ready"]')
            expect(rcontrols).to_be_visible(timeout=45000)
            recovery.locator('[data-project-action="save-as"]').click()
            expect(recovery.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            rsection = recovery.locator("details.control-section").filter(
                has_text="Builder Inspector & Authoring")
            if rsection.get_attribute("open") is None:
                rsection.locator("summary").first.click()
            rmission = recovery.locator('[data-builder-inspector="mission"]')
            expect(rmission).to_be_visible(timeout=15000)
            rmission.locator("label.inspector-field", has_text="Title").locator(
                "input").fill("RECOVERY-PROJECT-UNSAVED")
            rmission.get_by_role("button", name="Verkställ inspektörsändringar").click()
            expect(rcontrols).to_have_attribute("data-project-dirty", "true")
            recovery.evaluate("window.__yadilabProjectStore.text += ' OUTSIDE_EDITOR'")
            before_recovery_writes = recovery.evaluate(
                "window.__yadilabProjectStore.writes")
            expected_external_recovery = recovery.evaluate(
                "window.__yadilabProjectStore.text")
            recovery.keyboard.press("Control+s")
            expect(recovery.locator('[data-project-message]')).to_contain_text(
                "PROJECT_EXTERNAL_FILE_CHANGED", timeout=15000)
            recovery.locator('[data-project-action="save-as"]').click()
            expect(recovery.locator('[data-project-message]')).to_contain_text(
                "PROJECT_FILE_REQUIRES_REOPEN", timeout=15000)
            recovery.evaluate("window.__yadilabProjectStore.aliasSameEntryOnSaveAs = true")
            recovery.locator('[data-project-action="save-as"]').click()
            expect(recovery.locator('[data-project-message]')).to_contain_text(
                "PROJECT_FILE_REQUIRES_REOPEN", timeout=15000)
            require(recovery.evaluate("window.__yadilabProjectStore.writes") ==
                    before_recovery_writes, "Quarantined disk entry was overwritten")
            require(recovery.evaluate("window.__yadilabProjectStore.text") ==
                    expected_external_recovery, "External project edits were lost")
            # Save to a physically distinct file is allowed and verified.
            recovery.evaluate("window.__yadilabProjectStore.chooseAlternative = true")
            recovery.locator('[data-project-action="save-as"]').click()
            expect(recovery.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=15000)
            require("RECOVERY-PROJECT-UNSAVED" in recovery.evaluate(
                "window.__yadilabProjectStore.otherText"),
                "Save As to different file lost current editable source")
            expect(rcontrols).to_have_attribute("data-project-dirty", "false")
            # A successful different-file Save must NOT erase quarantine
            # of the original failed physical entry.
            recovery.evaluate("""() => {
                window.__yadilabProjectStore.chooseAlternative = false;
                window.__yadilabProjectStore.aliasSameEntryOnSaveAs = false;
            }""")
            recovery.locator('[data-project-action="save-as"]').click()
            expect(recovery.locator('[data-project-message]')).to_contain_text(
                "PROJECT_FILE_REQUIRES_REOPEN", timeout=15000)
            require(recovery.evaluate("window.__yadilabProjectStore.writes") ==
                    before_recovery_writes,
                    "Another successful file Save incorrectly cleared old quarantine")
            # Ordinary Ctrl+S remains functional on the newly associated file.
            other_before = recovery.evaluate("window.__yadilabProjectStore.otherWrites")
            recovery.keyboard.press("Control+s")
            expect(recovery.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=15000)
            require(recovery.evaluate("window.__yadilabProjectStore.otherWrites") ==
                    other_before + 1, "Ctrl+S did not use the safe alternate file")
            recovery.close()

            # A fresh Save As to a *different*, already populated project file
            # must not replace it. The OS picker choosing it is not an excuse
            # to overwrite unrelated user data.
            existing_target = context.new_page()
            existing_target.add_init_script(MOCK)
            existing_target.on("pageerror", lambda error: errors.append(str(error)))
            existing_target.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            econtrols = existing_target.locator('[data-project-file-controls="ready"]')
            expect(econtrols).to_be_visible(timeout=45000)
            existing_target.evaluate("""() => {
                const disk = window.__yadilabProjectStore;
                disk.chooseAlternative = true;
                disk.otherText = "DO_NOT_OVERWRITE_UNRELATED_PROJECT";
            }""")
            existing_target.locator('[data-project-action="save-as"]').click()
            expect(existing_target.locator('[data-project-message]')).to_contain_text(
                "PROJECT_DESTINATION_NOT_EMPTY", timeout=15000)
            require(existing_target.evaluate("window.__yadilabProjectStore.otherText") ==
                    "DO_NOT_OVERWRITE_UNRELATED_PROJECT",
                    "Save As erased the unrelated existing .yadilab file")
            require(existing_target.evaluate("window.__yadilabProjectStore.otherWrites") == 0,
                    "Save As wrote to an existing project despite nonempty destination")
            expect(econtrols).to_have_attribute("data-project-dirty", "true")
            existing_target.close()

            # Save As must reject a stale Builder source even when the change
            # happens WHILE awaiting the native isSameEntry() identity check.
            stale = context.new_page()
            stale.add_init_script(MOCK)
            stale.on("pageerror", lambda error: errors.append(str(error)))
            stale.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            scontrols = stale.locator('[data-project-file-controls="ready"]')
            expect(scontrols).to_be_visible(timeout=45000)
            stale.locator('[data-project-action="save-as"]').click()
            expect(stale.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            stale_section = stale.locator("details.control-section").filter(
                has_text="Builder Inspector & Authoring")
            if stale_section.get_attribute("open") is None:
                stale_section.locator("summary").first.click()
            stale_inspector = stale.locator('[data-builder-inspector="mission"]')
            expect(stale_inspector).to_be_visible(timeout=15000)
            title = stale_inspector.locator(
                "label.inspector-field", has_text="Title").locator("input")
            title.fill("EDIT BEFORE SAVE AS")
            stale_inspector.get_by_role(
                "button", name="Verkställ inspektörsändringar").click()
            expect(scontrols).to_have_attribute("data-project-dirty", "true")
            stale.evaluate("""() => {
                const s = window.__yadilabProjectStore;
                s.aliasSameEntryOnSaveAs = true;
                s.pauseIdentity = true;
            }""")
            old_data = stale.evaluate("window.__yadilabProjectStore.text")
            old_writes = stale.evaluate("window.__yadilabProjectStore.writes")
            stale.locator('[data-project-action="save-as"]').click()
            stale.wait_for_function(
                "window.__yadilabProjectStore.pendingIdentity === true",
                timeout=15000)
            title.fill("EDIT AFTER FILE IDENTITY STARTED")
            stale_inspector.get_by_role(
                "button", name="Verkställ inspektörsändringar").click()
            expect(scontrols).to_have_attribute("data-project-dirty", "true")
            stale.evaluate("""() => {
                const s = window.__yadilabProjectStore;
                s.pauseIdentity = false;
                s.releaseIdentity();
            }""")
            expect(stale.locator('[data-project-message]')).to_contain_text(
                "PROJECT_STALE_BEFORE_WRITE", timeout=15000)
            require(stale.evaluate("window.__yadilabProjectStore.writes") == old_writes,
                    "Save As wrote stale Builder bytes after identity wait")
            require(stale.evaluate("window.__yadilabProjectStore.text") == old_data,
                    "Save As changed disk despite newer in-memory edits")
            expect(scontrols).to_have_attribute("data-project-dirty", "true")
            # The blocked save must not quarantine a file that was never written.
            # A new Ctrl+S must still save the current Builder content.
            stale.keyboard.press("Control+s")
            expect(stale.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=15000)
            require(stale.evaluate("window.__yadilabProjectStore.writes") ==
                    old_writes + 1, "Ctrl+S failed after a stale Save As refusal")
            require("EDIT AFTER FILE IDENTITY STARTED" in stale.evaluate(
                "window.__yadilabProjectStore.text"),
                "Recovered Ctrl+S saved the stale source rather than latest edits")
            expect(scontrols).to_have_attribute("data-project-dirty", "false")
            stale.close()

            # PROJECT-013: replacing a saved Builder scenario through the
            # actual Scenario Studio UI must detach the old native file.
            # Ctrl+S must not silently overwrite the prior scenario file.
            different_scenario = context.new_page()
            different_scenario.add_init_script(MOCK)
            different_scenario.on("pageerror", lambda error: errors.append(str(error)))
            different_scenario.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            different_controls = different_scenario.locator(
                '[data-project-file-controls="ready"]')
            expect(different_controls).to_be_visible(timeout=45000)
            different_scenario.locator('[data-project-action="save-as"]').click()
            expect(different_scenario.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            previous_bytes = different_scenario.evaluate(
                "window.__yadilabProjectStore.text")
            previous_writes = different_scenario.evaluate(
                "window.__yadilabProjectStore.writes")
            different_scenario.evaluate("""() => {
                const input = document.querySelector('[data-studio-scenario-id]');
                const studio = document.querySelector('[data-scenario-studio]');
                if (!input || !studio)
                    throw new Error('PROJECT-013 Scenario Studio missing');
                let parent = studio.closest('details');
                while (parent) {
                    parent.open = true;
                    parent = parent.parentElement?.closest('details') ?? null;
                }
            }""")
            different_scenario.locator(
                '[data-studio-scenario-id]').fill("project_013_unrelated")
            different_scenario.locator('[data-studio-action="create"]').click()
            expect(different_scenario.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "project_013_unrelated")
            expect(different_controls).to_have_attribute(
                "data-project-filename", "project_013_unrelated.yadilab")
            expect(different_controls).to_have_attribute("data-project-dirty", "true")
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.text") == previous_bytes,
                "Loading another scenario changed the previous project file")
            different_scenario.keyboard.press("Control+s")
            # Scenario Studio deliberately starts with an incomplete draft:
            # schema validation must fail before any native target is touched.
            expect(different_scenario.locator('[data-project-message]')).to_contain_text(
                "PROJECT_SOURCE_SCHEMA_INVALID", timeout=20000)
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.text") == previous_bytes,
                "New scenario overwrote the original .yadilab through inherited handle")
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.writes") == previous_writes,
                "New scenario performed an unintended write to the old project")
            expect(different_controls).to_have_attribute("data-project-dirty", "true")
            different_scenario.close()
            # PROJECT-014: a new scenario can reuse the SAME canonical
            # scenarioId but represents a distinct authored project. The
            # previous native handle/verified baseline must be detached.
            reused_id = context.new_page()
            reused_id.add_init_script(MOCK)
            reused_id.on("pageerror", lambda error: errors.append(str(error)))
            reused_id.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            ric = reused_id.locator('[data-project-file-controls="ready"]')
            expect(ric).to_be_visible(timeout=45000)
            prior_scenario_id = reused_id.locator(".app-frame").get_attribute(
                "data-runtime-scenario-id")
            reused_id.locator('[data-project-action="save-as"]').click()
            expect(reused_id.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            prior_file_bytes = reused_id.evaluate(
                "window.__yadilabProjectStore.text")
            prior_file_writes = reused_id.evaluate(
                "window.__yadilabProjectStore.writes")
            prior_native_name = ric.get_attribute("data-project-filename")
            require(prior_native_name == "verified-network.yadilab",
                    "PROJECT-014 baseline native file handle was not associated")
            reused_id.evaluate("""() => {
                const section = document.querySelector('[data-scenario-studio]');
                if (!section) throw new Error("PROJECT-014 studio unavailable");
                let parent = section.closest('details');
                while (parent) {
                    parent.open = true;
                    parent = parent.parentElement?.closest('details') ?? null;
                }
            }""")
            reused_id.locator(
                '[data-studio-scenario-id]').fill(prior_scenario_id)
            reused_id.locator('[data-studio-action="create"]').click()
            expect(reused_id.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", prior_scenario_id)
            expect(ric).to_have_attribute(
                "data-project-filename", prior_scenario_id + ".yadilab")
            expect(ric).to_have_attribute("data-project-dirty", "true")
            require(reused_id.evaluate(
                "window.__yadilabProjectStore.text") == prior_file_bytes,
                "Same-ID scenario replacement unexpectedly modified prior disk bytes")
            reused_id.keyboard.press("Control+s")
            expect(reused_id.locator('[data-project-message]')).to_contain_text(
                "PROJECT_SOURCE_SCHEMA_INVALID", timeout=20000)
            require(reused_id.evaluate(
                "window.__yadilabProjectStore.writes") == prior_file_writes,
                "Same-ID Studio draft overwrote the previous native project")
            require(reused_id.evaluate(
                "window.__yadilabProjectStore.text") == prior_file_bytes,
                "Same-ID Studio draft changed the prior project on disk")
            expect(ric).to_have_attribute("data-project-dirty", "true")
            reused_id.close()
            # Asynchronous Validate & Compile cannot resurrect a previous
            # canonical source after New has replaced it. Trigger both actions
            # within one JS task so compilation is still suspended at await.
            compile_race = context.new_page()
            compile_race.add_init_script(MOCK)
            compile_race.on("pageerror", lambda error: errors.append(str(error)))
            compile_race.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            crc = compile_race.locator('[data-project-file-controls="ready"]')
            expect(crc).to_be_visible(timeout=45000)
            compile_race.evaluate("""() => {
                const compile = document.querySelector('[data-studio-action="validate-compile"]');
                const newer = document.querySelector('[data-project-action="new"]');
                if (!compile || !newer || compile.disabled || newer.disabled)
                    throw new Error("PROJECT_COMPILE_RACE_TEST_CONTROLS_UNAVAILABLE");
                compile.click();
                newer.click();
            }""")
            expect(compile_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project", timeout=15000)
            expect(crc).to_have_attribute("data-project-dirty", "true")
            # Allow the suspended compiler and any layout microtasks to settle.
            # Without the guard, their result could reset New to old source.
            compile_race.wait_for_timeout(1500)
            expect(compile_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            expect(crc).to_have_attribute("data-project-dirty", "true")
            require(compile_race.evaluate("window.__yadilabProjectStore.writes") == 0,
                    "Stale compilation caused an implicit project-file write")
            compile_race.close()

            # Starting a built-in scenario concurrently with operator New must
            # never resurrect a Runtime from the superseded launch. The unit
            # contract above separately enforces the post-ELK await boundary.
            for scenario_button in (
                "Starta enterprise-labb", "Starta verifierad leveransdemo",
                "Starta guidad labb",
            ):
                launch_race = context.new_page()
                launch_race.add_init_script(MOCK)
                launch_race.on("pageerror", lambda error: errors.append(str(error)))
                launch_race.goto(a.url, wait_until="domcontentloaded", timeout=30000)
                launch_controls = launch_race.locator('[data-project-file-controls="ready"]')
                expect(launch_controls).to_be_visible(timeout=45000)
                launch_race.evaluate("""(name) => {
                    const menu = [...document.querySelectorAll('.workspace-menu')]
                        .find(e => e.querySelector('summary')?.textContent?.includes('Lab & Scenario'));
                    const start = [...(menu?.querySelectorAll('button') ?? [])]
                        .find(e => e.textContent?.trim() === name);
                    const fresh = document.querySelector('[data-project-action="new"]');
                    if (!start || !fresh || start.disabled || fresh.disabled)
                        throw new Error("PROJECT_LAB_RACE_CONTROLS_UNAVAILABLE: " + name);
                    start.click();
                    fresh.click();
                }""", scenario_button)
                expect(launch_race.locator(".app-frame")).to_have_attribute(
                    "data-runtime-scenario-id", "new_project", timeout=15000)
                expect(launch_controls).to_have_attribute("data-project-dirty", "true")
                launch_race.wait_for_timeout(700)
                expect(launch_race.locator(".app-frame")).to_have_attribute(
                    "data-runtime-scenario-id", "new_project")
                require(launch_race.evaluate("window.__yadilabProjectStore.writes") == 0,
                        "Superseded lab launch implicitly wrote a project file: "
                        + scenario_button)
                launch_race.close()

            # A valid runtime progress file may take time to read. If the user
            # creates New while File.text() is unresolved, that old progress
            # must NOT resurrect the prior runtime after the read completes.
            restore_race = context.new_page()
            restore_race.add_init_script(MOCK)
            restore_race.on("pageerror", lambda error: errors.append(str(error)))
            restore_race.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            rrc = restore_race.locator('[data-project-file-controls="ready"]')
            expect(rrc).to_be_visible(timeout=45000)
            # Reuse the *known compilable* authored-source path exercised
            # earlier in this suite, rather than relying on an untouched
            # welcome draft being Runtime-ready at its initial render.
            inspector_section = restore_race.locator(
                "details.control-section").filter(
                    has_text="Builder Inspector & Authoring")
            if inspector_section.get_attribute("open") is None:
                inspector_section.locator("summary").first.click()
            inspector = restore_race.locator('[data-builder-inspector="mission"]')
            expect(inspector).to_be_visible(timeout=15000)
            inspector.locator("label.inspector-field", has_text="Title").locator(
                "input").fill("PROJECT-001 runtime restore source")
            inspector.get_by_role(
                "button", name="Verkställ inspektörsändringar").click()
            expect(rrc).to_have_attribute("data-project-dirty", "true")
            rstudio = restore_race.locator("details.control-section").filter(
                has_text="Scenario & Builder")
            if rstudio.get_attribute("open") is None:
                rstudio.locator("summary").first.click()
            compile_button = restore_race.locator(
                '[data-studio-action="validate-compile"]')
            compile_button.click()
            try:
                expect(compile_button).to_be_disabled(timeout=30000)
            except AssertionError as error:
                status = restore_race.locator(
                    '[data-studio-draft-revision]').inner_text()
                raise AssertionError(
                    "Runtime fixture compilation did not become valid: " + status) from error
            run_menu = restore_race.locator(".workspace-menu", has=restore_race.locator(
                "summary", has_text="Run & Preview"))
            if run_menu.get_attribute("open") is None:
                run_menu.locator("summary").click()
            preview = run_menu.get_by_role("button", name="Förhandsvisa körläge")
            expect(preview).to_be_enabled(timeout=30000)
            preview.click()
            expect(restore_race.locator(".app-frame")).not_to_have_attribute(
                "data-runtime-scenario-hash", "builder", timeout=20000)
            export_menu = restore_race.locator(".workspace-menu", has=restore_race.locator(
                "summary", has_text="Import / Export"))
            if export_menu.get_attribute("open") is None:
                export_menu.locator("summary").click()
            with restore_race.expect_download(timeout=15000) as progress_download:
                export_menu.get_by_role("button", name="Exportera framsteg").click()
            saved_progress = Path(progress_download.value.path()).read_bytes()
            require(saved_progress.startswith(b"{") and len(saved_progress) > 30,
                    "Could not generate a genuine runtime progress fixture")

            restore_race.evaluate("""() => {
                const originalText = File.prototype.text;
                window.__staleRuntimeFileRead = { pending: false, release: null };
                File.prototype.text = function() {
                  if (!this.name.endsWith(".yadiprogress"))
                    return originalText.call(this);
                  const file = this;
                  return new Promise(resolve => {
                    window.__staleRuntimeFileRead.pending = true;
                    window.__staleRuntimeFileRead.release = () => {
                      window.__staleRuntimeFileRead.pending = false;
                      resolve(originalText.call(file));
                    };
                  });
                };
            }""")
            progress_input = restore_race.locator('[data-menu-action="load-progress"]')
            expect(progress_input).to_have_count(1)
            progress_input.set_input_files({
                "name": "scenario.yadiprogress", "mimeType": "application/json",
                "buffer": saved_progress,
            })
            restore_race.wait_for_function(
                "window.__staleRuntimeFileRead?.pending === true", timeout=15000)
            # The authored Builder source may still be unsaved in Runtime,
            # so explicitly confirm the user-requested replacement.
            restore_race.once("dialog", lambda dialog: dialog.accept())
            restore_race.locator('[data-project-action="new"]').click()
            expect(restore_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project", timeout=15000)
            expect(rrc).to_have_attribute("data-project-dirty", "true")
            restore_race.evaluate("window.__staleRuntimeFileRead.release()")
            restore_race.wait_for_timeout(500)
            expect(restore_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            expect(rrc).to_have_attribute("data-project-dirty", "true")
            require(restore_race.evaluate("window.__yadilabProjectStore.writes") == 0,
                    "Stale runtime restore unexpectedly wrote a project file")
            restore_race.close()
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
                "externalEditDuringWritableOpenDenied": True,
                "quarantinedFailedTargetCannotBeReselected": True,
                "quarantinePersistsAfterSavingElsewhere": True,
                "differentFileRecoveryAndCtrlS": True,
                "unrelatedExistingSaveAsDenied": True,
                "staleSourceDuringIdentityDenied": True,
                "recoveredSavePersistsNewerBuilder": True,
                "staleAsyncCompileCannotResurrectOldProject": True,
                "staleRuntimeProgressCannotResurrectOldProject": True,
                "threeAsyncLabStartsCannotReplaceNewProject": True,
                "unrelatedBuilderDetachesFile": True,
                "nodeCount": 4, "connectionCount": 3,
            }
            (a.evidence_dir / "project-file-real-chromium.json").write_text(
                json.dumps(report, indent=2) + "\n")
            print("PASS PROJECT-001 compiled Chromium: native Save/readback, dirty New, Ctrl+S,"
                  " external conflict, stale identity, async compile, 3 lab starts, runtime restore and write-open race blocked, failed-target quarantine, unrelated-file overwrite denied, permission denial, cancel, fallback download,"
                  " runtime→Builder unsaved restore, tampered file denied")
        finally:
            browser.close()
if __name__ == "__main__":
    main()

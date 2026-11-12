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


def fill_value(control, value):
    # Use the native setter directly so hidden sibling editors in the
    # multi-panel draft guard do not block on Playwright's visibility gate.
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


def choose(control, value):
    expect(control.locator(f'option[value="{value}"]')).to_have_count(1, timeout=120000)
    return control.select_option(value)


MOCK = r"""
(() => {
  const store = { text: "", writes: 0, fail: false, reads: 0,
    permissionDenied: false, cancelSave: false, cancelOpen: false,
    aliasSameEntryOnSaveAs: false, editDuringWritableOpen: false, abortedWrites: 0,
    injectBomAfterClose: false, nativeName: "verified-network.yadilab",
    suggestedName: null,
    chooseAlternative: false, otherText: "", otherWrites: 0,
    pauseIdentity: false, pendingIdentity: false, releaseIdentity: null,
    pauseOpenPicker: false, pendingOpenPicker: false, releaseOpenPicker: null,
    openPickerCalls: 0, editAfterOpenSnapshot: false,
    pauseWritableOpen: false, pendingWritableOpen: false, releaseWritableOpen: null };
  const handle = {
    get name() { return store.nativeName; },
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
        async close() {
          // External writer changes bytes after the app has written but
          // before readback; TextDecoder will erase this leading UTF-8 BOM.
          store.text = store.injectBomAfterClose ? String.fromCharCode(0xFEFF) + pending : pending;
          store.writes++;
        },
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
    configurable: true, value: async (options) => {
      store.suggestedName = options?.suggestedName;
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
            # PROJECT-050: a .yadilab can carry a perfectly correct SHA-256
            # of a broken Foundation test. Actual Chromium Open must validate
            # original resource selectors and port/protocol declarations,
            # never silently restoring a different network query or mutating
            # the already active Builder. All files are constructed from an
            # authentic explicit Save As and rehashed in browser WebCrypto.
            malformed_open = context.new_page()
            malformed_open.add_init_script(MOCK)
            malformed_open.on("pageerror",lambda error: errors.append(str(error)))
            malformed_open.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            moc = malformed_open.locator('[data-project-file-controls="ready"]')
            expect(moc).to_be_visible(timeout=45000)
            malformed_open.locator('[data-project-action="save-as"]').click()
            expect(malformed_open.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            clean_file=malformed_open.evaluate("window.__yadilabProjectStore.text")
            require(malformed_open.evaluate(
                "window.__yadilabProjectStore.writes")==1,
                "Expected one explicit native Save As before forged Open tests")
            for case_name,test_case,expected_code in [
                ("missing_reachability_source",
                 {"id":"project_050_missing_from",
                  "type":"network.reachability",
                  "params":{"from":"ghost","to":"rds01",
                            "protocol":"tcp","port":3389}},
                 "PROJECT_UNKNOWN_TEST_RESOURCE"),
                ("invalid_route_protocol",
                 {"id":"project_050_bad_route",
                  "type":"network.route_test",
                  "params":{"from":"attacker","to":"rds01",
                            "protocol":"broken"}},
                 "PROJECT_TEST_PARAM_INVALID"),
                ("missing_membership_group",
                 {"id":"project_050_bad_group",
                  "type":"identity.membership",
                  "params":{"subject":"attacker","group":"ghost"}},
                 "PROJECT_UNKNOWN_TEST_RESOURCE"),
                ("ambiguous_scan_ports",
                 {"id":"project_050_scan",
                  "type":"network.port_scan",
                  "params":{"from":"attacker","to":"rds01",
                            "port":443,"ports":[22]}},
                 "PROJECT_TEST_PARAM_AMBIGUOUS"),
                ("hardening_without_equals",
                 {"id":"project_050_hardening",
                  "type":"windows.hardening_check",
                  "params":{"target":"rds01","path":"properties.enabled"}},
                 "PROJECT_TEST_PARAM_REQUIRED"),
            ]:
                malformed_open.evaluate("""async ({original,test}) => {
                    const store=window.__yadilabProjectStore;
                    const doc=JSON.parse(original);
                    doc.content.source.tests.push(test);
                    const raw=JSON.stringify(doc.content);
                    const hash=await crypto.subtle.digest(
                        'SHA-256',new TextEncoder().encode(raw));
                    doc.contentSha256=Array.from(new Uint8Array(hash))
                        .map(b=>b.toString(16).padStart(2,'0')).join('');
                    store.text=JSON.stringify(doc);
                }""",{"original":clean_file,"test":test_case})
                malformed_open.locator('[data-project-action="open"]').click()
                expect(malformed_open.locator(
                    '[data-project-message]')).to_contain_text(
                    expected_code,timeout=20000)
                expect(malformed_open.locator(".app-frame")).to_have_attribute(
                    "data-runtime-scenario-id","foundation_acceptance")
                expect(moc).to_have_attribute("data-project-dirty","false")
                require(malformed_open.evaluate(
                    "window.__yadilabProjectStore.writes")==1,
                    "A correctly hashed malformed file caused a hidden write: "+case_name)
                require(malformed_open.evaluate(
                    "window.__yadilabProjectStore.openPickerCalls")>=1,
                    "Malformed source was never passed through real native Open")
            malformed_open.evaluate(
                "(original) => window.__yadilabProjectStore.text=original",
                clean_file)
            malformed_open.locator('[data-project-action="open"]').click()
            expect(malformed_open.locator('[data-project-message]')).to_contain_text(
                "Opened editable source",timeout=20000)
            expect(moc).to_have_attribute("data-project-dirty","false")
            require(malformed_open.evaluate(
                "window.__yadilabProjectStore.writes")==1,
                "Valid original project Open triggered an implicit write")
            malformed_open.close()

            # PROJECT-025: File System Access picker types are advisory on some
            # platforms. Never write to a .json or other unexpected filename
            # and then display a fictional .yadilab name as successfully saved.
            wrong_extension = context.new_page()
            wrong_extension.add_init_script(MOCK)
            wrong_extension.on("pageerror", lambda error: errors.append(str(error)))
            wrong_extension.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            wec = wrong_extension.locator('[data-project-file-controls="ready"]')
            expect(wec).to_be_visible(timeout=45000)
            wrong_extension.locator('[data-project-action="new"]').click()
            expect(wec).to_have_attribute("data-project-dirty", "true")
            wrong_extension.evaluate("""() => {
                window.__originalSavePicker = window.showSaveFilePicker;
                Object.defineProperty(window, 'showSaveFilePicker', {
                    configurable: true, value: async () => ({
                    name: 'misleading-project.json',
                    async createWritable() {
                        window.__yadilabProjectStore.writes++;
                        throw Error('UNEXPECTED_INVALID_EXTENSION_WRITE');
                    },
                    async getFile() { return new File([], 'misleading-project.json'); },
                }) });
            }""")
            wrong_extension.locator('[data-project-action="save-as"]').click()
            expect(wrong_extension.locator('[data-project-message]')).to_contain_text(
                "PROJECT_FILE_EXTENSION_INVALID", timeout=20000)
            require(wrong_extension.evaluate("window.__yadilabProjectStore.writes") == 0,
                    "PROJECT-025 invalid picker file was written")
            expect(wec).to_have_attribute("data-project-dirty", "true")
            expect(wec).to_have_attribute("data-project-filename", "Untitled.yadilab")
            wrong_extension.evaluate("""() => {
                Object.defineProperty(window, 'showSaveFilePicker', {
                    configurable: true, value: window.__originalSavePicker,
                });
            }""")
            wrong_extension.locator('[data-project-action="save-as"]').click()
            expect(wrong_extension.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            require(wrong_extension.evaluate("window.__yadilabProjectStore.writes") == 1,
                    "PROJECT-025 valid .yadilab recovery did not write exactly once")
            require(wrong_extension.evaluate(
                "window.__yadilabProjectStore.suggestedName") == "Untitled.yadilab",
                "PROJECT-031 New -> Save As proposed a filename different from the displayed Untitled project")
            expect(wec).to_have_attribute("data-project-dirty", "false")
            wrong_extension.close()
            # PROJECT-031: Open must display the ACTUAL filename from the
            # selected native File, including long basenames. The normal
            # filename helper truncates to 100 chars for newly suggested
            # names and must never be applied to an existing disk identity.
            long_open = context.new_page()
            long_open.add_init_script(MOCK)
            long_open.on("pageerror", lambda error: errors.append(str(error)))
            long_open.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            loc = long_open.locator('[data-project-file-controls="ready"]')
            expect(loc).to_be_visible(timeout=45000)
            long_open.locator('[data-project-action="save-as"]').click()
            expect(long_open.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            real_name = "long_project_" + "n" * 112 + ".yadilab"
            long_open.evaluate("""(name) => {
                window.__yadilabProjectStore.nativeName = name;
            }""", real_name)
            long_open.locator('[data-project-action="open"]').click()
            expect(long_open.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            expect(loc).to_have_attribute("data-project-filename", real_name)
            expect(loc).to_have_attribute("data-project-dirty", "false")
            # The original bound native handle must remain usable even when
            # its name exceeds the suggested-name sanitization limit.
            long_open.keyboard.press("Control+s")
            expect(long_open.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            expect(loc).to_have_attribute("data-project-filename", real_name)
            require(long_open.evaluate("window.__yadilabProjectStore.writes") == 2,
                    "PROJECT-031 long-name Open lost its associated native Save handle")
            long_open.close()

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
                '[data-project-message]').text_content().startswith(
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
            # PROJECT-020: input.cancel must not release the Open lock after
            # change has already supplied a selected File. Its asynchronous
            # checksum/schema read may still be unresolved; a spurious late
            # cancel cannot allow New/Save As/another Open in the meantime.
            selected_read = context.new_page()
            selected_read.add_init_script(MOCK)
            selected_read.on("pageerror", lambda error: errors.append(str(error)))
            selected_read.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            src = selected_read.locator('[data-project-file-controls="ready"]')
            expect(src).to_be_visible(timeout=45000)
            selected_read.locator('[data-project-action="save-as"]').click()
            expect(selected_read.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            saved_selected_read = selected_read.evaluate(
                "window.__yadilabProjectStore.text")
            writes_selected_read = selected_read.evaluate(
                "window.__yadilabProjectStore.writes")
            selected_read.evaluate("""() => {
                delete window.showOpenFilePicker;
                const store = window.__yadilabProjectStore;
                store.pendingSelectedRead = false;
                store.releaseSelectedRead = null;
                const original = Blob.prototype.arrayBuffer;
                File.prototype.arrayBuffer = function() {
                    if (this.name !== 'inflight-fallback.yadilab')
                        return original.call(this);
                    store.pendingSelectedRead = true;
                    return new Promise((resolve, reject) => {
                        store.releaseSelectedRead = () =>
                            original.call(this).then(resolve, reject);
                    });
                };
            }""")
            selected_choosers = []
            selected_read.on(
                "filechooser", lambda chooser: selected_choosers.append(chooser))
            with selected_read.expect_file_chooser() as read_chooser_info:
                selected_read.locator('[data-project-action="open"]').click()
            read_chooser_info.value.set_files({
                "name": "inflight-fallback.yadilab",
                "mimeType": "application/json",
                "buffer": saved_selected_read.encode("utf-8"),
            })
            selected_read.wait_for_function(
                "window.__yadilabProjectStore.pendingSelectedRead === true",
                timeout=15000)
            selected_read.evaluate("""() => {
                const input = document.querySelector('[data-project-input]');
                input.dispatchEvent(new Event('cancel', { bubbles: true }));
                document.querySelector('[data-project-action="new"]').click();
                document.querySelector('[data-project-action="save-as"]').click();
                document.querySelector('[data-project-action="open"]').click();
            }""")
            expect(selected_read.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "foundation_acceptance")
            expect(src).to_have_attribute(
                "data-project-filename", "verified-network.yadilab")
            require(len(selected_choosers) == 1,
                    "A second fallback chooser launched during selected file read")
            require(selected_read.evaluate(
                "window.__yadilabProjectStore.writes") == writes_selected_read,
                "Late cancel unlocked Save As during selected file read")
            selected_read.evaluate("""() => {
                window.__yadilabProjectStore.releaseSelectedRead();
            }""")
            expect(selected_read.locator('[data-project-message]')).to_contain_text(
                "Opened editable source", timeout=20000)
            expect(src).to_have_attribute(
                "data-project-filename", "inflight-fallback.yadilab")
            expect(src).to_have_attribute("data-project-dirty", "false")
            require(selected_read.evaluate(
                "window.__yadilabProjectStore.writes") == writes_selected_read,
                "Pending fallback Open caused an implicit project write")
            selected_read.close()

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
            # PROJECT-027: an in-flight native Save must be visible and
            # competing project actions visibly disabled, not silent no-ops.
            expect(ug_controls).to_have_attribute("data-project-operation", "saving")
            expect(unload_guard.locator('[data-project-message]')).to_contain_text(
                "Saving project", timeout=10000)
            for action in ("new", "open", "save", "save-as"):
                expect(unload_guard.locator(
                    f'[data-project-action="{action}"]')).to_be_disabled()
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
            expect(ug_controls).to_have_attribute("data-project-operation", "idle")
            expect(unload_guard.locator(
                '[data-project-action="save"]')).to_be_enabled()
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

            # PROJECT-029: no native Save may claim verified success when
            # physical disk bytes change to BOM + original JSON after close.
            # Decoder-normalized text would look identical; byte truth must win.
            readback_bom = context.new_page()
            readback_bom.add_init_script(MOCK)
            readback_bom.on("pageerror", lambda error: errors.append(str(error)))
            readback_bom.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            rbc = readback_bom.locator('[data-project-file-controls="ready"]')
            expect(rbc).to_be_visible(timeout=45000)
            readback_bom.evaluate(
                "window.__yadilabProjectStore.injectBomAfterClose = true")
            readback_bom.locator('[data-project-action="save-as"]').click()
            expect(readback_bom.locator('[data-project-message]')).to_contain_text(
                "PROJECT_READBACK_MISMATCH", timeout=20000)
            expect(rbc).to_have_attribute("data-project-dirty", "true")
            original_bom_disk = readback_bom.evaluate(
                "window.__yadilabProjectStore.text")
            require(original_bom_disk.startswith(chr(0xFEFF)),
                    "PROJECT-029 fixture did not add physical UTF-8 BOM")
            require(readback_bom.evaluate("window.__yadilabProjectStore.writes") == 1,
                    "Readback rejection must preserve the attempted native disk write")
            require(readback_bom.evaluate("""() => {
                const event = new Event('beforeunload', {cancelable:true});
                window.dispatchEvent(event);
                return event.defaultPrevented;
            }""") is True,
                    "Mismatched final readback failed to protect unsaved Builder")
            readback_bom.evaluate("""() => {
                const store = window.__yadilabProjectStore;
                store.injectBomAfterClose = false;
                store.chooseAlternative = true;
            }""")
            readback_bom.locator('[data-project-action="save-as"]').click()
            expect(readback_bom.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            expect(rbc).to_have_attribute("data-project-dirty", "false")
            require(readback_bom.evaluate(
                "window.__yadilabProjectStore.otherWrites") == 1,
                "BOM-readback recovery did not explicitly save a different file")
            require(readback_bom.evaluate(
                "window.__yadilabProjectStore.text") == original_bom_disk,
                "Recovery overwrote quarantined BOM-mismatched physical file")
            readback_bom.close()

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

            # BUILDER-051: project generations can reuse sourceRevision=0
            # and the same "mission" selection. Authoring controls must not
            # retain the previous project's form/JSON across New/Open.
            # Old DOM callbacks in the *same* JS task as New must also not
            # resurrect the previous Builder before React repaints.
            isolated = context.new_page()
            isolated.add_init_script(MOCK)
            isolated.on("pageerror", lambda error: errors.append(str(error)))
            isolated.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            isolated_controls = isolated.locator(
                '[data-project-file-controls="ready"]')
            expect(isolated_controls).to_be_visible(timeout=45000)
            expect(isolated_controls).to_have_attribute(
                "data-project-dirty", "false")
            builder_section = isolated.locator("details.control-section").filter(
                has_text="Builder Inspector & Authoring")
            if builder_section.get_attribute("open") is None:
                builder_section.locator("summary").first.click()
            isolated_inspector = isolated.locator(
                '[data-builder-inspector="mission"]')
            expect(isolated_inspector).to_be_visible(timeout=15000)
            old_title = isolated_inspector.locator(
                "label.inspector-field", has_text="Title").locator("input")
            initial_title = old_title.input_value()
            tests_editor = isolated.locator(
                '[data-builder-authoring="ready"] textarea[aria-label="Test JSON"]')
            initial_tests = json.loads(tests_editor.input_value())
            require(len(initial_tests) > 0 and
                    initial_title != "New YadiLab project",
                    "BUILDER-051 fixture lacks a distinct previous project")

            isolated.evaluate("""() => {
                const fresh = document.querySelector(
                    '[data-project-action="new"]');
                const applyInspector = document.querySelector(
                    '[data-builder-inspector="mission"] button');
                const applyTests = [...document.querySelectorAll(
                    '[data-builder-authoring="ready"] .authoring-panel button')]
                    .find(button => button.textContent.trim() === "Apply Test JSON");
                if (!fresh || !applyInspector || !applyTests ||
                    fresh.disabled)
                    throw new Error("BUILDER051_CONTROLS_UNAVAILABLE");
                fresh.click();
                // Both callbacks still belong to the old mounted project.
                applyInspector.click();
                applyTests.click();
            }""")
            expect(isolated.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "new_project")
            expect(isolated_controls).to_have_attribute(
                "data-project-dirty", "true")
            expect(isolated_controls).to_have_attribute(
                "data-project-pending-drafts", "false")
            expect(old_title).to_have_value("New YadiLab project")
            require(json.loads(tests_editor.input_value()) == [],
                    "BUILDER-051 leaked old project tests into new editor")
            expect(isolated.locator(".diagnostic")).to_contain_text(
                "BUILDER_AUTHORING_STALE_WORKSPACE")
            require(isolated.evaluate(
                "window.__yadilabProjectStore.writes") == 0,
                "Stale Builder callbacks unexpectedly wrote a project")

            # A native input event and JSON Apply in the SAME JS task must
            # commit the latest typed bytes, not an obsolete rendered prop.
            new_note = {"id": "builder051_fast_note",
                        "text": "Source-backed same-turn note"}
            isolated.evaluate("""(note) => {
                const editor = document.querySelector(
                    '[data-builder-authoring="ready"] textarea[aria-label="Anteckningar JSON"]');
                const apply = [...document.querySelectorAll(
                    '[data-builder-authoring="ready"] .authoring-panel button')]
                    .find(button => button.textContent.trim() ===
                        "Apply Anteckningar JSON");
                if (!editor || !apply)
                    throw new Error("BUILDER051_NOTE_CONTROLS_UNAVAILABLE");
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype, 'value').set;
                nativeSetter.call(editor, JSON.stringify([note]));
                editor.dispatchEvent(new Event('input', {bubbles: true}));
                apply.click();
            }""", new_note)
            try:
                isolated.wait_for_function("""() => {
                    const editor = document.querySelector(
                        '[data-builder-authoring="ready"] textarea[aria-label="Anteckningar JSON"]');
                    if (!editor) return false;
                    try {
                        const notes = JSON.parse(editor.value);
                        return notes.length === 1 &&
                            notes[0].id === "builder051_fast_note";
                    } catch { return false; }
                }""", timeout=15000)
            except Exception as cause:
                details = isolated.evaluate("""() => ({
                  draftStatus: document.querySelector('[data-studio-draft-revision]')?.textContent,
                  pending: document.querySelector('[data-project-file-controls]')?.getAttribute(
                    'data-project-pending-drafts'),
                  notes: document.querySelector(
                    '[data-builder-authoring] textarea[aria-label="Anteckningar JSON"]')?.value,
                  diagnostics: [...document.querySelectorAll('.diagnostic')].map(x => x.textContent),
                })""")
                raise AssertionError("BUILDER051_POST_NEW_APPLY_FAILED: " +
                    repr(details) + " | pageErrors=" + repr(errors[-12:])) from cause
            isolated.locator('[data-project-action="save-as"]').click()
            expect(isolated.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            saved_isolated = json.loads(isolated.evaluate(
                "window.__yadilabProjectStore.text"))
            require(saved_isolated["content"]["source"]["notes"] == [new_note],
                    "Same-turn JSON Apply lost the typed note in verified Save")
            expect(isolated_controls).to_have_attribute(
                "data-project-dirty", "false")
            isolated.close()

            # BUILDER-052: a new connection with a reused ID must NOT
            # overwrite an existing topology link. This is exercised through
            # the real Builder Create panel, with no compilation dependency:
            # an uncompiled draft still needs protection against data loss.
            duplicate_page = context.new_page()
            duplicate_page.add_init_script(MOCK)
            duplicate_page.on("pageerror", lambda error: errors.append(str(error)))
            duplicate_page.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            duplicate_controls = duplicate_page.locator(
                '[data-project-file-controls="ready"]')
            expect(duplicate_controls).to_be_visible(timeout=45000)
            duplicate_section = duplicate_page.locator(
                "details.control-section").filter(
                    has_text="Builder Inspector & Authoring")
            if duplicate_section.get_attribute("open") is None:
                duplicate_section.locator("summary").first.click()
            create_panel = duplicate_page.locator(".create-panel")
            expect(create_panel).to_be_visible(timeout=15000)
            choose(create_panel.locator("select").first, "connection")
            fill_value(create_panel.locator(
                'label.inspector-field', has_text="ID").locator(
                    "input"), "fw_rds")
            choose(create_panel.locator(
                'label.inspector-field', has_text="From").locator(
                    "select"), "rds01")
            choose(create_panel.locator(
                'label.inspector-field', has_text="To").locator(
                    "select"), "firewall01")
            create_panel.get_by_role("button", name="Skapa objekt").click()
            expect(duplicate_page.locator(".diagnostic")).to_contain_text(
                "BUILDER_DUPLICATE_ID")
            expect(duplicate_controls).to_have_attribute(
                "data-project-dirty", "false")
            require(duplicate_page.evaluate(
                "window.__yadilabProjectStore.writes") == 0,
                "BUILDER-052 duplicate connection Create wrote a native file")
            duplicate_page.locator('[data-project-action="save-as"]').click()
            expect(duplicate_page.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            saved_links = json.loads(duplicate_page.evaluate(
                "window.__yadilabProjectStore.text"))["content"]["source"]["connections"]
            existing = next((link for link in saved_links
                             if link["id"] == "fw_rds"), None)
            require(len(saved_links) == 3 and existing is not None,
                    "BUILDER-052 duplicate Create erased or appended a link")
            require(existing["from"]["resource"] != "rds01" or
                    existing["to"]["resource"] != "firewall01",
                    "BUILDER-052 Create silently rewired an existing link")
            expect(duplicate_controls).to_have_attribute(
                "data-project-dirty", "false")
            duplicate_page.close()

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
            fill_value(inspector.locator("label.inspector-field", has_text="Title").locator(
                "input"), "PROJECT-001 edited in Chromium")
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
            require("PROJECT-001 edited in Chromium" in (page.locator(".mission-strip").text_content() or ""),
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
            fill_value(inspector.locator("label.inspector-field", has_text="Title").locator(
                "input"), "PROJECT-008 hints retained after editing")
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
            expect(controls).to_have_attribute("data-project-operation", "opening")
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Opening project", timeout=10000)
            for action in ("new", "open", "save", "save-as"):
                expect(page.locator(f'[data-project-action="{action}"]')).to_be_disabled()
            # Disabled native buttons are probed through DOM click (Playwright
            # locator.click waits for enablement); the keyboard shortcut still
            # exercises the synchronous internal lock.
            page.locator('[data-project-action="new"]').evaluate("(el) => el.click()")
            require(page.locator(".app-frame").get_attribute(
                "data-runtime-scenario-id") == "foundation_acceptance",
                "New replaced Builder while the native Open picker was pending")
            page.locator('[data-project-action="save-as"]').evaluate("(el) => el.click()")
            page.keyboard.press("Control+s")
            page.locator('[data-project-action="open"]').evaluate("(el) => el.click()")
            require(page.evaluate("window.__yadilabProjectStore.writes")
                    == writes_before_picker,
                    "Save/Save As wrote file while Open picker was pending")
            require(page.evaluate("window.__yadilabProjectStore.openPickerCalls")
                    == picker_calls_before + 1,
                    "Another Open picker was launched while the first was unresolved")
            expect(controls).to_have_attribute("data-project-dirty", "false")
            expect(controls).to_have_attribute("data-project-operation", "opening")
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
            expect(controls).to_have_attribute("data-project-operation", "idle")
            expect(page.locator('[data-project-action="open"]')).to_be_enabled()
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
            # PROJECT-028: UTF-8 decoder drops a leading BOM, so a file
            # changed on disk by adding BOM still decodes to the same project.
            # The real compiled app must compare physical bytes, not text.
            bom_conflict = context.new_page()
            bom_conflict.add_init_script(MOCK)
            bom_conflict.on("pageerror", lambda error: errors.append(str(error)))
            bom_conflict.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            bcontrols = bom_conflict.locator('[data-project-file-controls="ready"]')
            expect(bcontrols).to_be_visible(timeout=45000)
            bom_conflict.locator('[data-project-action="save-as"]').click()
            expect(bom_conflict.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            bom_conflict.evaluate("""() => new Promise(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)))""")
            bom_conflict.evaluate("""() => {
                const disk = window.__yadilabProjectStore;
                disk.text = '\\uFEFF' + disk.text;
            }""")
            bom_before = bom_conflict.evaluate("""() => ({
                text: window.__yadilabProjectStore.text,
                writes: window.__yadilabProjectStore.writes,
            })""")
            bom_conflict.keyboard.press("Control+s")
            expect(bom_conflict.locator('[data-project-message]')).to_contain_text(
                "PROJECT_EXTERNAL_FILE_CHANGED", timeout=20000)
            bom_after = bom_conflict.evaluate("""() => ({
                text: window.__yadilabProjectStore.text,
                writes: window.__yadilabProjectStore.writes,
            })""")
            require(bom_after == bom_before,
                    "BOM-only external edit was overwritten by Save")
            expect(bcontrols).to_have_attribute("data-project-dirty", "true")
            bom_conflict.close()

            # An external file modification must never be overwritten by Ctrl+S.
            page.evaluate("(saved) => { window.__yadilabProjectStore.text = saved; }",
                          saved_after_ctrl)
            inspector = page.locator('[data-builder-inspector="mission"]')
            fill_value(inspector.locator("label.inspector-field", has_text="Title").locator(
                "input"), "PROJECT-001 unsaved after external file change")
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
            run_menu = page.locator(".workspace-menu-advanced")
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
                    page.locator(".mission-strip").text_content() or "",
                    "Runtime→Builder lost the user's unsaved editable source")
            # PROJECT-021: Runtime Preview from a verified, unchanged
            # compiled Builder must invalidate an older in-flight compile.
            # Launch recompile and preview in the SAME browser event task,
            # before React can commit the recompilation's busy state.
            # Otherwise its later async completion may return to Builder and
            # silently displace the explicitly requested Runtime session.
            race_before_writes = page.evaluate(
                "window.__yadilabProjectStore.writes")
            preview_race = page.evaluate("""() => {
                const menu = document.querySelector('.workspace-menu-advanced');
                const builder = menu;
                const run = menu;
                const recompile = [...(builder?.querySelectorAll('button') || [])]
                    .find(button => button.textContent.trim() === 'Kompilera + layout');
                const preview = [...(run?.querySelectorAll('button') || [])]
                    .find(button => button.textContent.trim() === 'Förhandsvisa körläge');
                if (!recompile || !preview || recompile.disabled || preview.disabled)
                    throw new Error('PROJECT-021 needs compiled Builder with idle compile and Preview');
                recompile.click();
                preview.click();
                return { recompileTriggered: true, previewTriggered: true };
            }""")
            require(preview_race == {
                "recompileTriggered": True, "previewTriggered": True,
            }, "PROJECT-021 did not exercise synchronous recompile/Preview")
            expect(page.locator(".app-frame")).not_to_have_attribute(
                "data-runtime-scenario-hash", "builder", timeout=20000)
            # An old compile has sufficient time to complete on the runner;
            # this separately detects late Builder resurrection.
            page.wait_for_timeout(1200)
            expect(page.locator(".app-frame")).not_to_have_attribute(
                "data-runtime-scenario-hash", "builder")
            require(page.evaluate(
                "window.__yadilabProjectStore.writes") == race_before_writes,
                "Preview/recompile race unexpectedly wrote a .yadilab project")
            expect(controls).to_have_attribute("data-project-dirty", "true")
            if run_menu.get_attribute("open") is None:
                run_menu.locator("summary").click()
            run_menu.get_by_role("button", name="Tillbaka till byggläget").click()
            expect(page.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-hash", "builder", timeout=15000)
            expect(controls).to_have_attribute("data-project-dirty", "true")
            require("PROJECT-001 unsaved after external file change" in
                    page.locator(".mission-strip").text_content() or "",
                    "PROJECT-021 lost editable source after preview/compile transition")
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
                    page.locator(".mission-strip").text_content() or "",
                    "Cancelled Open discarded the current Builder edits")
            page.evaluate("window.__yadilabProjectStore.cancelOpen = false")
            # An unrelated built-in Builder must receive a fresh file
            # association after explicit operator discard consent.
            builder_menu = page.locator(".workspace-menu-advanced")
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
                    page.locator(".mission-strip").text_content() or "",
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
            fill_value(rmission.locator("label.inspector-field", has_text="Title").locator(
                "input"), "RECOVERY-PROJECT-UNSAVED")
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
            fill_value(title, "EDIT BEFORE SAVE AS")
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
            fill_value(title, "EDIT AFTER FILE IDENTITY STARTED")
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
            fill_value(different_scenario.locator(
                '[data-studio-scenario-id]'), "project_013_unrelated")
            # PROJECT-048: the new source is visible synchronously, before
            # the React effect detaches the previous physical .yadilab handle.
            # Save must reject the unresolved association immediately,
            # without touching the original native destination.
            different_scenario.evaluate("""() => {
                const create = document.querySelector('[data-studio-action="create"]');
                const save = document.querySelector('[data-project-action="save"]');
                if (!create || !save || save.disabled)
                    throw new Error("PROJECT048_DIFFERENT_ID_CONTROLS_UNAVAILABLE");
                create.click();
                save.click();
            }""")
            expect(different_scenario.locator(".diagnostic")).to_contain_text(
                "PROJECT_FILE_ASSOCIATION_PENDING", timeout=15000)
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.text") == previous_bytes,
                "Same-turn new project overwrote previously saved project bytes")
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.writes") == previous_writes,
                "Same-turn project replacement triggered old native file write")
            expect(different_scenario.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "project_013_unrelated")
            expect(different_controls).to_have_attribute(
                "data-project-filename", "project_013_unrelated.yadilab")
            expect(different_controls).to_have_attribute("data-project-dirty", "true")
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.text") == previous_bytes,
                "Loading another scenario changed the previous project file")
            different_scenario.keyboard.press("Control+s")
            # PROJECT-026: an empty Scenario Studio draft is editable and
            # saveable, but it must NEVER reuse or overwrite the previous
            # project's nonempty native file. A new empty destination is needed.
            expect(different_scenario.locator('[data-project-message]')).to_contain_text(
                "PROJECT_DESTINATION_NOT_EMPTY", timeout=20000)
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.text") == previous_bytes,
                "New draft overwrote the original .yadilab through inherited handle")
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.writes") == previous_writes,
                "New draft performed an unintended write to the old project")
            expect(different_controls).to_have_attribute("data-project-dirty", "true")
            different_scenario.evaluate(
                "window.__yadilabProjectStore.chooseAlternative = true")
            different_scenario.locator('[data-project-action="save-as"]').click()
            expect(different_scenario.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            expect(different_controls).to_have_attribute("data-project-dirty", "false")
            expect(different_controls).to_have_attribute(
                "data-project-filename", "safe-recovery-copy.yadilab")
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.otherWrites") == 1,
                "New editable draft did not Save As into separate empty target")
            require(different_scenario.evaluate(
                "window.__yadilabProjectStore.text") == previous_bytes,
                "Separate draft Save As modified the original project file")
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
            fill_value(reused_id.locator(
                '[data-studio-scenario-id]'), prior_scenario_id)
            reused_id.evaluate("""() => {
                const create = document.querySelector('[data-studio-action="create"]');
                const save = document.querySelector('[data-project-action="save"]');
                if (!create || !save || save.disabled)
                    throw new Error("PROJECT048_REUSED_ID_CONTROLS_UNAVAILABLE");
                create.click();
                save.click();
            }""")
            expect(reused_id.locator(".diagnostic")).to_contain_text(
                "PROJECT_FILE_ASSOCIATION_PENDING", timeout=15000)
            require(reused_id.evaluate(
                "window.__yadilabProjectStore.text") == prior_file_bytes,
                "Same-ID pending project switch overwrote prior physical bytes")
            require(reused_id.evaluate(
                "window.__yadilabProjectStore.writes") == prior_file_writes,
                "Same-ID pending project switch reused previous native handle")
            expect(reused_id.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", prior_scenario_id)
            expect(ric).to_have_attribute(
                "data-project-filename", prior_scenario_id + ".yadilab")
            expect(ric).to_have_attribute("data-project-dirty", "true")
            require(reused_id.evaluate(
                "window.__yadilabProjectStore.text") == prior_file_bytes,
                "Same-ID scenario replacement unexpectedly modified prior disk bytes")
            reused_id.keyboard.press("Control+s")
            # Same public scenario ID does not authorize overwriting the
            # previous native file. An editable blank draft remains valid,
            # but the detached Save As target is already nonempty.
            expect(reused_id.locator('[data-project-message]')).to_contain_text(
                "PROJECT_DESTINATION_NOT_EMPTY", timeout=20000)
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
                    const menu = document.querySelector('.workspace-menu-advanced');
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

            # PROJECT-046: In a single JavaScript turn, an Inspector Apply
            # can queue React state while a direct New/Save click immediately
            # observes the pre-render project. The live canonical source MUST
            # win over any stale painted dirty flag or stale Save snapshot.
            atomic = context.new_page()
            atomic.add_init_script(MOCK)
            atomic.on("pageerror", lambda error: errors.append(str(error)))
            atomic.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            ac = atomic.locator('[data-project-file-controls="ready"]')
            expect(ac).to_be_visible(timeout=45000)
            section = atomic.locator("details.control-section").filter(
                has_text="Builder Inspector & Authoring")
            if section.get_attribute("open") is None:
                section.locator("summary").first.click()
            inspector = atomic.locator('[data-builder-inspector="mission"]')
            expect(inspector).to_be_visible(timeout=15000)
            title_field = inspector.locator(
                "label.inspector-field", has_text="Title").locator("input")
            fill_value(title_field, "PROJECT-046 immediate unsaved change")
            atomic.evaluate("""() => {
                window.__project046ConfirmCalls = 0;
                window.confirm = () => {
                    window.__project046ConfirmCalls++;
                    return false;
                };
                const apply = document.querySelector(
                    '[data-builder-inspector="mission"] button');
                const fresh = document.querySelector(
                    '[data-project-action="new"]');
                if (!apply || !fresh || fresh.disabled)
                    throw new Error("PROJECT046_ATOMIC_CONTROLS_UNAVAILABLE");
                apply.click();
                const closing = new Event('beforeunload', { cancelable:true });
                window.dispatchEvent(closing);
                window.__project046UnloadPrevented = closing.defaultPrevented;
                fresh.click();
            }""")
            expect(atomic.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "foundation_acceptance")
            expect(atomic.locator(".mission-strip")).to_contain_text(
                "PROJECT-046 immediate unsaved change")
            expect(ac).to_have_attribute("data-project-dirty", "true")
            require(atomic.evaluate("window.__project046ConfirmCalls") == 1,
                    "An immediate New bypassed the unsaved project confirmation")
            require(atomic.evaluate("window.__project046UnloadPrevented") is True,
                    "An immediate tab close did not request unsaved-change protection")
            require(atomic.evaluate("window.__yadilabProjectStore.writes") == 0,
                    "Inspector Apply or rejected New wrote a native project file")
            # Save As first attaches a real verified native handle. The next
            # Apply + Save are again dispatched in ONE JS task, before React
            # is guaranteed to repaint the changed source.
            atomic.locator('[data-project-action="save-as"]').click()
            expect(atomic.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            atomic.wait_for_function(
                "window.__yadilabProjectStore.writes === 1", timeout=20000)
            expect(ac).to_have_attribute("data-project-dirty", "false")
            for index in range(3):
                saved_title = "PROJECT-046 atomic Save " + str(index + 1)
                fill_value(title_field, saved_title)
                atomic.evaluate("""() => {
                    const apply = document.querySelector(
                        '[data-builder-inspector="mission"] button');
                    const save = document.querySelector(
                        '[data-project-action="save"]');
                    if (!apply || !save || save.disabled)
                        throw new Error("PROJECT046_ATOMIC_SAVE_CONTROLS_UNAVAILABLE");
                    apply.click();
                    save.click();
                }""")
                atomic.wait_for_function(
                    "(expected) => window.__yadilabProjectStore.writes === expected",
                    arg=index + 2, timeout=20000)
                expect(atomic.locator('[data-project-message]')).to_contain_text(
                    "Saved and read back", timeout=20000)
                require(json.loads(atomic.evaluate(
                    "window.__yadilabProjectStore.text"))["content"]["source"]
                    ["metadata"]["title"] == saved_title,
                    "A same-turn Save stored an obsolete pre-Apply project: "
                    + saved_title)
                expect(atomic.locator(".mission-strip")).to_contain_text(
                    saved_title)
                expect(ac).to_have_attribute("data-project-dirty", "false")
            require(atomic.evaluate("window.__yadilabProjectStore.writes") == 4,
                    "Only the four explicit verified Save operations may write")
            # Even a no-op inspector Apply must not request unnecessary Save,
            # and a second pending edit may never overwrite the verified file.
            atomic.locator(
                '[data-builder-inspector="mission"]').get_by_role(
                "button", name="Verkställ inspektörsändringar").click()
            expect(ac).to_have_attribute("data-project-dirty", "false")
            require(atomic.evaluate("window.__yadilabProjectStore.writes") == 4,
                    "A no-op Apply triggered a hidden native save")
            atomic.close()

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
            fill_value(inspector.locator("label.inspector-field", has_text="Title").locator(
                "input"), "PROJECT-001 runtime restore source")
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
                    '[data-studio-draft-revision]').text_content() or ""
                raise AssertionError(
                    "Runtime fixture compilation did not become valid: " + status) from error
            run_menu = restore_race.locator(".workspace-menu-advanced")
            if run_menu.get_attribute("open") is None:
                run_menu.locator("summary").click()
            preview = run_menu.get_by_role("button", name="Förhandsvisa körläge")
            expect(preview).to_be_enabled(timeout=30000)
            # PROJECT-047: A compiled Builder can be edited and the old
            # enabled Preview button clicked before React repaints. Without
            # the live-source check this starts an obsolete Runtime and can
            # replace the newest unsaved canonical source.
            fill_value(inspector.locator("label.inspector-field", has_text="Title").locator(
                "input"), "PROJECT-001 runtime restore source revised")
            restore_race.evaluate("""() => {
                const apply = document.querySelector(
                    '[data-builder-inspector="mission"] button');
                const preview = [...document.querySelectorAll(
                    '.workspace-menu-advanced button')].find(
                    button => button.textContent.trim() === 'Förhandsvisa körläge');
                if (!apply || !preview || preview.disabled)
                    throw new Error("PROJECT047_STALE_PREVIEW_CONTROLS_UNAVAILABLE");
                apply.click();
                preview.click();
            }""")
            expect(restore_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-hash", "builder")
            expect(restore_race.locator(".mission-strip")).to_contain_text(
                "PROJECT-001 runtime restore source revised")
            expect(rrc).to_have_attribute("data-project-dirty", "true")
            expect(restore_race.locator(".diagnostic")).to_contain_text(
                "PROJECT_RUNTIME_PREVIEW_STALE_WORKSPACE")
            require(restore_race.evaluate(
                "window.__yadilabProjectStore.writes") == 0,
                "Stale Runtime Preview unexpectedly wrote a project")

            # An immediate Source export must contain the new canonical
            # title, not the previous render's source. Keep it an actual
            # browser download, with no file write or manual source override.
            export_menu = restore_race.locator(".workspace-menu-advanced")
            if export_menu.get_attribute("open") is None:
                export_menu.locator("summary").click()
            fill_value(inspector.locator("label.inspector-field", has_text="Title").locator(
                "input"), "PROJECT-001 runtime restore source exported")
            with restore_race.expect_download(timeout=20000) as live_export:
                restore_race.evaluate("""() => {
                    const apply = document.querySelector(
                        '[data-builder-inspector="mission"] button');
                    const exportButton = [...document.querySelectorAll(
                        '.workspace-menu-advanced button')].find(
                        button => button.textContent.trim() === 'Exportera källfil');
                    if (!apply || !exportButton || exportButton.disabled)
                        throw new Error("PROJECT047_LIVE_EXPORT_CONTROLS_UNAVAILABLE");
                    apply.click();
                    exportButton.click();
                }""")
            exported = json.loads(Path(live_export.value.path()).read_text())
            require(exported["metadata"]["title"] ==
                    "PROJECT-001 runtime restore source exported",
                    "Same-turn Source export silently downloaded pre-Apply JSON")
            expect(restore_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-hash", "builder")
            expect(restore_race.locator(".mission-strip")).to_contain_text(
                "PROJECT-001 runtime restore source exported")
            expect(rrc).to_have_attribute("data-project-dirty", "true")
            require(restore_race.evaluate(
                "window.__yadilabProjectStore.writes") == 0,
                "A Source JSON export unexpectedly wrote native .yadilab bytes")

            # The newly edited Builder has an invalidated compile result:
            # explicit recompile is required before a genuine Runtime launch.
            expect(compile_button).to_be_enabled(timeout=20000)
            compile_button.click()
            expect(compile_button).to_be_disabled(timeout=30000)
            expect(preview).to_be_enabled(timeout=30000)
            preview.click()
            try:
                expect(restore_race.locator(".app-frame")).not_to_have_attribute(
                    "data-runtime-scenario-hash", "builder", timeout=20000)
            except AssertionError as error:
                # An enabled Preview button does not prove that Runtime
                # activated. Preserve the actual Compiler/Engine diagnostics
                # so a failing CI run is actionable instead of an opaque
                # "remained builder" timeout.
                draft_status = restore_race.locator(
                    "[data-studio-draft-revision]").text_content() or ""
                diagnostic_text = restore_race.locator(
                    ".diagnostic").all_text_contents()
                raise AssertionError(
                    "PROJECT_RUNTIME_PREVIEW_BLOCKED: " + draft_status
                    + " | diagnostics=" + repr(diagnostic_text[-20:])) from error
            export_menu = restore_race.locator(".workspace-menu-advanced")
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
            # PROJECT-022: Back to Builder is an explicit transition even
            # if React batches the repaint. Release the pending progress File
            # in that SAME event turn; old Runtime may not reappear.
            restore_race.evaluate("""() => {
                const menu = document.querySelector('.workspace-menu-advanced');
                const back = [...(menu?.querySelectorAll('button') || [])].find(
                    button => button.textContent.trim() === 'Tillbaka till byggläget');
                const release = window.__staleRuntimeFileRead?.release;
                if (!back || back.disabled || typeof release !== 'function')
                    throw new Error('PROJECT-022 requires live Runtime and pending progress File');
                back.click();
                release();
            }""")
            expect(restore_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-hash", "builder", timeout=15000)
            expect(rrc).to_have_attribute("data-project-dirty", "true")
            require("PROJECT-001 runtime restore source" in
                    restore_race.locator(".mission-strip").text_content() or "",
                    "PROJECT-022 lost authored Builder source on immediate return")
            restore_race.wait_for_timeout(450)
            expect(restore_race.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-hash", "builder")
            require(restore_race.evaluate(
                "window.__yadilabProjectStore.writes") == 0,
                "PROJECT-022 stale Runtime progress wrote a project file")
            # The original New-during-pending-Runtime test remains independent:
            # re-enter Runtime, start the same verified progress read again,
            # and make an explicit New project while it remains unresolved.
            if run_menu.get_attribute("open") is None:
                run_menu.locator("summary").click()
            preview = run_menu.get_by_role("button", name="Förhandsvisa körläge")
            expect(preview).to_be_enabled(timeout=15000)
            preview.click()
            expect(restore_race.locator(".app-frame")).not_to_have_attribute(
                "data-runtime-scenario-hash", "builder", timeout=15000)
            progress_input = restore_race.locator('[data-menu-action="load-progress"]')
            progress_input.evaluate("(element) => { element.value = ''; }")
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

            # UX-064: A native input event and Create in the SAME JS task
            # must use the newly typed scenario ID/title, not stale React
            # state from the preceding render. No implicit native write.
            studio_race = context.new_page()
            studio_race.add_init_script(MOCK)
            studio_race.on("pageerror", lambda error: errors.append(str(error)))
            studio_race.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            sc = studio_race.locator('[data-project-file-controls="ready"]')
            expect(sc).to_be_visible(timeout=45000)
            studio_race.evaluate("""() => {
                const panel = document.querySelector('[data-scenario-studio="ready"]');
                if (!panel) throw new Error("UX064_STUDIO_MISSING");
                let ancestor = panel.closest('details');
                while (ancestor) {
                  ancestor.open = true;
                  ancestor = ancestor.parentElement?.closest('details') ?? null;
                }
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype, 'value').set;
                const id = panel.querySelector('[data-studio-scenario-id]');
                const title = panel.querySelector('[data-studio-scenario-title]');
                const create = panel.querySelector('[data-studio-action="create"]');
                if (!id || !title || !create || create.disabled)
                    throw new Error("UX064_STUDIO_FIELDS_MISSING");
                nativeSetter.call(id, 'ux064.immediate.scenario');
                id.dispatchEvent(new Event('input', {bubbles:true}));
                nativeSetter.call(title, 'UX-064 latest typed mission');
                title.dispatchEvent(new Event('input', {bubbles:true}));
                create.click();
            }""")
            expect(studio_race.locator('.app-frame')).to_have_attribute(
                'data-runtime-scenario-id', 'ux064_immediate_scenario', timeout=15000)
            expect(studio_race.locator('.mission-strip')).to_contain_text(
                'UX-064 latest typed mission', timeout=15000)
            expect(sc).to_have_attribute('data-project-dirty', 'true')
            require(studio_race.evaluate(
                'window.__yadilabProjectStore.writes') == 0,
                'UX-064 Studio Create wrote a native project without Save')
            studio_race.close()

            # Import Workbench's two file entrypoints must be ordered by the
            # latest operator selection, NOT by File.text() completion order.
            # A stale READY button must never activate the previous source
            # after a new file was selected before React could repaint.
            native_source = json.loads(
                (Path(__file__).resolve().parents[2] /
                 'tests/fixtures/valid/scenario-source.json').read_text())
            def import_document(scenario_id, title):
                candidate = json.loads(json.dumps(native_source))
                candidate['scenarioId'] = scenario_id
                candidate['metadata']['title'] = title
                return json.dumps(candidate, ensure_ascii=False)
            import_race = context.new_page()
            import_race.add_init_script(MOCK)
            import_race.on('pageerror', lambda error: errors.append(str(error)))
            import_race.goto(a.url, wait_until='domcontentloaded', timeout=30000)
            expect(import_race.locator('[data-project-file-controls="ready"]')).to_be_visible(
                timeout=45000)
            import_race.evaluate("""() => {
              const panel = document.querySelector('.import-workbench');
              if (!panel) throw new Error('UX064_WORKBENCH_MISSING');
              let ancestor = panel.closest('details');
              while (ancestor) {
                ancestor.open = true;
                ancestor = ancestor.parentElement?.closest('details') ?? null;
              }
              const original = File.prototype.text;
              window.__ux064 = {pending: []};
              File.prototype.text = function() {
                if (!this.name.startsWith('race-'))
                  return original.call(this);
                const file = this;
                return new Promise(resolve => {
                  const pending = {
                    name: file.name, done: false,
                    release() {
                      if (this.done) return;
                      this.done = true;
                      resolve(original.call(file));
                    }
                  };
                  window.__ux064.pending.push(pending);
                });
              };
            }""")
            wb = import_race.locator('.import-workbench')
            import_input = wb.locator('input[type="file"]')
            import_input.set_input_files({
                'name': 'race-old-a.json', 'mimeType': 'application/json',
                'buffer': import_document('ux064_old_a', 'OLD import must never win').encode(),
            })
            import_race.wait_for_function("""() =>
                window.__ux064.pending.some(x => x.name === 'race-old-a.json')""")
            import_input.set_input_files({
                'name': 'race-new-b.json', 'mimeType': 'application/json',
                'buffer': import_document('ux064_new_b', 'NEW import selected last').encode(),
            })
            import_race.wait_for_function("""() =>
                window.__ux064.pending.some(x => x.name === 'race-new-b.json')""")
            expect(wb).to_have_attribute('data-import-workbench', 'READING')
            import_race.evaluate("""() => window.__ux064.pending
              .find(x => x.name === 'race-new-b.json').release()""")
            expect(wb).to_have_attribute('data-import-workbench', 'PARSED',
                                         timeout=15000)
            expect(wb.locator('[data-import-state]')).to_contain_text(
                'race-new-b.json')
            import_race.evaluate("""() => window.__ux064.pending
              .find(x => x.name === 'race-old-a.json').release()""")
            import_race.wait_for_timeout(200)
            expect(wb).to_have_attribute('data-import-workbench', 'PARSED')
            expect(wb.locator('[data-import-state]')).to_contain_text(
                'race-new-b.json')
            wb.get_by_role('button', name='Preview').click()
            expect(wb.locator('[data-import-preview]')).to_contain_text(
                'NEW import selected last')
            wb.get_by_role('button', name='Validate + Compile').click()
            expect(wb).to_have_attribute('data-import-workbench',
                                         'READY_TO_ACTIVATE', timeout=45000)
            # Select C through the MAIN MENU while the older READY button
            # is still clickable in the same JS task. Its handler must
            # resolve the synchronous live state (READING), not stale READY.
            import_race.evaluate("""(body) => {
              const menuFile = document.querySelector(
                '[data-menu-action="open-scenario-json"]');
              const oldActivate = [...document.querySelectorAll(
                '.import-workbench button')].find(b => b.textContent.trim() === 'Activate');
              if (!menuFile || !oldActivate || oldActivate.disabled)
                throw new Error('UX064_SHARED_IMPORT_CONTROLS_MISSING');
              const transfer = new DataTransfer();
              transfer.items.add(new File([body], 'race-new-c.json',
                {type:'application/json'}));
              menuFile.files = transfer.files;
              menuFile.dispatchEvent(new Event('change', {bubbles:true}));
              oldActivate.click();
            }""", import_document('ux064_new_c', 'THIRD import through main menu'))
            expect(wb).to_have_attribute('data-import-workbench', 'READING')
            expect(import_race.locator('.app-frame')).to_have_attribute(
                'data-runtime-scenario-id', 'foundation_acceptance')
            require(import_race.evaluate('window.__yadilabProjectStore.writes') == 0,
                    'UX-064 stale Activate mutated native project')
            import_race.wait_for_function("""() =>
                window.__ux064.pending.some(x => x.name === 'race-new-c.json')""")
            import_race.evaluate("""() => window.__ux064.pending
              .find(x => x.name === 'race-new-c.json').release()""")
            expect(wb).to_have_attribute('data-import-workbench', 'PARSED',
                                         timeout=15000)
            wb.get_by_role('button', name='Preview').click()
            expect(wb.locator('[data-import-preview]')).to_contain_text(
                'THIRD import through main menu')

            # Compile C, then select D before its async Compiler promise
            # resolves. The previous compile must not re-enable Activate
            # or replace D's parsed source after File.text() completes.
            import_race.evaluate("""(body) => {
              const compile = [...document.querySelectorAll(
                '.import-workbench button')].find(b =>
                  b.textContent.trim() === 'Validate + Compile');
              const input = document.querySelector('.import-workbench input[type=file]');
              if (!compile || compile.disabled || !input)
                throw new Error('UX064_COMPILE_RACE_UNAVAILABLE');
              compile.click();
              const transfer = new DataTransfer();
              transfer.items.add(new File([body], 'race-new-d.json',
                {type:'application/json'}));
              input.files = transfer.files;
              input.dispatchEvent(new Event('change', {bubbles:true}));
            }""", import_document('ux064_new_d', 'FOURTH import must win compile race'))
            import_race.wait_for_function("""() =>
                window.__ux064.pending.some(x => x.name === 'race-new-d.json')""")
            expect(wb).to_have_attribute('data-import-workbench', 'READING')
            import_race.wait_for_timeout(350)
            expect(wb).to_have_attribute('data-import-workbench', 'READING')
            import_race.evaluate("""() => window.__ux064.pending
              .find(x => x.name === 'race-new-d.json').release()""")
            expect(wb).to_have_attribute('data-import-workbench', 'PARSED',
                                         timeout=15000)
            expect(wb.locator('[data-import-state]')).to_contain_text(
                'race-new-d.json')
            expect(wb.get_by_role('button', name='Activate')).to_be_disabled()
            wb.get_by_role('button', name='Preview').click()
            expect(wb.locator('[data-import-preview]')).to_contain_text(
                'FOURTH import must win compile race')
            require(import_input.evaluate('(el) => el.value') == '',
                    'UX-064 Workbench chooser did not reset for same-file reimport')
            require(import_race.evaluate("""() =>
                document.querySelector('[data-menu-action="open-scenario-json"]').value""") == '',
                'UX-064 main menu chooser did not reset after selection')
            # Selecting the SAME physical filename after updating its bytes
            # must start a new read and replace the prior parsed candidate.
            import_input.set_input_files({
                'name': 'race-new-d.json', 'mimeType': 'application/json',
                'buffer': import_document('ux064_updated_d',
                                          'SAME file reimported after edit').encode(),
            })
            import_race.wait_for_function("""() =>
                window.__ux064.pending.filter(x =>
                  x.name === 'race-new-d.json').length === 2""")
            expect(wb).to_have_attribute('data-import-workbench', 'READING')
            import_race.evaluate("""() => window.__ux064.pending
              .filter(x => x.name === 'race-new-d.json').at(-1).release()""")
            expect(wb).to_have_attribute('data-import-workbench', 'PARSED',
                                         timeout=15000)
            wb.get_by_role('button', name='Preview').click()
            expect(wb.locator('[data-import-preview]')).to_contain_text(
                'SAME file reimported after edit')
            require(import_race.evaluate('window.__yadilabProjectStore.writes') == 0,
                    'UX-064 import Workbench implicitly wrote a .yadilab file')
            import_race.close()

            # PROJECT-065: A typed but unapplied Inspector/JSON form is user
            # data absent from canonical source. Save must not claim those
            # visible edits reached native disk; New must warn even though the
            # underlying Builder source is still byte-for-byte unchanged.
            pending = context.new_page()
            pending.add_init_script(MOCK)
            pending.on("pageerror", lambda error: errors.append(str(error)))
            pending.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            pc = pending.locator('[data-project-file-controls="ready"]')
            expect(pc).to_be_visible(timeout=45000)
            require(pc.get_attribute("data-project-dirty") == "false",
                    "PROJECT-065 initial project unexpectedly dirty")
            pending.evaluate("""() => {
              const inspector = document.querySelector(
                '[data-builder-inspector="mission"]');
              if (!inspector) throw new Error('PROJECT065_MISSION_INSPECTOR_MISSING');
              let ancestor = inspector.closest('details');
              while (ancestor) {
                ancestor.open = true;
                ancestor = ancestor.parentElement?.closest('details') ?? null;
              }
            }""")
            inspector = pending.locator('[data-builder-inspector="mission"]')
            expect(inspector).to_be_visible(timeout=15000)
            title_field = inspector.locator('label.inspector-field',
                has_text="Title").locator("input")
            fill_value(title_field, "PROJECT-065 staged mission never auto-saved")
            expect(pc).to_have_attribute("data-project-pending-drafts", "true")
            expect(pc).to_have_attribute("data-project-dirty", "true")
            expect(inspector).to_have_attribute("data-builder-unapplied", "true")
            expect(pc.locator("[data-project-status]")).to_contain_text(
                "UNAPPLIED FORM EDITS")
            # A deliberate Revert is the operator's explicit escape hatch
            # when a form draft is abandoned; it must not modify source.
            pending.once("dialog", lambda dialog: dialog.accept())
            inspector.get_by_role(
                "button", name="Förkasta inspektörsutkast").click()
            expect(pc).to_have_attribute("data-project-pending-drafts", "false")
            require("PROJECT-065 staged" not in title_field.input_value(),
                    "Inspector Revert kept the discarded staged value")
            expect(pc).to_have_attribute("data-project-dirty", "false")
            fill_value(title_field, "PROJECT-065 staged mission never auto-saved")
            expect(pc).to_have_attribute("data-project-pending-drafts", "true")

            # A separate editor may not commit a newer source revision
            # while Inspector holds typed but unapplied mission metadata.
            # That remount would silently destroy the Inspector draft.
            pending.evaluate("""() => {
              const notes = document.querySelector(
                '.builder-authoring textarea[aria-label="Anteckningar JSON"]');
              if (!notes) throw new Error('PROJECT065_CROSS_EDITOR_NOT_MOUNTED');
              let ancestor = notes.closest('details');
              while (ancestor) {
                ancestor.open = true;
                ancestor = ancestor.parentElement?.closest('details') ?? null;
              }
            }""")
            cross_notes = pending.locator(
                '.builder-authoring textarea[aria-label="Anteckningar JSON"]')
            original_note_text = cross_notes.input_value()
            fill_value(cross_notes, original_note_text + " ")
            pending.locator('.builder-authoring').get_by_role(
                'button', name='Apply Anteckningar JSON').click()
            expect(pending.locator(".diagnostic")).to_contain_text(
                "BUILDER_OTHER_EDITOR_UNAPPLIED", timeout=15000)
            require("PROJECT-065 staged" not in pending.locator(
                ".mission-strip").text_content() or "",
                "Cross-editor Apply replaced canonical source despite Inspector draft")
            expect(inspector).to_have_attribute("data-builder-unapplied", "true")
            fill_value(cross_notes, original_note_text)

            # A pane click can clear the selection and unmount Inspector.
            # Test the actual ReactFlow pane: the initial welcome Builder
            # is not required to have compiled/laid-out DOM nodes yet.
            canvas_pane = pending.locator(".react-flow__pane").first
            expect(canvas_pane).to_be_visible(timeout=15000)
            canvas_pane.click(force=True, timeout=15000)
            expect(pending.locator(".diagnostic")).to_contain_text(
                "BUILDER_CANVAS_UNAPPLIED_DRAFT", timeout=15000)
            expect(inspector).to_have_attribute("data-builder-inspector", "mission")
            expect(title_field).to_have_value(
                "PROJECT-065 staged mission never auto-saved")

            # Compiling or exporting before Apply can misleadingly validate
            # or deliver a canonical source which excludes visible edits.
            # Scenario Studio is inside a separately collapsed Control
            # Center details section; open it without altering source.
            pending.evaluate("""() => {
              const studio = document.querySelector('[data-scenario-studio]');
              if (!studio) throw new Error('PROJECT065_STUDIO_MISSING');
              let ancestor = studio.closest('details');
              while (ancestor) {
                ancestor.open = true;
                ancestor = ancestor.parentElement?.closest('details') ?? null;
              }
            }""")
            pending.locator('[data-studio-action="validate-compile"]').click()
            expect(pending.locator(".diagnostic")).to_contain_text(
                "BUILDER_COMPILE_UNAPPLIED_DRAFT", timeout=15000)
            pending.locator('[data-studio-action="export"]').click()
            expect(pending.locator(".diagnostic")).to_contain_text(
                "BUILDER_EXPORT_UNAPPLIED_DRAFT", timeout=15000)
            pc.locator('[data-project-action="save-as"]').click()
            expect(pc.locator('[data-project-message]')).to_contain_text(
                "PROJECT_UNAPPLIED_DRAFT", timeout=15000)
            require(pending.evaluate(
                "window.__yadilabProjectStore.writes") == 0,
                "PROJECT-065 Save As falsely wrote an unapplied Inspector edit")
            require(pending.evaluate(
                "window.__yadilabProjectStore.suggestedName") is None,
                "PROJECT-065 Save As opened native picker despite pending draft")
            pending.once("dialog", lambda dialog: dialog.dismiss())
            pc.locator('[data-project-action="new"]').click()
            expect(pending.locator(".app-frame")).to_have_attribute(
                "data-runtime-scenario-id", "foundation_acceptance")
            expect(pc).to_have_attribute("data-project-pending-drafts", "true")
            require("PROJECT-065 staged" not in
                    pending.locator(".mission-strip").text_content() or "",
                    "PROJECT-065 pending title had already mutated canonical source")
            inspector.get_by_role(
                "button", name="Verkställ inspektörsändringar").click()
            expect(pc).to_have_attribute("data-project-pending-drafts", "false")
            expect(pc).to_have_attribute("data-project-dirty", "true")
            expect(pending.locator(".mission-strip")).to_contain_text(
                "PROJECT-065 staged mission never auto-saved")
            pc.locator('[data-project-action="save-as"]').click()
            expect(pc.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            require(pending.evaluate(
                "window.__yadilabProjectStore.writes") == 1,
                "PROJECT-065 explicit post-Apply Save did not persist title")
            require(json.loads(pending.evaluate(
                "window.__yadilabProjectStore.text"))["content"]["source"]["metadata"]["title"]
                == "PROJECT-065 staged mission never auto-saved",
                "PROJECT-065 verified file contains stale mission title")
            expect(pc).to_have_attribute("data-project-dirty", "false")

            pending.evaluate("""() => {
              const notes = document.querySelector(
                '.builder-authoring textarea[aria-label="Anteckningar JSON"]');
              if (!notes) throw new Error('PROJECT065_NOTES_EDITOR_MISSING');
              let ancestor = notes.closest('details');
              while (ancestor) {
                ancestor.open = true;
                ancestor = ancestor.parentElement?.closest('details') ?? null;
              }
            }""")
            note_field = pending.locator(
                '.builder-authoring textarea[aria-label="Anteckningar JSON"]')
            tests_field = pending.locator(
                '.builder-authoring textarea[aria-label="Test JSON"]')
            original_tests_json = tests_field.input_value()
            fill_value(note_field, '[{"id":"project065_note","text":"Staged evidence"}]')
            expect(pc).to_have_attribute("data-project-pending-drafts", "true")
            pc.locator('[data-project-action="save"]').click()
            expect(pc.locator('[data-project-message]')).to_contain_text(
                "PROJECT_UNAPPLIED_DRAFT", timeout=15000)
            require(pending.evaluate(
                "window.__yadilabProjectStore.writes") == 1,
                "PROJECT-065 un-applied JSON note triggered a native write")
            # If two independent JSON panels have staged edits, applying
            # one would remount the editor and discard the other. Refuse
            # this multi-panel source mutation until one draft is reverted.
            pending.evaluate("""() => {
              const tests = document.querySelector(
                '.builder-authoring textarea[aria-label="Test JSON"]');
              tests.closest('details').open = true;
            }""")
            fill_value(tests_field, original_tests_json + " ")
            note_panel = note_field.locator("xpath=ancestor::details")
            note_panel.get_by_role(
                "button", name="Apply Anteckningar JSON").click()
            expect(pending.locator(".diagnostic")).to_contain_text(
                "BUILDER_AUTHORING_MULTIPLE_UNAPPLIED", timeout=15000)
            expect(pc).to_have_attribute("data-project-pending-drafts", "true")
            tests_panel = tests_field.locator("xpath=ancestor::details")
            pending.once("dialog", lambda dialog: dialog.accept())
            tests_panel.get_by_role(
                "button", name="Förkasta utkast: Test JSON").click()
            expect(tests_field).to_have_value(original_tests_json)
            expect(pc).to_have_attribute("data-project-pending-drafts", "true")
            note_panel.get_by_role(
                "button", name="Apply Anteckningar JSON").click()
            expect(pc).to_have_attribute("data-project-pending-drafts", "false")
            expect(pc).to_have_attribute("data-project-dirty", "true")
            pc.locator('[data-project-action="save"]').click()
            expect(pc.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            verified = json.loads(pending.evaluate(
                "window.__yadilabProjectStore.text"))
            require(any(note.get("id") == "project065_note" for note in
                        verified["content"]["source"].get("notes", [])),
                    "PROJECT-065 Apply+verified Save did not include note")
            expect(pc).to_have_attribute("data-project-dirty", "false")
            pending.close()
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
                "studioSameTaskLatestFields": True,
                "newestFileImportWinsOutOfOrderReads": True,
                "crossEntryImportStaleActivationDenied": True,
                "obsoleteCompileCannotOverwriteNewImport": True,
                "sameFilenameCanBeReimported": True,
                "unappliedInspectorSaveBlocked": True,
                "explicitInspectorDraftRevertNoWrite": True,
                "explicitJsonDraftRevertPreservesOtherDraft": True,
                "crossEditorUnappliedApplyBlocked": True,
                "canvasSelectionPreservesUnappliedFields": True,
                "unappliedCompileExportDenied": True,
                "unappliedDraftNewRequiresConfirmation": True,
                "unappliedJsonSaveBlocked": True,
                "multiPanelDraftLossBlocked": True,
                "postApplyNativeSaveIncludesDraft": True,
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

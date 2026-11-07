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
    pauseIdentity: false, pendingIdentity: false, releaseIdentity: null };
  const handle = {
    name: "verified-network.yadilab",
    async createWritable() {
      if (store.permissionDenied) throw new DOMException("Permission denied", "NotAllowedError");
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
      return new File([store.text], this.name, {type:"application/json"});
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
            page.keyboard.press("Control+s")
            expect(page.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
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

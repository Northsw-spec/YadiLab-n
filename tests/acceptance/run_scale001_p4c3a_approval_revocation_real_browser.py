#!/usr/bin/env python3
"""Supplementary actual Chromium consent-revocation regression for SCALE-001 P4c3a.

The separately committed original P4c3a frozen-first acceptance is NOT modified.
This test uses genuine 10,000/10,000 DOCX/ODT ZIP originals. No Builder activation.
"""
import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup, exported_source, require
from run_scale001_p4c3a_10000_office_review_real_browser import (
    PRIVATE_NODE, PRIVATE_LINK, original, open_panel, mapping, approve,
    assert_private_absent, close
)

def assert_revoked(panel, reason):
    expect(panel.locator('[data-scale-p4c3a-selection-count="0"]')).to_be_visible()
    expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_disabled()
    final = panel.locator('[data-scale-p4c3a-approve-preflight]')
    require(not final.is_checked(), reason + ": final consent was retained")
    expect(final).to_be_disabled()
    for kind in ("node", "link"):
        checks = panel.locator('[data-scale-p4c3a-approve-'+kind+'-batch]')
        require(checks.count() == 100, reason + ": missing original row approvals")
        require(all(not c.is_checked() for c in checks.all()),
                reason + ": original batch approvals survived a change")

def check(browser, url):
    started = time.perf_counter()
    page, errors, external = setup(browser, url)
    console_leaks = []
    page.on("console", lambda msg: console_leaks.append(msg.text)
            if PRIVATE_NODE in msg.text or PRIVATE_LINK in msg.text else None)
    try:
        before = exported_source(page)
        panel = open_panel(page, "docx", original("docx"))
        mapping(panel)
        approve(panel)

        # Changing a source COLUMN after 200 grants invalidates every prior grant.
        panel.locator('[data-scale-p4c3a-node-role]').select_option("2")
        assert_revoked(panel, "changed original column")
        assert_private_absent(page)
        panel.locator('[data-scale-p4c3a-node-role]').select_option("1")
        assert_revoked(panel, "restored original column")

        approve(panel)

        # Changing an approved source TABLE, even temporarily, revokes consent.
        panel.locator('[data-scale-p4c3a-node-table]').select_option("1")
        assert_revoked(panel, "changed original table")
        panel.locator('[data-scale-p4c3a-node-table]').select_option("0")
        assert_revoked(panel, "restored original table")

        approve(panel)

        # Selecting a new genuine Office original also invalidates all approvals.
        # This intentionally tests UI selection, not impossible in-place mutation
        # of a browser File object (File objects are immutable snapshots).
        panel.locator('[data-scale-p4c3a-file="true"]').set_input_files({
            "name": "different-genuine-10000.odt",
            "mimeType": "application/octet-stream",
            "buffer": original("odt")
        })
        expect(panel.locator(
            '[data-scale-p4c3a-summary="REVIEW_REQUIRED"]'
        )).to_be_visible(timeout=180000)
        assert_revoked(panel, "new original Office file")
        require(panel.locator('[data-scale-p4c3a-node-table]').input_value() == "",
                "new original inherited old table selection")
        require(panel.locator('[data-scale-p4c3a-node-role]').input_value() == "",
                "new original inherited old source column")
        assert_private_absent(page)
        require(not console_leaks, "private original source values leaked to Chromium console")

        # A syntactically named but invalid original Office ZIP must fail closed.
        panel.locator('[data-scale-p4c3a-file="true"]').set_input_files({
            "name": "invalid-original.docx",
            "mimeType": "application/octet-stream",
            "buffer": b"NOT_A_ZIP"
        })
        expect(panel.locator('[data-scale-p4c3a-error="BLOCKED"]')).to_be_visible(
            timeout=30000)
        expect(panel.locator('[data-scale-p4c3a-summary]')).to_have_count(0)
        expect(panel.locator('[data-scale-p4c3a-confirm]')).to_be_disabled()
        assert_private_absent(page)

        heap_mib = page.evaluate("""() => {
          const m = performance.memory;
          return m && Number.isFinite(m.usedJSHeapSize)
            ? Math.round(m.usedJSHeapSize / 1048576 * 100) / 100 : null;
        }""")
        close(panel)
        require(exported_source(page) == before,
                "consent change/file replacement modified active Builder")
        require(not errors, "Chromium page error: " + repr(errors))
        require(not external, "Unexpected external network request: " + repr(external))
        require(not console_leaks, "sensitive source text reached console")
        return {
            "case": "approved_column_table_and_original_change_revokes_all_grants",
            "status": "PASS", "source": "genuine_DOCX_and_ODT_10000_10000",
            "previousApprovalsRevoked": 200, "unsupportedSourceRejected": True,
            "builderMutated": False,
            "consolePrivateCanaryObserved": False,
            "wallSecondsObserved": round(time.perf_counter() - started, 3),
            "pythonMaxRssMiBObserved": round(
                resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2),
            "chromiumPageHeapSampleMiB": heap_mib,
            "performanceSloCertified": False,
            "inFlightBuilderEditOrFileMutationVerified": False
        }
    finally:
        page.close()


def cancel_while_original_read_is_pending(browser, url):
    """True mounted DOM cancel during a deliberately delayed File.arrayBuffer.

    The delay is a *test-side* interception of the browser File read, not a
    modification to product code or a mocked product compiler result.
    """
    started = time.perf_counter()
    page, errors, external = setup(browser, url)
    console_leaks = []
    page.on("console", lambda msg: console_leaks.append(msg.text)
            if PRIVATE_NODE in msg.text or PRIVATE_LINK in msg.text else None)
    try:
        before = exported_source(page)
        panel = open_panel(page, "docx", original("docx"))
        mapping(panel)
        approve(panel)
        page.evaluate("""() => {
          const original = File.prototype.arrayBuffer;
          window.__p4c3aPendingRead = {entered:false,released:false,release:null};
          File.prototype.arrayBuffer = function(...args) {
            const gate = window.__p4c3aPendingRead;
            if (!gate || gate.released) return original.apply(this,args);
            gate.entered = true;
            return new Promise((resolve,reject) => {
              gate.release = () => {
                gate.released = true;
                original.apply(this,args).then(resolve,reject);
              };
            });
          };
          window.__p4c3aRestoreFileRead = () => {
            File.prototype.arrayBuffer = original;
          };
        }""")
        panel.locator('[data-scale-p4c3a-confirm]').click()
        page.wait_for_function(
            "() => window.__p4c3aPendingRead?.entered && "
            "typeof window.__p4c3aPendingRead.release === 'function'",
            timeout=30000
        )
        # The app has begun its actual source-check callback and is awaiting
        # the original File read; cancel using the genuine UI before resolving.
        close(panel)
        page.evaluate("""() => {
          window.__p4c3aPendingRead.release();
          window.__p4c3aRestoreFileRead();
        }""")
        page.wait_for_timeout(500)
        require(page.locator('[data-scale-p4c3a-validated]').count() == 0,
                "stale async source result appeared after user cancellation")
        require(page.locator('[data-scale-p4c3a-panel]').count() == 0,
                "cancelled Office dialog reopened after asynchronous source read")
        require(exported_source(page) == before,
                "cancelling in-flight preflight mutated active Builder")
        require(not errors, "Uncaught JS during cancelled async file read: " + repr(errors))
        require(not external, "External request during cancelled async file read: " + repr(external))
        require(not console_leaks, "private canary leaked during cancelled async file read")
        return {
            "case": "real_original_async_file_read_cancelled_before_completion",
            "status": "PASS",
            "genuineOriginal": "DOCX_10000_10000",
            "pendingFileReadInterceptedInBrowser": True,
            "cancelRevokedPendingConsent": True,
            "builderMutated": False,
            "wallSecondsObserved": round(time.perf_counter()-started, 3),
            "inFlightBuilderEditOrFileMutationVerified": False
        }
    finally:
        page.close()


def builder_edit_while_original_read_is_pending(browser, url):
    """Actual React Builder edit while a genuine DOCX File read is pending.

    The test delays the browser File read and dispatches a DOM click to the
    existing Scenario Studio create action behind the modal. This tests a
    concurrent app state transition; it does not claim that the overlay
    permits ordinary mouse clicks through the modal.
    """
    started = time.perf_counter()
    page, errors, external = setup(browser, url)
    console_leaks = []
    page.on("console", lambda msg: console_leaks.append(msg.text)
            if PRIVATE_NODE in msg.text or PRIVATE_LINK in msg.text else None)
    page.on("dialog", lambda dialog: dialog.accept())
    try:
        before = exported_source(page)
        # Scenario Studio remains mounted but can be hidden in the active
        # workspace view. This test intentionally invokes its actual React
        # create action via DOM during the modal's held File read.
        studio = page.locator('[data-scenario-studio="ready"]')
        expect(studio).to_have_count(1)
        new_id = "studio_scenario"

        panel = open_panel(page, "docx", original("docx"))
        mapping(panel)
        approve(panel)
        page.evaluate("""() => {
          const original = File.prototype.arrayBuffer;
          window.__p4c3aBuilderReadGate = {entered:false,release:null};
          File.prototype.arrayBuffer = function(...args) {
            const gate = window.__p4c3aBuilderReadGate;
            if (!gate || !gate.release) {
              gate.entered = true;
              return new Promise((resolve,reject) => {
                gate.release = () => original.apply(this,args).then(resolve,reject);
              });
            }
            return original.apply(this,args);
          };
          window.__p4c3aRestoreBuilderRead = () => {
            File.prototype.arrayBuffer = original;
          };
        }""")
        panel.locator('[data-scale-p4c3a-confirm]').click()
        page.wait_for_function(
            "() => window.__p4c3aBuilderReadGate?.entered && "
            "typeof window.__p4c3aBuilderReadGate.release === 'function'",
            timeout=30000
        )

        # Invoke the *real* React Scenario Studio Builder action while a
        # source read is deliberately held. Programmatic click bypasses only
        # the modal pointer overlay; it does not inject/mutate React state.
        page.evaluate("""() => {
          const button = document.querySelector('[data-studio-action="create"]');
          if (!button || button.disabled) throw Error("Missing Builder create");
          button.click();
        }""")
        expect(studio.locator('[data-studio-draft-revision]')).to_contain_text(
            new_id, timeout=30000)
        # An open modal correctly intercepts user-pointer exports.
        # Actual React Studio status above establishes the new revision;
        # verify the Builder export only after the modal has been closed.
        page.evaluate("""() => {
          window.__p4c3aBuilderReadGate.release();
          window.__p4c3aRestoreBuilderRead();
        }""")
        expect(panel.locator('[data-scale-p4c3a-error="BLOCKED"]')).to_be_visible(
            timeout=30000)
        require(panel.locator('[data-scale-p4c3a-validated]').count() == 0,
                "stale preflight validated after active Builder changed")
        require("SCALE_P4C3A_BUILDER_CHANGED" in
                panel.locator('[data-scale-p4c3a-error="BLOCKED"]').inner_text(),
                "stale Builder rejected for an unexpected or weaker reason")
        assert_private_absent(page)
        close(panel)
        changed = exported_source(page)
        require(changed != before,
                "Concurrent genuine Builder create action did not change source")
        require(changed.get("scenarioId") == new_id,
                "Later Builder scenario identity was not preserved")
        require(not errors, "JS error during concurrent Builder edit: " + repr(errors))
        require(not external, "External network during Builder edit: " + repr(external))
        require(not console_leaks, "Private canary leaked during Builder edit")
        return {
            "case": "actual_builder_revision_during_delayed_original_read",
            "status": "PASS",
            "builderEditCommittedByRealScenarioStudioAction": True,
            "stalePreflightBlocked": True,
            "laterBuilderRevisionPreserved": True,
            "originalSourceNotActivated": True,
            "browserOriginalFileMutationVerified": False,
            "wallSecondsObserved": round(time.perf_counter()-started,3)
        }
    finally:
        page.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    target = urlsplit(args.url)
    require(target.scheme == "http" and target.hostname == "127.0.0.1" and
            target.port is not None and target.path == "/" and
            not target.query and not target.fragment,
            "P4c3a supplementary tests require isolated localhost Chromium")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        flags = ["--disable-background-networking", "--disable-dev-shm-usage"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            flags.append("--no-sandbox")
        browser = pw.chromium.launch(headless=True, args=flags)
        try:
            observed = check(browser, args.url)
            cancelled = cancel_while_original_read_is_pending(browser, args.url)
            stale_builder = builder_edit_while_original_read_is_pending(browser, args.url)
        finally:
            browser.close()
    record = {
        "kind": "SCALE-001 P4c3a supplementary actual Chromium revocation",
        "status": "PASS", "observations": observed,
        "cancelInFlightObservations": cancelled,
        "staleBuilderObservations": stale_builder,
        "frozenOriginalTestUnchanged": True,
        "fullOfficeGraphVerified": False, "engineVerified": False,
        "physicalTopologyVerified": False
    }
    (args.evidence_dir /
     "scale001-p4c3a-office-revocation-chromium.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print("PASS SCALE-001 P4c3a supplementary Chromium original column/table/file "
          "changes revoke all 200 grants; in-flight original read cancellation, "
          "no Builder mutation or console leaks")
    print(json.dumps(record, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print("FAIL SCALE-001 P4c3a supplementary real Chromium: " + str(err),
              file=sys.stderr)
        raise

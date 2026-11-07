#!/usr/bin/env python3
"""PROJECT-003: a verified native write must not be followed by an awaited hash.

A hash after FileSystemWritableFileStream.close/readback can fail or suspend.
Project association must be finalized without such an asynchronous gap.
This checks the compiled app in actual Chromium with controlled filesystem I/O.
"""
import argparse
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from run_project_file_real_browser import MOCK


HASH_TRAP = r"""
(() => {
  const previous = SubtleCrypto.prototype.digest;
  window.__postWriteHashTrap = { enabled: true, violations: 0 };
  Object.defineProperty(SubtleCrypto.prototype, 'digest', {
    configurable: true,
    writable: true,
    value: function(...args) {
      if (window.__postWriteHashTrap.enabled &&
          window.__yadilabProjectStore?.writes > 0) {
        window.__postWriteHashTrap.violations++;
        return Promise.reject(new Error('PROJECT_POST_WRITE_DIGEST_FORBIDDEN'));
      }
      return previous.apply(this, args);
    },
  });
})();
"""


def require(value, message):
    if not value:
        raise AssertionError(message)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--evidence-dir", type=Path, required=True)
    a = ap.parse_args()
    u = urlsplit(a.url)
    require(u.scheme == "http" and u.hostname == "127.0.0.1" and
            u.port and u.path == "/" and not u.query and not u.fragment,
            "Compiled app must be served from the local test origin")
    a.evidence_dir.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            "--disable-background-networking", "--disable-dev-shm-usage", "--no-sandbox"])
        try:
            context = browser.new_context(service_workers="block", accept_downloads=True)
            page = context.new_page()
            page.add_init_script(MOCK)
            page.add_init_script(HASH_TRAP)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(a.url, wait_until="domcontentloaded", timeout=30000)
            controls = page.locator('[data-project-file-controls="ready"]')
            expect(controls).to_be_visible(timeout=45000)
            require(page.evaluate("window.__yadilabProjectStore.writes") == 0,
                    "Implicit project file writes occurred before an explicit Save")

            # A first Save As uses the native test handle. This trap rejects
            # any WebCrypto digest AFTER its write has successfully closed.
            # Old implementation failed this case: digestProjectText(data)
            # was awaited *after* write/readback while association was partial.
            page.locator('[data-project-action="save-as"]').click()
            expect(controls.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            require(page.evaluate("window.__yadilabProjectStore.writes") == 1,
                    "First Save As did not commit precisely one verified native write")
            require(page.evaluate("window.__postWriteHashTrap.violations") == 0,
                    "Project code attempted a fallible digest after native write")
            expect(controls).to_have_attribute("data-project-dirty", "false")

            # Prove that the trap is effective, rather than a harmless no-op.
            trapped = page.evaluate("""async () => {
                try {
                    await crypto.subtle.digest('SHA-256', new Uint8Array([1]));
                    return false;
                } catch (error) {
                    return String(error).includes('PROJECT_POST_WRITE_DIGEST_FORBIDDEN');
                }
            }""")
            require(trapped, "The post-write WebCrypto failure trap was not active")
            require(page.evaluate("window.__postWriteHashTrap.violations") == 1,
                    "Expected exactly one deliberate control violation")
            page.evaluate("window.__postWriteHashTrap.enabled = false")

            # The verified file association and precomputed digest must still
            # support an ordinary subsequent Ctrl+S on the same native handle.
            page.keyboard.press("Control+s")
            expect(controls.locator('[data-project-message]')).to_contain_text(
                "Saved and read back", timeout=20000)
            page.wait_for_function("window.__yadilabProjectStore.writes === 2",
                                   timeout=15000)
            expect(controls).to_have_attribute("data-project-dirty", "false")
            require(not errors, "Compiled browser raised uncaught exceptions: " + repr(errors))
            (a.evidence_dir / "project-postwrite-hash.txt").write_text(
                "PASS PROJECT-003 native Save As and Ctrl+S; no hash after first write\n")
            print("PASS PROJECT-003 compiled Chromium: no asynchronous post-write hash; durable native Save As and Ctrl+S")
        finally:
            browser.close()


if __name__ == "__main__":
    main()

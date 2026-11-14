# ATLAS-001 F4B-D — native Linux Save/Open acceptance

This procedure is the required durable-file gate when the automated Chromium
runner cannot operate the native Linux picker. It may be run on an approved
Debian or Ubuntu x86_64 machine against the compiled Linux distribution.
The report must name the actual distribution used; Debian is an approved
substitute for Parrot under the repository's permanent operating-system policy.

## Preconditions

1. Build or obtain the exact `distribution/linux-x86_64/` artifact for the PR
   HEAD. Verify `SHA256SUMS.txt` before starting:

   ```sh
   cd distribution/linux-x86_64
   sha256sum -c SHA256SUMS.txt
   file app-launcher
   ```

   The launcher must be an ELF 64-bit x86-64 binary and the directory must
   contain `web/assets/elk-worker.js` and `web/assets/elk-worker-proxy.js`.
2. Run the target gate as a non-root user. On Parrot, the legacy command can
   be used directly:

   ```sh
   bash scripts/run_parrot_acceptance.sh
   ```

   The legacy script name is retained for compatibility with older Parrot
   hosts. On approved Debian/Ubuntu hosts, its historical Parrot-only
   pre-check may return `BLOCKED`; that label is not a functional failure of
   the Debian-equivalence policy. Re-run the remaining checksum, launcher,
   loopback, CSP and Chromium checks manually and record the actual OS.

## Durable Save/Open sequence

1. Start the distribution with no Node/Python toolchain in its runtime path:

   ```sh
   env -i PATH=/usr/bin:/bin HOME="$HOME" \
     distribution/linux-x86_64/app-launcher --port 18971
   ```

2. Open `http://127.0.0.1:18971/` in Chromium. Confirm the address is the
   loopback origin and that the UI shows the compiled release identity.
3. Use Network import and select the independent
   `atlas001-normal-density-200-redundant.xlsx` fixture. Confirm the preview
   reports exactly 200 devices and 1,600 explicit links.
4. Activate NORMAL layout and wait for the visible 15-second Worker timeout.
   Confirm the diagnostic says the Worker was terminated and the active
   Builder was not replaced. Do not close Chromium yet.
5. Close the import panel, choose **Save As**, and use the native picker to
   save to a new path such as
   `$HOME/YadiLab-evidence/atlas001-f4b-d-after-timeout.yadilab`.
   Record the exact path and the visible “Saved and read back” confirmation.
6. In a terminal, while the browser remains open, record the durable bytes:

   ```sh
   sha256sum "$HOME/YadiLab-evidence/atlas001-f4b-d-after-timeout.yadilab"
   wc -c "$HOME/YadiLab-evidence/atlas001-f4b-d-after-timeout.yadilab"
   ```

   The file must exist outside the browser process. A download prompt,
   in-memory object, or mock handle is not evidence of durable Save.
7. Close the browser completely. Start a fresh Chromium session at the same
   loopback URL, choose **Open**, select the saved `.yadilab`, and confirm the
   UI reports “Opened editable source”. Export the canonical source and verify
   that the resource/link counts and source SHA match the saved document.
8. Re-import the independent `50-linear` fixture and confirm exactly 50
   devices and 49 explicit links. This proves the timeout did not corrupt the
   saved file or prevent a subsequent valid Worker/import.
9. Repeat steps 3–8 once with an operator Cancel instead of the timeout.

## Evidence to retain

Keep the two Chromium screenshots (timeout and cancel), the saved `.yadilab`
file, both `sha256sum` outputs, byte counts, the Parrot acceptance report and
the exact distribution SHA. Report `DURABLE_SAVE_OPEN=PASS` only when all of
these artifacts exist. Otherwise report `NOT_TESTED` or `FAIL` with the exact
missing step.

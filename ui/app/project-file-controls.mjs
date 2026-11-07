import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createProjectDocument, readProjectFile, writeProjectFile, digestProjectText,
  assertProjectOpenDiskUnchanged, sameProjectFileEntry, assertSafeRecoveryTarget,
  projectFilename, projectSnapshot, projectHasUnsavedChanges,
  sameEditableProjectRevision,
} from "./project-document.mjs";

const e = React.createElement;
const pickerTypes = [{ description: "YadiLab editable project", accept: { "application/json": [".yadilab"] } }];
const diag = (code, message, severity = "error") => ({ severity, code, message });

function downloadUnverified(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Browser front end to the explicit project document. Never persists automatically.
 * A download cannot prove that a user stored the file; only a writable native
 * handle followed by exact-byte readback counts as a verified Save.
 */
export function ProjectFileControls({
  workspace, getWorkspace, onReplace, setWorkspace,
  validateSource, setDiagnostics, beforeSwitchRef, busy,
}) {
  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const handleRef = useRef(null);
  // Keep failed target identities even after a successful Save As to a
  // different file. Reopening a file is the explicit recovery boundary.
  const quarantinedHandlesRef = useRef([]);
  const fileFingerprintRef = useRef(null);
  const unpersistedRef = useRef(false); // welcome sample is not an unsaved user-created project
  const baselineRef = useRef(projectSnapshot(workspace));
  const lastBuilderSnapshotRef = useRef(projectSnapshot(workspace));
  const fileEpochRef = useRef(0);
  const nameRef = useRef(projectFilename(workspace.mode === "builder" ? workspace.source.scenarioId : "Untitled"));
  const [name, setName] = useState(nameRef.current);
  const [message, setMessage] = useState("No project file attached");
  const [revision, setRevision] = useState(0);
  // A 10k-resource project is serialized only when editable source/layout
  // references actually change, not on every React render or Engine frame.
  const currentSnapshot = useMemo(() => projectSnapshot(workspace),
    [workspace.mode, workspace.mode === "builder" ? workspace.source : null,
      workspace.mode === "builder" ? workspace.layoutOverrides : null]);
  if (workspace.mode === "builder") lastBuilderSnapshotRef.current = currentSnapshot;
  // Runtime preview is not a project save: pending Builder edits stay pending.
  const changed = projectHasUnsavedChanges(lastBuilderSnapshotRef.current,
    baselineRef.current, unpersistedRef.current);
  const changedRef = useRef(changed);
  changedRef.current = changed;
  const nameState = (value) => { nameRef.current = value; setName(value); };
  const showError = (error, code = "PROJECT_ACTION_FAILED") => {
    const name = error?.name;
    if (name === "AbortError") {
      setMessage("Cancelled; current project was not changed.");
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    setMessage("Operation failed: " + reason);
    setDiagnostics([diag(error?.code ?? code, reason)]);
  };
  const canDiscard = () => {
    if (busyRef.current) {
      setMessage("A project file operation is still running.");
      return false;
    }
    return !changedRef.current ||
      window.confirm("Projektet har osparade ändringar. Vill du fortsätta utan att spara dem?");
  };
  // This callback is used by other user-initiated scenario switches in App.
  beforeSwitchRef.current = canDiscard;

  const previousWorkspaceRef = useRef(workspace);
  // Any new canonical source must detach the old file handle; ordinary edits
  // increment the existing Builder revision and must retain that handle.
  useEffect(() => {
    const previous = previousWorkspaceRef.current;
    previousWorkspaceRef.current = workspace;
    if (workspace.mode === "builder" && workspace.source !== previous?.source) {
      const sameProjectEdit = sameEditableProjectRevision(previous, workspace);
      if (!sameProjectEdit) {
        resetAssociation(workspace, projectFilename(workspace.source.scenarioId), null, null, true);
        setMessage("Different scenario loaded and not saved; choose Save As for its own project file.");
      }
    } else if (workspace.mode === "runtime" && workspace.source !== previous?.source) {
      // A different Runtime (package/experiment) is not a preview of the
      // current editable project. Do not retain its file handle or dirty flag.
      fileEpochRef.current++;
      handleRef.current = null;
      quarantinedHandlesRef.current = [];
      fileFingerprintRef.current = null;
      unpersistedRef.current = false;
      baselineRef.current = null;
      lastBuilderSnapshotRef.current = null;
      nameState("Runtime (no project file)");
      setMessage("Different Runtime opened. Return to Builder to save its source.");
      setRevision(n => n + 1);
    }
  }, [workspace]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (changedRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const resetAssociation = (next, filename, handle, fileFingerprint = null, unpersisted = false) => {
    fileEpochRef.current++;
    unpersistedRef.current = unpersisted;
    // Open/New call this before React renders the replacement. Record the
    // replacement so the external-switch effect cannot detach its valid handle.
    previousWorkspaceRef.current = next;
    baselineRef.current = projectSnapshot(next);
    lastBuilderSnapshotRef.current = baselineRef.current;
    handleRef.current = handle;
    quarantinedHandlesRef.current = [];
    fileFingerprintRef.current = fileFingerprint;
    nameState(filename);
    setRevision(n => n + 1);
  };

  const openFromFile = async (file, handle = null, confirmed = false, lockHeld = false) => {
    if (!file || (busyRef.current && !lockHeld)) return;
    if (!confirmed && !canDiscard()) return;
    const origin = getWorkspace();
    const epoch = fileEpochRef.current;
    if (!lockHeld) busyRef.current = true;
    try {
      const content = await readProjectFile(file, { validateSource });
      // A selected native file may change after getFile() returned a snapshot.
      // Never bind that outdated snapshot as the current on-disk project.
      if (handle) await assertProjectOpenDiskUnchanged(handle, content.fileSha256);
      if (getWorkspace() !== origin || fileEpochRef.current !== epoch)
        throw new Error("PROJECT_WORKSPACE_CHANGED_DURING_OPEN");
      const next = {
        mode: "builder", source: content.source, sourceRevision: 0,
        dirty: false, selection: { ids: [] },
        layoutOverrides: content.layoutOverrides,
        compile: { status: "idle" },
      };
      // The source is verified; compilation is deliberately NOT restored.
      onReplace(next);
      resetAssociation(next, projectFilename(file.name), handle, content.fileSha256);
      setMessage("Opened editable source; recompile to verify Engine truth.");
      setDiagnostics([diag("PROJECT_SOURCE_OPENED", "Project reopened as editable source. Archived runtime and Engine PASS were not restored.", "warning")]);
    } catch (error) { showError(error, "PROJECT_OPEN_BLOCKED"); }
    finally { if (!lockHeld) busyRef.current = false; }
  };

  const openNative = async () => {
    if (busy || busyRef.current) return;
    if (typeof window.showOpenFilePicker !== "function") {
      inputRef.current?.click();
      return;
    }
    if (!canDiscard()) return;
    const origin = getWorkspace();
    const epoch = fileEpochRef.current;
    // Reserve the same lock used by Save/New and scenario switching BEFORE
    // showing the native chooser. The picker and getFile() both await; neither
    // may overlap another explicit project operation.
    busyRef.current = true;
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false, types: pickerTypes, excludeAcceptAllOption: true,
      });
      const handle = handles?.[0];
      if (!handle) return;
      const file = await handle.getFile();
      if (getWorkspace() !== origin || fileEpochRef.current !== epoch)
        throw new Error("PROJECT_WORKSPACE_CHANGED_DURING_PICKER");
      // Transfer temporary ownership of the lock to the same verified reader.
      // The outer finally releases it only after Open has fully completed.
      await openFromFile(file, handle, true, true);
    } catch (error) { showError(error, "PROJECT_OPEN_BLOCKED"); }
    finally { busyRef.current = false; }
  };

  const newProject = () => {
    if (busy || busyRef.current || !canDiscard()) return;
    const next = onReplace(null);
    if (!next || next.mode !== "builder") return;
    resetAssociation(next, "Untitled.yadilab", null, null, true);
    setMessage("New unsaved project. Save As to choose a file.");
    setDiagnostics([diag("PROJECT_NEW", "Created a new editable project with no associated file.", "warning")]);
  };

  const saveProject = async (forceSaveAs = false) => {
    const before = getWorkspace();
    if (busy || busyRef.current || before?.mode !== "builder") {
      setMessage("Save requires editable Builder mode and an idle workspace.");
      return;
    }
    const original = projectSnapshot(before);
    const epoch = fileEpochRef.current;
    // File identity checks may await browser permissions or the filesystem.
    // The originating project must still be current at EVERY write boundary.
    const requireLiveSaveSource = () => {
      if (fileEpochRef.current !== epoch || projectSnapshot(getWorkspace()) !== original)
        throw new Error("PROJECT_STALE_BEFORE_WRITE");
    };
    const filename = forceSaveAs || !handleRef.current
      ? projectFilename(before.source.scenarioId) : nameRef.current;
    // Native picker MUST be started in the direct user-activation call stack.
    let picker;
    if (forceSaveAs || !handleRef.current) {
      if (typeof window.showSaveFilePicker === "function") {
        try { picker = window.showSaveFilePicker({
          suggestedName: filename, types: pickerTypes, excludeAcceptAllOption: true,
        }); }
        catch (error) { showError(error, "PROJECT_SAVE_PICKER_BLOCKED"); return; }
      }
    }
    busyRef.current = true;
    try {
      const handle = picker ? await picker : forceSaveAs ? null : handleRef.current;
      const data = await createProjectDocument(before, { validateSource });
      requireLiveSaveSource();
      if (!handle) {
        downloadUnverified(data, filename);
        // A browser download is not a verified durable project save.
        setMessage("Download initiated; disk write cannot be verified. Open the downloaded file to check.");
        setDiagnostics([diag("PROJECT_DOWNLOAD_UNVERIFIED", "Save As downloaded a file, but browser restrictions prevent verifying its durable bytes.", "warning")]);
        return;
      }
      // Calculate the exact-file fingerprint BEFORE performing any native write.
      // A WebCrypto await after close/readback could suspend with a partially
      // rebound handle or fail despite the file having been written successfully.
      const writtenFingerprint = await digestProjectText(data);
      requireLiveSaveSource();
      // A failed write leaves its target quarantined. Re-selecting that same
      // physical file through Save As must NOT bypass the conflict warning.
      await assertSafeRecoveryTarget(quarantinedHandlesRef.current, handle);
      requireLiveSaveSource();
      // Identity comparison may itself suspend while an editor changes Builder.
      const writingKnownFile = await sameProjectFileEntry(handleRef.current, handle);
      requireLiveSaveSource();
      if (writingKnownFile && !fileFingerprintRef.current)
        throw new Error("PROJECT_EXPECTED_DIGEST_MISSING");
      try {
        await writeProjectFile(handle, data, {
          ...(writingKnownFile
            ? { expectedFileSha256: fileFingerprintRef.current }
            : { requireEmptyTarget: true }),
        });
      } catch (error) {
        // A failed native write may have modified the file. Quarantine this
        // physical target even if it is selected again via a new JS handle.
        // Never corrupt another project's association after async I/O.
        if (fileEpochRef.current === epoch) {
          quarantinedHandlesRef.current = [...quarantinedHandlesRef.current, handle];
          handleRef.current = null;
          fileFingerprintRef.current = null;
          unpersistedRef.current = true;
          setRevision(n => n + 1);
        }
        throw error;
      }
      // A different project may have been activated during asynchronous I/O.
      // Never bind an old file handle or baseline to that new project.
      if (fileEpochRef.current !== epoch) {
        setMessage("File was written, but the active project changed. Current project remains unsaved.");
        setDiagnostics([diag("PROJECT_SAVE_ASSOCIATION_STALE",
          "The verified write belongs to an earlier project. Current project was not marked saved.", "warning")]);
        return;
      }
      // Association still follows the written file if only current-project edits occurred.
      // No awaits between the last generation check and association commit.
      handleRef.current = handle;
      fileFingerprintRef.current = writtenFingerprint;
      unpersistedRef.current = false;
      nameState(projectFilename(handle.name || filename));
      baselineRef.current = original;
      lastBuilderSnapshotRef.current = projectSnapshot(getWorkspace());
      setRevision(n => n + 1);
      if (projectSnapshot(getWorkspace()) !== original || fileEpochRef.current !== epoch) {
        setMessage("File saved, but the workspace changed during writing: newer edits remain unsaved.");
        setDiagnostics([diag("PROJECT_SAVE_STALE", "The written file passed readback, but more recent edits were not in that file.", "warning")]);
        return;
      }
      const active = getWorkspace();
      setWorkspace({ ...active, dirty: false });
      setMessage("Saved and read back from " + nameRef.current);
      setDiagnostics([diag("PROJECT_SAVE_VERIFIED", "Project bytes were written and read back from the selected local file.", "warning")]);
    } catch (error) { showError(error, "PROJECT_SAVE_BLOCKED"); }
    finally { busyRef.current = false; }
  };

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) &&
          !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) void saveProject(true);
        else void saveProject(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return e("section", { className: "project-file-controls", "data-project-file-controls": "ready",
    "aria-label": "YadiLab project file controls", "data-project-dirty": String(changed),
    "data-project-filename": name, "data-project-revision": String(revision) },
    e("div", { className: "project-file-buttons" },
      e("strong", null, "PROJECT"),
      e("button", { type: "button", "data-project-action": "new",
        onClick: newProject, disabled: busy }, "New"),
      e("button", { type: "button", "data-project-action": "open",
        onClick: () => void openNative(), disabled: busy }, "Open…"),
      e("button", { type: "button", "data-project-action": "save",
        onClick: () => void saveProject(), disabled: busy || workspace.mode !== "builder" }, "Save · Ctrl+S"),
      e("button", { type: "button", "data-project-action": "save-as",
        onClick: () => void saveProject(true), disabled: busy || workspace.mode !== "builder" }, "Save As…"),
      e("input", { type: "file", accept: ".yadilab", ref: inputRef,
        "data-project-input": "true", style: { display: "none" },
        onChange: (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void openFromFile(file);
        } }),
      e("span", { "data-project-status": changed ? "unsaved" : "unchanged" },
        name, changed ? " · UNSAVED" : " · unchanged"),
    ),
    e("small", { "data-project-message": "true", role: "status", "aria-live": "polite" }, message),
    e("small", null, "Explicit file saving only. No project autosave. Imported files reopen as editable source, not verified Engine results."),
  );
}

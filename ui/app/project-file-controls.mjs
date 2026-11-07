import React, { useEffect, useRef, useState } from "react";
import {
  createProjectDocument, readProjectFile, writeProjectFile,
  projectFilename, projectSnapshot,
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
  const baselineRef = useRef(projectSnapshot(workspace));
  const nameRef = useRef(projectFilename(workspace.mode === "builder" ? workspace.source.scenarioId : "Untitled"));
  const [name, setName] = useState(nameRef.current);
  const [message, setMessage] = useState("No project file attached");
  const [revision, setRevision] = useState(0);
  const currentSnapshot = projectSnapshot(workspace);
  const changed = workspace.mode === "builder" &&
    currentSnapshot !== baselineRef.current;
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
  const canDiscard = () => !changedRef.current ||
    window.confirm("Projektet har osparade ändringar. Vill du fortsätta utan att spara dem?");
  // This callback is used by other user-initiated scenario switches in App.
  beforeSwitchRef.current = canDiscard;

  const previousWorkspaceRef = useRef(workspace);
  // External scenario switches must detach the old writable file handle.
  useEffect(() => {
    const previous = previousWorkspaceRef.current;
    previousWorkspaceRef.current = workspace;
    if (workspace.mode === "builder" && workspace.sourceRevision === 0 &&
        !workspace.dirty && workspace.source !== previous?.source &&
        projectSnapshot(workspace) !== baselineRef.current) {
      resetAssociation(workspace, projectFilename(workspace.source.scenarioId), null);
      setMessage("Different scenario loaded; choose Save As for its own project file.");
    }
  }, [workspace]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (changedRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const resetAssociation = (next, filename, handle) => {
    baselineRef.current = projectSnapshot(next);
    handleRef.current = handle;
    nameState(filename);
    setRevision(n => n + 1);
  };

  const openFromFile = async (file, handle = null) => {
    if (!file || busyRef.current) return;
    if (!canDiscard()) return;
    const origin = getWorkspace();
    busyRef.current = true;
    try {
      const content = await readProjectFile(file, { validateSource });
      if (getWorkspace() !== origin && !canDiscard()) return;
      const next = {
        mode: "builder", source: content.source, sourceRevision: 0,
        dirty: false, selection: { ids: [] },
        layoutOverrides: content.layoutOverrides,
        compile: { status: "idle" },
      };
      // The source is verified; compilation is deliberately NOT restored.
      onReplace(next);
      resetAssociation(next, projectFilename(file.name), handle);
      setMessage("Opened editable source; recompile to verify Engine truth.");
      setDiagnostics([diag("PROJECT_SOURCE_OPENED", "Project reopened as editable source. Archived runtime and Engine PASS were not restored.", "warning")]);
    } catch (error) { showError(error, "PROJECT_OPEN_BLOCKED"); }
    finally { busyRef.current = false; }
  };

  const openNative = async () => {
    if (busy || busyRef.current || !canDiscard()) return;
    if (typeof window.showOpenFilePicker !== "function") {
      inputRef.current?.click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false, types: pickerTypes, excludeAcceptAllOption: true,
      });
      const handle = handles?.[0];
      if (!handle) return;
      await openFromFile(await handle.getFile(), handle);
    } catch (error) { showError(error, "PROJECT_OPEN_BLOCKED"); }
  };

  const newProject = () => {
    if (busy || busyRef.current || !canDiscard()) return;
    const next = onReplace(null);
    if (!next || next.mode !== "builder") return;
    resetAssociation(next, "Untitled.yadilab", null);
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
      if (projectSnapshot(getWorkspace()) !== original) throw new Error("PROJECT_STALE_BEFORE_WRITE");
      if (!handle) {
        downloadUnverified(data, filename);
        // A browser download is not a verified durable project save.
        setMessage("Download initiated; disk write cannot be verified. Open the downloaded file to check.");
        setDiagnostics([diag("PROJECT_DOWNLOAD_UNVERIFIED", "Save As downloaded a file, but browser restrictions prevent verifying its durable bytes.", "warning")]);
        return;
      }
      await writeProjectFile(handle, data);
      // Association still follows the written file even if edits occurred during I/O.
      handleRef.current = handle;
      nameState(projectFilename(handle.name || filename));
      baselineRef.current = original;
      setRevision(n => n + 1);
      if (projectSnapshot(getWorkspace()) !== original) {
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

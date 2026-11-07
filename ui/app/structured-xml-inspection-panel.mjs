import React, { useEffect, useRef, useState } from "react";
import { SharedAnsibleOrdinalReview } from "./shared-ansible-ordinal-review.mjs";
import { validateSharedSourceReviewResult, sharedSourceTrackMeaning, sharedReviewLifecycle } from "./shared-source-review-contract.mjs";
const e = React.createElement;

/** Aggregate-only, already validated producer metadata; no source content. */
export function StructuredXmlInspectionDetails({ result }) {
  if (!result) return e("p", { "data-ic010-p2-empty": "true" },
    "Choose a supported local document. Explicit consent is required before inspection.");
  if (result.status === "BLOCKED") return e("section", {
    "data-ic010-p2-result": "BLOCKED", role: "alert", className: "helper-status blocked",
  }, "Inspection blocked: ", result.code,
    e("p", null, "No file data was imported and no network state was changed."));
  const counts = result.summary.kind === "GRAPH_STRUCTURE"
    ? "Nodes: " + result.summary.nodes + " · Graph edges: " + result.summary.graphEdges
    : result.summary.kind === "NMAP_OBSERVATIONS"
    ? "Reported hosts: " + result.summary.observedHosts + " · Scan-time ports: " + result.summary.reportedPorts
    : result.summary.kind === "NESSUS_REPORT"
    ? "Report hosts: " + result.summary.reportedHosts + " · Findings: " + result.summary.reportedFindings
    : result.summary.kind === "DRAWIO_DIAGRAM"
    ? "Pages: " + result.summary.pages + " · Drawn vertices: " + result.summary.vertices +
      " · Drawn edges: " + result.summary.drawnEdges
    : result.summary.kind === "ANSIBLE_YAML_INVENTORY" || result.summary.kind === "ANSIBLE_INI_INVENTORY"
    ? "Documented hosts: " + result.summary.documentedHosts +
      " · Groups: " + result.summary.documentedGroups +
      " · Source-bound host references: " + result.summary.originalHostLocatorCount
    : "Tables: " + result.summary.declaredTables +
      " · Rows: " + result.summary.declaredRows +
      " · Structural cells: " + result.summary.structuralCells +
      " · Source-bound cell references: " + result.summary.sourceBoundCellLocators;
  return e("section", {
    className: "network-import-preview",
    "data-ic010-p2-result": result.status,
    "data-ic010-p2-profile": result.profileId,
  },
    e("h3", null, "Validated source profile"),
    e("p", { "data-ic010-p2-status": result.status }, "Status: " + result.status),
    e("p", { "data-ic010-p2-track": result.semanticTrack }, "Source classification: " + result.semanticTrack),
    e("p", { "data-ic010-p3d-source-meaning": result.semanticTrack }, sharedSourceTrackMeaning(result.semanticTrack)),
    e("p", { "data-ic010-p2-profile-label": "true" }, "Profile: " + result.profileId),
    e("p", { "data-ic010-p2-sha": "true" }, "Original SHA-256: " + result.sourceSha256),
    e("p", { "data-ic010-p2-source-locator": result.documentLocator.kind },
      "Original locator: source-document · SHA-256 bound"),
    e("p", { "data-ic010-p2-counts": result.summary.kind }, counts),
    e("p", { "data-ic010-p2-activation": "BLOCKED" },
      "Read-only inspection. No Builder or Runtime change, no modeled or live probe. ",
      "Graph edges are not verified cables; Nmap/Nessus findings are historical observations; " +
      "Ansible host/group records and Office document cells are only documented structure, ",
      "not verified network devices, host identities, Engine PASS or proven network state. ",
      "For individual Office cells, use the separate source-bound and consented format-specific review."),
  );
}

/**
 * No onConfirm/onActivate, no Builder setter, no Engine access and no remote IO.
 * File changes, consent withdrawal, close and workspace changes invalidate
 * pending reads and all previously displayed source metadata.
 */
export function StructuredXmlInspectionPanel({
  inspectFile, onClose, workspaceIdentity, getCurrentWorkspaceIdentity,
  model = null, onExportReviewed,
}) {
  const [selection, setSelection] = useState(null);
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const selectedFile = useRef(null);
  const consentNow = useRef(false);
  const dialog = useRef(null);

  const reset = (file = null) => {
    epoch.current++;
    selectedFile.current = file;
    consentNow.current = false;
    setSelection(file === null ? null : "PENDING");
    setConsent(false);
    setResult(null);
    setError("");
    setBusy(false);
  };
  const close = () => { reset(); onClose(); };
  useEffect(() => {
    dialog.current?.focus();
    return () => { epoch.current++; selectedFile.current = null; consentNow.current = false; };
  }, []);
  useEffect(() => { reset(); }, [workspaceIdentity]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changeConsent = (value) => {
    epoch.current++;
    consentNow.current = value;
    setConsent(value);
    setResult(null);
    setError("");
    setBusy(false);
  };

  const inspect = async () => {
    const file = selectedFile.current;
    if (!file || !consentNow.current || busy ||
        getCurrentWorkspaceIdentity() !== workspaceIdentity) return;
    const request = ++epoch.current;
    setBusy(true);
    setResult(null);
    setError("");
    const stillCurrent = () => epoch.current === request &&
      selectedFile.current === file && consentNow.current &&
      getCurrentWorkspaceIdentity() === workspaceIdentity;
    try {
      const next = await inspectFile(file);
      if (!stillCurrent()) return;
      // This final gateway rejects mismatched profile/status/track/source
      // locators, unsafe extra keys and forged activation or probe claims.
      // Preserve exact producer serialization for original-file P3b recheck.
      const validated = validateSharedSourceReviewResult(next);
      if (!stillCurrent()) return;
      setResult(validated);
    } catch (cause) {
      if (stillCurrent()) {
        setError(typeof cause?.code === "string" && /^IC010_(?:XML|STATIC|P3|P3C|P3D)_[A-Z0-9_]+$/.test(cause.code)
          ? cause.code : "IC010_XML_INSPECTION_BLOCKED");
      }
    } finally {
      if (stillCurrent()) setBusy(false);
    }
  };

  return e("div", { className: "network-import-overlay", "data-ic010-p2-overlay": "true" },
    e("section", {
      className: "network-import-panel", role: "dialog", "aria-modal": "true",
      "aria-label": "Shared document source inspection (read-only)",
      ref: dialog, tabIndex: -1, "data-ic010-p2-panel": "READ_ONLY",
    },
      e("div", { className: "network-import-heading" },
        e("div", null, e("h2", null, "Inspect structured documents — read-only"),
          e("p", null, "Offline local file inspection. Verified profile, original-source hash and counts only.")),
        e("button", { type: "button", onClick: close,
          "aria-label": "Close shared document inspection", "data-ic010-p2-close-top": "true" }, "Close")),
      e("p", { className: "helper-note" },
        "Supported subsets: GraphML (.graphml), draw.io (.drawio), Nmap XML, Nessus v2 (.nessus/.xml), static Ansible inventories (.yml/.yaml/.ini), and structural DOCX/ODT tables (.docx/.odt). ",
        "Only strictly validated source profiles pass. Office cell contents are never displayed here; per-cell review remains separate."),
      e("label", { className: "file-button" }, "Choose supported local document",
        e("input", { type: "file", accept: ".graphml,.drawio,.nessus,.xml,.yml,.yaml,.ini,.docx,.odt",
          "data-ic010-p2-file": "true", hidden: true,
          // Canceling the native picker is also a consent reset, including when
          // the browser emits only cancel and not change.
          onClick: () => reset(),
          onCancel: () => reset(),
          onChange: (event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            reset(file);
          },
        })),
      selection ? e("p", { "data-ic010-p2-selected": "true" },
        "Local file selected. No parsing performed yet.") : null,
      e("p", { "data-ic010-p3d-lifecycle": sharedReviewLifecycle({
          selected: Boolean(selection), consent, busy, result, error,
        }) },
        "Review lifecycle: " + sharedReviewLifecycle({
          selected: Boolean(selection), consent, busy, result, error,
        })),
      e("label", null,
        e("input", { type: "checkbox", checked: consent, disabled: !selection,
          "data-ic010-p2-consent": "true",
          onChange: (event) => changeConsent(event.currentTarget.checked),
        }), " I authorize local, offline, read-only inspection of this selected file."),
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", disabled: !selection || !consent || busy,
          "data-ic010-p2-inspect": "true", onClick: () => { void inspect(); },
        }, busy ? "Inspecting…" : "Inspect selected document (read-only)"),
        e("button", { type: "button", "data-ic010-p2-close": "true",
          onClick: close }, "Close without changes")),
      error ? e("p", { role: "alert", className: "helper-status blocked",
        "data-ic010-p2-error": "BLOCKED" }, error) : null,
      e(StructuredXmlInspectionDetails, { result }),
      result?.status === "REVIEW_REQUIRED" &&
        ["ansible.inventory.static.yaml.v1","ansible.inventory.static.ini.v1"].includes(result.profileId)
        ? e(SharedAnsibleOrdinalReview, {
            key: epoch.current + ":" + result.sourceSha256,
            result, model,
            onExport: async (decision) => {
              const source = selectedFile.current, activeEpoch = epoch.current;
              const isCurrent = () => epoch.current === activeEpoch &&
                selectedFile.current === source && consentNow.current &&
                getCurrentWorkspaceIdentity() === workspaceIdentity;
              if (!source || !isCurrent() || typeof onExportReviewed !== "function") {
                const error = new Error("IC010_P3B_STALE");
                error.code = "IC010_P3B_STALE";
                throw error;
              }
              return onExportReviewed(source,result,decision,isCurrent);
            },
          })
        : null,
      e("p", { "data-ic010-p2-truth-boundary": "true" },
        "This panel cannot import nodes, create links, run probes, verify identities or change the active scenario."),
    ));
}

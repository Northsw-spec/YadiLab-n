import React, { useEffect, useRef, useState } from "react";
import { AnsibleAssociationReview } from "./ansible-association-review.mjs";

const e = React.createElement;
const DISPLAY_HOSTS = 80;
const DISPLAY_GROUPS = 100;

/** Static inventory declarations only: no YAML variable secrets, no Engine. */
export function AnsibleInventoryDetails({ result }) {
  if (!result) return e("p", { "data-ansible-empty": "true" },
    "Choose a static Ansible inventory YAML file to inspect host and group declarations.");
  const { filename, preview } = result;
  return e("section", { className: "network-import-preview",
      "data-ansible-preview": "CONFIG_DOCUMENTED" },
    e("h3", null, "Ansible inventory preview — ", filename),
    e("p", { "data-ansible-summary": "true" },
      `Declared hosts: ${preview.hosts.length} · declared groups: ${preview.groupPaths.length}`),
    e("p", { "data-ansible-source-hash": "true" }, `SHA-256: ${preview.sourceSha256}`),
    e("p", { className: "helper-note", "data-ansible-truth-boundary": "true" },
      "CONFIG_DOCUMENTED only. Ansible inventory names and ansible_host addresses are declarations, NOT verified physical assets, current IP assignments, reachability, links or Engine PASS. All other host/group variable values are excluded."),
    e("h4", null, "Declared inventory groups (NOT network links)"),
    e("ul", { className: "validation-list", "data-ansible-groups": "true" },
      ...preview.groupPaths.slice(0, DISPLAY_GROUPS).map((group, i) =>
        e("li", { key: `${i}:${group}` }, group))),
    preview.groupPaths.length > DISPLAY_GROUPS
      ? e("p", null, `Only first ${DISPLAY_GROUPS} of ${preview.groupPaths.length} groups are displayed.`)
      : null,
    e("h4", null, "Declared inventory hosts"),
    e("ol", { className: "validation-list", "data-ansible-hosts": "true" },
      ...preview.hosts.slice(0, DISPLAY_HOSTS).map((host, i) =>
        e("li", { key: `${i}:${host.inventoryName}`, "data-ansible-host": String(i) },
          e("strong", null, host.inventoryName),
          e("p", null, "Reported connection address: ",
            host.reportedConnectionAddress ?? "UNKNOWN"),
          e("p", null, `Address status: ${host.addressTruth}`),
          e("p", null, `Inventory group membership: ${host.groupPaths.join(", ")}`)))),
    preview.hosts.length > DISPLAY_HOSTS
      ? e("p", null, `Only first ${DISPLAY_HOSTS} of ${preview.hosts.length} hosts are displayed.`)
      : null,
    preview.diagnostics.length
      ? e("ul", { className: "validation-list", "data-ansible-warnings": "true" },
          ...preview.diagnostics.map((d, i) =>
            e("li", { key: i }, `${d.code}: ${d.message}`)))
      : null,
    e("p", { "data-ansible-activation-status": "BLOCKED" },
      "Read-only inspection. No Builder import, resource creation, modeled cable, Ansible execution or Engine verification is available in this checkpoint."),
  );
}

/** Isolated dialog; no setWorkspace, import or Engine callback is accepted. */
export function AnsibleInventoryPanel({ inspectFile, onClose, model = null, onExportAssociation }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const req = useRef(0);
  const originalFile = useRef(null);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const focus = useRef(null);
  useEffect(() => {
    focus.current?.focus();
    return () => { req.current++; originalFile.current=null; };
  }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape" && !busy) { req.current++; originalFile.current=null; onClose(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  const choose = async (file) => {
    if (!file || busy) return;
    const id = ++req.current;
    originalFile.current=file;
    setSelectionEpoch(value=>value+1);
    setResult(null); setError(""); setBusy(true);
    try {
      const parsed = await inspectFile(file);
      if (req.current === id) setResult(parsed);
    } catch (cause) {
      if (req.current === id) {
        originalFile.current=null;
        setError(cause?.code && cause?.message ? `${cause.code}: ${cause.message}` :
          cause instanceof Error ? cause.message : "Ansible inventory inspection blocked.");
      }
    } finally {
      if (req.current === id) setBusy(false);
    }
  };
  return e("div", { className: "network-import-overlay", "data-ansible-overlay": "true" },
    e("section", { className: "network-import-panel", role: "dialog", "aria-modal": "true",
      "aria-label": "Ansible YAML inventory read-only inspection", ref: focus, tabIndex: -1,
      "data-ansible-panel": "CONFIG_DOCUMENTED" },
      e("div", { className: "network-import-heading" },
        e("div", null,
          e("h2", null, "Inspect Ansible inventory YAML — read only"),
          e("p", null, "Local, offline and source-preserving: no Ansible execution or network access.")),
        e("button", { type: "button", disabled: busy, "aria-label": "Close Ansible YAML inspection",
          onClick: () => { req.current++; originalFile.current=null; onClose(); } }, "Close")),
      e("label", { className: "file-button" }, busy ? "Reading inventory…" : "Choose .yml or .yaml file",
        e("input", { type: "file", accept: ".yml,.yaml", disabled: busy, hidden: true,
          "data-ansible-file": "true",
          onChange: (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void choose(file);
          } })),
      error ? e("p", { role: "alert", className: "helper-status blocked", "data-ansible-error": "BLOCKED" }, error) : null,
      e(AnsibleInventoryDetails, { result }),
      result ? e(AnsibleAssociationReview, {
        key: `${selectionEpoch}:${result.preview.sourceSha256}:${model?.scenarioId ?? "runtime"}:${model?.sourceRevision ?? -1}`,
        result, model, busy,
        onExport: async (preview,decision) => {
          const epoch=req.current,source=originalFile.current;
          if(!source||typeof onExportAssociation!=="function"){
            const error=new Error("ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED");
            error.code="ANSIBLE_YAML_ASSOC_SOURCE_BLOCKED";throw error;
          }
          return onExportAssociation(source,preview,decision,
            ()=>req.current===epoch&&originalFile.current===source);
        },
      }) : null,
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", disabled: busy, "data-ansible-close": "true",
          onClick: () => { req.current++; originalFile.current=null; onClose(); } }, "Close without changes"))));
}

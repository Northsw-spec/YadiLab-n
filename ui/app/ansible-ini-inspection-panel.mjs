import React, { useEffect, useRef, useState } from "react";
import { AnsibleIniAssociationReview } from "./ansible-ini-association-review.mjs";
const e = React.createElement;
const DISPLAY_HOSTS = 80;
const DISPLAY_GROUPS = 100;

/** Display only declared source data. No export/association or Engine truth. */
export function AnsibleIniInventoryDetails({ result }) {
  if (!result) return e("p", { "data-ansible-ini-empty": "true" },
    "Choose one local static Ansible INI inventory to inspect its declared hosts and groups.");
  const { filename, preview } = result;
  return e("section", { className: "network-import-preview", "data-ansible-ini-preview": "CONFIG_DOCUMENTED" },
    e("h3", null, "Ansible INI inventory preview — ", filename),
    e("p", { "data-ansible-ini-summary": "true" },
      `Declared hosts: ${preview.hosts.length} · declared groups: ${preview.groupNames.length}`),
    e("p", { "data-ansible-ini-source-hash": "true" }, `Original SHA-256: ${preview.sourceSha256}`),
    e("p", { className: "helper-note", "data-ansible-ini-truth-boundary": "true" },
      "CONFIG_DOCUMENTED only. Host aliases, ansible_host and Ansible group membership are NOT verified physical assets, assigned IPs, reachability, network links or Engine PASS. Variable values are not imported or displayed."),
    e("h4", null, "Declared groups and children (NOT physical links)"),
    e("ul", { className: "validation-list", "data-ansible-ini-groups": "true" },
      ...preview.groupNames.slice(0, DISPLAY_GROUPS).map((group, i) =>
        e("li", { key: `${i}:${group}` }, group,
          preview.groupChildren[group]?.length
            ? ` — child groups: ${preview.groupChildren[group].join(", ")}`
            : ""))),
    preview.groupNames.length > DISPLAY_GROUPS
      ? e("p", null, `Only first ${DISPLAY_GROUPS} of ${preview.groupNames.length} groups are displayed.`)
      : null,
    e("h4", null, "Declared hosts"),
    e("ol", { className: "validation-list", "data-ansible-ini-hosts": "true" },
      ...preview.hosts.slice(0, DISPLAY_HOSTS).map((host, i) =>
        e("li", { key: `${i}:${host.inventoryName}`, "data-ansible-ini-host": String(i) },
          e("strong", null, host.inventoryName),
          e("p", null, "Reported connection address: ", host.reportedConnectionAddress ?? "UNKNOWN"),
          e("p", null, `Address status: ${host.addressTruth}`),
          e("p", null, `Direct inventory groups: ${host.directGroups.join(", ") || "ungrouped"}`),
          e("p", null, `Original source lines: ${host.locators.map(l => l.lineNumber).join(", ")}`)))),
    preview.hosts.length > DISPLAY_HOSTS
      ? e("p", null, `Only first ${DISPLAY_HOSTS} of ${preview.hosts.length} hosts are displayed.`)
      : null,
    preview.diagnostics.length
      ? e("ul", { className: "validation-list", "data-ansible-ini-warnings": "true" },
          ...preview.diagnostics.map((d, i) => e("li", { key: i }, `${d.code}: ${d.message}`)))
      : null,
    e("p", { "data-ansible-ini-activation-status": "BLOCKED" },
      "Read-only inspection. No Builder resource creation, Ansible execution, modeled cable or Engine verification is available. Optional human-reviewed references are separate unverified JSON sidecars."));
}

/** Separate modal: receives ONLY a read-only Builder identity snapshot and sidecar export callback; no workspace mutation. */
export function AnsibleIniInventoryPanel({ inspectFile, onClose, model = null, onExportAssociation }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currentRequest = useRef(0);
  const originalFile = useRef(null);
  const [sourceEpoch,setSourceEpoch] = useState(0);
  const focus = useRef(null);
  useEffect(() => { focus.current?.focus(); return () => { currentRequest.current++;originalFile.current=null; }; }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape" && !busy) { currentRequest.current++;originalFile.current=null; onClose(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const choose = async (file) => {
    if (!file || busy) return;
    const request = ++currentRequest.current;
    originalFile.current=file;
    setSourceEpoch(epoch=>epoch+1);
    setResult(null); setError(""); setBusy(true);
    try {
      const next = await inspectFile(file);
      if (request === currentRequest.current) setResult(next);
    } catch (cause) {
      if (request === currentRequest.current) {
        originalFile.current=null;
        const expected = cause?.code && /^ANSIBLE_INI_[A-Z_]+$/.test(cause.code);
        setError(expected ? `${cause.code}: ${cause.message}` : "Ansible INI inventory inspection blocked.");
      }
    } finally {
      if (request === currentRequest.current) setBusy(false);
    }
  };
  return e("div", { className: "network-import-overlay", "data-ansible-ini-overlay": "true" },
    e("section", { className: "network-import-panel", role: "dialog", "aria-modal": "true",
        "aria-label": "Ansible INI inventory read-only inspection", ref: focus, tabIndex: -1,
        "data-ansible-ini-panel": "CONFIG_DOCUMENTED" },
      e("div", { className: "network-import-heading" },
        e("div", null,
          e("h2", null, "Inspect Ansible INI — read only"),
          e("p", null, "Local static declarations only. Unsupported Ansible syntax is blocked, never guessed.")),
        e("button", { type: "button", disabled: busy, "aria-label": "Close Ansible INI inspection",
          onClick: () => { currentRequest.current++;originalFile.current=null; onClose(); } }, "Close")),
      e("label", { className: "file-button" }, busy ? "Reading INI inventory…" : "Choose .ini file",
        e("input", { type: "file", accept: ".ini", hidden: true, disabled: busy,
          "data-ansible-ini-file": "true",
          onChange: (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void choose(file);
          } })),
      error ? e("p", { role: "alert", className: "helper-status blocked",
          "data-ansible-ini-error": "BLOCKED" }, error) : null,
      e(AnsibleIniInventoryDetails, { result }),
      result ? e(AnsibleIniAssociationReview, {
        key: `${sourceEpoch}:${result.preview.sourceSha256}:${model?.scenarioId ?? "runtime"}:${model?.sourceRevision ?? -1}`,
        result, model, busy,
        onExportAssociation: async (preview,decision) => {
          const epoch=currentRequest.current,source=originalFile.current;
          if(!source||typeof onExportAssociation!=="function"){
            const error=new Error("ANSIBLE_INI_P4_SOURCE_BLOCKED");
            error.code="ANSIBLE_INI_P4_SOURCE_BLOCKED";throw error;
          }
          return onExportAssociation(source,preview,decision,
            ()=>currentRequest.current===epoch&&originalFile.current===source);
        },
      }) : null,
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", disabled: busy, "data-ansible-ini-close": "true",
          onClick: () => { currentRequest.current++;originalFile.current=null; onClose(); } }, "Close without changes"))));
}

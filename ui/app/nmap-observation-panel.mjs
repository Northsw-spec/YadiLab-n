import React, { useEffect, useRef, useState } from "react";
import { NmapAssociationReview } from "./nmap-association-review.mjs";

const e = React.createElement;
const MAX_DISPLAY_HOSTS = 80;
const MAX_DISPLAY_PORTS_PER_HOST = 24;

/**
 * Display Nmap scan-time observations, NEVER a modeled network or Engine PASS.
 * All untrusted strings are React text nodes (not HTML), with bounded rendering.
 */
export function NmapObservationDetails({ result }) {
  const [page, setPage] = useState(0);
  if (!result) return e("p", { "data-nmap-empty": "true" },
    "Choose a Nmap XML (-oX) file to inspect scan-time observations.");
  const { filename, preview } = result;
  const pages = Math.max(1, Math.ceil(preview.hosts.length / MAX_DISPLAY_HOSTS));
  const currentPage = Math.min(Math.max(0, page), pages - 1);
  const firstOrdinal = currentPage * MAX_DISPLAY_HOSTS;
  const lastOrdinal = Math.min(preview.hosts.length, firstOrdinal + MAX_DISPLAY_HOSTS) - 1;
  const visibleHosts = preview.hosts.slice(firstOrdinal, firstOrdinal + MAX_DISPLAY_HOSTS);
  return e("section", { className: "network-import-preview", "data-nmap-observations": "EVIDENCE_ONLY" },
    e("h3", null, "Nmap XML observations — ", filename),
    e("p", { "data-nmap-summary": "true" },
      `Hosts observed: ${preview.hosts.length} · Port observations: ${preview.observationsCount}`),
    e("p", { "data-nmap-source-hash": "true" }, `SHA-256: ${preview.sourceSha256}`),
    preview.scanStart !== undefined
      ? e("p", { "data-nmap-scan-start": "true" },
          `Source scan start (Unix seconds): ${preview.scanStart}`)
      : e("p", { "data-nmap-scan-time-unknown": "true" }, "Scan start time not supplied."),
    e("p", { "className": "helper-note", "data-nmap-truth-boundary": "true" },
      "EVIDENCE_OBSERVED only. UP/DOWN and OPEN/CLOSED describe the scan at its recorded time, not current reachability or verified infrastructure. Service names are hints. No physical cables, routes, node types, Engine PASS, or scenario activation are inferred."),
    e("h4", null, "Observed hosts"),
    e("div", { "data-nmap-observation-pagination": "true" },
      e("p", { "data-nmap-observation-page": String(currentPage + 1),
               "data-nmap-observation-range": `${firstOrdinal}:${lastOrdinal}` },
        `Source hosts ${firstOrdinal + 1}–${lastOrdinal + 1} of ${preview.hosts.length} · Page ${currentPage + 1} of ${pages}.`),
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", "data-nmap-observation-previous": "true",
          disabled: currentPage === 0,
          onClick: () => setPage(p => Math.max(0, p - 1)) }, "Previous observations"),
        e("button", { type: "button", "data-nmap-observation-next": "true",
          disabled: currentPage === pages - 1,
          onClick: () => setPage(p => Math.min(pages - 1, p + 1)) }, "Next observations"))),
    e("ol", { className: "validation-list", "data-nmap-hosts": "true",
              start: firstOrdinal + 1 },
      ...visibleHosts.map((host, i) => {
        const hi = firstOrdinal + i;
        return e("li", { key: `${hi}-${host.ipv4}`, "data-nmap-host": String(hi) },
          e("strong", null, `${host.ipv4} — observed ${host.observedStatus.toUpperCase()}`),
          host.hostnames.length
            ? e("p", { "data-nmap-hostnames": String(hi) },
                `Reported hostname(s): ${host.hostnames.join(", ")}`)
            : null,
          host.ports.length
            ? e("ul", { "data-nmap-ports": String(hi) },
                ...host.ports.slice(0, MAX_DISPLAY_PORTS_PER_HOST).map((port, pi) =>
                  e("li", { key: `${port.protocol}-${port.port}-${pi}`, "data-nmap-port": `${hi}:${pi}` },
                    `${port.protocol.toUpperCase()}/${port.port} — observed ${port.observedState}`,
                    port.serviceName === undefined ? "" :
                      ` · service hint: ${port.serviceName}${port.serviceMethod ? ` (${port.serviceMethod}${port.serviceConfidence === undefined ? "" : `, confidence ${port.serviceConfidence}/10`})` : ""}`
                  )))
            : e("p", null, "No port observation reported for this host."),
          host.ports.length > MAX_DISPLAY_PORTS_PER_HOST
            ? e("p", null, `Only first ${MAX_DISPLAY_PORTS_PER_HOST} of ${host.ports.length} port observations shown.`)
            : null);
      })),
    e("p", { "data-nmap-activation-status": "BLOCKED" },
      "Observation inspection only. Optional separate evidence associations may be exported after explicit review; Builder, Engine, topology and scan results remain unchanged."),
  );
}

/**
 * Standalone observation dialog: no callback accepts an import, network
 * mutation, scenario activation, or probe execution. Cancelling/closing
 * invalidates in-flight file reads. Browser tests assert the real behavior.
 */
export function NmapObservationPanel({ inspectFile, onClose, model = null, onExportAssociation }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const originalFile = useRef(null);
  const focus = useRef(null);

  useEffect(() => {
    focus.current?.focus();
    return () => { request.current++; };
  }, []);
  useEffect(() => {
    const escape = (event) => { if (event.key === "Escape" && !busy) { request.current++; originalFile.current = null; onClose(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  const choose = async (file) => {
    if (!file || busy) return;
    const id = ++request.current;
    originalFile.current = file;
    setResult(null);
    setError("");
    setBusy(true);
    try {
      const parsed = await inspectFile(file);
      if (request.current === id) setResult(parsed);
    } catch (cause) {
      if (request.current === id) {
        originalFile.current = null;
        setError(cause?.code && cause?.message ? `${cause.code}: ${cause.message}`
          : cause instanceof Error ? cause.message : "Nmap XML parsing blocked.");
      }
    } finally {
      if (request.current === id) setBusy(false);
    }
  };
  return e("div", { className: "network-import-overlay", "data-nmap-overlay": "true" },
    e("section", { className: "network-import-panel", role: "dialog", "aria-modal": "true",
      "aria-label": "Nmap XML observed evidence", ref: focus, tabIndex: -1,
      "data-nmap-panel": "EVIDENCE_ONLY" },
      e("div", { className: "network-import-heading" },
        e("div", null,
          e("h2", null, "Inspect Nmap XML — observed evidence"),
          e("p", null, "Local, offline, read-only inspection. This does not run Nmap or alter YadiLab's scenario.")),
        e("button", { type: "button", disabled: busy, "aria-label": "Close Nmap XML observations",
          onClick: () => { request.current++; originalFile.current = null; onClose(); } }, "Close")),
      e("label", { className: "file-button" },
        busy ? "Reading Nmap XML…" : "Choose Nmap .xml file",
        e("input", { type: "file", accept: ".xml", disabled: busy, hidden: true,
          "data-nmap-file": "true",
          onChange: (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void choose(file);
          } })),
      error ? e("p", { role: "alert", className: "helper-status blocked",
        "data-nmap-error": "BLOCKED" }, error) : null,
      e(NmapObservationDetails, { key: request.current, result }),
      result ? e(NmapAssociationReview, { key: `${request.current}:${result.preview.sourceSha256}:${model?.scenarioId ?? "runtime"}:${model?.sourceRevision ?? -1}`,
        result, model, busy,
        onExport: async (preview, decision) => {
          const epoch = request.current, original = originalFile.current;
          if (!original || typeof onExportAssociation !== "function") {
            const failure = new Error("NMAP_P4_SOURCE_BLOCKED");
            failure.code = "NMAP_P4_SOURCE_BLOCKED"; throw failure;
          }
          return onExportAssociation(original, preview, decision,
            () => request.current === epoch && originalFile.current === original);
        } }) : null,
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", disabled: busy, "data-nmap-close": "true",
          onClick: () => { request.current++; originalFile.current = null; onClose(); } }, "Close without changes"))));
}

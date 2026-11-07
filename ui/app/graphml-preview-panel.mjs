import React, { useEffect, useRef, useState } from "react";

const e = React.createElement;
const MAX_VISIBLE_ROWS = 80;

/**
 * Pure display projection. JSX-like React elements escape all imported labels;
 * there is deliberately no HTML injection, scenario/Engine activation control
 * or claim that GraphML relations are confirmed physical links.
 */
export function GraphmlPreviewDetails({ result }) {
  if (!result) return e("p", { "data-graphml-empty": "true" }, "Choose a GraphML file for read-only inspection.");
  const { preview, filename } = result;
  const displayedNodes = preview.nodes.slice(0, MAX_VISIBLE_ROWS);
  const displayedEdges = preview.edges.slice(0, MAX_VISIBLE_ROWS);
  return e("section", { className: "network-import-preview", "data-graphml-preview": "REVIEW_REQUIRED" },
    e("h3", null, "GraphML preview — ", filename),
    e("p", { "data-graphml-summary": "true" }, `Graph: ${preview.graphId} · Nodes: ${preview.nodes.length} · Graph edges: ${preview.edges.length}`),
    e("p", { "data-graphml-source-hash": "true" }, `SHA-256: ${preview.sourceSha256}`),
    e("p", { className: "helper-note", "data-graphml-truth-boundary": "true" },
      "GRAPH_EDGE means a relationship drawn or declared in a graph, NOT a confirmed physical cable. No node type, OS, IP address, reachability, routing or Engine PASS is inferred. Active workspace remains unchanged."),
    e("h4", null, "Declared nodes (read-only)"),
    e("ul", { className: "validation-list", "data-graphml-nodes": "true" },
      ...displayedNodes.map((n, i) => e("li", { key: `${n.id}-${i}` }, n.label === undefined ? n.id : `${n.id} — ${n.label}`))),
    preview.nodes.length > MAX_VISIBLE_ROWS ? e("p", null, `Showing first ${MAX_VISIBLE_ROWS} of ${preview.nodes.length} nodes.`) : null,
    e("h4", null, "Graph edges (not verified cables)"),
    e("ul", { className: "validation-list", "data-graphml-edges": "true" },
      ...displayedEdges.map((edge, i) => e("li", { key: `${edge.id ?? "edge"}-${i}` },
        `${edge.id ?? `edge ${i + 1}`}: ${edge.sourceId} → ${edge.targetId} (${edge.directed ? "directed" : "undirected"}; GRAPH_EDGE)`))),
    preview.edges.length > MAX_VISIBLE_ROWS ? e("p", null, `Showing first ${MAX_VISIBLE_ROWS} of ${preview.edges.length} edges.`) : null,
    preview.diagnostics.length
      ? e("ul", { className: "validation-list", "data-graphml-warnings": "true" },
          ...preview.diagnostics.map((d, i) => e("li", { key: i }, `${d.code}: ${d.message}`)))
      : null,
    e("p", { className: "helper-note", "data-graphml-activation-status": "REVIEW_REQUIRED" },
      "Read-only source inspection. Creating a separate Builder draft requires explicit reviewed mapping below; no Engine network truth is inferred."),
  );
}

/** Isolated dialog. It never receives setWorkspace or an activation callback. */
export function GraphmlReadOnlyPanel({ onClose, inspectFile, onConfirm, manualRoleOptions = ["resource.generic"] }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const originalRef = useRef(null);
  const panel = useRef(null);

  useEffect(() => {
    panel.current?.focus();
    return () => { request.current++; };
  }, []);
  useEffect(() => {
    const escape = (event) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  const chooseFile = async (file) => {
    if (!file || busy) return;
    const id = ++request.current;
    originalRef.current = null;
    setResult(null);
    setError("");
    setBusy(true);
    try {
      const parsed = await inspectFile(file);
      if (request.current === id) { originalRef.current = file; setResult(parsed); }
    } catch (cause) {
      if (request.current === id) setError(cause?.code ? `${cause.code}: ${cause.message}` : cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === id) setBusy(false);
    }
  };

  return e("div", { className: "network-import-overlay", "data-graphml-overlay": "true" },
    e("section", { className: "network-import-panel", ref: panel, tabIndex: -1, role: "dialog",
      "aria-modal": "true", "aria-label": "GraphML read-only preview", "data-graphml-panel": "PREVIEW_ONLY" },
      e("div", { className: "network-import-heading" },
        e("div", null, e("h2", null, "Inspect GraphML — preview only"),
          e("p", null, "Offline structural inspection. No graph relation is activated as a network link.")),
        e("button", { type: "button", onClick: () => { request.current++; onClose(); }, disabled: busy, "aria-label": "Close GraphML preview" }, "Close")),
      e("label", { className: "file-button" }, busy ? "Reading GraphML…" : "Choose .graphml file",
        e("input", { type: "file", accept: ".graphml", disabled: busy, "data-graphml-file": "true",
          onChange: (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void chooseFile(file);
          }, hidden: true })),
      error ? e("p", { role: "alert", className: "helper-status blocked", "data-graphml-error": "BLOCKED" }, error) : null,
      e(GraphmlPreviewDetails, { result }),
      result ? e(GraphmlManualReviewControls, { key: result.preview.sourceSha256, result,
        manualRoleOptions, busy, setBusy, setError,
        onConfirm: async (sourcePreview, decisions) => {
          const original = originalRef.current;
          const selectedRequest = request.current;
          if (!original || typeof onConfirm !== "function") {
            const error = new Error("IC030_P1_STALE"); error.code = "IC030_P1_STALE"; throw error;
          }
          const isCurrent = () => request.current === selectedRequest && originalRef.current === original;
          return onConfirm(sourcePreview, decisions, original, isCurrent);
        } }) : null,
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", disabled: busy, "data-graphml-cancel": "true",
          onClick: () => { request.current++; onClose(); } }, "Close without changes")),
    ),
  );
}

/**
 * Explicit mapping, separate from the read-only preview.
 * Every node starts GENERIC; no edge is modeled until individually selected,
 * then acknowledged. Only the parent can request a validated Builder change.
 */
export function GraphmlManualReviewControls({ result, manualRoleOptions = ["resource.generic"], busy = false, setBusy = () => {}, setError = () => {}, onConfirm }) {
  const [roles, setRoles] = useState({});
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { preview } = result;
  const visibleNodes = preview.nodes.slice(0, MAX_VISIBLE_ROWS);
  const visibleEdges = preview.edges.slice(0, MAX_VISIBLE_ROWS);
  const validChoices = selectedEdges.every((ordinal) => !preview.edges[ordinal]?.directed);
  const send = async () => {
    if (busy || submitting || typeof onConfirm !== "function" || !validChoices || (selectedEdges.length && !ack)) return;
    setSubmitting(true); setBusy(true); setError("");
    try {
      const decisions = {
        sourceSha256: preview.sourceSha256, graphId: preview.graphId,
        roles: Object.entries(roles).filter(([, type]) => type !== "resource.generic")
          .map(([nodeOrdinal, type]) => ({ nodeOrdinal: Number(nodeOrdinal), type })),
        modeledEdgeOrdinals: [...selectedEdges].sort((a, b) => a - b),
        acknowledgeModeledConnections: selectedEdges.length > 0 && ack,
      };
      await onConfirm(preview, decisions);
    } catch (cause) {
      setError(cause?.code ? `${cause.code}: ${cause.message}` : cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); setSubmitting(false); }
  };
  return e("section", { className: "network-import-preview", "data-graphml-mapping": "REVIEW_REQUIRED" },
    e("h3", null, "Manual mapping to Builder"),
    e("p", { className: "helper-note" },
      "Every node defaults to generic. Choose a type ONLY when you know it. Graph edges are NOT physical cables; you must select each edge you choose to model as a network connection."),
    e("h4", null, "Node type decisions"),
    e("ul", { className: "validation-list", "data-graphml-role-list": "true" }, ...visibleNodes.map((n, index) =>
      e("li", { key: n.id },
        e("label", null, `${n.label ?? n.id} (${n.id}) · `,
          e("select", { value: roles[index] ?? "resource.generic", disabled: busy || submitting,
            "data-graphml-role": String(index), onChange: (ev) => setRoles((prev) => ({ ...prev, [index]: ev.target.value })) },
            ...manualRoleOptions.map((type) => e("option", { key: type, value: type }, type))))))),
    preview.nodes.length > MAX_VISIBLE_ROWS ? e("p", null, "Remaining nodes keep generic type; additional role mapping is not available in this preview.") : null,
    e("h4", null, "Optional graph edges to model as network connections"),
    e("ul", { className: "validation-list", "data-graphml-edge-list": "true" }, ...visibleEdges.map((edge, index) =>
      e("li", { key: `${edge.id ?? "graph-edge"}-${index}` },
        e("label", null,
          e("input", { type: "checkbox", checked: selectedEdges.includes(index),
            disabled: busy || submitting || edge.directed, "data-graphml-edge-decision": String(index),
            onChange: (ev) => {
              setSelectedEdges((prev) => ev.target.checked ? [...prev, index] : prev.filter((x) => x !== index));
              setAck(false);
            } }),
          ` ${edge.id ?? `edge ${index + 1}`}: ${edge.sourceId} — ${edge.targetId}${edge.directed ? " (directed: cannot model as undirected network link)" : ""}`)))),
    preview.edges.length > MAX_VISIBLE_ROWS ? e("p", null, "Remaining edges are not selectable in this version.") : null,
    e("label", { className: "helper-note" },
      e("input", { type: "checkbox", checked: ack, disabled: busy || submitting || selectedEdges.length === 0,
        "data-graphml-edge-ack": "true", onChange: (ev) => setAck(ev.target.checked) }),
      " I explicitly choose to MODEL these selected graph edges as network connections. This is NOT independent verification of physical cables, protocols or reachability."),
    e("p", null, `Selected connections: ${selectedEdges.length} / ${preview.edges.length}. Unselected graph edges will NOT become network connections.`),
    e("button", { type: "button", "data-graphml-map-confirm": "true",
      disabled: busy || submitting || typeof onConfirm !== "function" || !validChoices || (selectedEdges.length > 0 && !ack),
      onClick: () => { void send(); } }, busy || submitting ? "Validating draft…" : "Validate and create reviewed Builder draft"),
  );
}

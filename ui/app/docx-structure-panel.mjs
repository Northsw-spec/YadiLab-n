import React, { useEffect, useRef, useState } from "react";
import { DocxCellDisclosureReview } from "./docx-cell-disclosure-review.mjs";
import { DocxMultiReferenceQueue } from "./docx-multi-reference-queue.mjs";
const e = React.createElement;
const DISPLAY_TABLES = 20;
const DISPLAY_ROWS = 30;
const DISPLAY_CELLS = 16;

export function DocxTableStructureDetails({ result }) {
  if (!result) return e("p", { "data-docx-empty": "true" },
    "Choose a local .docx file. This inspection deliberately displays no document cell text.");
  const { filename, preview } = result;
  const tableItems = [];
  for (const table of preview.tables.slice(0, DISPLAY_TABLES)) {
    const rowItems = [];
    for (const row of table.rows.slice(0, DISPLAY_ROWS)) {
      const cellItems = row.cells.slice(0, DISPLAY_CELLS).map((cell) =>
        e("li", {
            key: cell.cellOrdinal,
            "data-docx-cell": `${table.tableOrdinal}:${row.rowOrdinal}:${cell.cellOrdinal}`,
          },
          `Cell ${cell.cellOrdinal + 1}: ${cell.textCodeUnits} text code units · source table ${cell.locator.tableOrdinal + 1}, row ${cell.locator.rowOrdinal + 1}, cell ${cell.locator.cellOrdinal + 1}`));
      rowItems.push(e("li", { key: row.rowOrdinal,
          "data-docx-row": `${table.tableOrdinal}:${row.rowOrdinal}` },
        `Row ${row.rowOrdinal + 1}: ${row.cells.length} cells`,
        e("ul", { className: "validation-list" }, ...cellItems),
        row.cells.length > DISPLAY_CELLS ? e("p", null, "Further cells not displayed.") : null));
    }
    if (table.rows.length > DISPLAY_ROWS) {
      rowItems.push(e("li", { key: "limit", "data-docx-row-limit": "true" },
        `Showing first ${DISPLAY_ROWS} of ${table.rows.length} rows.`));
    }
    tableItems.push(e("li", { key: table.tableOrdinal,
      "data-docx-table": String(table.tableOrdinal) },
      e("strong", null, `Table ${table.tableOrdinal + 1}: ${table.rows.length} rows`),
      e("ol", { className: "validation-list" }, ...rowItems)));
  }
  return e("section", { className: "network-import-preview", "data-docx-preview": "CONFIG_DOCUMENTED" },
    e("h3", null, "DOCX table structure — ", filename),
    e("p", { "data-docx-summary": "true" },
      `Declared tables: ${preview.tables.length} · structural cells: ${preview.totalCells}`),
    e("p", { "data-docx-source-hash": "true" }, `Original SHA-256: ${preview.sourceSha256}`),
    e("p", { className: "helper-note", "data-docx-truth-boundary": "true" },
      "CONFIG_DOCUMENTED, REVIEW_REQUIRED. These are document table shapes only. No cell values, source secrets, identified machines, verified physical links, Builder changes or Engine PASS."),
    e("ol", { className: "validation-list", "data-docx-tables": "true" }, ...tableItems),
    e("p", { "data-docx-activation-status": "BLOCKED" },
      "Read-only structure inspection. No DOCX-to-topology mapping or simulation activation. Close without changes."));
}

export function DocxTableStructurePanel({ inspectFile, reviewFile, model = null, onExportAssociation, onBuildAssociation, onExportMulti, onClose }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [multiItems, setMultiItems] = useState([]);
  const [multiError, setMultiError] = useState("");
  const currentRequest = useRef(0);
  const focus = useRef(null);
  const localFile = useRef(null);
  useEffect(() => { focus.current?.focus(); return () => { currentRequest.current++; }; }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape" && !busy) { currentRequest.current++; onClose(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const choose = async (file) => {
    if (!file) return;
    const request = ++currentRequest.current;
    localFile.current = file;
    setMultiItems([]);setMultiError("");
    setResult(null); setError(""); setBusy(true);
    try {
      const next = await inspectFile(file);
      if (request === currentRequest.current) setResult(next);
    } catch (cause) {
      if (request === currentRequest.current) {
        const code = typeof cause?.code === "string" && /^(DOCX_|IMPORT_ARCHIVE_|IMPORT_WORKBOOK_ARCHIVE_|IMPORT_XML_)[A-Z_]+$/.test(cause.code)
          ? cause.code : "DOCX_INSPECTION_BLOCKED";
        localFile.current = null;
        setError(code);
      }
    } finally {
      if (request === currentRequest.current) setBusy(false);
    }
  };
  const validateCellNow = async (disclosed, decision) => {
    const request = currentRequest.current, file = localFile.current;
    if (!file || typeof onBuildAssociation !== "function" || typeof reviewFile !== "function") {
      throw Object.assign(new Error("DOCX_MULTI_UNAVAILABLE"),{code:"DOCX_MULTI_UNAVAILABLE"});
    }
    const current = await reviewFile(file, disclosed.sourceSha256, disclosed.locator, true);
    if (request !== currentRequest.current || file !== localFile.current ||
        current.sourceSha256 !== disclosed.sourceSha256 ||
        current.text !== disclosed.text ||
        JSON.stringify(current.locator) !== JSON.stringify(disclosed.locator)) {
      throw Object.assign(new Error("DOCX_MULTI_STALE"),{code:"DOCX_MULTI_STALE"});
    }
    return onBuildAssociation(current, decision);
  };
  const stageReference = async (disclosed, decision) => {
    if (!result || result.preview.sourceSha256 !== disclosed.sourceSha256 || !model) {
      throw Object.assign(new Error("DOCX_MULTI_STALE"),{code:"DOCX_MULTI_STALE"});
    }
    if (multiItems.length >= 10) throw Object.assign(new Error("DOCX_MULTI_COUNT_INVALID"),{code:"DOCX_MULTI_COUNT_INVALID"});
    const item = await validateCellNow(disclosed,decision);
    const loc = item?.source?.cellLocator;
    if (!loc || item.source.sha256 !== result.preview.sourceSha256) {
      throw Object.assign(new Error("DOCX_MULTI_REFERENCE_INVALID"),{code:"DOCX_MULTI_REFERENCE_INVALID"});
    }
    const key = [loc.tableOrdinal,loc.rowOrdinal,loc.cellOrdinal].join(":");
    if (multiItems.some(other => {
      const a=other.source.cellLocator;
      return [a.tableOrdinal,a.rowOrdinal,a.cellOrdinal].join(":")===key ||
        other.association.targetResourceId===item.association.targetResourceId;
    })) throw Object.assign(new Error("DOCX_MULTI_DUPLICATE_REFERENCE"),{code:"DOCX_MULTI_DUPLICATE_REFERENCE"});
    // Store only P4's no-value JSON-compatible reference. Never store disclosed.text.
    setMultiItems(prev => [...prev,item]);
    setMultiError("");
  };
  const exportMulti = async () => {
    if (!result || !localFile.current || multiItems.length < 2 || !model ||
        typeof onBuildAssociation !== "function" || typeof onExportMulti !== "function") {
      throw Object.assign(new Error("DOCX_MULTI_UNAVAILABLE"),{code:"DOCX_MULTI_UNAVAILABLE"});
    }
    const request=currentRequest.current,file=localFile.current;
    const checked=[];
    for (const item of multiItems) {
      // Re-check *every* selected cell against current source bytes and P3 secret rules.
      const loc=item.source.cellLocator;
      const now=await reviewFile(file,result.preview.sourceSha256,loc,true);
      if(request!==currentRequest.current || file!==localFile.current ||
         now.sourceSha256!==item.source.sha256 ||
         JSON.stringify(now.locator)!==JSON.stringify(loc)) {
        throw Object.assign(new Error("DOCX_MULTI_STALE"),{code:"DOCX_MULTI_STALE"});
      }
      const verified=await onBuildAssociation(now,{
        sourceSha256:item.source.sha256,
        scenarioId:item.targetModel.scenarioId,
        sourceRevision:item.targetModel.sourceRevision,
        targetResourceId:item.association.targetResourceId,
        acknowledgeNotVerified:true,
      });
      if(JSON.stringify(verified)!==JSON.stringify(item)){
        throw Object.assign(new Error("DOCX_MULTI_STALE"),{code:"DOCX_MULTI_STALE"});
      }
      checked.push(verified);
    }
    if(request!==currentRequest.current || file!==localFile.current){
      throw Object.assign(new Error("DOCX_MULTI_STALE"),{code:"DOCX_MULTI_STALE"});
    }
    return onExportMulti(checked,{
      sourceSha256:result.preview.sourceSha256,
      scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
      acknowledgeNotVerified:true,
    });
  };
  return e("div", { className: "network-import-overlay", "data-docx-overlay": "true" },
    e("section", { className: "network-import-panel", role: "dialog", "aria-modal": "true",
        "aria-label": "Word DOCX table structure inspection", ref: focus, tabIndex: -1,
        "data-docx-panel": "CONFIG_DOCUMENTED" },
      e("div", { className: "network-import-heading" },
        e("div", null,
          e("h2", null, "Inspect Word DOCX — structure only"),
          e("p", null, "Local offline analysis. No document text is shown or imported.")),
        e("button", { type: "button", disabled: busy, "aria-label": "Close Word DOCX inspection",
          onClick: () => { currentRequest.current++; localFile.current = null; onClose(); } }, "Close")),
      e("label", { className: "file-button" }, busy ? "Reading DOCX structure…" : "Choose .docx file",
        e("input", { type: "file", accept: ".docx", hidden: true, disabled: busy,
          "data-docx-file": "true", onChange: (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void choose(file);
          } })),
      error ? e("p", { role: "alert", className: "helper-status blocked",
        "data-docx-error": "BLOCKED" }, error) : null,
      e(DocxTableStructureDetails, { result }),
      result && typeof reviewFile === "function" ? e(DocxCellDisclosureReview, {
        key: result.preview.sourceSha256 + ":" + result.filename,
        preview: result.preview,
        model,
        onStageAssociation: stageReference,
        onExportAssociation: async (disclosed, decision) => {
          const request = currentRequest.current;
          const selectedFile = localFile.current;
          if (!selectedFile || typeof onExportAssociation !== "function") {
            throw new Error("DOCX_ASSOC_EXPORT_UNAVAILABLE");
          }
          // Re-read and re-run full P3 security checks immediately before export.
          const current = await reviewFile(selectedFile, result.preview.sourceSha256, disclosed.locator, true);
          if (request !== currentRequest.current || selectedFile !== localFile.current ||
              current.sourceSha256 !== disclosed.sourceSha256 ||
              current.text !== disclosed.text ||
              JSON.stringify(current.locator) !== JSON.stringify(disclosed.locator)) {
            throw new Error("DOCX_ASSOC_STALE_REVIEW");
          }
          return onExportAssociation(current, decision);
        },
        onRevealCell: async (locator, acknowledged) => {
          const request = currentRequest.current;
          const selectedFile = localFile.current;
          if (!selectedFile) throw new Error("DOCX_CELL_FILE_UNAVAILABLE");
          const answer = await reviewFile(selectedFile, result.preview.sourceSha256, locator, acknowledged);
          if (request !== currentRequest.current) throw new Error("DOCX_CELL_STALE_REQUEST");
          return answer;
        },
      }) : null,
      result && model && typeof onExportMulti==="function" ? e(DocxMultiReferenceQueue,{
        items:multiItems,model,busy,
        onRemove:index=>setMultiItems(prev=>prev.filter((_,i)=>i!==index)),
        onExport:exportMulti,
      }) : null,
      multiError ? e("p",{role:"alert","data-docx-multi-parent-error":"BLOCKED"},multiError):null,
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", disabled: busy, "data-docx-close": "true",
          onClick: () => { currentRequest.current++; localFile.current = null; onClose(); } }, "Close without changes"))));
}

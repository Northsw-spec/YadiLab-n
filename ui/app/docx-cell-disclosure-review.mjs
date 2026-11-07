import React, { useEffect, useRef, useState } from "react";
import { DocxReviewedCellAssociation } from "./docx-reviewed-cell-association.mjs";
const e = React.createElement;

/** Only one explicitly consented cell value is ever rendered. No persistent/Engine APIs. */
export function DocxCellDisclosureReview({ preview, onRevealCell, model = null, onExportAssociation, onStageAssociation }) {
  const [selected, setSelected] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [disclosed, setDisclosed] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);

  const choices = [];
  const locators = new Map();
  for (const table of preview.tables) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        const key = [table.tableOrdinal, row.rowOrdinal, cell.cellOrdinal].join(":");
        locators.set(key, cell.locator);
        choices.push(e("option", { key, value: key },
          "Table " + (table.tableOrdinal + 1) + " / Row " + (row.rowOrdinal + 1) +
          " / Cell " + (cell.cellOrdinal + 1) + " (" + cell.textCodeUnits + " code units)"));
      }
    }
  }

  const clear = () => {
    request.current++;
    setDisclosed(null);
    setError("");
    setAcknowledged(false);
  };
  const reveal = async () => {
    if (!acknowledged || !selected || busy || !locators.has(selected) || typeof onRevealCell !== "function") return;
    const now = ++request.current;
    setDisclosed(null); setError(""); setBusy(true);
    try {
      const result = await onRevealCell(locators.get(selected), true);
      if (now === request.current) {
        const match = result?.locator &&
          [result.locator.tableOrdinal, result.locator.rowOrdinal, result.locator.cellOrdinal].join(":") === selected;
        if (!match || result.status !== "REVEALED_UNVERIFIED" || result.sourceSha256 !== preview.sourceSha256) {
          setError("DOCX_CELL_REVIEW_INVALID");
        } else {
          setDisclosed(result);
        }
      }
    } catch (cause) {
      if (now === request.current) {
        const code = typeof cause?.code === "string" && /^DOCX_[A-Z_]+$/.test(cause.code)
          ? cause.code : "DOCX_CELL_REVIEW_BLOCKED";
        setError(code);
      }
    } finally {
      if (now === request.current) setBusy(false);
    }
  };

  return e("section", { className: "network-import-preview",
      "data-docx-disclosure": "OPERATOR_REVIEW_ONLY" },
    e("h4", null, "Optional one-cell local disclosure"),
    e("p", { className: "helper-note", "data-docx-disclosure-warning": "true" },
      "Only reveal cells you are authorized to view. Sensitive values may not always be detected. One cell at a time; never added to Builder or exported."),
    e("label", null, "Choose one cell (no contents shown): ",
      e("select", { "data-docx-select-cell": "true", value: selected, disabled: busy,
        onChange: (event) => { clear(); setSelected(event.currentTarget.value); } },
        e("option", { value: "" }, "Select a cell"), ...choices)),
    e("label", null,
      e("input", { type: "checkbox", "data-docx-consent": "true",
        checked: acknowledged, disabled: busy || !selected,
        onChange: (event) => { request.current++; setDisclosed(null); setError("");
          setAcknowledged(event.currentTarget.checked); } }),
      " I understand that the selected cell may contain confidential information and choose to reveal it locally."),
    e("button", { type: "button", "data-docx-reveal": "true",
      disabled: busy || !selected || !acknowledged,
      onClick: () => { void reveal(); } }, busy ? "Reviewing one cell..." : "Reveal selected cell locally"),
    error ? e("p", { role: "alert", "data-docx-disclosure-error": "BLOCKED" }, error) : null,
    disclosed ? e("p", { "data-docx-revealed": "UNVERIFIED" },
      "Selected cell (DOCUMENTED, NOT VERIFIED): ",
      e("code", { "data-docx-revealed-value": "true" }, disclosed.text),
      e("button", { type: "button", "data-docx-hide": "true", onClick: clear }, "Hide value")) : null,
    disclosed ? e(DocxReviewedCellAssociation, {
      key: [disclosed.sourceSha256, disclosed.locator.tableOrdinal, disclosed.locator.rowOrdinal, disclosed.locator.cellOrdinal].join(":"),
      disclosed, model, onExportAssociation, onStageAssociation,
    }) : null
  );
}

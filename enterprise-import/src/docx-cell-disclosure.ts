import { previewDocxTableStructure, type DocxTableCellLocator } from "./docx-tables-structural-preview.js";
import { openSafeWorkbookArchive, productionWorkbookArchiveBackend, type WorkbookArchiveLimits } from "./workbook-archive.js";
import { childElements, parseSafeXml, type XmlNode } from "./xml-lite.js";
import { EnterpriseImportError } from "./types.js";

// Keep strictly aligned with frozen DOCX-P1 caps, never with the broader XLSX defaults.
const DOCX_LIMITS: WorkbookArchiveLimits = {
  maxFiles: 128,
  maxCompressedBytes: 16 * 1024 * 1024,
  maxDecompressedBytes: 32 * 1024 * 1024,
  maxSingleFileBytes: 4 * 1024 * 1024,
  maxCompressionRatio: 100,
};

function block(code: string): never {
  // Stable code only. Do not add extracted document bytes or filenames to errors.
  throw new EnterpriseImportError(code, code);
}
function literalCell(cell: XmlNode): string {
  // P1 has already verified the full document and this narrow element grammar.
  return childElements(cell, "p").flatMap((p) =>
    childElements(p, "r").flatMap((r) =>
      childElements(r, "t").map((t) => t.text))).join("");
}

const CREDENTIAL_MARKERS = /(?:password|passwd|passphrase|secret|token|credential|bearer|private[ ._-]*key|api[ ._-]*key|access[ ._-]*key|ssh[ ._-]*key|client[ ._-]*secret|authorization|auth[ ._-]*key|connection[ ._-]*string|certificate[ ._-]*key)/i;

function isSuspicious(value: string): boolean {
  if (value.length === 0 || value.length > 128) return true;
  // Conservative narrow printable literal subset. NO URLs/emails/markup/scripts.
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._:-]*$/.test(value)) return true;
  if (CREDENTIAL_MARKERS.test(value)) return true;
  // Long unbroken tokens and hex/Base64-like strings may be credentials.
  if (/[A-Za-z0-9_-]{24,}/.test(value)) return true;
  if (/(?:[A-Fa-f0-9]{2}:){8,}[A-Fa-f0-9]{2}/.test(value)) return true;
  return false;
}

export interface DocxDisclosedCell {
  readonly status: "REVEALED_UNVERIFIED";
  readonly semanticTrack: "CONFIG_DOCUMENTED";
  readonly sourceSha256: string;
  readonly locator: DocxTableCellLocator;
  readonly text: string;
  readonly canActivate: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}

/**
 * Deliberate one-cell reveal, not a bulk value API, import adapter or parser bypass.
 * Must be called only after explicit per-file operator consent in a local UI.
 * The source is fully revalidated with P1 before any cell is extracted.
 * This filter is a safeguard, NOT a guarantee of data non-sensitivity.
 */
export async function discloseReviewedDocxCell(
  bytes: Uint8Array,
  expectedSourceSha256: string,
  locator: DocxTableCellLocator,
  operatorAcknowledged: boolean,
): Promise<DocxDisclosedCell> {
  if (operatorAcknowledged !== true) block("DOCX_CELL_CONSENT_REQUIRED");
  if (!locator || typeof locator !== "object" || locator.kind !== "docx-table-cell" ||
      locator.part !== "word/document.xml" ||
      !Number.isSafeInteger(locator.tableOrdinal) || locator.tableOrdinal < 0 ||
      !Number.isSafeInteger(locator.rowOrdinal) || locator.rowOrdinal < 0 ||
      !Number.isSafeInteger(locator.cellOrdinal) || locator.cellOrdinal < 0 ||
      !/^[0-9a-f]{64}$/.test(expectedSourceSha256) ||
      locator.sourceSha256 !== expectedSourceSha256 ||
      Object.keys(locator).sort().join(",") !==
        ["kind", "sourceSha256", "part", "tableOrdinal", "rowOrdinal", "cellOrdinal"].sort().join(",")) {
    block("DOCX_CELL_LOCATOR_INVALID");
  }
  const preview = await previewDocxTableStructure(bytes);
  if (preview.sourceSha256 !== expectedSourceSha256) block("DOCX_CELL_STALE_SOURCE");
  const selected = preview.tables[locator.tableOrdinal]?.rows[locator.rowOrdinal]?.cells[locator.cellOrdinal];
  if (!selected || selected.locator.tableOrdinal !== locator.tableOrdinal ||
      selected.locator.rowOrdinal !== locator.rowOrdinal ||
      selected.locator.cellOrdinal !== locator.cellOrdinal) block("DOCX_CELL_LOCATOR_INVALID");
  const archive = await openSafeWorkbookArchive(bytes, productionWorkbookArchiveBackend(), DOCX_LIMITS);
  try {
    const doc = parseSafeXml(await archive.read("word/document.xml"), "DOCX document");
    const body = childElements(doc, "body")[0];
    const table = body && childElements(body, "tbl")[locator.tableOrdinal];
    const rows = table && childElements(table, "tr");
    const row = rows?.[locator.rowOrdinal];
    const cell = row && childElements(row, "tc")[locator.cellOrdinal];
    if (!cell || !table || !row || !rows) block("DOCX_CELL_LOCATOR_INVALID");

    // A literal-looking password must still be blocked by the header/row label.
    const columnHeader = childElements(rows[0]!, "tc")[locator.cellOrdinal];
    const rowLabel = childElements(row, "tc")[0];
    const heading = columnHeader ? literalCell(columnHeader) : "";
    const label = rowLabel ? literalCell(rowLabel) : "";
    if (CREDENTIAL_MARKERS.test(heading) || CREDENTIAL_MARKERS.test(label)) {
      block("DOCX_CELL_SENSITIVE_BLOCKED");
    }

    const value = literalCell(cell);
    if (value.length !== selected.textCodeUnits) block("DOCX_CELL_STRUCTURE_CHANGED");
    if (isSuspicious(value)) block("DOCX_CELL_SENSITIVE_BLOCKED");
    return Object.freeze({
      status: "REVEALED_UNVERIFIED",
      semanticTrack: "CONFIG_DOCUMENTED",
      sourceSha256: preview.sourceSha256,
      locator: Object.freeze({...selected.locator}),
      text: value,
      canActivate: false,
      engineVerified: false,
      physicalTopologyVerified: false,
    });
  } finally {
    await archive.close();
  }
}

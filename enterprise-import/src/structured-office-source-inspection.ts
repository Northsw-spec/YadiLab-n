import { previewDocxTableStructure, type DocxStructuralPreview } from "./docx-tables-structural-preview.js";
import { previewOdtTableStructure, type OdtStructuralPreview } from "./odt-tables-structural-preview.js";
import { EnterpriseImportError } from "./types.js";

export type OfficeStructureProfileId =
  | "office.docx-tables.structural.v1"
  | "office.odt-tables.structural.v1";
export type OfficeStructureBlockedCode =
  | "IC010_P3C_FILENAME_INVALID"
  | "IC010_P3C_EXTENSION_UNSUPPORTED"
  | "IC010_P3C_SOURCE_SIZE_INVALID"
  | "IC010_P3C_CONTENT_UNRECOGNIZED"
  | "IC010_P3C_LOCATOR_INVALID";

export interface OfficeStructureBlocked {
  readonly status: "BLOCKED";
  readonly code: OfficeStructureBlockedCode;
  readonly canActivate: false;
  readonly modelMutated: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}
export interface OfficeStructureInspected {
  readonly status: "REVIEW_REQUIRED";
  readonly profileId: OfficeStructureProfileId;
  readonly semanticTrack: "CONFIG_DOCUMENTED";
  readonly sourceSha256: string;
  readonly documentLocator: Readonly<{
    kind: "source-document";
    profileId: OfficeStructureProfileId;
    sourceSha256: string;
  }>;
  readonly summary: Readonly<{
    kind: "DOCX_TABLE_STRUCTURE" | "ODT_TABLE_STRUCTURE";
    declaredTables: number;
    declaredRows: number;
    structuralCells: number;
    sourceBoundCellLocators: number;
  }>;
  readonly canActivate: false;
  readonly modelMutated: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}
export type OfficeStructureInspection = OfficeStructureBlocked | OfficeStructureInspected;

const MAX_BYTES = 16 * 1024 * 1024;
const BARRIERS = Object.freeze({
  canActivate: false as const,
  modelMutated: false as const,
  engineVerified: false as const,
  physicalTopologyVerified: false as const,
});
function blocked(code: OfficeStructureBlockedCode): OfficeStructureBlocked {
  return Object.freeze({ status: "BLOCKED" as const, code, ...BARRIERS });
}
function safeName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 240 &&
    name === name.trim() && name !== "." && name !== ".." &&
    !/[\\/\u0000-\u001f\u007f]/.test(name);
}
function docxAggregate(parsed: DocxStructuralPreview) {
  if (parsed.status !== "REVIEW_REQUIRED" || parsed.canActivate !== false ||
      parsed.profileId !== "office.docx-tables.structural.v1" ||
      parsed.semanticTrack !== "CONFIG_DOCUMENTED" ||
      parsed.textIncluded !== false ||
      parsed.engineVerified !== false ||
      parsed.physicalTopologyVerified !== false) return null;
  let rows = 0, cells = 0, locators = 0;
  for (let t=0;t<parsed.tables.length;t++) {
    const table = parsed.tables[t];
    if (!table || table.tableOrdinal !== t) return null;
    rows += table.rows.length;
    for (let ri=0;ri<table.rows.length;ri++) {
      const row = table.rows[ri];
      if (!row || row.rowOrdinal !== ri) return null;
      for (let ci=0;ci<row.cells.length;ci++) {
        const cell = row.cells[ci], loc = cell?.locator;
        if (!cell || !loc || cell.cellOrdinal !== ci ||
            loc.kind !== "docx-table-cell" ||
            loc.sourceSha256 !== parsed.sourceSha256 ||
            loc.part !== "word/document.xml" ||
            loc.tableOrdinal !== t || loc.rowOrdinal !== ri ||
            loc.cellOrdinal !== ci) return null;
        cells++;locators++;
      }
    }
  }
  if (cells !== parsed.totalCells) return null;
  return Object.freeze({
    kind: "DOCX_TABLE_STRUCTURE" as const,
    declaredTables: parsed.tables.length,
    declaredRows: rows,
    structuralCells: cells,
    sourceBoundCellLocators: locators,
  });
}
function odtAggregate(parsed: OdtStructuralPreview) {
  if (parsed.status !== "REVIEW_REQUIRED" || parsed.canActivate !== false ||
      parsed.profileId !== "office.odt-tables.structural.v1" ||
      parsed.semanticTrack !== "CONFIG_DOCUMENTED" ||
      parsed.textIncluded !== false ||
      parsed.engineVerified !== false ||
      parsed.physicalTopologyVerified !== false) return null;
  let rows = 0, cells = 0, locators = 0;
  for (let t=0;t<parsed.tables.length;t++) {
    const table = parsed.tables[t];
    if (!table || table.tableOrdinal !== t) return null;
    rows += table.rows.length;
    for (let ri=0;ri<table.rows.length;ri++) {
      const row = table.rows[ri];
      if (!row || row.rowOrdinal !== ri) return null;
      for (let ci=0;ci<row.cells.length;ci++) {
        const cell = row.cells[ci], loc = cell?.locator;
        if (!cell || !loc || cell.cellOrdinal !== ci ||
            loc.kind !== "odt-table-cell" ||
            loc.sourceSha256 !== parsed.sourceSha256 ||
            loc.part !== "content.xml" ||
            loc.tableOrdinal !== t || loc.rowOrdinal !== ri ||
            loc.cellOrdinal !== ci) return null;
        cells++;locators++;
      }
    }
  }
  if (cells !== parsed.totalCells) return null;
  return Object.freeze({
    kind: "ODT_TABLE_STRUCTURE" as const,
    declaredTables: parsed.tables.length,
    declaredRows: rows,
    structuralCells: cells,
    sourceBoundCellLocators: locators,
  });
}

/**
 * Shared metadata only: fully validated ZIP/OOXML/ODF producers, no generic
 * archive interpretation, source-text exposure, or active importer registration.
 * Existing specialized DOCX/ODT per-cell consent/review paths stay separate.
 */
export async function inspectOfficeStructureSourceReadOnly(
  filename: string, originalBytes: Uint8Array,
): Promise<OfficeStructureInspection> {
  if (!safeName(filename)) return blocked("IC010_P3C_FILENAME_INVALID");
  const docx = filename.toLowerCase().endsWith(".docx");
  const odt = filename.toLowerCase().endsWith(".odt");
  if (!docx && !odt) return blocked("IC010_P3C_EXTENSION_UNSUPPORTED");
  if (!(originalBytes instanceof Uint8Array) ||
      originalBytes.byteLength < (docx ? 4 : 42) ||
      originalBytes.byteLength > MAX_BYTES)
    return blocked("IC010_P3C_SOURCE_SIZE_INVALID");
  // Source must be copied before first asynchronous operation.
  const snapshot = Uint8Array.from(originalBytes);
  try {
    const parsed = docx
      ? await previewDocxTableStructure(snapshot)
      : await previewOdtTableStructure(snapshot);
    const summary = docx
      ? docxAggregate(parsed as DocxStructuralPreview)
      : odtAggregate(parsed as OdtStructuralPreview);
    if (!summary) return blocked("IC010_P3C_LOCATOR_INVALID");
    return Object.freeze({
      status: "REVIEW_REQUIRED" as const,
      profileId: parsed.profileId,
      semanticTrack: "CONFIG_DOCUMENTED" as const,
      sourceSha256: parsed.sourceSha256,
      documentLocator: Object.freeze({
        kind: "source-document" as const,
        profileId: parsed.profileId,
        sourceSha256: parsed.sourceSha256,
      }),
      summary,
      ...BARRIERS,
    });
  } catch (error) {
    // Errors from untrusted archive input are never reflected as raw text.
    if (!(error instanceof EnterpriseImportError)) throw error;
    return blocked("IC010_P3C_CONTENT_UNRECOGNIZED");
  }
}

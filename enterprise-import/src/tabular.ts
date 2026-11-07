import type { ImportCell, ImportDiagnostic, ImportRecord, ImportTable } from "./types.js";
import { EnterpriseImportError } from "./types.js";

export interface PhysicalRow { readonly row: number; readonly cells: ReadonlyMap<string, ImportCell>; }

function headerKey(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }
function present(value: unknown): boolean { return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === ""); }

export function columnLetters(index: number): string {
  if (!Number.isInteger(index) || index < 1) throw new Error("column index must be >= 1");
  let n = index, out = "";
  while (n > 0) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}

export function tableFromPhysicalRows(sheet: string, rows: readonly PhysicalRow[], headerRow: number, diagnostics: ImportDiagnostic[]): ImportTable {
  const header = rows.find((x) => x.row === headerRow);
  if (!header) throw new EnterpriseImportError("IMPORT_WORKBOOK_HEADER_ROW_MISSING", `Sheet ${sheet} does not contain configured header row ${headerRow}.`);
  const headerEntries = [...header.cells.entries()].filter(([, cell]) => present(cell.value)).sort(([a], [b]) => columnNumber(a) - columnNumber(b));
  if (headerEntries.length === 0) throw new EnterpriseImportError("IMPORT_WORKBOOK_EMPTY_HEADER_ROW", `Sheet ${sheet} header row ${headerRow} is empty.`);
  const exact = new Set<string>(), normalized = new Set<string>();
  const headers = new Map<string, string>();
  for (const [col, cell] of headerEntries) {
    if (typeof cell.value !== "string" && typeof cell.value !== "number" && typeof cell.value !== "boolean") throw new EnterpriseImportError("IMPORT_WORKBOOK_HEADER_INVALID", `Sheet ${sheet} header ${col}${headerRow} is not a scalar value.`);
    const h = String(cell.value).trim();
    if (!h) throw new EnterpriseImportError("IMPORT_WORKBOOK_EMPTY_HEADER", `Sheet ${sheet} contains an empty header in ${col}${headerRow}.`);
    if (exact.has(h)) throw new EnterpriseImportError("IMPORT_DUPLICATE_HEADER", `Duplicate header '${h}' in sheet ${sheet}.`);
    exact.add(h);
    const norm = headerKey(h);
    if (normalized.has(norm)) throw new EnterpriseImportError("IMPORT_DUPLICATE_HEADER_NORMALIZED", `Headers collide after deterministic normalization in sheet ${sheet}: ${h}`);
    normalized.add(norm); headers.set(col, h);
  }
  const records: ImportRecord[] = [];
  for (const row of rows.filter((x) => x.row > headerRow).sort((a, b) => a.row - b.row)) {
    const fields: Record<string, ImportCell> = {};
    let nonEmpty = false;
    for (const [col, headerName] of headers) {
      const cell = row.cells.get(col);
      if (!cell) continue;
      // Workbook header is untrusted. Preserve even "__proto__" as an
      // ordinary own field without invoking inherited magic setters.
      Object.defineProperty(fields, headerName, {
        value: cell, enumerable: true, writable: true, configurable: true,
      });
      if (present(cell.value)) nonEmpty = true;
    }
    const extra = [...row.cells.keys()].filter((col) => !headers.has(col) && present(row.cells.get(col)!.value));
    if (extra.length > 0) diagnostics.push({ code: "IMPORT_WORKBOOK_UNHEADERED_CELL", severity: "warning", message: `Sheet ${sheet} row ${row.row} contains values in columns without headers: ${extra.join(", ")}.`, table: sheet, row: row.row });
    if (nonEmpty) records.push({ recordIndex: row.row, fields });
  }
  if (records.length === 0) diagnostics.push({ code: "IMPORT_NO_DATA_ROWS", severity: "warning", message: `Sheet ${sheet} contains headers but no data rows.`, table: sheet });
  return { tableId: sheet, records };
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) { const code = ch.charCodeAt(0); if (code < 65 || code > 90) return Number.MAX_SAFE_INTEGER; n = n * 26 + code - 64; }
  return n;
}

export function configuredHeaderRow(options: Readonly<Record<string, unknown>>, sheet: string): number {
  const map = options.headerRows;
  if (map && typeof map === "object" && !Array.isArray(map)) {
    const v = (map as Record<string, unknown>)[sheet];
    if (v !== undefined) return validRow(v, `headerRows.${sheet}`);
  }
  if (options.headerRow !== undefined) return validRow(options.headerRow, "headerRow");
  return 1;
}
function validRow(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1_048_576) throw new EnterpriseImportError("IMPORT_WORKBOOK_HEADER_ROW_INVALID", `${label} must be an integer from 1 to 1048576.`);
  return value as number;
}

import type { AdapterParseResult, EnterpriseImportAdapter, EnterpriseImportAdapterContext, EnterpriseImportSourceInput, ImportCell, ImportDiagnostic, ImportRecord } from "./types.js";
import { EnterpriseImportError } from "./types.js";

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new EnterpriseImportError("IMPORT_INVALID_UTF8", "Delimited input is not valid UTF-8."); }
}

function normalizedHeader(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function parseRows(text: string, delimiter: string): string[][] {
  if (text.includes("\0")) throw new EnterpriseImportError("IMPORT_NUL_BYTE", "Delimited input contains a NUL byte.");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += ch;
      continue;
    }
    // After a closing quote only a delimiter, record ending or EOF is legal.
    // Never concatenate unquoted suffix text to an already closed field.
    if (closedQuote && ch !== delimiter && ch !== "\n" && ch !== "\r") {
      throw new EnterpriseImportError("IMPORT_MALFORMED_QUOTE", "Unexpected text after a closed quoted field.");
    }
    if (ch === '"') {
      if (field.length !== 0) throw new EnterpriseImportError("IMPORT_MALFORMED_QUOTE", "A quoted field must begin at the start of a field.");
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field); field = ""; closedQuote = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; closedQuote = false;
      rows.push(row); row = [];
    } else field += ch;
  }
  if (quoted) throw new EnterpriseImportError("IMPORT_UNCLOSED_QUOTE", "Delimited input ends inside a quoted field.");
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1]!.every((x) => x === "")) rows.pop();
  return rows;
}

function parseDelimited(source: EnterpriseImportSourceInput, context: EnterpriseImportAdapterContext, delimiter: string): AdapterParseResult {
  const rows = parseRows(decodeUtf8(source.bytes), delimiter);
  if (rows.length === 0) throw new EnterpriseImportError("IMPORT_EMPTY_SOURCE", "Delimited input contains no rows.");
  const headers = rows[0]!.map((x) => x.trim());
  if (headers.some((x) => x.length === 0)) throw new EnterpriseImportError("IMPORT_EMPTY_HEADER", "Delimited input contains an empty header.");
  const exact = new Set<string>(); const normalized = new Set<string>();
  for (const h of headers) {
    if (exact.has(h)) throw new EnterpriseImportError("IMPORT_DUPLICATE_HEADER", `Duplicate header: ${h}`);
    exact.add(h);
    const n = normalizedHeader(h);
    if (normalized.has(n)) throw new EnterpriseImportError("IMPORT_DUPLICATE_HEADER_NORMALIZED", `Headers collide after deterministic normalization: ${h}`);
    normalized.add(n);
  }
  const tableName = typeof context.options.tableName === "string" && context.options.tableName.length > 0 ? context.options.tableName : "records";
  const diagnostics: ImportDiagnostic[] = [];
  const records: ImportRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]!;
    if (values.length !== headers.length) {
      throw new EnterpriseImportError("IMPORT_COLUMN_COUNT_MISMATCH", `Logical row ${i + 1} has ${values.length} columns; expected ${headers.length}.`);
    }
    const fields: Record<string, ImportCell> = {};
    for (let c = 0; c < headers.length; c++) {
      // A source header named "__proto__" is a literal column, not an
      // instruction to mutate this record's inherited prototype.
      Object.defineProperty(fields, headers[c]!, {
        value: { value: values[c]!, locator: { kind: "record-row", table: tableName, row: i + 1 } },
        enumerable: true, writable: true, configurable: true,
      });
    }
    records.push({ recordIndex: i, fields });
  }
  if (records.length === 0) diagnostics.push({ code: "IMPORT_NO_DATA_ROWS", severity: "warning", message: "Delimited source contains headers but no data rows.", table: tableName });
  return { document: { tables: [{ tableId: tableName, records }] }, diagnostics };
}

function adapter(id: string, mediaType: string, delimiter: string): EnterpriseImportAdapter {
  return { id, version: "1.0.0", mediaTypes: [mediaType], parse: (source, context) => parseDelimited(source, context, delimiter) };
}

export const csvImportAdapter = adapter("builtin.csv", "text/csv", ",");
export const tsvImportAdapter = adapter("builtin.tsv", "text/tab-separated-values", "\t");

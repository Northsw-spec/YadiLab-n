import type { ArchiveBackend } from "../../package-io/src/types.js";
import { openSafeWorkbookArchive, productionWorkbookArchiveBackend } from "./workbook-archive.js";
import { attr, descendants, localName, parseSafeXml, xmlText, type XmlNode } from "./xml-lite.js";
import { columnLetters, configuredHeaderRow, tableFromPhysicalRows, type PhysicalRow } from "./tabular.js";
import type { AdapterParseResult, EnterpriseImportAdapter, EnterpriseImportAdapterContext, EnterpriseImportSourceInput, ImportCell, ImportDiagnostic } from "./types.js";
import { EnterpriseImportError } from "./types.js";

const ODS_MEDIA = "application/vnd.oasis.opendocument.spreadsheet";
const MAX_REPEAT = 1_048_576;
function fail(code: string, message: string): never { throw new EnterpriseImportError(code, message); }
function repeatCount(value: string | undefined, label: string): number {
  if (value === undefined) return 1;
  if (!/^[1-9][0-9]*$/.test(value)) fail("IMPORT_ODS_REPEAT_INVALID", `${label} repeat count is invalid.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > MAX_REPEAT) fail("IMPORT_ODS_REPEAT_INVALID", `${label} repeat count exceeds the safety limit.`);
  return n;
}
function externalHref(value: string): boolean { return /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|\/)/.test(value) && !value.startsWith("#"); }
function rejectActiveXml(root: XmlNode, label: string, diagnostics?: ImportDiagnostic[]): void {
  const walk = (n: XmlNode): void => {
    const prefix = n.name.includes(":") ? n.name.slice(0, n.name.indexOf(":")) : "";
    if (prefix.toLowerCase() === "script" || ["scripts", "event-listener"].includes(localName(n.name).toLowerCase())) fail("IMPORT_WORKBOOK_ACTIVE_CONTENT_FORBIDDEN", `${label} contains script/event content.`);
    for (const [name, value] of Object.entries(n.attributes)) if (localName(name) === "href" && externalHref(value)) {
      const kind = localName(n.name).toLowerCase();
      if (["table-source", "dde-link", "linked-source"].includes(kind)) fail("IMPORT_WORKBOOK_EXTERNAL_LINK_FORBIDDEN", `${label} contains external data source ${value}.`);
      diagnostics?.push({ code: "IMPORT_WORKBOOK_EXTERNAL_HYPERLINK_IGNORED", severity: "warning", message: `${label} contains external hyperlink ${value}; it is not fetched or followed.` });
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
}
function cellText(cell: XmlNode): string { return descendants(cell, "p").map(xmlText).join("\n"); }
function odsCellValue(cell: XmlNode, diagnostics: ImportDiagnostic[], sheet: string, row: number, col: string): unknown {
  const formula = attr(cell, "formula");
  const type = attr(cell, "value-type") ?? (cellText(cell) ? "string" : undefined);
  let value: unknown;
  if (type === "string") value = attr(cell, "string-value") ?? cellText(cell);
  else if (type === "float" || type === "currency" || type === "percentage") {
    const raw = attr(cell, "value");
    if (raw === undefined) value = undefined;
    else { const n = Number(raw); if (!Number.isFinite(n)) fail("IMPORT_ODS_NUMBER_INVALID", `Cell ${sheet}!${col}${row} has invalid numeric value.`); value = n; }
  } else if (type === "boolean") {
    const raw = attr(cell, "boolean-value");
    if (raw === "true") value = true; else if (raw === "false") value = false; else if (raw === undefined) value = undefined; else fail("IMPORT_ODS_BOOLEAN_INVALID", `Cell ${sheet}!${col}${row} has invalid boolean value.`);
  } else if (type === "date") value = (attr(cell, "date-value") ?? cellText(cell)) || undefined;
  else if (type === "time") value = (attr(cell, "time-value") ?? cellText(cell)) || undefined;
  else value = cellText(cell) || undefined;
  if (formula) {
    if (value === undefined) diagnostics.push({ code: "IMPORT_WORKBOOK_FORMULA_UNRESOLVED", severity: "warning", message: `Cell ${sheet}!${col}${row} contains a formula with no cached value; formula is not evaluated and the value is treated as missing.`, table: sheet, row });
    else diagnostics.push({ code: "IMPORT_WORKBOOK_CACHED_FORMULA_VALUE", severity: "warning", message: `Cell ${sheet}!${col}${row} contains a formula; The application did not evaluate it and imported only the cached workbook value.`, table: sheet, row });
  }
  return value;
}
function isEmptyCell(cell: XmlNode): boolean {
  return attr(cell, "formula") === undefined && attr(cell, "value") === undefined && attr(cell, "string-value") === undefined && attr(cell, "boolean-value") === undefined && attr(cell, "date-value") === undefined && attr(cell, "time-value") === undefined && cellText(cell) === "";
}

function parseOdsSheet(sheetNode: XmlNode, name: string, diagnostics: ImportDiagnostic[]): PhysicalRow[] {
  const rows: PhysicalRow[] = [];
  let physicalRow = 1;
  for (const rowNode of sheetNode.children.filter((x) => localName(x.name) === "table-row")) {
    const rRepeat = repeatCount(attr(rowNode, "number-rows-repeated"), `Sheet ${name} row`);
    const rowCells = rowNode.children.filter((x) => ["table-cell", "covered-table-cell"].includes(localName(x.name)));
    const hasData = rowCells.some((c) => !isEmptyCell(c));
    if (!hasData && rRepeat > 10_000) { physicalRow += rRepeat; continue; }
    if (physicalRow + rRepeat - 1 > 1_048_576) fail("IMPORT_ODS_ROW_LIMIT", `Sheet ${name} exceeds row limit.`);
    for (let rr = 0; rr < rRepeat; rr++) {
      const cells = new Map<string, ImportCell>();
      let physicalCol = 1;
      for (const cell of rowCells) {
        const cRepeat = repeatCount(attr(cell, "number-columns-repeated"), `Sheet ${name} column`);
        const empty = isEmptyCell(cell);
        if (physicalCol + cRepeat - 1 > 16_384) {
          if (empty) { physicalCol += cRepeat; continue; }
          fail("IMPORT_ODS_COLUMN_LIMIT", `Sheet ${name} exceeds column limit.`);
        }
        for (let cc = 0; cc < cRepeat; cc++) {
          if (!empty) {
            const col = columnLetters(physicalCol + cc);
            const row = physicalRow + rr;
            cells.set(col, { value: odsCellValue(cell, diagnostics, name, row, col), locator: { kind: "table-cell", sheet: name, row, column: col } });
          }
        }
        physicalCol += cRepeat;
      }
      if (cells.size > 0) rows.push({ row: physicalRow + rr, cells });
    }
    physicalRow += rRepeat;
  }
  return rows;
}

async function parseOds(source: EnterpriseImportSourceInput, context: EnterpriseImportAdapterContext, backend: ArchiveBackend): Promise<AdapterParseResult> {
  const diagnostics: ImportDiagnostic[] = [];
  const archive = await openSafeWorkbookArchive(source.bytes, backend);
  try {
    if (!archive.has("content.xml")) fail("IMPORT_ODS_STRUCTURE_INVALID", "ODS is missing required content.xml.");
    if (archive.paths.some((p) => p.startsWith("Basic/") || p.startsWith("Scripts/"))) fail("IMPORT_WORKBOOK_ACTIVE_CONTENT_FORBIDDEN", "ODS contains Basic/Scripts active content.");
    if (archive.has("mimetype")) {
      const mime = new TextDecoder("utf-8", { fatal: true }).decode(await archive.read("mimetype")).trim();
      if (mime !== ODS_MEDIA) fail("IMPORT_ODS_MIMETYPE_INVALID", `ODS mimetype member is ${mime}, expected ${ODS_MEDIA}.`);
    }
    if (archive.has("META-INF/manifest.xml")) {
      const manifest = parseSafeXml(await archive.read("META-INF/manifest.xml"), "META-INF/manifest.xml");
      rejectActiveXml(manifest, "META-INF/manifest.xml", diagnostics);
      if (descendants(manifest, "encryption-data").length > 0) fail("IMPORT_WORKBOOK_ENCRYPTED_UNSUPPORTED", "Encrypted ODS members are not supported.");
      for (const e of descendants(manifest, "file-entry")) {
        const media = attr(e, "media-type") ?? "";
        if (/script|executable|ole/i.test(media)) fail("IMPORT_WORKBOOK_ACTIVE_CONTENT_FORBIDDEN", `ODS manifest declares forbidden active content type ${media}.`);
      }
    }
    const root = parseSafeXml(await archive.read("content.xml"), "content.xml");
    rejectActiveXml(root, "content.xml", diagnostics);
    const spreadsheet = descendants(root, "spreadsheet")[0];
    if (!spreadsheet) fail("IMPORT_ODS_STRUCTURE_INVALID", "ODS content.xml has no spreadsheet element.");
    const tables = [];
    const seen = new Set<string>();
    for (const tableNode of spreadsheet.children.filter((x) => localName(x.name) === "table")) {
      const name = attr(tableNode, "name");
      if (!name) fail("IMPORT_ODS_SHEET_INVALID", "ODS contains a table without a name.");
      if (seen.has(name)) fail("IMPORT_ODS_DUPLICATE_SHEET", `ODS contains duplicate sheet name ${name}.`);
      seen.add(name);
      const rows = parseOdsSheet(tableNode, name, diagnostics);
      tables.push(tableFromPhysicalRows(name, rows, configuredHeaderRow(context.options, name), diagnostics));
      diagnostics.push({ code: "IMPORT_WORKBOOK_SHEET_DETECTED", severity: "info", message: `Detected ODS sheet ${name}.`, table: name });
    }
    if (tables.length === 0) fail("IMPORT_ODS_NO_SHEETS", "ODS workbook contains no sheets.");
    return { document: { tables }, diagnostics };
  } finally { await archive.close(); }
}

export function createOdsImportAdapter(backend: ArchiveBackend = productionWorkbookArchiveBackend()): EnterpriseImportAdapter {
  return { id: "builtin.ods", version: "1.0.0", mediaTypes: [ODS_MEDIA], parse: (source, context) => parseOds(source, context, backend) };
}
export const odsImportAdapter = createOdsImportAdapter();

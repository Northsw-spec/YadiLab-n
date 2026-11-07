import type { ArchiveBackend } from "../../package-io/src/types.js";
import { productionWorkbookArchiveBackend, normalizeArchiveTarget, openSafeWorkbookArchive } from "./workbook-archive.js";
import { attr, descendants, firstChild, localName, parseSafeXml, xmlText, type XmlNode } from "./xml-lite.js";
import { configuredHeaderRow, tableFromPhysicalRows, type PhysicalRow } from "./tabular.js";
import type { AdapterParseResult, EnterpriseImportAdapter, EnterpriseImportAdapterContext, EnterpriseImportSourceInput, ImportCell, ImportDiagnostic } from "./types.js";
import { EnterpriseImportError } from "./types.js";

const XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fail(code: string, message: string): never { throw new EnterpriseImportError(code, message); }
function cellRefParts(ref: string): { col: string; row: number } {
  const m = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref.toUpperCase());
  if (!m) fail("IMPORT_XLSX_CELL_REFERENCE_INVALID", `Invalid XLSX cell reference ${ref}.`);
  const row = Number(m[2]);
  if (row > 1_048_576) fail("IMPORT_XLSX_CELL_REFERENCE_INVALID", `XLSX row exceeds spreadsheet limit: ${ref}.`);
  return { col: m[1]!, row };
}
function textOfRichString(node: XmlNode): string { return descendants(node, "t").map(xmlText).join(""); }

function parseRelationships(root: XmlNode, label: string, diagnostics?: ImportDiagnostic[]): Map<string, { target: string; type?: string }> {
  const out = new Map<string, { target: string; type?: string }>();
  for (const rel of descendants(root, "Relationship")) {
    const id = attr(rel, "Id"), target = attr(rel, "Target"), mode = attr(rel, "TargetMode"), type = attr(rel, "Type");
    if (!id || !target) fail("IMPORT_XLSX_RELATIONSHIP_INVALID", `${label} contains a relationship without Id/Target.`);
    if (mode?.toLowerCase() === "external") {
      if (type?.toLowerCase().endsWith("/hyperlink")) diagnostics?.push({ code: "IMPORT_WORKBOOK_EXTERNAL_HYPERLINK_IGNORED", severity: "warning", message: `${label} contains external hyperlink ${target}; it is not fetched or followed.` });
      else fail("IMPORT_WORKBOOK_EXTERNAL_LINK_FORBIDDEN", `${label} contains external data/workbook relationship ${id}.`);
    }
    if (out.has(id)) fail("IMPORT_XLSX_RELATIONSHIP_DUPLICATE", `${label} contains duplicate relationship ${id}.`);
    out.set(id, type ? { target, type } : { target });
  }
  return out;
}

async function rejectUnsafeRelationships(paths: readonly string[], read: (p: string) => Promise<Uint8Array>, diagnostics: ImportDiagnostic[]): Promise<void> {
  for (const path of paths.filter((p) => p.endsWith(".rels") && p !== "xl/_rels/workbook.xml.rels")) parseRelationships(parseSafeXml(await read(path), path), path, diagnostics);
}

function detectMacroOrEmbedded(paths: readonly string[], contentTypes?: XmlNode): void {
  if (paths.some((p) => p === "xl/vbaProject.bin" || p.startsWith("xl/activeX/") || p.startsWith("xl/embeddings/"))) fail("IMPORT_WORKBOOK_ACTIVE_CONTENT_FORBIDDEN", "XLSX contains VBA, ActiveX, or embedded OLE content; active/embedded workbook content is not accepted.");
  if (contentTypes) {
    for (const node of descendants(contentTypes, "Override")) {
      const type = attr(node, "ContentType") ?? "";
      if (/vbaProject|macroEnabled|activeX|oleObject/i.test(type)) fail("IMPORT_WORKBOOK_ACTIVE_CONTENT_FORBIDDEN", `XLSX declares forbidden active content type ${type}.`);
    }
  }
}

function sharedStrings(root: XmlNode | undefined): string[] {
  if (!root) return [];
  return descendants(root, "si").map(textOfRichString);
}

function valueNode(cell: XmlNode): XmlNode | undefined { return firstChild(cell, "v"); }
function inlineString(cell: XmlNode): string { const is = firstChild(cell, "is"); return is ? textOfRichString(is) : ""; }

function xlsxCellValue(cell: XmlNode, shared: readonly string[], diagnostics: ImportDiagnostic[], sheet: string, ref: string): unknown {
  const type = attr(cell, "t") ?? "n";
  const formula = firstChild(cell, "f");
  const v = valueNode(cell);
  let value: unknown;
  if (type === "inlineStr") value = inlineString(cell);
  else if (!v) value = undefined;
  else {
    const raw = xmlText(v);
    if (type === "s") {
      if (!/^(0|[1-9][0-9]*)$/.test(raw)) fail("IMPORT_XLSX_SHARED_STRING_INVALID", `Cell ${sheet}!${ref} has invalid shared-string index.`);
      const index = Number(raw);
      if (index >= shared.length) fail("IMPORT_XLSX_SHARED_STRING_INVALID", `Cell ${sheet}!${ref} references missing shared string ${index}.`);
      value = shared[index]!;
    } else if (type === "b") {
      if (raw !== "0" && raw !== "1") fail("IMPORT_XLSX_BOOLEAN_INVALID", `Cell ${sheet}!${ref} has invalid boolean value.`);
      value = raw === "1";
    } else if (type === "str") value = raw;
    else if (type === "e") {
      diagnostics.push({ code: "IMPORT_WORKBOOK_CELL_ERROR", severity: "warning", message: `Cell ${sheet}!${ref} contains spreadsheet error ${raw}; value is treated as missing.`, table: sheet });
      value = undefined;
    } else if (type === "n" || type === "") {
      if (raw.trim() === "") value = undefined;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n)) fail("IMPORT_XLSX_NUMBER_INVALID", `Cell ${sheet}!${ref} has invalid numeric value.`);
        value = n;
      }
    } else value = raw;
  }
  if (formula) {
    if (value === undefined) diagnostics.push({ code: "IMPORT_WORKBOOK_FORMULA_UNRESOLVED", severity: "warning", message: `Cell ${sheet}!${ref} contains a formula with no cached value; formula is not evaluated and the value is treated as missing.`, table: sheet });
    else diagnostics.push({ code: "IMPORT_WORKBOOK_CACHED_FORMULA_VALUE", severity: "warning", message: `Cell ${sheet}!${ref} contains a formula; The application did not evaluate it and imported only the cached workbook value.`, table: sheet });
  }
  return value;
}

function parseSheet(sheet: string, root: XmlNode, shared: readonly string[], diagnostics: ImportDiagnostic[], options: Readonly<Record<string, unknown>>): PhysicalRow[] {
  const byRow = new Map<number, Map<string, ImportCell>>();
  const sheetData = descendants(root, "sheetData")[0];
  if (!sheetData) return [];
  for (const rowNode of sheetData.children.filter((x) => localName(x.name) === "row")) {
    const declaredRow = attr(rowNode, "r");
    let rowNumber = declaredRow && /^[1-9][0-9]{0,6}$/.test(declaredRow) ? Number(declaredRow) : undefined;
    for (const cell of rowNode.children.filter((x) => localName(x.name) === "c")) {
      const ref = attr(cell, "r");
      if (!ref) fail("IMPORT_XLSX_CELL_REFERENCE_MISSING", `Sheet ${sheet} contains a cell without a reference.`);
      const parts = cellRefParts(ref);
      if (rowNumber === undefined) rowNumber = parts.row;
      if (parts.row !== rowNumber) fail("IMPORT_XLSX_ROW_MISMATCH", `Sheet ${sheet} row metadata disagrees with cell ${ref}.`);
      const row = byRow.get(parts.row) ?? new Map<string, ImportCell>(); byRow.set(parts.row, row);
      if (row.has(parts.col)) fail("IMPORT_XLSX_DUPLICATE_CELL", `Sheet ${sheet} contains duplicate cell ${ref}.`);
      row.set(parts.col, { value: xlsxCellValue(cell, shared, diagnostics, sheet, ref), locator: { kind: "table-cell", sheet, row: parts.row, column: parts.col } });
    }
  }
  return [...byRow.entries()].sort(([a], [b]) => a - b).map(([row, cells]) => ({ row, cells }));
}

async function parseXlsx(source: EnterpriseImportSourceInput, context: EnterpriseImportAdapterContext, backend: ArchiveBackend): Promise<AdapterParseResult> {
  const diagnostics: ImportDiagnostic[] = [];
  const archive = await openSafeWorkbookArchive(source.bytes, backend);
  try {
    if (!archive.has("[Content_Types].xml") || !archive.has("xl/workbook.xml") || !archive.has("xl/_rels/workbook.xml.rels")) fail("IMPORT_XLSX_STRUCTURE_INVALID", "XLSX is missing required OOXML workbook members.");
    const contentTypes = parseSafeXml(await archive.read("[Content_Types].xml"), "[Content_Types].xml");
    detectMacroOrEmbedded(archive.paths, contentTypes);
    if (archive.paths.some((p) => p.startsWith("xl/externalLinks/"))) fail("IMPORT_WORKBOOK_EXTERNAL_LINK_FORBIDDEN", "XLSX contains external-link parts; external workbook links are not imported.");
    await rejectUnsafeRelationships(archive.paths, (p) => archive.read(p), diagnostics);

    const workbook = parseSafeXml(await archive.read("xl/workbook.xml"), "xl/workbook.xml");
    const rels = parseRelationships(parseSafeXml(await archive.read("xl/_rels/workbook.xml.rels"), "xl/_rels/workbook.xml.rels"), "xl/_rels/workbook.xml.rels", diagnostics);
    const shared = archive.has("xl/sharedStrings.xml") ? sharedStrings(parseSafeXml(await archive.read("xl/sharedStrings.xml"), "xl/sharedStrings.xml")) : [];
    const tables = [];
    const seenNames = new Set<string>();
    for (const sheetNode of descendants(workbook, "sheet")) {
      const name = attr(sheetNode, "name"), relId = attr(sheetNode, "id");
      if (!name || !relId) fail("IMPORT_XLSX_SHEET_INVALID", "XLSX workbook contains a sheet without name/relationship ID.");
      if (seenNames.has(name)) fail("IMPORT_XLSX_DUPLICATE_SHEET", `XLSX contains duplicate sheet name ${name}.`);
      seenNames.add(name);
      const rel = rels.get(relId);
      if (!rel) fail("IMPORT_XLSX_SHEET_RELATIONSHIP_MISSING", `Sheet ${name} references missing relationship ${relId}.`);
      const path = normalizeArchiveTarget("xl/workbook.xml", rel.target);
      if (!path.startsWith("xl/worksheets/") || !path.endsWith(".xml")) fail("IMPORT_XLSX_SHEET_TARGET_INVALID", `Sheet ${name} resolves to unexpected target ${path}.`);
      const root = parseSafeXml(await archive.read(path), path);
      const rows = parseSheet(name, root, shared, diagnostics, context.options);
      const headerRow = configuredHeaderRow(context.options, name);
      tables.push(tableFromPhysicalRows(name, rows, headerRow, diagnostics));
      diagnostics.push({ code: "IMPORT_WORKBOOK_SHEET_DETECTED", severity: "info", message: `Detected XLSX sheet ${name}.`, table: name });
    }
    if (tables.length === 0) fail("IMPORT_XLSX_NO_SHEETS", "XLSX workbook contains no sheets.");
    return { document: { tables }, diagnostics };
  } finally { await archive.close(); }
}

export function createXlsxImportAdapter(backend: ArchiveBackend = productionWorkbookArchiveBackend()): EnterpriseImportAdapter {
  return { id: "builtin.xlsx", version: "1.0.0", mediaTypes: [XLSX_MEDIA], parse: (source, context) => parseXlsx(source, context, backend) };
}
export const xlsxImportAdapter = createXlsxImportAdapter();

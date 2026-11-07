import type { AdapterParseResult, EnterpriseImportAdapter, EnterpriseImportAdapterContext, EnterpriseImportSourceInput, ImportCell, ImportDiagnostic, ImportRecord, ImportTable } from "./types.js";
import { EnterpriseImportError } from "./types.js";

function escapePointerPart(value: string): string { return value.replace(/~/g, "~0").replace(/\//g, "~1"); }
function decode(source: EnterpriseImportSourceInput): unknown {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes); }
  catch { throw new EnterpriseImportError("IMPORT_INVALID_UTF8", "JSON input is not valid UTF-8."); }
  try { return JSON.parse(text) as unknown; }
  catch { throw new EnterpriseImportError("IMPORT_INVALID_JSON", "JSON input is not valid JSON."); }
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

function recordsFromArray(items: readonly unknown[], tableId: string, basePointer: string): ImportRecord[] {
  return items.map((item, index) => {
    if (!isRecord(item)) throw new EnterpriseImportError("IMPORT_JSON_RECORD_NOT_OBJECT", `JSON table ${tableId} contains a non-object record at index ${index}.`);
    const fields: Record<string, ImportCell> = {};
    for (const [field, value] of Object.entries(item)) {
      Object.defineProperty(fields, field, {
        value: { value, locator: { kind: "json-pointer", pointer: `${basePointer}/${index}/${escapePointerPart(field)}` } },
        enumerable: true, writable: true, configurable: true,
      });
    }
    return { recordIndex: index + 1, fields };
  });
}

function parseJson(source: EnterpriseImportSourceInput, context: EnterpriseImportAdapterContext): AdapterParseResult {
  const value = decode(source);
  const diagnostics: ImportDiagnostic[] = [];
  const tables: ImportTable[] = [];
  const rootTableName = typeof context.options.tableName === "string" && context.options.tableName.length > 0 ? context.options.tableName : "records";
  if (Array.isArray(value)) {
    tables.push({ tableId: rootTableName, records: recordsFromArray(value, rootTableName, "") });
  } else if (isRecord(value)) {
    const arrayEntries = Object.entries(value).filter(([, v]) => Array.isArray(v));
    if (arrayEntries.length > 0) {
      for (const [name, items] of arrayEntries) tables.push({ tableId: name, records: recordsFromArray(items as unknown[], name, `/${escapePointerPart(name)}`) });
      for (const [name] of Object.entries(value).filter(([, v]) => !Array.isArray(v))) diagnostics.push({ code: "IMPORT_JSON_UNSUPPORTED_TOP_LEVEL_MEMBER", severity: "warning", message: `Top-level JSON member ${name} is not a record array and was not imported.`, field: name });
    } else {
      const fields: Record<string, ImportCell> = {};
      for (const [field, v] of Object.entries(value)) {
        Object.defineProperty(fields, field, {
          value: { value: v, locator: { kind: "json-pointer", pointer: `/${escapePointerPart(field)}` } },
          enumerable: true, writable: true, configurable: true,
        });
      }
      tables.push({ tableId: rootTableName, records: [{ recordIndex: 1, fields }] });
    }
  } else throw new EnterpriseImportError("IMPORT_JSON_ROOT_UNSUPPORTED", "JSON root must be an object or array of objects.");
  return { document: { tables }, diagnostics };
}

export const jsonImportAdapter: EnterpriseImportAdapter = { id: "builtin.json", version: "1.0.0", mediaTypes: ["application/json"], parse: parseJson };

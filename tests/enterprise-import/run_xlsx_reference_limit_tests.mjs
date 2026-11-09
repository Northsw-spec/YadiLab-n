import assert from "node:assert/strict";
import { createXlsxImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "./node_zip_backend.mjs";

const encoder = new TextEncoder();
const mediaType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function u16(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
function u32(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function join(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(size); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; }
function storedZip(entries) { const locals = []; const central = []; let offset = 0; for (const entry of entries) { const name = encoder.encode(entry.path); const data = encoder.encode(entry.text); const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]); locals.push(local); central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name])); offset += local.length; } const directory = join(central); return join([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]); }
function workbook(cellRef) { return storedZip([
  { path: "[Content_Types].xml", text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
  { path: "xl/workbook.xml", text: '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Devices" r:id="rId1"/></sheets></workbook>' },
  { path: "xl/_rels/workbook.xml.rels", text: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>' },
  { path: "xl/worksheets/sheet1.xml", text: `<worksheet><sheetData><row r="1"><c r="${cellRef}" t="inlineStr"><is><t>Asset ID</t></is></c></row><row r="2"><c r="${cellRef.replace(/1$/, "2")}" t="inlineStr"><is><t>pc01</t></is></c></row></sheetData></worksheet>` },
]); }

const adapter = createXlsxImportAdapter(nodeZipArchiveBackend);
const parse = (bytes) => adapter.parse({ bytes, mediaType }, { options: {} });
await assert.rejects(parse(workbook("XFE1")), (error) => error?.code === "IMPORT_XLSX_CELL_REFERENCE_INVALID");
console.log("PASS XLSX cell references beyond XFD are rejected");
const accepted = await parse(workbook("XFD1"));
assert.deepEqual(accepted.document.tables[0].records[0].fields["Asset ID"].locator, { kind: "table-cell", sheet: "Devices", row: 2, column: "XFD" });
console.log("PASS XLSX XFD cell reference remains accepted with its physical locator");

import assert from "node:assert/strict";
import { createOdsImportAdapter } from "../../dist-enterprise-import-test/enterprise-import/src/index.js";
import { nodeZipArchiveBackend } from "./node_zip_backend.mjs";

const encoder = new TextEncoder();
const mediaType = "application/vnd.oasis.opendocument.spreadsheet";

function u16(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
function u32(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function join(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(size); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out; }

function storedZip(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path); const data = encoder.encode(entry.text);
    const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    locals.push(local);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const directory = join(central);
  return join([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
}

function ods(rowXml) {
  return storedZip([
    { path: "mimetype", text: mediaType },
    { path: "content.xml", text: `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Devices"><table:table-row><table:table-cell office:value-type="string"><text:p>Asset ID</text:p></table:table-cell></table:table-row>${rowXml}</table:table></office:spreadsheet></office:body></office:document-content>` },
  ]);
}

const adapter = createOdsImportAdapter(nodeZipArchiveBackend);
const parse = (bytes) => adapter.parse({ bytes, mediaType }, { options: {} });
const rejectsWith = async (bytes, code) => await assert.rejects(parse(bytes), (error) => error?.code === code);

await rejectsWith(ods('<table:table-row table:number-rows-repeated="1048576"/>'), "IMPORT_ODS_ROW_LIMIT");
console.log("PASS ODS empty repeated rows respect the physical row limit");

await rejectsWith(ods('<table:table-row table:number-rows-repeated="11"><table:table-cell table:number-columns-repeated="10000" office:value-type="string"><text:p>pc01</text:p></table:table-cell></table:table-row>'), "IMPORT_ODS_CELL_BUDGET");
console.log("PASS ODS repeated cells are rejected before expansion exceeds the work budget");

await rejectsWith(ods('<table:table-row table:number-rows-repeated="11"><table:table-cell table:number-columns-repeated="1000" table:formula="of:=1" office:value-type="string"><text:p>pc01</text:p></table:table-cell></table:table-row>'), "IMPORT_ODS_FORMULA_DIAGNOSTIC_BUDGET");
console.log("PASS ODS repeated formulas are rejected before diagnostic expansion");

const accepted = await parse(ods('<table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" office:value-type="string"><text:p>pc01</text:p></table:table-cell></table:table-row>'));
assert.equal(accepted.document.tables[0].records.length, 2);
assert.deepEqual(accepted.document.tables[0].records[0].fields["Asset ID"].locator, { kind: "table-cell", sheet: "Devices", row: 2, column: "A" });
console.log("PASS ODS ordinary repeated data remains supported");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ZipJsArchiveBackend } from "../../dist-enterprise-import-test/package-io/src/zipjs-backend.js";
import { previewDocxTableStructure } from "../../dist-enterprise-import-test/enterprise-import/src/docx-tables-structural-preview.js";
import { previewOdtTableStructure } from "../../dist-enterprise-import-test/enterprise-import/src/odt-tables-structural-preview.js";
import {
  mapReviewedOfficeOriginalToNodes, OFFICE_REVIEWED_NODES_MAX, OFFICE_REVIEWED_NODES_PROFILE,
} from "../../dist-enterprise-import-test/enterprise-import/src/office-reviewed-node-candidate.js";
import { makeOdtZip, packageEntries, table as odtTable } from "./odt_test_package.mjs";

const sha = data => createHash("sha256").update(data).digest("hex");
const enc = new TextEncoder();
const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
const types = "http://schemas.openxmlformats.org/package/2006/content-types";
const main = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const cell = value => `<w:tc><w:tcPr/><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
const docxXml = rows => `<?xml version="1.0"?><w:document xmlns:w="${word}"><w:body><w:tbl><w:tblPr/><w:tblGrid/>${rows.map(v=>`<w:tr>${v.map(cell).join("")}</w:tr>`).join("")}</w:tbl></w:body></w:document>`;
const backend = new ZipJsArchiveBackend();
async function docx(rows) {
  const parts = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="${types}"><Override PartName="/word/document.xml" ContentType="${main}"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${officeRel}" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": docxXml(rows),
  };
  const output = await backend.write(Object.entries(parts).map(([path, value]) =>
    ({ path, bytes: enc.encode(value) })));
  return new Uint8Array(await output.arrayBuffer());
}
const odt = rows => makeOdtZip(packageEntries({tables:[odtTable(rows)]}));
const originalRows = [
  ["Hostname", "Comment"],
  ["node01", "CONFIDENTIAL_NEVER_DISCLOSED_7168"],
  ["node02", "SECOND_PRIVATE_CANARY_4429"],
  ["node03", "THIRD_PRIVATE_CANARY_4429"],
];
const tests = [
  {format: "docx", make: docx, preview: previewDocxTableStructure, secretCode: "DOCX_CELL_SENSITIVE_BLOCKED"},
  {format: "odt", make: async rows => odt(rows), preview: previewOdtTableStructure, secretCode: "ODT_CELL_SENSITIVE_BLOCKED"},
];
let assertions = 0;
const eq = (actual, expected, name) => {assert.deepEqual(actual, expected, name);assertions++};
const yes = (actual, name) => {assert.ok(actual, name);assertions++};
const selection = (rowOrdinal=1, role="network.router") =>
  ({ tableOrdinal:0, rowOrdinal, nodeIdCellOrdinal:0, role, acknowledgeCell:true });
const decision = (format, source, nodes=[selection()]) =>
  ({ format, sourceSha256:sha(source), acknowledgeModeledResources:true, nodes });
async function blocked(bytes, selected, code) {
  const candidate = await mapReviewedOfficeOriginalToNodes(bytes, selected);
  eq(candidate.status, "BLOCKED", code + " status");
  eq(candidate.diagnostics, [{code}], code + " sanitized diagnostic");
  eq(candidate.origins, [], code + " no partial origin");
  eq(candidate.selectedResources, 0, code + " no count");
  yes(!Object.hasOwn(candidate,"source"), code + " no partial scenario");
  eq(candidate.canActivate,false,code + " cannot activate");
}
for(const {format,make,preview,secretCode} of tests) {
  const bytes=await make(originalRows);
  const raw=await preview(bytes);
  eq(raw.sourceSha256,sha(bytes),format + " exact original hash");
  eq(raw.textIncluded,false,format + " preview contains no text");
  const agreed=decision(format,bytes);
  const candidate=await mapReviewedOfficeOriginalToNodes(bytes,agreed);
  eq(candidate.status,"READY_FOR_COMPILATION",format+" approved model-ready candidate");
  eq(candidate.profileId,OFFICE_REVIEWED_NODES_PROFILE);
  eq(candidate.sourceSha256,sha(bytes));
  eq(candidate.selectedResources,1);
  eq(candidate.canActivate,false);
  eq(candidate.engineVerified,false);
  eq(candidate.physicalTopologyVerified,false);
  eq(candidate.diagnostics,[]);
  eq(candidate.source.resources.map(x=>({id:x.id,label:x.label,type:x.type})),
    [{id:"node01",label:"node01",type:"network.router"}],format+" only chosen original value");
  eq(candidate.source.connections,[],format+" no auto-inferred cable");
  eq(candidate.source.resources[0].interfaces,undefined,format+" no inferred interface/IP");
  eq(candidate.source.tests,[],format+" no probe");
  eq(candidate.source.objectives[0].condition.path,"office_manual_verification",
    format+" no tautological PASS");
  eq(candidate.source.completion.path,"office_manual_verification");
  eq(candidate.origins.length,1);
  eq(candidate.origins[0].targetId,"node01");
  eq(candidate.origins[0].locator,raw.tables[0].rows[1].cells[0].locator,
    format+" authentic original document cell provenance");
  eq(candidate.origins[0].decision,"USER_CONSENTED_ID_CELL_AND_ROLE");
  for (const privateValue of originalRows.slice(1).map(r=>r[1])) {
    yes(!JSON.stringify(candidate).includes(privateValue),format+" unselected cell value never leaked");
  }
  const multi=await mapReviewedOfficeOriginalToNodes(bytes,decision(format,bytes,
    [selection(1,"network.switch"),selection(2,"resource.generic"),selection(3,"endpoint.linux")]));
  eq(multi.status,"READY_FOR_COMPILATION",format+" exact selected multi-row consent");
  eq(multi.source.resources.map(x=>[x.id,x.type]),[
    ["node01","network.switch"],["node02","resource.generic"],["node03","endpoint.linux"]]);
  eq(multi.origins.map(x=>x.locator.rowOrdinal),[1,2,3]);
  eq(multi.source.connections,[]);
  await blocked(bytes,{...agreed,acknowledgeModeledResources:false},"IC040_P1A_DECISION_INVALID");
  await blocked(bytes,{...agreed,nodes:[{...selection(),acknowledgeCell:false}]},"IC040_P1A_NODE_DECISION_INVALID");
  await blocked(bytes,{...agreed,nodes:[selection(0)]},"IC040_P1A_NODE_DECISION_INVALID");
  await blocked(bytes,{...agreed,nodes:[{...selection(),rowOrdinal:-1}]},"IC040_P1A_NODE_DECISION_INVALID");
  await blocked(bytes,{...agreed,nodes:[{...selection(),nodeIdCellOrdinal:99}]},"IC040_P1A_CELL_NOT_FOUND");
  await blocked(bytes,{...agreed,nodes:[selection(1),selection(1)]},"IC040_P1A_DUPLICATE_ROW");
  await blocked(bytes,{...agreed,nodes:[{...selection(),role:"network.chief-of-everything"}]},"IC040_P1A_NODE_DECISION_INVALID");
  await blocked(bytes,{...agreed,nodes:[selection(1),selection(2),selection(3),selection(1),selection(2)]},"IC040_P1A_DECISION_INVALID");
  eq(OFFICE_REVIEWED_NODES_MAX,4,format+" bounded at four explicit rows");
  await blocked(bytes,{...agreed,sourceSha256:"0".repeat(64)},"IC040_P1A_SOURCE_CHANGED");
  await blocked(bytes,{...agreed,sourceSha256:"hacked"},"IC040_P1A_DECISION_INVALID");
  await blocked(bytes,{...agreed,extraUnknown:1},"IC040_P1A_DECISION_INVALID");
  await blocked(bytes,{...agreed,nodes:[{...selection(),providedRawText:"ignore this"}]},"IC040_P1A_NODE_DECISION_INVALID");
  // A real independent package rewriter must produce another valid same-size
  // ZIP, not a CRC-broken byte overwrite. Search only bounded numeric variants.
  let swapped;
  for(const digit of ["4","5","6","7","8","9","0"]) {
    const altered=await make(originalRows.map((row,i)=>i===1?["node0"+digit,row[1]]:row));
    if(altered.byteLength===bytes.byteLength && sha(altered)!==sha(bytes)){
      swapped=altered;break;
    }
  }
  yes(swapped,format+" independent same-length valid original replacement");
  if(swapped)await blocked(swapped,agreed,"IC040_P1A_SOURCE_CHANGED");
  const forgedFormat={...agreed,format:format==="docx"?"odt":"docx"};
  const other=await mapReviewedOfficeOriginalToNodes(bytes,forgedFormat);
  eq(other.status,"BLOCKED",format+" original bytes not accepted as another package profile");
  yes(!Object.hasOwn(other,"source"),format+" no cross-profile source");
  const suspicious=await make([["Hostname","Comment"],["password","OK"]]);
  await blocked(suspicious,decision(format,suspicious),secretCode);
  const suspiciousHeader=await make([["Password","Comment"],["node01","OK"]]);
  await blocked(suspiciousHeader,decision(format,suspiciousHeader),secretCode);
  const invalid=await make([["Hostname","Comment"],["NodeUppercase","OK"]]);
  await blocked(invalid,decision(format,invalid),"IC040_P1A_NODE_ID_INVALID");
  const sameId=await make([["Hostname","Comment"],["node01","OK"],["node01","OK"]]);
  await blocked(sameId,decision(format,sameId,[selection(1),selection(2)]),"IC040_P1A_DUPLICATE_NODE_ID");
  await blocked(new Uint8Array(0),decision(format,bytes),
    format==="docx"?"DOCX_SOURCE_SIZE_INVALID":"ODT_SOURCE_SIZE_INVALID");
}
console.log(`PASS IC-040 P1a reviewed office source-only node candidates: ${assertions} assertions across real DOCX/ODT ZIP, explicit per-cell consent, SHA/provenance, non-disclosure, secret denial, no Engine or inferred links`);

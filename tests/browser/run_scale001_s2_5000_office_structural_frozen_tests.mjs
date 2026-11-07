import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {previewDocxTableStructure} from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import {previewOdtTableStructure} from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";

/**
 * SCALE-001 S2/P3a frozen before product change.
 *
 * Real original DOCX/ODT bytes, 5,000 unique original device rows and 5,000
 * separately declared source port-paired link rows (one is port-distinct
 * parallel evidence). This is STRUCTURAL-ONLY; it must not disclose source
 * cell values, authorize Builder import, or certify Engine / physical links.
 *
 * The 1k profile must remain deliberately incapable of accepting 5k; the
 * new profile must be explicitly opted into using a different version ID.
 * Memory/time below are reported, not passed against invented budgets.
 */
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const SHA=b=>createHash("sha256").update(b).digest("hex");
const PROFILE_S1="office.scaled-structural-review.v1";
const PROFILE_S2="office.scaled-structural-review.v2";
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const escapeXml=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const cell=s=>'<w:tc><w:tcPr/><w:p><w:r><w:t>'+escapeXml(s)+'</w:t></w:r></w:p></w:tc>';
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
async function docx(tables){
  const body='<w:document xmlns:w="'+WORD+'"><w:body>'+tables.map(rows=>
    '<w:tbl><w:tblPr/><w:tblGrid/>'+rows.map(row=>
      '<w:tr>'+row.map(cell).join("")+'</w:tr>').join("")+'</w:tbl>').join("")+
    '</w:body></w:document>';
  const parts={
    "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
    "_rels/.rels":'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>',
    "word/document.xml":body
  };
  const blob=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:enc.encode(data)})));
  return new Uint8Array(await blob.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
function originalSourceRows(n){
  const nodes=[["Device ID","Source-declared role","Private notes"]];
  const links=[["From","To","Source port","Target port","Private notes"]];
  for(let i=0;i<n;i++)nodes.push([id(i),
    i===0?"network.switch":"endpoint.windows","P3A_PRIVATE_NODE_CANARY_"+i]);
  for(let i=1;i<n;i++)links.push([id(i),id(0),"eth0",port(i),
    "P3A_PRIVATE_LINK_CANARY_"+i]);
  // This is original explicit evidence, NOT a synthesized network cable:
  // the same device pair has two distinct source/target interface pairs.
  links.push([id(1),id(0),"eth1",port(n),"P3A_PRIVATE_PARALLEL_CANARY"]);
  assert.equal(nodes.length,n+1);
  assert.equal(links.length,n+1);
  return [nodes,links];
}
async function rejection(promise,expected){
  const codes=Array.isArray(expected)?expected:[expected];
  await assert.rejects(promise,e=>codes.includes(e?.code),
    "Expected explicitly allowed fail-closed code: "+codes.join(" or "));
}
const observations=[];
let asserted=0;
for(const [format,make,preview,rowError] of [
  ["docx",docx,previewDocxTableStructure,"DOCX_ROW_COUNT_UNSUPPORTED"],
  ["odt",odt,previewOdtTableStructure,"ODT_ROW_COUNT_UNSUPPORTED"]
]){
  const original=await make(originalSourceRows(5000));
  const sourceSha=SHA(original),begin=performance.now();
  // The old size/row budget that rejects first is source-structure dependent.
  // Both outcomes are SAFE denials; neither is permission to accept 5k.
  const oldXmlError=format==="docx"?"DOCX_DOCUMENT_XML_TOO_LARGE":"ODT_XML_TOO_LARGE";
  await rejection(preview(original),[oldXmlError,rowError]);asserted++;
  await rejection(preview(original,{capacityProfile:PROFILE_S1}),
    [oldXmlError,rowError]);asserted++;
  await rejection(preview(original,{capacityProfile:"office.random-grant.v100"}),
    "SCALE_P1A_CAPACITY_PROFILE_INVALID");asserted++;
  await rejection(preview(original,{capacityProfile:PROFILE_S2,unexpected:true}),
    "SCALE_P1A_CAPACITY_PROFILE_INVALID");asserted++;

  const result=await preview(original,{capacityProfile:PROFILE_S2});
  const check=(got,want,label)=>{assert.deepEqual(got,want,format+": "+label);asserted++;};
  check(result.capacityProfile,PROFILE_S2,"separate explicit v2 grant");
  check(result.profileId,format==="docx"?"office.docx-tables.structural.v1":
    "office.odt-tables.structural.v1","original parser identity");
  check(result.status,"REVIEW_REQUIRED","no activation by a preview");
  check(result.semanticTrack,"CONFIG_DOCUMENTED","unverified document semantics");
  check(result.canActivate,false,"cannot activate");
  check(result.engineVerified,false,"no modeled Engine PASS");
  check(result.physicalTopologyVerified,false,"no physical link PASS");
  check(result.textIncluded,false,"original cell values remain private");
  check(result.sourceSha256,sourceSha,"original ZIP SHA-256");
  check(result.tables.length,2,"two independently declared original tables");
  check(result.tables[0].rows.length,5001,"exact 5000 device rows + header");
  check(result.tables[1].rows.length,5001,"exact 5000 link rows + header");
  check(result.totalCells,5001*3+5001*5,"exact total original structural cells");
  const first=result.tables[0].rows[1].cells[0].locator;
  const last=result.tables[0].rows[5000].cells[0].locator;
  const finalLink=result.tables[1].rows[5000].cells[4].locator;
  check([first.tableOrdinal,first.rowOrdinal,first.cellOrdinal,first.sourceSha256],
    [0,1,0,sourceSha],"first original node locator");
  check([last.tableOrdinal,last.rowOrdinal,last.cellOrdinal,last.sourceSha256],
    [0,5000,0,sourceSha],"last original node locator");
  check([finalLink.tableOrdinal,finalLink.rowOrdinal,finalLink.cellOrdinal,finalLink.sourceSha256],
    [1,5000,4,sourceSha],"last original parallel-port source locator");
  const previewJson=JSON.stringify(result);
  assert(!previewJson.includes("P3A_PRIVATE_NODE_CANARY") &&
         !previewJson.includes("P3A_PRIVATE_LINK_CANARY") &&
         !previewJson.includes("P3A_PRIVATE_PARALLEL_CANARY") &&
         !previewJson.includes(id(4999)),
         format+": no private/unselected original source text disclosed");asserted++;
  // Exactly one row beyond the newly approved limit must remain BLOCKED.
  const beyond=originalSourceRows(5001);
  const extra=await make(beyond);
  await rejection(preview(extra,{capacityProfile:PROFILE_S2}),rowError);asserted++;
  observations.push({format,status:"STRUCTURE_REVIEW_ONLY",originalDevices:5000,
    originalPortPairedLinks:5000,originalZipSha256:sourceSha,
    zipBytes:original.byteLength,elapsedMs:Math.round(performance.now()-begin),
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576),
    engineVerified:false,physicalTopologyVerified:false});
}
console.log("PASS SCALE-001 S2/P3a frozen 5000+5000 genuine DOCX/ODT source STRUCTURAL ONLY, "+
  asserted+" independent positive/negative assertions; "+JSON.stringify(observations)+
  "; Builder, hierarchy and Linux capacity NOT_VERIFIED");

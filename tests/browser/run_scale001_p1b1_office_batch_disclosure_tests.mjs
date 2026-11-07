import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";
import {revealReviewedOfficeBatch,OFFICE_SCALED_BATCH_PROFILE} from
  "../../dist-browser-test/enterprise-import/src/office-large-batch-review.js";

// Frozen before application changes. Real independent original DOCX/ODT ZIPs.
// This API deliberately discloses only individually approved columns of a
// bounded original row range; it creates no import/Builder/Engine truth.
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const SHA=b=>createHash("sha256").update(b).digest("hex");
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const cell=s=>"<w:tc><w:tcPr/><w:p><w:r><w:t>"+s+"</w:t></w:r></w:p></w:tc>";
async function docx(tables) {
 const body='<w:document xmlns:w="'+WORD+'"><w:body>'+tables.map(rows=>
  '<w:tbl><w:tblPr/><w:tblGrid/>'+rows.map(row=>
    '<w:tr>'+row.map(cell).join("")+'</w:tr>').join("")+'</w:tbl>').join("")+
  '</w:body></w:document>';
 const parts={
  "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
  "_rels/.rels":'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>',
  "word/document.xml":body,
 };
 const raw=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:enc.encode(data)})));
 return new Uint8Array(await raw.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
function fixtures(n){
 const nodes=[["Device ID","Private Notes","Type"]];
 for(let i=0;i<n;i++)nodes.push(["dev"+String(i).padStart(6,"0"),
  "PRIVATE_CANARY_987_"+i,"Switch"]);
 const links=[["Source","Destination","Local port","Remote port","Private Notes"]];
 for(let i=1;i<n;i++)links.push(["dev"+String(i).padStart(6,"0"),
  "dev000000","eth0","eth"+i,"PRIVATE_LINK_CANARY_654_"+i]);
 return [nodes,links];
}
const cap="office.scaled-reviewed-batch.v1", col=n=>({cellOrdinal:n,acknowledge:true});
const decide=(format,hash,tableOrdinal,rowStart,rowEnd,columns,overrides={})=>({
 format,sourceSha256:hash,capacityProfile:cap,tableOrdinal,rowStart,rowEnd,
 columns:columns.map(col),acknowledgeSelectedRange:true,acknowledgeDisclosure:true,
 ...overrides,
});
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
const yes=(a,label)=>{assert.ok(a,label);checks++};
const deny=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);checks++};
eq(OFFICE_SCALED_BATCH_PROFILE,cap,"exact opt-in batch identifier");
const measurements=[];
for(const [format,make] of [["docx",docx],["odt",odt]]){
 for(const n of [100,1000]){
  const start=performance.now(),tables=fixtures(n),raw=await make(tables),sha=SHA(raw);
  const dev=await revealReviewedOfficeBatch(raw,decide(format,sha,0,1,100,[0,2]));
  eq(dev.status,"REVEALED_UNVERIFIED",format+" source-only disclosure");
  eq(dev.sourceSha256,sha,format+" original full-byte identity");
  eq(dev.canActivate,false,format+" no activation");
  eq(dev.engineVerified,false,format+" no Engine PASS");
  eq(dev.physicalTopologyVerified,false,format+" no physical claim");
  eq(dev.rows.length,100,format+" exact bounded consented row count");
  eq(dev.rows[0].cells.map(x=>x.text),["dev000000","Switch"],format+" first approved row/columns");
  eq(dev.rows[99].cells.map(x=>x.text),["dev000099","Switch"],format+" last approved row/columns");
  for(const row of dev.rows) {
   eq(row.cells.map(x=>x.locator.cellOrdinal),[0,2],format+" selected columns only");
   yes(row.cells.every(x=>x.locator.tableOrdinal===0 && x.locator.rowOrdinal===row.rowOrdinal
    && x.locator.sourceSha256===sha),format+" stable original source locator");
  }
  const link=await revealReviewedOfficeBatch(raw,decide(format,sha,1,1,99,[0,1,2,3]));
  eq(link.rows.length,99,format+" exact 99 approved link rows");
  eq(link.rows[0].cells.map(x=>x.text),["dev000001","dev000000","eth0","eth1"],
    format+" original first link endpoints and ports");
  eq(link.rows[98].cells.map(x=>x.text),["dev000099","dev000000","eth0","eth99"],
    format+" original last link");
  const values=JSON.stringify({dev,link});
  yes(!values.includes("PRIVATE_CANARY_") && !values.includes("PRIVATE_LINK_CANARY_"),
    format+" unselected source columns never disclosed");
  yes(!values.includes("Private Notes"),format+" unselected heading not exposed");
  if(n===1000){
   const last=await revealReviewedOfficeBatch(raw,decide(format,sha,0,901,1000,[0]));
   eq(last.rows.length,100,format+" permitted last source batch");
   eq(last.rows[99].cells[0].text,"dev000999",format+" final original thousandth ID");
   eq(last.rows[99].cells[0].locator.rowOrdinal,1000,format+" original row ordinal");
   await deny(revealReviewedOfficeBatch(raw,decide(format,sha,0,1,101,[0])),
     "SCALE_P1B1_SELECTION_INVALID");
  }
  measurements.push({format,nodes:n,links:n-1,sourceBytes:raw.byteLength,
    elapsedMs:Math.round(performance.now()-start)});
 }
 const raw=await make(fixtures(100)),sha=SHA(raw),valid=decide(format,sha,0,1,3,[0]);
 await deny(revealReviewedOfficeBatch(raw,{...valid,sourceSha256:"0".repeat(64)}),
  "SCALE_P1B1_SOURCE_CHANGED");
 await deny(revealReviewedOfficeBatch(raw,{...valid,capacityProfile:"invented"}),
  "SCALE_P1B1_SELECTION_INVALID");
 await deny(revealReviewedOfficeBatch(raw,{...valid,acknowledgeDisclosure:false}),
  "SCALE_P1B1_CONSENT_REQUIRED");
 await deny(revealReviewedOfficeBatch(raw,{...valid,columns:[{cellOrdinal:0,acknowledge:false}]}),
  "SCALE_P1B1_CONSENT_REQUIRED");
 await deny(revealReviewedOfficeBatch(raw,{...valid,rowStart:0}),
  "SCALE_P1B1_SELECTION_INVALID");
 await deny(revealReviewedOfficeBatch(raw,{...valid,columns:[col(0),col(0)]}),
  "SCALE_P1B1_SELECTION_INVALID");
 await deny(revealReviewedOfficeBatch(raw,{...valid,columns:[col(1)]}),
  "SCALE_P1B1_SENSITIVE_BLOCKED");
 await deny(revealReviewedOfficeBatch(raw,{...valid,columns:[col(9)]}),
  "SCALE_P1B1_SELECTION_INVALID");
 await deny(revealReviewedOfficeBatch(raw,{...valid,unapproved:true}),
  "SCALE_P1B1_SELECTION_INVALID");
 const sensitive=fixtures(100);
 sensitive[0][0][2]="Password";
 const bad=await make(sensitive);
 await deny(revealReviewedOfficeBatch(bad,decide(format,SHA(bad),0,1,3,[2])),
  "SCALE_P1B1_SENSITIVE_BLOCKED");
}
console.log("PASS SCALE-001 P1b1: "+checks+" original Office ZIP source-bound batch disclosure assertions; "+
  JSON.stringify(measurements)+"; no Builder/DOM claim.");

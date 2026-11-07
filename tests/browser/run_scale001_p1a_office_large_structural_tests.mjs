import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {previewDocxTableStructure} from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import {previewOdtTableStructure} from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";

// Frozen before any product change. At baseline 1,000 rows fail closed.
// The new, separately opted-in P1a profile must be only structural; source
// disclosure, Builder activation and arbitrary mass approval remain forbidden.
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=b=>createHash("sha256").update(b).digest("hex");
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const cell=s=>"<w:tc><w:tcPr/><w:p><w:r><w:t>"+s+"</w:t></w:r></w:p></w:tc>";
async function docx(tables){
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
const cap={capacityProfile:"office.scaled-structural-review.v1"};
const tableData=n=>{
 const devices=[["Device ID","Private"]];
 for(let i=0;i<n;i++)devices.push(["dev"+String(i).padStart(6,"0"),"SENSITIVE_P1A_CANARY_987"+i]);
 const links=[["From","To","Local port","Remote port"]];
 for(let i=1;i<n;i++)links.push(["dev"+String(i).padStart(6,"0"),
  "dev000000","eth0","eth"+String(i)]);
 return [devices,links];
};
let count=0;const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);count++};
const yes=(a,msg)=>{assert.ok(a,msg);count++};
const failure=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);count++};
const metrics=[];
for(const [format,make,preview,rowCode] of [
 ["docx",docx,previewDocxTableStructure,"DOCX_ROW_COUNT_UNSUPPORTED"],
 ["odt",odt,previewOdtTableStructure,"ODT_ROW_COUNT_UNSUPPORTED"],
]){
 for(const n of [100,1000]){
  const raw=await make(tableData(n));
  const start=performance.now();
  if(n===1000)await failure(preview(raw),rowCode);
  const result=await preview(raw,cap);
  eq(result.status,"REVIEW_REQUIRED",format+" source remains reviewed, not authorized");
  eq(result.canActivate,false,format+" no activated model");
  eq(result.engineVerified,false,format+" no Engine PASS");
  eq(result.physicalTopologyVerified,false,format+" no cable verification");
  eq(result.textIncluded,false,format+" never return original cell text");
  eq(result.sourceSha256,sha(raw),format+" exact original ZIP source SHA");
  eq(result.tables.length,2,format+" two original tables");
  eq(result.tables[0].rows.length,n+1,format+" every device row retained");
  eq(result.tables[1].rows.length,n,format+" every Links row retained");
  eq(result.totalCells,(n+1)*2+n*4,format+" exact original structural cells");
  const last=result.tables[0].rows[n].cells[0];
  eq([last.locator.tableOrdinal,last.locator.rowOrdinal,last.locator.cellOrdinal],
    [0,n,0],format+" stable original device row ordinal");
  eq(last.locator.sourceSha256,sha(raw),format+" final device bound to original bytes");
  const linkLast=result.tables[1].rows[n-1].cells[3];
  eq([linkLast.locator.tableOrdinal,linkLast.locator.rowOrdinal,linkLast.locator.cellOrdinal],
    [1,n-1,3],format+" stable far-link port ordinal");
  eq(linkLast.locator.sourceSha256,sha(raw),format+" far link exact source identity");
  yes(!JSON.stringify(result).includes("SENSITIVE_P1A_CANARY_987"),format+" no private source disclosure");
  yes(!JSON.stringify(result).includes("dev000999"),format+" no source ID in structural preview");
  metrics.push({format,nodes:n,links:n-1,sourceBytes:raw.byteLength,
    elapsedMs:Math.round(performance.now()-start)});
 }
 const small=await make(tableData(100));
 await failure(preview(small,{capacityProfile:"random.unauthorized.v1"}),"SCALE_P1A_CAPACITY_PROFILE_INVALID");
 await failure(preview(small,{capacityProfile:cap.capacityProfile,unexpected:true}),
   "SCALE_P1A_CAPACITY_PROFILE_INVALID");
 const tooMany=await make([tableData(1000)[0].concat([["dev001000","UNSELECTED"]])]);
 await failure(preview(tooMany,cap),rowCode);
}
console.log("PASS SCALE-001 P1a: "+count+
  " genuine DOCX/ODT ZIP structural-only 100/1000 node and fail-closed assertions "+
  JSON.stringify(metrics));

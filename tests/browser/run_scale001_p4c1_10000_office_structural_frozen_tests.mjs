import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {previewDocxTableStructure} from "../../dist-browser-test/enterprise-import/src/docx-tables-structural-preview.js";
import {previewOdtTableStructure} from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";

/** Independently frozen P4c1 before v3 product.
 * Genuine original DOCX/ODT: 10000 independent device rows and 10000
 * independently written original port-paired Links rows plus headers.
 * STRUCTURAL-ONLY: no private source cell text disclosure, no Builder,
 * Chromium, Runtime/Engine or claimed real network cabling.
 */
const E=new TextEncoder(),zip=new ZipJsArchiveBackend(),N=10000;
const V1="office.scaled-structural-review.v1";
const V2="office.scaled-structural-review.v2";
const V3="office.scaled-structural-review.v3";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const P="http://schemas.openxmlformats.org/package/2006/relationships";
const T="http://schemas.openxmlformats.org/package/2006/content-types";
const M="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const R="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const SHA=b=>createHash("sha256").update(b).digest("hex");
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const escape=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const cell=s=>"<w:tc><w:tcPr/><w:p><w:r><w:t>"+escape(s)+
  "</w:t></w:r></w:p></w:tc>";
async function docx(tables){
  const body='<w:document xmlns:w="'+W+'"><w:body>'+tables.map(rows=>
    "<w:tbl><w:tblPr/><w:tblGrid/>"+rows.map(row=>
      "<w:tr>"+row.map(cell).join("")+"</w:tr>").join("")+"</w:tbl>").join("")+
    "</w:body></w:document>";
  const parts={
    "[Content_Types].xml":'<Types xmlns="'+T+'"><Override PartName="/word/document.xml" ContentType="'+M+'"/></Types>',
    "_rels/.rels":'<Relationships xmlns="'+P+'"><Relationship Id="rId1" Type="'+R+'" Target="word/document.xml"/></Relationships>',
    "word/document.xml":body
  };
  const blob=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:E.encode(data)})));
  return new Uint8Array(await blob.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
function originalRows(n){
  const nodes=[["Device ID","Canonical role","Private notes"]];
  const links=[["From","To","Source port","Target port","Private notes"]];
  for(let i=0;i<n;i++)nodes.push([id(i),i===0?"network.switch":"endpoint.windows",
    "P4C1_PRIVATE_NODE_CANARY_"+i]);
  for(let i=1;i<n;i++)links.push([id(i),id(0),"eth0",port(i),
    "P4C1_PRIVATE_LINK_CANARY_"+i]);
  links.push([id(1),id(0),"eth1",port(n),
    "P4C1_PRIVATE_PARALLEL_CANARY"]);
  assert.equal(nodes.length,n+1);assert.equal(links.length,n+1);
  return [nodes,links];
}
let checks=0;
const eq=(a,b,why)=>{assert.deepEqual(a,b,why);checks++};
const yes=(a,why)=>{assert.ok(a,why);checks++};
const deny=async(p,codes)=>{
  const allowed=Array.isArray(codes)?codes:[codes];
  await assert.rejects(p,e=>allowed.includes(e?.code),
    "expected fail-closed original structural error: "+allowed.join(" or "));
  checks++;
};
const observations=[];
for(const [format,make,preview,rowsErr,xmlErr,cellsErr] of [
  ["docx",docx,previewDocxTableStructure,
    "DOCX_ROW_COUNT_UNSUPPORTED","DOCX_DOCUMENT_XML_TOO_LARGE","DOCX_TOO_MANY_CELLS"],
  ["odt",odt,previewOdtTableStructure,
    "ODT_ROW_COUNT_UNSUPPORTED","ODT_XML_TOO_LARGE","ODT_TOO_MANY_CELLS"]
]){
  const t0=performance.now(),bytes=await make(originalRows(N)),hash=SHA(bytes);
  yes(bytes instanceof Uint8Array&&bytes.byteLength>0,format+" genuine Office ZIP bytes");
  for(const grant of [undefined,V1,V2]){
    const choice=grant===undefined?undefined:{capacityProfile:grant};
    // A legacy ZIP member cap may safely deny this much earlier than the
    // structural row/cell checks. This acceptance is for *negative v0–v2*
    // only, NEVER for the new v3 positive original.
    await deny(preview(bytes,choice),
      [rowsErr,xmlErr,cellsErr,"IMPORT_ARCHIVE_FILE_TOO_LARGE",
        "IMPORT_XML_TOO_COMPLEX"]);
  }
  await deny(preview(bytes,{capacityProfile:"office.unreviewed-v99"}),
    "SCALE_P1A_CAPACITY_PROFILE_INVALID");
  await deny(preview(bytes,{capacityProfile:V3,extra:"FORGED"}),
    "SCALE_P1A_CAPACITY_PROFILE_INVALID");
  const result=await preview(bytes,{capacityProfile:V3});
  eq(result.capacityProfile,V3,format+" v3 must require exact opt-in");
  eq(result.status,"REVIEW_REQUIRED",format+" structure only");
  eq(result.semanticTrack,"CONFIG_DOCUMENTED",format+" unverified semantics");
  eq(result.canActivate,false,format+" not permitted to activate Builder");
  eq(result.engineVerified,false,format+" not Engine verified");
  eq(result.physicalTopologyVerified,false,format+" not physical cabling");
  eq(result.textIncluded,false,format+" private cell contents not disclosed");
  eq(result.sourceSha256,hash,format+" exact SHA of original ZIP bytes");
  eq(result.tables.length,2,format+" two independent original tables");
  eq(result.tables[0].rows.length,N+1,format+" node table 10000+header");
  eq(result.tables[1].rows.length,N+1,format+" link table 10000+header");
  eq(result.totalCells,(N+1)*(3+5),format+" original structural cell count");
  const nodes=result.tables[0].rows;
  const links=result.tables[1].rows;
  for(const [cell,table,row,col] of [
    [nodes[1].cells[0],0,1,0],
    [nodes[5000].cells[1],0,5000,1],
    [nodes[N].cells[2],0,N,2],
    [links[1].cells[0],1,1,0],
    [links[5000].cells[3],1,5000,3],
    [links[N].cells[4],1,N,4]
  ]){
    eq([cell.locator.tableOrdinal,cell.locator.rowOrdinal,
      cell.locator.cellOrdinal,cell.locator.sourceSha256],
      [table,row,col,hash],format+" exact immutable original source-cell locator");
  }
  const inspected=JSON.stringify(result);
  for(const secret of ["P4C1_PRIVATE_NODE_CANARY_","P4C1_PRIVATE_LINK_CANARY_",
    "P4C1_PRIVATE_PARALLEL_CANARY",id(N-1),port(N)]){
    yes(!inspected.includes(secret),
      format+" source preview must not expose secret / original source value");
  }
  const extra=await make(originalRows(N+1));
  await deny(preview(extra,{capacityProfile:V3}),[rowsErr,xmlErr,cellsErr]);
  observations.push({format,gate:"10K_DOCX_ODT_ORIGINAL_STRUCTURE_ONLY",
    status:"REVIEW_REQUIRED",originalDeviceRows:N,originalPortLinkRows:N,
    compressedZipBytes:bytes.length,originalZipSha256:hash,
    elapsedMs:Math.round(performance.now()-t0),
    processRssMiB:Math.round(process.memoryUsage().rss/1048576*100)/100,
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576*100)/100,
    builderVerified:false,originalSourceTextDisclosed:false,
    mountedChromiumVerified:false,engineVerified:false,physicalTopologyVerified:false});
}
console.log("PASS SCALE-001 P4c1 10000 original DOCX/ODT source devices + 10000 original port-paired Links each STRUCTURAL ONLY; "+checks+" independent assertions; "+JSON.stringify(observations));

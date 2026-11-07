import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";
import {revealReviewedOfficeBatchesV3,OFFICE_SCALED_BATCH_PROFILE_V3} from
  "../../dist-browser-test/enterprise-import/src/office-large-batch-review.js";

/** Frozen independent P4c2a BEFORE production code. Actual original DOCX
 * and ODT bytes: 10000 independently declared devices, 10000 independently
 * declared original Links with source and target port; one true parallel pair.
 * Source disclosure only: never automatic Builder, Runtime, Engine, cabling.
 */
const N=10000,enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=b=>createHash("sha256").update(b).digest("hex");
const V3="office.scaled-reviewed-batch.v3";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const P="http://schemas.openxmlformats.org/package/2006/relationships";
const T="http://schemas.openxmlformats.org/package/2006/content-types";
const M="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const R="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const cell=s=>"<w:tc><w:tcPr/><w:p><w:r><w:t>"+esc(s)+"</w:t></w:r></w:p></w:tc>";
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
  const blob=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:enc.encode(data)})));
  return new Uint8Array(await blob.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
function sourceTables(n){
  const nodes=[["Device ID","Canonical role","Private notes"]];
  const links=[["From","To","Source port","Target port","Private notes"]];
  for(let i=0;i<n;i++)
    nodes.push([id(i),i?"endpoint.windows":"network.switch",
      "P4C2A_PRIVATE_DEVICE_CANARY_"+i]);
  for(let i=1;i<n;i++)
    links.push([id(i),id(0),"eth0",port(i),
      "P4C2A_PRIVATE_LINK_CANARY_"+i]);
  links.push([id(1),id(0),"eth1",port(n),
    "P4C2A_PRIVATE_PARALLEL_CANARY"]);
  assert.equal(nodes.length,n+1);
  assert.equal(links.length,n+1);
  return [nodes,links];
}
const columns=arr=>arr.map(cellOrdinal=>({cellOrdinal,acknowledge:true}));
const decision=(format,sourceSha256,tableOrdinal,rowStart,rowEnd,columnIds,overrides={})=>({
  format,sourceSha256,capacityProfile:V3,tableOrdinal,rowStart,rowEnd,
  columns:columns(columnIds),acknowledgeSelectedRange:true,
  acknowledgeDisclosure:true,...overrides
});
const decisions=(format,hash,n)=>[
  ...Array.from({length:Math.ceil(n/100)},(_,i)=>
    decision(format,hash,0,100*i+1,Math.min(n,100*(i+1)),[0,1])),
  ...Array.from({length:Math.ceil(n/100)},(_,i)=>
    decision(format,hash,1,100*i+1,Math.min(n,100*(i+1)),[0,1,2,3]))
];
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
const yes=(a,label)=>{assert.ok(a,label);checks++};
const deny=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);checks++};
eq(OFFICE_SCALED_BATCH_PROFILE_V3,V3,"new explicitly versioned 10k source-only profile");
const observations=[];
for(const [format,make] of [["docx",docx],["odt",odt]]){
  const t0=performance.now(),original=await make(sourceTables(N)),digest=sha(original);
  const frozen=Buffer.from(original);
  const grants=decisions(format,digest,N);
  eq(grants.length,200,format+" 100 node + 100 link independently acknowledged batches");
  eq(grants.filter(x=>x.tableOrdinal===0).length,100,format+" 100 distinct node grants");
  eq(grants.filter(x=>x.tableOrdinal===1).length,100,format+" 100 distinct link grants");
  yes(grants.every(d=>d.columns.every(c=>c.acknowledge===true) &&
      d.acknowledgeSelectedRange===true && d.acknowledgeDisclosure===true),
    format+" no automatic batch or column consent");
  const outputs=await revealReviewedOfficeBatchesV3(original,grants);
  eq(outputs.length,200,format+" 200 independent source disclosure results");
  eq(Buffer.from(original),frozen,format+" complete original ZIP remains unchanged");
  const fullRows=[[],[]],seenRanges=new Set();
  for(let i=0;i<outputs.length;i++){
    const output=outputs[i],grant=grants[i];
    eq(output.status,"REVEALED_UNVERIFIED",format+" source-only result "+i);
    eq(output.capacityProfile,V3,format+" exact v3 profile");
    eq(output.sourceSha256,digest,format+" original ZIP SHA");
    eq(output.tableOrdinal,grant.tableOrdinal,format+" original source table");
    eq(output.canActivate,false,format+" no Builder/Runtime approval");
    eq(output.engineVerified,false,format+" no Engine PASS");
    eq(output.physicalTopologyVerified,false,format+" no real cable PASS");
    eq(output.rows.length,grant.rowEnd-grant.rowStart+1,format+" correct selected row span");
    const span=grant.tableOrdinal+":"+grant.rowStart+"-"+grant.rowEnd;
    yes(!seenRanges.has(span),format+" no duplicate approved span");
    seenRanges.add(span);
    for(let j=0;j<output.rows.length;j++){
      const row=output.rows[j],ordinal=grant.rowStart+j;
      eq(row.rowOrdinal,ordinal,format+" exact original source row ordinal");
      eq(row.cells.length,grant.columns.length,format+" approved columns only");
      const expected=grant.tableOrdinal===0
        ?[id(ordinal-1),ordinal===1?"network.switch":"endpoint.windows"]
        :ordinal===N
          ?[id(1),id(0),"eth1",port(N)]
          :[id(ordinal),id(0),"eth0",port(ordinal)];
      eq(row.cells.map(c=>c.text),expected,
        format+" exact original data including independently declared link ports");
      for(let k=0;k<row.cells.length;k++){
        const l=row.cells[k].locator;
        eq([l.tableOrdinal,l.rowOrdinal,l.cellOrdinal,l.sourceSha256],
          [grant.tableOrdinal,ordinal,grant.columns[k].cellOrdinal,digest],
          format+" exact source ZIP-bound table/row/column locator");
      }
      fullRows[grant.tableOrdinal].push(row);
    }
  }
  eq(seenRanges.size,200,format+" 200 distinct original source intervals");
  eq(fullRows[0].length,N,format+" every consented original device row");
  eq(fullRows[1].length,N,format+" every consented original link row");
  const resultJson=JSON.stringify(outputs);
  yes(!resultJson.includes("P4C2A_PRIVATE_") &&
      !resultJson.includes("Private notes"),
    format+" no unselected private cell or private header disclosed");
  eq(fullRows[1][N-1].cells.map(c=>c.text),
    [id(1),id(0),"eth1",port(N)],format+" authentic final parallel original port pair");

  // All negatives use the same real 10k DOCX/ODT ZIP but should fail in a
  // cheap metadata/consent gate rather than parse 200 times.
  const mixed=grants.map((d,i)=>i===1?{...d,sourceSha256:"0".repeat(64)}:d);
  await deny(revealReviewedOfficeBatchesV3(original,mixed),
    "SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [...grants,grants[0]]),"SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [grants[0],grants[0]]),"SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],rowEnd:101}]),"SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],rowStart:10001,rowEnd:10001}]),"SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],acknowledgeDisclosure:false}]),"SCALE_P1B1_CONSENT_REQUIRED");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],columns:[{cellOrdinal:0,acknowledge:false}]}]),
    "SCALE_P1B1_CONSENT_REQUIRED");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],capacityProfile:"office.scaled-reviewed-batch.v2"}]),
    "SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],unexpected:true}]),"SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],columns:columns([0,1,2])}]),
    "SCALE_P1B1_SENSITIVE_BLOCKED");

  // Supplementary adversarial coverage added after implementation audit.
  // Existing independently frozen 10k positives and their original fixture
  // assertions remain unchanged. Use small REAL ZIPs for cheap denials.
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],columns:columns([16])}]),
    "SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [grants[1],grants[0]]),
    "SCALE_P1B1_SELECTION_INVALID");
  // All grants must declare the same source format; a single document
  // falsely labeled as the other Office type fails at original ZIP validation.
  await deny(revealReviewedOfficeBatchesV3(original,
    [grants[0],{...grants[1],format:format==="docx"?"odt":"docx"}]),
    "SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatchesV3(original,
    [{...grants[0],format:format==="docx"?"odt":"docx"}]),
    "SCALE_P1B1_SOURCE_BLOCKED");

  const smallOriginal=await make(sourceTables(100));
  const smallSha=sha(smallOriginal);
  const validSmallDecision=decision(format,smallSha,0,1,100,[0,1]);
  const alternateOriginal=await make(sourceTables(101));
  await deny(revealReviewedOfficeBatchesV3(alternateOriginal,
    [validSmallDecision]),"SCALE_P1B1_SOURCE_CHANGED");
  await deny(revealReviewedOfficeBatchesV3(
    smallOriginal.subarray(0,Math.floor(smallOriginal.length/2)),
    [validSmallDecision]),"SCALE_P1B1_SOURCE_BLOCKED");

  observations.push({format,gate:"10K_DOCX_ODT_OPTIN_BATCH_DISCLOSURE_SOURCE_ONLY",
    result:"REVEALED_UNVERIFIED",originalRowsPerTable:N,reviewedBatches:200,
    selectedCells:60000,sourceBytes:original.length,sourceSha256:digest,
    elapsedMs:Math.round(performance.now()-t0),
    processRssMiB:Math.round(process.memoryUsage().rss/1048576*100)/100,
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576*100)/100,
    builderVerified:false,mountedOfficeChromiumVerified:false,
    engineVerified:false,physicalNetworkVerified:false});
}
console.log("PASS SCALE-001 P4c2a FROZEN actual original DOCX/ODT 10000+10000 opt-in source disclosure: "+checks+" source-row/column/origin/adversarial assertions; "+JSON.stringify(observations));

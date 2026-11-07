import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";
import {revealReviewedOfficeBatch,OFFICE_SCALED_BATCH_PROFILE_V2} from
  "../../dist-browser-test/enterprise-import/src/office-large-batch-review.js";
import {mapReviewedOfficeBatchesToSource,OFFICE_SCALED_TOPOLOGY_PROFILE_V2} from
  "../../dist-browser-test/enterprise-import/src/office-large-reviewed-topology.js";

/**
 * SCALE-001 P3b frozen acceptance, committed BEFORE v2 product changes.
 * Genuine DOCX and ODT ZIP bytes with 5,000 source-declared IDs and 5,000
 * independently original, explicit source port-paired links. No 5k DOM/Builder
 * or physical topology claims; never turn a failed negative oracle into PASS.
 */
const enc=new TextEncoder(), zip=new ZipJsArchiveBackend();
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const batchV1="office.scaled-reviewed-batch.v1";
const batchV2="office.scaled-reviewed-batch.v2";
const topologyV1="office.scaled-reviewed-topology.v1";
const topologyV2="office.scaled-reviewed-topology.v2";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const P="http://schemas.openxmlformats.org/package/2006/relationships";
const T="http://schemas.openxmlformats.org/package/2006/content-types";
const M="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const R="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const escapeXml=v=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const cell=s=>'<w:tc><w:tcPr/><w:p><w:r><w:t>'+escapeXml(s)+'</w:t></w:r></w:p></w:tc>';
async function docx(tables) {
  const body='<w:document xmlns:w="'+W+'"><w:body>'+tables.map(rows=>
    '<w:tbl><w:tblPr/><w:tblGrid/>'+rows.map(row=>
      '<w:tr>'+row.map(cell).join("")+'</w:tr>').join("")+'</w:tbl>').join("")+
    '</w:body></w:document>';
  const parts={
    "[Content_Types].xml":'<Types xmlns="'+T+'"><Override PartName="/word/document.xml" ContentType="'+M+'"/></Types>',
    "_rels/.rels":'<Relationships xmlns="'+P+'"><Relationship Id="rId1" Type="'+R+'" Target="word/document.xml"/></Relationships>',
    "word/document.xml":body,
  };
  const blob=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:enc.encode(data)})));
  return new Uint8Array(await blob.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const col=cellOrdinal=>({cellOrdinal,acknowledge:true});
function sourceTables(n,{parallel=true}={}) {
  const nodes=[["Device ID","Canonical role","Private notes"]];
  const links=[["From","To","Source port","Target port","Private notes"]];
  for(let i=0;i<n;i++)nodes.push([id(i),i?"endpoint.windows":"network.switch",
    "P3B_PRIVATE_NODE_CANARY_"+i]);
  for(let i=1;i<n;i++)links.push([id(i),id(0),"eth0",port(i),
    "P3B_PRIVATE_LINK_CANARY_"+i]);
  if(parallel)links.push([id(1),id(0),"eth1",port(n),
    "P3B_PRIVATE_PARALLEL_CANARY"]);
  return [nodes,links];
}
const decisionBatch=(format,hash,tableOrdinal,rowStart,rowEnd,columns,overrides={})=>({
  format,sourceSha256:hash,capacityProfile:batchV2,tableOrdinal,rowStart,rowEnd,
  columns:columns.map(col),acknowledgeSelectedRange:true,acknowledgeDisclosure:true,
  ...overrides,
});
const batches=(format,hash,tableOrdinal,count,columns)=>
  Array.from({length:Math.ceil(count/100)},(_,i)=>
    decisionBatch(format,hash,tableOrdinal,1+i*100,Math.min(count,100*(i+1)),columns));
const decision=(format,hash,n,linkCount=n)=>({
  capacityProfile:topologyV2,format,sourceSha256:hash,
  nodeBatches:batches(format,hash,0,n,[0,1]),
  linkBatches:batches(format,hash,1,linkCount,[0,1,2,3]),
  acknowledgeModeledResources:true,acknowledgeModeledConnections:true,
});
let checks=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++};
const yes=(a,message)=>{assert.ok(a,message);checks++};
const deny=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);checks++};
eq(OFFICE_SCALED_BATCH_PROFILE_V2,batchV2,"explicit new batch profile, frozen before production");
eq(OFFICE_SCALED_TOPOLOGY_PROFILE_V2,topologyV2,"explicit new topology profile, frozen before production");
const observations=[];
for(const [format,make] of [["docx",docx],["odt",odt]]) {
  const start=performance.now(),raw=await make(sourceTables(5000)),hash=sha(raw);
  const d=decision(format,hash,5000,5000);
  eq(d.nodeBatches.length,50,format+" fifty separate device decisions");
  eq(d.linkBatches.length,50,format+" fifty separate source Links decisions");
  const last=await revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4901,5000,[0,1]));
  eq(last.status,"REVEALED_UNVERIFIED",format+" selected source-only tail");
  eq(last.rows.length,100,format+" exact bounded last batch");
  eq(last.rows[99].cells.map(c=>c.text),[id(4999),"endpoint.windows"],
    format+" exact approved last source node");
  eq([last.rows[99].cells[0].locator.tableOrdinal,
      last.rows[99].cells[0].locator.rowOrdinal,
      last.rows[99].cells[0].locator.cellOrdinal,
      last.rows[99].cells[0].locator.sourceSha256],[0,5000,0,hash],
    format+" original ZIP-bound last device locator");
  yes(!JSON.stringify(last).includes("P3B_PRIVATE_"),format+" no private canary from batch");
  await deny(revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4901,5000,[0,1],
    {capacityProfile:batchV1})),"SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4901,5000,[0,1],
    {unexpected:true})),"SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4901,5000,[0,1],
    {acknowledgeDisclosure:false})),"SCALE_P1B1_CONSENT_REQUIRED");
  await deny(revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4901,5000,[0,1],
    {sourceSha256:"0".repeat(64)})),"SCALE_P1B1_SOURCE_CHANGED");
  await deny(revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4900,5000,[0,1])),
    "SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4901,5001,[0,1])),
    "SCALE_P1B1_SELECTION_INVALID");
  await deny(revealReviewedOfficeBatch(raw,decisionBatch(format,hash,0,4901,5000,[2])),
    "SCALE_P1B1_SENSITIVE_BLOCKED");

  const mapped=await mapReviewedOfficeBatchesToSource(raw,d);
  eq(mapped.status,"READY_FOR_COMPILATION",format+" candidate only");
  eq(mapped.profileId,topologyV2,format+" exact v2 profile");
  eq(mapped.sourceSha256,hash,format+" immutable original SHA");
  eq(mapped.source.resources.length,5000,format+" exact original node count");
  eq(mapped.source.connections.length,5000,format+" exact independently original links");
  eq(mapped.origins.nodes.length,5000,format+" every original node locator retained");
  eq(mapped.origins.links.length,5000,format+" every original link locator retained");
  eq(mapped.source.resources[0].id,id(0),format+" first original source ID");
  eq(mapped.source.resources[4999].id,id(4999),format+" last original source ID");
  eq(mapped.source.connections[4999].id,"office_link_t1_r5000",
    format+" last original row-linked port-distinct edge identity");
  eq([mapped.source.connections[4999].from.resource,
      mapped.source.connections[4999].from.port,
      mapped.source.connections[4999].to.resource,
      mapped.source.connections[4999].to.port],[id(1),"eth1",id(0),port(5000)],
    format+" source-verified parallel link port pair, not inferred");
  eq([mapped.origins.links[4999].sourcePortLocator.rowOrdinal,
      mapped.origins.links[4999].sourcePortLocator.cellOrdinal,
      mapped.origins.links[4999].sourcePortLocator.sourceSha256],
     [5000,2,hash],format+" exact original last source link locator");
  eq(new Set(mapped.source.resources.map(n=>n.id)).size,5000,
    format+" no duplicate/phantom node");
  eq(new Set(mapped.source.connections.map(e=>e.id)).size,5000,
    format+" no duplicate/phantom link ID");
  eq(mapped.source.tests,[],format+" no invented Engine probe");
  eq(mapped.canActivate,false,format+" no automatic Builder activation");
  eq(mapped.engineVerified,false,format+" no Engine PASS");
  eq(mapped.physicalTopologyVerified,false,format+" no physical link PASS");
  yes(!JSON.stringify(mapped).includes("P3B_PRIVATE_"),format+" private source columns never mapped");
  observations.push({format,sourceZipBytes:raw.length,sourceSha256:hash,
    elapsedMs:Math.round(performance.now()-start),
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576)});

  // Cheap v2 validation negatives must fail before any 5k source materialization.
  await deny(mapReviewedOfficeBatchesToSource(raw,{...d,capacityProfile:topologyV1}),
    "SCALE_P1B2_SELECTION_INVALID");
  await deny(mapReviewedOfficeBatchesToSource(raw,{...d,
    nodeBatches:d.nodeBatches.slice(0,49)}),"SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await deny(mapReviewedOfficeBatchesToSource(raw,{...d,
    nodeBatches:[d.nodeBatches[0],...d.nodeBatches]}),
    "SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await deny(mapReviewedOfficeBatchesToSource(raw,{...d,
    linkBatches:[...d.linkBatches].reverse()}),"SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await deny(mapReviewedOfficeBatchesToSource(raw,{...d,sourceSha256:"0".repeat(64)}),
    "SCALE_P1B2_SOURCE_CHANGED");
  await deny(mapReviewedOfficeBatchesToSource(raw,{...d,
    acknowledgeModeledConnections:false}),"SCALE_P1B2_CONSENT_REQUIRED");
  await deny(mapReviewedOfficeBatchesToSource(raw,{...d,unexpected:"extra"}),
    "SCALE_P1B2_SELECTION_INVALID");

  // Small original ZIP adversarial sources independently exercise mapping semantics.
  for(const [kind,mutate,expected] of [
    ["duplicate node",t=>{t[0][2][0]=id(0)},"SCALE_P1B2_DUPLICATE_NODE_ID"],
    ["unknown endpoint",t=>{t[1][2][1]="unknown999"},"SCALE_P1B2_LINK_ENDPOINT_UNKNOWN"],
    ["reused endpoint-port",t=>{t[1][2][3]=port(1)},"SCALE_P1B2_PORT_REUSED"],
    ["unsupported role",t=>{t[0][2][1]="unapproved.role"},"SCALE_P1B2_ROLE_UNSUPPORTED"],
    ["selected credential header",t=>{t[0][0][1]="Password"},"SCALE_P1B2_SOURCE_BLOCKED"],
  ]) {
    const t=sourceTables(100),_ = mutate(t),bytes=await make(t),digest=sha(bytes);
    await deny(mapReviewedOfficeBatchesToSource(bytes,decision(format,digest,100,100)),expected);
  }
}
console.log("PASS SCALE-001 P3b frozen real original DOCX/ODT 5000+5000 source-only review: "+
  checks+" positive/negative assertions; "+JSON.stringify(observations)+
  "; no 5k Builder/Chromium/Engine/physical PASS");

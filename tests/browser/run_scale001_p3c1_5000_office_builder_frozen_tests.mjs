import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import {ENGINE_VERSION} from "../../dist-browser-test/engine/src/index.js";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";
import {mapReviewedOfficeBatchesToSource} from
  "../../dist-browser-test/enterprise-import/src/office-large-reviewed-topology.js";
import {createBuilderWorkspace,compileBuilderWorkspace} from
  "../../dist-browser-test/ui/src/browser/index.js";

/**
 * SCALE-001 P3c1 independent frozen-first 5000/5000 genuine DOCX/ODT
 * source → actual editable Builder compile. No live mounted DOM, ELK 5k
 * projection, physical cable or Engine PASS. All original rows are separately
 * consented in 50 device + 50 Links 100-row windows.
 */
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const cell=s=>'<w:tc><w:tcPr/><w:p><w:r><w:t>'+esc(s)+'</w:t></w:r></w:p></w:tc>';
async function docx(tables) {
  const body='<w:document xmlns:w="'+W+'"><w:body>'+tables.map(rows=>
    '<w:tbl><w:tblPr/><w:tblGrid/>'+rows.map(row=>
      '<w:tr>'+row.map(cell).join("")+'</w:tr>').join("")+'</w:tbl>').join("")+
    '</w:body></w:document>';
  const parts={
    "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
    "_rels/.rels":'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>',
    "word/document.xml":body,
  };
  const blob=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:enc.encode(data)})));
  return new Uint8Array(await blob.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
function original(n=5000) {
  const nodes=[["Device ID","Canonical source role","Private notes"]];
  const links=[["From","To","Source port","Target port","Private notes"]];
  for(let i=0;i<n;i++)nodes.push([id(i),i?"endpoint.windows":"network.switch",
    "P3C_PRIVATE_DEVICE_CANARY_"+i]);
  for(let i=1;i<n;i++)links.push([id(i),id(0),"eth0",port(i),
    "P3C_PRIVATE_LINK_CANARY_"+i]);
  // An actual second original source row for a parallel link: no inferred edge.
  links.push([id(1),id(0),"eth1",port(n),"P3C_PRIVATE_PARALLEL_CANARY"]);
  assert.equal(nodes.length,5001);
  assert.equal(links.length,5001);
  return [nodes,links];
}
const bProfile="office.scaled-reviewed-batch.v2";
const tProfile="office.scaled-reviewed-topology.v2";
const batch=(format,hash,tableOrdinal,start,end,columns)=>({
  format,sourceSha256:hash,capacityProfile:bProfile,tableOrdinal,
  rowStart:start,rowEnd:end,
  columns:columns.map(cellOrdinal=>({cellOrdinal,acknowledge:true})),
  acknowledgeSelectedRange:true,acknowledgeDisclosure:true,
});
const ranges=(format,hash,tableOrdinal,columns)=>
  Array.from({length:50},(_,i)=>
    batch(format,hash,tableOrdinal,i*100+1,(i+1)*100,columns));
const decision=(format,hash)=>({
  capacityProfile:tProfile,format,sourceSha256:hash,
  nodeBatches:ranges(format,hash,0,[0,1]),
  linkBatches:ranges(format,hash,1,[0,1,2,3]),
  acknowledgeModeledResources:true,acknowledgeModeledConnections:true,
});
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const sourceValidate=ajv.compile(sourceSchema);
const normalizedValidate=ajv.compile(normalizedSchema);
const validate=f=>v=>({valid:!!f(v),diagnostics:(f.errors??[]).map(e=>e.message)});
const options={compilerContext:{
  validateSource:validate(sourceValidate),
  validateNormalized:validate(normalizedValidate),
  catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
  engineBaselineVersion:ENGINE_VERSION,
}};
let checked=0;
const eq=(got,want,label)=>{assert.deepEqual(got,want,label);checked++};
const yes=(condition,label)=>{assert.ok(condition,label);checked++};
const rejected=async(work,code)=>{await assert.rejects(work,e=>e?.code===code,code);checked++};
const measurements=[];
for(const [format,make] of [["docx",docx],["odt",odt]]) {
  const begin=performance.now(),sourceZip=await make(original()),fullSHA=sha(sourceZip);
  const grant=decision(format,fullSHA);
  eq(grant.nodeBatches.length,50,format+" 50 distinct original device grants");
  eq(grant.linkBatches.length,50,format+" 50 distinct original link grants");
  const candidate=await mapReviewedOfficeBatchesToSource(sourceZip,grant);
  eq(candidate.status,"READY_FOR_COMPILATION",format+" source-only candidate");
  eq(candidate.sourceSha256,fullSHA,format+" original ZIP SHA");
  eq(candidate.profileId,tProfile,format+" distinct v2 topology profile");
  eq(candidate.canActivate,false,format+" no automatic activation");
  eq(candidate.engineVerified,false,format+" no Engine PASS");
  eq(candidate.physicalTopologyVerified,false,format+" no physical network PASS");
  eq(candidate.source.resources.length,5000,format+" exact 5000 source devices");
  eq(candidate.source.connections.length,5000,format+" exact 5000 explicit Links");
  eq(candidate.origins.nodes.length,5000,format+" every source node locator");
  eq(candidate.origins.links.length,5000,format+" every source link locator");
  eq(candidate.origins.nodes[4999].idLocator.rowOrdinal,5000,
    format+" last original device row ordinal");
  eq(candidate.origins.links[4999].sourcePortLocator.rowOrdinal,5000,
    format+" last original link source row");
  eq(candidate.origins.links[4999].targetPortLocator.cellOrdinal,3,
    format+" original target-port cell");
  yes(candidate.origins.nodes.every(x=>x.idLocator.sourceSha256===fullSHA),
    format+" all source node locators bound to original ZIP");
  yes(candidate.origins.links.every(x=>x.fromLocator.sourceSha256===fullSHA&&
    x.toLocator.sourceSha256===fullSHA&&
    x.sourcePortLocator.sourceSha256===fullSHA&&
    x.targetPortLocator.sourceSha256===fullSHA),
    format+" all link and port locators bound to original ZIP");
  const frozenSource=JSON.stringify(candidate.source);
  yes(!frozenSource.includes("P3C_PRIVATE_"),format+" private source notes omitted");
  yes(sourceValidate(candidate.source),format+" valid actual source schema");
  const workspace=createBuilderWorkspace(candidate.source);
  eq(workspace.source.resources.length,5000,format+" actual editable Builder source nodes");
  eq(workspace.source.connections.length,5000,format+" actual editable Builder source links");
  const compiled=await compileBuilderWorkspace(workspace,options);
  eq(compiled.compile.status,"valid",format+" actual production Builder compiler valid");
  eq(compiled.source.resources.length,5000,format+" compiled workspace retains all nodes");
  eq(compiled.source.connections.length,5000,format+" compiled workspace retains all links");
  eq(compiled.compile.model.resources.length,5000,format+" complete normalized nodes");
  eq(compiled.compile.model.connections.length,5000,format+" complete normalized connections");
  eq(compiled.source.resources.map(x=>x.id),
    Array.from({length:5000},(_,i)=>id(i)),
    format+" no missing, extra or reordered original nodes");
  eq(compiled.source.connections.map(x=>x.id),
    Array.from({length:5000},(_,i)=>"office_link_t1_r"+(i+1)),
    format+" stable separate original source Links row identities");
  eq(compiled.source.connections.map(x=>[x.from.resource,x.from.port,x.to.resource,x.to.port]),
    [
      ...Array.from({length:4999},(_,i)=>[id(i+1),"eth0",id(0),port(i+1)]),
      [id(1),"eth1",id(0),port(5000)]
    ],format+" all 5000 original port pairs preserved exactly");
  eq(compiled.compile.model.connections.map(x=>x.id),
    compiled.source.connections.map(x=>x.id),format+" exact normalized link IDs");
  eq(compiled.compile.model.connections.map(x=>[x.from.resource,x.from.port,x.to.resource,x.to.port]),
    compiled.source.connections.map(x=>[x.from.resource,x.from.port,x.to.resource,x.to.port]),
    format+" compiler exact link port identity");
  eq(compiled.source.resources[0].interfaces.length,5000,
    format+" original high-degree core retains distinct 5000 original ports");
  eq(new Set(compiled.source.resources[0].interfaces.map(x=>x.id)).size,5000,
    format+" no core interface alias collapse");
  yes(!JSON.stringify(compiled.source).includes("P3C_PRIVATE_"),
    format+" no unselected private note in compiled Builder");
  eq(JSON.stringify(candidate.source),frozenSource,
    format+" source candidate remained unchanged through Builder compilation");
  eq(compiled.source.tests,[],format+" no invented Engine test cases");

  // Rejected grants must not yield any editable/active Builder candidate.
  await rejected(mapReviewedOfficeBatchesToSource(sourceZip,{
    ...grant,nodeBatches:grant.nodeBatches.slice(0,49)
  }),"SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await rejected(mapReviewedOfficeBatchesToSource(sourceZip,{
    ...grant,linkBatches:grant.linkBatches.slice(0,49)
  }),"SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await rejected(mapReviewedOfficeBatchesToSource(sourceZip,{
    ...grant,sourceSha256:"0".repeat(64)
  }),"SCALE_P1B2_SOURCE_CHANGED");
  await rejected(mapReviewedOfficeBatchesToSource(sourceZip,{
    ...grant,acknowledgeModeledConnections:false
  }),"SCALE_P1B2_CONSENT_REQUIRED");
  const stale=Uint8Array.from(sourceZip);
  stale[stale.length-1]^=1;
  await rejected(mapReviewedOfficeBatchesToSource(stale,grant),
    "SCALE_P1B2_SOURCE_CHANGED");
  measurements.push({format,originalZipBytes:sourceZip.length,originalZipSha256:fullSHA,
    elapsedMs:Math.round(performance.now()-begin),
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576),
    sourceDevices:5000,sourcePortPairedLinks:5000,
    builderCompileVerified:true,realDomVerified:false,engineVerified:false,
    physicalTopologyVerified:false});
}
console.log("PASS SCALE-001 P3c1 genuine original DOCX/ODT source 5000/5000 "+
  "to production editable Builder compile; "+checked+
  " independent source/port/compile/security assertions; "+
  JSON.stringify(measurements)+
  "; 5k mounted DOM/ReactFlow/ELK/Engine/physical network NOT VERIFIED");

import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import {ENGINE_VERSION} from "../../dist-browser-test/engine/src/index.js";
import {createBuilderWorkspace,compileBuilderWorkspace} from
  "../../dist-browser-test/ui/src/browser/index.js";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";
import {mapReviewedOfficeBatchesV3ToSource,OFFICE_SCALED_TOPOLOGY_PROFILE_V3} from
  "../../dist-browser-test/enterprise-import/src/office-large-reviewed-topology.js";

/** P4c2b independent FROZEN-FIRST 10k DOCX/ODT original ZIP to actual
 * canonical Builder compiler; no real UI disclosure, ELK, Engine/physical.
 */
const N=10000,E=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=b=>createHash("sha256").update(b).digest("hex");
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const cell=s=>"<w:tc><w:tcPr/><w:p><w:r><w:t>"+esc(s)+"</w:t></w:r></w:p></w:tc>";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const P="http://schemas.openxmlformats.org/package/2006/relationships";
const T="http://schemas.openxmlformats.org/package/2006/content-types";
const M="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const R="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
async function docx(tables){
  const body='<w:document xmlns:w="'+W+'"><w:body>'+tables.map(rows=>
    "<w:tbl><w:tblPr/><w:tblGrid/>"+rows.map(row=>
      "<w:tr>"+row.map(cell).join("")+"</w:tr>").join("")+"</w:tbl>").join("")+
    "</w:body></w:document>";
  const members={
    "[Content_Types].xml":'<Types xmlns="'+T+'"><Override PartName="/word/document.xml" ContentType="'+M+'"/></Types>',
    "_rels/.rels":'<Relationships xmlns="'+P+'"><Relationship Id="rId1" Type="'+R+'" Target="word/document.xml"/></Relationships>',
    "word/document.xml":body
  };
  const blob=await zip.write(Object.entries(members).map(([path,data])=>({path,bytes:E.encode(data)})));
  return new Uint8Array(await blob.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
function tables(n){
  const nodes=[["Device ID","Canonical role","Private notes"]];
  const links=[["From","To","Source port","Target port","Private notes"]];
  for(let i=0;i<n;i++)nodes.push([id(i),i?"endpoint.windows":"network.switch",
    "P4C2B_PRIVATE_NODE_CANARY_"+i]);
  for(let i=1;i<n;i++)links.push([id(i),id(0),"eth0",port(i),
    "P4C2B_PRIVATE_LINK_CANARY_"+i]);
  links.push([id(1),id(0),"eth1",port(n),
    "P4C2B_PRIVATE_PARALLEL_CANARY"]);
  return [nodes,links];
}
const V3="office.scaled-reviewed-topology.v3",BV3="office.scaled-reviewed-batch.v3";
const grant=(format,hash,tableOrdinal,i,cols)=>({
  format,sourceSha256:hash,capacityProfile:BV3,tableOrdinal,
  rowStart:i*100+1,rowEnd:(i+1)*100,
  columns:cols.map(cellOrdinal=>({cellOrdinal,acknowledge:true})),
  acknowledgeSelectedRange:true,acknowledgeDisclosure:true
});
const decision=(format,sourceSha256)=>({
  capacityProfile:V3,format,sourceSha256,
  nodeBatches:Array.from({length:100},(_,i)=>grant(format,sourceSha256,0,i,[0,1])),
  linkBatches:Array.from({length:100},(_,i)=>grant(format,sourceSha256,1,i,[0,1,2,3])),
  acknowledgeModeledResources:true,acknowledgeModeledConnections:true
});
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const sourceSchema=ajv.compile(schema),normalizedCheck=ajv.compile(normalizedSchema);
const validate=fn=>obj=>({valid:!!fn(obj),diagnostics:(fn.errors??[]).map(e=>e.message)});
const options={compilerContext:{
  validateSource:validate(sourceSchema),validateNormalized:validate(normalizedCheck),
  catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
  engineBaselineVersion:ENGINE_VERSION
}};
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
const yes=(a,label)=>{assert.ok(a,label);checks++};
const deny=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);checks++};
eq(OFFICE_SCALED_TOPOLOGY_PROFILE_V3,V3,"new exact 10k canonical source profile export");
const observations=[];
for(const [format,make] of [["docx",docx],["odt",odt]]){
  const start=performance.now(),raw=await make(tables(N)),hash=sha(raw);
  const frozen=Buffer.from(raw),d=decision(format,hash);
  eq(d.nodeBatches.length,100,format+" 100 affirmative device grants");
  eq(d.linkBatches.length,100,format+" 100 affirmative Links grants");
  const mapped=await mapReviewedOfficeBatchesV3ToSource(raw,d);
  eq(Buffer.from(raw),frozen,format+" full source bytes unchanged");
  eq(mapped.status,"READY_FOR_COMPILATION",format+" no automatic Builder activation");
  eq(mapped.profileId,V3,format+" exact distinct topology profile");
  eq(mapped.sourceSha256,hash,format+" immutable source SHA");
  eq(mapped.canActivate,false,format+" candidate is not activated");
  eq(mapped.engineVerified,false,format+" cannot infer Engine PASS");
  eq(mapped.physicalTopologyVerified,false,format+" cannot infer physical cables");
  eq(mapped.source.resources.length,N,format+" exactly 10000 original devices");
  eq(mapped.source.connections.length,N,format+" exactly 10000 original link rows");
  eq(mapped.origins.nodes.length,N,format+" original device locators all present");
  eq(mapped.origins.links.length,N,format+" original link locators all present");
  eq(new Set(mapped.source.resources.map(x=>x.id)).size,N,format+" no node ID loss");
  eq(new Set(mapped.source.connections.map(x=>x.id)).size,N,format+" no link ID loss");
  eq(mapped.source.tests,[],format+" no invented Engine test");
  eq(mapped.source.completion.path,"imported_topology_manual_verification",
    format+" no network reachability inferred from imported source");
  for(let i=0;i<N;i++){
    const node=mapped.source.resources[i],link=mapped.source.connections[i];
    const no=mapped.origins.nodes[i],lo=mapped.origins.links[i];
    eq(node.id,id(i),format+" exact original resource row "+i);
    eq(node.type,i?"endpoint.windows":"network.switch",format+" approved original canonical role");
    eq(no.nodeId,id(i),format+" original resource provenance identity");
    eq([no.idLocator.tableOrdinal,no.idLocator.rowOrdinal,
      no.idLocator.cellOrdinal,no.idLocator.sourceSha256],
      [0,i+1,0,hash],format+" source-bound device ID locator");
    eq([no.roleLocator.tableOrdinal,no.roleLocator.rowOrdinal,
      no.roleLocator.cellOrdinal,no.roleLocator.sourceSha256],
      [0,i+1,1,hash],format+" source-bound role locator");
    eq(link.id,"office_link_t1_r"+(i+1),format+" exact original link identity");
    const from=i===N-1?id(1):id(i+1);
    const fromPort=i===N-1?"eth1":"eth0",targetPort=port(i+1);
    eq([link.from.resource,link.from.port,link.to.resource,link.to.port],
      [from,fromPort,id(0),targetPort],format+" source-original port-paired endpoints");
    eq(lo.linkId,link.id,format+" original link provenance identity");
    for(const [loc,col] of [
      [lo.fromLocator,0],[lo.toLocator,1],
      [lo.sourcePortLocator,2],[lo.targetPortLocator,3]
    ]){
      eq([loc.tableOrdinal,loc.rowOrdinal,loc.cellOrdinal,loc.sourceSha256],
        [1,i+1,col,hash],format+" immutable original port-bearing cell locator");
    }
  }
  yes(sourceSchema(mapped.source),format+" canonical validated original source");
  yes(!JSON.stringify(mapped).includes("P4C2B_PRIVATE_"),
    format+" no raw unselected private source cell");
  const before=performance.now();
  const compiled=await compileBuilderWorkspace(createBuilderWorkspace(mapped.source),options);
  const compilerMs=Math.round(performance.now()-before);
  eq(compiled.compile.status,"valid",
    format+" normalized actual Builder compiler: "+JSON.stringify(compiled.compile.diagnostics?.slice(0,3)));
  eq(compiled.compile.model.resources.length,N,format+" normalized node count");
  eq(compiled.compile.model.connections.length,N,format+" normalized link count");
  eq(compiled.compile.model.connections.map(e=>[
    e.id,e.from.resource,e.from.port,e.to.resource,e.to.port
  ]),mapped.source.connections.map(e=>[
    e.id,e.from.resource,e.from.port,e.to.resource,e.to.port
  ]),format+" all 10000 port-paired identities unchanged by compiler");
  yes(normalizedCheck(compiled.compile.model),format+" production normalized schema");
  eq(compiled.source.resources.map(x=>x.id),
    mapped.source.resources.map(x=>x.id),format+" all editable full Builder IDs retained");
  eq(compiled.source.connections.map(x=>x.id),
    mapped.source.connections.map(x=>x.id),format+" full editable source link IDs retained");

  // Cheap negatives on the genuine 10k original must fail before any source
  // disclosure or canonical mapping, without extra 10k ZIP reparses.
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,acknowledgeModeledConnections:false}),"SCALE_P1B2_CONSENT_REQUIRED");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,unexpected:true}),"SCALE_P1B2_SELECTION_INVALID");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,capacityProfile:"office.scaled-reviewed-topology.v2"}),
    "SCALE_P1B2_SELECTION_INVALID");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,nodeBatches:d.nodeBatches.slice(0,99)}),
    "SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,linkBatches:[d.linkBatches[1],d.linkBatches[0],...d.linkBatches.slice(2)]}),
    "SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,nodeBatches:[d.nodeBatches[0],d.nodeBatches[0],...d.nodeBatches.slice(2)]}),
    "SCALE_P1B2_BATCH_COVERAGE_INVALID");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,linkBatches:d.linkBatches.map((g,i)=>i===8
      ?{...g,sourceSha256:"0".repeat(64)}:g)}),
    "SCALE_P1B2_SELECTION_INVALID");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,nodeBatches:d.nodeBatches.map((g,i)=>i===3
      ?{...g,columns:[...g.columns,{cellOrdinal:2,acknowledge:true}]}:g)}),
    "SCALE_P1B2_SELECTION_INVALID");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,nodeBatches:d.nodeBatches.map((g,i)=>i===3
      ?{...g,acknowledgeDisclosure:false}:g)}),
    "SCALE_P1B2_CONSENT_REQUIRED");
  await deny(mapReviewedOfficeBatchesV3ToSource(raw,{
    ...d,sourceSha256:"0".repeat(64)}),
    "SCALE_P1B2_SOURCE_CHANGED");
  observations.push({format,status:"READY_FOR_COMPILATION",
    originalSourceZipSha256:hash,originalSourceZipBytes:raw.length,
    declaredOriginalNodes:N,declaredOriginalPortPairedLinks:N,
    sourceOriginNodes:N,sourceOriginLinks:N,approvedSourceRowBatches:200,
    compilerMs,totalMs:Math.round(performance.now()-start),
    rssMiB:Math.round(process.memoryUsage().rss/1048576*100)/100,
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576*100)/100,
    mountedOfficeChromiumVerified:false,engineVerified:false,
    physicalTopologyVerified:false});
}
console.log("PASS SCALE-001 P4c2b FROZEN real DOCX/ODT original 10000 source nodes + 10000 source port links → canonical candidate and actual Builder compiler; "+checks+" identity/consent assertions; "+JSON.stringify(observations)+"; no mounted Office DOM, Runtime, Engine or physical claim");

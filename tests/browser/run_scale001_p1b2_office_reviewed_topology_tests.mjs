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
import {createBuilderWorkspace,compileBuilderWorkspace} from "../../dist-browser-test/ui/src/browser/index.js";
import {mapReviewedOfficeBatchesToSource,OFFICE_SCALED_TOPOLOGY_PROFILE} from
  "../../dist-browser-test/enterprise-import/src/office-large-reviewed-topology.js";

// SCALE-001 P1b2: original source->typed Builder, not a 1000-node
// real mounted Chromium DOM or evidence of independently tested physical links.
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const SHA=b=>createHash("sha256").update(b).digest("hex");
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
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
function fixture(n,{parallel=false}={}){
 const nodes=[["Device ID","Device Role","Private Notes"],[id(0),"network.switch","PRIVATE_NODE_CANARY_932_0"]];
 for(let i=1;i<n;i++)nodes.push([id(i),"endpoint.windows","PRIVATE_NODE_CANARY_932_"+i]);
 const links=[["From","To","Source Port","Target Port","Private Notes"]];
 for(let i=1;i<n;i++)links.push([id(i),id(0),"eth0",port(i),"PRIVATE_LINK_CANARY_836_"+i]);
 if(parallel)links.push([id(1),id(0),"eth1",port(n),"PRIVATE_PARALLEL_CANARY_345"]);
 return [nodes,links];
}
const batchProfile="office.scaled-reviewed-batch.v1";
const cap="office.scaled-reviewed-topology.v1";
const batch=(format,sha,tableOrdinal,start,end,columns)=>({
 format,sourceSha256:sha,capacityProfile:batchProfile,
 tableOrdinal,rowStart:start,rowEnd:end,
 columns:columns.map(cellOrdinal=>({cellOrdinal,acknowledge:true})),
 acknowledgeSelectedRange:true,acknowledgeDisclosure:true
});
const batches=(format,sha,tableOrdinal,count,cols)=>
 Array.from({length:Math.ceil(count/100)},(_,i)=>
  batch(format,sha,tableOrdinal,i*100+1,Math.min(count,(i+1)*100),cols));
const decision=(format,sha,n,links=n-1)=>({
 format,sourceSha256:sha,capacityProfile:cap,
 nodeBatches:batches(format,sha,0,n,[0,1]),
 linkBatches:batches(format,sha,1,links,[0,1,2,3]),
 acknowledgeModeledResources:true,acknowledgeModeledConnections:true
});
let count=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);count++};
const yes=(a,msg)=>{assert.ok(a,msg);count++};
const reject=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);count++};
eq(OFFICE_SCALED_TOPOLOGY_PROFILE,cap,"explicit versioned candidate");
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const checkSource=ajv.compile(sourceSchema),checkModel=ajv.compile(normalizedSchema);
const validate=f=>x=>({valid:!!f(x),diagnostics:(f.errors??[]).map(e=>e.message)});
const options={compilerContext:{validateSource:validate(checkSource),
 validateNormalized:validate(checkModel),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION}};
const measures=[];
for(const [format,make] of [["docx",docx],["odt",odt]]){
 for(const n of [100,1000]){
  const raw=await make(fixture(n)),sha=SHA(raw),d=decision(format,sha,n);
  const start=performance.now();
  const candidate=await mapReviewedOfficeBatchesToSource(raw,d);
  eq(candidate.status,"READY_FOR_COMPILATION",format+" exact approved original source");
  eq(candidate.sourceSha256,sha,format+" exact source SHA");
  eq(candidate.canActivate,false,format+" explicit Builder review still required");
  eq(candidate.engineVerified,false,format+" no false Engine PASS");
  eq(candidate.physicalTopologyVerified,false,format+" no false physical verification");
  eq(candidate.source.resources.length,n,format+" exact device count");
  eq(candidate.source.connections.length,n-1,format+" exact original link count");
  const expectedIds=Array.from({length:n},(_,i)=>id(i));
  eq(candidate.source.resources.map(r=>r.id),expectedIds,format+" original node IDs/order");
  eq(candidate.source.resources.map(r=>r.type),
    ["network.switch",...Array.from({length:n-1},()=>"endpoint.windows")],
    format+" source-declared role without inference");
  yes(candidate.source.resources.slice(1).every(r=>
    r.interfaces?.length===1&&r.interfaces[0].id==="eth0"),format+" 999 original host ports");
  const core=candidate.source.resources[0];
  eq(core.interfaces?.map(p=>p.id),
    Array.from({length:n-1},(_,i)=>port(i+1)),
    format+" distinct 999 exact source-authorized core ports");
  eq(candidate.source.connections.map(x=>[x.from.resource,x.from.port,x.to.resource,x.to.port]),
    Array.from({length:n-1},(_,i)=>[id(i+1),"eth0",id(0),port(i+1)]),
    format+" original endpoints, exact port pair and order");
  eq(new Set(candidate.source.connections.map(x=>x.id)).size,n-1,
    format+" original row-linked unique stable link IDs");
  eq(candidate.source.tests,[],format+" no physical link test invented");
  eq(candidate.source.completion.path,"imported_topology_manual_verification",
    format+" independent manual review gate remains unset");
  yes(!candidate.source.resources.some(x=>
    Object.hasOwn(x.properties??{},"imported_topology_manual_verification")),
    format+" no fabricated review PASS");
  eq(candidate.origins.nodes.length,n,format+" every node source locator preserved");
  eq(candidate.origins.links.length,n-1,format+" every explicit edge source locator preserved");
  yes(candidate.origins.nodes.every((o,i)=>o.nodeId===id(i)&&
    o.idLocator.sourceSha256===sha&&o.idLocator.tableOrdinal===0&&
    o.idLocator.rowOrdinal===i+1&&o.idLocator.cellOrdinal===0&&
    o.roleLocator.sourceSha256===sha),format+" full node SHA and table-row provenance");
  yes(candidate.origins.links.every((o,i)=>o.linkId===candidate.source.connections[i].id&&
    o.fromLocator.sourceSha256===sha&&o.fromLocator.tableOrdinal===1&&
    o.fromLocator.rowOrdinal===i+1&&o.fromLocator.cellOrdinal===0&&
    o.toLocator.cellOrdinal===1&&o.sourcePortLocator.cellOrdinal===2&&
    o.targetPortLocator.cellOrdinal===3),format+" full edge and port source provenance");
  const repr=JSON.stringify(candidate);
  yes(!repr.includes("PRIVATE_NODE_CANARY_") &&
      !repr.includes("PRIVATE_LINK_CANARY_") &&
      !repr.includes("Private Notes"),format+" no unselected private source values");
  yes(checkSource(candidate.source),format+" actual source schema: "+JSON.stringify(checkSource.errors));
  const workspace=createBuilderWorkspace(candidate.source);
  eq(workspace.source.resources.length,n,format+" Builder retains every original device");
  eq(workspace.source.connections.length,n-1,format+" Builder retains exact original edges");
  const compiled=await compileBuilderWorkspace(workspace,options);
  eq(compiled.compile.status,"valid",format+" actual Builder compiler "+JSON.stringify(compiled.compile.diagnostics?.slice(0,3)));
  eq(compiled.source.connections.map(c=>[c.from.resource,c.from.port,c.to.resource,c.to.port]),
    candidate.source.connections.map(c=>[c.from.resource,c.from.port,c.to.resource,c.to.port]),
    format+" compiled Builder retains all port pairs without changing original roles");
  measures.push({format,nodes:n,links:n-1,originalBytes:raw.byteLength,
    elapsedMs:Math.round(performance.now()-start),heapMiB:Math.round(process.memoryUsage().heapUsed/1048576)});
 }
 // All negative oracles start from a genuine original and explicit consent.
 const good=fixture(100),raw=await make(good),sha=SHA(raw),d=decision(format,sha,100);
 await reject(mapReviewedOfficeBatchesToSource(raw,{...d,capacityProfile:"invented"}),
   "SCALE_P1B2_SELECTION_INVALID");
 await reject(mapReviewedOfficeBatchesToSource(raw,{...d,acknowledgeModeledResources:false}),
   "SCALE_P1B2_CONSENT_REQUIRED");
 await reject(mapReviewedOfficeBatchesToSource(raw,{...d,nodeBatches:[]}),
   "SCALE_P1B2_BATCH_COVERAGE_INVALID");
 await reject(mapReviewedOfficeBatchesToSource(raw,{...d,nodeBatches:[d.nodeBatches[0],d.nodeBatches[0]]}),
   "SCALE_P1B2_BATCH_COVERAGE_INVALID");
 await reject(mapReviewedOfficeBatchesToSource(raw,{...d,sourceSha256:"0".repeat(64)}),
   "SCALE_P1B2_SOURCE_CHANGED");
 await reject(mapReviewedOfficeBatchesToSource(raw,{...d,nodeBatches:[{...d.nodeBatches[0],
   columns:[{cellOrdinal:1,acknowledge:true},{cellOrdinal:0,acknowledge:true}]}]}),
   "SCALE_P1B2_SELECTION_INVALID");
 const duplicate=fixture(100);duplicate[0][2][0]=id(0);
 const duplicated=await make(duplicate);
 await reject(mapReviewedOfficeBatchesToSource(duplicated,decision(format,SHA(duplicated),100)),
   "SCALE_P1B2_DUPLICATE_NODE_ID");
 const unknown=fixture(100);unknown[1][2][1]="missing999";
 const unknownZip=await make(unknown);
 await reject(mapReviewedOfficeBatchesToSource(unknownZip,decision(format,SHA(unknownZip),100)),
   "SCALE_P1B2_LINK_ENDPOINT_UNKNOWN");
 const reused=fixture(100);reused[1][2][3]=port(1);
 const reusedZip=await make(reused);
 await reject(mapReviewedOfficeBatchesToSource(reusedZip,decision(format,SHA(reusedZip),100)),
   "SCALE_P1B2_PORT_REUSED");
 const badRole=fixture(100);badRole[0][2][1]="Windows";
 const badRoleZip=await make(badRole);
 await reject(mapReviewedOfficeBatchesToSource(badRoleZip,decision(format,SHA(badRoleZip),100)),
   "SCALE_P1B2_ROLE_UNSUPPORTED");
 const secrets=fixture(100);secrets[0][1][1]="Password";
 const secretZip=await make(secrets);
 await reject(mapReviewedOfficeBatchesToSource(secretZip,decision(format,SHA(secretZip),100)),
   "SCALE_P1B2_SOURCE_BLOCKED");
 const parallel=await make(fixture(100,{parallel:true})),psha=SHA(parallel);
 const mapped=await mapReviewedOfficeBatchesToSource(parallel,decision(format,psha,100,100));
 eq(mapped.source.connections.length,100,format+" two distinct original parallel edges retained");
 const multi=mapped.source.connections.filter(c=>c.from.resource===id(1)&&c.to.resource===id(0));
 eq(multi.length,2,format+" exact two parallel semantic link entries");
 eq(multi.map(c=>[c.from.port,c.to.port]),[["eth0",port(1)],["eth1",port(100)]],
   format+" distinct original source-authorized port pairs for parallel edges");
 eq(new Set(multi.map(c=>c.id)).size,2,format+" parallel edges have distinct stable identities");
}
console.log("PASS SCALE-001 P1b2: "+count+
 " real DOCX/ODT approved-source-to-compiled-Builder and adversarial assertions; "+
 JSON.stringify(measures)+"; no large Chromium/physical verification claimed.");

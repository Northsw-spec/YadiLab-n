import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import {ENGINE_VERSION} from "../../dist-browser-test/engine/src/index.js";
import {previewNetworkTopologyFile} from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import {createBuilderWorkspace,compileBuilderWorkspace} from "../../dist-browser-test/ui/src/browser/index.js";

// SCALE-001 P0 FROZEN: genuine generated CSV bytes through parser, source review
// and compiled Builder. This is NOT evidence of Office bulk selection, actual DOM
// rendering of large graphs, or actual physical network connectivity.
const enc=new TextEncoder(),assertions={count:0};
function eq(a,b,msg){assert.deepEqual(a,b,msg);assertions.count++;}
function yes(x,msg){assert.ok(x,msg);assertions.count++;}
function originalFile(text){
  const b=enc.encode(text);
  return {name:"documented-enterprise-network.csv",size:b.byteLength,
    async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
}
function sourceCsv(n){
  yes(Number.isInteger(n)&&n>=2,"synthetic size is well-defined");
  const out=["Asset ID,Hostname,Device Type,Connected To"];
  out.push("core0000,Core Switch,Switch,");
  for(let i=1;i<n;i++){
    const id="host"+String(i).padStart(6,"0");
    out.push(id+",Device "+i+",Windows,core0000");
  }
  return out.join("\n")+"\n";
}
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const sv=ajv.compile(schema),nv=ajv.compile(normalizedSchema);
const validate=f=>x=>({valid:!!f(x),diagnostics:(f.errors??[]).map(e=>e.message)});
const options={compilerContext:{validateSource:validate(sv),validateNormalized:validate(nv),
  catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
  engineBaselineVersion:ENGINE_VERSION}};
const expectedIds=n=>["core0000",...Array.from({length:n-1},(_,i)=>
  "host"+String(i+1).padStart(6,"0"))];
const metrics=[];
for(const n of [100,1000]){
  const start=performance.now();
  const raw=sourceCsv(n);
  const p=await previewNetworkTopologyFile(originalFile(raw));
  const parsedMs=Math.round(performance.now()-start);
  eq(p.ok,true,n+" source import "+JSON.stringify(p.diagnostics.slice(0,3)));
  eq(p.devices,n,n+" exact source device count");
  eq(p.links,n-1,n+" exact original inline Connected To link count");
  yes(Boolean(p.source),n+" compiler source exists");
  const source=p.source;
  const ids=expectedIds(n);
  eq(source.resources.map(r=>r.id),ids,n+" exact declared stable IDs/order");
  eq(source.resources[0].type,"network.switch",n+" declared switch role");
  yes(source.resources.slice(1).every(r=>r.type==="endpoint.windows"),n+" declared host role");
  eq(source.connections.length,n-1,n+" exact independently declared edge count");
  eq(new Set(source.connections.map(e=>e.id)).size,n-1,n+" no duplicate edges");
  eq(new Set(source.connections.map(e=>e.from.resource)).size,n-1,n+" unique link source IDs");
  yes(source.connections.every((e,i)=>e.from.resource===ids[i+1] &&
    e.to.resource==="core0000"&&!e.from.port&&!e.to.port),n+" exact original edge pair; no invented ports");
  eq(source.tests,[],n+" imported cable is NOT an engine test");
  eq(source.completion.path,"imported_topology_manual_verification",n+" unfulfilled verification gate");
  yes(!source.resources.some(r=>Object.hasOwn(r.properties??{},"imported_topology_manual_verification")),
    n+" no fake verified network state");
  yes(sv(source),n+" ScenarioSource schema "+JSON.stringify(sv.errors));
  const workspace=createBuilderWorkspace(source);
  eq(workspace.source.resources.map(r=>r.id),ids,n+" Builder exact device identities");
  eq(workspace.source.connections.length,n-1,n+" Builder exact edge count");
  const built=await compileBuilderWorkspace(workspace,options);
  eq(built.compile.status,"valid",n+" actual Builder compile "+JSON.stringify(built.compile.diagnostics?.slice(0,4)));
  eq(built.source.resources.map(r=>r.id),ids,n+" compiled Builder device identities");
  eq(built.source.connections.map(e=>[e.from.resource,e.to.resource]),
    source.connections.map(e=>[e.from.resource,e.to.resource]),n+" compiled Builder exact endpoints");
  metrics.push({nodes:n,links:n-1,sourceBytes:enc.encode(raw).byteLength,
    elapsedMs:Math.round(performance.now()-start),previewMs:parsedMs,
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576)});
}
// Strict negatives in a large generated document; no partial accepted topology.
const large=sourceCsv(1000);
const duplicate=large.replace("host000999,Device 999","host000998,Device 999");
const d=await previewNetworkTopologyFile(originalFile(duplicate));
eq(d.ok,false,"duplicate ID in large source must block");
yes(d.diagnostics.some(e=>e.code==="NETWORK_IMPORT_DUPLICATE_DEVICE_ID"||
  e.code==="WORKBOOK_DUPLICATE_NODE_ID"),"duplicate ID diagnostic");
yes(!d.source,"duplicate original source has no activatable Builder");
const unknown=large.replace("host000999,Device 999,Windows,core0000",
 "host000999,Device 999,Windows,missing999");
const u=await previewNetworkTopologyFile(originalFile(unknown));
eq(u.ok,false,"unknown link endpoint must block");
yes(u.diagnostics.some(e=>e.code==="WORKBOOK_LINK_ENDPOINT_UNKNOWN"),"unknown endpoint diagnostic");
yes(!u.source,"unknown source has no activatable Builder");
console.log("PASS SCALE-001 P0: "+assertions.count+
  " source->Builder fidelity and fail-closed assertions; measured not certified performance "+
  JSON.stringify(metrics));

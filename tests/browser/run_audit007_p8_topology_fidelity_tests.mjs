import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import {ENGINE_VERSION} from "../../dist-browser-test/engine/src/index.js";
import {previewNetworkTopologyFile} from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import {compileBuilderWorkspace, createBuilderWorkspace} from "../../dist-browser-test/ui/src/browser/index.js";

// Owner functional-first P8: original-source fidelity, all node roles and exact
// link pairs through a real Builder compile, plus no self-certified green PASS.
// Frozen before altering workbook-mapping.ts; not a proxy for rendered DOM.
let count=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);count++};
const yes=(value,message)=>{assert.ok(value,message);count++};
const enc=new TextEncoder();
function asFile(text){
  const bytes=enc.encode(text);
  return {name:"documented-network.csv",size:bytes.byteLength,
    async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}};
}
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const validateSource=ajv.compile(sourceSchema),validateNormalized=ajv.compile(normalizedSchema);
const validate=f=>x=>({valid:!!f(x),diagnostics:(f.errors??[]).map(e=>e.message)});
const options={compilerContext:{validateSource:validate(validateSource),validateNormalized:validate(validateNormalized),
  catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
  engineBaselineVersion:ENGINE_VERSION}};
function edgePairs(connections){
  return connections.map(x=>[x.from.resource,x.to.resource])
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function assertNoSelfGreen(source,reason){
  eq(source.tests.length,0,reason+": no imported network test was actually run");
  yes(source.objectives.length>0,reason+": a schema-compatible review objective exists");
  const gate=source.objectives[0].condition;
  eq(source.completion,gate,reason+": completion must use review gate");
  eq(gate.op,"equals",reason+": explicit equality of unset review signal");
  eq(gate.path,"imported_topology_manual_verification",reason+": never self-certify own assigned resource.type");
  eq(gate.value,"VERIFIED",reason+": require independent manual verification signal");
  const resource=source.resources.find(x=>x.id===gate.target);
  yes(Boolean(resource),reason+": review target is an actual resource");
  yes(!Object.hasOwn(resource.properties??{},gate.path),reason+": review value is NOT filled by import");
}
const sourceText=[
  "Asset ID,Hostname,Device Type,IP Address,Connected To,Default Gateway",
  "fw01,Edge Firewall,Firewall,10.42.0.1,rt01,",
  "rt01,WAN Router,Router,10.42.0.2,sw01,",
  "sw01,Core Switch,Switch,10.42.0.3,,",
  "srv01,File Server,Server,10.42.0.10,sw01,",
  "win01,Office Windows,Windows,10.42.0.20,sw01,10.42.0.2",
  "lnx01,Linux Workstation,Linux,10.42.0.21,sw01,"
].join("\n")+"\n";
const roles=[
  ["fw01","network.firewall"],["rt01","network.router"],["sw01","network.switch"],
  ["srv01","server.generic"],["win01","endpoint.windows"],["lnx01","endpoint.linux"]
];
const links=[["fw01","rt01"],["rt01","sw01"],["srv01","sw01"],["win01","sw01"],["lnx01","sw01"]];
const preview=await previewNetworkTopologyFile(asFile(sourceText));
eq(preview.ok,true,"valid imported source "+JSON.stringify(preview.diagnostics));
eq(preview.devices,6,"Six documented devices");
eq(preview.links,5,"Five explicitly documented links");
eq(preview.source.resources.map(x=>x.id),roles.map(x=>x[0]),"Exact node identities and order");
eq(preview.source.resources.map(x=>[x.id,x.type]),roles,"No wrong/hallucinated device roles");
eq(edgePairs(preview.source.connections),links.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
  "Exact link endpoint-pair set; no invented or dropped links");
eq(preview.source.resources.find(x=>x.id==="win01").interfaces[0].addresses,["10.42.0.20"],
  "The documented Windows address is preserved");
yes(preview.diagnostics.some(x=>x.code==="NETWORK_IMPORT_GATEWAY_NOT_LINK"),
  "Gateway is not an inferred cable");
assertNoSelfGreen(preview.source,"explicitly connected imported source");
yes(validateSource(preview.source),"Source conforms to schema: "+JSON.stringify(validateSource.errors));
const workspace=createBuilderWorkspace(preview.source);
eq(workspace.source.resources.map(x=>[x.id,x.type]),roles,"Builder workspace retains exact roles");
eq(edgePairs(workspace.source.connections),edgePairs(preview.source.connections),
  "Builder workspace retains every explicit link");
const compiled=await compileBuilderWorkspace(workspace,options);
eq(compiled.compile.status,"valid","Actual Builder compile "+JSON.stringify(compiled.compile.diagnostics));
eq(compiled.source.resources.map(x=>[x.id,x.type]),roles,"Compiled Builder retains device roles");
eq(edgePairs(compiled.source.connections),edgePairs(preview.source.connections),
  "Compiled Builder preserves all five explicit endpoint pairs");
const isolated=await previewNetworkTopologyFile(asFile([
  "Asset ID,Hostname,Device Type,IP Address,Default Gateway",
  "sw01,Isolated Switch,Switch,10.7.1.2,10.7.1.1",
  "rt01,Isolated Router,Router,10.7.1.1,"
].join("\n")+"\n"));
eq(isolated.ok,true,"Valid intentionally disconnected network");
eq(isolated.links,0,"Same subnet or gateway MUST NOT imply a cable");
eq(isolated.source.connections,[],"No phantom edges in disconnected document");
assertNoSelfGreen(isolated.source,"intentionally isolated imported source");
const dangling=await previewNetworkTopologyFile(asFile([
  "Asset ID,Hostname,Device Type,Connected To",
  "sw01,Main Switch,Switch,missing01"
].join("\n")+"\n"));
eq(dangling.ok,false,"Missing documented endpoint must block rather than invent");
yes(dangling.diagnostics.some(x=>x.code==="WORKBOOK_LINK_ENDPOINT_UNKNOWN"),
  "Missing endpoint reported explicitly");
console.log("PASS AUDIT-007 P8 functional import fidelity: "+count+" source/role/link/compiled Builder/unknown link and no-false-PASS checks");

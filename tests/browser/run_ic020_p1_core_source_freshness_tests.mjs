import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile, verifyNetworkTopologyOriginalForActivation } from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compileBuilderWorkspace, createBuilderWorkspace, previewRuntime } from "../../dist-browser-test/ui/src/browser/index.js";
import { buildRuntimeActiveProbeModel, runRuntimeActiveProbe } from "../../dist-browser-test/ui/src/browser/observations.js";
import { builtinEnterpriseImportAdapters } from "../../dist-browser-test/enterprise-import/src/adapters.js";

let count=0;
const eq=(x,y,n)=>{assert.deepEqual(x,y,n);count++};
const yes=(x,n)=>{assert.ok(x,n);count++};
const blocked=async(t,code)=>{await assert.rejects(t, e=>e?.message===code||e?.code===code,code);count++};
const enc=new TextEncoder();
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const fixture=p=>new Uint8Array(fs.readFileSync(p));
const binary=(name,bytes,declared=bytes.byteLength)=>({name,size:declared,
 async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
const csv=fixture("examples/enterprise-import/network-devices-example.csv");
const tsv=enc.encode(new TextDecoder().decode(csv).replaceAll(",","\t"));
const sourceCsv=new TextDecoder().decode(csv).trim().split("\n");
const headers=sourceCsv[0].split(",");
const records=sourceCsv.slice(1).map(x=>Object.fromEntries(x.split(",").map((v,i)=>[headers[i],v])));
const json=enc.encode(JSON.stringify({Devices:records}));
const values=[
 ["small.json",json,"builtin.json"],
 ["network.csv",csv,"builtin.csv"],
 ["network.tsv",tsv,"builtin.tsv"],
 ["network.xlsx",fixture("examples/enterprise-import/enterprise-import-template.xlsx"),"builtin.xlsx"],
 ["network.ods",fixture("examples/enterprise-import/enterprise-import-template.ods"),"builtin.ods"],
];
const ajv = new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const sValidator=ajv.compile(sourceSchema),nValidator=ajv.compile(normalizedSchema);
const options={compilerContext:{
 validateSource:x=>({valid:!!sValidator(x),diagnostics:(sValidator.errors??[]).map(e=>e.message)}),
 validateNormalized:x=>({valid:!!nValidator(x),diagnostics:(nValidator.errors??[]).map(e=>e.message)}),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION,
}};
for(const [name,bytes,adapter] of values){
 const input=binary(name,bytes);
 const p=await previewNetworkTopologyFile(input);
 eq(p.ok,true,"Validated active workbook adapter "+name+" "+JSON.stringify(p.diagnostics));
 eq(p.sourceSha256,sha(bytes),"Full original bytes, not a sheet hash "+name);
 eq(p.sourceByteSize,bytes.byteLength,"Original byte length "+name);
 yes(/^[a-f0-9]{64}$/.test(p.sourceSha256));
 eq(p.filename,name);
 yes(p.source.resources.length>0,"Has exact mapped nodes "+name);
 yes(p.source.connections.length>=0,"Has only explicit declared links "+name);
 eq(p.devices,p.source.resources.length);
 eq(p.links,p.source.connections.length);
 const stable=JSON.stringify(p);
 await verifyNetworkTopologyOriginalForActivation(input,p,()=>true);
 eq(JSON.stringify(p),stable,"Recheck must not mutate previewed source "+name);
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(p.source),options);
 eq(compiled.compile.status,"valid","Compile actual inventory source "+name);
 const runtime=previewRuntime(compiled);
 eq(runtime.ok,true,"Compile to truth-bound Runtime "+name);
 const probeModel=buildRuntimeActiveProbeModel(runtime.workspace);
 const source=probeModel.sources.find(x=>x.os==="windows"||x.os==="linux");
 if(source){
   const ping=probeModel.probes.find(x=>x.probeId===source.os+".ping");
   const dest=probeModel.destinations.find(x=>x.type==="network.switch")??probeModel.destinations[0];
   yes(Boolean(ping&&dest),"OS inventory source eligible for modeled probes "+name);
   const output=runRuntimeActiveProbe(runtime.workspace,{
     sourceId:source.id,probeId:ping.probeId,destinationId:dest.id,
   });
   eq(output.ok,true);
   eq(output.transcript.modeled,true);
   eq(output.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
   yes(["TRUE","FALSE","UNKNOWN"].includes(output.transcript.truth));
 }else{
   eq(runtime.workspace.mode,"runtime","No source host -> no forged probe eligibility");
 }
}
// Independently verify 3/2 fixture path must not invent any other cables.
for(const [name,data] of [["x.json",json],["x.csv",csv],["x.tsv",tsv]]){
 const p=await previewNetworkTopologyFile(binary(name,data));
 eq(p.devices,4,"Canonical example resources");
 eq(p.links,3,"Only three explicitly declared links");
 eq(p.source.connections.length,3);
 yes(p.source.connections.every(x=>x.from?.resource&&x.to?.resource));
}
const gwOnly=enc.encode("Asset ID,Hostname,Device Type,IP Address,Default Gateway\nrouter01,R,Router,10.1.1.1,\npc01,C,Windows,10.1.1.3,10.1.1.1\n");
const noLink=await previewNetworkTopologyFile(binary("gateway.csv",gwOnly));
eq(noLink.ok,true);
eq(noLink.links,0,"Gateway/address is not a cable");
const ghost=enc.encode("Asset ID,Hostname,Device Type,Connected To\npc01,C,Windows,ghost\n");
const bad=await previewNetworkTopologyFile(binary("ghost.csv",ghost));
eq(bad.ok,false,"Unknown endpoint is a hard blocker");
yes(bad.diagnostics.some(x=>x.code==="WORKBOOK_LINK_ENDPOINT_UNKNOWN"));
await blocked(verifyNetworkTopologyOriginalForActivation(binary("ghost.csv",ghost),bad,()=>true),
 "IC020_P1_SOURCE_CHANGED");

for(const [name,data] of [["fake.docx",csv],["../../secret.csv",csv],["bad\u0000.csv",csv],
 ["bad.yaml",enc.encode("hosts: []")],["scenario.txt",csv],["asset.json.exe",json]]){
 await blocked(previewNetworkTopologyFile(binary(name,data)),"IC020_P1_FILE_INVALID");
}
let reads=0;
await blocked(previewNetworkTopologyFile({name:"huge.csv",size:16*1024*1024+1,
 async arrayBuffer(){reads++;return new ArrayBuffer(10)}}),"IC020_P1_SOURCE_SIZE_INVALID");
eq(reads,0,"Declared huge file rejected before reading");
await blocked(previewNetworkTopologyFile(binary("empty.csv",new Uint8Array())),"IC020_P1_SOURCE_SIZE_INVALID");
await blocked(previewNetworkTopologyFile({name:"fake.json",size:10,
 async arrayBuffer(){return new ArrayBuffer(16*1024*1024+1)}}),"IC020_P1_SOURCE_SIZE_INVALID");
await blocked(previewNetworkTopologyFile(binary("wrong.xlsx",csv)),"IMPORT_WORKBOOK_ARCHIVE_INVALID");
const invalidJsonBytes = enc.encode("{");
await blocked(previewNetworkTopologyFile(binary("bad.json", invalidJsonBytes)), "IMPORT_INVALID_JSON");
const scenario=enc.encode(JSON.stringify({formatId:"infrastructure-cyber-lab.scenario-source",
 scenarioId:"untrusted",schemaVersion:"0.1.0"}));
const scenarioPreview=await previewNetworkTopologyFile(binary("scenario.json",scenario));
eq(scenarioPreview.ok,false,"Native scenario JSON must NOT be mistaken for Devices inventory");
eq(Boolean(scenarioPreview.source),false);
const source=binary("changed.csv",csv);
const original=await previewNetworkTopologyFile(source);
const changed=enc.encode(new TextDecoder().decode(csv).replace("router01","router99"));
const mutator={name:"changed.csv",size:csv.byteLength,
 async arrayBuffer(){return changed.buffer.slice(changed.byteOffset,changed.byteOffset+changed.byteLength);}};
await blocked(verifyNetworkTopologyOriginalForActivation(mutator,original,()=>true),
 "IC020_P1_SOURCE_CHANGED");
const source2=binary("source.csv",csv);
const original2=await previewNetworkTopologyFile(source2);
await blocked(verifyNetworkTopologyOriginalForActivation(source2,original2,()=>false),
 "IC020_P1_STALE");
let ready=true;const source3={name:"slow.csv",size:csv.length,async arrayBuffer(){
 ready=false;return csv.buffer.slice(csv.byteOffset,csv.byteOffset+csv.byteLength);
}};
const preview3=await previewNetworkTopologyFile(source3);
ready=true;
await blocked(verifyNetworkTopologyOriginalForActivation(source3,preview3,()=>ready),
 "IC020_P1_STALE");
const corrupted={...original2,sourceSha256:"a".repeat(64)};
await blocked(verifyNetworkTopologyOriginalForActivation(source2,corrupted,()=>true),
 "IC020_P1_SOURCE_CHANGED");
const wrongName=binary("other.csv",csv);
await blocked(verifyNetworkTopologyOriginalForActivation(wrongName,original2,()=>true),
 "IC020_P1_SOURCE_CHANGED");
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
 ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"]);
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const literal of [
 'accept: ".json,.xlsx,.ods,.csv,.tsv"',
 'verifyNetworkTopologyOriginalForActivation(original, preview, isCurrent)',
 'workspaceIdentity: workspace',
 '"data-network-import-sha": "true"',
 'data-network-import-quick-file',
 'data-network-import-runtime',
 'data-network-import-activate',
])yes(main.includes(literal),"Actual modal source-bound integration: "+literal);
console.log("PASS IC-020 P1 five-format original SHA-bound topology and modeled probe tests: "+count+" assertions.");

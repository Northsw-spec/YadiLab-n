import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type:"json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type:"json" };
import catalog from "../../catalog/builtin-catalog.json" with { type:"json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile, verifyNetworkTopologyOriginalForActivation }
  from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compileBuilderWorkspace, createBuilderWorkspace, previewRuntime }
  from "../../dist-browser-test/ui/src/browser/index.js";
import { buildRuntimeActiveProbeModel, runRuntimeActiveProbe }
  from "../../dist-browser-test/ui/src/browser/observations.js";
import { builtinEnterpriseImportAdapters } from "../../dist-browser-test/enterprise-import/src/adapters.js";
import { normalizeNetworkInventoryDocument } from "../../dist-browser-test/enterprise-import/src/network-inventory.js";
import { jsonImportAdapter } from "../../dist-browser-test/enterprise-import/src/json.js";

let assertions=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);assertions++};
const yes=(c,label)=>{assert.ok(c,label);assertions++};
const bytes=x=>new TextEncoder().encode(x);
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
const source=Uint8Array.from(fs.readFileSync("tests/fixtures/import/ic020-p2a-consultant-dual-source.json"));
const raw=JSON.parse(new TextDecoder().decode(source));
const file=(name,data)=>({name,size:data.byteLength,
  async arrayBuffer(){return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}});
const input=file("consultant.json",source);
const inspect=(input,choice)=>previewNetworkTopologyFile(input,choice===undefined?{}:{linkSourceChoice:choice});
const guard=async(task,code)=>{await assert.rejects(task,e=>e?.code===code||e?.message===code,code);assertions++};

eq(raw.Devices.length,8,"Realistic eight devices including Windows/Linux infra");
eq(raw.Links.length,6,"Separate Links table has exactly six explicitly declared source links");
eq(raw.Devices.filter(x=>x["Connected To"]).length,7,"Inline Connected To has seven different explicit links");
eq(new Set(raw.Devices.map(x=>x["Asset ID"])).size,8);
yes(raw.Devices.every(x=>x["Confidential Notes"]==="SECRET_IC020_P2A_CANARY_NOT_REAL"));
const unresolved=await inspect(input);
eq(unresolved.ok,false,"Dual-source conflict must never auto-enable Builder");
eq(Boolean(unresolved.source),false,"Conflict must not expose active ScenarioSource");
eq(unresolved.linkSourceConflict,{inlineDeclaredLinks:7,sheetDeclaredLinks:6});
eq(unresolved.linkSourceChoice,undefined,"No default operator link source decision");
eq(unresolved.sourceSha256,sha(source),"Blocked preview still has original full SHA proof");
eq(unresolved.sourceByteSize,source.byteLength);
yes(unresolved.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCES_CONFLICT" && x.severity==="error"));
yes(!JSON.stringify(unresolved).includes("SECRET_IC020_P2A_CANARY_NOT_REAL"),"No raw private per-row value leaked into review metadata");
const sheet=await inspect(input,"LINKS_SHEET");
const inline=await inspect(input,"INLINE_CONNECTED_TO");
for(const [choice,out,count] of [
 ["LINKS_SHEET",sheet,6],["INLINE_CONNECTED_TO",inline,7],
]){
 eq(out.ok,true,choice+" was explicitly resolved: "+JSON.stringify(out.diagnostics));
 eq(out.sourceSha256,sha(source),choice+" original source remains unchanged");
 eq(out.linkSourceChoice,choice);
 eq(out.linkSourceConflict,{inlineDeclaredLinks:7,sheetDeclaredLinks:6});
 eq(out.devices,8);
 eq(out.links,count);
 eq(out.source.resources.length,8);
 eq(out.source.connections.length,count);
 yes(out.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCE_REVIEWED"&&x.severity==="warning"));
 yes(!out.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCES_CONFLICT"));
 yes(!JSON.stringify(out).includes("SECRET_IC020_P2A_CANARY_NOT_REAL"),"No original secret in mapped source/diagnostics");
 await verifyNetworkTopologyOriginalForActivation(input,out,()=>true);
}
const edgeSet=x=>new Set(x.source.connections.map(y=>[y.from.resource,y.to.resource].join("=>")));
const fromSheet=edgeSet(sheet), fromInline=edgeSet(inline);
eq(fromSheet.size,6);
eq(fromInline.size,7);
yes(fromSheet.has("sw02=>fw01"),"Links table retains its sole distinct switch uplink");
yes(!fromSheet.has("sw02=>sw01"),"Links table must exclude inline conflicting uplink");
yes(fromInline.has("sw02=>sw01"),"Connected To retains its sole distinct switch uplink");
yes(!fromInline.has("sw02=>fw01"),"Connected To must exclude discarded table uplink");
yes(fromInline.has("lin02=>sw02"),"Inline has one extra explicitly described server cable");
yes(!fromSheet.has("lin02=>sw02"),"Links table has no inferred server cable");
eq(sheet.source.resources.map(x=>x.id).sort(),raw.Devices.map(x=>x["Asset ID"]).sort());
eq(sheet.source.resources.find(x=>x.id==="win01").type,"endpoint.windows");
eq(sheet.source.resources.find(x=>x.id==="lin01").type,"endpoint.linux");
eq(sheet.source.resources.find(x=>x.id==="sw01").type,"network.switch");
eq(sheet.source.resources.find(x=>x.id==="fw01").type,"network.firewall");
yes(sheet.source.resources.every(x=>x.interfaces?.length===1),"Source contains one declared address for every resource");
eq(sheet.source.notes.length,8,"Gateways remain source-only notes, not cables");
eq(inline.source.notes.length,8);
eq(sheet.source.connections.map(x=>[x.from.resource,x.to.resource]),[
 ["fw01","rtr01"],["sw01","fw01"],["sw02","fw01"],
 ["win01","sw01"],["lin01","sw02"],["win02","sw01"],
],"Independent expected Links table graph");
eq(inline.source.connections.map(x=>[x.from.resource,x.to.resource]),[
 ["fw01","rtr01"],["sw01","fw01"],["sw02","sw01"],
 ["win01","sw01"],["lin01","sw02"],["win02","sw01"],["lin02","sw02"],
],"Independent expected Connected To graph");
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const validator=ajv.compile(sourceSchema),normalizedValidator=ajv.compile(normalizedSchema);
const options={compilerContext:{
 validateSource:x=>({valid:!!validator(x),diagnostics:(validator.errors??[]).map(e=>e.message)}),
 validateNormalized:x=>({valid:!!normalizedValidator(x),diagnostics:(normalizedValidator.errors??[]).map(e=>e.message)}),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION,
}};
for(const [label,review] of [["Links",sheet],["ConnectedTo",inline]]){
 const builder=await compileBuilderWorkspace(createBuilderWorkspace(review.source),options);
 eq(builder.compile.status,"valid",label+" compiled");
 const runtime=previewRuntime(builder);
 eq(runtime.ok,true,label+" real modeled Runtime");
 const model=buildRuntimeActiveProbeModel(runtime.workspace);
 yes(model.sources.some(x=>x.id==="win01"&&x.os==="windows"),"Real Windows source was declared, not inferred");
 yes(model.sources.some(x=>x.id==="lin01"&&x.os==="linux"),"Real Linux source was declared, not inferred");
 for(const os of ["windows","linux"]){
   const sourceDevice=model.sources.find(x=>x.os===os);
   yes(Boolean(sourceDevice),"Source is an explicitly OS-declared endpoint");
   // Probe definitions and destinations are source-dependent: refresh both
   // from the actual Engine model for THIS selected Windows/Linux endpoint.
   const selected=buildRuntimeActiveProbeModel(runtime.workspace,sourceDevice.id);
   const probe=selected.probes.find(x=>x.probeId===os+".ping");
   const dest=selected.destinations.find(x=>x.id==="rtr01") ??
     selected.destinations.find(x=>x.id!==sourceDevice.id);
   yes(Boolean(probe&&dest),"Only actual selectable modeled probes/destinations");
   const before=JSON.stringify(runtime.workspace.engineState);
   const result=runRuntimeActiveProbe(runtime.workspace,{
     sourceId:sourceDevice.id,probeId:probe.probeId,destinationId:dest.id,
   });
   eq(result.ok,true,"Engine probe invocation "+label+" "+os);
   eq(result.transcript.modeled,true);
   eq(result.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
   yes(["TRUE","FALSE","UNKNOWN"].includes(result.transcript.truth),"Truth from Engine, not source text");
   eq(result.transcript.scenarioHash,runtime.workspace.scenario.sourceHash);
   eq(JSON.stringify(runtime.workspace.engineState),before,"Probe must not mutate Engine state");
 }
}
await guard(verifyNetworkTopologyOriginalForActivation(input,unresolved,()=>true),
 "IC020_P1_SOURCE_CHANGED");
await guard(verifyNetworkTopologyOriginalForActivation(input,sheet,()=>false),
 "IC020_P1_STALE");
await guard(verifyNetworkTopologyOriginalForActivation(input,{...sheet,linkSourceChoice:"INLINE_CONNECTED_TO"},()=>true),
 "IC020_P1_SOURCE_CHANGED");
await guard(verifyNetworkTopologyOriginalForActivation(input,{...inline,linkSourceChoice:"LINKS_SHEET"},()=>true),
 "IC020_P1_SOURCE_CHANGED");
await guard(verifyNetworkTopologyOriginalForActivation(input,{...sheet,linkSourceConflict:{inlineDeclaredLinks:8,sheetDeclaredLinks:6}},()=>true),
 "IC020_P1_SOURCE_CHANGED");
const modified=JSON.stringify({...raw,Links:raw.Links.map((x,i)=>
 i===0?{...x,To:"sw01"}:x)});
await guard(verifyNetworkTopologyOriginalForActivation(file("consultant.json",bytes(modified)),sheet,()=>true),
 "IC020_P1_SOURCE_CHANGED");
const invalidChoice=await inspect(input,"MERGE_BOTH");
eq(invalidChoice.ok,false,"Never permit a synthetic merge-all bypass");
yes(invalidChoice.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCE_CHOICE_INVALID"));
for(const weird of [null,false,0,{},["LINKS_SHEET"],"MAYBE","LINKS_SHEET_AND_INLINE"]){
 const out=await inspect(input,weird);
 eq(out.ok,false,"Reject unknown/invalid choice "+String(weird));
 yes(out.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCE_CHOICE_INVALID"));
}
const noConflictBytes=bytes(JSON.stringify({Devices:raw.Devices.map(x=>({
 ...x,"Connected To":"",
}))}));
const noConflictFile=file("no-conflict.json",noConflictBytes);
const noConflict=await inspect(noConflictFile);
eq(noConflict.ok,true,"No conflict can use empty connected declarations with no Links sheet");
eq(noConflict.links,0,"No physical link inferred");
eq(noConflict.linkSourceConflict,undefined);
for(const choice of ["LINKS_SHEET","INLINE_CONNECTED_TO"]){
 const rejected=await inspect(noConflictFile,choice);
 eq(rejected.ok,false,"No link review option without competing sources");
 yes(rejected.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCE_CHOICE_INVALID"));
}
const missingInlineBytes=bytes(JSON.stringify({Devices:raw.Devices.map(x=>({...x,"Connected To":""})),Links:raw.Links}));
const noDual=await inspect(file("link-only.json",missingInlineBytes));
eq(noDual.ok,true,"Single explicit Links table no review required");
eq(noDual.links,6);
const noDualForged=await inspect(file("link-only.json",missingInlineBytes),"LINKS_SHEET");
eq(noDualForged.ok,false);
yes(noDualForged.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SOURCE_CHOICE_INVALID"));
for(const [which,mutate,expected] of [
 ["unknown-inline",x=>{x.Devices[7]["Connected To"]="ghost";},
  "WORKBOOK_LINK_ENDPOINT_UNKNOWN"],
 ["unknown-sheet",x=>{x.Links[0].To="ghost";},
  "WORKBOOK_LINK_ENDPOINT_UNKNOWN"],
 ["duplicate-sheet",x=>{x.Links[1]["Link ID"]=x.Links[0]["Link ID"];},
  "WORKBOOK_DUPLICATE_LINK_ID"],
 ["duplicate-id",x=>{x.Devices[1]["Asset ID"]=x.Devices[0]["Asset ID"];},
  "NETWORK_IMPORT_DUPLICATE_DEVICE_ID"],
]){
 const copy=JSON.parse(JSON.stringify(raw));mutate(copy);
 const altered=file("broken.json",bytes(JSON.stringify(copy)));
 const rejectedInline=await inspect(altered,"INLINE_CONNECTED_TO");
 const rejectedSheet=await inspect(altered,"LINKS_SHEET");
 const chosen=which==="unknown-inline"?"INLINE_CONNECTED_TO":"LINKS_SHEET";
 const target=chosen==="INLINE_CONNECTED_TO"?rejectedInline:rejectedSheet;
 eq(target.ok,false,which+" chosen producer must BLOCK");
 yes(target.diagnostics.some(x=>x.code===expected),which+" diagnostic");
 if(which==="unknown-inline")eq(rejectedSheet.ok,true,"Discarded ghost inline link never imported");
 if(which==="unknown-sheet")eq(rejectedInline.ok,true,"Discarded ghost Links-table endpoint never imported");
 if(which==="duplicate-sheet")eq(rejectedInline.ok,true,"Discarded duplicate link IDs not imported");
 if(which==="duplicate-id")eq(rejectedInline.ok,false,"Device ID collision always blocks either choice");
}
const adapterSource={bytes:source,mediaType:"application/json"};
const parsed=await jsonImportAdapter.parse(adapterSource,{options:{tableName:"Devices"}});
const badDuplicate={tables:[...parsed.document.tables,parsed.document.tables.find(x=>x.tableId==="Links")]};
const rejectedDoc=normalizeNetworkInventoryDocument(badDuplicate,{linkSourceChoice:"LINKS_SHEET"});
yes(rejectedDoc.diagnostics.some(x=>x.code==="NETWORK_IMPORT_LINK_SHEET_AMBIGUOUS"),
"Duplicate Links table blocks review path");
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
 ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"],
 "Preserve original active enterprise adapter identities");

const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const needle of [
 'data-network-import-link-review',
 'data-network-import-link-source-sheet',
 'data-network-import-link-source-inline',
 'IC020_P2A_SOURCE_CHANGED',
 'reviewLinkSource("LINKS_SHEET")',
 'reviewLinkSource("INLINE_CONNECTED_TO")',
 'verifyNetworkTopologyOriginalForActivation(original, preview, isCurrent)',
]){
 yes(main.includes(needle),"Actual modal wired to manual review source guard: "+needle);
}
console.log("PASS IC-020 P2a dual-source explicit link review: "+assertions+
 " original SHA, 8-device/6-vs-7-edge, Builder/Engine, invalid decision, stale source, no inferred-link assertions.");

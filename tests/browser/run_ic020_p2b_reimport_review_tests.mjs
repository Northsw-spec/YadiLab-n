import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile,verifyNetworkTopologyOriginalForActivation }
  from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compareCoreNetworkReimport }
  from "../../dist-browser-test/ui/src/browser/core-network-reimport-review.js";
import { createBuilderWorkspace,compileBuilderWorkspace,previewRuntime }
  from "../../dist-browser-test/ui/src/browser/index.js";
import { buildRuntimeActiveProbeModel,runRuntimeActiveProbe }
  from "../../dist-browser-test/ui/src/browser/observations.js";
import { builtinEnterpriseImportAdapters }
  from "../../dist-browser-test/enterprise-import/src/adapters.js";
let assertions=0;
const eq=(a,b,n)=>{assert.deepEqual(a,b,n);assertions++};
const yes=(x,n)=>{assert.ok(x,n);assertions++};
const fail=async(action,code)=>{await assert.rejects(action,e=>e?.code===code||e?.message===code,code);assertions++};
const enc=new TextEncoder();
const h=x=>crypto.createHash("sha256").update(x).digest("hex");
const csv=new Uint8Array(fs.readFileSync("examples/enterprise-import/network-devices-example.csv"));
const str=new TextDecoder().decode(csv).trim().split("\n"),cols=str[0].split(",");
const rows=str.slice(1).map(line=>Object.fromEntries(line.split(",").map((x,i)=>[cols[i],x])));
const editedRows=[
  rows[0],
  rows[1],
  {...rows[2],Hostname:"Reception PC revised"},
  {...rows[3],"Asset ID":"linux01",Hostname:"New Linux Support","Device Type":"Linux"},
];
const encoded=enc.encode(JSON.stringify({Devices:editedRows}));
const file=(name,buf)=>({name,size:buf.byteLength,async arrayBuffer(){
 return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
}});
const oldFile=file("baseline.csv",csv),newFile=file("revision.json",encoded);
const old=await previewNetworkTopologyFile(oldFile),candidate=await previewNetworkTopologyFile(newFile);
eq(old.ok,true,"Existing CSV source producer accepted");
eq(candidate.ok,true,"New JSON source producer accepted");
eq(candidate.sourceSha256,h(encoded),"SHA of exact incoming original");
eq(old.sourceSha256,h(csv),"SHA of initial original, distinct from future Builder snapshot");
eq(candidate.source.scenarioId,"imported_network");
eq(candidate.devices,4);
eq(candidate.links,3);
const builder=createBuilderWorkspace(old.source);
const builderBefore=JSON.stringify(builder);
let current=true;
const report=await compareCoreNetworkReimport(builder,candidate,()=>current);
eq(JSON.stringify(builder),builderBefore,"No mutation to current Builder on diff");
eq(report.status,"REVIEW_REQUIRED");
eq(report.kind,"LIVE_WORKSPACE_VS_INCOMING_ORIGINAL");
eq(report.currentWorkspaceMode,"builder");
eq(report.currentWorkspaceRevision,0);
eq(report.incomingOriginalSourceSha256,h(encoded));
eq(report.incomingOriginalByteSize,encoded.byteLength);
yes(/^[0-9a-f]{64}$/.test(report.currentWorkspaceSourceSha256));
yes(report.currentWorkspaceSourceSha256!==report.incomingOriginalSourceSha256,
 "Correct labels: workspace semantic SHA is not incoming original-byte SHA");
eq(report.resources,{added:1,removed:1,changed:1,unchanged:2},
  "Independent expected workstation rename plus Linux replacement");
eq(report.connections,{added:0,removed:0,changed:1,unchanged:2},
  "Explicit link ID slot update is CHANGED, not an inferred physical cable");
eq(report.canAutoApply,false);
eq(report.physicalTopologyVerified,false);
eq(report.engineVerified,false);
eq(Object.isFrozen(report),true);
eq(Object.isFrozen(report.resources),true);
eq(Object.isFrozen(report.connections),true);
for(const secret of ["192.168.10.101","Reception PC revised","New Linux Support","linux01"])
  eq(JSON.stringify(report).includes(secret),false,"No identifiers, source cells, IP or private labels in diff");
await verifyNetworkTopologyOriginalForActivation(newFile,candidate,()=>true);
const swapped=enc.encode(JSON.stringify({Devices:editedRows.map(x=>
 x["Asset ID"]==="linux01"?{...x,Hostname:"Stale Linux Change"}:x)}));
await fail(verifyNetworkTopologyOriginalForActivation(file("revision.json",swapped),candidate,()=>true),
 "IC020_P1_SOURCE_CHANGED");
eq(JSON.stringify(builder),builderBefore,"Original Builder remains unchanged after invalid reimport");
const diffAgain=await compareCoreNetworkReimport(builder,candidate,()=>true);
eq(diffAgain,report,"Replay of same current Builder vs same incoming original is deterministic");
const orderFree=createBuilderWorkspace({...old.source,
 resources:[...old.source.resources].reverse(),connections:[...old.source.connections].reverse()});
const reordered=await compareCoreNetworkReimport(orderFree,candidate,()=>true);
eq(reordered.currentWorkspaceSourceSha256,report.currentWorkspaceSourceSha256,
 "Canonical snapshot fingerprint is insensitive to independent resource/link ordering");
eq(reordered.resources,report.resources);
eq(reordered.connections,report.connections);
current=false;
await fail(compareCoreNetworkReimport(builder,candidate,()=>current),
 "IC020_P2B_BASELINE_CHANGED");
current=true;
const changedOnce={...builder,sourceRevision:1};
const reportChangedRev=await compareCoreNetworkReimport(changedOnce,candidate,()=>true);
eq(reportChangedRev.currentWorkspaceRevision,1,"Live source revision distinct from original SHA");
eq(reportChangedRev.currentWorkspaceSourceSha256,report.currentWorkspaceSourceSha256);
const alteredBaseline=createBuilderWorkspace({...builder.source,
 resources:builder.source.resources.map(x=>x.id==="pc01"?{...x,label:"Builder manual edit"}:x)});
const reportEdited=await compareCoreNetworkReimport(alteredBaseline,candidate,()=>true);
yes(reportEdited.currentWorkspaceSourceSha256!==report.currentWorkspaceSourceSha256,
 "Builder edit changes live digest even though original file was not rewritten");
eq(reportEdited.resources.changed,1,"The baseline edit is counted semantically, never hidden");
const malformed=[
  {name:"unrelated",workspace:createBuilderWorkspace({...old.source,scenarioId:"unrelated"})},
  {name:"not-imported",workspace:createBuilderWorkspace({...old.source,scenarioId:"example"})},
  {name:"duplicate",workspace:createBuilderWorkspace({...old.source,
     resources:[...old.source.resources,old.source.resources[0]]})},
  {name:"ghost",workspace:createBuilderWorkspace({...old.source,
     connections:[...old.source.connections,{...old.source.connections[0],id:"ghostlink",
     to:{resource:"ghost_id"}}]})},
  {name:"missing-source",workspace:{mode:"runtime",sourceRevision:0}},
];
for(const item of malformed){
 await fail(compareCoreNetworkReimport(item.workspace,candidate,()=>true),
  "IC020_P2B_REIMPORT_NOT_COMPARABLE");
}
for(const attempt of [
 {...candidate,ok:false},
 {...candidate,sourceSha256:"A".repeat(64)},
 {...candidate,sourceSha256:"invalid"},
 {...candidate,sourceByteSize:0},
 {...candidate,sourceByteSize:16*1024*1024+1},
 {...candidate,source:{...candidate.source,resources:[...candidate.source.resources,candidate.source.resources[0]]}},
 {...candidate,source:{...candidate.source,
   connections:[...candidate.source.connections,{...candidate.source.connections[0],id:"bad_link",
   to:{resource:"not_there"}}]}},
]){
 await fail(compareCoreNetworkReimport(builder,attempt,()=>true),
  "IC020_P2B_REIMPORT_NOT_COMPARABLE");
}
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const v1=ajv.compile(sourceSchema),v2=ajv.compile(normalizedSchema);
const compilerOptions={compilerContext:{
 validateSource:x=>({valid:!!v1(x),diagnostics:(v1.errors??[]).map(e=>e.message)}),
 validateNormalized:x=>({valid:!!v2(x),diagnostics:(v2.errors??[]).map(e=>e.message)}),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION,
}};
const compiled=await compileBuilderWorkspace(createBuilderWorkspace(candidate.source),compilerOptions);
eq(compiled.compile.status,"valid","After separate explicit replacement approved, source still compiles");
const runtime=previewRuntime(compiled);
eq(runtime.ok,true,"Modeled Runtime after operator-approved candidate");
const probe=buildRuntimeActiveProbeModel(runtime.workspace);
yes(probe.sources.some(x=>x.id==="linux01"&&x.os==="linux"),"New Linux source is eligible only due declared type");
const linux=probe.sources.find(x=>x.id==="linux01"),ping=probe.probes.find(x=>x.probeId==="linux.ping");
const dst=probe.destinations.find(x=>x.id==="router01");
yes(Boolean(linux&&ping&&dst));
const before=JSON.stringify(runtime.workspace.engineState);
const result=runRuntimeActiveProbe(runtime.workspace,{
 sourceId:linux.id,probeId:ping.probeId,destinationId:dst.id,
});
eq(result.ok,true);
eq(result.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
eq(result.transcript.modeled,true);
yes(["TRUE","FALSE","UNKNOWN"].includes(result.transcript.truth));
eq(JSON.stringify(runtime.workspace.engineState),before,"No live network probes or Engine mutation");
const conflicted=new Uint8Array(fs.readFileSync("tests/fixtures/import/ic020-p2a-consultant-dual-source.json"));
const reviewFile=file("consultant.json",conflicted);
const review=await previewNetworkTopologyFile(reviewFile,{linkSourceChoice:"LINKS_SHEET"});
eq(review.ok,true,"P2a explicit selection prerequisite for core reimport");
const sameBase=createBuilderWorkspace(review.source);
const reviewed=await compareCoreNetworkReimport(sameBase,review,()=>true);
eq(reviewed.sourceLinkChoice,"LINKS_SHEET");
eq(reviewed.resources,{added:0,removed:0,changed:0,unchanged:8});
eq(reviewed.connections,{added:0,removed:0,changed:0,unchanged:6});
eq(reviewed.canAutoApply,false);
const unresolved=await previewNetworkTopologyFile(reviewFile);
await fail(compareCoreNetworkReimport(sameBase,unresolved,()=>true),
 "IC020_P2B_REIMPORT_NOT_COMPARABLE");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const token of [
 "data-network-reimport-compare",
 "data-network-reimport-diff",
 "data-network-reimport-approve",
 "IC020_P2B_BASELINE_CHANGED",
 "IC020_P2B_REVIEW_REQUIRED",
 "compareCoreNetworkReimport(workspaceIdentity,candidate,isCurrent)",
 "await verifyReimportApproval();",
 "data-network-import-link-source-sheet",
]){
 yes(main.includes(token),"Real modal implements source-bound reimport review "+token);
}
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
 ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"]);
console.log("PASS IC-020 P2b source-bound live-workspace reimport: "+assertions+
 " immutable semantic-diff, hash distinction, stale, consent, no mutation and modeled-probe assertions.");

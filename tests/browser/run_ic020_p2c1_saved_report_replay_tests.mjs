import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { previewNetworkTopologyFile, verifyNetworkTopologyOriginalForActivation }
  from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compareCoreNetworkReimport }
  from "../../dist-browser-test/ui/src/browser/core-network-reimport-review.js";
import { createSavedCoreReimportReport, savedCoreReimportReportText,
  readSavedCoreReimportReport, matchSavedCoreReimportReport }
  from "../../dist-browser-test/ui/src/browser/core-network-reimport-saved-report.js";
import { createBuilderWorkspace }
  from "../../dist-browser-test/ui/src/browser/index.js";
import { builtinEnterpriseImportAdapters }
  from "../../dist-browser-test/enterprise-import/src/adapters.js";

let n=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);n++};
const yes=(a,label)=>{assert.ok(a,label);n++};
const reject=(fn,code)=>{assert.throws(fn,e=>e?.code===code&&e?.message===code,code);n++};
const rejectAsync=async(fn,code)=>{await assert.rejects(fn,e=>e?.code===code&&e?.message===code,code);n++};
const bytes=x=>new TextEncoder().encode(x);
const hash=x=>crypto.createHash("sha256").update(x).digest("hex");
const file=(name,buf,declared=buf.byteLength)=>({
 name,size:declared,
 async arrayBuffer(){return buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);}
});
const csv=new Uint8Array(fs.readFileSync("examples/enterprise-import/network-devices-example.csv"));
const lines=new TextDecoder().decode(csv).trim().split("\n");
const cols=lines[0].split(",");
const rows=lines.slice(1).map(line=>Object.fromEntries(line.split(",").map((v,i)=>[cols[i],v])));
const updated=[rows[0],rows[1],{...rows[2],Hostname:"Confidential Canary DEVICE SECRET_CORE_REPLAY"},
 {...rows[3],"Asset ID":"linux01",Hostname:"Linux Support", "Device Type":"Linux"}];
const newBytes=bytes(JSON.stringify({Devices:updated}));
const from=file("baseline.csv",csv),input=file("revision.json",newBytes);
const base=await previewNetworkTopologyFile(from);
const candidate=await previewNetworkTopologyFile(input);
eq(base.ok,true,"P1 CSV producer valid");
eq(candidate.ok,true,"P1 JSON producer valid");
const active=createBuilderWorkspace(base.source);
const liveBefore=JSON.stringify(active);
const review=await compareCoreNetworkReimport(active,candidate,()=>true);
const sidecar=createSavedCoreReimportReport(review);
const encoded=savedCoreReimportReportText(review);
const sidecarBytes=bytes(encoded);
eq(sidecar.formatId,"yadilab.core-network-reimport-review.v1");
eq(sidecar.schemaVersion,1);
eq(sidecar.status,"REVIEW_ONLY");
eq(sidecar.kind,"LIVE_WORKSPACE_VS_INCOMING_ORIGINAL");
eq(sidecar.canActivate,false);
eq(sidecar.physicalTopologyVerified,false);
eq(sidecar.engineVerified,false);
eq(sidecar.currentWorkspaceSourceSha256,review.currentWorkspaceSourceSha256,
 "Prior digest explicitly belongs to LIVE workspace only");
eq(sidecar.incomingOriginalSourceSha256,hash(newBytes),
 "Incoming SHA comes from original complete file");
eq(sidecar.incomingOriginalByteSize,newBytes.byteLength);
eq(sidecar.resources,{added:1,removed:1,changed:1,unchanged:2});
eq(sidecar.connections,{added:0,removed:0,changed:1,unchanged:2});
eq(sidecar.currentWorkspaceMode,"builder");
eq(sidecar.currentWorkspaceRevision,0);
eq(Object.isFrozen(sidecar),true);
eq(Object.isFrozen(sidecar.resources),true);
eq(Object.isFrozen(sidecar.connections),true);
yes(sidecarBytes.byteLength<16*1024,"Structured saved report is strictly below 16KiB");
for(const secret of [
 "Confidential Canary DEVICE SECRET_CORE_REPLAY","10.0.0.","192.168.",
 "linux01","Reception","server01","Hostname","Asset ID","filename","displayName",
 "originalFileName","PASSWORD","hostName","ipAddress","credential","rawCell",
]){
 eq(encoded.includes(secret),false,"No secret/source record field in saved sidecar "+secret);
}
eq(JSON.stringify(sidecar,null,2)+"\n",encoded,"Canonical ordered record serialization");
eq(JSON.stringify(active),liveBefore,"Building saved report never mutates Builder");
const reselected=await readSavedCoreReimportReport(file("saved-report.json",sidecarBytes),()=>true);
eq(JSON.stringify(reselected),JSON.stringify(sidecar),"Read saved JSON restores only canonical allowed fields");
eq(Object.isFrozen(reselected),true);
eq(Object.isFrozen(reselected.resources),true);
eq(Object.isFrozen(reselected.connections),true);
await verifyNetworkTopologyOriginalForActivation(input,candidate,()=>true);
const fresh=await compareCoreNetworkReimport(active,candidate,()=>true);
eq(matchSavedCoreReimportReport(reselected,fresh),reselected,
 "Replay can match only exact live workspace and independently reselected file");
eq(JSON.stringify(active),liveBefore,"Replay does not mutate Builder or Engine");
const changedLive=createBuilderWorkspace({...base.source,resources:base.source.resources.map((x,i)=>
 i===0?{...x,label:"Edited by operator after initial import"}:x)});
const editedReview=await compareCoreNetworkReimport(changedLive,candidate,()=>true);
reject(()=>matchSavedCoreReimportReport(reselected,editedReview),"IC020_P2C1_REPLAY_MISMATCH");
const tamperedBytes=bytes(JSON.stringify({Devices:updated.map((x,i)=>
 i===3?{...x,Hostname:"Tampered after saving report"}:x)}));
await rejectAsync(
 ()=>verifyNetworkTopologyOriginalForActivation(file("revision.json",tamperedBytes),candidate,()=>true),
 "IC020_P1_SOURCE_CHANGED");
const alternate=await previewNetworkTopologyFile(file("revision.json",tamperedBytes));
const updatedReview=await compareCoreNetworkReimport(active,alternate,()=>true);
reject(()=>matchSavedCoreReimportReport(reselected,updatedReview),"IC020_P2C1_REPLAY_MISMATCH");
for(const [label,mutate] of [
 ["wrong format",x=>{x.formatId="imported-network";}],
 ["version",x=>{x.schemaVersion=2;}],
 ["status",x=>{x.status="APPROVED";}],
 ["kind",x=>{x.kind="OLD_ORIGINAL_VS_NEW_ORIGINAL";}],
 ["auto apply",x=>{x.canActivate=true;}],
 ["engine",x=>{x.engineVerified=true;}],
 ["cabling",x=>{x.physicalTopologyVerified=true;}],
 ["old sha uppercase",x=>{x.currentWorkspaceSourceSha256="F".repeat(64);}],
 ["old sha invalid",x=>{x.currentWorkspaceSourceSha256="invalid";}],
 ["new sha uppercase",x=>{x.incomingOriginalSourceSha256="F".repeat(64);}],
 ["new sha invalid",x=>{x.incomingOriginalSourceSha256="notsha";}],
 ["new file zero",x=>{x.incomingOriginalByteSize=0;}],
 ["new file float",x=>{x.incomingOriginalByteSize=1.5;}],
 ["new file oversized",x=>{x.incomingOriginalByteSize=16*1024*1024+1;}],
 ["wrong mode",x=>{x.currentWorkspaceMode="Engine";}],
 ["revision negative",x=>{x.currentWorkspaceRevision=-1;}],
 ["revision fractional",x=>{x.currentWorkspaceRevision=0.5;}],
 ["revision excessive",x=>{x.currentWorkspaceRevision=1000000001;}],
 ["false prior SHA provenance",x=>{x.previousOriginalFileSha256="f".repeat(64);}],
 ["source data",x=>{x.hostname="private-host";}],
 ["raw password",x=>{x.password="SECRET";}],
 ["private pointer",x=>{x.jsonPointer="/Devices/0/Hostname";}],
 ["source link invalid",x=>{x.sourceLinkChoice="ALL_SOURCES";}],
 ["source link null",x=>{x.sourceLinkChoice=null;}],
 ["source choice empty",x=>{x.sourceLinkChoice="";}],
 ["no status",x=>{delete x.status;}],
 ["missing resource counts",x=>{delete x.resources;}],
 ["resource negative",x=>{x.resources.added=-1;}],
 ["resource fraction",x=>{x.resources.changed=1.5;}],
 ["resource overflow",x=>{x.resources.removed=4097;}],
 ["resource contradiction",x=>{x.resources.added=4096;}],
 ["connections nonfinite",x=>{x.connections.unchanged=Infinity;}],
 ["connections overflow",x=>{x.connections.changed=9007199254740992;}],
 ["connections extra private",x=>{x.connections.secret="HOST";}],
 ["extra top-level __proto__",x=>{Object.defineProperty(x,"__proto__",{value:"anything",enumerable:true});}],
 ["array nested",x=>{x.resources=[];}],
 ["null nested",x=>{x.connections=null;}],
]){
 const edited=JSON.parse(JSON.stringify(reselected));mutate(edited);
 reject(()=>matchSavedCoreReimportReport(edited,fresh),"IC020_P2C1_SIDECAR_INVALID");
 await rejectAsync(()=>readSavedCoreReimportReport(file("bad-report.json",bytes(JSON.stringify(edited))),()=>true),
 "IC020_P2C1_SIDECAR_INVALID");
}
for(const v of [null,undefined,true,0,"",[],new Date(),Object.create(null)]){
 reject(()=>matchSavedCoreReimportReport(v,fresh),"IC020_P2C1_SIDECAR_INVALID");
}
const sourceChoice=new Uint8Array(fs.readFileSync("tests/fixtures/import/ic020-p2a-consultant-dual-source.json"));
const choiceFile=file("consultant.json",sourceChoice);
const bySheet=await previewNetworkTopologyFile(choiceFile,{linkSourceChoice:"LINKS_SHEET"});
const byInline=await previewNetworkTopologyFile(choiceFile,{linkSourceChoice:"INLINE_CONNECTED_TO"});
eq(bySheet.ok,true);
eq(byInline.ok,true);
const sourceBase=createBuilderWorkspace(bySheet.source);
const a=await compareCoreNetworkReimport(sourceBase,bySheet,()=>true);
const b=await compareCoreNetworkReimport(sourceBase,byInline,()=>true);
const recordA=createSavedCoreReimportReport(a),recordB=createSavedCoreReimportReport(b);
eq(recordA.sourceLinkChoice,"LINKS_SHEET");
eq(recordB.sourceLinkChoice,"INLINE_CONNECTED_TO");
reject(()=>matchSavedCoreReimportReport(recordA,b),"IC020_P2C1_REPLAY_MISMATCH");
reject(()=>matchSavedCoreReimportReport(recordB,a),"IC020_P2C1_REPLAY_MISMATCH");
const choiceText=savedCoreReimportReportText(a);
yes(!choiceText.includes("SECRET_IC020_P2A_CANARY_NOT_REAL"));
eq(matchSavedCoreReimportReport(JSON.parse(choiceText),a).sourceLinkChoice,"LINKS_SHEET");
for(const [name,value] of [
 ["bad.txt",sidecarBytes],
 ["../sidecar.json",sidecarBytes],
 ["nested/sidecar.json",sidecarBytes],
 ["bad\u0000.json",sidecarBytes],
 ["sp ace.json",sidecarBytes],
 ["no.json.exe",sidecarBytes],
 ["-bad.json",sidecarBytes],
]){
 await rejectAsync(()=>readSavedCoreReimportReport(file(name,value),()=>true),"IC020_P2C1_SIDECAR_INVALID");
}
await rejectAsync(()=>readSavedCoreReimportReport(
 file("huge.json",new Uint8Array(16*1024+1)),()=>true),"IC020_P2C1_SIDECAR_INVALID");
await rejectAsync(()=>readSavedCoreReimportReport(
 file("declared-huge.json",sidecarBytes,16*1024+1),()=>true),"IC020_P2C1_SIDECAR_INVALID");
await rejectAsync(()=>readSavedCoreReimportReport(
 file("size-lie.json",sidecarBytes,sidecarBytes.byteLength-1),()=>true),"IC020_P2C1_SIDECAR_INVALID");
await rejectAsync(()=>readSavedCoreReimportReport(
 file("invalid-utf8.json",new Uint8Array([255,254,253])),()=>true),"IC020_P2C1_SIDECAR_INVALID");
await rejectAsync(()=>readSavedCoreReimportReport(
 file("truncated.json",bytes("{")) ,()=>true),"IC020_P2C1_SIDECAR_INVALID");
await rejectAsync(()=>readSavedCoreReimportReport(
 file("array.json",bytes("[]")),()=>true),"IC020_P2C1_SIDECAR_INVALID");
await rejectAsync(()=>readSavedCoreReimportReport(
 file("null.json",bytes("null")),()=>true),"IC020_P2C1_SIDECAR_INVALID");
await rejectAsync(()=>readSavedCoreReimportReport(
 file("report.json",sidecarBytes),()=>false),"IC020_P2C1_REPLAY_MISMATCH");
let times=0;
await rejectAsync(()=>readSavedCoreReimportReport(
 file("report.json",sidecarBytes),()=>++times<2),"IC020_P2C1_REPLAY_MISMATCH");
eq(times,2,"Epoch must be checked at read boundary");
await rejectAsync(()=>readSavedCoreReimportReport({
 name:"unread.json",size:16*1024+1,
 async arrayBuffer(){throw Error("Must never read declared oversized sidecar");}
},()=>true),"IC020_P2C1_SIDECAR_INVALID");
reject(()=>createSavedCoreReimportReport({...fresh,canAutoApply:true}),"IC020_P2C1_SIDECAR_INVALID");
reject(()=>createSavedCoreReimportReport({...fresh,engineVerified:true}),"IC020_P2C1_SIDECAR_INVALID");
reject(()=>createSavedCoreReimportReport({...fresh,physicalTopologyVerified:true}),"IC020_P2C1_SIDECAR_INVALID");
const ui=fs.readFileSync("ui/app/main.mjs","utf8");
for(const s of [
 "savedCoreReimportReportText(current)","readSavedCoreReimportReport(file,isCurrent)",
 "matchSavedCoreReimportReport(saved,current)",
 "data-network-reimport-export-report","data-network-reimport-replay-file",
 "MATCHED_REVIEW_ONLY",
 "setReimportApproved(false);setReimportReview(null);setSavedReplay(null)",
 "verifyNetworkTopologyOriginalForActivation(original,candidate,isCurrent)",
 "Approve replacing the entire current workspace",
]){
 yes(ui.includes(s),"Real UI must enforce P2c1 safe report and separate manual approval: "+s);
}
eq(builtinEnterpriseImportAdapters.map(x=>x.id),[
 "builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods",
],"Five established active enterprise adapters unchanged");
console.log("PASS IC-020 P2c1 saved read-only reimport report replay: "+n+
 " original/source/diff, strict untrusted sidecar schema, P2a choice, tamper/stale and no-automatic-approval assertions.");

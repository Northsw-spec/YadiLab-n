import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectStaticAnsibleSourceReadOnly } from "../../dist-browser-test/enterprise-import/src/structured-ansible-source-inspection.js";
import { reviewSharedStaticHostOriginalReference } from "../../dist-browser-test/ui/src/browser/shared-ansible-original-reference.js";
import { inspectSharedDocumentFileReadOnly } from "../../dist-browser-test/ui/src/browser/structured-document-inspection-file.js";
import { SharedAnsibleOrdinalReview } from "../../ui/app/shared-ansible-ordinal-review.mjs";
import { StructuredXmlInspectionPanel, StructuredXmlInspectionDetails } from "../../ui/app/structured-xml-inspection-panel.mjs";
import { builtinEnterpriseImportAdapters } from "../../dist-browser-test/enterprise-import/src/adapters.js";

let assertions = 0;
const eq = (a,b,msg) => { assert.deepEqual(a,b,msg); assertions++; };
const ok = (v,msg) => { assert.ok(v,msg); assertions++; };
const fixed = async (task,code) => {
  await assert.rejects(task,err => err?.code === code,"Expected "+code);
  assertions++;
};
const raw = name => Uint8Array.from(fs.readFileSync("tests/fixtures/import/"+name));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const file = (name,bytes) => ({
  name,size:bytes.byteLength,
  async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
});
const model = () => ({
  scenarioId:"ic010-sample",sourceRevision:7,
  resources:[{id:"router-a",label:"Router A"},{id:"server-b",label:"Server B"}],
});
const privateStrings = [
  "SYNTHETIC_SECRET_CANARY_NOT_REAL","SYNTHETIC_TOKEN_CANARY_NOT_REAL",
  "SECRET_INI_HOST_CANARY_DONT_EXPORT","SECRET_INI_GROUP_CANARY_DONT_EXPORT",
  "SECRET_INI_BECOME_CANARY_DONT_EXPORT","203.0.113.25","203.0.113.10",
  "protected01","app01","ansible_password","reportedConnectionAddress",
  "hostKey","lineNumber","groupPath","locators","inventoryName",
];
const examples=[
 ["inventory.yml",raw("ansible-yaml/valid-sensitive-vars.yml"),
  "ansible.inventory.static.yaml.v1","ansible-yaml-host-ordinal",0,1],
 ["inventory.ini",raw("ansible-ini/valid-multigroup.ini"),
  "ansible.inventory.static.ini.v1","ansible-ini-host-ordinal",0,2],
 ["inventory.ini",raw("ansible-ini/valid-sensitive-vars.ini"),
  "ansible.inventory.static.ini.v1","ansible-ini-host-ordinal",0,1],
];
for(const [name,bytes,profile,kind,ordinal,locatorCount] of examples){
  const expected=await inspectStaticAnsibleSourceReadOnly(name,bytes);
  eq(expected.status,"REVIEW_REQUIRED","Producer validated before review");
  const sourceHash=sha(bytes);
  const m=model();
  const decision={profileId:profile,sourceSha256:sourceHash,scenarioId:m.scenarioId,
    sourceRevision:m.sourceRevision,hostOrdinal:ordinal,resourceId:"router-a",
    acknowledgeNotVerified:true};
  const before=JSON.stringify(m);
  let reads=0;
  const original={...file(name,bytes),async arrayBuffer(){
    reads++;return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  }};
  const sidecar=await reviewSharedStaticHostOriginalReference(
    original,expected,()=>m,decision,()=>true);
  eq(reads,1,"Original source reread exactly once");
  eq(sidecar,{
    formatId:"yadilab.ic010.shared-static-ansible-reference",
    schemaVersion:"1.0.0",status:"REVIEWED_REFERENCE_ONLY",
    semanticTrack:"CONFIG_DOCUMENTED",canActivate:false,modelMutated:false,
    engineVerified:false,physicalTopologyVerified:false,
    source:{profileId:profile,sha256:sourceHash},
    sourceItem:{kind,sourceSha256:sourceHash,hostOrdinal:ordinal,originalLocatorCount:locatorCount},
    targetModel:{scenarioId:m.scenarioId,sourceRevision:m.sourceRevision,resourceId:"router-a"},
    assertion:"USER_ASSERTED_REFERENCE_NOT_VERIFIED",
  },"Exact redacted sidecar");
  eq(Object.isFrozen(sidecar),true,"Root immutable");
  eq(Object.isFrozen(sidecar.sourceItem),true,"Item immutable");
  eq(JSON.stringify(m),before,"No Builder mutation");
  eq(sha(bytes),sourceHash,"No source mutation");
  const serialized=JSON.stringify(sidecar);
  for(const secret of privateStrings)eq(serialized.includes(secret),false,
    "No raw host/group/credential in common sidecar: "+secret);
  eq(Object.hasOwn(sidecar,"engineState"),false);
  const denied={...decision,acknowledgeNotVerified:false};
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,denied,()=>true),
    "IC010_P3B_ACK_REQUIRED");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>null,decision,()=>true),
    "IC010_P3B_BUILDER_REQUIRED");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,
    {...decision,resourceId:"ghost"},()=>true),"IC010_P3B_STALE");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,
    {...decision,hostOrdinal:-1},()=>true),"IC010_P3B_SELECTION_INVALID");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,
    {...decision,hostOrdinal:999},()=>true),"IC010_P3B_SELECTION_INVALID");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,
    {...decision,hostOrdinal:0.2},()=>true),"IC010_P3B_SELECTION_INVALID");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,
    {...decision,sourceSha256:"f".repeat(64)},()=>true),"IC010_P3B_SOURCE_CHANGED");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,
    {...decision,scenarioId:"other"},()=>true),"IC010_P3B_STALE");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,
    {...decision,sourceRevision:8},()=>true),"IC010_P3B_STALE");
  await fixed(reviewSharedStaticHostOriginalReference(original,expected,()=>m,decision,()=>false),
    "IC010_P3B_STALE");
  // Correct-sized but different original is not the consented source.
  const changed=Uint8Array.from(bytes);
  changed[changed.length-1]=changed[changed.length-1]===10?32:10;
  await fixed(reviewSharedStaticHostOriginalReference(file(name,changed),expected,()=>m,decision,()=>true),
    "IC010_P3B_SOURCE_CHANGED");
  await fixed(reviewSharedStaticHostOriginalReference(
    {name,size:262145,async arrayBuffer(){throw Error("must not read large file");}},
    expected,()=>m,decision,()=>true),"IC010_P3B_SOURCE_BLOCKED");
  const changedSuffix={...file(name.endsWith(".ini")?"changed.yaml":"changed.ini",bytes)};
  await fixed(reviewSharedStaticHostOriginalReference(changedSuffix,expected,()=>m,decision,()=>true),
    "IC010_P3B_SOURCE_CHANGED");
}
{
  const bytes=raw("ansible-yaml/valid-sensitive-vars.yml"),name="inventory.yml";
  const expected=await inspectStaticAnsibleSourceReadOnly(name,bytes);
  const base=model(),decision={profileId:expected.profileId,sourceSha256:expected.sourceSha256,
    scenarioId:base.scenarioId,sourceRevision:base.sourceRevision,
    hostOrdinal:0,resourceId:"router-a",acknowledgeNotVerified:true};
  // During the real async File.arrayBuffer boundary the builder may change
  // without a revision increment; complete resource snapshot must be checked.
  let release;
  const delayed={name,size:bytes.byteLength,arrayBuffer(){
    return new Promise(resolve=>{release=()=>resolve(bytes.buffer.slice(
      bytes.byteOffset,bytes.byteOffset+bytes.byteLength));});
  }};
  const pending=reviewSharedStaticHostOriginalReference(delayed,expected,()=>base,decision,()=>true);
  ok(typeof release==="function","Actual deferred file read started");
  base.resources[0].label="MUTATED LABEL SAME REVISION";
  release();
  await fixed(pending,"IC010_P3B_STALE");
  const restored=model();
  let expired=false,releaseAgain;
  const pending2=reviewSharedStaticHostOriginalReference(
    {name,size:bytes.byteLength,arrayBuffer(){return new Promise(resolve=>{
      releaseAgain=()=>resolve(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    });}},expected,()=>restored,decision,()=>!expired);
  expired=true;releaseAgain();
  await fixed(pending2,"IC010_P3B_STALE");
  const noCrypto=await inspectSharedDocumentFileReadOnly(file("safe.xml",Uint8Array.from(
    Buffer.from("<nmaprun/>","utf8"))));
  eq(noCrypto.canActivate,false,"Untrusted XML never authorizes Ansible associations");
  await fixed(reviewSharedStaticHostOriginalReference(file("safe.xml",bytes),noCrypto,
    ()=>restored,decision,()=>true),"IC010_P3B_SOURCE_INVALID");
  await fixed(reviewSharedStaticHostOriginalReference(file(name,bytes),
    {...expected,documentLocator:{...expected.documentLocator,sourceSha256:"0".repeat(64)}},
    ()=>restored,decision,()=>true),"IC010_P3B_SOURCE_INVALID");
}
const one=await inspectStaticAnsibleSourceReadOnly("inventory.ini",
  raw("ansible-ini/valid-sensitive-vars.ini"));
const panel=renderToStaticMarkup(React.createElement(SharedAnsibleOrdinalReview,{
 result:one,model:model(),onExport(){} }));
for(const marker of [
  'data-ic010-p3b-review="REVIEW_REQUIRED"',
  'data-ic010-p3b-boundary="true"',
  'data-ic010-p3b-host="true"',
  'data-ic010-p3b-resource="true"',
  'data-ic010-p3b-ack="true"',
  'data-ic010-p3b-export="true"',
  "Source host #1",
  "UNVERIFIED",
]){
  ok(panel.includes(marker),"Rendered operator-only review marker "+marker);
}
const exportTag=panel.match(/<button[^>]*data-ic010-p3b-export="true"[^>]*>/)?.[0]??"";
ok(exportTag.includes("disabled"),"Review export disabled by default");
const ackTag=panel.match(/<input[^>]*data-ic010-p3b-ack="true"[^>]*>/)?.[0]??"";
ok(ackTag.includes("disabled"),"Separate review acknowledgement initially disabled");
for(const secret of privateStrings)eq(panel.includes(secret),false,"No original data in review DOM "+secret);
const runtime=renderToStaticMarkup(React.createElement(SharedAnsibleOrdinalReview,{
 result:one,model:null,onExport(){} }));
ok(runtime.includes('data-ic010-p3b-review="BUILDER_REQUIRED"'),"Runtime blocks reference export");
eq(/data-ic010-p3b-export="true"[^>]*>/.test(runtime),true,"Disabled control retained");
const shared=renderToStaticMarkup(React.createElement(StructuredXmlInspectionPanel,{
  inspectFile:inspectSharedDocumentFileReadOnly,onClose(){},workspaceIdentity:{},
  getCurrentWorkspaceIdentity(){return {};}
}));
ok(shared.includes('data-ic010-p2-panel="READ_ONLY"'),"P2 source chooser unchanged");
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
  ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"],
  "Five enterprise adapters still active");
console.log("PASS IC-010 P3b shared source-bound reviewed ordinal sidecar: "+
  assertions+" source, consent, Builder freshness, secret redaction, UI and truth-barrier assertions.");

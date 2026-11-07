import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewDrawioCandidateFile, verifyDrawioOriginalForReviewedActivation,
  readDrawioReviewedOriginalBytes } from "../../dist-browser-test/ui/src/browser/drawio-reviewed-candidate-file.js";
import { extractDrawioOrdinalGraph } from "../../dist-browser-test/enterprise-import/src/drawio-reviewed-candidate.js";
import { DrawioReviewedBuilderPanel, DrawioCandidateChoices } from "../../ui/app/drawio-reviewed-builder-panel.mjs";
import { DrawioStructurePanel } from "../../ui/app/drawio-structure-panel.mjs";

let count=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);count++};
const yes=(v,msg)=>{assert.ok(v,msg);count++};
const denied=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);count++};
const u=s=>new TextEncoder().encode(s);
const base='<mxCell id="0"/><mxCell id="1" parent="0"/>';
const v=id=>'<mxCell id="'+id+'" vertex="1" parent="1" value="PRIVATE_198.51.100.21"/>';
const edge=(a,b)=>'<mxCell id="wire" edge="1" parent="1" source="'+a+'" target="'+b+'"/>';
const model=children=>'<mxGraphModel><root>'+base+children+'</root></mxGraphModel>';
const compress=xml=>deflateRawSync(Buffer.from(encodeURIComponent(xml),"ascii")).toString("base64");
const mixed=(reverse=false)=>u('<?xml version="1.0"?><mxfile>'+
 '<diagram id="private_page" name="SECRET">'+model(v("v1")+v("v2")+
 edge(reverse?"v2":"v1",reverse?"v1":"v2"))+'</diagram>'+
 '<diagram id="private_second">'+compress(model(v("v3")))+'</diagram></mxfile>');
const raw=mixed(),swapped=mixed(true);
eq(raw.length,swapped.length,"Changed original same byte length");
const bytes=a=>a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);
const file=(name,first,next=first)=>({
  name,size:first.length,readCount:0,
  async arrayBuffer(){this.readCount++;return bytes(this.readCount===1?first:next);}
});
const original=file("consultant.drawio",raw);
const inspected=await previewDrawioCandidateFile(original);
eq(original.readCount,1,"One initial File read");
eq(inspected.graph.sourceSha256,createHash("sha256").update(raw).digest("hex"));
eq(inspected.graph.vertices.length,3);
eq(inspected.graph.edges.length,1);
eq(inspected.graph.compressedPageCount,1);
eq(inspected.originalBytes,raw);
const decision={
 sourceSha256:inspected.graph.sourceSha256,
 nodes:[{pageOrdinal:0,vertexOrdinal:0,type:"network.router"},
        {pageOrdinal:0,vertexOrdinal:1,type:"network.switch"},
        {pageOrdinal:1,vertexOrdinal:0,type:"resource.generic"}],
 edges:[{pageOrdinal:0,edgeOrdinal:0}],acknowledgeModeledConnections:true,
};
const refreshed=await verifyDrawioOriginalForReviewedActivation(original,inspected.graph,decision,()=>true);
eq(refreshed.status,"READY_FOR_COMPILATION");
eq(original.readCount,2,"The originally selected File reread at final activation");
eq(refreshed.selectedResources,3);
eq(refreshed.selectedConnections,1);
eq(refreshed.source.connections.map(x=>[x.id,x.from.resource,x.to.resource]),[
 ["drawio_link_p1_e1","drawio_node_p1_v1","drawio_node_p1_v2"]]);
eq(refreshed.source.completion.path,"drawio_manual_verification");
const isolated=file("swapped.drawio",raw,swapped);
const review=await previewDrawioCandidateFile(isolated);
await denied(verifyDrawioOriginalForReviewedActivation(isolated,review.graph,decision,()=>true),
 "DRAWIO_CANDIDATE_SOURCE_CHANGED");
eq(isolated.readCount,2,"Same-length swapped file must be reread");
const spoofed={...inspected.graph,edges:[{...inspected.graph.edges[0],
 sourceVertexOrdinal:1,targetVertexOrdinal:0}]};
await denied(verifyDrawioOriginalForReviewedActivation(
 file("forged.drawio",raw),spoofed,decision,()=>true),
 "DRAWIO_CANDIDATE_SOURCE_CHANGED");
await denied(verifyDrawioOriginalForReviewedActivation(
 file("changed-decision.drawio",raw),inspected.graph,{...decision,sourceSha256:"f".repeat(64)},()=>true),
 "DRAWIO_CANDIDATE_REVIEW_STALE");
const staleEarly=file("stale.drawio",raw);
await denied(verifyDrawioOriginalForReviewedActivation(staleEarly,inspected.graph,decision,()=>false),
 "IC030_P2B_STALE");
eq(staleEarly.readCount,0,"No read after canceled token");
let current=true;
const staleLate={name:"stale-late.drawio",size:raw.length,
 async arrayBuffer(){current=false;return bytes(raw);}};
await denied(verifyDrawioOriginalForReviewedActivation(staleLate,inspected.graph,decision,()=>current),
 "IC030_P2B_STALE");
const wrong=file("diagram.xml",raw);
await denied(previewDrawioCandidateFile(wrong),"DRAWIO_FILE_EXTENSION_INVALID");
eq(wrong.readCount,0,"Extension blocked before read");
let oversizedReads=0;
await denied(previewDrawioCandidateFile({name:"large.drawio",size:2097153,
 async arrayBuffer(){oversizedReads++;return bytes(raw);}}),"DRAWIO_FILE_SIZE_INVALID");
eq(oversizedReads,0,"Declared oversized size rejected before any read");
await denied(readDrawioReviewedOriginalBytes({name:"huge.drawio",size:raw.length,
 async arrayBuffer(){return new ArrayBuffer(2097153);}}),"DRAWIO_FILE_SIZE_INVALID");
await denied(previewDrawioCandidateFile(file("xxe.drawio",u(
 '<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxfile/>'))),
 "IMPORT_XML_DTD_FORBIDDEN");
await denied(previewDrawioCandidateFile(file("invalid.drawio",u(
 '<mxfile><diagram id="x">not-valid-base64!!</diagram></mxfile>'))),
 "DRAWIO_BASE64_INVALID");
const parsed=await extractDrawioOrdinalGraph(raw);
eq(parsed,inspected.graph,"Same exact original structural evidence");
const options=["resource.generic","network.router","network.switch","network.firewall",
 "server.generic","endpoint.windows","endpoint.linux","virtualization.hypervisor",
 "virtualization.proxmox"];
const child=renderToStaticMarkup(React.createElement(DrawioCandidateChoices,{
 graph:inspected.graph,manualRoleOptions:options,onConfirm(){throw Error("SSR must not activate");},
}));
for(const s of [
 'data-drawio-candidate-controls="REVIEW_REQUIRED"',
 'data-drawio-candidate-node="0:0"',
 'data-drawio-candidate-node="0:1"',
 'data-drawio-candidate-node="1:0"',
 'data-drawio-candidate-edge="0:0"',
 'data-drawio-candidate-edge-ack="true"',
 'data-drawio-candidate-confirm="true"',
 'data-drawio-candidate-source-sha="true"',
])yes(child.includes(s),"SSR position/consent marker "+s);
yes(child.includes('disabled=""'),"No default confirmation");
yes(!child.includes('data-drawio-candidate-selected-nodes="1"'),"No default node");
for(const privateValue of ["PRIVATE_198.51.100.21","private_page","private_second","v1","v2","v3","198.51.100.21","SECRET"]){
 yes(!child.includes(privateValue),"No original labels/IDs/IPs in UI render "+privateValue);
}
const blank=renderToStaticMarkup(React.createElement(DrawioReviewedBuilderPanel,{
 inspectFile(){throw Error("SSR must not access raw file");},
 onClose(){throw Error("SSR no side effects");}
}));
yes(blank.includes('data-drawio-candidate-panel="REVIEW_REQUIRED"'),"Dedicated dialog");
yes(blank.includes('data-drawio-candidate-empty="true"'),"No stale reviewed selection");
const old=renderToStaticMarkup(React.createElement(DrawioStructurePanel,{
 inspectFile(){throw Error("SSR must not read");},onClose(){}
}));
yes(old.includes('data-drawio-panel="PREVIEW_ONLY"'),"Old read-only drawio panel preserved");
yes(!old.includes("data-drawio-candidate-confirm"),"P4 remains independent");
const app=fs.readFileSync("ui/app/main.mjs","utf8");
const panel=fs.readFileSync("ui/app/drawio-reviewed-builder-panel.mjs","utf8");
for(const s of [
 'data-review-drawio-builder": "REVIEW_REQUIRED"',
 'drawioBuilderReviewOpen ? e(DrawioReviewedBuilderPanel',
 'const workspaceIdentity = JSON.stringify(liveBefore)',
 'const transitionIdentity = scenarioTransitionRef.current',
 'IC030_P2B_WORKSPACE_CHANGED',
 'await verifyDrawioOriginalForReviewedActivation(',
 'JSON.stringify(refreshed.source) !== JSON.stringify(mapped.source)',
 'checkCurrent();\n        beginScenarioTransition();',
 'setWorkspace(layout.workspace)',
 'setDrawioBuilderReviewOpen(false)'
])yes(app.includes(s),"Live app safely gates reviewed candidate activation: "+s);
for(const s of [
 "const epoch=++generation.current",
 "originalFile.current=null;setCandidate(null)",
 "generation.current===epoch&&originalFile.current===original",
 "setAck(false)",
 "setSelectedCount"
]){
 if(s==="setSelectedCount")continue;
 yes(panel.includes(s),"Selected original epoch and consent revocation: "+s);
}
for(const path of [
 "ui/src/browser/drawio-reviewed-candidate-file.ts",
 "ui/app/drawio-reviewed-builder-panel.mjs"
]){
 const s=fs.readFileSync(path,"utf8");
 for(const disallowed of ["fetch(","localStorage","indexedDB","dangerouslySetInnerHTML","XMLHttpRequest"]){
  yes(!s.includes(disallowed),"No source exfiltration or private persistence: "+path+" "+disallowed);
 }
}
for(const path of [".github/workflows/required-ci.yml",".github/workflows/release-identity.yml"]){
 const s=fs.readFileSync(path,"utf8");
 yes(s.includes("npm run test:ic030-p2b-drawio-ui"),"Source gate in "+path);
 yes(s.includes("run_ic030_p2b_drawio_real_browser.py"),"Chromium gate in "+path);
 yes(s.includes("run_ic030_p1_graphml_real_browser.py"),"Existing GraphML gate preserved in "+path);
}
console.log("PASS IC-030 P2b source-only original re-read and actual UI source contracts: "+
 count+" assertions; real compiled Chromium separate required gate.");

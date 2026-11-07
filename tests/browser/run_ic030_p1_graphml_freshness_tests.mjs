import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { compileBuilderWorkspace, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";
import { previewGraphmlFileReadOnly, verifyGraphmlOriginalForReviewedActivation }
  from "../../dist-browser-test/ui/src/browser/graphml-import-preview.js";
import { mapReviewedGraphmlToBuilder }
  from "../../dist-browser-test/enterprise-import/src/graphml-review-mapping.js";

let count=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);count++};
const yes=(v,label)=>{assert.ok(v,label);count++};
const blocked=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);count++};
const bytes=new Uint8Array(fs.readFileSync("tests/fixtures/import/graphml/valid-two-nodes.graphml"));
const different=new TextEncoder().encode(new TextDecoder().decode(bytes).replaceAll("router_1","router_9"));
eq(different.byteLength,bytes.byteLength,"Same-length different GraphML bytes");
const data=(x)=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength);
const document=(name,initial,second=initial)=>({
 name,size:initial.byteLength,readCount:0,
 async arrayBuffer(){
  this.readCount++;
  return data(this.readCount===1?initial:second);
 },
});
const actual=document("consultant.graphml",bytes);
const inspected=await previewGraphmlFileReadOnly(actual);
eq(actual.readCount,1,"One original read for initial structural review");
eq(inspected.preview.sourceSha256,crypto.createHash("sha256").update(bytes).digest("hex"));
eq(inspected.preview.nodes.map(n=>n.id),["router_1","switch_1"]);
eq(inspected.preview.edges.map(e=>[e.sourceId,e.targetId,e.directed]),[
 ["router_1","switch_1",false]]);
await verifyGraphmlOriginalForReviewedActivation(actual,inspected.preview,()=>true);
eq(actual.readCount,2,"The ACTUAL original File is reread before activation");
const decisions={
 sourceSha256:inspected.preview.sourceSha256,graphId:inspected.preview.graphId,
 roles:[{nodeOrdinal:0,type:"network.router"},{nodeOrdinal:1,type:"network.switch"}],
 modeledEdgeOrdinals:[],acknowledgeModeledConnections:false,
};
const withoutEdge=mapReviewedGraphmlToBuilder(inspected.preview,decisions);
eq(withoutEdge.status,"READY_FOR_COMPILATION");
eq(withoutEdge.source.connections.length,0,"Graph edge does not become a network cable");
const withEdge=mapReviewedGraphmlToBuilder(inspected.preview,{
 ...decisions,modeledEdgeOrdinals:[0],acknowledgeModeledConnections:true,
});
eq(withEdge.status,"READY_FOR_COMPILATION");
eq(withEdge.source.connections.length,1,"Explicitly chosen undirected connection only");
eq(withEdge.source.connections[0].properties,{},"No fabricated network observation");
eq(withEdge.source.completion.path,"graphml_manual_verification");
eq(withEdge.source.resources.every(x=>!Object.hasOwn(x.properties,"graphml_manual_verification")),true,
 "No verified state copied to graph resources");
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const checkSource=ajv.compile(sourceSchema),checkNormalized=ajv.compile(normalizedSchema);
const options={compilerContext:{
 validateSource:x=>({valid:!!checkSource(x),diagnostics:(checkSource.errors??[]).map(e=>e.message)}),
 validateNormalized:x=>({valid:!!checkNormalized(x),diagnostics:(checkNormalized.errors??[]).map(e=>e.message)}),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION
}};
for(const expected of [withoutEdge,withEdge]){
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(expected.source),options);
 eq(compiled.compile.status,"valid","Reviewed GraphML actual Builder compile");
 eq(compiled.source.connections.length,expected.selectedConnections);
}
const swap=document("swapped.graphml",bytes,different);
const old=await previewGraphmlFileReadOnly(swap);
await blocked(verifyGraphmlOriginalForReviewedActivation(swap,old.preview,()=>true),
 "IC030_P1_SOURCE_CHANGED");
eq(swap.readCount,2,"Mismatched original must be re-read rather than trusting preview");
const changed=await previewGraphmlFileReadOnly(document("different.graphml",different));
await blocked(verifyGraphmlOriginalForReviewedActivation(document("same-name.graphml",bytes),changed.preview,()=>true),
 "IC030_P1_SOURCE_CHANGED");
await blocked(verifyGraphmlOriginalForReviewedActivation(document("same.graphml",bytes),
 {...inspected.preview,graphId:"forged"},()=>true),"IC030_P1_SOURCE_CHANGED");
await blocked(verifyGraphmlOriginalForReviewedActivation(document("same.graphml",bytes),
 {...inspected.preview,edges:inspected.preview.edges.map(e=>({...e,directed:true}))},()=>true),
 "IC030_P1_SOURCE_CHANGED");
await blocked(verifyGraphmlOriginalForReviewedActivation(document("same.graphml",bytes),
 {...inspected.preview,sourceSha256:"f".repeat(64)},()=>true),
 "IC030_P1_SOURCE_CHANGED");
let readBefore=0;
const staleEarly=document("early.graphml",bytes);
await blocked(verifyGraphmlOriginalForReviewedActivation(staleEarly,inspected.preview,()=>false),
 "IC030_P1_STALE");
eq(staleEarly.readCount,0,"No obsolete file read after review cancelled");
let valid=true;
const staleLate={
 name:"late.graphml",size:bytes.byteLength,async arrayBuffer(){valid=false;return data(bytes);}
};
await blocked(verifyGraphmlOriginalForReviewedActivation(staleLate,inspected.preview,()=>valid),
 "IC030_P1_STALE");
let oversizedRead=0;
await blocked(verifyGraphmlOriginalForReviewedActivation({name:"large.graphml",
 size:2*1024*1024+1,async arrayBuffer(){oversizedRead++;return data(bytes)}},
 inspected.preview,()=>true),"GRAPHML_FILE_SIZE_INVALID");
eq(oversizedRead,0,"Reject declared excessive size before reading");
await blocked(verifyGraphmlOriginalForReviewedActivation({
 name:"wrong.xml",size:bytes.byteLength,async arrayBuffer(){return data(bytes);}
},inspected.preview,()=>true),"GRAPHML_FILE_EXTENSION_INVALID");
await blocked(verifyGraphmlOriginalForReviewedActivation({
 name:"evil.graphml",size:bytes.byteLength,async arrayBuffer(){
  return data(new Uint8Array(fs.readFileSync("tests/fixtures/import/graphml/adversarial-xxe.graphml")));}
},inspected.preview,()=>true),"IMPORT_XML_DTD_FORBIDDEN");
// Parse all real GraphML input checks; no plugin/browser network shim.
const mixed=await previewGraphmlFileReadOnly(document("mixed.graphml",
 new Uint8Array(fs.readFileSync("tests/fixtures/import/graphml/valid-mixed-directed.graphml"))));
const forbidden=mapReviewedGraphmlToBuilder(mixed.preview,{
 sourceSha256:mixed.preview.sourceSha256,graphId:mixed.preview.graphId,
 roles:[],modeledEdgeOrdinals:[1],acknowledgeModeledConnections:true,
});
eq(forbidden.status,"BLOCKED","Directed edges cannot become undirected cables");
eq(forbidden.diagnostics[0].code,"GRAPHML_DIRECTIONAL_EDGE_UNSUPPORTED");
const src=fs.readFileSync("ui/app/main.mjs","utf8"),panel=fs.readFileSync("ui/app/graphml-preview-panel.mjs","utf8");
for(const fragment of [
 "const workspaceIdentity = JSON.stringify(liveBefore)",
 "const transitionIdentity = scenarioTransitionRef.current",
 "IC030_P1_WORKSPACE_CHANGED",
 "await verifyGraphmlOriginalForReviewedActivation(originalFile, sourcePreview, isCurrentSelection)",
 "checkCurrent();\n        beginScenarioTransition();",
 "setWorkspace(layout.workspace)",
])yes(src.includes(fragment),"Actual UI original/live workspace activation gate: "+fragment);
for(const fragment of [
 "const originalRef = useRef(null)",
 "originalRef.current = file",
 "request.current === selectedRequest && originalRef.current === original",
 "return onConfirm(sourcePreview, decisions, original, isCurrent)",
])yes(panel.includes(fragment),"Preview dialog maintains original file and selection token: "+fragment);
execFileSync("python3",["-c",
 "import ast,pathlib; ast.parse(pathlib.Path('tests/acceptance/run_ic030_p1_graphml_real_browser.py').read_text(encoding='utf-8'))"],
 {stdio:["ignore","pipe","pipe"],timeout:8000});count++;
for(const flow of [".github/workflows/required-ci.yml",".github/workflows/release-identity.yml"]){
 const value=fs.readFileSync(flow,"utf8");
 yes(value.includes("npm run test:ic030-p1-graphml-freshness"),
  "Source gate must run on PR and postmerge "+flow);
 yes(value.includes("run_graphml_p2c_real_browser.py"),"Prior GraphML Chromium still invoked "+flow);
 yes(value.includes("run_ic030_p1_graphml_real_browser.py"),"New Chromium invoked "+flow);
}
console.log("PASS IC-030 P1 GraphML source re-read, structural freshness, live workspace and manual modeled edge safeguards: "+
 count+" assertions");

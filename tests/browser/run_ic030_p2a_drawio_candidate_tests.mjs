import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { compileBuilderWorkspace, createBuilderWorkspace, autoLayoutBuilder }
  from "../../dist-browser-test/ui/src/browser/index.js";
import { ElkLayoutBackend } from "../../dist-browser-test/layout/src/elk-backend.js";
import { previewDrawioStructure } from "../../dist-browser-test/enterprise-import/src/drawio-structural-preview.js";
import { reviewDrawioVertexAssociations } from "../../dist-browser-test/enterprise-import/src/drawio-association-review.js";
import { extractDrawioOrdinalGraph, mapReviewedDrawioOriginalToBuilder }
  from "../../dist-browser-test/enterprise-import/src/drawio-reviewed-candidate.js";

let assertions=0;
const eq=(a,b,why)=>{assert.deepEqual(a,b,why);assertions++};
const yes=(v,why)=>{assert.ok(v,why);assertions++};
const throws=async(p,code)=>{await assert.rejects(p,e=>e?.code===code,code);assertions++};
const utf=s=>new TextEncoder().encode(s);
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const secret="PRIVATE_CUSTOMER_192.0.2.17_PASSWORD_9821";
const base='<mxCell id="0"/><mxCell id="1" parent="0"/>';
const vertex=id=>'<mxCell id="'+id+'" vertex="1" parent="1" value="'+secret+'" style="network.router;ip=192.0.2.17"/>';
const edge=(id,a,b)=>'<mxCell id="'+id+'" edge="1" parent="1" source="'+a+'" target="'+b+'" value="verified_copper_NOT"/>';
const model=body=>'<mxGraphModel><root>'+base+body+'</root></mxGraphModel>';
const compressed=xml=>deflateRawSync(Buffer.from(encodeURIComponent(xml),"ascii")).toString("base64");
const diagram=(id,inner)=>'<diagram id="'+id+'" name="'+secret+'">'+inner+'</diagram>';
const raw= utf('<?xml version="1.0"?><mxfile>'+
  diagram("pageA",model(vertex("vrtr")+vertex("vsw")+edge("drawn","vrtr","vsw")))+
  diagram("pageB",compressed(model(vertex("vguest"))))+'</mxfile>');
const alternate=utf('<?xml version="1.0"?><mxfile>'+
  diagram("pageA",model(vertex("vrtr")+vertex("vsw")+edge("drawn","vsw","vrtr")))+
  diagram("pageB",compressed(model(vertex("vguest"))))+'</mxfile>');
const single=utf(model(vertex("n1")+vertex("n2")+edge("L1","n1","n2")));
const summary=await previewDrawioStructure(raw);
const graph=await extractDrawioOrdinalGraph(raw);
eq(graph.sourceSha256,digest(raw));
eq(graph.status,"REVIEW_REQUIRED");
eq(graph.profileId,"diagrams.drawio.reviewed-candidate.v1");
eq(graph.sourceProfileId,summary.profileId);
eq(graph.pageCount,2);
eq(graph.compressedPageCount,1);
eq(graph.vertexCount,3);
eq(graph.drawnEdgeCount,1);
eq(graph.vertices,[{pageOrdinal:0,vertexOrdinal:0},{pageOrdinal:0,vertexOrdinal:1},{pageOrdinal:1,vertexOrdinal:0}]);
eq(graph.edges,[{pageOrdinal:0,edgeOrdinal:0,sourceVertexOrdinal:0,targetVertexOrdinal:1}]);
eq(graph.canActivate,false);
eq(graph.engineVerified,false);
eq(graph.physicalTopologyVerified,false);
for(const field of [secret,"vrtr","vsw","vguest","pageA","pageB","192.0.2.17","PASSWORD_9821","verified_copper_NOT","style","mxCell"]){
 yes(!JSON.stringify(graph).includes(field),"No raw source field in structural ordinal graph: "+field);
}
eq(JSON.stringify(graph),JSON.stringify(await extractDrawioOrdinalGraph(raw)),"Deterministic graph extraction");
const sn=await extractDrawioOrdinalGraph(single);
eq(sn.pageCount,1);
eq(sn.compressedPageCount,0);
eq(sn.edges.map(x=>[x.sourceVertexOrdinal,x.targetVertexOrdinal]),[[0,1]]);
const opt=(nodes,edges=[],ack=false)=>({sourceSha256:graph.sourceSha256,nodes,edges,acknowledgeModeledConnections:ack});
const n0={pageOrdinal:0,vertexOrdinal:0},n1={pageOrdinal:0,vertexOrdinal:1},n2={pageOrdinal:1,vertexOrdinal:0};
const all=[n0,n1,n2];
const d0=opt(all);
const valid0=await mapReviewedDrawioOriginalToBuilder(raw,graph,d0);
eq(valid0.status,"READY_FOR_COMPILATION","Three reviewed vertices, zero inferred graph links");
eq(valid0.selectedResources,3);
eq(valid0.selectedConnections,0);
eq(valid0.source.resources.map(x=>[x.id,x.type,x.label]),[
 ["drawio_node_p1_v1","resource.generic","Drawn vertex page 1 position 1"],
 ["drawio_node_p1_v2","resource.generic","Drawn vertex page 1 position 2"],
 ["drawio_node_p2_v1","resource.generic","Drawn vertex page 2 position 1"],
]);
eq(valid0.source.connections,[]);
eq(valid0.source.completion.path,"drawio_manual_verification");
eq(valid0.source.completion.value,"VERIFIED");
eq(valid0.source.resources.some(x=>Object.hasOwn(x.properties,"drawio_manual_verification")),false);
const selected=opt([{...n1,type:"network.switch"},{...n0,type:"network.router"},n2],
  [{pageOrdinal:0,edgeOrdinal:0}],true);
const valid=await mapReviewedDrawioOriginalToBuilder(raw,graph,selected);
eq(valid.status,"READY_FOR_COMPILATION");
eq(valid.selectedResources,3);
eq(valid.selectedConnections,1);
eq(valid.source.resources.map(x=>x.type),["network.router","network.switch","resource.generic"]);
eq(valid.source.connections.map(x=>[x.id,x.from.resource,x.to.resource,x.kind]),[
 ["drawio_link_p1_e1","drawio_node_p1_v1","drawio_node_p1_v2","network"]]);
eq(valid.source.connections[0].properties,{});
eq(valid.origins.map(x=>[x.targetId,x.locator.kind,x.decision]),[
 ["drawio_node_p1_v1","drawio-vertex-ordinal","USER_SELECTED_ROLE"],
 ["drawio_node_p1_v2","drawio-vertex-ordinal","USER_SELECTED_ROLE"],
 ["drawio_node_p2_v1","drawio-vertex-ordinal","USER_SELECTED_VERTEX"],
 ["drawio_link_p1_e1","drawio-edge-ordinal","USER_MODELED_CONNECTION"],
]);
yes(valid.origins.every(x=>x.locator.sourceSha256===digest(raw)), "Exact original provenance for each selected resource/link");
for(const forbidden of [secret,"192.0.2.17","vrtr","vsw","pageA","PASSWORD_9821","verified_copper_NOT","mxCell"]){
 yes(!JSON.stringify(valid).includes(forbidden),"No source secrets in reviewed candidate: "+forbidden);
}
eq(JSON.stringify(valid),JSON.stringify(await mapReviewedDrawioOriginalToBuilder(raw,graph,selected)),
 "Source and workbook mapping deterministic");
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const validateSource=ajv.compile(sourceSchema),validateNormalized=ajv.compile(normalizedSchema);
const compilerOptions={compilerContext:{
 validateSource:x=>({valid:!!validateSource(x),diagnostics:(validateSource.errors??[]).map(e=>e.message)}),
 validateNormalized:x=>({valid:!!validateNormalized(x),diagnostics:(validateNormalized.errors??[]).map(e=>e.message)}),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION,
}};
for(const current of [valid0,valid]){
 eq(validateSource(current.source),true,"Real canonical source schema");
 const workspace=await compileBuilderWorkspace(createBuilderWorkspace(current.source),compilerOptions);
 eq(workspace.compile.status,"valid","Real Builder compiler");
 eq(workspace.source.resources.length,current.selectedResources);
 eq(workspace.source.connections.length,current.selectedConnections);
 const layout=await autoLayoutBuilder(workspace,new ElkLayoutBackend());
 eq(layout.ok,true,"Actual ELK Canvas layout");
 yes(layout.workspace.layout!==undefined,"Canvas positions generated by actual ELK");
}
const reject=async (decision,code,expected=graph,bytes=raw)=>{
 const result=await mapReviewedDrawioOriginalToBuilder(bytes,expected,decision);
 eq(result.status,"BLOCKED",code+" status");
 eq(result.diagnostics[0].code,code);
 eq(result.source,undefined,"Blocked model cannot expose ScenarioSource");
 eq(result.origins,[]);
};
await reject(opt([]),"DRAWIO_CANDIDATE_SELECTION_COUNT_INVALID");
await reject(opt(Array.from({length:21},()=>n0)),"DRAWIO_CANDIDATE_SELECTION_COUNT_INVALID");
await reject(opt([n0,n0]),"DRAWIO_CANDIDATE_NODE_SELECTION_INVALID");
await reject(opt([{pageOrdinal:2,vertexOrdinal:0}]),"DRAWIO_CANDIDATE_NODE_SELECTION_INVALID");
await reject(opt([{pageOrdinal:0,vertexOrdinal:2}]),"DRAWIO_CANDIDATE_NODE_SELECTION_INVALID");
await reject(opt([{pageOrdinal:0.5,vertexOrdinal:0}]),"DRAWIO_CANDIDATE_NODE_SELECTION_INVALID");
await reject(opt([{...n0,type:"endpoint.unknown"}]),"DRAWIO_CANDIDATE_NODE_SELECTION_INVALID");
await reject(opt([n0,n1],[{pageOrdinal:0,edgeOrdinal:0}],false),"DRAWIO_CANDIDATE_CONNECTION_ACK_REQUIRED");
await reject(opt([n0],[{pageOrdinal:0,edgeOrdinal:0}],true),"DRAWIO_CANDIDATE_EDGE_ENDPOINT_UNSELECTED");
await reject(opt([n0,n1],[{pageOrdinal:0,edgeOrdinal:0},{pageOrdinal:0,edgeOrdinal:0}],true),
 "DRAWIO_CANDIDATE_EDGE_SELECTION_INVALID");
await reject(opt([n0,n1],[{pageOrdinal:1,edgeOrdinal:0}],true),"DRAWIO_CANDIDATE_EDGE_SELECTION_INVALID");
await reject(opt([n0,n1],[{pageOrdinal:0,edgeOrdinal:1}],true),"DRAWIO_CANDIDATE_EDGE_SELECTION_INVALID");
await reject({...opt([n0]),sourceSha256:"f".repeat(64)},"DRAWIO_CANDIDATE_REVIEW_STALE");
await reject(opt([n0]),"DRAWIO_CANDIDATE_SOURCE_CHANGED",graph,alternate);
await reject(opt([n0]),"DRAWIO_CANDIDATE_SOURCE_INVALID",
 {...graph,canActivate:true});
await reject(opt([n0]),"DRAWIO_CANDIDATE_SOURCE_INVALID",
 {...graph,edges:[{...graph.edges[0],sourceVertexOrdinal:22}]});
await reject(opt([n0]),"DRAWIO_CANDIDATE_SOURCE_INVALID",
 {...graph,vertices:[graph.vertices[0],graph.vertices[0],graph.vertices[2]]});
await reject(opt([n0]),"DRAWIO_CANDIDATE_SOURCE_CHANGED",
 {...graph,edges:[{...graph.edges[0],sourceVertexOrdinal:1,targetVertexOrdinal:0}]});
await throws(extractDrawioOrdinalGraph(utf('<!DOCTYPE mxfile [<!ENTITY xx SYSTEM "file:///etc/shadow">]><mxfile/>')),"IMPORT_XML_DTD_FORBIDDEN");
await throws(extractDrawioOrdinalGraph(utf('<mxfile><diagram id="page0">NOT_BASE64_!</diagram></mxfile>')),"DRAWIO_BASE64_INVALID");
await throws(extractDrawioOrdinalGraph(new Uint8Array(2*1024*1024+1)),"DRAWIO_SOURCE_SIZE_INVALID");
await throws(extractDrawioOrdinalGraph(utf('<mxGraphModel><root>'+base+vertex("x")+
 vertex("y")+edge("z","x","missing")+'</root></mxGraphModel>')),"DRAWIO_EDGE_ENDPOINT_INVALID");
await throws(extractDrawioOrdinalGraph(utf('<mxGraphModel><root>'+base+vertex("x")+
 vertex("x")+'</root></mxGraphModel>')),"DRAWIO_DUPLICATE_CELL");
const oldReview=reviewDrawioVertexAssociations(summary,{
 scenarioId:"existing_builder",sourceRevision:1,
 resources:[{id:"existing_resource",label:"Existing modeled resource"}],
},{sourceSha256:summary.sourceSha256,scenarioId:"existing_builder",sourceRevision:1,
 acknowledgeNotVerified:true,references:[{pageOrdinal:0,vertexOrdinal:0,targetResourceId:"existing_resource"}]});
eq(oldReview.status,"READY_FOR_EXPORT","P4 reference-only API unchanged");
eq(oldReview.sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(oldReview.sidecar.modelMutated,false);
eq(Object.hasOwn(oldReview.sidecar,"connections"),false,"P4 metadata sidecar cannot create cables");
const source=fs.readFileSync("enterprise-import/src/drawio-reviewed-candidate.ts","utf8");
for(const forbidden of ["fetch(","setWorkspace(","indexedDB","localStorage","dangerouslySetInnerHTML"]){
 yes(!source.includes(forbidden),"No network, storage or UI/Engine mutation in candidate source: "+forbidden);
}
for(const workflow of [".github/workflows/required-ci.yml",".github/workflows/release-identity.yml"]){
 yes(fs.readFileSync(workflow,"utf8").includes("npm run test:ic030-p2a-drawio-candidate"),
 "Required exact-head and postmerge source CI for "+workflow);
}
console.log("PASS IC-030 P2a source-only diagrams.net reviewed ordinal candidate, original SHA, non-inference, real Builder compiler and ELK Canvas layout: "+
 assertions+" assertions; real P2a UI Chromium and native physical network NOT_RUN");

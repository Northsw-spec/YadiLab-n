import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { previewDrawioStructure } from "../../dist-browser-test/enterprise-import/src/drawio-structural-preview.js";
import { reviewDrawioVertexAssociations } from "../../dist-browser-test/enterprise-import/src/drawio-association-review.js";
import { replayDrawioSavedReferences } from "../../dist-browser-test/enterprise-import/src/drawio-report-replay.js";
import { DrawioVertexAssociationReview } from "../../ui/app/drawio-association-review.mjs";

let assertions=0;
const eq=(a,b,why)=>{assert.deepEqual(a,b,why);assertions++;};
const SECRET="CONFIDENTIAL_CUSTOMER_198.51.100.77_NEVER_RENDER";
const root='<mxCell id="0"/><mxCell id="1" parent="0"/>';
const vertices=(count,prefix)=>Array.from({length:count},(_,i)=>
  '<mxCell id="'+prefix+i+'" parent="1" vertex="1" value="'+SECRET+'"/>').join("");
const graph=s=>'<mxGraphModel><root>'+root+s+'</root></mxGraphModel>';
const compress=s=>deflateRawSync(Buffer.from(encodeURIComponent(s),"ascii")).toString("base64");
const xml45='<?xml version="1.0"?><mxfile><diagram id="p0" name="'+SECRET+'">'+
  graph(vertices(42,"v"))+'</diagram><diagram id="p1">'+
  compress(graph(vertices(3,"later")))+'</diagram></mxfile>';
const data=new TextEncoder().encode(xml45);
const preview=await previewDrawioStructure(data);
eq(preview.vertexCount,45);
eq(preview.pageCount,2);
eq(preview.compressedPageCount,1);
eq(preview.pages.map(p=>p.vertexCount),[42,3]);
const targets=Array.from({length:22},(_,i)=>({id:"builder_"+i,label:"Modeled "+i}));
const builder={scenarioId:"scenario_1",sourceRevision:7,resources:targets};
const before=JSON.stringify(builder);
const initial=renderToStaticMarkup(React.createElement(DrawioVertexAssociationReview,{
  preview,model:builder,onExport(){throw Error("Never export in SSR");}
}));
eq((initial.match(/data-drawio-associate-vertex="/g)||[]).length,20);
eq(initial.includes('data-drawio-associate-vertex="0:0"'),true);
eq(initial.includes('data-drawio-associate-vertex="0:19"'),true);
eq(initial.includes('data-drawio-associate-vertex="0:20"'),false);
eq(initial.includes('data-drawio-associate-vertex="1:2"'),false);
eq(initial.includes('data-drawio-total-positions="45"'),true);
eq(initial.includes('data-drawio-position-window="1"'),true);
eq(initial.includes('data-drawio-position-next="true"'),true);
eq(initial.includes('data-drawio-position-previous="true"'),true);
eq(initial.includes(SECRET),false);
eq(initial.includes('198.51.100.77'),false);
eq(initial.includes("first 20 drawn vertex positions are available"),false);
const original=JSON.stringify(preview);
const sha=createHash("sha256").update(data).digest("hex");
const references=Array.from({length:19},(_,i)=>({
  pageOrdinal:0,vertexOrdinal:i,targetResourceId:"builder_"+i}));
references.push({pageOrdinal:1,vertexOrdinal:2,targetResourceId:"builder_20"});
const decision={sourceSha256:sha,scenarioId:builder.scenarioId,sourceRevision:builder.sourceRevision,
 acknowledgeNotVerified:true,references};
const reviewed=reviewDrawioVertexAssociations(preview,builder,decision);
eq(reviewed.status,"READY_FOR_EXPORT");
eq(reviewed.sidecar.associations.length,20);
eq(reviewed.sidecar.associations[19].locator.pageOrdinal,1);
eq(reviewed.sidecar.associations[19].locator.vertexOrdinal,2);
eq(reviewed.sidecar.identityVerified,false);
eq(reviewed.sidecar.physicalTopologyVerified,false);
eq(reviewed.sidecar.engineVerified,false);
eq(reviewed.sidecar.modelMutated,false);
eq(JSON.stringify(reviewed.sidecar).includes(SECRET),false);
eq((await replayDrawioSavedReferences(
 data,new TextEncoder().encode(JSON.stringify(reviewed.sidecar)),builder,true)).referencesChecked,20);
const over=reviewDrawioVertexAssociations(preview,builder,{
 ...decision,references:[...references,{pageOrdinal:0,vertexOrdinal:41,targetResourceId:"builder_21"}]});
eq(over.status,"BLOCKED");
eq(over.diagnostics[0].code,"DRAWIO_ASSOC_COUNT_INVALID");
eq(JSON.stringify(builder),before);
eq(JSON.stringify(preview),original);
// Independent max-boundary document, with no extra unvalidated pages or bytes.
const maxSource=new TextEncoder().encode(graph(vertices(1000,"n")));
const thousand=await previewDrawioStructure(maxSource);
eq(thousand.vertexCount,1000);
const thousandSSR=renderToStaticMarkup(React.createElement(DrawioVertexAssociationReview,{
 preview:thousand,model:builder,onExport(){}
}));
eq((thousandSSR.match(/data-drawio-associate-vertex="/g)||[]).length,20);
eq(thousandSSR.includes('data-drawio-total-positions="1000"'),true);
eq(thousandSSR.includes('data-drawio-associate-vertex="0:999"'),false);
await assert.rejects(previewDrawioStructure(new TextEncoder().encode(graph(vertices(1001,"n")))),
 error=>error?.code==="DRAWIO_VERTEX_BUDGET");assertions++;
const code=fs.readFileSync("ui/app/drawio-association-review.mjs","utf8");
for(const forbidden of ["fetch(","localStorage","indexedDB","setWorkspace(","dangerouslySetInnerHTML"]){
 eq(code.includes(forbidden),false,forbidden);
}
eq(code.includes("atLimit&&!choices[x.key]"),true);
eq(code.includes("setChoices({})"),true);
eq(code.includes("setAck(false)"),true);
console.log("PASS DRAWIO P6 "+assertions+" independent 45/1000 ordinals, bounded SSR, reference replay, privacy and negative controls");

import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewOdtTableStructure } from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import { discloseReviewedOdtCell } from "../../dist-browser-test/enterprise-import/src/odt-cell-disclosure.js";
import { reviewOdtCellAssociation } from "../../dist-browser-test/enterprise-import/src/odt-association-review.js";
import { reviewOdtMultiReferences, ODT_MULTI_REFERENCE_FORMAT, MAX_ODT_REVIEWED_REFERENCES } from "../../dist-browser-test/enterprise-import/src/odt-multi-reference-review.js";
import { OdtMultiReferenceQueue } from "../../ui/app/odt-multi-reference-queue.mjs";
import { OdtReviewedCellAssociation } from "../../ui/app/odt-reviewed-cell-association.mjs";
import { makeOdtZip, packageEntries, table } from "../enterprise-import/odt_test_package.mjs";

const CANARY="ODT_SECRET_SOURCE_NEVER_EXPORTED_3759";
const bytes=makeOdtZip(packageEntries({tables:[
 table([["Hostname","Password"],["node01",CANARY],["edge02","abc123"]])
]}));
const sha=crypto.createHash("sha256").update(bytes).digest("hex");
const preview=await previewOdtTableStructure(bytes);
const model={scenarioId:"scenario_lab",sourceRevision:9,resources:[
 {id:"resource_a",label:"Modeled A"},
 {id:"resource_b",label:"Modeled B"},
 {id:"resource_c",label:"Modeled C"},
]};
const mk=async(row,target)=>{
 const locator=preview.tables[0].rows[row].cells[0].locator;
 const disclosed=await discloseReviewedOdtCell(bytes,sha,locator,true);
 const r=reviewOdtCellAssociation(disclosed,model,{
   sourceSha256:sha,scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
   targetResourceId:target,acknowledgeNotVerified:true,
 });
 assert.equal(r.status,"READY_FOR_EXPORT");
 return r.sidecar;
};
const a=await mk(1,"resource_a"),b=await mk(2,"resource_b"),c=await mk(0,"resource_c");
let checks=0;
const eq=(value,expected,message)=>{assert.deepEqual(value,expected,message);checks++;};
const decision={sourceSha256:sha,scenarioId:model.scenarioId,sourceRevision:9,
 acknowledgeNotVerified:true};
const blocked=(staged,m,d,expected)=>{
 const r=reviewOdtMultiReferences(staged,m,d);
 eq(r.status,"BLOCKED",expected);
 eq(r.diagnostics.map(x=>x.code),[expected]);
 eq(Object.hasOwn(r,"sidecar"),false);
};
const approved=reviewOdtMultiReferences([b,a],model,decision);
eq(approved.status,"READY_FOR_EXPORT");
eq(approved.sidecar.formatId,ODT_MULTI_REFERENCE_FORMAT);
eq(approved.sidecar.schemaVersion,"1.0.0");
eq(approved.sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(approved.sidecar.source,{profileId:"office.odt-tables.structural.v1",
 sha256:sha,semanticTrack:"CONFIG_DOCUMENTED"});
eq(approved.sidecar.targetModel,{scenarioId:"scenario_lab",sourceRevision:9});
eq(approved.sidecar.references.map(x=>x.cellLocator.rowOrdinal),[1,2]);
eq(approved.sidecar.references.map(x=>x.targetResourceId),["resource_a","resource_b"]);
eq(approved.sidecar.references.every(x=>x.cellLocator.kind==="odt-table-cell"&&
 x.cellLocator.part==="content.xml"&&x.cellLocator.sourceSha256===sha),true);
eq(approved.sidecar.references.every(x=>x.assertion==="USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"),true);
eq(approved.sidecar.engineVerified,false);
eq(approved.sidecar.physicalTopologyVerified,false);
eq(MAX_ODT_REVIEWED_REFERENCES,10);
const json=JSON.stringify(approved.sidecar);
for(const sensitive of [CANARY,"node01","edge02","Hostname","Password","abc123","textCodeUnits",'"text"',"cellText","sha256OfCell"]){
 eq(json.includes(sensitive),false,"no original ODT data: "+sensitive);
}
eq(JSON.stringify(reviewOdtMultiReferences([a,b],model,decision).sidecar),json,"stable sort");
const triple=reviewOdtMultiReferences([c,b,a],model,decision);
eq(triple.status,"READY_FOR_EXPORT");
eq(triple.sidecar.references.map(x=>x.cellLocator.rowOrdinal),[0,1,2]);
blocked([a],model,decision,"ODT_MULTI_COUNT_INVALID");
blocked(Array(11).fill(a),model,decision,"ODT_MULTI_COUNT_INVALID");
blocked([a,a],model,decision,"ODT_MULTI_DUPLICATE_REFERENCE");
blocked([a,{...b,association:{...b.association,targetResourceId:"resource_a"}}],model,decision,"ODT_MULTI_DUPLICATE_REFERENCE");
blocked([a,b],null,decision,"ODT_MULTI_BUILDER_REQUIRED");
blocked([a,b],model,{...decision,acknowledgeNotVerified:false},"ODT_MULTI_ACK_REQUIRED");
blocked([a,b],model,{...decision,sourceRevision:10},"ODT_MULTI_STALE");
blocked([a,b],model,{...decision,sourceSha256:"0".repeat(64)},"ODT_MULTI_REFERENCE_INVALID");
blocked([a,b],{...model,sourceRevision:10},decision,"ODT_MULTI_STALE");
blocked([a,b],{...model,resources:model.resources.slice(1)},decision,"ODT_MULTI_REFERENCE_INVALID");
blocked([a,b],{...model,resources:[model.resources[0],model.resources[0]]},decision,"ODT_MULTI_MODEL_INVALID");
blocked([a,b],{...model,resources:[{id:"__proto__",label:"bad"}]},decision,"ODT_MULTI_MODEL_INVALID");
blocked([a,{...b,source:{...b.source,sha256:"0".repeat(64)}}],model,decision,"ODT_MULTI_REFERENCE_INVALID");
blocked([a,{...b,engineVerified:true}],model,decision,"ODT_MULTI_REFERENCE_INVALID");
blocked([a,{...b,physicalTopologyVerified:true}],model,decision,"ODT_MULTI_REFERENCE_INVALID");
blocked([a,{...b,source:{...b.source,cellLocator:{...b.source.cellLocator,part:"word/document.xml"}}}],model,decision,"ODT_MULTI_LOCATOR_INVALID");
blocked([a,{...b,source:{...b.source,cellLocator:{...b.source.cellLocator,rowOrdinal:-1}}}],model,decision,"ODT_MULTI_LOCATOR_INVALID");
blocked([a,{...b,source:{...b.source,cellLocator:{...b.source.cellLocator,rowOrdinal:1.5}}}],model,decision,"ODT_MULTI_LOCATOR_INVALID");
blocked([a,{...b,source:{...b.source,extra:CANARY}}],model,decision,"ODT_MULTI_REFERENCE_INVALID");
blocked([a,{...b,extra:CANARY}],model,decision,"ODT_MULTI_REFERENCE_INVALID");
blocked([a,{...b,warnings:["forged",CANARY]}],model,decision,"ODT_MULTI_REFERENCE_INVALID");
blocked([a,{...b,targetModel:{...b.targetModel,sourceRevision:8}}],model,decision,"ODT_MULTI_REFERENCE_INVALID");
await assert.rejects(discloseReviewedOdtCell(bytes,sha,
 preview.tables[0].rows[1].cells[1].locator,true),
 e=>e?.code==="ODT_CELL_SENSITIVE_BLOCKED");checks++;
const html=renderToStaticMarkup(React.createElement(OdtMultiReferenceQueue,{
 items:[a,b],model,onRemove(){throw Error("SSR cannot remove");},
 onExport(){throw Error("SSR cannot export");},
}));
for(const marker of ['data-odt-multi-queue="REVIEWED_ASSOCIATIONS_ONLY"',
 'data-odt-multi-count="2"','data-odt-multi-items="true"',
 'data-odt-multi-ack="true"','data-odt-multi-export="true"',
 'disabled=""','UNVERIFIED']){
 assert.ok(html.includes(marker),"missing "+marker);checks++;
}
for(const raw of [CANARY,"node01","edge02","abc123","Hostname"]){
 eq(html.includes(raw),false,"no ODT raw source in UI "+raw);
}
const single=renderToStaticMarkup(React.createElement(OdtReviewedCellAssociation,{
 disclosed:await discloseReviewedOdtCell(bytes,sha,preview.tables[0].rows[1].cells[0].locator,true),
 model,onExportAssociation(){throw Error("SSR cannot export");},
 onStageAssociation(){throw Error("SSR cannot stage");},
}));
eq(single.includes('data-odt-multi-stage="true"'),true);
eq(single.includes('disabled=""'),true);
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
const panel=fs.readFileSync("ui/app/odt-structure-panel.mjs","utf8");
for(const regex of [/reviewOdtMultiReferences\(staged,currentModel,decision\)/,
 /onBuildAssociation:\(reviewedCell,decision\)/,/odt-reviewed-multi-/]){
 assert.match(main,regex);checks++;
}
for(const regex of [/onStageAssociation:stageReference/,
 /const fresh=await reviewFile\(source,result.preview.sourceSha256,loc,true\)/,
 /JSON.stringify\(verified\)!==JSON.stringify\(item\)/,
 /setMultiItems\(\[\]\)/,/onExport:exportMulti/]){
 assert.match(panel,regex);checks++;
}
for(const path of ["enterprise-import/src/odt-multi-reference-review.ts","ui/app/odt-multi-reference-queue.mjs"]){
 const s=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(", "indexedDB","localStorage","fetch(","console.log(","dangerouslySetInnerHTML"]){
  eq(s.includes(forbidden),false,"no persistence, active model or external action "+path);
 }
}
console.log("PASS ODT P5 "+checks+" ZIP P3/P4-derived actual sources, strict zero-value batch, SSR, stale/dup/fail-closed");

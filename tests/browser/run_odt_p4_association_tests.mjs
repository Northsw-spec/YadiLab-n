import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewOdtTableStructure } from "../../dist-browser-test/enterprise-import/src/odt-tables-structural-preview.js";
import { discloseReviewedOdtCell } from "../../dist-browser-test/enterprise-import/src/odt-cell-disclosure.js";
import { ODT_REVIEWED_ASSOCIATION_FORMAT,reviewOdtCellAssociation } from "../../dist-browser-test/enterprise-import/src/odt-association-review.js";
import { OdtReviewedCellAssociation } from "../../ui/app/odt-reviewed-cell-association.mjs";
import { OdtCellDisclosureReview } from "../../ui/app/odt-cell-disclosure-review.mjs";
import { makeOdtZip,packageEntries,table } from "../enterprise-import/odt_test_package.mjs";

const CANARY="TOP_SECRET_ODT_MUST_NEVER_BE_EXPORTED_973";
const zip=makeOdtZip(packageEntries({tables:[
 table([["Hostname","Password"],["node01",CANARY],["edge02","abc123"]])
]}));
const digest=crypto.createHash("sha256").update(zip).digest("hex");
const preview=await previewOdtTableStructure(zip);
const selected=preview.tables[0].rows[1].cells[0].locator;
const disclosed=await discloseReviewedOdtCell(zip,digest,selected,true);
const model={scenarioId:"lab_01",sourceRevision:2,resources:[
 {id:"host_001",label:"Server A"},{id:"router_001",label:"Router B"}]};
const decision={sourceSha256:digest,scenarioId:model.scenarioId,
 sourceRevision:model.sourceRevision,targetResourceId:"host_001",
 acknowledgeNotVerified:true};
let n=0;
function eq(a,b,message){assert.deepEqual(a,b,message);n++;}
function blocked(value,model_,decision_,code){
 const r=reviewOdtCellAssociation(value,model_,decision_);
 eq(r.status,"BLOCKED",code+" status");
 eq(r.diagnostics.map(d=>d.code),[code],code+" diagnostic");
 eq(Object.hasOwn(r,"sidecar"),false,code+" no sidecar");
}
const r=reviewOdtCellAssociation(disclosed,model,decision);
eq(r.status,"READY_FOR_EXPORT");
eq(r.diagnostics,[]);
eq(r.sidecar.formatId,ODT_REVIEWED_ASSOCIATION_FORMAT);
eq(r.sidecar.schemaVersion,"1.0.0");
eq(r.sidecar.status,"REVIEWED_ASSOCIATIONS_ONLY");
eq(r.sidecar.source.profileId,"office.odt-tables.structural.v1");
eq(r.sidecar.source.sha256,digest);
eq(r.sidecar.source.semanticTrack,"CONFIG_DOCUMENTED");
eq(r.sidecar.source.cellLocator,selected);
eq(r.sidecar.targetModel,{scenarioId:"lab_01",sourceRevision:2});
eq(r.sidecar.association,{targetResourceId:"host_001",
 assertion:"USER_ASSERTED_ASSOCIATION_NOT_VERIFIED"});
eq(r.sidecar.engineVerified,false);
eq(r.sidecar.physicalTopologyVerified,false);
const json=JSON.stringify(r.sidecar);
for(const forbidden of [CANARY,"node01","edge02","Hostname","Password",
 "abc123",'"text"', "textCodeUnits","cellText","192.0.2.15","privateKey"]){
 eq(json.includes(forbidden),false,"No original ODT value "+forbidden);
}
eq(JSON.stringify(reviewOdtCellAssociation(disclosed,model,decision).sidecar),json);
blocked(disclosed,null,decision,"ODT_ASSOC_BUILDER_REQUIRED");
blocked(disclosed,model,{...decision,acknowledgeNotVerified:false},"ODT_ASSOC_ACK_REQUIRED");
blocked(disclosed,model,{...decision,targetResourceId:"none"},"ODT_ASSOC_TARGET_INVALID");
blocked(disclosed,model,{...decision,targetResourceId:"__proto__"},"ODT_ASSOC_TARGET_INVALID");
blocked(disclosed,model,{...decision,sourceSha256:"0".repeat(64)},"ODT_ASSOC_STALE");
blocked(disclosed,model,{...decision,scenarioId:"other"},"ODT_ASSOC_STALE");
blocked(disclosed,model,{...decision,sourceRevision:3},"ODT_ASSOC_STALE");
blocked(disclosed,{...model,sourceRevision:3},decision,"ODT_ASSOC_STALE");
blocked(disclosed,{...model,resources:model.resources.slice(1)},decision,"ODT_ASSOC_TARGET_INVALID");
blocked(disclosed,{...model,resources:[model.resources[0],model.resources[0]]},
 decision,"ODT_ASSOC_MODEL_INVALID");
blocked(disclosed,{...model,resources:[{id:"__proto__",label:"bad"}]},
 decision,"ODT_ASSOC_MODEL_INVALID");
blocked({...disclosed,engineVerified:true},model,decision,"ODT_ASSOC_REVIEW_REQUIRED");
blocked({...disclosed,physicalTopologyVerified:true},model,decision,"ODT_ASSOC_REVIEW_REQUIRED");
blocked({...disclosed,sourceSha256:"x".repeat(64)},model,decision,"ODT_ASSOC_REVIEW_REQUIRED");
blocked({...disclosed,locator:{...selected,part:"wrong"}},model,decision,"ODT_ASSOC_REVIEW_REQUIRED");
blocked({...disclosed,locator:{...selected,rowOrdinal:1.5}},model,decision,"ODT_ASSOC_REVIEW_REQUIRED");
blocked({...disclosed,extra:CANARY},model,decision,"ODT_ASSOC_REVIEW_REQUIRED");
await assert.rejects(discloseReviewedOdtCell(zip,digest,
 preview.tables[0].rows[1].cells[1].locator,true),
 e=>e.code==="ODT_CELL_SENSITIVE_BLOCKED");n++;
const assocMarkup=renderToStaticMarkup(React.createElement(OdtReviewedCellAssociation,{
 disclosed,model,onExportAssociation(){throw Error("SSR export may not execute");}
}));
for(const token of ['data-odt-association="REVIEWED_ASSOCIATIONS_ONLY"',
 'data-odt-association-target="true"','data-odt-association-ack="true"',
 'data-odt-association-export="true"','data-odt-association-boundary="true"',
 'disabled=""','No resource selected (default)','UNVERIFIED']){
 assert.ok(assocMarkup.includes(token),"Missing SSR marker "+token);n++;
}
for(const sensitive of [CANARY,"node01","edge02"]){
 eq(assocMarkup.includes(sensitive),false,"No ODT cell value in resource UI");
}
const empty=renderToStaticMarkup(React.createElement(OdtReviewedCellAssociation,{
 disclosed,model:null
}));
eq(empty.includes('data-odt-association-model-blocked="true"'),true);
eq(empty.includes('data-odt-association-target="true"'),false);
const p3Markup=renderToStaticMarkup(React.createElement(OdtCellDisclosureReview,{
 preview,onRevealCell(){throw Error("SSR cannot disclose");},model,onExportAssociation(){}
}));
eq(p3Markup.includes('data-odt-association="REVIEWED_ASSOCIATIONS_ONLY"'),false);
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
const panel=fs.readFileSync("ui/app/odt-structure-panel.mjs","utf8");
for(const pattern of [/reviewOdtCellAssociation\(reviewedCell,currentModel,decision\)/,
 /onExportAssociation:\(reviewedCell,decision\)/,
 /odt-reviewed-reference-/,
 /reviewFile: reviewOdtFileCell/]) {assert.match(main,pattern);n++;}
for(const pattern of [
 /const fresh=await reviewFile\(source,result.preview.sourceSha256,/,
 /fresh.text!==disclosed.text/,
 /JSON.stringify\(fresh.locator\)!==JSON.stringify\(disclosed.locator\)/,
 /source!==localFile.current/,
 /onExportAssociation:async\(disclosed,decision\)/]){
 assert.match(panel,pattern);n++;
}
for(const filename of ["enterprise-import/src/odt-association-review.ts",
 "ui/app/odt-reviewed-cell-association.mjs"]){
 const src=fs.readFileSync(filename,"utf8");
 for(const forbidden of ["setWorkspace(", "fetch(", "indexedDB",
  "localStorage", "dangerouslySetInnerHTML", "console.log(", "console.error("]){
  eq(src.includes(forbidden),false,filename+" no network/Builder mutation");
 }
}
console.log("PASS ODT P4 "+n+" metadata-only one-source review, stale resource/consent, SSR and security negatives");

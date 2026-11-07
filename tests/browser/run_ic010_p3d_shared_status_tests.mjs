import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {inspectSharedDocumentFileReadOnly} from "../../dist-browser-test/ui/src/browser/structured-document-inspection-file.js";
import {builtinEnterpriseImportAdapters, selectEnterpriseImportAdapter} from "../../dist-browser-test/enterprise-import/src/adapters.js";
import {makeOdtZip,packageEntries,table} from "../enterprise-import/odt_test_package.mjs";
import {StructuredXmlInspectionPanel,StructuredXmlInspectionDetails} from "../../ui/app/structured-xml-inspection-panel.mjs";
import {validateSharedSourceReviewResult,sharedReviewLifecycle,sharedSourceTrackMeaning}
  from "../../ui/app/shared-source-review-contract.mjs";

let checks=0;
const eq=(a,b,n)=>{assert.deepEqual(a,b,n);checks++};
const ok=(v,n)=>{assert.ok(v,n);checks++};
const guard=x=>{assert.throws(()=>validateSharedSourceReviewResult(x),
  e=>e?.code==="IC010_P3D_RESULT_INVALID" &&
    e?.message==="IC010_P3D_RESULT_INVALID");checks++};
const bytes=x=>new TextEncoder().encode(x);
const hash=x=>crypto.createHash("sha256").update(x).digest("hex");
const src=x=>Uint8Array.from(fs.readFileSync("tests/fixtures/import/"+x));
const file=(name,buffer)=>({name,size:buffer.byteLength,async arrayBuffer(){
  return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
}});
const freeze=x=>Object.freeze(x);
const fcopy=x=>freeze({...x});
const docxTypes="http://schemas.openxmlformats.org/package/2006/content-types";
const docxRels="http://schemas.openxmlformats.org/package/2006/relationships";
const word="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const main="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const backend=new ZipJsArchiveBackend();
const members={
  "[Content_Types].xml":'<Types xmlns="'+docxTypes+'"><Override PartName="/word/document.xml" ContentType="'+main+'"/></Types>',
  "_rels/.rels":'<Relationships xmlns="'+docxRels+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml":'<w:document xmlns:w="'+word+'"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>SECRET_DOCX_P3D</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
};
const blob=await backend.write(Object.entries(members).map(([path,text])=>({
  path,bytes:bytes(text),
})));
const docx=new Uint8Array(await blob.arrayBuffer());
const odt=makeOdtZip(packageEntries({tables:[table([["SECRET_ODT_P3D"]])]}));
const cases=[
  ["example.graphml",src("graphml/valid-two-nodes.graphml"),
   "graphml.structural.v1","REVIEW_REQUIRED","TOPOLOGY_DECLARED","GRAPH_STRUCTURE"],
  ["example.drawio",bytes('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" vertex="1" parent="1"/></root></mxGraphModel>'),
   "diagrams.drawio.v1","PREVIEW_ONLY","TOPOLOGY_DECLARED","DRAWIO_DIAGRAM"],
  ["scan.xml",src("nmap-xml/valid-observed-hosts.xml"),
   "nmap.xml.v1","EVIDENCE_ONLY","EVIDENCE_OBSERVED","NMAP_OBSERVATIONS"],
  ["report.nessus",bytes('<NessusClientData_v2><Report name="PRIVATE_P3D_NESSUS"><ReportHost name="PRIVATE_HOST"><ReportItem severity="4" pluginID="100" port="443" protocol="tcp"/></ReportHost></Report></NessusClientData_v2>'),
   "nessus.xml.v1","EVIDENCE_ONLY","EVIDENCE_OBSERVED","NESSUS_REPORT"],
  ["hosts.yml",src("ansible-yaml/valid-sensitive-vars.yml"),
   "ansible.inventory.static.yaml.v1","REVIEW_REQUIRED","CONFIG_DOCUMENTED","ANSIBLE_YAML_INVENTORY"],
  ["hosts.ini",src("ansible-ini/valid-sensitive-vars.ini"),
   "ansible.inventory.static.ini.v1","REVIEW_REQUIRED","CONFIG_DOCUMENTED","ANSIBLE_INI_INVENTORY"],
  ["network.docx",docx,
   "office.docx-tables.structural.v1","REVIEW_REQUIRED","CONFIG_DOCUMENTED","DOCX_TABLE_STRUCTURE"],
  ["network.odt",odt,
   "office.odt-tables.structural.v1","REVIEW_REQUIRED","CONFIG_DOCUMENTED","ODT_TABLE_STRUCTURE"],
];
const actual=[];
for(const [name,data,profile,status,track,kind] of cases){
  const result=await inspectSharedDocumentFileReadOnly(file(name,data));
  eq(result.status,status,profile+" producer status");
  eq(result.profileId,profile,profile+" source identity");
  eq(result.semanticTrack,track,profile+" truth track");
  eq(result.summary.kind,kind,profile+" typed summary kind");
  eq(result.sourceSha256,hash(data),profile+" original-byte SHA");
  eq(result.documentLocator,{kind:"source-document",profileId:profile,sourceSha256:hash(data)});
  const serialized=JSON.stringify(result);
  const validated=validateSharedSourceReviewResult(result);
  eq(validated,result,"Valid producer was accepted unchanged: "+profile);
  eq(JSON.stringify(validated),serialized,"P3b original key order/source serialization stable");
  ok(Object.isFrozen(validated),"P3d returned original frozen metadata");
  const html=renderToStaticMarkup(React.createElement(StructuredXmlInspectionDetails,{result:validated}));
  for(const text of [
    'data-ic010-p3d-source-meaning="'+track+'"',
    'data-ic010-p2-profile="'+profile+'"',
    'data-ic010-p2-status="'+status+'"',
    'data-ic010-p2-track="'+track+'"',
    'data-ic010-p2-activation="BLOCKED"',
    sharedSourceTrackMeaning(track),hash(data),
  ])ok(html.includes(text),"Fixed safe meaning, source or status displayed: "+text);
  const combined=serialized+html;
  for(const secret of ["SECRET_DOCX_P3D","SECRET_ODT_P3D","PRIVATE_P3D_NESSUS",
    "SYNTHETIC_SECRET_CANARY_NOT_REAL","SECRET_INI_HOST_CANARY_DONT_EXPORT"]){
    eq(combined.includes(secret),false,"Private raw source secret is absent "+secret);
  }
  actual.push(validated);
}
const statuses=["REVIEW_REQUIRED","PREVIEW_ONLY","EVIDENCE_ONLY","BLOCKED"];
const tracks=["TOPOLOGY_DECLARED","EVIDENCE_OBSERVED","CONFIG_DOCUMENTED","ENGINE_VERIFIED"];
for(let i=0;i<actual.length;i++){
  const result=actual[i];
  for(const status of statuses)if(status!==result.status)
    guard(fcopy({...result,status}));
  for(const track of tracks)if(track!==result.semanticTrack)
    guard(fcopy({...result,semanticTrack:track}));
  for(let j=0;j<actual.length;j++)if(j!==i){
    guard(fcopy({...result,profileId:actual[j].profileId}));
    guard(fcopy({...result,summary:actual[j].summary}));
    guard(fcopy({...result,documentLocator:actual[j].documentLocator}));
  }
  for(const key of ["canActivate","modelMutated","engineVerified","physicalTopologyVerified"])
    guard(fcopy({...result,[key]:true}));
  guard(fcopy({...result,status:"ACTIVATED"}));
  guard(fcopy({...result,sourceSha256:"f".repeat(64)}));
  guard(fcopy({...result,sourceSha256:"A".repeat(64)}));
  guard(fcopy({...result,sourceSha256:"not-hash"}));
  guard(fcopy({...result,extraPrivateSourceContent:"SYNTHETIC_PRIVATE_CREDENTIAL"}));
  guard(fcopy({...result,hostnames:["private.example.invalid"]}));
  guard(fcopy({...result,docxCellContents:["SECRET"]}));
  guard(fcopy({...result,documentLocator:freeze({...result.documentLocator,sourceSha256:"a".repeat(64)})}));
  guard(fcopy({...result,documentLocator:freeze({...result.documentLocator,kind:"host-verified"})}));
  guard(fcopy({...result,summary:freeze({...result.summary,unexpectedDeviceCount:400})}));
  guard(fcopy({...result,summary:freeze({...result.summary,[Object.keys(result.summary)[1]]:-1})}));
  guard(fcopy({...result,summary:freeze({...result.summary,[Object.keys(result.summary)[1]]:1.4})}));
  guard(fcopy({...result,summary:freeze({...result.summary,[Object.keys(result.summary)[1]]:Number.MAX_SAFE_INTEGER+1})}));
  guard({...result}); // forged mutable record must never reach shared UI
  guard(fcopy({...result,summary:{...result.summary}})); // mutable nested
  guard(fcopy({...result,documentLocator:{...result.documentLocator}}));
}
const ansible=actual[4],office=actual[6];
guard(fcopy({...ansible,summary:freeze({...ansible.summary,originalHostLocatorCount:-1})}));
guard(fcopy({...ansible,summary:freeze({...ansible.summary,originalHostLocatorCount:0})}));
guard(fcopy({...office,summary:freeze({...office.summary,sourceBoundCellLocators:0})}));
guard(fcopy({...office,summary:freeze({...office.summary,declaredRows:0})}));
guard(fcopy({...office,summary:freeze({...office.summary,structuralCells:0})}));
for(const x of [null,undefined,false,true,1,"",[],new Date()])guard(x);
for(const [name,data] of [
  ["bad.graphml",bytes("<not-graph/>")],
  ["bad.ini",bytes("[hosts]\nansible_connection=local\n")],
  ["bad.odt",bytes("this is definitely not an ODT archive 123456789")],
]){
  const result=await inspectSharedDocumentFileReadOnly(file(name,data));
  eq(result.status,"BLOCKED","Invalid parsed source blocked at producer");
  eq(validateSharedSourceReviewResult(result),result,"Known fixed producer-block reason retained");
  guard(fcopy({...result,sourceSha256:"a".repeat(64)}));
  guard(fcopy({...result,summary:{kind:"GRAPH_STRUCTURE",nodes:2,graphEdges:1}}));
  guard(fcopy({...result,code:"IC010_P3D_NEW_UNAUTHORIZED_CODE"}));
  guard(fcopy({...result,engineVerified:true}));
  guard(fcopy({...result,candidateProfileIds:["private customer name"]}));
}
for(const [name,spec] of Object.entries({
  selected:{selected:true,consent:false},
  consented:{selected:true,consent:true},
  inspecting:{selected:true,consent:true,busy:true},
  blocked:{selected:true,consent:true,error:"IC010_XML_CONTENT_UNRECOGNIZED"},
  reviewing:{selected:true,consent:true,result:actual[0]},
  preview:{selected:true,consent:true,result:actual[1]},
  evidence:{selected:true,consent:true,result:actual[2]},
  producerDenied:{selected:true,consent:true,result:{
    status:"BLOCKED",
  }},
  staleClosed:{selected:false,consent:true,busy:true,result:actual[0],error:"any"},
})){
 const expected={
   selected:"AWAITING_CONSENT",consented:"READY_TO_INSPECT",inspecting:"INSPECTING",
   blocked:"BLOCKED",reviewing:"REVIEW_REQUIRED",preview:"PREVIEW_ONLY",
   evidence:"EVIDENCE_ONLY",producerDenied:"BLOCKED",staleClosed:"NO_SOURCE",
 }[name];
 eq(sharedReviewLifecycle(spec),expected,"Derived review state "+name);
}
eq(sharedReviewLifecycle(),"NO_SOURCE");
for(const track of ["TOPOLOGY_DECLARED","EVIDENCE_OBSERVED","CONFIG_DOCUMENTED"])
 ok(sharedSourceTrackMeaning(track).includes("not"),"Semantic type explicitly unverified: "+track);
eq(sharedSourceTrackMeaning("UNKNOWN"),"No verified source classification.");
const empty=renderToStaticMarkup(React.createElement(StructuredXmlInspectionPanel,{
  inspectFile:inspectSharedDocumentFileReadOnly,workspaceIdentity:{},onClose(){},
  getCurrentWorkspaceIdentity(){return {}},model:null,
}));
ok(empty.includes('data-ic010-p3d-lifecycle="NO_SOURCE"'),"Initial UI state explicit");
ok(empty.includes('data-ic010-p2-panel="READ_ONLY"'),"Old P2 modal DOM selector retained");
ok(empty.includes('accept=".graphml,.drawio,.nessus,.xml,.yml,.yaml,.ini,.docx,.odt"'),
  "All eight producer subsets retained");
for(const needle of [
  "validateSharedSourceReviewResult(next)",
  "sharedReviewLifecycle({",
  "P3C|P3D)_[A-Z0-9_]+$",
]){
  ok(fs.readFileSync("ui/app/structured-xml-inspection-panel.mjs","utf8").includes(needle),
     "Shared panel actually enforces P3d source guard: "+needle);
}
ok(fs.readFileSync("ui/app/shared-source-review-contract.mjs","utf8")
     .includes("IC010_P3D_RESULT_INVALID"),
  "P3d contract module exports fixed safe rejection code");
eq(builtinEnterpriseImportAdapters.map(x=>x.id),
  ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"],
  "Active enterprise adapter contract unchanged");
eq(selectEnterpriseImportAdapter("text/csv").id,"builtin.csv");
console.log("PASS IC-010 P3d shared source status/provenance: "+checks+
  " eight-profile producer, mismatched status/track/summary, immutable source SHA, blocked result, safe lifecycle and UI assertions.");

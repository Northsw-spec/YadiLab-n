import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectStructuredXmlFileReadOnly } from "../../dist-browser-test/ui/src/browser/structured-xml-inspection-file.js";
import { StructuredXmlInspectionPanel, StructuredXmlInspectionDetails } from "../../ui/app/structured-xml-inspection-panel.mjs";
import { builtinEnterpriseImportAdapters } from "../../dist-browser-test/enterprise-import/src/adapters.js";
import { inspectPlannedExternalSource } from "../../dist-browser-test/enterprise-import/src/planned-format-profiles.js";

let count = 0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);count++;};
const yes=(value,message)=>{assert.ok(value,message);count++;};
const file=(name,bytes,declaredSize=bytes.length)=>({
  name,size:declaredSize,
  async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
});
const raw=(path)=>new Uint8Array(fs.readFileSync(path));
const txt=(s)=>new TextEncoder().encode(s);
const sha=(bytes)=>crypto.createHash("sha256").update(bytes).digest("hex");
const blocked=async(f,code)=>{
  await assert.rejects(inspectStructuredXmlFileReadOnly(f),
    err=>err?.code===code,code);count++;
};
const valid=raw("tests/fixtures/import/nmap-xml/valid-observed-hosts.xml");
const graph=raw("tests/fixtures/import/graphml/valid-two-nodes.graphml");
const nessus=txt('<NessusClientData_v2><Report name="PRIVATE_REPORT"><ReportHost name="SECRET_HOST"><ReportItem severity="4" pluginID="100" port="443" protocol="tcp"/></ReportHost></Report></NessusClientData_v2>');
const drawio=txt('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" vertex="1"/><mxCell id="b" parent="1" vertex="1"/><mxCell id="ab" parent="1" edge="1" source="a" target="b"/></root></mxGraphModel>');
for(const [name,bytes,profile,status,track,summary] of [
  ["site.graphml",graph,"graphml.structural.v1","REVIEW_REQUIRED","TOPOLOGY_DECLARED","GRAPH_STRUCTURE"],
  ["scan.xml",valid,"nmap.xml.v1","EVIDENCE_ONLY","EVIDENCE_OBSERVED","NMAP_OBSERVATIONS"],
  ["report.nessus",nessus,"nessus.xml.v1","EVIDENCE_ONLY","EVIDENCE_OBSERVED","NESSUS_REPORT"],
  ["network.drawio",drawio,"diagrams.drawio.v1","PREVIEW_ONLY","TOPOLOGY_DECLARED","DRAWIO_DIAGRAM"],
]){
  const result=await inspectStructuredXmlFileReadOnly(file(name,bytes));
  eq(result.status,status);
  eq(result.profileId,profile);
  eq(result.semanticTrack,track);
  eq(result.sourceSha256,sha(bytes));
  eq(result.documentLocator,{kind:"source-document",profileId:profile,sourceSha256:sha(bytes)});
  eq(result.summary.kind,summary);
  eq(result.canActivate,false);
  eq(result.modelMutated,false);
  eq(result.engineVerified,false);
  eq(result.physicalTopologyVerified,false);
  const html=renderToStaticMarkup(React.createElement(StructuredXmlInspectionDetails,{result}));
  for(const expected of ['data-ic010-p2-result="'+status+'"','data-ic010-p2-sha="true"',
    'data-ic010-p2-source-locator="source-document"','data-ic010-p2-activation="BLOCKED"',
    "not verified cables",sha(bytes),profile]){
    yes(html.includes(expected),"Expected safe UI detail "+expected);
  }
  for(const forbidden of ["PRIVATE_REPORT","SECRET_HOST","192.0.2.10","<script>","<mxCell","application/xml"]){
    eq(html.includes(forbidden),false,"Source content absent from shared metadata UI");
  }
}
const panelHtml=renderToStaticMarkup(React.createElement(StructuredXmlInspectionPanel,{
  inspectFile:inspectStructuredXmlFileReadOnly,onClose(){},workspaceIdentity:{},getCurrentWorkspaceIdentity(){return {};}
}));
for(const marker of ['role="dialog"','aria-modal="true"','data-ic010-p2-panel="READ_ONLY"',
  'data-ic010-p2-file="true"','accept=".graphml,.drawio,.nessus,.xml,.yml,.yaml,.ini,.docx,.odt"',
  'data-ic010-p2-consent="true"','data-ic010-p2-inspect="true"',
  'data-ic010-p2-close="true"','data-ic010-p2-empty="true"']){
  yes(panelHtml.includes(marker),"Shared UI marker "+marker);
}
const consentTag=panelHtml.match(/<input[^>]*data-ic010-p2-consent="true"[^>]*>/)?.[0] ?? "";
const inspectTag=panelHtml.match(/<button[^>]*data-ic010-p2-inspect="true"[^>]*>/)?.[0] ?? "";
yes(consentTag.includes("disabled"),"Consent starts disabled");
yes(inspectTag.includes("disabled"),"Inspection starts disabled");
eq(/data-network-import-activate|data-active-probe-engine|data-graphml-map-confirm/.test(panelHtml),false,
  "No activation or probe controls in shared panel");
const safeError=renderToStaticMarkup(React.createElement(StructuredXmlInspectionDetails,{
  result:{status:"BLOCKED",code:"IC010_XML_CONTENT_UNRECOGNIZED",canActivate:false}
}));
yes(safeError.includes("IC010_XML_CONTENT_UNRECOGNIZED"),"Fixed blocking code only");
eq(safeError.includes("<script>"),false,"No untrusted HTML emitted");

const invalid=txt('<!DOCTYPE nmaprun [<!ENTITY ext SYSTEM "file:///etc/passwd">]><nmaprun scanner="nmap"/>');
for(const [name,bytes,code] of [
  ["nmap.xml",invalid,"IC010_XML_CONTENT_UNRECOGNIZED"],
  ["nmap.xml",txt("<nmaprun scanner=\"wrong\"/>"),"IC010_XML_CONTENT_UNRECOGNIZED"],
  ["site.graphml",valid,"IC010_XML_CONTENT_UNRECOGNIZED"],
  ["scan.xml",graph,"IC010_XML_CONTENT_UNRECOGNIZED"],
  ["scan.yaml",valid,"IC010_XML_EXTENSION_UNSUPPORTED"],
  ["path/scan.xml",valid,"IC010_XML_FILENAME_INVALID"],
]){
  const result=await inspectStructuredXmlFileReadOnly(file(name,bytes));
  eq(result.status,"BLOCKED");
  eq(result.code,code);
  eq(result.canActivate,false);
}
let reads=0;
await blocked({name:"oversize.xml",size:2*1024*1024+1,async arrayBuffer(){reads++;return new ArrayBuffer(1);}},
  "IC010_XML_FILE_SIZE_INVALID");
eq(reads,0,"Oversized declared file never read");
await blocked({name:"zero.xml",size:0,async arrayBuffer(){reads++;return new ArrayBuffer(1);}},
  "IC010_XML_FILE_SIZE_INVALID");
eq(reads,0,"Empty declared file never read");
await blocked({name:"forged.xml",size:1,async arrayBuffer(){return new ArrayBuffer(2*1024*1024+1);}},
  "IC010_XML_FILE_READ_INVALID");
await blocked({name:"forged.xml",size:1,async arrayBuffer(){return "not an ArrayBuffer";}},
  "IC010_XML_FILE_READ_INVALID");
await blocked({name:"empty.xml",size:1,async arrayBuffer(){return new ArrayBuffer(0);}},
  "IC010_XML_FILE_READ_INVALID");
await blocked({name:"empty.xml",size:NaN,async arrayBuffer(){return new ArrayBuffer(1);}},
  "IC010_XML_FILE_SIZE_INVALID");
await blocked(null,"IC010_XML_FILE_INVALID");
eq(builtinEnterpriseImportAdapters.map(x=>x.id),["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"],
  "Five active adapters unaffected");
eq(inspectPlannedExternalSource("scan.xml").status,"BLOCKED","Planned generic XML still BLOCKED");
console.log("PASS IC-010 P2 read-only XML file/UI contract: "+count+
  " format, security, privacy, consent DOM, source and truth-barrier assertions. No Builder or Engine.");

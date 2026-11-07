import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewNessusSeveritySummary } from "../../dist-browser-test/enterprise-import/src/nessus-v2-preview.js";
import { previewNessusFileReadOnly } from "../../dist-browser-test/ui/src/browser/nessus-v2-file-preview.js";
import { NessusSeverityPanel, NessusSeverityDetails } from "../../ui/app/nessus-severity-panel.mjs";

const secret="SECRET_SCAN_PLUGIN_PASSWORD_TOKEN_NEVER_RENDER_92457";
const host='<ReportHost name="SECRET-HOSTNAME-198.51.100.40"><HostProperties>'+
 '<tag name="host-ip">203.0.113.88</tag></HostProperties>';
const item=(severity,extra='')=>'<ReportItem pluginID="19506" port="443" protocol="tcp" severity="'+severity+'" pluginName="Never display">'+
 '<plugin_output>'+secret+extra+'</plugin_output><description>PRIVATE-UNTRUSTED-DETAIL</description></ReportItem>';
const report=(body,rootExtra='')=>'<?xml version="1.0" encoding="UTF-8"?>'+
 '<NessusClientData_v2>'+rootExtra+'<Report name="Sensitive customer environment">'+body+'</Report></NessusClientData_v2>';
const source=report(host+item(0)+item(2)+'</ReportHost>'+
 '<ReportHost name="host-secret-2">'+item(4)+item(3)+'</ReportHost>');
const enc=s=>new TextEncoder().encode(s);
let assertions=0;
function eq(got,want,label){assert.deepEqual(got,want,label);assertions++;}
function file(name,bytes,size=bytes.byteLength){return {name,size,async arrayBuffer(){
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}};}
const raw=enc(source);
const expectedSha=createHash("sha256").update(raw).digest("hex");
const result=await previewNessusSeveritySummary(raw);
eq(result.status,"EVIDENCE_ONLY");
eq(result.profileId,"nessus.xml.severity-summary.v1");
eq(result.semanticTrack,"EVIDENCE_OBSERVED");
eq(result.sourceSha256,expectedSha);
eq(result.hostCount,2);
eq(result.findingCount,4);
eq(result.severityCounts,[1,0,1,1,1]);
eq(result.canActivate,false);
eq(result.engineVerified,false);
eq(result.physicalTopologyVerified,false);
eq(Object.isFrozen(result),true);
eq(Object.isFrozen(result.severityCounts),true);
eq(await previewNessusFileReadOnly(file("case.NESSUS",raw)),result);
const sensitive=[secret,"SECRET-HOSTNAME","198.51.100.40","203.0.113.88",
 "Sensitive customer environment","Never display","PRIVATE-UNTRUSTED-DETAIL","plugin_output"];
for(const value of sensitive){eq(JSON.stringify(result).includes(value),false,"Result leaked "+value);}
async function block(input,code){
 await assert.rejects(previewNessusSeveritySummary(input),e=>{
   return e?.code===code && !sensitive.some(x=>String(e?.message).includes(x));
 },code);assertions++;
}
async function fileBlock(name,bytes,code,size=bytes.byteLength){
 await assert.rejects(previewNessusFileReadOnly(file(name,bytes,size)),e=>e?.code===code,code);
 assertions++;
}
await block(enc('<nmaprun scanner="nmap"/>'),"NESSUS_XML_ROOT_INVALID");
await block(enc(report(host+item(8)+'</ReportHost>')),"NESSUS_XML_SEVERITY_INVALID");
await block(enc(report(host+item("0.1")+'</ReportHost>')),"NESSUS_XML_SEVERITY_INVALID");
await block(enc(report(host+item(1).replace('pluginID="19506"','pluginID="SECRET"')+'</ReportHost>')),"NESSUS_XML_PLUGIN_ID_INVALID");
await block(enc(report(host+item(1).replace('port="443"','port="65536"')+'</ReportHost>')),"NESSUS_XML_PORT_INVALID");
await block(enc(report(host+item(1).replace('protocol="tcp"','protocol=""')+'</ReportHost>')),"NESSUS_XML_PROTOCOL_INVALID");
await block(enc(report('<ReportHost>'+item(1)+'</ReportHost>')),"NESSUS_XML_HOST_INVALID");
await block(enc('<NessusClientData_v2/>'),"NESSUS_XML_CARDINALITY_INVALID");
await block(enc(report(host+'</ReportHost>') .replace('</NessusClientData_v2>','<Report name="duplicate"/></NessusClientData_v2>')),"NESSUS_XML_CARDINALITY_INVALID");
await block(enc(report(host+'</ReportHost>','<Injected/>')),"NESSUS_XML_STRUCTURE_UNSUPPORTED");
await block(enc(report(host+'<HostProperties/><HostProperties/></ReportHost>')),"NESSUS_XML_CARDINALITY_INVALID");
await block(enc(report(host+'<Unexpected/> </ReportHost>')),"NESSUS_XML_STRUCTURE_UNSUPPORTED");
await block(enc(report(host+'<ReportItem severity="0" pluginID="1" protocol="tcp"/></ReportHost>')),"NESSUS_XML_PORT_INVALID");
await block(enc(report(host+item(2)+'</ReportHost>').replace("<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
 '<!DOCTYPE NessusClientData_v2 [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>')),"IMPORT_XML_DTD_FORBIDDEN");
await block(enc('<?xml version="1.0"?><?xml-stylesheet href="https://attacker.example/xsl"?><NessusClientData_v2/>'),
 "IMPORT_XML_PROCESSING_INSTRUCTION_FORBIDDEN");
await block(new Uint8Array([0xff,0xfe,0xfd]),"IMPORT_XML_INVALID_UTF8");
await block(new Uint8Array(2*1024*1024+1),"NESSUS_XML_SOURCE_SIZE_INVALID");
await block(enc(report('<ReportHost name="x"/>' .repeat(257))),"NESSUS_XML_HOST_BUDGET");
await block(enc(report('<ReportHost name="x">'+'<ReportItem severity="0" pluginID="1" port="0" protocol="tcp"/>'.repeat(10001)+'</ReportHost>')),"NESSUS_XML_FINDING_BUDGET");
for(const name of ["evil.xml","../valid.nessus","a.nessus/../b.nessus","valid.nessus\\bad"]){
 await fileBlock(name,raw,"NESSUS_FILE_EXTENSION_INVALID");
}
await fileBlock("valid.nessus",raw,"NESSUS_FILE_SIZE_INVALID",2*1024*1024+1);
await assert.rejects(previewNessusFileReadOnly({
 name:"valid.nessus",size:100,async arrayBuffer(){return new Uint8Array([1,2,3]);},
}),e=>e?.code==="NESSUS_FILE_SIZE_INVALID");assertions++;
const markup=renderToStaticMarkup(React.createElement(NessusSeverityPanel,{
 inspectFile(){throw Error("SSR must not read");},onClose(){throw Error("SSR must not close");}
}));
for(const marker of ['data-nessus-panel="EVIDENCE_ONLY"','data-nessus-file="true"',
 'data-nessus-empty="true"','data-nessus-close="true"']){
 assert.ok(markup.includes(marker),marker);assertions++;
}
eq(markup.includes('data-nessus-summary="EVIDENCE_ONLY"'),false);
const summary=renderToStaticMarkup(React.createElement(NessusSeverityDetails,{result}));
eq(summary.includes('data-nessus-summary="EVIDENCE_ONLY"'),true);
eq(summary.includes('data-nessus-activation-status="BLOCKED"'),true);
for(const value of sensitive)eq(summary.includes(value),false,"DOM leaked "+value);
const fs=await import("node:fs");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const re of [/data-inspect-nessus": "EVIDENCE_ONLY"/,
 /nessusSeverityOpen \? e\(NessusSeverityPanel/,
 /inspectFile: previewNessusFileReadOnly/]){
 assert.match(main,re);assertions++;
}
for(const path of ["enterprise-import/src/nessus-v2-preview.ts",
 "ui/src/browser/nessus-v2-file-preview.ts","ui/app/nessus-severity-panel.mjs"]){
 const code=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(", "dangerouslySetInnerHTML", "localStorage",
  "indexedDB","console.log(","fetch(","XMLHttpRequest"]){
  eq(code.includes(forbidden),false,"No side-effects: "+path);
 }
}
console.log("PASS NESSUS P1/P2 "+assertions+" real-shaped XML, severity counts, input budgets, XXE, privacy, SSR and no Engine");

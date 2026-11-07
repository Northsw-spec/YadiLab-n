import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import {ENGINE_VERSION} from "../../dist-browser-test/engine/src/index.js";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";
import {previewOfficeNodesFile,verifyOfficeCandidateFile} from "../../dist-browser-test/ui/src/browser/office-reviewed-nodes-file.js";
import {compileBuilderWorkspace,createBuilderWorkspace} from "../../dist-browser-test/ui/src/browser/index.js";

// IC-040 P9 FROZEN BEFORE product changes: TEN original source-selected nodes
// and NINE independently approved Links rows including P7/P8 distinct parallel
// source ports. Every older P4/P5/P6/P7/P8 decision remains exactly bounded.
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=b=>createHash("sha256").update(b).digest("hex");
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const cell=s=>'<w:tc><w:tcPr/><w:p><w:r><w:t>'+s+'</w:t></w:r></w:p></w:tc>';
async function docx(tables){
 const body='<w:document xmlns:w="'+WORD+'"><w:body>'+tables.map(rows=>
  '<w:tbl><w:tblPr/><w:tblGrid/>'+rows.map(row=>
    '<w:tr>'+row.map(cell).join("")+'</w:tr>').join("")+'</w:tbl>').join("")+
  '</w:body></w:document>';
 const parts={
  "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
  "_rels/.rels":'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>',
  "word/document.xml":body,
 };
 const b=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:enc.encode(data)})));
 return new Uint8Array(await b.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
const devices=[["Device ID","Private"],
 ["sw01","PRIVATE_NODE_5101"],["fw01","PRIVATE_NODE_5102"],
 ["rt01","PRIVATE_NODE_5103"],["srv01","PRIVATE_NODE_5104"],
 ["pc01","PRIVATE_NODE_5105"],["pc02","PRIVATE_NODE_5106"],
 ["ap01","PRIVATE_NODE_5107"],["db01","PRIVATE_NODE_5108"],
 ["nas01","PRIVATE_NODE_5109"],["vpn01","PRIVATE_NODE_5110"]];
const links=[["Source","Destination","Local port","Remote port"],
 ["sw01","fw01","eth1","eth0"],
 ["sw01","fw01","eth2","eth1"],
 ["sw01","rt01","eth3","eth0"],
 ["sw01","srv01","eth4","eth0"],
 ["pc01","pc02","eth0","eth0"],
 ["sw01","ap01","eth5","eth0"],
 ["srv01","db01","eth1","eth0"],
 ["sw01","nas01","eth6","eth0"],
 ["rt01","vpn01","eth1","eth0"]];
const roles=["network.switch","network.firewall","network.router","server.generic",
 "endpoint.windows","endpoint.linux","network.switch","server.generic",
 "server.generic","network.router"];
const nodes=roles.map((role,i)=>({
 tableOrdinal:0,rowOrdinal:i+1,nodeIdCellOrdinal:0,role,acknowledgeCell:true,
}));
const linkRows=[1,2,3,4,5,6,7,8,9].map(rowOrdinal=>({
 tableOrdinal:1,rowOrdinal,fromCellOrdinal:0,toCellOrdinal:1,
 sourcePortCellOrdinal:2,targetPortCellOrdinal:3,
 acknowledgeFromCell:true,acknowledgeToCell:true,
 acknowledgeSourcePortCell:true,acknowledgeTargetPortCell:true,
}));
const decision=(format,hash,overrides={})=>({
 format,sourceSha256:hash,nodes,acknowledgeModeledResources:true,
 linkRows,acknowledgeModeledLinkRows:true,
 capacityProfile:"office.reviewed-network-tables.ten-by-nine-parallel-port-links.v1",
 ...overrides,
});
const file=(name,bytes)=>({name,size:bytes.byteLength,async arrayBuffer(){
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const vsrc=ajv.compile(schema),vnorm=ajv.compile(normalizedSchema);
const validate=fn=>v=>({valid:Boolean(fn(v)),diagnostics:(fn.errors??[]).map(x=>x.message)});
const options={compilerContext:{validateSource:validate(vsrc),
 validateNormalized:validate(vnorm),catalog:{capabilities:catalog.capabilities,
 profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};
const expected=[
 ["sw01","eth1","fw01","eth0"],["sw01","eth2","fw01","eth1"],
 ["sw01","eth3","rt01","eth0"],["sw01","eth4","srv01","eth0"],
 ["pc01","eth0","pc02","eth0"],
 ["sw01","eth5","ap01","eth0"],
 ["srv01","eth1","db01","eth0"],
 ["sw01","eth6","nas01","eth0"],
 ["rt01","eth1","vpn01","eth0"],
];
let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
const yes=(a,label)=>{assert.ok(a,label);checks++};
const deny=async(p,code)=>{await assert.rejects(p,e=>e?.code===code||e?.message===code,code);checks++};
for(const [format,make] of [["docx",docx],["odt",odt]]){
 const original=await make([devices,links]),f=file("network."+format,original);
 const preview=await previewOfficeNodesFile(f);
 eq(preview.preview.sourceSha256,sha(original),format+" exact full ZIP provenance");
 eq(preview.preview.tables.length,2,format+" separate node and link table");
 eq(preview.preview.textIncluded,false,format+" no bulk original source disclosure");
 const d=decision(format,sha(original));
 const candidate=await verifyOfficeCandidateFile(f,preview,d,()=>true);
 eq(candidate.status,"READY_FOR_COMPILATION",format+" reviewed P9 ten-node nine-link profile");
 eq(candidate.selectedResources,10,format+" ten separate original ID consents");
 eq(candidate.selectedConnections,9,format+" nine independent original Links rows");
 eq(candidate.source.resources.map(x=>[x.id,x.type]),
  [["sw01","network.switch"],["fw01","network.firewall"],["rt01","network.router"],
   ["srv01","server.generic"],["pc01","endpoint.windows"],["pc02","endpoint.linux"],
   ["ap01","network.switch"],["db01","server.generic"],
   ["nas01","server.generic"],["vpn01","network.router"]],
  format+" exact original node identities and manual roles");
 const pairs=source=>source.connections.map(x=>
  [x.from.resource,x.from.port,x.to.resource,x.to.port]);
 eq(pairs(candidate.source),expected,format+" exact nine source-declared endpoint and port pairs");
 eq(candidate.source.resources.map(x=>[x.id,(x.interfaces??[]).map(i=>i.id).sort()]),
  [["sw01",["eth1","eth2","eth3","eth4","eth5","eth6"]],
   ["fw01",["eth0","eth1"]],["rt01",["eth0","eth1"]],["srv01",["eth0","eth1"]],
   ["pc01",["eth0"]],["pc02",["eth0"]],["ap01",["eth0"]],["db01",["eth0"]],
   ["nas01",["eth0"]],["vpn01",["eth0"]]],
  format+" all modeled interfaces from original cells, no extras");
 eq(candidate.linkRowOrigins.map(x=>[x.fromLocator.tableOrdinal,
    x.fromLocator.rowOrdinal,x.toLocator.rowOrdinal]),
  [[1,1,1],[1,2,2],[1,3,3],[1,4,4],[1,5,5],[1,6,6],[1,7,7],
   [1,8,8],[1,9,9]],
  format+" exactly nine original row locators, no inferred rows");
 eq(candidate.linkRowOrigins.map(x=>x.targetId),
  ["office_link_row_1","office_link_row_2","office_link_row_3","office_link_row_4",
   "office_link_row_5","office_link_row_6","office_link_row_7",
   "office_link_row_8","office_link_row_9"],
  format+" unique connection IDs, including both parallel links");
 eq(candidate.portOrigins.length,9,format+" nine independent original port-pair locators");
 eq(candidate.canActivate,false);eq(candidate.engineVerified,false);
 eq(candidate.physicalTopologyVerified,false);
 eq(candidate.source.tests,[],format+" no synthetic Engine probes");
 eq(candidate.source.completion.path,"office_manual_verification",
  format+" imported topology is not a green self-certified objective");
 yes(vsrc(candidate.source),format+" valid canonical Source "+JSON.stringify(vsrc.errors));
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(candidate.source),options);
 eq(compiled.compile.status,"valid",format+" real compiler valid "+JSON.stringify(compiled.compile.diagnostics));
 eq(pairs(compiled.source),expected,format+" actual compiled Builder retains exactly nine original links");
 for(const item of devices.slice(1))yes(!JSON.stringify(candidate).includes(item[1]),
  format+" unselected private cell not copied");
 // Older P8 remains an independent versioned 8/7, even on this full ZIP.
 const p8={...d,capacityProfile:"office.reviewed-network-tables.eight-by-seven-parallel-port-links.v1",
  nodes:nodes.slice(0,8),linkRows:linkRows.slice(0,7)};
 const eight=await verifyOfficeCandidateFile(f,preview,p8,()=>true);
 eq(eight.selectedResources,8,format+" legacy P8 selected exactly eight");
 eq(eight.selectedConnections,7,format+" legacy P8 retained seven source links");
 const p7={...d,capacityProfile:"office.reviewed-network-tables.six-by-five-parallel-port-links.v1",
  nodes:nodes.slice(0,6),linkRows:linkRows.slice(0,5)};
 const seven=await verifyOfficeCandidateFile(f,preview,p7,()=>true);
 eq(seven.selectedResources,6,format+" legacy P7 still six");
 eq(seven.selectedConnections,5,format+" legacy P7 still five");
 for(const [profile,code] of [
  ["office.reviewed-network-tables.eight-by-seven-parallel-port-links.v1","IC040_P8_CAPACITY_DECISION_INVALID"],
  ["office.reviewed-network-tables.six-by-five-parallel-port-links.v1","IC040_P7_CAPACITY_DECISION_INVALID"],
  ["office.reviewed-network-tables.six-by-five.v1","IC040_P5_CAPACITY_DECISION_INVALID"],
  ["office.reviewed-network-tables.six-by-five-optional-ports.v1","IC040_P6_CAPACITY_DECISION_INVALID"],
 ])await deny(verifyOfficeCandidateFile(f,preview,{...d,capacityProfile:profile},()=>true),code);
 const p4={format,sourceSha256:sha(original),nodes:nodes.slice(0,4),
  acknowledgeModeledResources:true,linkRows:[linkRows[0],linkRows[2],linkRows[3]],
  acknowledgeModeledLinkRows:true};
 const old=await verifyOfficeCandidateFile(f,preview,p4,()=>true);
 eq(old.selectedResources,4,format+" original P4 node limit intact");
 eq(old.selectedConnections,3,format+" original P4 links intact");
 await deny(verifyOfficeCandidateFile(f,preview,{...p4,linkRows:linkRows.slice(0,2)},()=>true),
  "IC040_P4_DUPLICATE_ENDPOINT_PAIR");
 await deny(verifyOfficeCandidateFile(f,preview,decision(format,sha(original),{
  capacityProfile:"office.reviewed-network-tables.UNKNOWN",
 }),()=>true),"IC040_P5_CAPACITY_PROFILE_INVALID");
 await deny(verifyOfficeCandidateFile(f,preview,decision(format,sha(original),{
  nodes:nodes.slice(0,9),
 }),()=>true),"IC040_P9_CAPACITY_DECISION_INVALID");
 await deny(verifyOfficeCandidateFile(f,preview,decision(format,sha(original),{
  linkRows:linkRows.slice(0,8),
 }),()=>true),"IC040_P9_CAPACITY_DECISION_INVALID");
 await deny(verifyOfficeCandidateFile(f,preview,decision(format,sha(original),{
  linkRows:linkRows.map((r,i)=>i===8?{...r,sourcePortCellOrdinal:null,
    targetPortCellOrdinal:null,acknowledgeSourcePortCell:false,
    acknowledgeTargetPortCell:false}:r),
 }),()=>true),"IC040_P9_CAPACITY_DECISION_INVALID");
 await deny(verifyOfficeCandidateFile(f,preview,decision(format,sha(original),{
  acknowledgeModeledLinkRows:false,
 }),()=>true),"IC040_P9_CAPACITY_DECISION_INVALID");
 await deny(verifyOfficeCandidateFile(f,preview,decision(format,sha(original),{
  linkRows:[linkRows[0],linkRows[0],...linkRows.slice(2)],
 }),()=>true),"IC040_P4_DUPLICATE_ROW");
 const unknown=await make([devices,links.map((row,i)=>i===9?[row[0],"ghost",row[2],row[3]]:row)]);
 const uf=file("network."+format,unknown),up=await previewOfficeNodesFile(uf);
 await deny(verifyOfficeCandidateFile(uf,up,decision(format,sha(unknown)),()=>true),
  "IC040_P4_LINK_ENDPOINT_UNKNOWN");
 const duplicatePort=await make([devices,links.map((row,i)=>i===2?[row[0],row[1],"eth1",row[3]]:row)]);
 const pf=file("network."+format,duplicatePort),pp=await previewOfficeNodesFile(pf);
 await deny(verifyOfficeCandidateFile(pf,pp,decision(format,sha(duplicatePort)),()=>true),
  "IC040_P4_PORT_REUSED");
 const reversedDuplicate=await make([devices,links.map((row,i)=>i===2?
   ["fw01","sw01","eth0","eth1"]:row)]);
 const revFile=file("network."+format,reversedDuplicate);
 const revPreview=await previewOfficeNodesFile(revFile);
 await deny(verifyOfficeCandidateFile(revFile,revPreview,
   decision(format,sha(reversedDuplicate)),()=>true),"IC040_P7_DUPLICATE_PORT_PAIR");
 const stale=await make([devices,links.map((row,i)=>i===9?[row[0],row[1],"eth6",row[3]]:row)]);
 await deny(verifyOfficeCandidateFile(file("network."+format,stale),preview,d,()=>true),
  "IC040_P1B_SOURCE_CHANGED");
 const secret=await make([devices,links.map((row,i)=>i===9?[row[0],row[1],"PASSWORD=private",row[3]]:row)]);
 const sf=file("network."+format,secret),sp=await previewOfficeNodesFile(sf);
 await deny(verifyOfficeCandidateFile(sf,sp,decision(format,sha(secret)),()=>true),
  format==="docx"?"DOCX_CELL_SENSITIVE_BLOCKED":"ODT_CELL_SENSITIVE_BLOCKED");
}
console.log("PASS IC-040 P9: "+checks+" genuine ten-node nine-link DOCX/ODT source+Builder exact parallel-port provenance and denial oracles");

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

// FROZEN FIRST: a distinct Links table contains both original endpoint IDs,
// unlike P2/P3's same-node-row peer cells. Never infer a link from proximity/IP.
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=b=>createHash("sha256").update(b).digest("hex");
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const cell=s=>'<w:tc><w:tcPr/><w:p><w:r><w:t>'+s+'</w:t></w:r></w:p></w:tc>';
async function docx(tables) {
 const body='<w:document xmlns:w="'+WORD+'"><w:body>'+
   tables.map(rows=>'<w:tbl><w:tblPr/><w:tblGrid/>'+
    rows.map(row=>'<w:tr>'+row.map(cell).join("")+'</w:tr>').join("")+'</w:tbl>').join("")+
   '</w:body></w:document>';
 const parts={
  "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
  "_rels/.rels":'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>',
  "word/document.xml":body,
 };
 const blob=await zip.write(Object.entries(parts).map(([path,data])=>({path,bytes:enc.encode(data)})));
 return new Uint8Array(await blob.arrayBuffer());
}
const odt=async tables=>makeOdtZip(packageEntries({tables:tables.map(odtTable)}));
const devices=[["Device ID","Private"],["sw01","PRIVATE_CANARY_DO_NOT_COPY_4001"],
 ["fw01","PRIVATE_CANARY_DO_NOT_COPY_4002"],
 ["rt01","PRIVATE_CANARY_DO_NOT_COPY_4003"],
 ["srv01","PRIVATE_CANARY_DO_NOT_COPY_4004"]];
const links=[["Source","Destination","Local port","Remote port"],
 ["sw01","fw01","eth1","eth0"],
 ["sw01","rt01","eth2","eth0"],
 ["sw01","srv01","eth3","eth0"]];
const roles=["network.switch","network.firewall","network.router","server.generic"];
const nodes=roles.map((role,i)=>({tableOrdinal:0,rowOrdinal:i+1,nodeIdCellOrdinal:0,role,acknowledgeCell:true}));
const linkRows=[1,2,3].map(rowOrdinal=>({
 tableOrdinal:1,rowOrdinal,fromCellOrdinal:0,toCellOrdinal:1,
 sourcePortCellOrdinal:2,targetPortCellOrdinal:3,
 acknowledgeFromCell:true,acknowledgeToCell:true,
 acknowledgeSourcePortCell:true,acknowledgeTargetPortCell:true,
}));
const decision=(format,hash,rows=linkRows)=>({
 format,sourceSha256:hash,nodes,acknowledgeModeledResources:true,
 linkRows:rows,acknowledgeModeledLinkRows:true,
});
const file=(name,bytes)=>({name,size:bytes.byteLength,async arrayBuffer(){
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const checkSource=ajv.compile(schema),checkNormalized=ajv.compile(normalizedSchema);
const validator=f=>x=>({valid:Boolean(f(x)),diagnostics:(f.errors??[]).map(e=>e.message)});
const options={compilerContext:{validateSource:validator(checkSource),
 validateNormalized:validator(checkNormalized),catalog:{capabilities:catalog.capabilities,
 profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};
let assertions=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);assertions++};
const yes=(value,message)=>{assert.ok(value,message);assertions++};
async function denies(p,code){await assert.rejects(p,e=>e?.code===code||e?.message===code,code);assertions++;}
for(const [format,make] of [["docx",docx],["odt",odt]]){
 const original=await make([devices,links]),f=file("network."+format,original);
 const preview=await previewOfficeNodesFile(f);
 eq(preview.preview.sourceSha256,sha(original),"exact ZIP original hash");
 eq(preview.preview.tables.length,2,"actual separate Nodes + Links tables");
 eq(preview.preview.textIncluded,false,"no unreviewed source values in preview");
 const d=decision(format,sha(original));
 const candidate=await verifyOfficeCandidateFile(f,preview,d,()=>true);
 eq(candidate.status,"READY_FOR_COMPILATION","P4 separately reviewed link rows ready");
 eq(candidate.selectedResources,4,"four original node IDs");
 eq(candidate.selectedConnections,3,"three original link rows from shared switch");
 eq(candidate.source.resources.map(r=>[r.id,r.type]),[
  ["sw01","network.switch"],["fw01","network.firewall"],
  ["rt01","network.router"],["srv01","server.generic"]],
  "exact source node ID/role set");
 const expected=[
  ["sw01","eth1","fw01","eth0"],
  ["sw01","eth2","rt01","eth0"],
  ["sw01","eth3","srv01","eth0"]];
 const model=source=>source.connections.map(c=>[c.from.resource,c.from.port,c.to.resource,c.to.port]);
 eq(model(candidate.source),expected,"original link endpoint-port identities and order");
 eq(candidate.source.resources.map(r=>[r.id,(r.interfaces??[]).map(i=>i.id).sort()]),[
  ["sw01",["eth1","eth2","eth3"]],["fw01",["eth0"]],["rt01",["eth0"]],["srv01",["eth0"]]],
  "no inferred or extra port IDs");
 eq(candidate.linkRowOrigins.map(x=>[x.fromLocator.tableOrdinal,
   x.fromLocator.rowOrdinal,x.toLocator.rowOrdinal]),[[1,1,1],[1,2,2],[1,3,3]],
  "each link has two original locators from the same selected row");
 eq(candidate.canActivate,false);eq(candidate.engineVerified,false);
 eq(candidate.physicalTopologyVerified,false);
 eq(candidate.source.tests,[],"documented links are not Engine probes");
 eq(candidate.source.completion.path,"office_manual_verification","no self-PASS objective");
 yes(checkSource(candidate.source),"valid canonical Source "+JSON.stringify(checkSource.errors));
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(candidate.source),options);
 eq(compiled.compile.status,"valid","actual compiled Builder valid "+JSON.stringify(compiled.compile.diagnostics));
 eq(model(compiled.source),expected,"compiled Builder exactly same three endpoint-port pairs");
 for(const row of devices.slice(1))yes(!JSON.stringify(candidate).includes(row[1]),
  "unselected private source cell not exported");
 const portlessRows=linkRows.map(x=>({...x,sourcePortCellOrdinal:null,targetPortCellOrdinal:null,
  acknowledgeSourcePortCell:false,acknowledgeTargetPortCell:false}));
 const portless=await verifyOfficeCandidateFile(f,preview,decision(format,sha(original),portlessRows),()=>true);
 eq(portless.source.connections.map(x=>[x.from.port??null,x.to.port??null]),
  [[null,null],[null,null],[null,null]],"P4 separately reviewed portless option never invents ports");
 await denies(verifyOfficeCandidateFile(f,preview,{...d,acknowledgeModeledLinkRows:false},()=>true),
  "IC040_P4_DECISION_INVALID");
 await denies(verifyOfficeCandidateFile(f,preview,{...d,linkRows:[{...linkRows[0],acknowledgeToCell:false}]},()=>true),
  "IC040_P4_LINK_DECISION_INVALID");
 await denies(verifyOfficeCandidateFile(f,preview,{...d,linkRows:[linkRows[0],linkRows[0]]},()=>true),
  "IC040_P4_DUPLICATE_ROW");
 await denies(verifyOfficeCandidateFile(f,preview,{...d,
  linkRows:[{...linkRows[0],fromCellOrdinal:1,toCellOrdinal:1}]},()=>true),
  "IC040_P4_LINK_DECISION_INVALID");
 await denies(verifyOfficeCandidateFile(f,preview,{...d,
  linkRows:[{...linkRows[0],tableOrdinal:0}]},()=>true),
  "IC040_P4_NOT_SEPARATE_LINK_TABLE");
 const unknown=await make([devices,links.map((r,i)=>i===1?[r[0],"ghost",r[2],r[3]]:r)]);
 const unknownFile=file("network."+format,unknown),unknownPreview=await previewOfficeNodesFile(unknownFile);
 await denies(verifyOfficeCandidateFile(unknownFile,unknownPreview,
  decision(format,sha(unknown)),()=>true),"IC040_P4_LINK_ENDPOINT_UNKNOWN");
 const reused=await make([devices,links.map((r,i)=>i===2?[r[0],r[1],"eth1",r[3]]:r)]);
 const reusedFile=file("network."+format,reused),reusedPreview=await previewOfficeNodesFile(reusedFile);
 await denies(verifyOfficeCandidateFile(reusedFile,reusedPreview,decision(format,sha(reused)),()=>true),
  "IC040_P4_PORT_REUSED");
 const repeated=await make([devices,links.map((r,i)=>i===2?["fw01","sw01","eth2","eth2"]:r)]);
 const repeatedFile=file("network."+format,repeated),repeatedPreview=await previewOfficeNodesFile(repeatedFile);
 await denies(verifyOfficeCandidateFile(repeatedFile,repeatedPreview,
  decision(format,sha(repeated)),()=>true),"IC040_P4_DUPLICATE_ENDPOINT_PAIR");
 const changed=await make([devices,links.map((r,i)=>i===1?[r[0],r[1],"eth9",r[3]]:r)]);
 await denies(verifyOfficeCandidateFile(file("network."+format,changed),preview,d,()=>true),
  "IC040_P1B_SOURCE_CHANGED");
 const unsafe=await make([devices,links.map((r,i)=>i===1?[r[0],r[1],"PASSWORD=private",r[3]]:r)]);
 const unsafeFile=file("network."+format,unsafe),unsafePreview=await previewOfficeNodesFile(unsafeFile);
 await denies(verifyOfficeCandidateFile(unsafeFile,unsafePreview,decision(format,sha(unsafe)),()=>true),
  format==="docx"?"DOCX_CELL_SENSITIVE_BLOCKED":"ODT_CELL_SENSITIVE_BLOCKED");
 const legacy=await verifyOfficeCandidateFile(f,preview,{
  format,sourceSha256:sha(original),nodes,acknowledgeModeledResources:true},()=>true);
 eq(legacy.source.connections,[],"P1b existing nodes-only unchanged");
}
console.log("PASS IC-040 P4: "+assertions+" real two-table DOCX/ODT source/compiled Builder exact multi-link ports and fail-closed cases");

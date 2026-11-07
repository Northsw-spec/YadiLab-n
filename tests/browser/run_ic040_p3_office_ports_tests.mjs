import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import srcSchema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import {ENGINE_VERSION} from "../../dist-browser-test/engine/src/index.js";
import {ZipJsArchiveBackend} from "../../dist-browser-test/package-io/src/zipjs-backend.js";
import {makeOdtZip,packageEntries,table as odtTable} from "../enterprise-import/odt_test_package.mjs";
import {previewOfficeNodesFile,verifyOfficeCandidateFile} from "../../dist-browser-test/ui/src/browser/office-reviewed-nodes-file.js";
import {compileBuilderWorkspace,createBuilderWorkspace} from "../../dist-browser-test/ui/src/browser/index.js";

// FROZEN FIRST: separate, explicitly approved original local/remote PORT cells.
// The legacy P2 exact-key decision must fail until optional P3 support exists.
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const xml=s=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const cell=v=>'<w:tc><w:tcPr/><w:p><w:r><w:t>'+xml(v)+'</w:t></w:r></w:p></w:tc>';
async function docx(rows){
 const body='<w:document xmlns:w="'+WORD+'"><w:body><w:tbl><w:tblPr/><w:tblGrid/>'+
   rows.map(r=>'<w:tr>'+r.map(cell).join("")+'</w:tr>').join("")+'</w:tbl></w:body></w:document>';
 const parts={
  "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
  "_rels/.rels":'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>',
  "word/document.xml":body,
 };
 const bytes=await zip.write(Object.entries(parts).map(([path,value])=>({path,bytes:enc.encode(value)})));
 return new Uint8Array(await bytes.arrayBuffer());
}
const odt=async rows=>makeOdtZip(packageEntries({tables:[odtTable(rows)]}));
const sourceRows=[["Device","Peer","Local port","Peer port","Private"],
 ["fw01","sw01","eth0","eth1","PRIVATE_CANARY_OFFICE_3001"],
 ["sw01","rt01","eth2","eth0","SECRET_OFFICE_CELL_3002"],
 ["rt01","","","","PRIVATE_LAST_ROW_3003"]];
const roles=["network.firewall","network.switch","network.router"];
const nodes=roles.map((role,i)=>({tableOrdinal:0,rowOrdinal:i+1,nodeIdCellOrdinal:0,role,acknowledgeCell:true}));
const connections=[
 {fromNodeIndex:0,peerCellOrdinal:1,acknowledgePeerCell:true},
 {fromNodeIndex:1,peerCellOrdinal:1,acknowledgePeerCell:true},
];
const portSelections=[
 {connectionIndex:0,sourcePortCellOrdinal:2,peerPortCellOrdinal:3,
  acknowledgeSourcePortCell:true,acknowledgePeerPortCell:true},
 {connectionIndex:1,sourcePortCellOrdinal:2,peerPortCellOrdinal:3,
  acknowledgeSourcePortCell:true,acknowledgePeerPortCell:true},
];
const expectedPorts=[["fw01","eth0","sw01","eth1"],["sw01","eth2","rt01","eth0"]];
const expectedIfaces=[["fw01",["eth0"]],["sw01",["eth1","eth2"]],["rt01",["eth0"]]];
const file=(name,bytes)=>({name,size:bytes.byteLength,async arrayBuffer(){
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const vsrc=ajv.compile(srcSchema),vnorm=ajv.compile(normSchema);
const validate=fn=>x=>({valid:Boolean(fn(x)),diagnostics:(fn.errors??[]).map(y=>y.message)});
const options={compilerContext:{validateSource:validate(vsrc),validateNormalized:validate(vnorm),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
 engineBaselineVersion:ENGINE_VERSION}};
let count=0; const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);count++};
const yes=(a,msg)=>{assert.ok(a,msg);count++};
async function denies(p,code){await assert.rejects(p,e=>e?.code===code||e?.message===code,code);count++;}
for(const [format,make] of [["docx",docx],["odt",odt]]){
 const bytes=await make(sourceRows),f=file("network."+format,bytes);
 const preview=await previewOfficeNodesFile(f);
 eq(preview.preview.sourceSha256,sha(bytes),format+" original ZIP hash");
 eq(preview.preview.textIncluded,false,format+" no blanket text preview");
 const p2={format,sourceSha256:sha(bytes),nodes,acknowledgeModeledResources:true,
   connections,acknowledgeModeledConnections:true};
 const p3={...p2,portSelections,acknowledgeModeledPorts:true};
 const candidate=await verifyOfficeCandidateFile(f,preview,p3,()=>true);
 eq(candidate.status,"READY_FOR_COMPILATION",format+" P3 original port review is ready");
 eq(candidate.source.resources.map(r=>[r.id,r.type]),
  [["fw01","network.firewall"],["sw01","network.switch"],["rt01","network.router"]],
  format+" exact reviewed node IDs and roles");
 eq(candidate.source.resources.map(r=>[r.id,(r.interfaces??[]).map(i=>i.id).sort()]),
  expectedIfaces,format+" only original port cells become interface IDs");
 eq(candidate.source.connections.map(c=>[c.from.resource,c.from.port,c.to.resource,c.to.port]),
  expectedPorts,format+" exact pair of original endpoint ports per link");
 eq(candidate.selectedPorts,4,format+" exactly four individually consented ports");
 eq(candidate.portOrigins.map(o=>[o.sourcePortLocator.rowOrdinal,o.peerPortLocator.rowOrdinal]),
  [[1,1],[2,2]],format+" origin cell row equality");
 eq(candidate.source.tests,[],format+" no fabricated Engine probes");
 eq(candidate.source.completion.path,"office_manual_verification",format+" no imported self-PASS");
 eq(candidate.canActivate,false);eq(candidate.engineVerified,false);eq(candidate.physicalTopologyVerified,false);
 yes(vsrc(candidate.source),format+" valid canonical Source "+JSON.stringify(vsrc.errors));
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(candidate.source),options);
 eq(compiled.compile.status,"valid",format+" actual Builder compile "+JSON.stringify(compiled.compile.diagnostics));
 eq(compiled.source.connections.map(c=>[c.from.resource,c.from.port,c.to.resource,c.to.port]),
  expectedPorts,format+" compiled port link parity");
 for(const secret of sourceRows.slice(1).map(row=>row[4]))
  yes(!JSON.stringify(candidate).includes(secret),format+" private unselected cell NEVER copied");
 const legacy=await verifyOfficeCandidateFile(f,preview,p2,()=>true);
 eq(legacy.source.resources.flatMap(r=>r.interfaces??[]),[],format+" P2 remains portless");
 eq(legacy.source.connections.map(c=>[c.from.port??null,c.to.port??null]),
  [[null,null],[null,null]],format+" P2 preserves source supported port absence");
 const noPort=await verifyOfficeCandidateFile(f,preview,{
  format,sourceSha256:sha(bytes),nodes,acknowledgeModeledResources:true,
 },()=>true);
 eq(noPort.source.connections,[],format+" P1b remains node-only");
 await denies(verifyOfficeCandidateFile(f,preview,{
  ...p3,acknowledgeModeledPorts:false,
 },()=>true),"IC040_P3_DECISION_INVALID");
 await denies(verifyOfficeCandidateFile(f,preview,{
  ...p3,portSelections:[portSelections[0]],
 },()=>true),"IC040_P3_PORT_DECISION_INVALID");
 await denies(verifyOfficeCandidateFile(f,preview,{
  ...p3,portSelections:[portSelections[0],portSelections[0]],
 },()=>true),"IC040_P3_PORT_DECISION_INVALID");
 await denies(verifyOfficeCandidateFile(f,preview,{
  ...p3,portSelections:[{...portSelections[0],acknowledgeSourcePortCell:false},portSelections[1]],
 },()=>true),"IC040_P3_PORT_DECISION_INVALID");
 await denies(verifyOfficeCandidateFile(f,preview,{
  ...p3,portSelections:[{...portSelections[0],sourcePortCellOrdinal:1},portSelections[1]],
 },()=>true),"IC040_P3_PORT_DECISION_INVALID");
 const duplicate=await make(sourceRows.map((row,i)=>i===2?[row[0],row[1],"eth1",row[3],row[4]]:row));
 const duplicateFile=file("network."+format,duplicate),duplicatePreview=await previewOfficeNodesFile(duplicateFile);
 await denies(verifyOfficeCandidateFile(duplicateFile,duplicatePreview,{
  ...p3,sourceSha256:sha(duplicate),
 },()=>true),"IC040_P3_PORT_REUSED");
 const invalid=await make(sourceRows.map((row,i)=>i===1?[row[0],row[1],"Eth0",row[3],row[4]]:row));
 const invalidFile=file("network."+format,invalid),invalidPreview=await previewOfficeNodesFile(invalidFile);
 await denies(verifyOfficeCandidateFile(invalidFile,invalidPreview,{
  ...p3,sourceSha256:sha(invalid),
 },()=>true),"IC040_P3_PORT_INVALID");
 const slash=await make(sourceRows.map((row,i)=>i===1?[row[0],row[1],"Gi1/0/1",row[3],row[4]]:row));
 const slashFile=file("network."+format,slash),slashPreview=await previewOfficeNodesFile(slashFile);
 await denies(verifyOfficeCandidateFile(slashFile,slashPreview,{
  ...p3,sourceSha256:sha(slash),
 },()=>true),format==="docx"?"DOCX_CELL_SENSITIVE_BLOCKED":"ODT_CELL_SENSITIVE_BLOCKED");
 const sensitive=await make(sourceRows.map((row,i)=>i===1?[row[0],row[1],"PASSWORD=canary",row[3],row[4]]:row));
 const sensitiveFile=file("network."+format,sensitive),sensitivePreview=await previewOfficeNodesFile(sensitiveFile);
 await denies(verifyOfficeCandidateFile(sensitiveFile,sensitivePreview,{
  ...p3,sourceSha256:sha(sensitive),
 },()=>true),format==="docx"?"DOCX_CELL_SENSITIVE_BLOCKED":"ODT_CELL_SENSITIVE_BLOCKED");
 const mutated=await make(sourceRows.map((row,i)=>i===1?[row[0],row[1],"eth3",row[3],row[4]]:row));
 await denies(verifyOfficeCandidateFile(file("network."+format,mutated),preview,p3,()=>true),
  "IC040_P1B_SOURCE_CHANGED");
}
console.log("PASS IC-040 P3: "+count+" original DOCX/ODT ZIP port and interface evidence, exact Builder endpoint ports, all negative review gates");

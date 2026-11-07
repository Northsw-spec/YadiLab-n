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

// Frozen BEFORE Office source/UI implementation. Every modeled edge must
// originate from a separately consented peer cell in an original source row.
const enc=new TextEncoder(),zip=new ZipJsArchiveBackend();
const sha=b=>createHash("sha256").update(b).digest("hex");
const WORD="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC="http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES="http://schemas.openxmlformats.org/package/2006/content-types";
const MAIN="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const cell=v=>'<w:tc><w:tcPr/><w:p><w:r><w:t>'+v+'</w:t></w:r></w:p></w:tc>';
async function docx(rows) {
 const body='<w:document xmlns:w="'+WORD+'"><w:body><w:tbl><w:tblPr/><w:tblGrid/>'+
   rows.map(r=>'<w:tr>'+r.map(cell).join("")+'</w:tr>').join("")+'</w:tbl></w:body></w:document>';
 const parts={
  "[Content_Types].xml":'<Types xmlns="'+TYPES+'"><Override PartName="/word/document.xml" ContentType="'+MAIN+'"/></Types>',
  "_rels/.rels":'<Relationships xmlns="'+OPC+'"><Relationship Id="rId1" Type="'+REL+'" Target="word/document.xml"/></Relationships>',
  "word/document.xml":body
 };
 const data=await zip.write(Object.entries(parts).map(([path,value])=>({path,bytes:enc.encode(value)})));
 return new Uint8Array(await data.arrayBuffer());
}
const odt=async rows=>makeOdtZip(packageEntries({tables:[odtTable(rows)]}));
const original=[["Device ID","Connected To","Private"],["fw01","sw01","SECRET_CANARY_736"],
 ["sw01","rt01","PRIVATE_193"],["rt01","","PRIVATE_418"]];
const roles=["network.firewall","network.switch","network.router"];
const nodes=roles.map((role,i)=>({tableOrdinal:0,rowOrdinal:i+1,nodeIdCellOrdinal:0,role,acknowledgeCell:true}));
const links=[{fromNodeIndex:0,peerCellOrdinal:1,acknowledgePeerCell:true},
 {fromNodeIndex:1,peerCellOrdinal:1,acknowledgePeerCell:true}];
const file=(name,bytes)=>({name,size:bytes.byteLength,async arrayBuffer(){
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const src=ajv.compile(srcSchema),norm=ajv.compile(normSchema);
const validate=f=>x=>({valid:Boolean(f(x)),diagnostics:(f.errors??[]).map(e=>e.message)});
const options={compilerContext:{validateSource:validate(src),validateNormalized:validate(norm),
 catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};
let count=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);count++};
const yes=(v,message)=>{assert.ok(v,message);count++};
async function fails(p,code) {await assert.rejects(p,e=>e?.code===code||e?.message===code,code);count++;}
for (const [format,make] of [["docx",docx],["odt",odt]]) {
 const bytes=await make(original),f=file("network."+format,bytes);
 const preview=await previewOfficeNodesFile(f);
 eq(preview.preview.sourceSha256,sha(bytes),format+" hash matches real original");
 eq(preview.preview.textIncluded,false,format+" only structural metadata previewed");
 const base={format,sourceSha256:sha(bytes),nodes,acknowledgeModeledResources:true};
 const reviewed={...base,connections:links,acknowledgeModeledConnections:true};
 const candidate=await verifyOfficeCandidateFile(f,preview,reviewed,()=>true);
 eq(candidate.status,"READY_FOR_COMPILATION",format+" original reviewed links ready");
 eq(candidate.source.resources.map(x=>[x.id,x.type]),
  [["fw01","network.firewall"],["sw01","network.switch"],["rt01","network.router"]],
  format+" exact role and ID set");
 eq(candidate.source.connections.map(x=>[x.from.resource,x.to.resource]),
  [["fw01","sw01"],["sw01","rt01"]],format+" exactly two explicitly documented peer connections");
 eq(candidate.selectedConnections,2,format+" exactly two reviewed edges");
 eq(candidate.connectionOrigins.map(x=>x.peerLocator.rowOrdinal),[1,2],format+" authentic peer-cell source locators");
 eq(candidate.source.resources.flatMap(x=>x.interfaces??[]),[],format+" no inferred ports");
 eq(candidate.source.tests,[],format+" no invented Engine test");
 eq(candidate.source.completion.path,"office_manual_verification",format+" still requires manual network verification");
 eq(candidate.canActivate,false);eq(candidate.engineVerified,false);eq(candidate.physicalTopologyVerified,false);
 yes(src(candidate.source),format+" valid source schema "+JSON.stringify(src.errors));
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(candidate.source),options);
 eq(compiled.compile.status,"valid",format+" real Builder compile "+JSON.stringify(compiled.compile.diagnostics));
 eq(compiled.source.connections.map(x=>[x.from.resource,x.to.resource]),
  [["fw01","sw01"],["sw01","rt01"]],format+" compiled edge endpoint parity");
 for(const privateText of original.slice(1).map(x=>x[2]))
  yes(!JSON.stringify(candidate).includes(privateText),format+" never import unrelated private cell");
 const none=await verifyOfficeCandidateFile(f,preview,base,()=>true);
 eq(none.source.connections,[],format+" legacy node-only decision still creates no links");
 const unknown=await make(original.map((r,i)=>i===1?[r[0],"ghost",r[2]]:r));
 const missing=file("network."+format,unknown),missingPreview=await previewOfficeNodesFile(missing);
 await fails(verifyOfficeCandidateFile(missing,missingPreview,
  {...reviewed,sourceSha256:sha(unknown)},()=>true),"IC040_P2_LINK_ENDPOINT_UNKNOWN");
 await fails(verifyOfficeCandidateFile(f,preview,
  {...reviewed,acknowledgeModeledConnections:false},()=>true),"IC040_P2_DECISION_INVALID");
 await fails(verifyOfficeCandidateFile(f,preview,
  {...reviewed,connections:[links[0],links[0]]},()=>true),"IC040_P2_DUPLICATE_LINK_CELL");
 // A reciprocal declaration is one undirected network peer relationship,
 // not two independent parallel cables when no port evidence exists.
 const reciprocal=await make(original.map((row,i)=>i===2?[row[0],"fw01",row[2]]:row));
 const reciprocalFile=file("reciprocal."+format,reciprocal);
 const reciprocalPreview=await previewOfficeNodesFile(reciprocalFile);
 await fails(verifyOfficeCandidateFile(reciprocalFile,reciprocalPreview,
  {...reviewed,sourceSha256:sha(reciprocal)},()=>true),"IC040_P2_DUPLICATE_CONNECTION");
 await fails(verifyOfficeCandidateFile(f,preview,
  {...reviewed,connections:[{...links[0],peerCellOrdinal:2}]},()=>true),
  format==="docx"?"DOCX_CELL_SENSITIVE_BLOCKED":"ODT_CELL_SENSITIVE_BLOCKED");
 const swapped=await make(original.map((r,i)=>i===1?[r[0],"rt01",r[2]]:r));
 await fails(verifyOfficeCandidateFile(file("network."+format,swapped),
  preview,reviewed,()=>true),"IC040_P1B_SOURCE_CHANGED");
}
console.log("PASS IC-040 P2: "+count+" real original DOCX/ODT peer cells, exact roles/edges, compiled Builder, and fail-closed counterexamples");

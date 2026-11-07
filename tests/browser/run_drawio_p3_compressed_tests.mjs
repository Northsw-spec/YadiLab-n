import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync, deflateSync } from "node:zlib";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { previewDrawioStructure } from "../../dist-browser-test/enterprise-import/src/drawio-structural-preview.js";
import { previewDrawioFileReadOnly } from "../../dist-browser-test/ui/src/browser/drawio-file-preview.js";
import { DrawioStructurePanel, DrawioStructureDetails } from "../../ui/app/drawio-structure-panel.mjs";
import fs from "node:fs";

const secret="SECRET_USER_192.0.2.91_PRIVATE_INTERNAL_781";
const root='<mxCell id="0"/><mxCell id="1" parent="0"/>';
const v=(id,label=secret)=>'<mxCell id="'+id+'" parent="1" vertex="1" value="'+label+'"/>';
const e=(id,a,b)=>'<mxCell id="'+id+'" parent="1" edge="1" source="'+a+'" target="'+b+'"/>';
const model=(items)=>'<mxGraphModel><root>'+root+items+'</root></mxGraphModel>';
const model0=model(v("v1")+v("v2")+e("link","v1","v2"));
const model1=model(v("v3"));
const base64=(raw)=>deflateRawSync(Buffer.from(raw,"ascii")).toString("base64");
const compressed=(xml)=>base64(encodeURIComponent(xml));
const page=(id,inner)=>'<diagram id="'+id+'" name="'+secret+'">'+inner+'</diagram>';
const file=(...pages)=>'<?xml version="1.0"?><mxfile>'+pages.join("")+'</mxfile>';
const enc=(s)=>new TextEncoder().encode(s);
const hash=(u)=>createHash("sha256").update(u).digest("hex");
const source=file(page("p1",compressed(model0)),page("p2",model1));
const raw=enc(source);
let assertions=0;
function eq(a,b,msg){assert.deepEqual(a,b,msg);assertions++;}
async function denied(input,code){
 await assert.rejects(previewDrawioStructure(enc(input)),err=>{
   return err?.code===code && err?.message===code && !String(err).includes(secret);
 },code);assertions++;
}
const preview=await previewDrawioStructure(raw);
eq(preview.status,"PREVIEW_ONLY");
eq(preview.profileId,"diagrams.drawio.uncompressed-structure.v1");
eq(preview.semanticTrack,"TOPOLOGY_DECLARED");
eq(preview.sourceSha256,hash(raw));
eq(preview.pageCount,2);
eq(preview.vertexCount,3);
eq(preview.drawnEdgeCount,1);
eq(preview.compressedPageCount,1);
eq(preview.pages,[{pageOrdinal:0,vertexCount:2,drawnEdgeCount:1},
 {pageOrdinal:1,vertexCount:1,drawnEdgeCount:0}]);
for(const name of ["canActivate","engineVerified","physicalTopologyVerified","modelMutated"]){
 eq(preview[name],false);
}
eq(Object.isFrozen(preview),true);
eq(Object.isFrozen(preview.pages),true);
eq(Object.isFrozen(preview.pages[0]),true);
const allCompressed=await previewDrawioStructure(enc(file(page("p1",compressed(model0)),page("p2",compressed(model1)))));
eq(allCompressed.compressedPageCount,2);
eq(allCompressed.vertexCount,3);
eq(allCompressed.drawnEdgeCount,1);
const single=await previewDrawioStructure(enc(file(page("p1",compressed(model0)))));
eq(single.compressedPageCount,1);
eq(single.pageCount,1);
const plain=await previewDrawioStructure(enc(file(page("p1",model0),page("p2",model1))));
eq(plain.compressedPageCount,0);
eq(plain.vertexCount,preview.vertexCount);
eq(plain.drawnEdgeCount,preview.drawnEdgeCount);
eq(plain.pages,preview.pages);
eq(plain.sourceSha256===preview.sourceSha256,false);
const input=(name,bytes)=>({name,size:bytes.byteLength,async arrayBuffer(){
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
eq(await previewDrawioFileReadOnly(input("real.drawio",raw)),preview);
for(const text of [secret,"192.0.2.91","v1","link","p1"]){
 const json=JSON.stringify(preview);
 if(text==="v1"){eq(json.includes('"id":"v1"'),false);}
 else if(text==="p1"){eq(json.includes('"pageId":"p1"'),false);}
 else eq(json.includes(text),false,"No raw source values");
}
await denied(file(page("p", "not-base64")),"DRAWIO_BASE64_INVALID");
await denied(file(page("p","AQID")),"DRAWIO_DEFLATE_INVALID");
await denied(file(page("p",deflateSync(Buffer.from(encodeURIComponent(model0))).toString("base64"))),"DRAWIO_DEFLATE_INVALID");
await denied(file(page("p",base64("%ZZ"))),"DRAWIO_URI_INVALID");
await denied(file(page("p",compressed(encodeURIComponent(model0)))),"IMPORT_XML_MALFORMED");
await denied(file(page("p",base64(String.fromCharCode(0xff)+encodeURIComponent(model0)))),"DRAWIO_URI_ASCII_INVALID");
await denied(file(page("p",compressed('<wrong/>'))),"DRAWIO_COMPRESSED_ROOT_INVALID");
await denied(file(page("p",compressed('<mxGraphModel/>'))),"DRAWIO_CARDINALITY_INVALID");
await denied(file(page("p",compressed('<!DOCTYPE mxGraphModel [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+model0))),"IMPORT_XML_DTD_FORBIDDEN");
await denied(file(page("p",compressed('<?xml-stylesheet href="https://evil.invalid/malicious"?>'+model0))),"IMPORT_XML_PROCESSING_INSTRUCTION_FORBIDDEN");
await denied(file(page("p",compressed(model(v("a")+e("dangling","a","unknown"))))),"DRAWIO_EDGE_ENDPOINT_INVALID");
await denied(file(page("p",compressed(model('<mxCell id="group" parent="one" vertex="1"/>')))),"DRAWIO_PARENT_UNSUPPORTED");
await denied('<mxfile compressed="false">'+page("p",compressed(model0))+'</mxfile>',"DRAWIO_COMPRESSION_MISMATCH");
await denied('<mxfile compressed="true">'+page("p",model0)+'</mxfile>',"DRAWIO_COMPRESSED_UNSUPPORTED");
await denied(file(page("p",compressed(model0)+model0)),"DRAWIO_MIXED_PAGE_CONTENT");
await denied(file(page("p",compressed(model0))+'<evil/>'),"DRAWIO_UNSUPPORTED_ELEMENT");
await denied(file(page("p", "AAAA".repeat(150000))),"DRAWIO_BASE64_INVALID");
await denied(file(page("p",base64("X".repeat(1024*1024+1)))),"DRAWIO_INFLATE_LIMIT");
const sizedModel=(len)=>model(v("huge","X".repeat(len)));
const sizedPage=compressed(sizedModel(880000));
const five=file(...Array.from({length:5},(_,i)=>page("pg"+i,sizedPage)));
await denied(five,"DRAWIO_INFLATE_LIMIT");
await denied(file(page("p",compressed(model0)),page("p",compressed(model1)),page("p",compressed(model1)).replace('id="p"','id="p"')),"DRAWIO_DUPLICATE_PAGE");
await denied(file(...Array.from({length:17},(_,i)=>page("pg"+i,compressed(model1)))),"DRAWIO_PAGE_COUNT_INVALID");
const invalid=file(page("p",compressed(model0).slice(0,-2)+"AA"));
await assert.rejects(previewDrawioStructure(enc(invalid)),err=>
 /^DRAWIO_/.test(err.code) && err.message===err.code);assertions++;
const summary=renderToStaticMarkup(React.createElement(DrawioStructureDetails,{preview}));
for(const term of ['data-drawio-preview="PREVIEW_ONLY"','Compressed pages: 1','data-drawio-activation-status="BLOCKED"']){
 assert.ok(summary.includes(term),term);assertions++;
}
for(const sensitive of [secret,"192.0.2.91","SECRET_USER","v1","link","p1"]){
 if(sensitive==="v1"||sensitive==="p1")continue;
 eq(summary.includes(sensitive),false,"No source value in HTML");
}
const empty=renderToStaticMarkup(React.createElement(DrawioStructurePanel,{
 inspectFile(){throw Error("Cannot inspect on SSR");},onClose(){throw Error("Cannot close on SSR");}
}));
eq(empty.includes('data-drawio-empty="true"'),true);
eq(empty.includes('data-drawio-preview="PREVIEW_ONLY"'),false);
for(const path of ["enterprise-import/src/drawio-compressed-page.ts",
 "enterprise-import/src/drawio-structural-preview.ts"]){
 const code=fs.readFileSync(path,"utf8");
 for(const sideEffect of ["fetch(","XMLHttpRequest","setWorkspace(","localStorage","indexedDB","dangerouslySetInnerHTML"]){
  eq(code.includes(sideEffect),false);
 }
}
const rootCode=fs.readFileSync("enterprise-import/src/drawio-compressed-page.ts","utf8");
eq(rootCode.includes("Response("),false,"No unbounded Response reader");
eq(rootCode.includes("getReader()"),true,"Must use actual bounded streamed decompression");
eq(rootCode.includes("await reader.cancel()"),true,"Must cancel on inflate limit");
console.log("PASS DRAWIO P3 "+assertions+" compressed draw.io, mixed pages, URI, DEFLATE bomb, DTD/XXE, privacy and SSR");

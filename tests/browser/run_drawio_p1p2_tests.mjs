import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import fs from "node:fs";
import {previewDrawioStructure} from "../../dist-browser-test/enterprise-import/src/drawio-structural-preview.js";
import {previewDrawioFileReadOnly} from "../../dist-browser-test/ui/src/browser/drawio-file-preview.js";
import {DrawioStructurePanel, DrawioStructureDetails} from "../../ui/app/drawio-structure-panel.mjs";

const secret="SENSITIVE_HOST_192.0.2.99_SECRET_LABEL_551";
const root='<mxCell id="0"/><mxCell id="1" parent="0"/>';
const vert=(id,text=secret)=>'<mxCell id="'+id+'" vertex="1" parent="1" value="'+text+'"><mxGeometry as="geometry" x="10" y="20" width="80" height="40"/></mxCell>';
const edge=(id,source,target)=>'<mxCell id="'+id+'" edge="1" parent="1" source="'+source+'" target="'+target+'"/>';
const model=(cells)=>'<mxGraphModel><root>'+cells+'</root></mxGraphModel>';
const page=(id,content,name=secret)=>'<diagram id="'+id+'" name="'+name+'">'+content+'</diagram>';
const file=(...pages)=>'<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net">'+pages.join("")+'</mxfile>';
const xml=file(page("page_1",model(root+vert("v1")+vert("v2")+edge("e1","v1","v2"))),
  page("page_2",model(root+vert("v3"))));
const bytes=new TextEncoder().encode(xml);
const hash=createHash("sha256").update(bytes).digest("hex");
let assertions=0;
function eq(a,b,label){assert.deepEqual(a,b,label);assertions++;}
const input=(name,raw,size=raw.byteLength)=>({name,size,async arrayBuffer(){
 return raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
}});
async function rejected(raw,code){
 await assert.rejects(previewDrawioStructure(raw),e=>e?.code===code &&
  !String(e.message).includes(secret),code);assertions++;
}
async function badFile(name,raw,code,size=raw.byteLength){
 await assert.rejects(previewDrawioFileReadOnly(input(name,raw,size)),
  e=>e?.code===code,code);assertions++;
}
const result=await previewDrawioStructure(bytes);
eq(result.status,"PREVIEW_ONLY");
eq(result.profileId,"diagrams.drawio.uncompressed-structure.v1");
eq(result.semanticTrack,"TOPOLOGY_DECLARED");
eq(result.sourceSha256,hash);
eq(result.pageCount,2);
eq(result.vertexCount,3);
eq(result.drawnEdgeCount,1);
eq(result.pages,[{pageOrdinal:0,vertexCount:2,drawnEdgeCount:1},
  {pageOrdinal:1,vertexCount:1,drawnEdgeCount:0}]);
for(const flag of ["canActivate","engineVerified","physicalTopologyVerified","modelMutated"])
  eq(result[flag],false);
eq(Object.isFrozen(result),true);
eq(Object.isFrozen(result.pages),true);
eq(Object.isFrozen(result.pages[0]),true);
eq(JSON.stringify(result).includes(secret),false);
eq(JSON.stringify(result).includes("192.0.2.99"),false);
eq(JSON.stringify(result).includes("\\\"id\\\":\\\"v1\\\""),false);
eq(await previewDrawioFileReadOnly(input("sample.DRAWIO",bytes)),result);
const bare=await previewDrawioStructure(new TextEncoder().encode(model(root+vert("solo"))));
eq(bare.pageCount,1);
eq(bare.vertexCount,1);
eq(bare.drawnEdgeCount,0);
const enc=x=>new TextEncoder().encode(x);
await rejected(enc("<nmaprun scanner='nmap'/>"),"DRAWIO_ROOT_UNSUPPORTED");
await rejected(enc("<mxfile/>"),"DRAWIO_PAGE_COUNT_INVALID");
await rejected(enc(file(page("p",model(root+vert("x"))),page("p",model(root+vert("y"))))),"DRAWIO_DUPLICATE_PAGE");
await rejected(enc(file(page("p","REDACT_ME_BASE64_DEFLATE"))),"DRAWIO_BASE64_INVALID");
await rejected(enc('<mxfile compressed="true">'+page("p",model(root+vert("a")))+"</mxfile>"),"DRAWIO_COMPRESSED_UNSUPPORTED");
await rejected(enc(file(page("p",model(root+vert("x"))).replace("</diagram>","base64</diagram>"))),"DRAWIO_MIXED_PAGE_CONTENT");
await rejected(enc(file(page("p",model(root+vert("x"))+"<mxGraphModel/>"))),"DRAWIO_CARDINALITY_INVALID");
await rejected(enc(file(page("p",model(root+vert("x"))+"<hacker/>"))),"DRAWIO_UNSUPPORTED_ELEMENT");
await rejected(enc(file(page("p",model(root+vert("x"))),'<mxlibrary/>')),"DRAWIO_UNSUPPORTED_ELEMENT");
const diagramCase=(cells)=>enc(file(page("p",model(root+cells))));
await rejected(diagramCase(vert("x")+vert("x")),"DRAWIO_DUPLICATE_CELL");
await rejected(enc(file(page("p",model('<mxCell id="1" parent="0"/>'+vert("x"))))),"DRAWIO_MISSING_ROOT_CELLS");
await rejected(diagramCase('<mxCell id="x" vertex="1" parent="group"/>'),"DRAWIO_PARENT_UNSUPPORTED");
await rejected(diagramCase('<mxCell id="x" edge="1" vertex="1" parent="1"/>'),"DRAWIO_CELL_TYPE_INVALID");
await rejected(diagramCase(vert("a")+edge("e","a","missing")),"DRAWIO_EDGE_ENDPOINT_INVALID");
await rejected(diagramCase(edge("e","a","b")),"DRAWIO_EDGE_ENDPOINT_INVALID");
await rejected(diagramCase(vert("a")+'<UserObject><mxCell id="w" vertex="1" parent="1"/></UserObject>'),"DRAWIO_UNSUPPORTED_ELEMENT");
await rejected(diagramCase(vert("a")+'<mxCell id="b" vertex="1" parent="1"><script>evil</script></mxCell>'),"DRAWIO_UNSUPPORTED_ELEMENT");
await rejected(enc(file(page("p",model(root+vert("a")))).replace("<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
 '<!DOCTYPE mxfile [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>')),"IMPORT_XML_DTD_FORBIDDEN");
await rejected(enc('<?xml version="1.0"?><?xml-stylesheet href="https://evil.invalid/x"?><mxfile/>'),
  "IMPORT_XML_PROCESSING_INSTRUCTION_FORBIDDEN");
await rejected(new Uint8Array([0xff,0xfe,0xfd]),"IMPORT_XML_INVALID_UTF8");
await rejected(new Uint8Array(2*1024*1024+1),"DRAWIO_SOURCE_SIZE_INVALID");
await rejected(enc(file(...Array.from({length:17},(_,i)=>page("p"+i,model(root+vert("a")))))),"DRAWIO_PAGE_COUNT_INVALID");
await rejected(diagramCase(Array.from({length:1001},(_,i)=>vert("v"+i,"")).join("")),"DRAWIO_VERTEX_BUDGET");
await rejected(diagramCase(vert("v","")+Array.from({length:2001},(_,i)=>edge("e"+i,"v","v")).join("")),"DRAWIO_EDGE_BUDGET");
for(const name of ["test.xml","../test.drawio","test.drawio/x","test.drawio\\foo","test.drawio.svg"])
  await badFile(name,bytes,"DRAWIO_FILE_EXTENSION_INVALID");
await badFile("test.drawio",bytes,"DRAWIO_FILE_SIZE_INVALID",2*1024*1024+1);
await assert.rejects(previewDrawioFileReadOnly({name:"test.drawio",size:99,
 arrayBuffer:async()=>new Uint8Array([1,2,3])}),e=>e?.code==="DRAWIO_FILE_SIZE_INVALID");assertions++;
const markup=renderToStaticMarkup(React.createElement(DrawioStructurePanel,{
 inspectFile(){throw Error("SSR should not read files");},onClose(){throw Error("SSR close");}
}));
for(const marker of ['data-drawio-panel="PREVIEW_ONLY"','data-drawio-file="true"',
 'data-drawio-empty="true"','data-drawio-close="true"']){
 assert.ok(markup.includes(marker),marker);assertions++;
}
eq(markup.includes('data-drawio-preview="PREVIEW_ONLY"'),false);
const detail=renderToStaticMarkup(React.createElement(DrawioStructureDetails,{preview:result}));
for(const marker of ['data-drawio-preview="PREVIEW_ONLY"','data-drawio-page="0"',
 'data-drawio-page="1"','data-drawio-activation-status="BLOCKED"']){
 assert.ok(detail.includes(marker),marker);assertions++;
}
for(const sensitive of [secret,"192.0.2.99","v1","v2","page_1","page_2"])
  eq(detail.includes(sensitive),false,"no source label/id in DOM");
const main=fs.readFileSync("ui/app/main.mjs","utf8");
for(const pattern of [/data-inspect-drawio": "PREVIEW_ONLY"/,/drawioStructureOpen \? e\(DrawioStructurePanel/,
 /onInspectDrawio: \(\) => setDrawioStructureOpen\(true\)/]){
 assert.match(main,pattern);assertions++;
}
for(const path of ["enterprise-import/src/drawio-structural-preview.ts",
 "ui/src/browser/drawio-file-preview.ts","ui/app/drawio-structure-panel.mjs"]){
 const source=fs.readFileSync(path,"utf8");
 for(const forbidden of ["setWorkspace(","dangerouslySetInnerHTML","localStorage",
 "indexedDB","console.log(","fetch(","XMLHttpRequest"]){
  eq(source.includes(forbidden),false,"No side effects in "+path);
 }
}
console.log("PASS DRAWIO P1/P2 "+assertions+" synthetic multi-page XML, DTD/XXE, bounds, privacy, SSR and no Engine");

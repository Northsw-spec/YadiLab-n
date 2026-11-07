import { webCryptoImportHashProvider } from "./hash.js";
import { EnterpriseImportError } from "./types.js";
import { parseSafeXml, type XmlNode } from "./xml-lite.js";
import { decodeDrawioCompressedPage } from "./drawio-compressed-page.js";

export const DRAWIO_PREVIEW_PROFILE="diagrams.drawio.uncompressed-structure.v1" as const;
const MAX_BYTES=2*1024*1024;
const MAX_PAGES=16;
const MAX_VERTICES=1000;
const MAX_EDGES=2000;
const SAFE_ID=/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const fail=(code:string):never=>{throw new EnterpriseImportError(code,code);};
const value=(n:XmlNode,name:string):string|undefined=>n.attributes[name];
const child=(n:XmlNode,name:string):XmlNode[]=>n.children.filter(x=>x.name===name);
function exactChildren(n:XmlNode,names:readonly string[]):void{
  if(n.children.some(c=>!names.includes(c.name)))fail("DRAWIO_UNSUPPORTED_ELEMENT");
  if(n.text.trim())fail("DRAWIO_UNSUPPORTED_TEXT");
}
function singleton(n:XmlNode,name:string):XmlNode{
  const all=child(n,name);
  if(all.length!==1)fail("DRAWIO_CARDINALITY_INVALID");
  return all[0]!;
}
function requiredId(n:XmlNode,attribute="id"):string{
  const id=value(n,attribute);
  if(!id||!SAFE_ID.test(id))fail("DRAWIO_ID_INVALID");
  return id as string;
}
function checkGeometry(cell:XmlNode):void{
  exactChildren(cell,["mxGeometry"]);
  if(cell.children.length>1)fail("DRAWIO_GEOMETRY_INVALID");
  for(const geom of cell.children){
    exactChildren(geom,["mxPoint"]);
    for(const pt of geom.children)exactChildren(pt,[]);
  }
}
export interface DrawioPageSummary {
  readonly pageOrdinal:number;
  readonly vertexCount:number;
  readonly drawnEdgeCount:number;
}
export interface DrawioStructurePreview {
  readonly status:"PREVIEW_ONLY";
  readonly profileId:typeof DRAWIO_PREVIEW_PROFILE;
  readonly semanticTrack:"TOPOLOGY_DECLARED";
  readonly sourceSha256:string;
  readonly pageCount:number;
  readonly vertexCount:number;
  readonly drawnEdgeCount:number;
  /** Number of raw-DEFLATE pages independently parsed with the same structural rules. */
  readonly compressedPageCount:number;
  readonly pages:readonly DrawioPageSummary[];
  readonly canActivate:false;
  readonly engineVerified:false;
  readonly physicalTopologyVerified:false;
  readonly modelMutated:false;
}

/**
 * Minimal uncompressed mxfile/mxGraphModel structural counts ONLY. All labels,
 * IDs, IPs, styles, locations and drawn edge endpoints are discarded. Never
 * infer real cabling, scenario resources, Engine truth or asset identity.
 */
export async function previewDrawioStructure(bytes:Uint8Array):Promise<DrawioStructurePreview>{
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>MAX_BYTES)
    fail("DRAWIO_SOURCE_SIZE_INVALID");
  const doc:XmlNode=(()=>{
    try{return parseSafeXml(bytes,"drawio");}
    catch(error){
      const code=error instanceof EnterpriseImportError &&
        /^IMPORT_XML_[A-Z0-9_]+$/.test(error.code)?error.code:"DRAWIO_XML_INVALID";
      throw new EnterpriseImportError(code,code);
    }
  })();
  let diagrams:readonly XmlNode[]=[];
  if(doc.name==="mxfile"){
    exactChildren(doc,["diagram"]);
    const outerCompression=value(doc,"compressed");
    if(outerCompression!==undefined && outerCompression!=="false" && outerCompression!=="true")
      fail("DRAWIO_COMPRESSION_ATTRIBUTE_INVALID");
    diagrams=child(doc,"diagram");
  }else if(doc.name==="mxGraphModel"){
    diagrams=[doc];
  }else fail("DRAWIO_ROOT_UNSUPPORTED");
  if(diagrams.length<1||diagrams.length>MAX_PAGES)fail("DRAWIO_PAGE_COUNT_INVALID");
  const pageIds=new Set<string>();
  const pages:DrawioPageSummary[]=[];
  let allVertices=0,allEdges=0,compressedPageCount=0;
  const inflationBudget={inflatedBytes:0};
  for(const [pageOrdinal,page] of diagrams.entries()){
    let model:XmlNode;
    if(page.name==="diagram"){
      const id=requiredId(page);
      if(pageIds.has(id))fail("DRAWIO_DUPLICATE_PAGE");
      pageIds.add(id);
      if(page.text.trim() && page.children.length){
        fail("DRAWIO_MIXED_PAGE_CONTENT");
      }
      if(page.children.length===0){
        if(value(doc,"compressed")==="false")fail("DRAWIO_COMPRESSION_MISMATCH");
        const raw=await decodeDrawioCompressedPage(page.text,inflationBudget);
        model=(()=>{
          try{return parseSafeXml(raw,"drawio-decompressed-page");}
          catch(error){
            const code=error instanceof EnterpriseImportError &&
              /^IMPORT_XML_[A-Z0-9_]+$/.test(error.code)
              ?error.code:"DRAWIO_COMPRESSED_XML_INVALID";
            throw new EnterpriseImportError(code,code);
          }
        })();
        if(model.name!=="mxGraphModel")fail("DRAWIO_COMPRESSED_ROOT_INVALID");
        compressedPageCount++;
      }else{
        if(value(doc,"compressed")==="true")fail("DRAWIO_COMPRESSED_UNSUPPORTED");
        exactChildren(page,["mxGraphModel"]);
        model=singleton(page,"mxGraphModel");
      }
    }else{
      model=page;
    }
    exactChildren(model,["root"]);
    const root=singleton(model,"root");
    exactChildren(root,["mxCell"]);
    const cells=child(root,"mxCell");
    if(cells.length<2)fail("DRAWIO_MISSING_ROOT_CELLS");
    const seen=new Set<string>();
    let rootCell=false,layerCell=false;
    const vertices=new Set<string>();
    const edges:XmlNode[]=[];
    for(const cell of cells){
      const id=requiredId(cell);
      if(seen.has(id))fail("DRAWIO_DUPLICATE_CELL");
      seen.add(id);
      checkGeometry(cell);
      if(id==="0"){
        if(value(cell,"parent")!==undefined || value(cell,"vertex")!==undefined||
           value(cell,"edge")!==undefined)fail("DRAWIO_ROOT_CELL_INVALID");
        rootCell=true;continue;
      }
      if(id==="1"){
        if(value(cell,"parent")!=="0" || value(cell,"vertex")!==undefined||
           value(cell,"edge")!==undefined)fail("DRAWIO_LAYER_CELL_INVALID");
        layerCell=true;continue;
      }
      if(value(cell,"parent")!=="1")fail("DRAWIO_PARENT_UNSUPPORTED");
      const vertex=value(cell,"vertex")==="1";
      const edge=value(cell,"edge")==="1";
      if(vertex===edge || (value(cell,"vertex")!==undefined&&!vertex) ||
         (value(cell,"edge")!==undefined&&!edge))fail("DRAWIO_CELL_TYPE_INVALID");
      if(vertex)vertices.add(id);
      else edges.push(cell);
    }
    if(!rootCell||!layerCell)fail("DRAWIO_MISSING_ROOT_CELLS");
    allVertices+=vertices.size;allEdges+=edges.length;
    if(allVertices>MAX_VERTICES)fail("DRAWIO_VERTEX_BUDGET");
    if(allEdges>MAX_EDGES)fail("DRAWIO_EDGE_BUDGET");
    for(const edge of edges){
      const source=requiredId(edge,"source"),target=requiredId(edge,"target");
      if(!vertices.has(source)||!vertices.has(target))fail("DRAWIO_EDGE_ENDPOINT_INVALID");
    }
    pages.push(Object.freeze({pageOrdinal,vertexCount:vertices.size,drawnEdgeCount:edges.length}));
  }
  const sourceSha256=await webCryptoImportHashProvider.sha256Bytes(bytes);
  return Object.freeze({
    status:"PREVIEW_ONLY",profileId:DRAWIO_PREVIEW_PROFILE,
    semanticTrack:"TOPOLOGY_DECLARED",sourceSha256,
    pageCount:pages.length,vertexCount:allVertices,drawnEdgeCount:allEdges,
    compressedPageCount,pages:Object.freeze(pages),
    canActivate:false,engineVerified:false,physicalTopologyVerified:false,
    modelMutated:false,
  });
}

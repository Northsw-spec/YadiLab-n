import { EnterpriseImportError } from "./types.js";
import { webCryptoImportHashProvider } from "./hash.js";
import { openSafeWorkbookArchive, productionWorkbookArchiveBackend,
  type WorkbookArchiveLimits } from "./workbook-archive.js";
import { attr, childElements, descendants, parseSafeXml, parseSafeXmlOfficeS3, type XmlNode } from "./xml-lite.js";

export const ODT_TABLES_PROFILE = "office.odt-tables.structural.v1" as const;
const ODT_MIME = "application/vnd.oasis.opendocument.text";
const OFFICE_NS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const MANIFEST_NS = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
const LIMITS: WorkbookArchiveLimits = {
  maxFiles: 32, maxCompressedBytes: 16*1024*1024,
  maxDecompressedBytes: 32*1024*1024,
  maxSingleFileBytes: 4*1024*1024, maxCompressionRatio: 100,
};
// S2 extra ZIP/XML allowance requires explicit structural-only v2 consent.
// Do not relax default/v1 archive, compression, or active-content boundaries.
const LIMITS_S2:WorkbookArchiveLimits={
  ...LIMITS,maxDecompressedBytes:64*1024*1024,
  maxSingleFileBytes:8*1024*1024,
};
// Opt-in P4c1 structure-only: larger explicit hard cap, still inherits
// legacy compressed size, file count, compression ratio and active-content deny.
const LIMITS_S3:WorkbookArchiveLimits={
  ...LIMITS_S2,maxDecompressedBytes:96*1024*1024,
  maxSingleFileBytes:16*1024*1024,
};
function fail(code:string):never { throw new EnterpriseImportError(code,code); }
/** SCALE-001 P1a opt-in; never an import/approval or Engine capability. */
export const SCALE_OFFICE_LARGE_STRUCTURE_PROFILE = "office.scaled-structural-review.v1" as const;
/** S2/P3a: separate 5000-row source-structure-only profile. */
export const SCALE_OFFICE_S2_STRUCTURE_PROFILE = "office.scaled-structural-review.v2" as const;
/** P4c1 explicit original 10000-row structure without cell disclosure. */
export const SCALE_OFFICE_S3_STRUCTURE_PROFILE = "office.scaled-structural-review.v3" as const;
export interface OfficeLargeStructureDecision {
  readonly capacityProfile:
    typeof SCALE_OFFICE_LARGE_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S2_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S3_STRUCTURE_PROFILE;
}
function acceptLargeCapacity(decision: OfficeLargeStructureDecision | undefined):
  "default" | "v1" | "v2" | "v3" {
  if (decision === undefined) return "default";
  if (!decision || typeof decision !== "object" || Array.isArray(decision) ||
      Object.keys(decision).length !== 1 ||
      (decision.capacityProfile !== SCALE_OFFICE_LARGE_STRUCTURE_PROFILE &&
       decision.capacityProfile !== SCALE_OFFICE_S2_STRUCTURE_PROFILE &&
       decision.capacityProfile !== SCALE_OFFICE_S3_STRUCTURE_PROFILE)) {
    fail("SCALE_P1A_CAPACITY_PROFILE_INVALID");
  }
  return decision.capacityProfile === SCALE_OFFICE_S3_STRUCTURE_PROFILE ? "v3"
    : decision.capacityProfile === SCALE_OFFICE_S2_STRUCTURE_PROFILE ? "v2" : "v1";
}

function exactly(node:XmlNode, name:string):boolean { return node.name===name; }
function onlyChildren(node:XmlNode, allowed:readonly string[]):void {
  if(node.children.some(child=>!allowed.includes(child.name)))fail("ODT_UNSUPPORTED_MARKUP");
}
function onlyAttrs(node:XmlNode, allowed:readonly string[]):void {
  if(Object.keys(node.attributes).some(name=>!allowed.includes(name)))fail("ODT_UNSUPPORTED_ATTRIBUTE");
}
function noNamespaceRedefinition(node:XmlNode, isRoot:boolean):void {
  if(!isRoot && Object.keys(node.attributes).some(name=>name==="xmlns"||name.startsWith("xmlns:"))) {
    fail("ODT_NAMESPACE_REDECLARATION");
  }
  for(const child of node.children)noNamespaceRedefinition(child,false);
}
function validateFirstMimetype(bytes:Uint8Array):void {
  // OASIS ODF 1.3 part 2 §3.3: mimetype is the first ZIP member,
  // STORED without a local ZIP extra field. Inspect the actual first header,
  // not the central directory's arbitrarily reordered list.
  if(bytes.byteLength<42 || bytes[0]!==0x50||bytes[1]!==0x4b||
      bytes[2]!==0x03||bytes[3]!==0x04)fail("ODT_PACKAGE_HEADER_INVALID");
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if((v.getUint16(6,true)&1)!==0)fail("ODT_ENCRYPTED_PACKAGE");
  if(v.getUint16(8,true)!==0)fail("ODT_MIMETYPE_MUST_BE_STORED");
  const nameLength=v.getUint16(26,true),extraLength=v.getUint16(28,true);
  if(extraLength!==0 || nameLength!==8 || bytes.byteLength<30+nameLength+ODT_MIME.length) {
    fail("ODT_MIMETYPE_HEADER_INVALID");
  }
  if(new TextDecoder("ascii").decode(bytes.subarray(30,38))!=="mimetype") {
    fail("ODT_MIMETYPE_FIRST_REQUIRED");
  }
  if(new TextDecoder("ascii").decode(bytes.subarray(38,38+ODT_MIME.length))!==ODT_MIME){
    fail("ODT_MIMETYPE_VALUE_INVALID");
  }
}
function safeXmlPart(bytes:Uint8Array,label:string,maxBytes=1024*1024,officeS3=false):XmlNode {
  if(bytes.byteLength>maxBytes)fail("ODT_XML_TOO_LARGE");
  const root=officeS3
    ?parseSafeXmlOfficeS3(bytes,label)
    :parseSafeXml(bytes,label);
  noNamespaceRedefinition(root,true);
  const inspect=(node:XmlNode):void=>{
    if(/^(?:office:scripts|script:|draw:|text:a$|office:binary-data$|office:event-listeners$)/i.test(node.name) ||
        Object.keys(node.attributes).some(key=>/(?:^|:)href$|^on[a-z]+$/i.test(key)) ||
        /^(?:office:script|office:forms)$/i.test(node.name))fail("ODT_ACTIVE_OR_EXTERNAL_CONTENT");
    for(const child of node.children)inspect(child);
  };
  inspect(root);
  return root;
}
export interface OdtCellLocator {
  readonly kind:"odt-table-cell";
  readonly sourceSha256:string;
  readonly part:"content.xml";
  readonly tableOrdinal:number;
  readonly rowOrdinal:number;
  readonly cellOrdinal:number;
}
export interface OdtTableCellStructural {
  readonly cellOrdinal:number;
  readonly textCodeUnits:number;
  readonly locator:OdtCellLocator;
}
export interface OdtTableRowStructural {
  readonly rowOrdinal:number;
  readonly cells:readonly OdtTableCellStructural[];
}
export interface OdtTableStructural {
  readonly tableOrdinal:number;
  readonly rows:readonly OdtTableRowStructural[];
}
export interface OdtStructuralPreview {
  readonly profileId:typeof ODT_TABLES_PROFILE;
  readonly capacityProfile?:typeof SCALE_OFFICE_LARGE_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S2_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S3_STRUCTURE_PROFILE;
  readonly status:"REVIEW_REQUIRED";
  readonly semanticTrack:"CONFIG_DOCUMENTED";
  readonly sourceSha256:string;
  readonly tables:readonly OdtTableStructural[];
  readonly totalCells:number;
  readonly textIncluded:false;
  readonly canActivate:false;
  readonly engineVerified:false;
  readonly physicalTopologyVerified:false;
}
function cellLength(node:XmlNode):number{
  onlyAttrs(node,["office:value-type","table:style-name"]);
  if(attr(node,"value-type")!==undefined && attr(node,"value-type")!=="string"){
    fail("ODT_UNSUPPORTED_CELL_VALUE_TYPE");
  }
  onlyChildren(node,["text:p"]);
  let count=0;
  for(const p of childElements(node,"p")){
    if(!exactly(p,"text:p"))fail("ODT_UNSUPPORTED_MARKUP");
    onlyAttrs(p,["text:style-name"]);
    if(p.children.length)fail("ODT_RICH_CELL_TEXT_UNSUPPORTED");
    count+=p.text.length;
    if(count>4096)fail("ODT_CELL_TEXT_TOO_LARGE");
  }
  return count;
}

/** ODT table structure only, never source cell values or per-cell hashes. */
export async function previewOdtTableStructure(input:Uint8Array,
  decision?:OfficeLargeStructureDecision):Promise<OdtStructuralPreview> {
  const capacity=acceptLargeCapacity(decision);
  const large=capacity!=="default";
  const s2=capacity==="v2";
  const s3=capacity==="v3";
  if(!(input instanceof Uint8Array) || input.byteLength<42 ||
    input.byteLength>16*1024*1024)fail("ODT_SOURCE_SIZE_INVALID");
  validateFirstMimetype(input);
  const archive=await openSafeWorkbookArchive(input,productionWorkbookArchiveBackend(),s3?LIMITS_S3:s2?LIMITS_S2:LIMITS);
  try {
    const must=["mimetype","content.xml","META-INF/manifest.xml"];
    for(const path of must)if(!archive.has(path))fail("ODT_REQUIRED_MEMBER_MISSING");
    const allowed=new Set([...must,"styles.xml","meta.xml","settings.xml"]);
    if(archive.paths.some(path=>!allowed.has(path)))fail("ODT_UNSUPPORTED_PACKAGE_MEMBER");
    const mime=await archive.read("mimetype");
    if(new TextDecoder("ascii").decode(mime)!==ODT_MIME)fail("ODT_MIMETYPE_VALUE_INVALID");
    const manifest=safeXmlPart(await archive.read("META-INF/manifest.xml"),"ODT manifest");
    if(!exactly(manifest,"manifest:manifest") || manifest.attributes["xmlns:manifest"]!==MANIFEST_NS){
      fail("ODT_MANIFEST_NAMESPACE_INVALID");
    }
    onlyChildren(manifest,["manifest:file-entry"]);
    const manifestFiles=new Set<string>();
    let rootMime="";
    for(const entry of manifest.children){
      onlyAttrs(entry,["manifest:full-path","manifest:media-type","manifest:version"]);
      const path=entry.attributes["manifest:full-path"]??"";
      if(!path || manifestFiles.has(path) || entry.children.length)fail("ODT_MANIFEST_INVALID");
      manifestFiles.add(path);
      if(path==="/")rootMime=entry.attributes["manifest:media-type"]??"";
      if(path.startsWith("/")&&path!=="/")fail("ODT_MANIFEST_INVALID");
      if(path!="/" && !allowed.has(path))fail("ODT_MANIFEST_INVALID");
    }
    if(rootMime!==ODT_MIME || !manifestFiles.has("content.xml")){
      fail("ODT_MANIFEST_MISMATCH");
    }
    for(const name of archive.paths.filter(x=>x.endsWith(".xml") && x!=="content.xml" && x!=="META-INF/manifest.xml")){
      safeXmlPart(await archive.read(name),"ODT metadata");
    }
    const doc=safeXmlPart(await archive.read("content.xml"),"ODT content",
      (s3?16:s2?8:large?4:1)*1024*1024,s3);
    if(!exactly(doc,"office:document-content") || doc.attributes["xmlns:office"]!==OFFICE_NS ||
      doc.attributes["xmlns:table"]!==TABLE_NS || doc.attributes["xmlns:text"]!==TEXT_NS){
      fail("ODT_DOCUMENT_NAMESPACE_INVALID");
    }
    onlyChildren(doc,["office:font-face-decls","office:automatic-styles","office:body"]);
    const bodies=doc.children.filter(x=>exactly(x,"office:body"));
    if(bodies.length!==1)fail("ODT_BODY_INVALID");
    onlyChildren(bodies[0]!,["office:text"]);
    const texts=bodies[0]!.children.filter(x=>exactly(x,"office:text"));
    if(texts.length!==1)fail("ODT_BODY_INVALID");
    const body=texts[0]!;
    onlyChildren(body,["text:p","table:table"]);
    // Reject nested/wrapped tables; all accepted tables are direct children.
    if(descendants(doc,"table").length!==body.children.filter(x=>exactly(x,"table:table")).length){
      fail("ODT_NESTED_OR_WRAPPED_TABLE");
    }
    const tableNodes=body.children.filter(x=>exactly(x,"table:table"));
    if(tableNodes.length>20)fail("ODT_TOO_MANY_TABLES");
    const sourceSha256=await webCryptoImportHashProvider.sha256Bytes(input);
    const tables:OdtTableStructural[]=[];
    let totalCells=0;
    for(let t=0;t<tableNodes.length;t++){
      const table=tableNodes[t]!;
      onlyAttrs(table,["table:name","table:style-name"]);
      onlyChildren(table,["table:table-column","table:table-row"]);
      for(const column of table.children.filter(x=>exactly(x,"table:table-column"))){
        onlyAttrs(column,["table:style-name"]);
        if(column.children.length)fail("ODT_UNSUPPORTED_MARKUP");
      }
      const rowNodes=table.children.filter(x=>exactly(x,"table:table-row"));
      if(rowNodes.length<1||rowNodes.length>(s3?10001:s2?5001:large?1001:200))fail("ODT_ROW_COUNT_UNSUPPORTED");
      const rows:OdtTableRowStructural[]=[];
      for(let r=0;r<rowNodes.length;r++){
        const row=rowNodes[r]!;
        onlyAttrs(row,["table:style-name"]);
        onlyChildren(row,["table:table-cell"]);
        const cells=row.children;
        if(cells.length<1||cells.length>16)fail("ODT_COLUMN_COUNT_UNSUPPORTED");
        const items:OdtTableCellStructural[]=[];
        for(let c=0;c<cells.length;c++){
          const cell=cells[c]!;
          totalCells++;
          if(totalCells>(s3?100000:s2?50000:large?20000:2000))fail("ODT_TOO_MANY_CELLS");
          items.push(Object.freeze({
            cellOrdinal:c,textCodeUnits:cellLength(cell),
            locator:Object.freeze({kind:"odt-table-cell" as const,
              part:"content.xml" as const,sourceSha256,
              tableOrdinal:t,rowOrdinal:r,cellOrdinal:c}),
          }));
        }
        rows.push(Object.freeze({rowOrdinal:r,cells:Object.freeze(items)}));
      }
      tables.push(Object.freeze({tableOrdinal:t,rows:Object.freeze(rows)}));
    }
    return Object.freeze({
      profileId:ODT_TABLES_PROFILE,
      ...(large?{capacityProfile:s3
        ? SCALE_OFFICE_S3_STRUCTURE_PROFILE
        : s2 ? SCALE_OFFICE_S2_STRUCTURE_PROFILE
        : SCALE_OFFICE_LARGE_STRUCTURE_PROFILE}:{}),
      status:"REVIEW_REQUIRED",
      semanticTrack:"CONFIG_DOCUMENTED",sourceSha256,
      tables:Object.freeze(tables),totalCells,textIncluded:false,
      canActivate:false,engineVerified:false,physicalTopologyVerified:false,
    });
  } finally { await archive.close(); }
}

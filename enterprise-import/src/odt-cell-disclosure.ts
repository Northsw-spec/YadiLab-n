import { previewOdtTableStructure, type OdtCellLocator } from "./odt-tables-structural-preview.js";
import { openSafeWorkbookArchive, productionWorkbookArchiveBackend, type WorkbookArchiveLimits } from "./workbook-archive.js";
import { childElements, parseSafeXml, type XmlNode } from "./xml-lite.js";
import { EnterpriseImportError } from "./types.js";

// Match the independently frozen ODT P1 ZIP budget. Never use broader XLSX limits.
const ODT_LIMITS: WorkbookArchiveLimits = {
  maxFiles:32,maxCompressedBytes:16*1024*1024,
  maxDecompressedBytes:32*1024*1024,
  maxSingleFileBytes:4*1024*1024,maxCompressionRatio:100,
};
const KEYS=["kind","sourceSha256","part","tableOrdinal","rowOrdinal","cellOrdinal"];
const CREDENTIAL = /(?:password|passwd|passphrase|secret|token|credential|bearer|private[ ._-]*key|api[ ._-]*key|access[ ._-]*key|ssh[ ._-]*key|client[ ._-]*secret|authorization|auth[ ._-]*key|connection[ ._-]*string|certificate[ ._-]*key)/i;
function deny(code:string):never {
  // Never forward extracted XML text or unsafe archive exception details.
  throw new EnterpriseImportError(code,code);
}
const ordinal=(n:unknown):n is number=>Number.isSafeInteger(n) && (n as number)>=0;
function isSensitive(value:string):boolean {
  if(value.length===0 || value.length>128)return true;
  if(!/^[A-Za-z0-9][A-Za-z0-9 ._:-]*$/.test(value))return true;
  if(CREDENTIAL.test(value))return true;
  if(/[A-Za-z0-9_-]{24,}/.test(value))return true;
  if(/(?:[A-Fa-f0-9]{2}:){8,}[A-Fa-f0-9]{2}/.test(value))return true;
  return false;
}
function exactChildren(node:XmlNode,name:string):readonly XmlNode[]{
  return node.children.filter(c=>c.name===name);
}
function plainText(cell:XmlNode):string{
  // P1 has already rejected rich text, child nodes, repeated/spanned cells.
  return exactChildren(cell,"text:p").map(p=>p.text).join("");
}
export interface OdtReviewedCell {
  readonly status:"REVEALED_UNVERIFIED";
  readonly semanticTrack:"CONFIG_DOCUMENTED";
  readonly sourceSha256:string;
  readonly locator:OdtCellLocator;
  readonly text:string;
  readonly canActivate:false;
  readonly engineVerified:false;
  readonly physicalTopologyVerified:false;
}
/**
 * Deliberate ONE-cell local reveal; never an import adapter or bulk table reader.
 * The full original ODT P1 validation and exact SHA256 precede extraction.
 * Credential filter is conservative but cannot certify complete confidentiality.
 */
export async function discloseReviewedOdtCell(
  bytes:Uint8Array,expectedSourceSha256:string,locator:OdtCellLocator,
  operatorAcknowledged:boolean,
):Promise<OdtReviewedCell>{
  if(operatorAcknowledged!==true)deny("ODT_CELL_CONSENT_REQUIRED");
  if(!locator||typeof locator!=="object"||Array.isArray(locator)||
     Object.keys(locator).sort().join(",")!==KEYS.slice().sort().join(",")||
     locator.kind!=="odt-table-cell"||locator.part!=="content.xml"||
     !ordinal(locator.tableOrdinal)||!ordinal(locator.rowOrdinal)||
     !ordinal(locator.cellOrdinal)|| !/^[a-f0-9]{64}$/.test(expectedSourceSha256)||
     locator.sourceSha256!==expectedSourceSha256)deny("ODT_CELL_LOCATOR_INVALID");

  let preview;
  try { preview=await previewOdtTableStructure(bytes); }
  catch { deny("ODT_CELL_SOURCE_BLOCKED"); }
  if(preview.sourceSha256!==expectedSourceSha256)deny("ODT_CELL_STALE_SOURCE");
  const chosen=preview.tables[locator.tableOrdinal]?.rows[locator.rowOrdinal]?.cells[locator.cellOrdinal];
  if(!chosen || JSON.stringify(chosen.locator)!==JSON.stringify(locator)) {
    deny("ODT_CELL_LOCATOR_INVALID");
  }
  let archive;
  try {
    archive=await openSafeWorkbookArchive(bytes,productionWorkbookArchiveBackend(),ODT_LIMITS);
    const doc=parseSafeXml(await archive.read("content.xml"),"ODT cell review");
    const body=exactChildren(doc,"office:body")[0];
    const text=body&&exactChildren(body,"office:text")[0];
    const table=text&&exactChildren(text,"table:table")[locator.tableOrdinal];
    const rows=table&&exactChildren(table,"table:table-row");
    const row=rows?.[locator.rowOrdinal];
    const cell=row&&exactChildren(row,"table:table-cell")[locator.cellOrdinal];
    if(!cell||!row||!rows)deny("ODT_CELL_LOCATOR_INVALID");

    // A benign-looking value is still sensitive under a credential header/row label.
    const heading=exactChildren(rows[0]!,"table:table-cell")[locator.cellOrdinal];
    const label=exactChildren(row,"table:table-cell")[0];
    if(CREDENTIAL.test(heading?plainText(heading):"")||
       CREDENTIAL.test(label?plainText(label):""))deny("ODT_CELL_SENSITIVE_BLOCKED");

    const value=plainText(cell);
    if(value.length!==chosen.textCodeUnits)deny("ODT_CELL_STRUCTURE_CHANGED");
    if(isSensitive(value))deny("ODT_CELL_SENSITIVE_BLOCKED");
    return Object.freeze({
      status:"REVEALED_UNVERIFIED",semanticTrack:"CONFIG_DOCUMENTED",
      sourceSha256:preview.sourceSha256,
      locator:Object.freeze({...chosen.locator}),
      text:value,canActivate:false,engineVerified:false,
      physicalTopologyVerified:false,
    });
  }catch(error){
    if(error instanceof EnterpriseImportError && /^ODT_CELL_/.test(error.code))throw error;
    return deny("ODT_CELL_SOURCE_BLOCKED");
  }finally{
    if(archive)await archive.close().catch(()=>{});
  }
}

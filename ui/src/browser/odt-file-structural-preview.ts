import { previewOdtTableStructure, type OdtStructuralPreview } from "../../../enterprise-import/src/odt-tables-structural-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";
import { discloseReviewedOdtCell, type OdtReviewedCell } from "../../../enterprise-import/src/odt-cell-disclosure.js";
import type { OdtCellLocator } from "../../../enterprise-import/src/odt-tables-structural-preview.js";

const MAX_BYTES=16*1024*1024;
export interface OdtLocalFile {
  readonly name:string;
  readonly size?:number;
  arrayBuffer():Promise<ArrayBuffer>;
}
export interface OdtLocalStructure {
  readonly filename:string;
  readonly preview:OdtStructuralPreview;
}
/** Offline local file bridge; extension alone NEVER authorizes parsing. */
export async function previewOdtFileStructure(file:OdtLocalFile):Promise<OdtLocalStructure> {
  if(!file || typeof file.name!=="string" || file.name.length>240 ||
    !/^[^/\\\0]+\.odt$/i.test(file.name) || typeof file.arrayBuffer!=="function"){
    throw new EnterpriseImportError("ODT_FILE_EXTENSION_INVALID","ODT_FILE_EXTENSION_INVALID");
  }
  if(file.size!==undefined &&
      (!Number.isSafeInteger(file.size)||file.size<42||file.size>MAX_BYTES)){
    throw new EnterpriseImportError("ODT_FILE_SIZE_INVALID","ODT_FILE_SIZE_INVALID");
  }
  const buffer=await file.arrayBuffer();
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<42||buffer.byteLength>MAX_BYTES){
    throw new EnterpriseImportError("ODT_FILE_SIZE_INVALID","ODT_FILE_SIZE_INVALID");
  }
  return {filename:file.name,preview:await previewOdtTableStructure(new Uint8Array(buffer))};
}


/** Re-open and read the local source AFTER a fresh per-cell operator click. */
export async function reviewOdtFileCell(
 file:OdtLocalFile,expectedSourceSha256:string,
 locator:OdtCellLocator,acknowledged:boolean,
):Promise<OdtReviewedCell>{
 if(acknowledged!==true){
   throw new EnterpriseImportError("ODT_CELL_CONSENT_REQUIRED","ODT_CELL_CONSENT_REQUIRED");
 }
 if(!file||typeof file.name!=="string"||file.name.length>240||
    !/^[^/\\\0]+\.odt$/i.test(file.name)||typeof file.arrayBuffer!=="function"){
   throw new EnterpriseImportError("ODT_FILE_EXTENSION_INVALID","ODT_FILE_EXTENSION_INVALID");
 }
 if(file.size!==undefined &&
    (!Number.isSafeInteger(file.size)||file.size<42||file.size>MAX_BYTES)){
   throw new EnterpriseImportError("ODT_FILE_SIZE_INVALID","ODT_FILE_SIZE_INVALID");
 }
 const source=await file.arrayBuffer();
 if(!(source instanceof ArrayBuffer)||source.byteLength<42||source.byteLength>MAX_BYTES){
   throw new EnterpriseImportError("ODT_FILE_SIZE_INVALID","ODT_FILE_SIZE_INVALID");
 }
 return discloseReviewedOdtCell(new Uint8Array(source),expectedSourceSha256,locator,true);
}

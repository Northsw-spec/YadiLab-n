import { previewDrawioStructure, type DrawioStructurePreview } from "../../../enterprise-import/src/drawio-structural-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const MAX_DRAWIO_BYTES=2*1024*1024;
export interface DrawioReadableFile{
  readonly name:string;
  readonly size?:number;
  arrayBuffer():Promise<ArrayBuffer>;
}
/** Local file boundary: extension is only a hint, source XML determines profile. */
export async function previewDrawioFileReadOnly(file:DrawioReadableFile):Promise<DrawioStructurePreview>{
  if(!file||typeof file.name!=="string"||file.name.length>240||
     !/^[^/\\\0]+\.drawio$/i.test(file.name)||typeof file.arrayBuffer!=="function"){
    throw new EnterpriseImportError("DRAWIO_FILE_EXTENSION_INVALID","DRAWIO_FILE_EXTENSION_INVALID");
  }
  if(file.size!==undefined &&
     (!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_DRAWIO_BYTES)){
    throw new EnterpriseImportError("DRAWIO_FILE_SIZE_INVALID","DRAWIO_FILE_SIZE_INVALID");
  }
  const raw=await file.arrayBuffer();
  if(!(raw instanceof ArrayBuffer)||raw.byteLength<1||raw.byteLength>MAX_DRAWIO_BYTES){
    throw new EnterpriseImportError("DRAWIO_FILE_SIZE_INVALID","DRAWIO_FILE_SIZE_INVALID");
  }
  return previewDrawioStructure(new Uint8Array(raw));
}

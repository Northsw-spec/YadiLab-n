import { previewNessusSeveritySummary, type NessusSeveritySummary } from "../../../enterprise-import/src/nessus-v2-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

const MAX_NESSUS_BYTES=2*1024*1024;
export interface NessusReadableFile {
  readonly name:string;
  readonly size?:number;
  arrayBuffer():Promise<ArrayBuffer>;
}
/** Only bounded local bytes, no workspace/import callbacks and no source text. */
export async function previewNessusFileReadOnly(file:NessusReadableFile):Promise<NessusSeveritySummary>{
  if(!file||typeof file.name!=="string"||file.name.length>240||
     !/^[^/\\\0]+\.nessus$/i.test(file.name)||typeof file.arrayBuffer!=="function"){
    throw new EnterpriseImportError("NESSUS_FILE_EXTENSION_INVALID","NESSUS_FILE_EXTENSION_INVALID");
  }
  if(file.size!==undefined &&
     (!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_NESSUS_BYTES)){
    throw new EnterpriseImportError("NESSUS_FILE_SIZE_INVALID","NESSUS_FILE_SIZE_INVALID");
  }
  const raw=await file.arrayBuffer();
  if(!(raw instanceof ArrayBuffer)||raw.byteLength<1||raw.byteLength>MAX_NESSUS_BYTES){
    throw new EnterpriseImportError("NESSUS_FILE_SIZE_INVALID","NESSUS_FILE_SIZE_INVALID");
  }
  return previewNessusSeveritySummary(new Uint8Array(raw));
}

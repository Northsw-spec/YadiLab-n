import { previewNessusFileReadOnly, type NessusReadableFile } from "./nessus-v2-file-preview.js";
import { replayNessusSavedReferences, type NessusReplayMatch } from "../../../enterprise-import/src/nessus-report-replay.js";
import type { NessusBuilderSnapshot } from "../../../enterprise-import/src/nessus-association-review.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface NessusReplayReadableFile extends NessusReadableFile {}
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};
async function read(file:NessusReplayReadableFile,extension:"nessus"|"json",limit:number):Promise<Uint8Array>{
  if(!file||typeof file.name!=="string"||file.name.length>240||
     !/^[^/\\\0]+$/.test(file.name)||
     !(extension==="nessus"?/\.nessus$/i:/\.json$/i).test(file.name)||
     typeof file.arrayBuffer!=="function")
    return deny("NESSUS_REPLAY_FILE_INVALID");
  if(file.size!==undefined&&
     (!Number.isSafeInteger(file.size)||file.size<2||file.size>limit))
    return deny("NESSUS_REPLAY_FILE_SIZE_INVALID");
  let buffer:ArrayBuffer;
  try{buffer=await file.arrayBuffer();}
  catch{return deny("NESSUS_REPLAY_FILE_INVALID");}
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<2||buffer.byteLength>limit)
    return deny("NESSUS_REPLAY_FILE_SIZE_INVALID");
  return new Uint8Array(buffer);
}
/** Read both explicit source files and use live Builder checks around each await. */
export async function replayNessusSavedReportFiles(
  original:NessusReplayReadableFile,report:NessusReplayReadableFile,
  getModel:()=>NessusBuilderSnapshot|null,
  consent:boolean,isCurrent:()=>boolean,
):Promise<NessusReplayMatch>{
  if(consent!==true)return deny("NESSUS_REPLAY_CONSENT_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())return deny("NESSUS_REPLAY_STALE");
  if(typeof getModel!=="function")return deny("NESSUS_REPLAY_BUILDER_REQUIRED");
  const initial=getModel();
  if(!initial)return deny("NESSUS_REPLAY_BUILDER_REQUIRED");
  const baseline=JSON.stringify(initial);
  const unchanged=()=>isCurrent()&&JSON.stringify(getModel())===baseline;
  const bytes=await read(original,"nessus",2*1024*1024);
  if(!unchanged())return deny("NESSUS_REPLAY_STALE");
  const actual=await previewNessusFileReadOnly({
    name:original.name,size:bytes.length,async arrayBuffer(){
      const copy=new ArrayBuffer(bytes.length);
      new Uint8Array(copy).set(bytes);
      return copy;
    },
  }).catch(()=>deny("NESSUS_REPLAY_SOURCE_BLOCKED"));
  if(!unchanged())return deny("NESSUS_REPLAY_STALE");
  const saved=await read(report,"json",512*1024);
  if(!unchanged())return deny("NESSUS_REPLAY_STALE");
  const matched=await replayNessusSavedReferences(bytes,saved,getModel(),true);
  if(!unchanged()||matched.sourceSha256!==actual.sourceSha256)
    return deny("NESSUS_REPLAY_STALE");
  return matched;
}

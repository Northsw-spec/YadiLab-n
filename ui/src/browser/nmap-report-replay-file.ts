import { previewNmapXmlFileReadOnly, type NmapXmlReadableFile } from "./nmap-xml-file-preview.js";
import { replayNmapSavedReferences, type NmapReplayMatch } from "../../../enterprise-import/src/nmap-report-replay.js";
import type { NmapModelSnapshot } from "../../../enterprise-import/src/nmap-association-review.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";

export interface NmapReplayReadableFile extends NmapXmlReadableFile {}
const deny=(code:string):never=>{throw new EnterpriseImportError(code,code);};
async function read(file:NmapReplayReadableFile,extension:"xml"|"json",limit:number):Promise<Uint8Array>{
  if(!file||typeof file.name!=="string"||file.name.length>240||
     !/^[^/\\\0]+$/.test(file.name)||
     !(extension==="xml"?/\.xml$/i:/\.json$/i).test(file.name)||
     typeof file.arrayBuffer!=="function")
    return deny("NMAP_REPLAY_FILE_INVALID");
  if(file.size!==undefined&&
     (!Number.isSafeInteger(file.size)||file.size<2||file.size>limit))
    return deny("NMAP_REPLAY_FILE_SIZE_INVALID");
  let buffer:ArrayBuffer;
  try{buffer=await file.arrayBuffer();}
  catch{return deny("NMAP_REPLAY_FILE_INVALID");}
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<2||buffer.byteLength>limit)
    return deny("NMAP_REPLAY_FILE_SIZE_INVALID");
  return new Uint8Array(buffer);
}
/** Read both explicit source files and use live Builder checks around each await. */
export async function replayNmapSavedReportFiles(
  original:NmapReplayReadableFile,report:NmapReplayReadableFile,
  getModel:()=>NmapModelSnapshot|null,
  consent:boolean,isCurrent:()=>boolean,
):Promise<NmapReplayMatch>{
  if(consent!==true)return deny("NMAP_REPLAY_CONSENT_REQUIRED");
  if(typeof isCurrent!=="function"||!isCurrent())return deny("NMAP_REPLAY_STALE");
  if(typeof getModel!=="function")return deny("NMAP_REPLAY_BUILDER_REQUIRED");
  const initial=getModel();
  if(!initial)return deny("NMAP_REPLAY_BUILDER_REQUIRED");
  const baseline=JSON.stringify(initial);
  const unchanged=()=>isCurrent()&&JSON.stringify(getModel())===baseline;
  const bytes=await read(original,"xml",2*1024*1024);
  if(!unchanged())return deny("NMAP_REPLAY_STALE");
  const actual=await previewNmapXmlFileReadOnly({
    name:original.name,size:bytes.length,async arrayBuffer(){
      const copy=new ArrayBuffer(bytes.length);
      new Uint8Array(copy).set(bytes);
      return copy;
    },
  }).catch(()=>deny("NMAP_REPLAY_SOURCE_BLOCKED"));
  if(!unchanged())return deny("NMAP_REPLAY_STALE");
  const saved=await read(report,"json",512*1024);
  if(!unchanged())return deny("NMAP_REPLAY_STALE");
  const matched=await replayNmapSavedReferences(bytes,saved,getModel(),true);
  if(!unchanged()||matched.sourceSha256!==actual.preview.sourceSha256)
    return deny("NMAP_REPLAY_STALE");
  return matched;
}
